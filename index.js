/**
 * Generates a Handlebars ready version of a JSX app for processing server side for achieving SSR.
 *
 * Works by replacing variables throughout a component with Handlebars tags.
 *
 * Add `templateVars` to a component definition to specify which props are dynamic and need
 * to be exposed as Handlebars tags - to later be rendered with data from a server.
 *
 * Currently supports three types of variables:
 *
 * - *replace* - assumes the variable needs to be replaced with a template tag like `{{name}}`
 * - *control* - a variable that controls output/generated html (such as showing/hiding content)
 *             - limited to variables used in JSX expressions - `{ isSelected && <> ... </> }`
 * Working on:
 * - *list*    - lists signify repeatable content and will add list tags to the html output
 *
 * ----
 *
 * Outline
 * - Look for `templateVars`
 * - Categorise into types (replace, control, list)
 * - Locate + visit the component definition - assumes it is the previous path ( sibling ( -1 ) ).
 *
 * Process "replace" type vars
 * - Declare new identifiers (with new values) for all `replace` type template props at the top of the component
 * - Replace occurences of the old identifiers with the new ones
 *   (exclude variable declarations and watch out for nested props)
 *
 * Process "control" type vars
 * - Look for the template var in JSX expressions (TODO: support more expression types)
 * - Remove the condition so the expression is always completed (showing the related JSX)
 * - Wrap JSX in handlebars tags using custom helpers to recreate the conditions
 * 
 * Process "list" type vars
 * - Declare new arrays with a template style version - eg `[ '{{.}}' ]` or `[ { value: '{{value}}', label: '{{label}}' } ]`
 *   for objects. 
 * - The new arrays will always have a length of 1.
 * - Look for any member expressions in the component definition that use the identifier + a `.map()` and track the new
 *   identifier name / assignment as well as the original identifier name.
 * - Look for the list vars (and any new identifiers from an earlier `.map()`) in JSX expressions - either on their
 *   own as an identifier or combined with `.map()` and wrap them in template tags.
 * - Also check for any control variables in JSX expressions which use list variables on the right of the experssion
 *   and wrap them in template tags.
  */
const { getLanguageList, getLanguageReplace, getLanguageControl, registerLanguage } = require('./language');
const {
	getExpressionSubject,
	getArrayFromExpression,
	getObjectFromExpression,
	getNameFromNode,
} = require( './utils' );

/**
 * Ensure the config prop is an array of two elements, with the first item being the var name and the second being the var config.
 * 
 * @param {Array|String} prop - The prop to normalise
 * @returns 
 */
function normaliseConfigProp( prop ) {
	if ( ! Array.isArray( prop ) ) {
		return [ prop, {} ];
	}
	return prop;
}

const defaultLanguage = 'handlebars';
/**
 * Gets the template vars from the property definition.
 * 
 * @param {Object} expression The expression
 * @param {Object} t The babel types object
 * 
 * @returns 
 */
function getTemplateVarsFromExpression( expression, t ) {
	const left = expression.left;
	const right = expression.right;
	if ( ! left || ! right ) {
		return false;
	}

	const { object, property } = left;
	// Make sure the property being set is `templateVars`
	if ( ! t.isIdentifier( object ) ) {
		return false;
	}
	if ( ! t.isIdentifier( property ) ) {
		return false;
	}

	const objectName = object.name;
	const propertyName = property.name;

	if ( propertyName === 'templateVars' ) {
		let templatePropsValue = [];
		// Now process the right part of the expression 
		// .templateVars = *right* and build our config object.
		if ( right && right.type === 'ArrayExpression' ) {
			// Then we have an array to process the props.
			templatePropsValue = getArrayFromExpression( right );
		}
		const templateVars = {
			replace: [],
			control: [],
			list: [],
		}

		// Build template prop queues for processing at different times.
		templatePropsValue.forEach( ( prop ) => {
			const normalisedProp = normaliseConfigProp( prop );
			const [ varName, varConfig ] = normalisedProp;

			// If the type is not set assume it is `replace`
			if ( varConfig.type === 'replace' || ! varConfig.type ) {
				templateVars.replace.push( normalisedProp );
			} else if ( varConfig.type === 'control' ) {
				templateVars.control.push( normalisedProp );
			} else if ( varConfig.type === 'list' ) {
				templateVars.list.push( normalisedProp );
			}
			
		} );
		return templateVars;
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

const normaliseListVar = ( varConfig ) => {
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
// Build the object for the replacement var in list type vars.
function buildListVarDeclaration( varName, varConfig, t, language ) {
	const normalisedConfig = normaliseListVar( varConfig );
	const { type, props } = normalisedConfig.child;

	const newProp = [];
	if ( type === 'object' ) {
		const childProp = {};
		const propsArr = [];
		props.forEach( ( propName ) => {
			const listObjectString = getLanguageList( language, 'formatObject', propName );
			propsArr.push( t.objectProperty( t.identifier( propName ), t.stringLiteral( listObjectString ) ) );
		} );
		newProp.push( childProp );
		const templateObject = t.objectExpression( propsArr )
		const right = t.arrayExpression( [ templateObject ] );
		
		const left = t.identifier( varName );
		return t.variableDeclaration('let', [
			t.variableDeclarator(left, right),
		]);
	} else if ( type === 'primitive' ) {
		// Then we're dealing with a normal array.
		// TODO: maybe "primitive" is not the best name for this type.
		const listPrimitiveString = getLanguageList( language, 'formatPrimitive' );
		const right = t.arrayExpression( [ t.stringLiteral( listPrimitiveString ) ] );
		const left = t.identifier( varName );
		return t.variableDeclaration('let', [
			t.variableDeclarator(left, right),
		]);
	}
	return null;
}

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

/**
 * The main visitor for the plugin.
 * 
 * @param {Object} param0 Babel instance.
 * @param {Object} config Plugin config.
 * @returns 
 */
function templateVarsVisitor( { types: t, traverse, parse }, config ) {
	const tidyOnly = config.tidyOnly ?? false;
	const language = config.language ?? defaultLanguage;
	if ( config.customLanguage ) {
		registerLanguage( config.customLanguage );
	}
	return { 
		ExpressionStatement( path, state ) {
			// Try to look for the property assignment of `templateVars` and:
			// - Process the template vars for later
			// - Remove `templateVars` from the source code
			
			const { expression } = path.node;
			
			// Process the expression and get template vars as an object
			const templateVars = getTemplateVarsFromExpression( expression, t );
			if ( ! templateVars ) {
				return;
			}
			// Get the previous sibling before the current path is removed.
			const componentPath = path.getSibling( path.key - 1 );
			
			// Remove templateVars from the source
			path.remove();

			// If tidyOnly is set, exit here (immediately after the removal of the templateVars).
			if ( tidyOnly ) {
				return;
			}

			// Get the three types of template vars.
			const { replace: replaceVars, control: controlVars, list: listVars } = templateVars;

			// Build the map of vars to replace.
			const [ replaceVarsMap, replaceVarsNames ] = generateVarTypeUids( componentPath.scope, replaceVars );
			// Get the control vars names
			const [ controlVarsMap, controlVarsNames ] = generateVarTypeUids( componentPath.scope, controlVars );
			// Build the map of var lists.
			const [ listVarsMap, listVarsNames ] = generateVarTypeUids( componentPath.scope, listVars );
			
			// All the list variable names we need to look for in JSX expressions
			let listVarsToTag = {};

			let blockStatementDepth = 0; // make sure we only update the correct block statement.
			// Start the main traversal of component
			componentPath.traverse( {
				/*ReturnStatement( subPath ) {
				},*/
				/*JSXElement(subPath){ 
				},
				JSXOpeningElement( subPath ) {
				},
				JSXIdentifier( subPath ) {
				},*/
				/*JSXIdentifier( subPath ) {
				},*/
				/*ExpressionStatement( subPath ) {
					// Check if the expression is a control expression.
				},*/
				BlockStatement( statementPath ) {
					// Hacky way of making sure we only catch the first block statement - we should be able to check
					// something on the parent to make this more reliable.
					if ( blockStatementDepth !== 0 ) {
						return;
					}
					blockStatementDepth++;

					// Add the new replace vars to to top of the block statement.
					replaceVars.forEach( ( templateVar ) => {
						const [ varName, varConfig ] = templateVar;
						// Alway declare as `let` so we don't need to worry about its usage later.
						//statementPath.node.body.unshift( parse(`let ${ replaceVarsMap[ varName ] } = '{{${ varName }}}';`) );
						const replaceString = getLanguageReplace( language, 'format', varName );
						statementPath.node.body.unshift( parse(`let ${ replaceVarsMap[ varName ] } = '${ replaceString }';`) );
					} );
					// Add the new list vars to to top of the block statement.
					listVars.forEach( ( templateVar, index ) => {
						const [ varName, varConfig ] = templateVar;
						// Alway declare as `let` so we don't need to worry about its usage later.
						const newAssignmentExpression = buildListVarDeclaration( listVarsMap[ varName ], varConfig, t, language );
						if ( newAssignmentExpression ) {
							statementPath.node.body.unshift( newAssignmentExpression );
						}

						// Now keep track of the list vars and aliaes we need to tag (and keep track of their original source var)
						listVarsToTag[ varName ] = varName;
						if ( varConfig.aliases ) {
							varConfig.aliases.forEach( ( alias ) => {
								listVarsToTag[ alias ] = varName;
							} );
						}
		
					} );
				},
				Identifier( subPath ) {
					// We need to update all the identifiers with the new variables declared in the block statement
					if ( replaceVarsNames.includes( subPath.node.name ) ) {
						// Make sure we only replace identifiers that are not props and also that
						// they are not variable declarations.
						const excludeTypes = [ 'ObjectProperty', 'MemberExpression', 'VariableDeclarator', 'ArrayPattern' ];
						if ( subPath.parentPath.node && ! excludeTypes.includes( subPath.parentPath.node.type ) ) {
							subPath.node.name = replaceVarsMap[ subPath.node.name ];
						}
					}
					
					// We also need to replace any lists / arrays with our own templatevars version.
					if ( listVarsNames.includes( subPath.node.name ) ) {
						const sourceVarName = subPath.node.name;
						// Make sure we only replace identifiers that are not props and also that
						// they are not variable declarations.
						const excludeTypes = [ 'ObjectProperty', 'VariableDeclarator', 'ArrayPattern' ];
						if ( subPath.parentPath.node && ! excludeTypes.includes( subPath.parentPath.node.type ) ) {
							// We want to only allow one case of a member expression when we find a `const x = y.map(...);`
							if ( t.isMemberExpression( subPath.parentPath.node ) ) {
								// then we want to make sure its a `.map` otherwise we don't want to support it for now.
								if ( t.isIdentifier( subPath.parentPath.node.property ) && subPath.parentPath.node.property.name === 'map' ) {
									subPath.node.name = listVarsMap[ subPath.node.name ];
									// If we found a map, we want to track which identifier it was assigned to...
									if ( t.isCallExpression( subPath.parentPath.parentPath.node ) && t.isVariableDeclarator( subPath.parentPath.parentPath.parentPath.node ) ) {
										// Check if its an identifier and if so, add it to the listVars to tag.
										if ( t.isIdentifier( subPath.parentPath.parentPath.parentPath.node.id ) ) {
											const identifierName = subPath.parentPath.parentPath.parentPath.node.id.name;
											listVarsToTag[ identifierName ] = sourceVarName;
										}
									}
								}
							} else {
								subPath.node.name = listVarsMap[ subPath.node.name ];
							}
						}
					}
				},
				// Track vars in JSX expressions in case we need have any control vars to process
				JSXExpressionContainer( subPath ) {
					const { expression: containerExpression } = subPath.node;
					if ( isControlExpression( containerExpression ) ) {
						const expressionSubject = getExpressionSubject( containerExpression );
						const expression = containerExpression.left;
						// const condition = getCondition( containerExpression );
						if ( controlVarsNames.includes( expressionSubject ) ) {

							let statementType;
							let expressionValue = '';

							// Lets start by only supporting:
							// truthy - `myVar && <>...</>`
							// falsy - `! myVar && <>...</>`
							// equals - `myVar === 'value' && <>...</>`
							// not equals - `myVar !== 'value' && <>...</>`
							// map these to handlebars helper functions and replace the expression with the helper tag.

							if ( expression.type === 'Identifier' ) {
								statementType = 'ifTruthy';
							} else if ( expression.type === 'UnaryExpression' ) {
								if ( expression.operator === '!' ) {
									statementType = 'ifFalsy';
								}
							} else if( expression.type === 'BinaryExpression' ) {
								if ( expression.operator && expression.right.value ) {
									if ( expression.operator === '===' ) {
										statementType = 'ifEqual';
									} else if ( expression.operator === '!==' ) {
										statementType = 'ifNotEqual';
									}
									// Add quotes around the value to signify its a string.
									expressionValue = `"${ expression.right.value }"`;
								}
							}

							if ( statementType ) {
								// Build the opening and closing expression tags.
								const expressionArgs = [ expressionSubject ];
								if ( expressionValue ) {
									expressionArgs.push( expressionValue );
								}
								const controlStartString = getLanguageControl( language, [ statementType, 'open' ], expressionArgs );
								const controlStopString = getLanguageControl( language, [ statementType, 'close' ], expressionArgs );
								subPath.insertBefore( t.stringLiteral( controlStartString ) );
								subPath.insertAfter( t.stringLiteral( controlStopString ) );

								// Now check to see if the right of the expression is a list variable, as we need to wrap them
								// in helper tags.
								if ( t.isIdentifier( containerExpression.right ) ) {
									const objectName = containerExpression.right.name;
									if ( listVarsToTag[ objectName ] ) {
										const listOpen = getLanguageList( language, 'open', listVarsToTag[ objectName ] );
										const listClose = getLanguageList( language, 'close', listVarsToTag[ objectName ] );
			
										subPath.insertBefore( t.stringLiteral( listOpen ) );
										subPath.insertAfter( t.stringLiteral( listClose ) );
									}
								}
								
								// Now replace the whole expression with the right part (remove any conditions to display it)
								subPath.replaceWith( containerExpression.right );
							}
						}
					}

					// Now look for identifers only, so we can look for list vars that need tagging.
					if ( t.isIdentifier( containerExpression ) ) {
						// Then we should be looking at something like: `{ myVar }`
						if ( listVarsToTag[ containerExpression.name ] ) {
							
							const listOpen = getLanguageList( language, 'open', listVarsToTag[ containerExpression.name ] );
							const listClose = getLanguageList( language, 'close', listVarsToTag[ containerExpression.name ] );

							subPath.insertBefore( t.stringLiteral( listOpen ) );
							subPath.insertAfter( t.stringLiteral( listClose ) );
						}
					}

					// Also, lets support list vars that have .map() directly in the JSX (ie, they are not re-assigned to variable before being added to the output)
					if ( t.isCallExpression( containerExpression ) && t.isMemberExpression( containerExpression.callee ) ) {
						const memberExpression = containerExpression.callee;
						if ( t.isIdentifier( memberExpression.property ) && memberExpression.property.name === 'map' ) {
							const objectName = memberExpression.object.name;
							if ( listVarsToTag[ objectName ] ) {
								const listOpen = getLanguageList( language, 'open', listVarsToTag[ objectName ] );
								const listClose = getLanguageList( language, 'close', listVarsToTag[ objectName ] );

								subPath.insertBefore( t.stringLiteral( listOpen ) );
								subPath.insertAfter( t.stringLiteral( listClose ) );
							}
						}
					}
				}
			} );
		}
	}
};

module.exports = ( babel, config ) => {
	return {
		name: "template-vars-plugin",
		visitor: {
			Program( programPath ) {
				programPath.traverse( templateVarsVisitor( babel, config ) );
			},
		}
	};
};
