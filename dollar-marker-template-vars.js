const diagnostics = require( './diagnostics' );

const markerPrefix = '$$';
const safeListChainMethods = new Set( [
	'filter',
	'slice',
	'sort',
	'toSorted',
	'reverse',
	'toReversed',
] );

function isDollarMarkerName( name ) {
	return typeof name === 'string' && name.startsWith( markerPrefix );
}

function unmarkName( name ) {
	if ( name === markerPrefix ) {
		return null;
	}
	return name.slice( markerPrefix.length );
}

function isStaticMemberExpression( expression, types ) {
	return (
		types.isMemberExpression( expression ) ||
		( typeof types.isOptionalMemberExpression === 'function' && types.isOptionalMemberExpression( expression ) ) ||
		expression?.type === 'OptionalMemberExpression'
	) && ! expression.computed;
}

function assertValidMarkerIdentifierPath( path, types ) {
	const { node, parentPath } = path;
	if ( ! isDollarMarkerName( node.name ) ) {
		return;
	}

	const sourceName = unmarkName( node.name );
	if ( ! sourceName ) {
		diagnostics.error( path, 'Invalid dollar marker "$$". Markers must include an identifier name.' );
	}

	if ( isBindingIdentifierPath( path ) ) {
		diagnostics.error( path, `Invalid dollar marker "${ node.name }". Markers cannot be used in binding positions.` );
	}

	if ( referencesMarkerBinding( path ) ) {
		diagnostics.error( path, `Invalid dollar marker "${ node.name }". Markers cannot reference marker-named bindings.` );
	}

	if ( types.isMemberExpression( parentPath?.node ) || parentPath?.node?.type === 'OptionalMemberExpression' ) {
		if ( parentPath.node.property === node && ! parentPath.node.computed ) {
			diagnostics.error( path, `Invalid dollar marker "${ node.name }". Markers are only supported on root identifiers.` );
		}

		if ( parentPath.node.object === node && parentPath.node.computed ) {
			diagnostics.error( path, `Invalid dollar marker "${ node.name }". Computed marker access is not supported.` );
		}
	}
}

function isBindingIdentifierPath( path ) {
	if ( isImportSpecifierPath( path ) ) {
		return true;
	}

	if ( path.node?.type === 'ObjectProperty' && path.parentPath?.node?.type === 'ObjectPattern' ) {
		return true;
	}

	const parentPath = path.parentPath;
	const parent = parentPath?.node;
	if ( ! parent ) {
		return false;
	}

	if ( isImportBindingPath( path ) ) {
		return true;
	}

	if ( parent.type === 'VariableDeclarator' && parent.id === path.node ) {
		return true;
	}

	if (
		( parent.type === 'FunctionDeclaration' || parent.type === 'FunctionExpression' ) &&
		parent.id === path.node
	) {
		return true;
	}

	return isInsideBindingPattern( path );
}

function referencesMarkerBinding( path ) {
	const binding = path.scope?.getBinding?.( path.node.name );
	if ( ! binding?.path || binding.path === path ) {
		return false;
	}

	return isBindingIdentifierPath( binding.path );
}

function isImportBindingPath( path ) {
	if ( isImportSpecifierPath( path ) ) {
		return true;
	}

	const parent = path.parentPath?.node;
	if ( ! parent ) {
		return false;
	}

	return (
		( parent.type === 'ImportSpecifier' && parent.local === path.node ) ||
		( parent.type === 'ImportDefaultSpecifier' && parent.local === path.node ) ||
		( parent.type === 'ImportNamespaceSpecifier' && parent.local === path.node )
	);
}

function isImportSpecifierPath( path ) {
	return (
		path.node?.type === 'ImportSpecifier' ||
		path.node?.type === 'ImportDefaultSpecifier' ||
		path.node?.type === 'ImportNamespaceSpecifier'
	);
}

function isInsideBindingPattern( path ) {
	let currentPath = path;

	while ( currentPath.parentPath ) {
		const parentPath = currentPath.parentPath;
		const parent = parentPath.node;

		if ( parent.type === 'ObjectPattern' || parent.type === 'ArrayPattern' ) {
			return true;
		}

		if ( parent.type === 'VariableDeclarator' && parent.id === currentPath.node ) {
			return true;
		}

		if ( isFunctionNode( parent ) && parent.params?.includes( currentPath.node ) ) {
			return true;
		}

		if (
			parent.type === 'ObjectProperty' &&
			parentPath.parentPath?.node?.type === 'ObjectPattern' &&
			( parent.key === currentPath.node || parent.value === currentPath.node )
		) {
			currentPath = currentPath.parentPath;
			continue;
		}

		if (
			( parent.type === 'AssignmentPattern' && parent.left === currentPath.node ) ||
			( parent.type === 'RestElement' && parent.argument === currentPath.node )
		) {
			currentPath = currentPath.parentPath;
			continue;
		}

		return false;
	}

	return false;
}

function isFunctionNode( node ) {
	return node && (
		node.type === 'FunctionDeclaration' ||
		node.type === 'FunctionExpression' ||
		node.type === 'ArrowFunctionExpression' ||
		node.type === 'ObjectMethod' ||
		node.type === 'ClassMethod'
	);
}

function getMarkerExpressionPath( expression, types, aliasesByBinding, path ) {
	const markerPath = getMarkerExpressionInfo( expression, types, aliasesByBinding, path );
	return markerPath?.path || null;
}

function getMarkerExpressionInfo( expression, types, aliasesByBinding, path ) {
	if ( types.isIdentifier( expression ) ) {
		if ( isDollarMarkerName( expression.name ) ) {
			const sourceName = unmarkName( expression.name );
			return sourceName
				? {
					path: sourceName,
					markerOrigin: true,
				}
				: null;
		}

		const binding = path?.scope?.getBinding( expression.name );
		if ( binding && aliasesByBinding.has( binding.identifier ) ) {
			return aliasesByBinding.get( binding.identifier );
		}

		return null;
	}

	if ( isStaticMemberExpression( expression, types ) ) {
		if ( ! types.isIdentifier( expression.property ) ) {
			return null;
		}

		if ( isDollarMarkerName( expression.property.name ) ) {
			diagnostics.error( path, `Invalid dollar marker "${ expression.property.name }". Markers are only supported on root identifiers.` );
		}

		const objectInfo = getMarkerExpressionInfo( expression.object, types, aliasesByBinding, path );
		return objectInfo ? {
			path: `${ objectInfo.path }.${ expression.property.name }`,
			markerOrigin: objectInfo.markerOrigin,
		} : null;
	}

	return null;
}

function getListSourcePath( expression, types, aliasesByBinding, path ) {
	const sourceInfo = getListSourceInfo( expression, types, aliasesByBinding, path );
	return sourceInfo?.path || null;
}

function getListSourceInfo( expression, types, aliasesByBinding, path ) {
	if ( isSafeListChainCall( expression, types ) ) {
		return getListSourceInfo( expression.callee.object, types, aliasesByBinding, path );
	}

	return getMarkerExpressionInfo( expression, types, aliasesByBinding, path );
}

function normalizeAliasInfo( source ) {
	if ( typeof source === 'string' ) {
		return {
			path: source,
			markerOrigin: source.includes( '[]' ),
		};
	}

	return {
		path: source.path,
		markerOrigin: source.markerOrigin === true,
	};
}

function isSafeListChainCall( expression, types ) {
	return (
		types.isCallExpression( expression ) &&
		isStaticMemberExpression( expression.callee, types ) &&
		types.isIdentifier( expression.callee.property ) &&
		safeListChainMethods.has( expression.callee.property.name )
	);
}

function collectDollarMarkerTemplateVars( componentPath, functionPath, babel, errorPath = componentPath ) {
	const { types } = babel;
	const declarations = new Set();
	const aliasesByBinding = new WeakMap();
	let markerCount = 0;

	function addDeclaration( pathName ) {
		if ( pathName ) {
			declarations.add( pathName );
		}
	}

	function addListDeclaration( sourcePath ) {
		if ( sourcePath ) {
			declarations.add( `${ sourcePath }[]` );
		}
	}

	function registerIdentifierAlias( localName, sourcePath, path ) {
		const binding = path.scope.getBinding( localName );
		if ( binding && sourcePath ) {
			aliasesByBinding.set( binding.identifier, normalizeAliasInfo( sourcePath ) );
		}
	}

	function registerPatternAliases( pattern, basePath, path ) {
		( pattern.properties || [] ).forEach( ( property ) => {
			if ( property.type === 'RestElement' ) {
				return;
			}

			const propertyName = getPatternPropertyName( property, types );
			if ( ! propertyName ) {
				return;
			}

			const propertyPath = `${ basePath }.${ propertyName }`;
			if ( types.isIdentifier( property.value ) ) {
				registerIdentifierAlias( property.value.name, propertyPath, path );
				return;
			}

			if ( types.isObjectPattern( property.value ) ) {
				registerPatternAliases( property.value, propertyPath, path );
			}
		} );
	}

	function collectExpression( expression, path ) {
		if ( ! expression ) {
			return;
		}

		if ( types.isJSXElement( expression ) || types.isJSXFragment( expression ) ) {
			return;
		}

		if ( types.isLogicalExpression( expression ) ) {
			collectExpression( expression.left, path );
			collectExpression( expression.right, path );
			return;
		}

		if ( types.isConditionalExpression( expression ) ) {
			collectExpression( expression.test, path );
			collectExpression( expression.consequent, path );
			collectExpression( expression.alternate, path );
			return;
		}

		if ( types.isUnaryExpression( expression ) ) {
			collectExpression( expression.argument, path );
			return;
		}

		if ( types.isBinaryExpression( expression ) ) {
			collectExpression( expression.left, path );
			collectExpression( expression.right, path );
			return;
		}

		if ( types.isCallExpression( expression ) ) {
			collectCallExpression( path );
			expression.arguments.forEach( ( argument ) => collectExpression( argument, path ) );
			return;
		}

		const pathName = getMarkerExpressionPath( expression, types, aliasesByBinding, path );
		if ( pathName ) {
			addDeclaration( pathName );
		}
	}

	function collectCallExpression( path ) {
		const { node } = path;
		if ( ! types.isCallExpression( node ) ) {
			return;
		}

		if ( ! isStaticMemberExpression( node.callee, types ) ) {
			collectHelperListArguments( path );
			return;
		}

		if ( ! types.isIdentifier( node.callee.property ) ) {
			return;
		}

		const sourcePath = getListSourcePath( node.callee.object, types, aliasesByBinding, path );
		if ( ! sourcePath ) {
			return;
		}

		if ( safeListChainMethods.has( node.callee.property.name ) ) {
			addListDeclaration( sourcePath );
			registerMapCallbackAliases( path, `${ sourcePath }[]` );
			return;
		}

		if ( node.callee.property.name !== 'map' ) {
			return;
		}

		addListDeclaration( sourcePath );
		registerMapCallbackAliases( path, `${ sourcePath }[]` );
	}

	function collectHelperListArguments( path ) {
		path.node.arguments.forEach( ( argument ) => {
			const sourceInfo = getListSourceInfo( argument, types, aliasesByBinding, path );
			const sourcePath = sourceInfo?.path;
			if ( ! sourcePath ) {
				return;
			}

			if ( sourcePath.includes( '[]' ) ) {
				addListDeclaration( sourcePath.endsWith( '[]' ) ? sourcePath.slice( 0, -2 ) : sourcePath );
				return;
			}

			if ( isDirectMarkedRootArgument( argument, types ) || isMarkerOriginRootPath( sourceInfo ) ) {
				addListDeclaration( sourcePath );
			}
		} );
	}

	function isDirectMarkedRootArgument( argument, types ) {
		return types.isIdentifier( argument ) && isDollarMarkerName( argument.name );
	}

	function isMarkerOriginRootPath( sourceInfo ) {
		return sourceInfo.markerOrigin && ! sourceInfo.path.includes( '.' ) && ! sourceInfo.path.includes( '[]' );
	}

	function registerMapCallbackAliases( callPath, itemPath ) {
		const callback = callPath.node.arguments[ 0 ];
		if ( ! callback || ( ! types.isFunctionExpression( callback ) && ! types.isArrowFunctionExpression( callback ) ) ) {
			return;
		}

		const firstParam = callback.params?.[ 0 ];
		if ( ! firstParam ) {
			return;
		}

		const firstParamPath = callPath.get( 'arguments.0.params.0' );
		if ( types.isIdentifier( firstParam ) ) {
			registerIdentifierAlias( firstParam.name, itemPath, firstParamPath );
			return;
		}

		if ( types.isObjectPattern( firstParam ) ) {
			registerPatternAliases( firstParam, itemPath, firstParamPath );
		}
	}

	function isAllowedNestedFunction( path ) {
		if ( path.node === functionPath.node ) {
			return true;
		}

		const parent = path.parentPath?.node;
		if ( ! types.isCallExpression( parent ) || ! isStaticMemberExpression( parent.callee, types ) ) {
			return false;
		}

		return types.isIdentifier( parent.callee.property ) && (
			parent.callee.property.name === 'map' ||
			safeListChainMethods.has( parent.callee.property.name )
		);
	}

	function hasMarkerName( name ) {
		return isDollarMarkerName( name );
	}

	function noteMarker( path ) {
		markerCount++;
		assertValidMarkerIdentifierPath( path, types );
	}

	function stripMarkerIdentifier( path ) {
		if ( ! isDollarMarkerName( path.node.name ) ) {
			return;
		}

		assertValidMarkerIdentifierPath( path, types );
		path.node.name = unmarkName( path.node.name );
	}

	componentPath.traverse( {
		Function( path ) {
			if ( ! isAllowedNestedFunction( path ) ) {
				assertNoMarkersInSkippedFunction( path );
				path.skip();
				return;
			}

			if ( path.node !== functionPath.node && ! types.isBlockStatement( path.node.body ) ) {
				collectExpression( path.node.body, path );
			}
		},
		Identifier( path ) {
			if ( hasMarkerName( path.node.name ) ) {
				noteMarker( path );
			}
		},
		JSXIdentifier( path ) {
			if ( hasMarkerName( path.node.name ) ) {
				diagnostics.error( path, `Invalid dollar marker "${ path.node.name }". Markers cannot be used as JSX component or attribute names.` );
			}
		},
		ObjectProperty( path ) {
			if ( path.parentPath?.node?.type !== 'ObjectPattern' ) {
				return;
			}

			validatePatternPropertyMarker( path.get( 'key' ), types );
			validatePatternPropertyMarker( path.get( 'value' ), types );
		},
		VariableDeclarator( path ) {
			const { id, init } = path.node;
			if ( ! init ) {
				return;
			}

			const sourceInfo = getMarkerExpressionInfo( init, types, aliasesByBinding, path ) ||
				getListSourceInfo( init, types, aliasesByBinding, path );
			if ( ! sourceInfo ) {
				return;
			}

			if ( types.isIdentifier( id ) ) {
				registerIdentifierAlias( id.name, sourceInfo, path );
				return;
			}

			if ( types.isObjectPattern( id ) ) {
				registerPatternAliases( id, sourceInfo.path, path );
			}
		},
		CallExpression( path ) {
			collectCallExpression( path );
		},
		ReturnStatement( path ) {
			collectExpression( path.node.argument, path );
		},
		JSXExpressionContainer( path ) {
			collectExpression( path.node.expression, path );
		},
	} );

	if ( markerCount === 0 ) {
		return {
			hasMarkers: false,
			declarations: [],
			stripMarkers() {},
		};
	}

	const normalizedDeclarations = removeListRootScalarDeclarations( Array.from( declarations ) );
	if ( normalizedDeclarations.length === 0 ) {
		diagnostics.error( errorPath, 'Dollar markers were found, but no supported template var declarations could be inferred. Markers are only supported in rendered values, controls, map/list expressions, and supported aliases.' );
	}

	return {
		hasMarkers: true,
		declarations: normalizedDeclarations,
		stripMarkers() {
			componentPath.traverse( {
				Function( path ) {
					if ( ! isAllowedNestedFunction( path ) ) {
						path.skip();
					}
				},
				Identifier( path ) {
					stripMarkerIdentifier( path );
				},
				JSXIdentifier( path ) {
					if ( hasMarkerName( path.node.name ) ) {
						diagnostics.error( path, `Invalid dollar marker "${ path.node.name }". Markers cannot be used as JSX component or attribute names.` );
					}
				},
			} );
		},
	};
}

function assertNoMarkersInSkippedFunction( path ) {
	path.traverse( {
		Identifier( markerPath ) {
			if ( isDollarMarkerName( markerPath.node.name ) ) {
				diagnostics.error( markerPath, `Unsupported dollar marker "${ markerPath.node.name }". Markers inside nested local functions are not supported by experimentalDollarMarkers; use markers in the component body or supported map callbacks.` );
			}
		},
		JSXIdentifier( markerPath ) {
			if ( isDollarMarkerName( markerPath.node.name ) ) {
				diagnostics.error( markerPath, `Unsupported dollar marker "${ markerPath.node.name }". Markers inside nested local functions are not supported by experimentalDollarMarkers; use markers in the component body or supported map callbacks.` );
			}
		},
	} );
}

function validatePatternPropertyMarker( path, types ) {
	if ( path && path.isIdentifier?.() && isDollarMarkerName( path.node.name ) ) {
		assertValidMarkerIdentifierPath( path, types );
	}
}

function removeListRootScalarDeclarations( declarations ) {
	const listRoots = new Set();
	declarations.forEach( ( declaration ) => {
		const listIndex = declaration.indexOf( '[]' );
		if ( listIndex > -1 ) {
			listRoots.add( declaration.slice( 0, listIndex ) );
		}
	} );

	return declarations.filter( declaration => ! listRoots.has( declaration ) );
}

function getPatternPropertyName( property, types ) {
	if ( types.isIdentifier( property.key ) ) {
		return property.key.name;
	}
	if ( types.isStringLiteral( property.key ) ) {
		return property.key.value;
	}
	return null;
}

function findComponentFunctionPath( componentPath, types ) {
	const declaration = componentPath.node.declarations?.[ 0 ];
	if ( ! declaration ) {
		return null;
	}

	if ( ! types.isIdentifier( declaration.id ) ) {
		return null;
	}

	if ( types.isArrowFunctionExpression( declaration.init ) || types.isFunctionExpression( declaration.init ) ) {
		return componentPath.get( 'declarations.0.init' );
	}

	return null;
}

function isCapitalizedName( name ) {
	return typeof name === 'string' && /^[A-Z]/.test( name );
}

function isMarkerComponentCandidate( path, babel, filename = '' ) {
	const { types } = babel;
	if ( filenameIncludesNodeModules( filename ) ) {
		return false;
	}

	if ( ! types.isVariableDeclaration( path.node ) || path.parentPath?.node?.type !== 'Program' ) {
		return false;
	}

	if ( path.node.declarations.length !== 1 ) {
		return false;
	}

	const declaration = path.node.declarations[ 0 ];
	if ( ! types.isIdentifier( declaration.id ) || ! isCapitalizedName( declaration.id.name ) ) {
		return false;
	}

	if ( ! ( types.isArrowFunctionExpression( declaration.init ) || types.isFunctionExpression( declaration.init ) ) ) {
		return false;
	}

	return pathContainsJSX( path );
}

function pathContainsJSX( path ) {
	let containsJSX = false;
	path.traverse( {
		JSXElement( subPath ) {
			containsJSX = true;
			subPath.stop();
		},
		JSXFragment( subPath ) {
			containsJSX = true;
			subPath.stop();
		},
	} );
	return containsJSX;
}

function filenameIncludesNodeModules( filename = '' ) {
	const normalizedFilename = String( filename ).replace( /\\/g, '/' );
	return (
		normalizedFilename === 'node_modules' ||
		normalizedFilename.startsWith( 'node_modules/' ) ||
		normalizedFilename.includes( '/node_modules/' )
	);
}

module.exports = {
	collectDollarMarkerTemplateVars,
	filenameIncludesNodeModules,
	findComponentFunctionPath,
	isDollarMarkerName,
	isMarkerComponentCandidate,
	unmarkName,
};
