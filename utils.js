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
	if ( expression.type === 'Identifier' ) {
		return getNameFromNode( expression );
	} else if ( expression.left.type === 'MemberExpression' ) {
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

module.exports = {
	getExpressionSubject,
	getArrayFromExpression,
	getObjectFromExpression,
	getNameFromNode,
	injectContextToJSXElementComponents,
	isJSXElementComponent,
	isJSXElementTextInput,
};
