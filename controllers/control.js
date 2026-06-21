const {
	getArgObjectExpression,
	getExpressionArgs,
	getLanguageCallExpression,
	getLanguageListCallExpression,
	getMemberExpressionSegments,
} = require( '../utils' );
class ControlController {
	constructor( vars, contextName, babel, listController = null ) {
		this.vars = vars;
		this.babel = babel;
		this.contextName = contextName;
		this.listController = listController;
		this.updateTernaryConditions = this.updateTernaryConditions.bind( this );
		this.updateTernaryMemberConditions = this.updateTernaryMemberConditions.bind( this );
		this.updateTernaryExpressions = this.updateTernaryExpressions.bind( this );
		this.getExpressionStatement = this.getExpressionStatement.bind( this );
		this.updateJSXExpressions = this.updateJSXExpressions.bind( this );
	}
	updateTernaryConditions( path ) {
		// We want tp update the ternary control vars before replace vars (so we can use them at the same time);
		// Use the identifier visitor to find any identifiers in ternary expressions.
		if ( this.vars.names.includes( path.node.name ) ) {
			this.updateTernaryPath( path );
		}
	}
	updateTernaryMemberConditions( path ) {
		const { types } = this.babel;
		if (
			(
				types.isMemberExpression( path.parentPath?.node ) ||
				( typeof types.isOptionalMemberExpression === 'function' && types.isOptionalMemberExpression( path.parentPath?.node ) ) ||
				path.parentPath?.node?.type === 'OptionalMemberExpression'
			) &&
			path.parentPath.node.object === path.node
		) {
			return;
		}

		const segments = getMemberExpressionSegments( path.node, types );
		if ( ! segments ) {
			return;
		}

		if ( this.vars.names.includes( segments.join( '.' ) ) ) {
			this.updateTernaryPath( path );
		}
	}
	updateTernaryPath( path ) {
		const { types } = this.babel;
		const excludeTypes = [ 'ObjectProperty', 'ArrayPattern' ];
		if ( path.parentPath.node && excludeTypes.includes( path.parentPath.node.type ) ) {
			return;
		}

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
	updateTernaryExpressions( expressionSource, currentPath ) {
		const { types } = this.babel;
		if ( ! ( expressionSource.test && expressionSource.consequent && expressionSource.alternate ) ) {
			return;
		}

		const { statementType, args } = this.getExpressionStatement( expressionSource.test, currentPath );
		
		if ( statementType && args.length > 0 ) {
			// Build the opening and closing expression tags.

			const { types } = this.babel;
			const languageOpen = getLanguageCallExpression( [ 'language', 'open' ], [], this.contextName, types );
			const controlStartString = getLanguageControlCallExpression( [ statementType, 'open' ], args, this.contextName, types );
			const controlStopString = getLanguageControlCallExpression( [ statementType, 'close' ], args, this.contextName, types );
			const controlElseStartString = getLanguageControlCallExpression( [ 'else', 'open' ], args, this.contextName, types );
			const languageClose = getLanguageCallExpression( [ 'language', 'close' ], [], this.contextName, types );
			

			// Ternaries are emitted as one control block with an inverse branch:
			// open -> consequent -> else transition -> alternate -> close.
			const parts = [
				languageOpen,
				controlStartString,
				languageClose,
				expressionSource.consequent,
				languageOpen,
				controlElseStartString,
				languageClose,
				expressionSource.alternate,
				languageOpen,
				controlStopString,
				languageClose,
			];
			
			// So what we need to do is replace the ternary expression.
			// But we have to approach this differently based on context.
			// For example, if we are in a JSX expression, we need to replace the path

			if ( types.isJSXExpressionContainer( currentPath.parentPath.node ) ) {
				currentPath.parentPath.replaceWithMultiple( parts );
			} else if ( types.isBinaryExpression( currentPath.parentPath.node ) ) {
				// If the ternary expression is inside a binary expression such as:
				// const x = 'text' + ( test ? 'a' : 'b' );
				// Then we know its not a JSX Fragment, so we should to build this as a binary expression.
				const combinedBinaryExpression = createCombinedBinaryExpression( parts, '+', types );
				currentPath.replaceWith( combinedBinaryExpression );
			} else if ( types.isLiteral( expressionSource.consequent ) && types.isLiteral( expressionSource.alternate ) ) {
				// If we are dealing with twoo literals, we can just replace the ternary expression with a binary expression.
				const combinedBinaryExpression = createCombinedBinaryExpression( parts, '+', types );
				currentPath.replaceWith( combinedBinaryExpression );
			} else {
				// Create a JSX Fragment to wrap the result.
				const newFragment = types.jsxFragment( types.jsxOpeningFragment(), types.jsxClosingFragment(), parts.map( part => types.JSXExpressionContainer( part ) ) );
				currentPath.replaceWith( newFragment );
			}
		}
	}

	getExpressionStatement( sourceExpression, currentPath = null ) {

		const { types } = this.babel;

		let statementType;

		const args = getExpressionArgs( sourceExpression, types )
			.map( arg => this.listController ? this.listController.resolveTemplateArg( arg, currentPath ) : arg );
		
		let conditionsMatched = 0;
		let identifierCount = 0;
		args.forEach( arg => {
			if ( arg.type === 'identifier' || arg.type === 'path' ) {
				identifierCount++;
				if ( this.vars.names.includes( arg.value ) || arg.matchedTemplatePath ) {
					conditionsMatched++;
				}
			}
		} );

		// Return if there are no identifiers or conditions matched.
		if ( identifierCount === 0 || conditionsMatched === 0 ) {
			return { args, statementType };
		}

		// map these to handlebars helper functions and replace the expression with the helper tag.
		if ( sourceExpression.type === 'Identifier' || sourceExpression.type === 'MemberExpression' || sourceExpression.type === 'OptionalMemberExpression' ) {
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

		const { statementType, args } = this.getExpressionStatement( expressionSource.left, currentPath );

		if ( statementType && args.length > 0 ) {
			const { types } = this.babel;

			const languageOpen = getLanguageCallExpression( [ 'language', 'open' ], [], this.contextName, types );

			const controlStartString = getLanguageControlCallExpression( [ statementType, 'open' ], args, this.contextName, types );
			const controlStopString = getLanguageControlCallExpression( [ statementType, 'close' ], args, this.contextName, types );

			const languageClose = getLanguageCallExpression( [ 'language', 'close' ], [], this.contextName, types );

			let hasInserted = false;
			// Now check to see if the right of the expression is a list variable, as we need to wrap them
			// in helper tags.
			if ( this.listController ) {
				const listMetadata = this.listController.resolveRenderedListMeta( expressionSource.right, currentPath );
				if ( listMetadata ) {

					const listOpen = this.listController.createListBoundaryExpression( listMetadata, 'open' );
					const listClose = this.listController.createListBoundaryExpression( listMetadata, 'close' );

					const parts = [
						languageOpen,
						controlStartString,
						languageClose,
						languageOpen,
						listOpen,
						languageClose,
						expressionSource.right,
						languageOpen,
						listClose,
						languageClose,
						languageOpen,
						controlStopString,
						languageClose,
					];
					currentPath.replaceWithMultiple( parts );
					hasInserted = true;
				}
			} else if ( types.isIdentifier( expressionSource.right ) ) {
				const objectName = expressionSource.right.name;
				if ( listVarsToTag[ objectName ] ) {
					const listVarSourceName = listVarsToTag[ objectName ];
					
					const listOpen = getLanguageListCallExpression( 'open', listVarSourceName, this.contextName, types );
					const listClose = getLanguageListCallExpression( 'close', listVarSourceName, this.contextName, types );
			
					const parts = [
						languageOpen,
						controlStartString,
						languageClose,
						languageOpen,
						listOpen,
						languageClose,
						expressionSource.right,
						languageOpen,
						listClose,
						languageClose,
						languageOpen,
						controlStopString,
						languageClose,
					];
					currentPath.replaceWithMultiple( parts );
					hasInserted = true;
				}
			}
			if ( ! hasInserted ) {
				const parts = [
					languageOpen,
					controlStartString,
					languageClose,
					expressionSource.right,
					languageOpen,
					controlStopString,
					languageClose,
				];
				currentPath.replaceWithMultiple( parts );
			}
			
			// Now replace the whole expression with the right part (remove any conditions to display it)

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

	// Using types, create a new object with the properties "type" and "value":
	const argsNodes = [];
	args.map( ( arg ) => {
		argsNodes.push( getArgObjectExpression( arg, types ) );

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
		'OptionalMemberExpression',
		'UnaryExpression',
		'LogicalExpression',
	];
	if ( controlExpressionTypes.includes( expression.type  ) ) {
		return true;
	}
	return false;
}


module.exports = { ControlController, createCombinedBinaryExpression };
