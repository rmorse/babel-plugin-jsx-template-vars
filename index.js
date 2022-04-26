/**
 * Generates a Mustache ready version of a JSX app for processing server side for achieving SSR.
 *
 * Works by replacing variables throughout a component with Mustache tags.
 *
 * Add `templateVars` to a component definition to specify which props are dynamic and need
 * to be exposed as Mustache tags - to later be rendered with data from a server.
 *
 * Currently supports three types of variables:
 *
 * - *replace* - assumes the variable needs to be replaced with a template tag like `{{name}}`
 *
 * Working on:
 * - *control* - a variable that controls output/generated html (such as showing/hiding content)
 *             - limited to variables used in JSX expressions - `{ isSelected && <> ... </> }`
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
 * - Replace occurences of the old identifiers with the new ones, so they are in effect replaced
 *   (exclude variable declarations and watch out for nested props)
 *
 * Process "control" type vars - in progress
 * - Look for the template var in JSX expressions (TODO: support more expression types
 * - Remove the condition so the expression is always completed (showing the related JSX)
 * - Wrap JSX in mustache tags... and try to recreate the condition in Mustache?
 * 
 *  * Process "list" type vars - todo...
 */
const {
	getExpressionSubject,
	getArrayFromExpression,
	getObjectFromExpression,
	getNameFromNode,
} = require( './utils' );

function normaliseConfigProp( prop ) {
	if ( ! Array.isArray( prop ) ) {
		return [ prop, {} ];
	}
	return prop;
}
function getConfigPropName( prop ) {
	if ( Array.isArray( prop ) && prop.length === 2 ) {
		return prop[0];
	} else {
		return prop;
	}
}
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

// 
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

function templateVarsVisitor( { types: t, traverse, parse }, config ) {
	const tidyOnly = config.tidyOnly ?? false;
	return { 
		ExpressionStatement( path, state ) {
			// Try to look for the property assignment of `templateVars` and:
			// - Process the template vars for later
			// - Remove `templateVars` from the source code

			const { expression } = path.node;
			
			// Process the expression and get template props as an object
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
			//const [ listPropsMap, listPropNames ] = generateVarTypeUids( statementPath.scope, listVars );

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
						// Make sure we only replace identifiers that are not prop and also that
						// they are not variable declarations.
						// const includeTypes = [ 'UnaryExpression', 'BinaryExpression' ];
						const excludeTypes = [ 'ObjectProperty', 'MemberExpression', 'VariableDeclarator' ];
						
						if ( subPath.parentPath.node && ! excludeTypes.includes( subPath.parentPath.node.type ) ) {
							subPath.node.name = replacePropsMap[ subPath.node.name ];
						}
					}

				},
				// Track vars in JSX expressions in case we need have any control vars to process
				JSXExpressionContainer( subPath ) {
					const { expression } = subPath.node;
					if ( isControlExpression( expression ) ) {
						const expressionSubject = getExpressionSubject( expression );
						// console.log( "expression subject", expressionSubject );
						if ( controlPropNames.includes( expressionSubject ) ) {
							subPath.insertBefore( t.stringLiteral(`{{#BEFORE}}` ) );
							subPath.insertAfter( t.stringLiteral(`{{/AFTER}}` ) );
							subPath.replaceWith( expression.right );
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
