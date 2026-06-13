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

	if ( ! types.isMemberExpression( expression ) || expression.computed ) {
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
	} else if ( types.isMemberExpression( expression )) {
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
	return path.node.openingElement?.name?.name
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
		
	return types.callExpression( types.identifier( 'getLanguageString' ), [ types.arrayExpression( targetsNodes ), types.arrayExpression( argsNodes ), types.identifier( context ) ] );
}
function getLanguageListCallExpression( action, name, context, types ) {
	const nameObject = types.objectExpression( [
		types.objectProperty( types.identifier('type'), types.stringLiteral( 'identifier' ) ),
		types.objectProperty( types.identifier('value'), types.stringLiteral( name ) ),
	] );
	return types.callExpression( types.identifier( 'getLanguageList' ), [ types.stringLiteral( action ), nameObject, types.identifier( context ) ] );
}

function getArgObjectExpression( arg, types ) {
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

	return types.objectExpression( props );
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
};
