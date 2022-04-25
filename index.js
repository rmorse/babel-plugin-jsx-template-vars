/*
Generates a Mustache ready version of a JSX app for processing server side for achieving SSR.

Works by replacing variables throughout a component with Mustache tags.

Add `templateProps` to a component definition to specify which props are dynamic and need
to be exposed as Mustache tags - to later be rendered with data from a server.

Currently supports three types of variables:

- *replace* - assumes the variable needs to be replaced with a template tag like `{{name}}`

Working on:
- *control* - a variable that controls output/generated html (such as showing/hiding content)
			- limited to variables used in JSX expressions - `{ isSelected && <> ... </> }`
- *list* 	- lists signify repeatable content and will add list tags to the html output

----

Outline
	- Look for `templateProps` //TODO - rename to `templateVars`
	- Categorise into types (replace, control, list)
	- Locate + visit the component definition - currently assumes it is the previous path ( sibling ( -1 ) ).

	Process "replace" type vars
	- Declare new identifiers (with new values) for all `replace` type template props 
		at the top of the component
	- Replace occurences of the old identifiers with the new ones so they
		can be used instead (exclude variable declarations, watch out for nested props)

	Process "control" type vars - in progress
	- Look for the template var in JSX expressions (TODO: support more expression types)
	- Remove the condition so the expression is always completed (showing the related JSX)
	- Wrap JSX in mustache tags... and try to recreate the condition in Mustache?
*/
const TEMPLATE_PROPS_COMMENT_ID = 'Template Props:';

// Keep track of the funtion declarations, so we can easily look them up
// later once we've found `templateProps`
const buildAssignment = (left, right, t) => {
	return t.assignmentExpression("=", left, right);
}
const getObjectFromExpression = ( expression ) => {
	let obj = {};
	expression.properties.forEach( ( property ) => {
			if ( property.value.value ) {
				obj[ property.key.name ] = property.value.value;
			} else if ( property.value.elements ) {
				obj[ property.key.name ] = getArrayFromExpression( property.value );
			} else if ( property.value.properties ) {
				obj[ property.key.name ] = getObjectFromExpression( property.value );
			}
	} );
	return obj;
}
const getArrayFromExpression = ( expression ) => {
	const props = [];
	if ( expression && expression.elements ) {
		expression.elements.forEach( ( element ) => {
			if ( element.type === 'StringLiteral' ) {
				props.push( element.value );
			}
			if ( element.type === 'ArrayExpression' ) {
				// We have an object to process
				if ( element.elements ) {
					const prop = getArrayFromExpression( element );
					props.push( prop );
				}
			}
			else if ( element.type === 'ObjectExpression' ) {
				// We have an object to process
				const prop = getObjectFromExpression( element );
				props.push( prop );
			}
		} );
	}
	return props;
};

const createPropValue = ( name, config, t ) => {
	let newPropVar;
	if ( ! config || ! config.type || config.type === 'string' ) {
		newPropVar = t.stringLiteral(`{{${ name }}}` );
	}
	else if ( config.type === 'array' ) {
		const { type, props } = config.child;
		const newProp = [];
		if ( type === 'object' ) {
			const childProp = {};
			const propsArr = [];
			props.forEach( ( propName ) => {
				propsArr.push( t.objectProperty( t.identifier( propName ), t.stringLiteral( `{{${ propName }}}` ) ) );
			} );
			newProp.push( childProp );
			const templateObject = t.objectExpression( propsArr )
			newPropVar = t.arrayExpression( [ templateObject ] );
		}
	}
	
	return newPropVar;
};


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
	// Make sure the property being set is `templateProps`
	if ( object?.type !== 'Identifier' ) {
		return false;
	}
	if ( property?.type !== 'Identifier' ) {
		return false;
	}

	const objectName = object.name;
	const propertyName = property.name;

	if ( propertyName === 'templateProps' ) {
		let templatePropsValue = [];
		// Now process the right part of the expression 
		// .templateProps = *right* and build our config object.
		if ( right && right.type === 'ArrayExpression' ) {
			// Then we have an array to process the props.
			templatePropsValue = getArrayFromExpression( right );
		}
		const templateProps = {
			replace: [],
			control: [],
			list: [],
		}

		// Build template prop queues for processing at different times.
		templatePropsValue.forEach( ( prop ) => {
			const normalisedProp = normaliseConfigProp( prop );
			const [ propName, propConfig ] = normalisedProp;

			if ( propConfig.type === 'replace' || ! propConfig.type ) {
				templateProps.replace.push( normalisedProp );
			} else if ( propConfig.type === 'control' ) {
				templateProps.control.push( normalisedProp );
			} else if ( propConfig.type === 'list' ) {
				templateProps.listvl.push( normalisedProp );
			}
			
		} );
		return templateProps;
	}
	return false;
}

function getNameFromNode( node ) {
	if ( node.type === 'Identifier' ) {
		return node.name;
	} else if ( node.type === 'MemberExpression' ) {
		return `${ node.object.name }.${ node.property.name }`;
	}
	return false;
}

// TODO - this could be made recursive by checking for the existence of 
// expression.left and if so processing the new prop "left"
// TODO - We're not taking into consideration the "right" part of the expression,
// which could also contain the subject we're after (should it return an array?)
// so this limits us to only looking at the left part of the expression (our
// template vars must be on the left)
//  * this might only apply in BinaryExpression's
function getExpressionSubject( expression ) {
	if ( expression.left.type === 'MemberExpression' ) {
		return getNameFromNode( expression.left );
	} else if ( expression.left.type === 'Identifier' ) {
		return getNameFromNode( expression.left );
	} else if ( expression.left.type === 'UnaryExpression' ) {
		return getNameFromNode( expression.left.argument );
	} else if ( expression.left.type === 'BinaryExpression' ) {
		// `! isChecked === 'yes' ...`
		if ( expression.left.left.type === 'UnaryExpression' ) {
			return getExpressionSubject( expression.left );
		}
		// `isChecked === 'yes' ...`
		return getNameFromNode( expression.left.left );
	} else {
	}
	return null;
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
const templateVarsVisitor = ( { types: t, traverse, parse }, config ) => {
	const tidyOnly = config.tidyOnly ?? false;
	return { 
		ExpressionStatement( path, state ) {
			// Try to look for the property assignment of `templateProps` and:
			// - Process the template vars for later
			// - Remove `templateProps` from the source code

			const { expression } = path.node;
			
			// Process the expression and get template props as an object
			const templateProps = getTemplatePropsFromExpression( expression );
			if ( ! templateProps ) {
				return;
			}

			// Get the previous sibling before the current path is removed.
			const componentPath = path.getSibling( path.key - 1 );
			
			// Remove templateProps from the source
			path.remove();

			// If tidyOnly is set, exit here (immediately after the removal of the templateProps).
			if ( tidyOnly ) {
				return;
			}

			// Get the three types of template vars.
			const { replace: replaceVars, control: controlVars, list: listVars } = templateProps;

			// Build the map of props to replace.
			const replacePropsMap = {};
			const replacePropNames = [];
			replaceVars.forEach( ( [ propName, propConfig ] ) => {
				const newIdentifier = path.scope.generateUidIdentifier("uid");
				replacePropsMap[ propName ] = newIdentifier.name;
				replacePropNames.push( propName );
			} );

			// Build the map of props to replace.
			const controlPropsMap = {};
			const controlPropNames = [];
			controlVars.forEach( ( [ propName, propConfig ] ) => {
				const newIdentifier = path.scope.generateUidIdentifier("uid");
				controlPropsMap[ propName ] = newIdentifier.name;
				controlPropNames.push( propName );
			} );


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
				BlockStatement( subPath ) {
					// Add the new vars to to top of the function
					replaceVars.forEach( ( prop ) => {
						const [ propName, propConfig ] = prop;
						// Alway declare as `let` so we don't need to worry about its usage later.
						subPath.node.body.unshift( parse(`let ${ replacePropsMap[ propName ] } = '{{${ propName }}}';`) );
					} );
				},
				Identifier( subPath ) {
					// We need to update all the identifiers with the new variables declared in the block statement
					if ( replacePropNames.includes( subPath.node.name ) ) {
						// Make sure we only replace identifiers that are not prop and also that
						// they are not variable declarations.
						// const includeTypes = [ 'UnaryExpression', 'BinaryExpression' ];
						const excludeTypes = [ 'ObjectProperty', 'MemberExpression' ];
						if ( subPath.parentPath.node && ! excludeTypes.includes( subPath.parentPath.node.type ) ) {
							subPath.node.name = replacePropsMap[ subPath.node.name ];
						}
					}

				},
				// Track vars in JSX expressions in case we need have any control props to process
				JSXExpressionContainer( subPath ) {
					const { expression } = subPath.node;
					if ( isControlExpression( expression ) ) {
						const expressionSubject = getExpressionSubject( expression );
						console.log( "expression subject", expressionSubject );
					}
				}
			} );
		}
	}
};

module.exports = ( babel, config ) => {
	return {
		name: "template-props-plugin",
		visitor: {
			Program(programPath) {
				programPath.traverse( templateVarsVisitor( babel, config ) );
			},
		}
	};
};
