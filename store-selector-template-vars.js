const diagnostics = require( './diagnostics' );

const STORE_SELECTOR_MODULE = 'babel-plugin-jsx-template-vars/store';
const STORE_SELECTOR_EXPORT = 'useStoreSelector';
const SAFE_LIST_CHAIN_METHODS = new Set( [
	'filter',
	'slice',
	'sort',
	'toSorted',
	'reverse',
	'toReversed',
] );

function isStoreSelectorEnabled( config = {} ) {
	return config.experimentalStoreSelectors === true || (
		typeof config.experimentalStoreSelectors === 'object' &&
		config.experimentalStoreSelectors !== null
	);
}

function isStoreSelectorDebugEnabled( config = {} ) {
	return config.experimentalStoreSelectorsDebug === true || (
		typeof config.experimentalStoreSelectors === 'object' &&
		config.experimentalStoreSelectors !== null &&
		config.experimentalStoreSelectors.debug === true
	);
}

function collectStoreSelectorImports( programPath, babel ) {
	const { types } = babel;
	const localNames = new Set();
	const localBindings = [];
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
				const binding = specifierPath.scope.getBinding( specifier.local.name );
				if ( binding ) {
					localBindings.push( binding );
				}
				importSpecifiers.push( specifierPath );
			}
		} );
	} );

	return {
		localNames,
		localBindings,
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

function collectStoreSelectorTemplateVars( componentPath, selectorLocalNames, babel, config = {} ) {
	const collector = new StoreSelectorCollector( componentPath, selectorLocalNames, babel, config );
	return collector.collect();
}

function createStoreSelectorPropAliases( componentPath, traces = [], babel ) {
	if ( traces.length === 0 ) {
		return {
			aliases: [],
			declarations: [],
		};
	}

	const functionPath = componentPath.get( 'declarations.0.init' );
	const firstParamPath = functionPath.get( 'params.0' );
	const firstParam = firstParamPath?.node;
	if ( ! firstParam || ! babel.types.isObjectPattern( firstParam ) ) {
		return {
			aliases: [],
			declarations: [],
		};
	}

	const aliases = [];
	const declarations = [];
	traces.forEach( ( trace ) => {
		const bindingPath = findObjectPatternBindingPath( firstParamPath, trace.propName, babel );
		if ( ! bindingPath || ! babel.types.isIdentifier( bindingPath.node ) ) {
			return;
		}

		const binding = bindingPath.scope.getBinding( bindingPath.node.name );
		if ( ! binding ) {
			return;
		}

		const segments = normalizeCanonicalSegments( trace.segments );
		aliases.push( {
			bindingIdentifier: binding.identifier,
			localName: bindingPath.node.name,
			segments,
		} );
		declarations.push( stringifySegments( segments ) );
	} );

	return {
		aliases,
		declarations: Array.from( new Set( declarations ) ).sort(),
	};
}

function findObjectPatternBindingPath( patternPath, propName, babel ) {
	const properties = patternPath.get( 'properties' );
	for ( const propertyPath of properties ) {
		const property = propertyPath.node;
		if ( property.type === 'RestElement' ) {
			continue;
		}

		const key = property.key;
		const keyName = babel.types.isIdentifier( key ) ? key.name : key?.value;
		if ( keyName !== propName ) {
			continue;
		}

		const valuePath = propertyPath.get( 'value' );
		if ( babel.types.isIdentifier( valuePath.node ) ) {
			return valuePath;
		}
	}
	return null;
}

function assertNoUnprocessedStoreSelectorReferences( programPath, selectorImports, babel ) {
	const importBindings = new Set( selectorImports.localBindings || [] );
	if ( importBindings.size === 0 ) {
		return;
	}

	programPath.traverse( {
		Identifier( path ) {
			if ( ! selectorImports.localNames.has( path.node.name ) || ! path.isReferencedIdentifier() ) {
				return;
			}

			const binding = path.scope.getBinding( path.node.name );
			if ( ! binding || ! importBindings.has( binding ) ) {
				return;
			}

			diagnostics.error(
				path,
				'Store selector reference could not be processed. Store selectors are currently supported only in top-level capitalized variable components declared as const App = () => ... .'
			);
		},
	} );
}

class StoreSelectorCollector {
	constructor( componentPath, selectorLocalNames, babel, config = {} ) {
		this.componentPath = componentPath;
		this.componentFunctionPath = componentPath.get( 'declarations.0.init' );
		this.selectorLocalNames = selectorLocalNames;
		this.babel = babel;
		this.config = config;
		this.seedAliases = Array.isArray( config.storeSelectorSeedAliases ) ? config.storeSelectorSeedAliases : [];
		this.declarations = new Set();
		this.selectorDeclarations = [];
		this.aliasEntries = [];
		this.aliasesByBinding = new WeakMap();
		this.mapCallPaths = new Set();
		this.unsupportedChildPropExpressions = new WeakSet();
		this.unsupportedPaths = [];
		this.childPropTraces = [];
	}

	collect() {
		if ( this.selectorLocalNames.size === 0 && this.seedAliases.length === 0 ) {
			return this.createResult();
		}

		this.registerSeedAliases();
		if ( this.selectorLocalNames.size > 0 ) {
			this.collectSelectorAssignments();
		}
		this.collectLocalAliases();
		this.collectMapShapes();
		this.collectLocalAliases();
		this.collectMapShapes();
		this.collectChildComponentPropUsage();
		this.collectAliasUsage();
		this.collectOpaqueHelperUsage();
		this.neutralizeSelectorDeclarations();

		return this.createResult();
	}

	createResult() {
		const rawDeclarations = Array.from( this.declarations ).sort();
		const declarations = this.getFilteredDeclarations();
		return {
			declarations,
			aliases: this.aliasEntries,
			hasSelectors: this.selectorDeclarations.length > 0,
			debug: {
				rawDeclarations,
				declarations,
				aliases: this.aliasEntries.map( ( alias ) => ( {
					localName: alias.localName,
					path: stringifySegments( alias.segments ),
					segments: alias.segments,
					declarationPath: stringifySegments( alias.declarationSegments ),
					declarationSegments: alias.declarationSegments,
					source: alias.source,
				} ) ),
				listShapes: declarations.filter( declaration => declaration.includes( '[]' ) ),
				unsupported: this.unsupportedPaths,
				childPropTraces: this.childPropTraces,
			},
			childPropTraces: this.childPropTraces,
		};
	}

	collectSelectorAssignments() {
		const { types } = this.babel;
		this.componentPath.traverse( {
			CallExpression: ( path ) => {
				if ( this.isInsideNestedFunction( path ) ) {
					if ( this.isStoreSelectorCall( path.node ) ) {
						diagnostics.error( path, 'Store selector calls inside nested functions are not supported before component tracing lands.' );
					}
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
				this.selectorDeclarations.push( {
					path,
					segments: selectorSegments,
				} );
			},
		} );
	}

	collectOpaqueHelperUsage() {
		this.componentPath.traverse( {
			CallExpression: ( path ) => {
				if ( this.isInsideNestedFunction( path ) && ! this.isInsideMapCallback( path ) ) {
					return;
				}

				if ( this.isStoreSelectorCall( path.node ) ) {
					return;
				}

				path.get( 'arguments' ).forEach( ( argumentPath ) => {
				const segments = this.resolveExpressionSegments( argumentPath.node, argumentPath );
				if ( ! segments || ! isSelectorDerivedPath( segments ) ) {
					return;
				}

				const message = `Store selector value "${ stringifySegments( segments ) }" is passed to helper "${ this.getCalleeName( path.node.callee ) }", but helper-body field inference is not supported in this experiment slice.`;
				this.recordUnsupported( 'helper', segments, message );
				diagnostics.unsupported(
					argumentPath,
					message,
					this.config
				);
			} );
			},
		} );
	}

	collectLocalAliases() {
		this.componentPath.traverse( {
			VariableDeclarator: ( path ) => {
				if ( this.isInsideNestedFunction( path ) && ! this.isInsideSupportedMapCallback( path ) ) {
					return;
				}

				const { id, init } = path.node;
				if ( ! init || this.isStoreSelectorCall( init ) ) {
					return;
				}

				const sourceInfo = this.resolveExpressionInfo( init, path );
				if ( ! sourceInfo ) {
					if ( this.isUnsupportedSelectorChainCall( init, path ) ) {
						this.throwUnsupportedListChain( path );
					}
					return;
				}

				if ( this.babel.types.isIdentifier( id ) ) {
					this.registerAlias( id.name, sourceInfo.segments, path, {
						declarationSegments: sourceInfo.declarationSegments,
					} );
					if ( this.isSafeListChainCall( init ) ) {
						this.registerSafeListChainCallbackAliases(
							path.get( 'init' ),
							markLastSegmentAsList( sourceInfo.segments ),
							markLastSegmentAsList( sourceInfo.declarationSegments )
						);
					}
					return;
				}

				if ( this.babel.types.isObjectPattern( id ) ) {
					this.registerPatternAliases( id, sourceInfo.segments, path, {
						declarationSegments: sourceInfo.declarationSegments,
					} );
				}
			},
			AssignmentExpression: ( path ) => {
				if ( this.isInsideNestedFunction( path ) && ! this.isInsideSupportedMapCallback( path ) ) {
					return;
				}

				const { left, right } = path.node;
				if ( ! this.babel.types.isIdentifier( left ) ) {
					return;
				}

				const sourceInfo = this.resolveExpressionInfo( right, path );
				if ( sourceInfo ) {
					this.registerAlias( left.name, sourceInfo.segments, path, {
						declarationSegments: sourceInfo.declarationSegments,
					} );
					return;
				}

				if ( this.isUnsupportedSelectorChainCall( right, path ) ) {
					this.throwUnsupportedListChain( path );
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

				if ( this.isUnsupportedChildPropExpression( path ) ) {
					return;
				}

				const segments = this.resolveIdentifierSegments( path.node.name, path );
				if ( ! segments || ! isSelectorDerivedPath( segments ) ) {
					return;
				}

				this.addDeclarationForExpression( path );
			},
			MemberExpression: ( path ) => {
				if ( this.isInsideNestedFunction( path ) && ! this.isInsideMapCallback( path ) ) {
					return;
				}

				if (
					this.isPartialMemberExpression( path ) ||
					this.isMapCalleeObject( path ) ||
					this.isMapCalleeMember( path ) ||
					this.isSelectorMethodCallee( path ) ||
					this.isUnsupportedChildPropExpression( path )
				) {
					return;
				}

				const segments = this.resolveExpressionSegments( path.node, path );
				if ( ! segments || ! isSelectorDerivedPath( segments ) ) {
					return;
				}

				this.addDeclarationForExpression( path );
			},
		} );
	}

	collectChildComponentPropUsage() {
		this.componentPath.traverse( {
			JSXSpreadAttribute: ( path ) => {
				const openingElement = path.parentPath?.node;
				const elementName = openingElement?.name?.name;
				if ( typeof elementName !== 'string' || ! /^[A-Z]/.test( elementName ) ) {
					return;
				}

				const selectorSources = this.collectSelectorDerivedSegments( path.get( 'argument' ) );
				if ( selectorSources.length === 0 ) {
					return;
				}

				const sourceSegments = selectorSources[ 0 ];
				const message = `Store selector value "${ stringifySegments( sourceSegments ) }" is used in unsupported spread props for child component "${ elementName }".`;
				this.unsupportedChildPropExpressions.add( path.node.argument );
				this.recordUnsupported( 'child-prop-boundary', sourceSegments, message, {
					boundary: 'JSXSpreadAttribute',
					componentName: elementName,
					propName: '<spread>',
				} );
				diagnostics.unsupported(
					path,
					message,
					this.config
				);
			},
			JSXAttribute: ( path ) => {
				const openingElement = path.parentPath?.node;
				const elementName = openingElement?.name?.name;
				if ( typeof elementName !== 'string' || ! /^[A-Z]/.test( elementName ) ) {
					return;
				}

				const value = path.node.value;
				if ( ! this.babel.types.isJSXExpressionContainer( value ) ) {
					return;
				}

				const expressionPath = path.get( 'value.expression' );
				const segments = this.resolveExpressionSegments( value.expression, path );
				if ( ! segments || ! isSelectorDerivedPath( segments ) ) {
					const selectorSources = this.collectSelectorDerivedSegments( expressionPath );
					if ( selectorSources.length === 0 ) {
						return;
					}

					const sourceSegments = selectorSources[ 0 ];
					const message = `Store selector value "${ stringifySegments( sourceSegments ) }" is used in unsupported prop expression for child component "${ elementName }".`;
					this.unsupportedChildPropExpressions.add( value.expression );
					this.recordUnsupported( 'child-prop-boundary', sourceSegments, message, {
						boundary: value.expression.type,
						componentName: elementName,
						propName: path.node.name.name,
					} );
					diagnostics.unsupported(
						path,
						message,
						this.config
					);
					return;
				}

				if ( this.canTraceChildProp( elementName, segments ) ) {
					this.childPropTraces.push( {
						componentName: elementName,
						propName: path.node.name.name,
						path: stringifySegments( segments ),
						segments: normalizeSegments( segments ),
					} );
					return;
				}

				const message = `Store selector value "${ stringifySegments( segments ) }" is passed to child component "${ elementName }", but prop tracing is not supported in this experiment slice.`;
				this.unsupportedChildPropExpressions.add( value.expression );
				this.recordUnsupported( 'child-prop', segments, message );
				diagnostics.unsupported(
					path,
					message,
					this.config
				);
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

		const sourceInfo = this.resolveExpressionInfo( node.callee.object, path );
		if ( ! sourceInfo || ! isSelectorDerivedPath( sourceInfo.segments ) ) {
			if ( this.isUnsupportedSelectorChainCall( node.callee.object, path ) ) {
				this.throwUnsupportedListChain( path );
			}
			return;
		}

		this.mapCallPaths.add( path );
		const listSegments = markLastSegmentAsList( sourceInfo.segments );
		const declarationListSegments = markLastSegmentAsList( sourceInfo.declarationSegments );
		const declaration = stringifySegments( declarationListSegments );
		if ( declaration ) {
			this.declarations.add( declaration );
		}
		this.registerSafeListChainCallbackAliases( path.get( 'callee.object' ), listSegments, declarationListSegments );

		const callback = node.arguments[ 0 ];
		const firstParam = callback?.params?.[ 0 ];
		if ( ! firstParam ) {
			return;
		}

		const firstParamPath = path.get( 'arguments.0.params.0' );
		if ( types.isIdentifier( firstParam ) ) {
			this.registerAlias( firstParam.name, listSegments, firstParamPath, {
				declarationSegments: declarationListSegments,
			} );
			return;
		}

		if ( types.isObjectPattern( firstParam ) ) {
			this.registerPatternAliases( firstParam, listSegments, firstParamPath, {
				declarationSegments: declarationListSegments,
			} );
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

	registerSeedAliases() {
		this.seedAliases.forEach( ( seedAlias ) => {
			if ( ! seedAlias || ! seedAlias.localName || ! Array.isArray( seedAlias.segments ) ) {
				return;
			}

			const binding = this.componentFunctionPath.scope.getBinding( seedAlias.localName );
			if ( ! binding ) {
				return;
			}

			this.registerBindingAlias( binding, seedAlias.localName, seedAlias.segments, {
				declarationSegments: Array.isArray( seedAlias.declarationSegments ) ? seedAlias.declarationSegments : seedAlias.segments,
				source: 'seed',
			} );
		} );
	}

	registerAlias( localName, segments, path, options = {} ) {
		const binding = path.scope.getBinding( localName );
		if ( ! binding ) {
			return;
		}

		this.registerBindingAlias( binding, localName, segments, options );
	}

	registerBindingAlias( binding, localName, segments, options = {} ) {
		const normalizedSegments = normalizeCanonicalSegments( segments );
		const normalizedDeclarationSegments = Array.isArray( options.declarationSegments ) ?
			normalizeCanonicalSegments( options.declarationSegments ) :
			normalizedSegments;
		const existing = this.aliasesByBinding.get( binding.identifier );
		if (
			existing &&
			stringifySegments( existing.segments ) === stringifySegments( normalizedSegments ) &&
			stringifySegments( existing.declarationSegments ) === stringifySegments( normalizedDeclarationSegments )
		) {
			return;
		}

		const entry = {
			bindingIdentifier: binding.identifier,
			localName,
			segments: normalizedSegments,
			declarationSegments: normalizedDeclarationSegments,
			source: options.source || 'local',
		};

		this.aliasesByBinding.set( binding.identifier, entry );
		this.aliasEntries.push( entry );
	}

	registerPatternAliases( pattern, baseSegments, path, options = {} ) {
		const baseDeclarationSegments = Array.isArray( options.declarationSegments ) ? options.declarationSegments : baseSegments;
		( pattern.properties || [] ).forEach( ( property ) => {
			if ( property.type === 'RestElement' ) {
				return;
			}

			const propertyName = this.getPatternPropertyName( property );
			if ( ! propertyName ) {
				return;
			}

			const propertySegments = [ ...baseSegments, propertyName ];
			const propertyDeclarationSegments = [ ...baseDeclarationSegments, propertyName ];
			const value = property.value;
			if ( this.babel.types.isIdentifier( value ) ) {
				this.registerAlias( value.name, propertySegments, path, {
					declarationSegments: propertyDeclarationSegments,
				} );
				return;
			}

			if ( this.babel.types.isObjectPattern( value ) ) {
				this.registerPatternAliases( value, propertySegments, path, {
					declarationSegments: propertyDeclarationSegments,
				} );
			}
		} );
	}

	registerSafeListChainCallbackAliases( expressionPath, listSegments, declarationListSegments = listSegments ) {
		if ( ! expressionPath?.node || ! this.isSafeListChainCall( expressionPath.node ) ) {
			return;
		}

		this.registerSafeListChainCallbackAliases( expressionPath.get( 'callee.object' ), listSegments, declarationListSegments );

		if ( expressionPath.node.callee.property.name !== 'filter' ) {
			return;
		}

		const callback = expressionPath.node.arguments[ 0 ];
		const firstParam = callback?.params?.[ 0 ];
		if ( ! firstParam ) {
			return;
		}

		const firstParamPath = expressionPath.get( 'arguments.0.params.0' );
		if ( this.babel.types.isIdentifier( firstParam ) ) {
			this.registerAlias( firstParam.name, listSegments, firstParamPath, {
				declarationSegments: declarationListSegments,
			} );
			return;
		}

		if ( this.babel.types.isObjectPattern( firstParam ) ) {
			this.registerPatternAliases( firstParam, listSegments, firstParamPath, {
				declarationSegments: declarationListSegments,
			} );
		}
	}

	recordUnsupported( kind, segments, message, details = {} ) {
		this.unsupportedPaths.push( {
			kind,
			path: stringifySegments( segments ),
			segments: normalizeSegments( segments ),
			message,
			...details,
		} );
	}

	canTraceChildProp( componentName, segments ) {
		const componentNames = this.config.storeSelectorComponentNames;
		if ( ! componentNames || ! componentNames.has( componentName ) ) {
			return false;
		}

		const normalizedSegments = normalizeSegments( segments );
		return normalizedSegments.length > 1 && ! normalizedSegments.some( segment => String( segment ).endsWith( '[]' ) );
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

	getCalleeName( callee ) {
		if ( this.babel.types.isIdentifier( callee ) ) {
			return callee.name;
		}

		if ( this.babel.types.isMemberExpression( callee ) && this.babel.types.isIdentifier( callee.property ) ) {
			return callee.property.name;
		}

		return '<unknown>';
	}

	resolveExpressionSegments( expression, path ) {
		const info = this.resolveExpressionInfo( expression, path );
		return info ? info.segments : null;
	}

	resolveExpressionInfo( expression, path ) {
		const { types } = this.babel;
		if ( types.isIdentifier( expression ) ) {
			return this.resolveIdentifierInfo( expression.name, path );
		}

		if ( types.isMemberExpression( expression ) && ! expression.computed && types.isIdentifier( expression.property ) ) {
			const objectInfo = this.resolveExpressionInfo( expression.object, path );
			return objectInfo ? {
				segments: [ ...objectInfo.segments, expression.property.name ],
				declarationSegments: [ ...objectInfo.declarationSegments, expression.property.name ],
			} : null;
		}

		if ( this.isSafeListChainCall( expression ) ) {
			return this.resolveExpressionInfo( expression.callee.object, path );
		}

		return null;
	}

	resolveIdentifierSegments( name, path ) {
		const info = this.resolveIdentifierInfo( name, path );
		return info ? info.segments : null;
	}

	resolveIdentifierInfo( name, path ) {
		const binding = path.scope.getBinding( name );
		if ( ! binding ) {
			return null;
		}

		const alias = this.aliasesByBinding.get( binding.identifier );
		return alias ? {
			segments: alias.segments,
			declarationSegments: alias.declarationSegments || alias.segments,
		} : null;
	}

	addDeclarationForExpression( path ) {
		const info = this.resolveExpressionInfo( path.node, path );
		if ( ! info || ! isSelectorDerivedPath( info.segments ) ) {
			return;
		}

		const declaration = stringifySegments( info.declarationSegments );
		if ( declaration ) {
			this.declarations.add( declaration );
		}
	}

	collectSelectorDerivedSegments( expressionPath ) {
		const found = new Map();
		const addInfo = ( info ) => {
			if ( ! info || ! isSelectorDerivedPath( info.segments ) ) {
				return;
			}
			found.set( stringifySegments( info.segments ), info.segments );
		};

		addInfo( this.resolveExpressionInfo( expressionPath.node, expressionPath ) );
		expressionPath.traverse( {
			Identifier: ( path ) => {
				const parent = path.parentPath?.node;
				if (
					this.babel.types.isMemberExpression( parent ) &&
					(
						( parent.object === path.node && ! parent.computed ) ||
						parent.property === path.node
					)
				) {
					return;
				}
				addInfo( this.resolveIdentifierInfo( path.node.name, path ) );
			},
			MemberExpression: ( path ) => {
				if ( this.isPartialMemberExpression( path ) ) {
					return;
				}
				const info = this.resolveExpressionInfo( path.node, path );
				addInfo( info );
				if ( info ) {
					path.skip();
				}
			},
		} );

		return Array.from( found.values() );
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

	isSelectorMethodCallee( path ) {
		const { types } = this.babel;
		const parent = path.parentPath?.node;
		if ( ! types.isCallExpression( parent ) || parent.callee !== path.node ) {
			return false;
		}

		if ( ! types.isMemberExpression( path.node ) || path.node.computed ) {
			return false;
		}

		const objectSegments = this.resolveExpressionSegments( path.node.object, path );
		return Boolean( objectSegments && isSelectorDerivedPath( objectSegments ) );
	}

	isUnsupportedChildPropExpression( path ) {
		let currentPath = path;
		while ( currentPath && currentPath !== this.componentPath ) {
			if ( this.unsupportedChildPropExpressions.has( currentPath.node ) ) {
				return true;
			}
			currentPath = currentPath.parentPath;
		}
		return false;
	}

	isSafeListChainCall( expression ) {
		const { types } = this.babel;
		return (
			types.isCallExpression( expression ) &&
			types.isMemberExpression( expression.callee ) &&
			! expression.callee.computed &&
			types.isIdentifier( expression.callee.property ) &&
			SAFE_LIST_CHAIN_METHODS.has( expression.callee.property.name )
		);
	}

	isUnsupportedSelectorChainCall( expression, path ) {
		const { types } = this.babel;
		if (
			! types.isCallExpression( expression ) ||
			! types.isMemberExpression( expression.callee ) ||
			expression.callee.computed ||
			! types.isIdentifier( expression.callee.property )
		) {
			return false;
		}

		if ( expression.callee.property.name === 'map' || SAFE_LIST_CHAIN_METHODS.has( expression.callee.property.name ) ) {
			return false;
		}

		const objectSegments = this.resolveExpressionSegments( expression.callee.object, path );
		return Boolean( objectSegments && isSelectorDerivedPath( objectSegments ) );
	}

	throwUnsupportedListChain( path ) {
		diagnostics.error(
			path,
			`Store selector list chains only support ${ Array.from( SAFE_LIST_CHAIN_METHODS ).join( ', ' ) } before .map().`
		);
	}

	isInsideNestedFunction( path ) {
		const functionParent = path.getFunctionParent();
		return Boolean( functionParent && functionParent !== this.componentFunctionPath );
	}

	isInsideSupportedMapCallback( path ) {
		const functionParent = path.getFunctionParent();
		if ( ! functionParent || functionParent === this.componentFunctionPath ) {
			return false;
		}

		const parent = functionParent.parentPath?.node;
		const { types } = this.babel;
		return (
			types.isCallExpression( parent ) &&
			parent.arguments[ 0 ] === functionParent.node &&
			types.isMemberExpression( parent.callee ) &&
			types.isIdentifier( parent.callee.property ) &&
			parent.callee.property.name === 'map'
		);
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
	const next = normalizeCanonicalSegments( segments );
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

function normalizeCanonicalSegments( segments ) {
	return normalizeSegments( segments ).flatMap( segment => String( segment ).split( '.' ).filter( Boolean ) );
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
	assertNoUnprocessedStoreSelectorReferences,
	collectStoreSelectorImports,
	collectStoreSelectorTemplateVars,
	createStoreSelectorPropAliases,
	createAliasResolver,
	isStoreSelectorEnabled,
	isStoreSelectorDebugEnabled,
	removeStoreSelectorImportSpecifiers,
};
