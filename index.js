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
const foundJSXExpressionDeclarations = {};

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

	const createPropValue = ( name, config ) => {
		let newPropVar;
		if ( ! config || ! config.type || config.type === 'string' ) {
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
	function getObjectNameFromExpression( expression ) {
		return expression?.left?.object?.name;
	}

	function getExpressionSubject( expression ) {
		if ( expression.left.type === 'UnaryExpression' ) {
			return expression.left.argument.name;
		}
		if ( expression.left.type === 'Identifier' ) {
			return expression.left.name;
		}
		return null;
	}
	
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
						console.log("found variable declaration", path.scope.uid, declaration.id.name)
						if ( ! foundVariableDeclarations[ path.scope.uid ] ) {
							foundVariableDeclarations[ path.scope.uid ] = [];
						}
						foundVariableDeclarations[ path.scope.uid ][ declaration.id.name ] = { declaration, path };
					}
				} );
			},
			ExpressionStatement( path, state ) {
				// Try to look for the property assignment of `templateProps` and remove it
				// from the source
				console.log("scope", path.scope.uid)
				// Get the left part of the expression
				// MyObject.templateProps = []
				const { expression } = path.node;
				const templateProps = getTemplatePropsFromExpression( expression );
				if ( ! templateProps ) {
					return;
				}
				
				// Remove templateProps from the source
				path.remove();
				
				// If tidyOnly is set, exit here, after the removal of the templateProps.
				if ( tidyOnly ) {
					return;
				}

				const { replace: replaceProps, control: controlProps } = templateProps;
				// A functional component will usually be transformed something like:
				// TODO - maybe this assumption is dangerous?
				/*
					var Field = function Field(_ref) {
					var type = _ref.type,
					input = _ref.input,
					name = _ref.name,
					...
				*/
				/*function findFunctionalComponent( path ) {
					const { node } = path;
					if ( node.type === 'FunctionDeclaration' ) {
						return node;
					}
					if ( node.type === 'VariableDeclaration' ) {
						const { declarations } = node;
						declarations.forEach( ( declaration ) => {
							if ( declaration.init && declaration.init.type === 'ArrowFunctionExpression' ) {
								return findFunctionalComponent( path.get( 'init' ) );
							}
						} );
					}
					if ( node.type === 'ExpressionStatement' ) {
						return findFunctionalComponent( path.get( 'expression' ) );
					}
					if ( node.type === 'AssignmentExpression' ) {
						return findFunctionalComponent( path.get( 'right' ) );
					}
					if ( node.type === 'CallExpression' ) {
						return findFunctionalComponent( path.get( 'callee' ) );
					}
					if ( node.type === 'MemberExpression' ) {
						return findFunctionalComponent( path.get( 'object' ) );
					}
					if ( node.type === 'ObjectExpression' ) {
						return node;
					}
					return null;
				}*/

				// Using props + config, update the value.
				// Find the param name that is passed in (props) then update the properties with the template strings from the array.

				const objectName = getObjectNameFromExpression( expression );
				console.log("found expression with ", path.scope.uid, objectName)

				let objectScope = null;
				// Here we deal with the template tags with the plain values
				if ( foundVariableDeclarations[ path.scope.uid ] && foundVariableDeclarations[ path.scope.uid ][ objectName ] ) {
					const { declaration, path: decPath } = foundVariableDeclarations[ path.scope.uid ][ objectName ];
					objectScope = decPath.scope;
					if ( Array.isArray( declaration.init.params ) && declaration.init.params.length > 0 ) {
						// Get the first param name
						const paramName = declaration.init.params[ 0 ].name; // TODO - do we need to check for multiple params?
						decPath.traverse( {
							VariableDeclaration: function(path) {
								// console.log("found variable declartion");
								// Insert content before the first variable declaration
								replaceProps.forEach( ( prop ) => {
									const [ propName, propConfig ] = prop;
									const left = types.identifier(`${paramName}.${propName}`);
									const right = createPropValue( propName, propConfig );
									path.insertBefore( buildAssignment( left, right ) );
								} );
							},
							/*ExpressionStatement: function(path) {
								console.log("found an expression statement in a component with template props")
								// Insert content before the first expression statement
								replaceProps.forEach( ( prop ) => {
									const [ propName, propConfig ] = prop;
								} );
							},
							JSXExpressionContainer( path) {
								// console.log("found JSX expression container", path.node?.expression)
								
							}*/
						} );

					}
				}
				// Here we deal with the template tags with the plain values
				//console.log( "IN EXPRESSION statement", path.scope.uid, Object.keys( foundJSXExpressionDeclarations ) );
				console.log("OBJECT SCOPE WAS: ", objectScope.uid)
				if ( foundJSXExpressionDeclarations[ objectScope ] && foundJSXExpressionDeclarations[ objectScope ][ objectName ] ) {
					const expressions = foundVariableDeclarations[ path.scope.uid ][ objectName ];
					console.log( `found expressions for ${objectName}`, expressions );
				}
			},
			JSXExpressionContainer( path ) {
				
				// Store the found expressions for later use. 
				// The JSX expression we want will always be parsed before templateProps is parsed.
				
				// TODO - expand this to support other types of JSX expressions for displaying values
				// For now just support LogicalExpression like:
				// { isChecked && <Checkbox checked={isChecked} /> }
				if ( path.node?.expression?.type === 'LogicalExpression' ) {
					const expression = path.node.expression;
					if ( ! foundJSXExpressionDeclarations[ path.scope.uid ] ) {
						foundJSXExpressionDeclarations[ path.scope.uid ] = [];
					}
					const expressionSubject = getExpressionSubject( expression );
					console.log("found jsx expression statement ", path.scope.uid, expressionSubject)

					if ( ! foundJSXExpressionDeclarations[ path.scope.uid ] ) {
						foundJSXExpressionDeclarations[ path.scope.uid ] = {};
					}
					if ( ! foundJSXExpressionDeclarations[ path.scope.uid ][ expressionSubject ] ) {
						foundJSXExpressionDeclarations[ path.scope.uid ][ expressionSubject ] = [];
					}
					foundJSXExpressionDeclarations[ path.scope.uid ][ expressionSubject ].push( { expression, path } );
					//console.log( "IN EXPRESSION CONTAINER", path.scope.uid, expressionSubject );
				}

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
