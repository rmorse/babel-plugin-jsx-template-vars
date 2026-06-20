function getArrayFromExpression( expression ) {
	const props = [];
	if ( expression && expression.elements ) {
		expression.elements.forEach( ( element ) => {
			if ( element.type === 'StringLiteral' ) {
				props.push( element.value );
			} else {
				props.push( element );
			}
		} );
	}
	return props;
};

function getMemberExpressionSegments( expression, types ) {
	if ( types.isIdentifier( expression ) ) {
		return [ expression.name ];
	}

	if ( ! isStaticMemberExpression( expression, types ) ) {
		return null;
	}

	const objectSegments = getMemberExpressionSegments( expression.object, types );
	if ( ! objectSegments ) {
		return null;
	}

	if ( types.isIdentifier( expression.property ) ) {
		return [ ...objectSegments, expression.property.name ];
	}

	return null;
}

function isStaticMemberExpression( expression, types ) {
	const isMemberExpression = types.isMemberExpression( expression ) ||
		( typeof types.isOptionalMemberExpression === 'function' && types.isOptionalMemberExpression( expression ) ) ||
		expression?.type === 'OptionalMemberExpression';

	return isMemberExpression && ! expression.computed;
}

function getExpressionPath( expression, types ) {
	if ( types.isIdentifier( expression ) ) {
		return expression.name;
	}

	const segments = getMemberExpressionSegments( expression, types );
	return segments ? segments.join( '.' ) : null;
}

function getExpressionArgs( expression, types ) {
	let args = [];
	// let currentNode = expression.left;
	if ( types.isIdentifier( expression ) ) {
		args.push( { type: 'identifier', value: expression.name } );
	} else if ( types.isStringLiteral( expression ) ) {
		args.push( { type: 'value', value: `'${ expression.value }'` } );
	} else if ( types.isLiteral( expression ) ) {
		// Should handle booleans, integers, floats etc
		args.push( { type: 'value', value: String( expression.value ) } );
	} else if ( isStaticMemberExpression( expression, types )) {
		const segments = getMemberExpressionSegments( expression, types );
		if ( segments ) {
			args.push( { type: 'path', value: segments.join( '.' ), segments } );
		}
	} else if ( types.isUnaryExpression( expression ) ) {
		args = [ ...args, ...getExpressionArgs( expression.argument, types ) ];
	}
	else if ( types.isBinaryExpression( expression ) ) {
		args = [
			...args,
			...getExpressionArgs( expression.left, types ),
			...getExpressionArgs( expression.right, types )
		];
	} else if ( types.isLogicalExpression( expression ) ) {
		args = [
			...args,
			...getExpressionArgs( expression.left, types ),
			...getExpressionArgs( expression.right, types )
		];
	}
	return args;
}


function injectContextToJSXElementComponents( path, contextVar, t ) {
	path.traverse( {
		JSXElement(subPath){
			// If we find a JSX element, check to see if it's a component,
			// and if so, inject a `__context__` JSXAttribute.
			if ( isJSXElementComponent( subPath ) ) {
				const contextAttribute = t.jSXAttribute( t.jSXIdentifier( '__context__' ), t.jSXExpressionContainer( t.identifier( contextVar ) ) );
				subPath.node.openingElement.attributes.push( contextAttribute );
			}
		}
	} );
}

function getJSXElementName( path ) {
	return getJSXName( path.node.openingElement?.name );
}

function getJSXName( name ) {
	if ( ! name ) {
		return null;
	}
	if ( name.type === 'JSXIdentifier' ) {
		return name.name;
	}
	if ( name.type === 'JSXMemberExpression' ) {
		const objectName = getJSXName( name.object );
		const propertyName = getJSXName( name.property );
		return objectName && propertyName ? `${ objectName }.${ propertyName }` : null;
	}
	return null;
}

function isJSXElementComponent( path ) {
	const elementName = getJSXElementName( path );
	if ( typeof elementName === 'string' ) {
		// Find out if we're dealing with a component or regular html element.
		// Assume that a capital letter means a component.
		// TODO - Double check this - pretty sure its a JSX rule.
		const elementIntialLetter = elementName.substring(0, 1);
		if ( elementIntialLetter.toUpperCase() === elementIntialLetter ) {
			return true;
		}
	}
	return false;
}

function isJSXElementInput( subPath ) {
	const element = subPath.node;
	if ( ! element.openingElement ) {
		return false;
	}

	const { name } = element.openingElement;
	if ( name?.name !== 'input' ) {
		return false;
	}
	return true;
}

function getLanguageCallExpression( targets, args, context, types ) {
	const targetsNodes = targets.map( target => types.stringLiteral( target ) );

	// using types, create a new object with the properties "type" and "value":
	const argsNodes = [];
	args.map( ( arg ) => {
		argsNodes.push( getArgObjectExpression( arg, types ) );
	} );
		
	return types.callExpression( types.identifier( 'getLanguageString' ), [ types.arrayExpression( targetsNodes ), types.arrayExpression( argsNodes ), getContextExpression( context, types ) ] );
}
function getLanguageListCallExpression( action, name, context, types ) {
	const nameObject = name && typeof name === 'object'
		? getArgObjectExpression( name, types )
		: typeof name === 'string' ? types.objectExpression( [
			types.objectProperty( types.identifier('type'), types.stringLiteral( 'identifier' ) ),
			types.objectProperty( types.identifier('value'), types.stringLiteral( name ) ),
		] ) : types.nullLiteral();
	return types.callExpression( types.identifier( 'getLanguageList' ), [ types.stringLiteral( action ), nameObject, getContextExpression( context, types ) ] );
}

function getArgObjectExpression( arg, types ) {
	if ( arg.dynamicRootName ) {
		return types.callExpression(
			types.identifier( 'getTemplateRootPathArg' ),
			[
				createMemberExpressionFromSegments( arg.dynamicRootSegments || [ arg.dynamicRootName ], types ),
				types.arrayExpression( ( arg.suffixSegments || [] ).map( segment => types.stringLiteral( segment ) ) ),
			]
		);
	}

	const props = [
		types.objectProperty( types.identifier('type'), types.stringLiteral( arg.type ) ),
		types.objectProperty( types.identifier('value'), types.stringLiteral( arg.value ) ),
	];

	if ( Array.isArray( arg.segments ) ) {
		props.push(
			types.objectProperty(
				types.identifier( 'segments' ),
				types.arrayExpression( arg.segments.map( segment => types.stringLiteral( segment ) ) )
			)
		);
	}

	if ( typeof arg.contextOffset === 'number' ) {
		props.push(
			types.objectProperty(
				types.identifier( 'contextOffset' ),
				types.numericLiteral( arg.contextOffset )
			)
		);
	}

	return types.objectExpression( props );
}

function createMemberExpressionFromSegments( segments, types ) {
	return segments.slice( 1 ).reduce(
		( expression, segment ) => types.memberExpression( expression, types.identifier( segment ) ),
		types.identifier( segments[ 0 ] )
	);
}

function getContextExpression( context, types ) {
	if ( typeof context === 'string' ) {
		return types.identifier( context );
	}
	return context;
}

module.exports = {
	getExpressionArgs,
	getExpressionPath,
	getMemberExpressionSegments,
	getArrayFromExpression,
	injectContextToJSXElementComponents,
	isJSXElementComponent,
	isJSXElementInput,
	getLanguageCallExpression,
	getLanguageListCallExpression,
	getArgObjectExpression,
	getContextExpression,
};
