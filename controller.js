
const {
	getExpressionArgs,
	getArrayFromExpression,
	isJSXElementComponent,
	isJSXElementTextInput,
} = require( './utils' );

/**
 * Generate new uids for the provided scope.
 * 
 * @param {Object} scope The current scope.
 * @param {Object} vars The vars to generate uids for.
 * @returns 
 */
function generateVarTypeUids( scope, vars ) {
	const varMap = {};
	const varNames = [];
	vars.forEach( ( [ varName, varConfig ] ) => {
		const newIdentifier = scope.generateUidIdentifier("uid");
		varMap[ varName ] = newIdentifier.name;
		varNames.push( varName );
	} );

	return [ varMap, varNames ];
}



class ReplaceController {
	constructor( vars, babel ) {
		this.vars = vars;
		this.babel = babel;
		this.initVars = this.initVars.bind( this );
		this.updateIdentifierNames = this.updateIdentifierNames.bind( this );
	}
	initVars( contextName, path ) {
		// Add the new replace vars to to top of the block statement.
		const { parse } = this.babel;
		const self = this;
		this.vars.raw.forEach( ( templateVar ) => {
			const [ varName, varConfig ] = templateVar;
			// Alway declare as `let` so we don't need to worry about its usage later.
			const replaceString = `getLanguageReplace( 'format', { value: '${ varName }' }, ${ contextName } )`; 
			path.node.body.unshift( parse(`let ${ self.vars.mapped[ varName ] } = ${ replaceString };`) );
		} );
	}
	updateIdentifierNames( path ) {
		const { types } = this.babel;
		// We need to update all the identifiers with the new variables declared in the block statement
		if ( this.vars.names.includes( path.node.name ) ) {
			// Make sure we only replace identifiers that are not props and also that
			// they are not variable declarations.
			const excludeTypes = [ 'ObjectProperty', 'MemberExpression', 'VariableDeclarator', 'ArrayPattern' ];
			if ( path.parentPath.node && ! excludeTypes.includes( path.parentPath.node.type ) ) {
				path.node.name = this.vars.mapped[ path.node.name ];
			}

			// Now lets carefully update the node in 'ObjectProperty' types.
			// We can only re-assign the property value name, not the property key name
			// So we want { varName } to become { varName: _uid } or { something: varName } to become { something: _uid }
			if ( types.isObjectProperty( path.parentPath.node ) ) {
				if ( types.isIdentifier( path.parentPath.node.value ) ) {
					const valueName = path.parentPath.node.value.name;
					if ( this.vars.names.includes( valueName ) ) {
						path.parentPath.node.value.name = this.vars.mapped[ valueName ];
					}
				}
			}
		}
	}
};
class ListController {
	constructor( vars, contextName, babel ) {
		this.vars = vars;
		this.contextName = contextName;
		this.babel = babel;
		this.initVars = this.initVars.bind( this );
		this.buildDeclaration = this.buildDeclaration.bind( this );
		this.normaliseListVar = this.normaliseListVar.bind( this );
		this.updateIdentifierNames = this.updateIdentifierNames.bind( this );
		this.updateJSXListExpressions = this.updateJSXListExpressions.bind( this );
	}
	initVars( path ) {
		// Add the new list vars to to top of the block statement.
		const { parse, types } = this.babel;
		const self = this;

		this.vars.raw.forEach( ( templateVar, index ) => {
			const [ varName, varConfig ] = templateVar;
			// Alway declare as `let` so we don't need to worry about its usage later.
			const newAssignmentExpression = self.buildDeclaration( self.vars.mapped[ varName ], varConfig );
			if ( newAssignmentExpression ) {
				path.node.body.unshift( newAssignmentExpression );
			}
			// Now keep track of the list vars and aliaes we need to tag (and keep track of their original source var)
			self.vars.toTag[ varName ] = varName;
			if ( varConfig.aliases ) {
				varConfig.aliases.forEach( ( alias ) => {
					self.vars.toTag[ alias ] = varName;
				} );
			}
		} );
	}
	// Build the object for the replacement var in list type vars.
	buildDeclaration( varName, varConfig ) {
		const { parse, types } = this.babel;
		const normalisedConfig = this.normaliseListVar( varConfig );
		const { type, props } = normalisedConfig.child;
		const self = this;
		const newProp = [];
		if ( type === 'object' ) {
			const childProp = {};
			const propsArr = [];
			props.forEach( ( propName ) => {
				const listObject = getLanguageListCallExpression( 'objectProperty', propName, self.contextName, types );
				propsArr.push( types.objectProperty( types.identifier( propName ), listObject ) );
			} );
			newProp.push( childProp );
			const templateObject = types.objectExpression( propsArr )
			const right = types.arrayExpression( [ templateObject ] );
			
			const left = types.identifier( varName );
			return types.variableDeclaration('let', [
				types.variableDeclarator(left, right),
			]);
		} else if ( type === 'primitive' ) {
			// Then we're dealing with a normal array.
			// TODO: maybe "primitive" is not the best name for this type.
			const listPrimitiveString = `let ${ varName } = [ getLanguageList( 'primitive', null, ${ this.contextName } ) ];`;
			return parse( listPrimitiveString );
		}
		return null;
	}	
	normaliseListVar( varConfig ) {
		let normalisedConfig = { 
			type: 'list',
			child: { type: 'primitive' }
		};
		if ( varConfig ) {
			normalisedConfig = varConfig;
			if ( ! varConfig.child ) {
				normalisedConfig.child = { type: 'primitive' }
			}
		}
		
		return normalisedConfig;
	};
	updateIdentifierNames( path ) {
		const { types } = this.babel;
		// We also need to replace any lists / arrays with our own templatevars version.
		if ( this.vars.names.includes( path.node.name ) ) {
			const sourceVarName = path.node.name;
			// Make sure we only replace identifiers that are not props and also that
			// they are not variable declarations.
			const excludeTypes = [ 'ObjectProperty', 'VariableDeclarator', 'ArrayPattern' ];

			if ( path.parentPath.node && ! excludeTypes.includes( path.parentPath.node.type ) ) {
				// We want to only allow one case of a member expression when we find a `const x = y.map(...);`
				if ( types.isMemberExpression( path.parentPath.node ) ) {
					// then we want to make sure its a `.map` otherwise we don't want to support it for now.
					if ( types.isIdentifier( path.parentPath.node.property ) && path.parentPath.node.property.name === 'map' ) {
						// Inject list context to components inside the map
						if ( this.vars.mapped[ path.node.name ] ) {
							path.node.name = this.vars.mapped[ path.node.name ];
							// If we found a map, we want to track which identifier it was assigned to...
							if ( types.isCallExpression( path.parentPath.parentPath.node ) && types.isVariableDeclarator( path.parentPath.parentPath.parentPath.node ) ) {
								// Check if its an identifier and if so, add it to the listVars to tag.
								if ( types.isIdentifier( path.parentPath.parentPath.parentPath.node.id ) ) {
									const identifierName = path.parentPath.parentPath.parentPath.node.id.name;
									this.vars.toTag[ identifierName ] = sourceVarName;
								}
							}
						}
					} else {
						// Support other member expressions.
						path.node.name = this.vars.mapped[ path.node.name ];
					}
				} else {
					path.node.name = this.vars.mapped[ path.node.name ];
				}
			}
		}
	}
	updateJSXListExpressions( expressionSource, path ) {
		const { types } = this.babel;
		// Now look for identifers only, so we can look for list vars that need tagging.
		if ( types.isIdentifier( expressionSource ) ) {
			// Then we should be looking at something like: `{ myVar }`
			if ( this.vars.toTag[ expressionSource.name ] ) {
				const listOpen = getLanguageListCallExpression( 'open', this.vars.toTag[ expressionSource.name ], this.contextName, types );
				const listClose = getLanguageListCallExpression( 'close', this.vars.toTag[ expressionSource.name ], this.contextName, types );
				path.insertBefore( listOpen );
				path.insertAfter( listClose );
			}
		}

		// Also, lets support list vars that have .map() directly in the JSX (ie, they are not re-assigned to variable before being added to the output)
		if ( types.isCallExpression( expressionSource ) && types.isMemberExpression( expressionSource.callee ) ) {
			const memberExpression = expressionSource.callee;
			if ( types.isIdentifier( memberExpression.property ) && memberExpression.property.name === 'map' ) {
				// Add the before / after tags to the list.
				const objectName = memberExpression.object.name;

				if ( this.vars.toTag[ objectName ] ) {
					// Inject list context to components inside the map
					// injectContextToJSXElementComponents( subPath, contextIdentifier.name, types );
				
					const listVarSourceName = this.vars.toTag[ objectName ];
					const listOpen = getLanguageListCallExpression( 'open', listVarSourceName, this.contextName, types );
					const listClose = getLanguageListCallExpression( 'close', listVarSourceName, this.contextName, types );
					path.insertBefore( listOpen );
					path.insertAfter( listClose );
				}
			}
		}
	}
};

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
				// let x; x = 'prefix-' + ( test ? 'a' : 'b' ) + '-suffix';
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


const templateVarsController = {
	babel: {},
	vars: {
		replace: {},
		control: {},
		list: {},
	},
	contextIdentifier: null,
	init: function( templateVars, componentPath, babel ) {
		this.babel = babel;
		const { types, parse } = babel;
		// Get the three types of template vars.
		const { replace: replaceVars, control: controlVars, list: listVars } = templateVars;

		// Build the map of vars to replace.
		const replaceVarsParsed = generateVarTypeUids( componentPath.scope, replaceVars );
		this.vars.replace = {
			raw: replaceVars,
			mapped: replaceVarsParsed[0],
			mapInv: Object.fromEntries(Object.entries(replaceVarsParsed[0]).map(a => a.reverse())),
			names: replaceVarsParsed[1],
		}
		//replaceVarsInv

		// Get the control vars names
		const [ controlVarsMap, controlVarsNames ] = generateVarTypeUids( componentPath.scope, controlVars );
		this.vars.control = {
			raw: controlVars,
			mapped: controlVarsMap,
			names: controlVarsNames,
		}

		// Build the map of var lists.
		const [ listVarsMap, listVarsNames ] = generateVarTypeUids( componentPath.scope, listVars );
		this.vars.list = {
			raw: listVars,
			mapped: listVarsMap,
			names: listVarsNames,
			toTag: {},
		}
		
		
		// All the list variable names we need to look for in JSX expressions
		const self = this;
		// Start the main traversal of component

		// TODO - we should look through the params and apply the same logic...
		const componentParam = componentPath.node.declarations[0].init.params[0];

		let propsName = null;
		// If the param is an object pattern, we want to add `__context__` as a property to it.
		if ( componentPath.node.declarations[0].init.params.length === 0 ) {
			// Then there are no params, so lets add an object pattern with one param, __context__.
			componentPath.node.declarations[0].init.params.push( types.objectPattern( [ types.objectProperty( types.identifier( '__context__' ), types.identifier( '__context__' ), false, true ) ] ) );
		} else if ( types.isObjectPattern( componentParam ) ) {
			// Then we at the first param - which is *probably* props passed through as an object.
			// For now lets assume it is, but this means we likely can't work with HOC components which have multiple params.
			// TODO - maybe we should test again the last param as it is usually the props object in HOCs.

			// Add __context__ as a property to the object.
			componentParam.properties.push( types.objectProperty( types.identifier( '__context__' ), types.identifier( '__context__' ), false, true ) );
		} else if ( types.isIdentifier( componentParam ) ) {
			// If it's an identifier we need to declare it in the block statement.
			propsName = componentParam.name;
		}

		this.contextIdentifier = componentPath.scope.generateUidIdentifier("uid");
		let blockStatementDepth = 0; // make sure we only update the correct block statement.

		const replaceController = new ReplaceController( this.vars.replace, babel );
		const listController = new ListController( this.vars.list, this.contextIdentifier.name, babel );
		const controlController = new ControlController( this.vars.control, this.contextIdentifier.name, babel );
	

		componentPath.traverse( {
			// Inject context into all components
			JSXElement(subPath){
				// If we find a JSX element, check to see if it's a component,
				// and if so, inject a `__context__` JSXAttribute.
				if ( isJSXElementComponent( subPath ) ) {
					let expression;
					// check if the component is inside a `map` and increase the context by 1
					if ( parentPathHasMap( subPath, types ) ) {
						expression = types.binaryExpression( '+', self.contextIdentifier, types.numericLiteral( 1 ) );
					} else {
						expression = types.identifier( self.contextIdentifier.name );
					}
					const contextAttribute = types.jSXAttribute( types.jSXIdentifier( '__context__' ), types.jSXExpressionContainer( expression ) );
					subPath.node.openingElement.attributes.push( contextAttribute );
				}

				/**
				 * We also need to track some special exceptions to html elements. 
				 * Because the idea of this transform is that the rendered html is later scraped and saved to a file,
				 * we need to work around some known browser rendering "bugs".
				 */
				/**
				 * Chrome (and other browsers) will not add an accurate `value` attribute to <input> (text) elements,
				 * They are usually moved to the shadow dom, which means when we scrape the page, anything in `value`
				 * will be lost. 
				 * eg:
				 * <input value="test" />
				 * would become:
				 * <input />
				 *
				 * Our workaround will be to copy the value attribute, to a custom attribute with the prefix `jsxtv_`.
				 * When we later scrape this page, it will then need to be converted back to the correct html attribute.
				 */

				if ( isJSXElementTextInput( subPath ) ) {
					// Now get the value attribute from the jsx element.
					const valueAttribute = subPath.node.openingElement.attributes.find( attr => attr?.name?.name === 'value' );

					if ( valueAttribute ) {
						// Create a new attribute `jsxtv_value` and copy the value from the valueAttribute
						const jsxtValueAttribute = types.jSXAttribute( types.jSXIdentifier( 'jsxtv_value' ), valueAttribute.value );

						// And add it to the existing attributes.
						subPath.node.openingElement.attributes.push( jsxtValueAttribute );
					}

				}

			},
			BlockStatement( statementPath ) {
				// TODO: Hacky way of making sure we only catch the first block statement - we should be able to check
				// something on the parent to make this more reliable.
				if ( blockStatementDepth !== 0 ) {
					return;
				}
				blockStatementDepth++;

				// Add replace vars to path.
				replaceController.initVars( self.contextIdentifier.name, statementPath );
				// Add list vars to path.
				listController.initVars( statementPath );
				
				
				// Figure out if we need to add a __context__ variable to the local scope.
				const nodesToAdd = [];
				if ( propsName ) {
					nodesToAdd.push( parse(`let ${ self.contextIdentifier.name } = typeof ${ propsName }.__context__ === 'number' ? ${ propsName }.__context__ : 0;` ) );
				} else {
					nodesToAdd.push( parse(`let ${ self.contextIdentifier.name } = typeof __context__ === 'number' ? __context__ : 0;` ) );
				}
				nodesToAdd.reverse();
				nodesToAdd.forEach( ( node ) => {
					statementPath.node.body.unshift( node );
				} );
			},
			Identifier( subPath ) {

				// Update and Ternary conditions before parsing the other var types (so we can use their names
				// before they're updated).
				controlController.updateTernaryConditions( subPath );
				
				// Now replace any replace or list vars identifier names with the new ones
				// we created earlier.
				replaceController.updateIdentifierNames( subPath );
				listController.updateIdentifierNames( subPath );
			},
			// Track vars in JSX expressions in case we need have any control vars to process
			JSXExpressionContainer( subPath ) {
				const { expression: containerExpression } = subPath.node;

				// Update any control vars in expressions in JSX
				controlController.updateJSXExpressions( containerExpression, subPath, self.vars.list.toTag );

				// And tag and update any list vars in we find in JSX
				listController.updateJSXListExpressions( containerExpression, subPath );
			},
		} );
	}
}



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

// check if any parent paths contain a map call
function parentPathHasMap( path, types ) {
	let parentPath = path.parentPath;
	while ( parentPath ) {
		if ( types.isCallExpression( parentPath.node ) && types.isMemberExpression( parentPath.node.callee ) ) {
			const memberExpression = parentPath.node.callee;
			if ( types.isIdentifier( memberExpression.property ) && memberExpression.property.name === 'map' ) {
				return true;
			}
		}
		parentPath = parentPath.parentPath;
	}
	return false;
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
function getLanguageListCallExpression( action, name, context, types ) {
	const nameObject = types.objectExpression( [
		types.objectProperty( types.identifier('type'), types.stringLiteral( 'identifier' ) ),
		types.objectProperty( types.identifier('value'), types.stringLiteral( name ) ),
	] );
	return types.callExpression( types.identifier( 'getLanguageList' ), [ types.stringLiteral( action ), nameObject, types.identifier( context ) ] );
}

module.exports = templateVarsController;
