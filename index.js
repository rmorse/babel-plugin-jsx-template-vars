/**
 * Look for `templateProps` property attached to our components to figure out which props
 * are dynamic and need to be handled via Mustache tags - eg `{{name}}`
 * Read in the info, find the component definition, and replace prop values in components before they are used.
 * Tagging lists is a manual process marked by comments (but could also be handled via `templateProps`).
*/
const TEMPLATE_PROPS_COMMENT_ID = 'Template Props:';

// Keep track of the funtion declarations, so we can easily look them up
// later once we've found `templateProps`
const foundVariableDeclarations = {};

module.exports = ( { types }, config ) => {
	const tidyOnly = config.tidyOnly ?? false;
	const buildAssignment = (left, right) => {
		return types.assignmentExpression("=", left, right);
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

	const createProp = ( name, config ) => {
		let newPropVar;
		if ( ! config || config.type === 'string' ) {
			newPropVar = types.stringLiteral(`{{${ name }}}` );
		}
		else if ( config.type === 'array' ) {
			const { type, props } = config.child;
			const newProp = [];
			if ( type === 'object' ) {
				const childProp = {};
				const propsArr = [];
				props.forEach( ( propName ) => {
					propsArr.push( types.objectProperty( types.identifier( propName ), types.stringLiteral( `{{${ propName }}}` ) ) );
				} );
				newProp.push( childProp );
				const templateObject = types.objectExpression( propsArr )
				newPropVar = types.arrayExpression( [ templateObject ] );
			}
		}
		
		return newPropVar;
	};
	
	return {
		name: "template-props-plugin",
		visitor: {
			VariableDeclaration( path, state ) {
				if ( tidyOnly ) {
					return;
				}
				const { declarations } = path.node;
				declarations.forEach( ( declaration ) => {
					if ( declaration.id && declaration.id.type === 'Identifier' ) {
						foundVariableDeclarations[ declaration.id.name ] = { declaration, path };
					}
				} );
			},
			ExpressionStatement( path, state ) {
				// Try to look for the property assignment of `templateProps` and remove it
				// from the source

				// Get the left part of the expression
				// MyObject.templateProps = []
				const left = path.node.expression.left;
				const right = path.node.expression.right;
				if ( ! left || ! right ) {
					return;
				}

				const { object, property } = left;
				// Make sure the property being set is `templateProps`
				if ( object?.type !== 'Identifier' ) {
					return;
				}
				if ( property?.type !== 'Identifier' ) {
					return;
				}

				const objectName = object.name;
				const propertyName = property.name;

				if ( propertyName === 'templateProps' ) {
					path.remove();
				}

				// Next we'll try to find the variable declaration that contains the object,
				// If tidyOnly is set, we want to exit here, after the removal of the templateProps.
				if ( tidyOnly ) {
					return;
				}

				let templateProps = [];
				// Now process the right part of the expression and calc new props.
				if ( right && right.type === 'ArrayExpression' ) {
					// Then we have an array to process the props.
					templateProps = getArrayFromExpression( right );
				}

				if ( templateProps.length === 0 ) {
					return;
				}

				// Now we have new props to replace, we need to update the object.

				// A functional component will usually be transformed something like:
				/*
					var Field = function Field(_ref) {
					var type = _ref.type,
					input = _ref.input,
					name = _ref.name,
					...
				*/
				// We need to find the param name that is passed in (props)
				// Then we need to update the properties with the template strings from the array.
				if ( foundVariableDeclarations[ objectName ] ) {
					const { declaration, path: decPath } = foundVariableDeclarations[ objectName ];
					if ( Array.isArray( declaration.init.params ) && declaration.init.params.length > 0 ) {
						// Get the first param name
						const paramName = declaration.init.params[ 0 ].name; // TODO - do we need to check for multiple params?
						decPath.traverse( {
							VariableDeclaration: function(path) {
								// Insert content before the first variable declaration
								templateProps.forEach( ( prop ) => {
									let propName;
									let propConfig;
									let right;
									if ( Array.isArray( prop ) && prop.length === 2 ) {
										propName = prop[0];
										propConfig = prop[1];
										right = createProp( propName, propConfig );
										
									} else {
										propName = prop;
										right = types.stringLiteral(`{{${ propName }}}` );
									}

									const left = types.identifier(`${paramName}.${propName}`);
									
									// const declarations = path.node.declarations;
									path.insertBefore( buildAssignment( left, right ) );
								} );
								path.stop();
								decPath.stop();
							},
						} );
					}
				}
			},
			JSXExpressionContainer( path) {
				// Look for `list-start` and `list-end` comments so we can insert the mustache strings around the repeatable elements.
				const comments = path.node?.expression?.innerComments;
				if ( comments && comments.length ) {
					comments.forEach( ( comment ) => {
						if ( comment.value.trim().lastIndexOf( TEMPLATE_PROPS_COMMENT_ID ) === 0 ) {
							// Split the string into parts:
							if ( tidyOnly ) {
								path.remove();
							} else {
								const commentParts = comment.value.split( ':' ).map( ( e ) => e.trim() );
								const [ , action, name ] = commentParts;
								if ( action === 'list-start' ) {
									path.insertAfter( types.stringLiteral(`{{#${ name }}}` ) );
								} else if ( action === 'list-end' ) {
									path.insertAfter( types.stringLiteral(`{{/${ name }}}` ) );
								}
							}
						}
					} );
				}
			},
		}
	};
};
