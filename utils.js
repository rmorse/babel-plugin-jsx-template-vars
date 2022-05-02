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

module.exports = {
	getExpressionSubject,
	getArrayFromExpression,
	getObjectFromExpression,
	getNameFromNode,
};