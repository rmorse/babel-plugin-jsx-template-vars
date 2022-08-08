function getObjectFromExpression( expression ) {
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
function getArrayFromExpression( expression ) {
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
		args.push( { type: 'identifier', value: `${ expression.object.name }.${ expression.property.name }` } );
	} else if ( types.isUnaryExpression( expression ) ) {
		args = [ ...args, ...getExpressionArgs( expression.argument, types ) ];
	}
	else if ( types.isBinaryExpression( expression ) ) {
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

function isJSXElementTextInput( subPath ) {
	const element = subPath.node;
	if ( ! element.openingElement ) {
		return false;
	}

	const { name } = element.openingElement;
	if ( name?.name !== 'input' ) {
		return false;
	}
	// Now check to see if the elements `type` attribute is set to `text`.
	const typeAttr = element.openingElement.attributes.find( ( attr ) => {
		return attr?.name?.name === 'type';
	} );
	
	if ( ! typeAttr ) {
		return false;
	}
	const { value } = typeAttr;
	if ( value.value !== 'text' ) {
		return false;
	}
	return true;

}



function getLanguageCallExpression( targets, args, context, types ) {
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
		
	return types.callExpression( types.identifier( 'getLanguageString' ), [ types.arrayExpression( targetsNodes ), types.arrayExpression( argsNodes ), types.identifier( context ) ] );
}
function getLanguageListCallExpression( action, name, context, types ) {
	const nameObject = types.objectExpression( [
		types.objectProperty( types.identifier('type'), types.stringLiteral( 'identifier' ) ),
		types.objectProperty( types.identifier('value'), types.stringLiteral( name ) ),
	] );
	return types.callExpression( types.identifier( 'getLanguageList' ), [ types.stringLiteral( action ), nameObject, types.identifier( context ) ] );
}


module.exports = {
	getExpressionArgs,
	getArrayFromExpression,
	getObjectFromExpression,
	injectContextToJSXElementComponents,
	isJSXElementComponent,
	isJSXElementTextInput,
	getLanguageCallExpression,
	getLanguageListCallExpression,
};
