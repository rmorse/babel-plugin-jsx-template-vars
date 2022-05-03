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
 * Process "list" type vars - in progress
 */
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

/**
 * Gets the template vars from the property definition.
 * 
 * @param {Object} expression 
 * @returns 
 */
function getTemplatePropsFromExpression( expression ) {
	const left = expression.left;
	const right = expression.right;
	if ( ! left || ! right ) {
		return false;
	}

	const { object, property } = left;
	// Make sure the property being set is `templateVars`
	if ( object?.type !== 'Identifier' ) {
		return false;
	}
	if ( property?.type !== 'Identifier' ) {
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
			const [ propName, propConfig ] = normalisedProp;

			// If the type is not set assume it is `replace`
			if ( propConfig.type === 'replace' || ! propConfig.type ) {
				templateVars.replace.push( normalisedProp );
			} else if ( propConfig.type === 'control' ) {
				templateVars.control.push( normalisedProp );
			} else if ( propConfig.type === 'list' ) {
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

/**
 * Generate new uids for the current scope.
 * 
 * @param {Object} scope The current scope.
 * @param {Object} vars The vars to generate uids for.
 * @returns 
 */
function generateVarTypeUids( scope, vars ) {
	const varMap = {};
	const varNames = [];
	vars.forEach( ( [ varName, propConfig ] ) => {
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
	return { 
		ExpressionStatement( path, state ) {
			// Try to look for the property assignment of `templateVars` and:
			// - Process the template vars for later
			// - Remove `templateVars` from the source code

			const { expression } = path.node;
			
			// Process the expression and get template vars as an object
			const templateVars = getTemplatePropsFromExpression( expression );
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
			const [ replacePropsMap, replacePropNames ] = generateVarTypeUids( componentPath.scope, replaceVars );
			// Build the map of var controls.
			const [ controlPropsMap, controlPropNames ] = generateVarTypeUids( componentPath.scope, controlVars );
			// Build the map of var lists.
			const [ listPropsMap, listPropNames ] = generateVarTypeUids( componentPath.scope, listVars );

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
				BlockStatement( statementPath ) {
					// Add the new vars to to top of the function
					replaceVars.forEach( ( prop ) => {
						const [ propName, propConfig ] = prop;
						// Alway declare as `let` so we don't need to worry about its usage later.
						statementPath.node.body.unshift( parse(`let ${ replacePropsMap[ propName ] } = '{{${ propName }}}';`) );
					} );
				
				},
				Identifier( subPath ) {
					// We need to update all the identifiers with the new variables declared in the block statement
					if ( replacePropNames.includes( subPath.node.name ) ) {
						// Make sure we only replace identifiers that are not props and also that
						// they are not variable declarations.
						const excludeTypes = [ 'ObjectProperty', 'MemberExpression', 'VariableDeclarator' ];
						if ( subPath.parentPath.node && ! excludeTypes.includes( subPath.parentPath.node.type ) ) {
							subPath.node.name = replacePropsMap[ subPath.node.name ];
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
						console.log( "expression", expressionSubject, expression.type );
						if ( controlPropNames.includes( expressionSubject ) ) {

							let expressionOperator;
							let expressionValue = '';

							// Lets start by only supporting:
							// truthy - `myVar && <>...</>`
							// falsy - `! myVar && <>...</>`
							// equals - `myVar === 'value' && <>...</>`
							// not equals - `myVar !== 'value' && <>...</>`
							// map these to handlebars helper functions and replace the expression with the helper tag.

							if ( expression.type === 'Identifier' ) {
								expressionOperator = 'if_truthy';
							} else if ( expression.type === 'UnaryExpression' ) {
								if ( expression.operator === '!' ) {
									expressionOperator = 'if_falsy';
								}
							} else if( expression.type === 'BinaryExpression' ) {
								if ( expression.operator && expression.right.value ) {
									if ( expression.operator === '===' ) {
										expressionOperator = 'if_equal';
									} else if ( expression.operator === '!==' ) {
										expressionOperator = 'if_not_equal';
									}
									expressionValue = expression.right.value;
								}
							}

							if ( expressionOperator ) {
								let templateExpression = `#${ expressionOperator } ${ expressionSubject }`;
								if ( expressionValue ) {
									templateExpression += ` "${ expressionValue }"`;
								}
								subPath.insertBefore( t.stringLiteral(`{{${ templateExpression }}}` ) );
								subPath.insertAfter( t.stringLiteral(`{{/${ expressionOperator }}}` ) );
								subPath.replaceWith( containerExpression.right );
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
