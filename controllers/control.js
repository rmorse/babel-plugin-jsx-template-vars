
const {
	getExpressionArgs,
} = require( '../utils' );
const { getLanguageListCallExpression } = require( './list' );
class ControlController {
	constructor( vars, contextName, babel ) {
		this.vars = vars;
		this.babel = babel;
		this.contextName = contextName;
		this.updateTernaryConditions = this.updateTernaryConditions.bind( this );
		this.updateTernaryExpressions = this.updateTernaryExpressions.bind( this );
		this.getExpressionStatement = this.getExpressionStatement.bind( this );
		this.updateJSXExpressions = this.updateJSXExpressions.bind( this );
	}
	updateTernaryConditions( path ) {
		const { types } = this.babel;
		// We want tp update the ternary control vars before replace vars (so we can use them at the same time);
		// Use the identifier visitor to find any identifiers in ternary expressions.
		if ( this.vars.names.includes( path.node.name ) ) {
			const excludeTypes = [ 'ObjectProperty', 'ArrayPattern' ];
			if ( path.parentPath.node && ! excludeTypes.includes( path.parentPath.node.type ) ) {

				const parentNode = path.parentPath.node;
				const parentParentNode = path.parentPath.parentPath.node;

				// Supports:
				// const x = test === 'yes' ? 'a' : 'b';
				// let x; x = test ? 'a' : 'b';
				// const x = 'prefix-' + ( test ? 'a' : 'b' ) + '-suffix';
				// let x; x = 'prefix-' + ( test === false ? 'a' : 'b' ) + '-suffix';
				// And more, only looks for a ternary expression to match.
				// Should match anything that looks like: `( test ? 'a' : 'b' )`
				let ternaryExpression;
				let ternaryExpressionPath;
				// We need to check if parenNode is a ternary expression.
				if ( isTernaryExpression( parentNode, types ) ) {
					ternaryExpression = parentNode;
					ternaryExpressionPath = path.parentPath;
				} else if ( isTernaryExpression( parentParentNode, types ) ) {
					ternaryExpression = parentParentNode;
					ternaryExpressionPath = path.parentPath.parentPath;
				}
				if ( ternaryExpression && ternaryExpressionPath ) {
					this.updateTernaryExpressions( ternaryExpression, ternaryExpressionPath );
				}
				
			}
		}
	}
	updateTernaryExpressions( expressionSource, currentPath ) {
		const { types } = this.babel;
		if ( ! ( expressionSource.test && expressionSource.consequent && expressionSource.alternate ) ) {
			return;
		}

		const { statementType, args } = this.getExpressionStatement( expressionSource.test );
		
		if ( statementType && args.length > 0 ) {
			// Build the opening and closing expression tags.
			const { types } = this.babel;
			const controlStartString = getLanguageControlCallExpression( [ statementType, 'open' ], args, this.contextName, types );
			const controlStopString = getLanguageControlCallExpression( [ statementType, 'close' ], args, this.contextName, types );
			const controlElseStartString = getLanguageControlCallExpression( [ 'else', 'open' ], args, this.contextName, types );
			const controlElseStopString = getLanguageControlCallExpression( [ 'else', 'close' ], args, this.contextName, types );
			
			// create a new expression to add together 3 strings
			// if = expressionSource.consequent
			// else = expressionSource.alternate
			// Create a binary expression with the + operator
			const parts = [
				controlStartString,
				expressionSource.consequent,
				controlStopString,
				controlElseStartString,
				expressionSource.alternate,
				controlElseStopString,
			];
			const combinedBinaryExpression = createCombinedBinaryExpression( parts, '+', types );
			currentPath.replaceWith( combinedBinaryExpression );
		}
	}

	getExpressionStatement( sourceExpression ) {

		const { types } = this.babel;

		let statementType;

		const args = getExpressionArgs( sourceExpression, types );
		
		let conditionsMatched = 0;
		let identifierCount = 0;
		args.forEach( arg => {
			if ( arg.type === 'identifier' ) {
				identifierCount++;
				if ( this.vars.names.includes( arg.value ) ) {
					conditionsMatched++;
				}
			}
		} );

		// Return if there are no identifiers or conditions matched.
		if ( identifierCount === 0 || conditionsMatched === 0 ) {
			return { args, statementType };
		}

		// map these to handlebars helper functions and replace the expression with the helper tag.
		if ( sourceExpression.type === 'Identifier' ) {
			statementType = 'ifTruthy';
		} else if ( sourceExpression.type === 'UnaryExpression' ) {
			if ( sourceExpression.operator === '!' ) {
				statementType = 'ifFalsy';
			}
		} else if( sourceExpression.type === 'BinaryExpression' ) {
			if ( sourceExpression.operator === '===' ) {
				statementType = 'ifEqual';
			} else if ( sourceExpression.operator === '!==' ) {
				statementType = 'ifNotEqual';
			}
		}

		return {
			args,
			statementType,
		}

	}

	updateJSXExpressions( expressionSource, currentPath, listVarsToTag ) {

		if ( ! isControlExpression( expressionSource ) ) {
			return;
		}

		const { statementType, args } = this.getExpressionStatement( expressionSource.left );

		if ( statementType && args.length > 0 ) {
			const { types } = this.babel;
			const controlStartString = getLanguageControlCallExpression( [ statementType, 'open' ], args, this.contextName, types );
			const controlStopString = getLanguageControlCallExpression( [ statementType, 'close' ], args, this.contextName, types );
			currentPath.insertBefore( controlStartString );
			currentPath.insertAfter( controlStopString );

			// Now check to see if the right of the expression is a list variable, as we need to wrap them
			// in helper tags.
			if ( types.isIdentifier( expressionSource.right ) ) {
				const objectName = expressionSource.right.name;
				if ( listVarsToTag[ objectName ] ) {
					const listVarSourceName = listVarsToTag[ objectName ];
					const listOpen = getLanguageListCallExpression( 'open', listVarSourceName, this.contextName, types );
					const listClose = getLanguageListCallExpression( 'close', listVarSourceName, this.contextName, types );
			
					currentPath.insertBefore( listOpen );
					currentPath.insertAfter( listClose );
				}
			}
			
			// Now replace the whole expression with the right part (remove any conditions to display it)
			currentPath.replaceWith( expressionSource.right );
		}
	}
	
};



function isTernaryExpression( node, types ) {
	if ( types.isConditionalExpression( node ) ) {
		if ( node.test && node.consequent && node.alternate ) {
			return true;
		}
	}
	return false;
}


function createCombinedBinaryExpression( parts, operator, types ) {
	let expression = parts[ 0 ];
	for ( let i = 1; i < parts.length; i++ ) {
		expression = types.binaryExpression( operator, expression, parts[ i ] );
	}
	return expression;
}


function getLanguageControlCallExpression( targets, args, context, types ) {
	const targetsNodes = targets.map( target => types.stringLiteral( target ) );

	// using types, create a new object with the properties "type" and "value":
	const argsNodes = [];
	args.map( ( arg ) => {
		const objectWithProps = types.objectExpression( [
			types.objectProperty( types.identifier('type'), types.stringLiteral( arg.type ) ),
			types.objectProperty( types.identifier('value'), types.stringLiteral( arg.value ) ),
		] );
		argsNodes.push( objectWithProps );

	} );
		
	// const argsNodes = args.map( arg => types.stringLiteral( arg ) );
	return types.callExpression( types.identifier( 'getLanguageControl' ), [ types.arrayExpression( targetsNodes ), types.arrayExpression( argsNodes ), types.identifier( context ) ] );
}

/**
 * Ensures the expression being passed is a supporte control type.
 *
 * @param {Object} expression The expression to check
 * @returns 
 */
function isControlExpression( expression ) {
	if ( ! expression.left || ! expression.right ) {
		return false;
	}
	const controlExpressionTypes = [
		'Identifier',
		'MemberExpression',
		'UnaryExpression',
		'LogicalExpression',
	];
	if ( controlExpressionTypes.includes( expression.type  ) ) {
		return true;
	}
	return false;
}


module.exports = { ControlController };