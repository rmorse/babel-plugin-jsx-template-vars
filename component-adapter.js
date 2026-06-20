function getComponentFunctionPath( componentPath, types ) {
	if ( ! componentPath ) {
		return null;
	}

	if ( isFunctionNode( componentPath.node, types ) ) {
		return componentPath;
	}

	if ( types.isVariableDeclaration( componentPath.node ) ) {
		const declarationPath = getSingleVariableDeclaratorPath( componentPath );
		if ( ! declarationPath ) {
			return null;
		}
		const initPath = declarationPath.get( 'init' );
		return resolveComponentFunctionExpressionPath( initPath, types );
	}

	return null;
}

function getComponentName( componentPath ) {
	if ( ! componentPath ) {
		return undefined;
	}

	if ( componentPath.node?.type === 'FunctionDeclaration' ) {
		return componentPath.node.id?.name;
	}

	if ( componentPath.node?.type === 'VariableDeclaration' ) {
		const declaration = componentPath.node.declarations?.[ 0 ];
		return declaration?.id?.type === 'Identifier' ? declaration.id.name : undefined;
	}

	return undefined;
}

function getComponentFirstParamPath( componentPath, types ) {
	const functionPath = getComponentFunctionPath( componentPath, types );
	return functionPath?.get( 'params.0' ) || null;
}

function getComponentParamPaths( componentPath, types ) {
	const functionPath = getComponentFunctionPath( componentPath, types );
	return functionPath ? functionPath.get( 'params' ) : [];
}

function getComponentBodyPath( componentPath, types ) {
	const functionPath = getComponentFunctionPath( componentPath, types );
	return functionPath?.get( 'body' ) || null;
}

function getTopLevelComponentPath( childPath, types ) {
	const defaultFunctionPath = getDefaultExportFunctionPath( childPath, types );
	if (
		defaultFunctionPath &&
		defaultFunctionPath.node.id &&
		isComponentName( defaultFunctionPath.node.id.name ) &&
		! defaultFunctionPath.node.async &&
		! defaultFunctionPath.node.generator
	) {
		return {
			name: defaultFunctionPath.node.id.name,
			path: defaultFunctionPath,
			kind: 'default-function',
		};
	}

	const variablePath = getVariableDeclarationPath( childPath, types );
	if ( variablePath ) {
		const declarationPath = getSingleVariableDeclaratorPath( variablePath );
		const declaration = declarationPath?.node;
		const init = declaration?.init;
		if (
			types.isIdentifier( declaration?.id ) &&
			isComponentName( declaration.id.name ) &&
			resolveComponentFunctionExpressionPath( declarationPath.get( 'init' ), types )
		) {
			return {
				name: declaration.id.name,
				path: variablePath,
				kind: 'variable',
			};
		}
	}

	const functionPath = getFunctionDeclarationPath( childPath, types );
	if (
		functionPath &&
		functionPath.node.id &&
		isComponentName( functionPath.node.id.name ) &&
		! functionPath.node.async &&
		! functionPath.node.generator
	) {
		return {
			name: functionPath.node.id.name,
			path: functionPath,
			kind: 'function',
		};
	}

	return null;
}

function resolveComponentFunctionExpressionPath( expressionPath, types, seen = new Set() ) {
	if ( ! expressionPath?.node ) {
		return null;
	}

	if ( isFunctionNode( expressionPath.node, types ) ) {
		return expressionPath;
	}

	if ( types.isCallExpression( expressionPath.node ) && isTransparentWrapperCallee( expressionPath.node.callee, types ) ) {
		return resolveComponentFunctionExpressionPath( expressionPath.get( 'arguments.0' ), types, seen );
	}

	if ( types.isIdentifier( expressionPath.node ) ) {
		const name = expressionPath.node.name;
		if ( seen.has( name ) ) {
			return null;
		}
		seen.add( name );
		const binding = expressionPath.scope.getBinding( name );
		if ( ! binding ) {
			return null;
		}
		if ( types.isFunctionDeclaration( binding.path.node ) ) {
			return binding.path;
		}
		if ( types.isVariableDeclarator( binding.path.node ) ) {
			return resolveComponentFunctionExpressionPath( binding.path.get( 'init' ), types, seen );
		}
	}

	return null;
}

function isFunctionNode( node, types ) {
	return (
		types.isFunctionDeclaration( node ) ||
		types.isFunctionExpression( node ) ||
		types.isArrowFunctionExpression( node )
	);
}

function isTransparentWrapperCallee( callee, types ) {
	if ( types.isIdentifier( callee ) ) {
		return callee.name === 'memo' || callee.name === 'forwardRef';
	}
	return (
		types.isMemberExpression( callee ) &&
		! callee.computed &&
		(
			types.isIdentifier( callee.property, { name: 'memo' } ) ||
			types.isIdentifier( callee.property, { name: 'forwardRef' } )
		)
	);
}

function getVariableDeclarationPath( childPath, types ) {
	if ( types.isVariableDeclaration( childPath.node ) ) {
		return childPath;
	}

	if (
		types.isExportNamedDeclaration( childPath.node ) &&
		types.isVariableDeclaration( childPath.node.declaration )
	) {
		return childPath.get( 'declaration' );
	}

	return null;
}

function getFunctionDeclarationPath( childPath, types ) {
	if ( types.isFunctionDeclaration( childPath.node ) ) {
		return childPath;
	}

	if (
		types.isExportNamedDeclaration( childPath.node ) &&
		types.isFunctionDeclaration( childPath.node.declaration )
	) {
		return childPath.get( 'declaration' );
	}

	return null;
}

function getDefaultExportFunctionPath( childPath, types ) {
	if (
		types.isExportDefaultDeclaration( childPath.node ) &&
		types.isFunctionDeclaration( childPath.node.declaration )
	) {
		return childPath.get( 'declaration' );
	}

	return null;
}

function getSingleVariableDeclaratorPath( declarationPath ) {
	const declarations = declarationPath.node?.declarations || [];
	if ( declarations.length !== 1 ) {
		return null;
	}
	return declarationPath.get( 'declarations.0' );
}

function isComponentName( name ) {
	return typeof name === 'string' && /^[A-Z]/.test( name );
}

module.exports = {
	getComponentBodyPath,
	getComponentFirstParamPath,
	getComponentFunctionPath,
	getComponentName,
	getComponentParamPaths,
	getTopLevelComponentPath,
	getVariableDeclarationPath,
	isComponentName,
};
