const diagnostics = require( './diagnostics' );

const STORE_SELECTOR_MODULE = 'babel-plugin-jsx-template-vars/store';
const STORE_SELECTOR_EXPORT = 'useStoreSelector';

function isStoreSelectorEnabled( config = {} ) {
	return config.experimentalStoreSelectors === true;
}

function collectStoreSelectorImports( programPath, babel ) {
	const { types } = babel;
	const localNames = new Set();
	const importSpecifiers = [];

	programPath.get( 'body' ).forEach( ( childPath ) => {
		const node = childPath.node;
		if ( ! types.isImportDeclaration( node ) || node.source.value !== STORE_SELECTOR_MODULE ) {
			return;
		}

		childPath.get( 'specifiers' ).forEach( ( specifierPath ) => {
			const specifier = specifierPath.node;
			if (
				types.isImportSpecifier( specifier ) &&
				types.isIdentifier( specifier.imported ) &&
				specifier.imported.name === STORE_SELECTOR_EXPORT
			) {
				localNames.add( specifier.local.name );
				importSpecifiers.push( specifierPath );
			}
		} );
	} );

	return {
		localNames,
		importSpecifiers,
	};
}

function removeStoreSelectorImportSpecifiers( importSpecifiers ) {
	importSpecifiers.forEach( ( specifierPath ) => {
		if ( ! specifierPath.parentPath ) {
			return;
		}

		const importPath = specifierPath.parentPath;
		if ( importPath.node.specifiers.length === 1 ) {
			importPath.remove();
			return;
		}

		specifierPath.remove();
	} );
}

function collectStoreSelectorTemplateVars( componentPath, selectorLocalNames, babel ) {
	const collector = new StoreSelectorCollector( componentPath, selectorLocalNames, babel );
	return collector.collect();
}

class StoreSelectorCollector {
	constructor( componentPath, selectorLocalNames, babel ) {
		this.componentPath = componentPath;
		this.componentFunctionPath = componentPath.get( 'declarations.0.init' );
		this.selectorLocalNames = selectorLocalNames;
		this.babel = babel;
		this.declarations = new Set();
		this.selectorDeclarations = [];
		this.aliasEntries = [];
		this.aliasesByBinding = new WeakMap();
		this.mapCallPaths = new Set();
	}

	collect() {
		if ( this.selectorLocalNames.size === 0 ) {
			return this.createResult();
		}

		this.collectSelectorAssignments();
		this.collectLocalAliases();
		this.collectMapShapes();
		this.collectAliasUsage();
		this.neutralizeSelectorDeclarations();

		return this.createResult();
	}

	createResult() {
		return {
			declarations: this.getFilteredDeclarations(),
			aliases: this.aliasEntries,
			hasSelectors: this.selectorDeclarations.length > 0,
		};
	}

	collectSelectorAssignments() {
		const { types } = this.babel;
		this.componentPath.traverse( {
			CallExpression: ( path ) => {
				if ( this.isInsideNestedFunction( path ) ) {
					return;
				}

				if ( ! this.isStoreSelectorCall( path.node ) ) {
					return;
				}

				const parent = path.parentPath?.node;
				if ( ! types.isVariableDeclarator( parent ) || parent.init !== path.node ) {
					diagnostics.error( path, 'Store selector call must be assigned to a local identifier before use.' );
				}
			},
			VariableDeclarator: ( path ) => {
				if ( this.isInsideNestedFunction( path ) ) {
					return;
				}

				const { id, init } = path.node;
				if ( ! this.isStoreSelectorCall( init ) ) {
					return;
				}

				if ( ! types.isIdentifier( id ) ) {
					diagnostics.error( path, 'Store selector call must be assigned to a local identifier before use.' );
				}

				const selectorSegments = this.parseSelectorCall( init, path );
				this.registerAlias( id.name, selectorSegments, path );
				this.declarations.add( stringifySegments( selectorSegments ) );
				this.selectorDeclarations.push( {
					path,
					segments: selectorSegments,
				} );
			},
		} );
	}

	collectLocalAliases() {
		this.componentPath.traverse( {
			VariableDeclarator: ( path ) => {
				if ( this.isInsideNestedFunction( path ) ) {
					return;
				}

				const { id, init } = path.node;
				if ( ! init || this.isStoreSelectorCall( init ) ) {
					return;
				}

				const sourceSegments = this.resolveExpressionSegments( init, path );
				if ( ! sourceSegments ) {
					return;
				}

				if ( this.babel.types.isIdentifier( id ) ) {
					this.registerAlias( id.name, sourceSegments, path );
					return;
				}

				if ( this.babel.types.isObjectPattern( id ) ) {
					this.registerPatternAliases( id, sourceSegments, path );
				}
			},
			AssignmentExpression: ( path ) => {
				if ( this.isInsideNestedFunction( path ) ) {
					return;
				}

				const { left, right } = path.node;
				if ( ! this.babel.types.isIdentifier( left ) ) {
					return;
				}

				const sourceSegments = this.resolveExpressionSegments( right, path );
				if ( sourceSegments ) {
					this.registerAlias( left.name, sourceSegments, path );
				}
			},
		} );
	}

	collectMapShapes() {
		this.componentPath.traverse( {
			CallExpression: ( path ) => {
				if ( this.isInsideNestedFunction( path ) && ! this.isInsideMapCallback( path ) ) {
					return;
				}

				this.collectMapCallShape( path );
			},
		} );
	}

	collectAliasUsage() {
		this.componentPath.traverse( {
			Identifier: ( path ) => {
				if ( this.isInsideNestedFunction( path ) && ! this.isInsideMapCallback( path ) ) {
					return;
				}

				if ( ! this.isRenderableIdentifierUsage( path ) ) {
					return;
				}

				const segments = this.resolveIdentifierSegments( path.node.name, path );
				if ( ! segments || ! isSelectorDerivedPath( segments ) ) {
					return;
				}

				this.declarations.add( stringifySegments( segments ) );
			},
			MemberExpression: ( path ) => {
				if ( this.isInsideNestedFunction( path ) && ! this.isInsideMapCallback( path ) ) {
					return;
				}

				if ( this.isPartialMemberExpression( path ) || this.isMapCalleeObject( path ) || this.isMapCalleeMember( path ) ) {
					return;
				}

				const segments = this.resolveExpressionSegments( path.node, path );
				if ( ! segments || ! isSelectorDerivedPath( segments ) ) {
					return;
				}

				this.declarations.add( stringifySegments( segments ) );
			},
		} );
	}

	collectMapCallShape( path ) {
		const { types } = this.babel;
		const { node } = path;
		if ( ! types.isMemberExpression( node.callee ) ) {
			return;
		}

		if ( ! types.isIdentifier( node.callee.property ) || node.callee.property.name !== 'map' ) {
			return;
		}

		const sourceSegments = this.resolveExpressionSegments( node.callee.object, path );
		if ( ! sourceSegments || ! isSelectorDerivedPath( sourceSegments ) ) {
			return;
		}

		this.mapCallPaths.add( path );
		const listSegments = markLastSegmentAsList( sourceSegments );
		this.declarations.add( stringifySegments( listSegments ) );

		const callback = node.arguments[ 0 ];
		const firstParam = callback?.params?.[ 0 ];
		if ( ! firstParam ) {
			return;
		}

		const firstParamPath = path.get( 'arguments.0.params.0' );
		if ( types.isIdentifier( firstParam ) ) {
			this.registerAlias( firstParam.name, listSegments, firstParamPath );
			return;
		}

		if ( types.isObjectPattern( firstParam ) ) {
			this.registerPatternAliases( firstParam, listSegments, firstParamPath );
		}
	}

	parseSelectorCall( callExpression, path ) {
		const selector = callExpression.arguments[ 0 ];
		if ( ! selector ) {
			diagnostics.error( path, 'Store selector requires a selector function.' );
		}

		if (
			! this.babel.types.isArrowFunctionExpression( selector ) &&
			! this.babel.types.isFunctionExpression( selector )
		) {
			diagnostics.error( path, 'Store selector must be a function, for example useStoreSelector((state) => state.hero.title).' );
		}

		if ( selector.params.length !== 1 || ! this.babel.types.isIdentifier( selector.params[ 0 ] ) ) {
			diagnostics.error( path, 'Store selector only supports one identifier parameter.' );
		}

		const paramName = selector.params[ 0 ].name;
		let body = selector.body;
		if ( this.babel.types.isBlockStatement( body ) ) {
			const returnStatement = body.body.find( statement => this.babel.types.isReturnStatement( statement ) );
			if ( ! returnStatement || ! returnStatement.argument ) {
				diagnostics.error( path, 'Store selector block functions must return a static member path.' );
			}
			body = returnStatement.argument;
		}

		const segments = this.parseSelectorExpression( body, paramName, path );
		if ( segments.length === 0 ) {
			diagnostics.error( path, 'Store selector must select a child path from state.' );
		}

		return segments;
	}

	parseSelectorExpression( expression, paramName, path ) {
		const { types } = this.babel;
		if ( types.isIdentifier( expression ) ) {
			if ( expression.name !== paramName ) {
				diagnostics.error( path, 'Store selector must read from its selector parameter.' );
			}
			return [];
		}

		if ( expression?.type === 'OptionalMemberExpression' || ( typeof types.isOptionalMemberExpression === 'function' && types.isOptionalMemberExpression( expression ) ) ) {
			diagnostics.error( path, 'Store selector optional chaining is not supported yet; use a static member path.' );
		}

		if ( ! types.isMemberExpression( expression ) ) {
			diagnostics.error( path, 'Store selector must be a static member path, for example useStoreSelector((state) => state.hero.title).' );
		}

		if ( expression.computed ) {
			diagnostics.error( path, 'Store selector does not support computed properties yet.' );
		}

		if ( ! types.isIdentifier( expression.property ) ) {
			diagnostics.error( path, 'Store selector only supports identifier properties.' );
		}

		return [
			...this.parseSelectorExpression( expression.object, paramName, path ),
			expression.property.name,
		];
	}

	isStoreSelectorCall( node ) {
		return (
			node &&
			this.babel.types.isCallExpression( node ) &&
			this.babel.types.isIdentifier( node.callee ) &&
			this.selectorLocalNames.has( node.callee.name )
		);
	}

	registerAlias( localName, segments, path ) {
		const binding = path.scope.getBinding( localName );
		if ( ! binding ) {
			return;
		}

		const normalizedSegments = normalizeSegments( segments );
		const entry = {
			bindingIdentifier: binding.identifier,
			localName,
			segments: normalizedSegments,
		};

		this.aliasesByBinding.set( binding.identifier, entry );
		this.aliasEntries.push( entry );
	}

	registerPatternAliases( pattern, baseSegments, path ) {
		( pattern.properties || [] ).forEach( ( property ) => {
			if ( property.type === 'RestElement' ) {
				return;
			}

			const propertyName = this.getPatternPropertyName( property );
			if ( ! propertyName ) {
				return;
			}

			const propertySegments = [ ...baseSegments, propertyName ];
			const value = property.value;
			if ( this.babel.types.isIdentifier( value ) ) {
				this.registerAlias( value.name, propertySegments, path );
				return;
			}

			if ( this.babel.types.isObjectPattern( value ) ) {
				this.registerPatternAliases( value, propertySegments, path );
			}
		} );
	}

	getPatternPropertyName( property ) {
		if ( this.babel.types.isIdentifier( property.key ) ) {
			return property.key.name;
		}
		if ( this.babel.types.isStringLiteral( property.key ) ) {
			return property.key.value;
		}
		return null;
	}

	resolveExpressionSegments( expression, path ) {
		const { types } = this.babel;
		if ( types.isIdentifier( expression ) ) {
			return this.resolveIdentifierSegments( expression.name, path );
		}

		if ( types.isMemberExpression( expression ) && ! expression.computed && types.isIdentifier( expression.property ) ) {
			const objectSegments = this.resolveExpressionSegments( expression.object, path );
			return objectSegments ? [ ...objectSegments, expression.property.name ] : null;
		}

		return null;
	}

	resolveIdentifierSegments( name, path ) {
		const binding = path.scope.getBinding( name );
		if ( ! binding ) {
			return null;
		}

		const alias = this.aliasesByBinding.get( binding.identifier );
		return alias ? alias.segments : null;
	}

	neutralizeSelectorDeclarations() {
		this.selectorDeclarations.forEach( ( selectorDeclaration ) => {
			selectorDeclaration.path.node.init = this.createNeutralExpression( selectorDeclaration.segments );
		} );
	}

	createNeutralExpression( segments ) {
		const { types } = this.babel;
		const filteredDeclarations = this.getFilteredDeclarations();
		const selectedPath = stringifySegments( segments );
		const isList = filteredDeclarations.some( declaration => getListSourceKeys( declaration ).has( selectedPath ) );

		if ( isList ) {
			return types.arrayExpression( [] );
		}

		return types.objectExpression( [] );
	}

	getFilteredDeclarations() {
		const declarations = Array.from( this.declarations );
		const listSourceKeys = new Set();
		const listRootKeys = new Set();

		declarations.forEach( ( declaration ) => {
			getListSourceKeys( declaration ).forEach( ( sourceKey ) => listSourceKeys.add( sourceKey ) );
			if ( declaration.includes( '[]' ) ) {
				listRootKeys.add( declaration.split( '.' )[ 0 ].replace( /\[\]$/, '' ) );
			}
		} );

		return declarations
			.filter( ( declaration ) => {
				if ( declaration.includes( '[]' ) ) {
					return true;
				}

				const parts = declaration.split( '.' );
				if ( parts.length === 1 && listRootKeys.has( declaration ) ) {
					return false;
				}

				return ! listSourceKeys.has( declaration );
			} )
			.sort();
	}

	isRenderableIdentifierUsage( path ) {
		const parent = path.parentPath?.node;
		if ( ! parent ) {
			return false;
		}

		if ( [ 'VariableDeclarator', 'ObjectProperty', 'MemberExpression', 'ObjectPattern', 'ArrayPattern', 'AssignmentPattern' ].includes( parent.type ) ) {
			return false;
		}

		return true;
	}

	isPartialMemberExpression( path ) {
		return this.babel.types.isMemberExpression( path.parentPath?.node ) && path.parentPath.node.object === path.node;
	}

	isMapCalleeObject( path ) {
		const parent = path.parentPath?.node;
		const grandParent = path.parentPath?.parentPath?.node;
		return (
			this.babel.types.isMemberExpression( parent ) &&
			parent.object === path.node &&
			this.babel.types.isIdentifier( parent.property ) &&
			parent.property.name === 'map' &&
			this.babel.types.isCallExpression( grandParent ) &&
			grandParent.callee === parent
		);
	}

	isMapCalleeMember( path ) {
		const parent = path.parentPath?.node;
		return (
			this.babel.types.isCallExpression( parent ) &&
			parent.callee === path.node &&
			this.babel.types.isIdentifier( path.node.property ) &&
			path.node.property.name === 'map'
		);
	}

	isInsideNestedFunction( path ) {
		const functionParent = path.getFunctionParent();
		return Boolean( functionParent && functionParent !== this.componentFunctionPath );
	}

	isInsideMapCallback( path ) {
		let currentPath = path;
		while ( currentPath && currentPath !== this.componentPath ) {
			if ( this.mapCallPaths.has( currentPath.parentPath ) ) {
				return true;
			}
			currentPath = currentPath.parentPath;
		}
		return false;
	}
}

function createAliasResolver( aliases = [] ) {
	const aliasesByBinding = new WeakMap();
	aliases.forEach( ( alias ) => {
		if ( alias.bindingIdentifier ) {
			aliasesByBinding.set( alias.bindingIdentifier, alias );
		}
	} );

	return function resolveSegments( segments, path ) {
		if ( ! segments || segments.length === 0 ) {
			return segments;
		}

		const binding = path?.scope?.getBinding( segments[ 0 ] );
		if ( binding && aliasesByBinding.has( binding.identifier ) ) {
			return [
				...aliasesByBinding.get( binding.identifier ).segments,
				...segments.slice( 1 ),
			];
		}

		return segments;
	};
}

function getListSourceKeys( declaration ) {
	const parts = declaration.split( '.' );
	const keys = new Set();
	const current = [];

	parts.forEach( ( part ) => {
		if ( part.endsWith( '[]' ) ) {
			current.push( part.slice( 0, -2 ) );
			keys.add( current.join( '.' ) );
			current[ current.length - 1 ] = `${ current[ current.length - 1 ] }[]`;
			return;
		}

		current.push( part );
	} );

	return keys;
}

function markLastSegmentAsList( segments ) {
	const next = normalizeSegments( segments );
	if ( next.length === 0 ) {
		return next;
	}

	const lastIndex = next.length - 1;
	if ( ! next[ lastIndex ].endsWith( '[]' ) ) {
		next[ lastIndex ] = `${ next[ lastIndex ] }[]`;
	}
	return next;
}

function normalizeSegments( segments ) {
	return segments.map( segment => String( segment ) );
}

function stringifySegments( segments ) {
	return normalizeSegments( segments ).join( '.' );
}

function isSelectorDerivedPath( segments ) {
	return Array.isArray( segments ) && segments.length > 0;
}

module.exports = {
	STORE_SELECTOR_MODULE,
	STORE_SELECTOR_EXPORT,
	collectStoreSelectorImports,
	collectStoreSelectorTemplateVars,
	createAliasResolver,
	isStoreSelectorEnabled,
	removeStoreSelectorImportSpecifiers,
};
