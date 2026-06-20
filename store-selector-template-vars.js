const diagnostics = require( './diagnostics' );
const {
	getComponentFirstParamPath,
	getComponentFunctionPath,
	getComponentName,
} = require( './component-adapter' );

const STORE_SELECTOR_MODULE = 'babel-plugin-jsx-template-vars/store';
const STORE_SELECTOR_EXPORT = 'useStoreSelector';
const REACT_MODULE = 'react';
const SAFE_LIST_CHAIN_METHODS = new Set( [
	'filter',
	'slice',
	'sort',
	'toSorted',
	'reverse',
	'toReversed',
] );
const REACT_STATEFUL_HOOKS = new Set( [
	'useState',
	'useReducer',
	'useRef',
	'useCallback',
	'useEffect',
	'useLayoutEffect',
	'useDeferredValue',
	'useSyncExternalStore',
	'useId',
	'useTransition',
	'useOptimistic',
	'useActionState',
	'useImperativeHandle',
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

function isStaticMemberExpressionNode( expression, babel ) {
	const { types } = babel;
	return Boolean(
		types.isMemberExpression( expression ) ||
		( typeof types.isOptionalMemberExpression === 'function' && types.isOptionalMemberExpression( expression ) ) ||
		expression?.type === 'OptionalMemberExpression'
	) && ! expression.computed;
}

function collectStoreSelectorImports( programPath, babel, config = {} ) {
	const { types } = babel;
	const localNames = new Set();
	const localBindings = [];
	const importSpecifiers = [];
	const reactHookImportSpecifiers = [];
	const configuredLocalNames = new Set();
	const configuredHooks = getConfiguredSelectorHooks( config );

	programPath.get( 'body' ).forEach( ( childPath ) => {
		const node = childPath.node;
		if ( ! types.isImportDeclaration( node ) ) {
			return;
		}

		const source = node.source.value;
		childPath.get( 'specifiers' ).forEach( ( specifierPath ) => {
			const specifier = specifierPath.node;
			if ( source === STORE_SELECTOR_MODULE ) {
				if (
					types.isImportSpecifier( specifier ) &&
					types.isIdentifier( specifier.imported ) &&
					specifier.imported.name === STORE_SELECTOR_EXPORT
				) {
					addSelectorImportSpecifier( specifierPath, localNames, localBindings, importSpecifiers );
				}
				return;
			}

			const configuredHook = configuredHooks.find( hook => hook.source === source && importSpecifierMatchesConfiguredHook( specifier, hook, types ) );
			if ( configuredHook ) {
				addSelectorImportSpecifier( specifierPath, localNames, localBindings, importSpecifiers );
				configuredLocalNames.add( specifier.local.name );
				return;
			}

			if ( source === REACT_MODULE && isReactHookImportSpecifier( specifier, types ) ) {
				reactHookImportSpecifiers.push( specifierPath );
			}
		} );
	} );

	return {
		localNames,
		localBindings,
		importSpecifiers,
		reactHookImportSpecifiers,
		configuredLocalNames,
	};
}

function getConfiguredSelectorHooks( config = {} ) {
	const options = typeof config.experimentalStoreSelectors === 'object' && config.experimentalStoreSelectors !== null ?
		config.experimentalStoreSelectors :
		{};
	const hooks = Array.isArray( options.selectorHooks ) ? options.selectorHooks : [];
	return hooks.filter( hook => (
		hook &&
		typeof hook.source === 'string' &&
		typeof hook.importName === 'string' &&
		( typeof hook.selectorArg === 'undefined' || hook.selectorArg === 0 )
	) );
}

function importSpecifierMatchesConfiguredHook( specifier, hook, types ) {
	if (
		types.isImportSpecifier( specifier ) &&
		types.isIdentifier( specifier.imported ) &&
		specifier.imported.name === hook.importName
	) {
		return true;
	}

	return types.isImportDefaultSpecifier( specifier ) && hook.importName === 'default';
}

function isReactHookImportSpecifier( specifier, types ) {
	if (
		types.isImportSpecifier( specifier ) &&
		types.isIdentifier( specifier.imported ) &&
		( specifier.imported.name === 'useMemo' || REACT_STATEFUL_HOOKS.has( specifier.imported.name ) )
	) {
		return true;
	}

	return types.isImportDefaultSpecifier( specifier ) || types.isImportNamespaceSpecifier( specifier );
}

function addSelectorImportSpecifier( specifierPath, localNames, localBindings, importSpecifiers ) {
	const specifier = specifierPath.node;
	localNames.add( specifier.local.name );
	const binding = specifierPath.scope.getBinding( specifier.local.name );
	if ( binding ) {
		localBindings.push( binding );
	}
	importSpecifiers.push( specifierPath );
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

function removeUnusedImportSpecifiers( importSpecifiers ) {
	importSpecifiers.forEach( ( specifierPath ) => {
		if ( ! specifierPath.parentPath || ! specifierPath.node?.local ) {
			return;
		}

		const localName = specifierPath.node.local.name;
		const binding = specifierPath.scope.getBinding( localName );
		if ( binding && hasLiveBindingReference( specifierPath, localName, binding ) ) {
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

function hasLiveBindingReference( specifierPath, localName, binding ) {
	const programPath = specifierPath.findParent( path => path.isProgram && path.isProgram() );
	if ( ! programPath ) {
		return false;
	}

	let hasReference = false;
	programPath.traverse( {
		Identifier( path ) {
			if ( path.node.name !== localName || ! path.isReferencedIdentifier() ) {
				return;
			}

			if ( path.scope.getBinding( localName ) === binding ) {
				hasReference = true;
				path.stop();
			}
		},
	} );
	return hasReference;
}

function collectStoreSelectorTemplateVars( componentPath, selectorLocalNames, babel, config = {} ) {
	const collector = new StoreSelectorCollector( componentPath, selectorLocalNames, babel, config );
	return collector.collect();
}

function collectTransparentHookSummaries( programPath, selectorImports, babel ) {
	const summariesByBinding = new WeakMap();
	const summaries = [];
	const summaryRecords = [];
	const selectorLocalNames = selectorImports.localNames || new Set();

	getTopLevelHookCandidates( programPath, babel ).forEach( ( candidate ) => {
		const summary = createTransparentSourceHookSummary( candidate, selectorLocalNames, babel );
		if ( ! summary ) {
			return;
		}

		summariesByBinding.set( candidate.binding.identifier, summary );
		summaryRecords.push( summary );
		summaries.push( {
			hookName: summary.hookName,
			returnKind: 'source-selector',
			segments: summary.segments,
			declarationSegments: summary.declarationSegments,
			strategy: summary.strategy,
		} );
	} );

	return {
		summariesByBinding,
		summaryRecords,
		summaries,
	};
}

function getTopLevelHookCandidates( programPath, babel ) {
	const { types } = babel;
	const candidates = [];

	const collectFromDeclarationPath = ( declarationPath ) => {
		if ( ! declarationPath?.node ) {
			return;
		}

		if ( types.isFunctionDeclaration( declarationPath.node ) ) {
			const name = declarationPath.node.id?.name;
			if ( ! isHookName( name ) ) {
				return;
			}
			const binding = declarationPath.scope.getBinding( name );
			if ( binding ) {
				candidates.push( {
					hookName: name,
					binding,
					functionPath: declarationPath,
					declarationPath,
				} );
			}
			return;
		}

		if ( types.isVariableDeclaration( declarationPath.node ) ) {
			declarationPath.get( 'declarations' ).forEach( ( declaratorPath ) => {
				const { id, init } = declaratorPath.node;
				if ( ! types.isIdentifier( id ) || ! isHookName( id.name ) ) {
					return;
				}
				if ( ! types.isArrowFunctionExpression( init ) && ! types.isFunctionExpression( init ) ) {
					return;
				}

				const binding = declaratorPath.scope.getBinding( id.name );
				if ( binding ) {
					candidates.push( {
						hookName: id.name,
						binding,
						functionPath: declaratorPath.get( 'init' ),
						declarationPath,
						declaratorPath,
						constantDeclaration: declarationPath.node.kind === 'const',
					} );
				}
			} );
		}
	};

	programPath.get( 'body' ).forEach( ( childPath ) => {
		if ( types.isExportNamedDeclaration( childPath.node ) && childPath.node.declaration ) {
			collectFromDeclarationPath( childPath.get( 'declaration' ) );
			return;
		}

		collectFromDeclarationPath( childPath );
	} );

	return candidates;
}

function createTransparentSourceHookSummary( candidate, selectorLocalNames, babel ) {
	const { functionPath } = candidate;
	const node = functionPath.node;
	if ( node.async || node.generator || node.params.length > 0 ) {
		if ( hookBodyContainsStoreSelectorCall( functionPath, selectorLocalNames, babel ) ) {
			diagnostics.error( functionPath, `Store selector unsupported-hook-body: hook "${ candidate.hookName }" must be a synchronous zero-argument source hook before it can wrap store selectors.` );
		}
		return null;
	}

	if ( candidate.constantDeclaration === false && hookBodyContainsStoreSelectorCall( functionPath, selectorLocalNames, babel ) ) {
		diagnostics.error( functionPath, `Store selector unsupported-hook-reassignment: hook "${ candidate.hookName }" must be declared with const before it can wrap store selectors.` );
	}

	if ( hookBodyContainsDisallowedHookCall( functionPath, babel ) ) {
		if ( hookBodyContainsStoreSelectorCall( functionPath, selectorLocalNames, babel ) ) {
			diagnostics.error( functionPath, `Store selector unsupported-hook-state-in-body: hook "${ candidate.hookName }" contains runtime hook work and cannot be summarized as static selector data.` );
		}
		return null;
	}

	const summary = summarizeSourceHookReturn( candidate, selectorLocalNames, babel );
	if ( summary ) {
		return summary;
	}

	if ( hookBodyContainsStoreSelectorCall( functionPath, selectorLocalNames, babel ) ) {
		diagnostics.error( functionPath, `Store selector unsupported-hook-body: hook "${ candidate.hookName }" contains store selector calls but does not have a supported single static return.` );
	}
	return null;
}

function summarizeSourceHookReturn( candidate, selectorLocalNames, babel ) {
	const { types } = babel;
	const functionPath = candidate.functionPath;
	const node = functionPath.node;
	const selectorAliases = new Map();

	if ( types.isArrowFunctionExpression( node ) && ! types.isBlockStatement( node.body ) ) {
		const bodyPath = functionPath.get( 'body' );
		return summarizeHookReturnExpression( candidate, bodyPath, selectorAliases, selectorLocalNames, babel );
	}

	if ( ! types.isBlockStatement( node.body ) ) {
		return null;
	}

	const statementPaths = functionPath.get( 'body.body' );
	const returnStatements = statementPaths.filter( statementPath => types.isReturnStatement( statementPath.node ) );
	if ( returnStatements.length !== 1 ) {
		return null;
	}

	for ( const statementPath of statementPaths ) {
		if ( statementPath.node === returnStatements[ 0 ].node ) {
			continue;
		}

		if ( ! types.isVariableDeclaration( statementPath.node ) || statementPath.node.kind !== 'const' ) {
			return null;
		}

		for ( const declaratorPath of statementPath.get( 'declarations' ) ) {
			const { id, init } = declaratorPath.node;
			if ( ! types.isIdentifier( id ) || ! isStoreSelectorCallNode( init, selectorLocalNames, babel ) ) {
				return null;
			}

			const segments = parseStoreSelectorCall( init, declaratorPath, babel );
			selectorAliases.set( id.name, {
				segments,
				declarationSegments: segments,
				neutralizePath: declaratorPath.get( 'init' ),
			} );
		}
	}

	const returnArgumentPath = returnStatements[ 0 ].get( 'argument' );
	if ( ! returnArgumentPath.node ) {
		return null;
	}

	return summarizeHookReturnExpression( candidate, returnArgumentPath, selectorAliases, selectorLocalNames, babel );
}

function summarizeHookReturnExpression( candidate, expressionPath, selectorAliases, selectorLocalNames, babel ) {
	const { types } = babel;
	const expression = expressionPath.node;
	if ( isStoreSelectorCallNode( expression, selectorLocalNames, babel ) ) {
		const segments = parseStoreSelectorCall( expression, expressionPath, babel );
		return {
			hookName: candidate.hookName,
			segments,
			declarationSegments: segments,
			neutralizePaths: [ expressionPath ],
			strategy: 'same-file-source-hook',
		};
	}

	if ( types.isIdentifier( expression ) && selectorAliases.has( expression.name ) ) {
		const alias = selectorAliases.get( expression.name );
		return {
			hookName: candidate.hookName,
			segments: alias.segments,
			declarationSegments: alias.declarationSegments,
			neutralizePaths: [ alias.neutralizePath ],
			strategy: 'same-file-source-hook-alias',
		};
	}

	return null;
}

function neutralizeTransparentHookSummaries( hookSummaries, babel ) {
	if ( ! hookSummaries?.summaryRecords ) {
		return;
	}

	const neutralized = new WeakSet();
	( hookSummaries.summaryRecords || [] ).forEach( ( summary ) => {
		( summary.neutralizePaths || [] ).forEach( ( neutralizePath ) => {
			if ( ! neutralizePath?.node || neutralized.has( neutralizePath.node ) ) {
				return;
			}
			neutralizePath.replaceWith( createNeutralExpressionNode( summary.segments, babel ) );
			neutralized.add( neutralizePath.node );
		} );
	} );
}

function isHookName( name ) {
	return typeof name === 'string' && /^use[A-Z]/.test( name );
}

function isStoreSelectorCallNode( node, selectorLocalNames, babel ) {
	return Boolean(
		node &&
		babel.types.isCallExpression( node ) &&
		babel.types.isIdentifier( node.callee ) &&
		selectorLocalNames.has( node.callee.name )
	);
}

function hookBodyContainsStoreSelectorCall( functionPath, selectorLocalNames, babel ) {
	let found = false;
	functionPath.traverse( {
		CallExpression( path ) {
			if ( isStoreSelectorCallNode( path.node, selectorLocalNames, babel ) ) {
				found = true;
				path.stop();
			}
		},
	} );
	return found;
}

function hookBodyContainsDisallowedHookCall( functionPath, babel ) {
	let found = false;
	functionPath.traverse( {
		CallExpression( path ) {
			const calleeName = getStaticCalleeName( path.node.callee, babel );
			if ( calleeName && REACT_STATEFUL_HOOKS.has( calleeName ) ) {
				found = true;
				path.stop();
			}
		},
		AssignmentExpression( path ) {
			found = true;
			path.stop();
		},
		UpdateExpression( path ) {
			found = true;
			path.stop();
		},
	} );
	return found;
}

function getStaticCalleeName( callee, babel ) {
	if ( babel.types.isIdentifier( callee ) ) {
		return callee.name;
	}

	if (
		babel.types.isMemberExpression( callee ) &&
		! callee.computed &&
		babel.types.isIdentifier( callee.property )
	) {
		return callee.property.name;
	}

	return null;
}

function parseStoreSelectorCall( callExpression, path, babel ) {
	const selector = callExpression.arguments[ 0 ];
	if ( ! selector ) {
		diagnostics.error( path, 'Store selector requires a selector function.' );
	}

	if (
		! babel.types.isArrowFunctionExpression( selector ) &&
		! babel.types.isFunctionExpression( selector )
	) {
		diagnostics.error( path, 'Store selector must be a function, for example useStoreSelector((state) => state.hero.title).' );
	}

	if ( selector.params.length !== 1 || ! babel.types.isIdentifier( selector.params[ 0 ] ) ) {
		diagnostics.error( path, 'Store selector only supports one identifier parameter.' );
	}

	const paramName = selector.params[ 0 ].name;
	let body = selector.body;
	if ( babel.types.isBlockStatement( body ) ) {
		const returnStatement = body.body.find( statement => babel.types.isReturnStatement( statement ) );
		if ( ! returnStatement || ! returnStatement.argument ) {
			diagnostics.error( path, 'Store selector block functions must return a static member path.' );
		}
		body = returnStatement.argument;
	}

	const segments = parseStoreSelectorExpression( body, paramName, path, babel );
	if ( segments.length === 0 ) {
		diagnostics.error( path, 'Store selector must select a child path from state.' );
	}

	return segments;
}

function parseStoreSelectorExpression( expression, paramName, path, babel ) {
	const { types } = babel;
	if ( types.isIdentifier( expression ) ) {
		if ( expression.name !== paramName ) {
			diagnostics.error( path, 'Store selector must read from its selector parameter.' );
		}
		return [];
	}

	const isMemberExpression = types.isMemberExpression( expression ) ||
		( typeof types.isOptionalMemberExpression === 'function' && types.isOptionalMemberExpression( expression ) ) ||
		expression?.type === 'OptionalMemberExpression';
	if ( ! isMemberExpression ) {
		diagnostics.error( path, 'Store selector must be a static member path, for example useStoreSelector((state) => state.hero.title).' );
	}

	if ( expression.computed ) {
		diagnostics.error( path, 'Store selector does not support computed properties yet.' );
	}

	if ( ! types.isIdentifier( expression.property ) ) {
		diagnostics.error( path, 'Store selector only supports identifier properties.' );
	}

	return [
		...parseStoreSelectorExpression( expression.object, paramName, path, babel ),
		expression.property.name,
	];
}

function createNeutralExpressionNode( segments, babel ) {
	const { types } = babel;
	const normalizedSegments = normalizeCanonicalSegments( segments || [] );
	if ( normalizedSegments.some( segment => String( segment ).endsWith( '[]' ) ) ) {
		return types.arrayExpression( [] );
	}
	return types.objectExpression( [] );
}

function createStoreSelectorPropAliases( componentPath, traces = [], babel, config = {} ) {
	if ( traces.length === 0 ) {
		return {
			aliases: [],
			declarations: [],
		};
	}

	if ( traces.every( trace => trace.seedOnly ) ) {
		return {
			aliases: [],
			declarations: [],
		};
	}

	const firstParamPath = getComponentFirstParamPath( componentPath, babel.types );
	const firstParam = firstParamPath?.node;
	if ( firstParam && babel.types.isIdentifier( firstParam ) ) {
		const binding = firstParamPath.scope.getBinding( firstParam.name );
		if ( ! binding ) {
			return {
				aliases: [],
				declarations: [],
			};
		}

		const aliases = [];
		const declarations = [];
		groupChildPropTraces( traces ).forEach( ( propTraces, propName ) => {
			const sourcePaths = new Set( propTraces.map( trace => trace.path || stringifySegments( trace.segments || [] ) ) );
			const componentName = propTraces[ 0 ]?.componentName || 'child component';
			if ( isConfiguredDynamicRootProp( config, componentName, propName ) ) {
				return;
			}

			if (
				sourcePaths.size > 1 &&
				childPropHasObjectRootUsage( componentPath, propName, babel )
			) {
				reportObjectRootMultiSourceAmbiguity( componentPath, propName, propTraces, sourcePaths );
				return;
			}

			if ( isMixedContextAmbiguity( propTraces, sourcePaths ) ) {
				reportMixedContextAmbiguity( componentPath, propName, propTraces, sourcePaths );
				return;
			}

			if ( isListRelativeMultiSourceAmbiguity( propTraces, sourcePaths ) ) {
				reportListRelativeMultiSourceAmbiguity( componentPath, propName, propTraces, sourcePaths );
				return;
			}

			if ( propTraces.some( trace => trace.unsupported || trace.seedOnly ) || sourcePaths.size > 1 ) {
				const sourceList = Array.from( sourcePaths ).filter( Boolean ).join( ', ' );
				const message = `Store selector prop "${ propName }" for child component "${ componentName }" has ambiguous or unsupported sources${ sourceList ? ` (${ sourceList })` : '' }; prop tracing is disabled for this prop.`;
				diagnostics.unsupported( componentPath, message, config );
				return;
			}

			const trace = propTraces[ 0 ];
			const segments = normalizeCanonicalSegments( trace.segments );
			aliases.push( {
				bindingIdentifier: binding.identifier,
				localName: firstParam.name,
				memberName: propName,
				segments,
			} );
			declarations.push( stringifySegments( segments ) );
		} );

		return {
			aliases,
			declarations: Array.from( new Set( declarations ) ).sort(),
		};
	}

	if ( ! firstParam || ! babel.types.isObjectPattern( firstParam ) ) {
		warnUnsupportedChildParamShape( componentPath, traces, config );
		return {
			aliases: [],
			declarations: [],
		};
	}

	const aliases = [];
	const declarations = [];
	groupChildPropTraces( traces ).forEach( ( propTraces, propName ) => {
		const sourcePaths = new Set( propTraces.map( trace => trace.path || stringifySegments( trace.segments || [] ) ) );
		const componentName = propTraces[ 0 ]?.componentName || 'child component';
		if ( isConfiguredDynamicRootProp( config, componentName, propName ) ) {
			return;
		}

		if ( propTraces.every( trace => trace.seedOnly ) ) {
			return;
		}

		if (
			sourcePaths.size > 1 &&
			childPropHasObjectRootUsage( componentPath, propName, babel )
		) {
			reportObjectRootMultiSourceAmbiguity( componentPath, propName, propTraces, sourcePaths );
			return;
		}

		if ( isMixedContextAmbiguity( propTraces, sourcePaths ) ) {
			reportMixedContextAmbiguity( componentPath, propName, propTraces, sourcePaths );
			return;
		}

		if ( isListRelativeMultiSourceAmbiguity( propTraces, sourcePaths ) ) {
			reportListRelativeMultiSourceAmbiguity( componentPath, propName, propTraces, sourcePaths );
			return;
		}

		if ( propTraces.some( trace => trace.unsupported || trace.seedOnly ) || sourcePaths.size > 1 ) {
			const sourceList = Array.from( sourcePaths ).filter( Boolean ).join( ', ' );
			const message = `Store selector prop "${ propName }" for child component "${ componentName }" has ambiguous or unsupported sources${ sourceList ? ` (${ sourceList })` : '' }; prop tracing is disabled for this prop.`;
			diagnostics.unsupported( componentPath, message, config );
			return;
		}

		const trace = propTraces[ 0 ];
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

function createStoreSelectorSeedAliases( componentPath, traces = [], babel, config = {}, relatedTraces = traces ) {
	if ( traces.length === 0 ) {
		return [];
	}

	const firstParamPath = getComponentFirstParamPath( componentPath, babel.types );
	const firstParam = firstParamPath?.node;
	if ( firstParam && babel.types.isIdentifier( firstParam ) ) {
		const binding = firstParamPath.scope.getBinding( firstParam.name );
		if ( ! binding ) {
			return [];
		}

		const seedAliases = [];
		const relatedTracesByProp = groupChildPropTraces( relatedTraces );
		groupChildPropTraces( traces ).forEach( ( propTraces, propName ) => {
			const validationTraces = relatedTracesByProp.get( propName ) || propTraces;
			const sourcePaths = new Set( validationTraces.map( trace => trace.path || stringifySegments( trace.segments || [] ) ) );
			const componentName = propTraces[ 0 ]?.componentName || 'child component';
			if ( isConfiguredDynamicRootProp( config, componentName, propName ) ) {
				return;
			}

			if ( isObjectRootMultiSourceSeedAmbiguity( validationTraces, sourcePaths ) ) {
				reportObjectRootMultiSourceAmbiguity( componentPath, propName, propTraces, sourcePaths );
				return;
			}

			if ( isMixedContextAmbiguity( validationTraces, sourcePaths ) ) {
				reportMixedContextAmbiguity( componentPath, propName, validationTraces, sourcePaths );
				return;
			}

			if ( isListRelativeMultiSourceAmbiguity( validationTraces, sourcePaths ) ) {
				reportListRelativeMultiSourceAmbiguity( componentPath, propName, validationTraces, sourcePaths );
				return;
			}

			if (
				validationTraces.some( trace => trace.unsupported || ! trace.seedOnly ) ||
				( sourcePaths.size > 1 && ! isListRelativeMultiSourceSeed( validationTraces, sourcePaths ) )
			) {
				const sourceList = Array.from( sourcePaths ).filter( Boolean ).join( ', ' );
				const message = `Store selector seed prop "${ propName }" for child component "${ componentName }" has ambiguous or unsupported sources${ sourceList ? ` (${ sourceList })` : '' }; seed tracing is disabled for this prop.`;
				recordUnsupportedSeedTrace( config, componentName, propName, validationTraces, sourcePaths, message );
				diagnostics.unsupported( componentPath, message, config );
				return;
			}

			seedAliases.push( {
				localName: firstParam.name,
				memberName: propName,
				segments: normalizeCanonicalSegments( propTraces[ 0 ].segments ),
				declarationSegments: normalizeCanonicalSegments( propTraces[ 0 ].declarationSegments || propTraces[ 0 ].segments ),
				dynamicRoot: propTraces[ 0 ].dynamicRoot === true,
				dynamicRootSegments: propTraces[ 0 ].dynamicRoot === true ?
					normalizeCanonicalSegments( propTraces[ 0 ].dynamicRootSegments || propTraces[ 0 ].declarationSegments || propTraces[ 0 ].segments ) :
					undefined,
				propName,
			} );
		} );

		return seedAliases;
	}

	if ( ! firstParam || ! babel.types.isObjectPattern( firstParam ) ) {
		warnUnsupportedChildParamShape( componentPath, traces, config );
		return [];
	}

	const seedAliases = [];
	const relatedTracesByProp = groupChildPropTraces( relatedTraces );
	groupChildPropTraces( traces ).forEach( ( propTraces, propName ) => {
		const validationTraces = relatedTracesByProp.get( propName ) || propTraces;
		const sourcePaths = new Set( validationTraces.map( trace => trace.path || stringifySegments( trace.segments || [] ) ) );
		const componentName = propTraces[ 0 ]?.componentName || 'child component';
		if ( isConfiguredDynamicRootProp( config, componentName, propName ) ) {
			return;
		}

		if ( isObjectRootMultiSourceSeedAmbiguity( validationTraces, sourcePaths ) ) {
			reportObjectRootMultiSourceAmbiguity( componentPath, propName, propTraces, sourcePaths );
			return;
		}

		if ( isMixedContextAmbiguity( validationTraces, sourcePaths ) ) {
			reportMixedContextAmbiguity( componentPath, propName, validationTraces, sourcePaths );
			return;
		}

		if ( isListRelativeMultiSourceAmbiguity( validationTraces, sourcePaths ) ) {
			reportListRelativeMultiSourceAmbiguity( componentPath, propName, validationTraces, sourcePaths );
			return;
		}

		if (
			validationTraces.some( trace => trace.unsupported || ! trace.seedOnly ) ||
			( sourcePaths.size > 1 && ! isListRelativeMultiSourceSeed( validationTraces, sourcePaths ) )
		) {
			const sourceList = Array.from( sourcePaths ).filter( Boolean ).join( ', ' );
			const message = `Store selector seed prop "${ propName }" for child component "${ componentName }" has ambiguous or unsupported sources${ sourceList ? ` (${ sourceList })` : '' }; seed tracing is disabled for this prop.`;
			recordUnsupportedSeedTrace( config, componentName, propName, validationTraces, sourcePaths, message );
			diagnostics.unsupported( componentPath, message, config );
			return;
		}

		const bindingPath = findObjectPatternBindingPath( firstParamPath, propName, babel );
		if ( ! bindingPath || ! babel.types.isIdentifier( bindingPath.node ) ) {
			return;
		}

		seedAliases.push( {
			localName: bindingPath.node.name,
			segments: normalizeCanonicalSegments( propTraces[ 0 ].segments ),
			declarationSegments: normalizeCanonicalSegments( propTraces[ 0 ].declarationSegments || propTraces[ 0 ].segments ),
			dynamicRoot: propTraces[ 0 ].dynamicRoot === true,
			dynamicRootSegments: propTraces[ 0 ].dynamicRoot === true ?
				normalizeCanonicalSegments( propTraces[ 0 ].dynamicRootSegments || propTraces[ 0 ].declarationSegments || propTraces[ 0 ].segments ) :
				undefined,
			propName,
		} );
	} );

	return seedAliases;
}

function createStoreSelectorDynamicRootAliases( componentPath, traces = [], babel ) {
	if ( traces.length === 0 ) {
		return [];
	}

	const firstParamPath = getComponentFirstParamPath( componentPath, babel.types );
	const firstParam = firstParamPath?.node;
	if ( ! firstParam || ( ! babel.types.isObjectPattern( firstParam ) && ! babel.types.isIdentifier( firstParam ) ) ) {
		return [];
	}

	const aliases = [];
	groupChildPropTraces( traces ).forEach( ( propTraces, propName ) => {
		const sourcePaths = new Set( propTraces.map( trace => trace.path || stringifySegments( trace.segments || [] ) ) );
		if (
			( sourcePaths.size <= 1 && ! propTraces.some( trace => trace.dynamicRoot ) ) ||
			propTraces.some( trace => traceHasListContext( trace ) ) ||
			propTraces.some( trace => trace.unsupported ) ||
			! childPropHasObjectRootUsage( componentPath, propName, babel )
		) {
			return;
		}

		if ( babel.types.isIdentifier( firstParam ) ) {
			aliases.push( {
				localName: firstParam.name,
				memberName: propName,
				segments: [ firstParam.name, propName ],
				declarationSegments: [ firstParam.name, propName ],
				dynamicRoot: true,
				dynamicRootSegments: [ firstParam.name, propName ],
				propName,
			} );
			return;
		}

		const bindingPath = findObjectPatternBindingPath( firstParamPath, propName, babel );
		if ( ! bindingPath || ! babel.types.isIdentifier( bindingPath.node ) ) {
			return;
		}

		aliases.push( {
			localName: bindingPath.node.name,
			segments: [ bindingPath.node.name ],
			declarationSegments: [ bindingPath.node.name ],
			dynamicRoot: true,
			dynamicRootSegments: [ bindingPath.node.name ],
			propName,
		} );
	} );

	return aliases;
}

function isObjectRootMultiSourceSeedAmbiguity( traces, sourcePaths ) {
	return sourcePaths.size > 1 &&
		traces.length > 0 &&
		traces.every( trace => trace.seedOnly && ! trace.unsupported && ! traceHasListContext( trace ) );
}

function isMixedContextAmbiguity( traces, sourcePaths ) {
	return sourcePaths.size > 1 &&
		traces.length > 0 &&
		traces.some( trace => traceHasListContext( trace ) ) &&
		traces.some( trace => ! traceHasListContext( trace ) );
}

function traceHasListContext( trace ) {
	const segments = [
		...normalizeCanonicalSegments( trace.segments || [] ),
		...normalizeCanonicalSegments( trace.declarationSegments || [] ),
	];
	return segments.some( segment => String( segment ).endsWith( '[]' ) );
}

function isListRelativeMultiSourceAmbiguity( traces, sourcePaths ) {
	return sourcePaths.size > 1 &&
		traces.length > 0 &&
		traces.every( trace => trace.seedOnly && ! trace.unsupported && traceHasListContext( trace ) ) &&
		! isListRelativeMultiSourceSeed( traces, sourcePaths );
}

function isListRelativeMultiSourceSeed( traces, sourcePaths ) {
	if (
		sourcePaths.size <= 1 ||
		traces.length === 0 ||
		! traces.every( trace => trace.seedOnly && ! trace.unsupported && traceHasListContext( trace ) )
	) {
		return false;
	}

	const declarationKeys = new Set( traces.map( trace => normalizeCanonicalSegments(
		trace.declarationSegments || trace.segments || []
	).join( '.' ) ) );
	return declarationKeys.size === 1;
}

function recordUnsupportedSeedTrace( config, componentName, propName, traces, sourcePaths, message ) {
	if ( ! Array.isArray( config.storeSelectorUnsupportedRecords ) ) {
		return;
	}

	config.storeSelectorUnsupportedRecords.push( {
		componentName,
		unsupported: {
			kind: 'seed-prop',
			propName,
			target: `${ componentName }.${ propName }`,
			path: Array.from( sourcePaths ).filter( Boolean ).join( '|' ),
			segments: [],
			message,
			sourcePaths: Array.from( sourcePaths ).filter( Boolean ),
			sourceSegments: traces
				.map( trace => normalizeCanonicalSegments( trace.segments || [] ) )
				.filter( segments => segments.length > 0 ),
		},
	} );
}

function reportObjectRootMultiSourceAmbiguity( componentPath, propName, traces, sourcePaths ) {
	const componentName = traces[ 0 ]?.componentName || getStoreSelectorComponentName( componentPath );
	const sourceList = Array.from( sourcePaths ).filter( Boolean ).join( ', ' );
	const message = `Store selector object-root-multi-source-ambiguity: prop "${ propName }" for child component "${ componentName }" receives multiple object roots${ sourceList ? ` (${ sourceList })` : '' }. Selector object-root tracing cannot safely choose one source for every callsite yet.`;
	diagnostics.error( componentPath, message );
}

function reportMixedContextAmbiguity( componentPath, propName, traces, sourcePaths ) {
	const componentName = traces[ 0 ]?.componentName || getStoreSelectorComponentName( componentPath );
	const sourceList = Array.from( sourcePaths ).filter( Boolean ).join( ', ' );
	const message = `Store selector mixed-context-ambiguity: prop "${ propName }" for child component "${ componentName }" is used across list and non-list selector contexts${ sourceList ? ` (${ sourceList })` : '' }. Split the component or use distinct props so the template output does not partially render.`;
	diagnostics.error( componentPath, message );
}

function reportListRelativeMultiSourceAmbiguity( componentPath, propName, traces, sourcePaths ) {
	const componentName = traces[ 0 ]?.componentName || getStoreSelectorComponentName( componentPath );
	const sourceList = Array.from( sourcePaths ).filter( Boolean ).join( ', ' );
	const declarationPaths = Array.from( new Set(
		traces.map( trace => stringifySegments( trace.declarationSegments || trace.segments || [] ) )
	) ).filter( Boolean ).join( ', ' );
	const message = `Store selector list-relative-multi-source-ambiguity: prop "${ propName }" for child component "${ componentName }" receives incompatible list-relative sources${ sourceList ? ` (${ sourceList })` : '' }${ declarationPaths ? ` with declaration paths (${ declarationPaths })` : '' }. Compatible list-relative reuse requires the same child-relative shape.`;
	diagnostics.error( componentPath, message );
}

function isConfiguredDynamicRootProp( config, componentName, propName ) {
	const propsByComponent = config.storeSelectorDynamicRootPropsByComponent || {};
	const props = propsByComponent[ componentName ];
	return Array.isArray( props ) && props.includes( propName );
}

function childPropHasObjectRootUsage( componentPath, propName, babel ) {
	const firstParamPath = getComponentFirstParamPath( componentPath, babel.types );
	const firstParam = firstParamPath?.node;
	if ( ! firstParam ) {
		return false;
	}

	if ( babel.types.isIdentifier( firstParam ) ) {
		const binding = firstParamPath.scope.getBinding( firstParam.name );
		if ( ! binding ) {
			return false;
		}

		return binding.referencePaths.some( referencePath => isPropsObjectMemberRootUsage( referencePath, propName, babel ) );
	}

	if ( ! babel.types.isObjectPattern( firstParam ) ) {
		return false;
	}

	const bindingPath = findObjectPatternBindingPath( firstParamPath, propName, babel );
	if ( ! bindingPath || ! babel.types.isIdentifier( bindingPath.node ) ) {
		return false;
	}

	const binding = bindingPath.scope.getBinding( bindingPath.node.name );
	if ( ! binding ) {
		return false;
	}

	return binding.referencePaths.some( referencePath => isBindingObjectRootUsage( referencePath, babel ) );
}

function childComponentPassesThroughChildren( componentPath, babel ) {
	const firstParamPath = getComponentFirstParamPath( componentPath, babel.types );
	const firstParam = firstParamPath?.node;
	if ( ! firstParam ) {
		return false;
	}

	if ( babel.types.isIdentifier( firstParam ) ) {
		const binding = firstParamPath.scope.getBinding( firstParam.name );
		if ( ! binding || binding.referencePaths.length === 0 ) {
			return false;
		}

		return binding.referencePaths.every( referencePath => isPropsChildrenPassthroughUsage( referencePath, babel ) );
	}

	if ( ! babel.types.isObjectPattern( firstParam ) ) {
		return false;
	}

	const bindingPath = findObjectPatternBindingPath( firstParamPath, 'children', babel );
	if ( ! bindingPath || ! babel.types.isIdentifier( bindingPath.node ) ) {
		return false;
	}

	const binding = bindingPath.scope.getBinding( bindingPath.node.name );
	if ( ! binding || binding.referencePaths.length === 0 ) {
		return false;
	}

	return binding.referencePaths.every( referencePath => isDirectJSXExpressionUsage( referencePath ) );
}

function isPropsObjectMemberRootUsage( referencePath, propName, babel ) {
	const memberPath = referencePath.parentPath;
	if (
		! memberPath ||
		! isStaticMemberExpressionNode( memberPath.node, babel ) ||
		memberPath.node.object !== referencePath.node ||
		! babel.types.isIdentifier( memberPath.node.property, { name: propName } )
	) {
		return false;
	}

	return isBindingObjectRootUsage( memberPath, babel );
}

function isPropsChildrenPassthroughUsage( referencePath, babel ) {
	const memberPath = referencePath.parentPath;
	if (
		! memberPath ||
		! isStaticMemberExpressionNode( memberPath.node, babel ) ||
		memberPath.node.object !== referencePath.node ||
		! babel.types.isIdentifier( memberPath.node.property, { name: 'children' } )
	) {
		return false;
	}

	return isDirectJSXExpressionUsage( memberPath );
}

function isDirectJSXExpressionUsage( referencePath ) {
	const parentPath = referencePath.parentPath;
	return Boolean(
		parentPath?.node?.type === 'JSXExpressionContainer' &&
		parentPath.node.expression === referencePath.node
	);
}

function isBindingObjectRootUsage( referencePath, babel ) {
	const parentPath = referencePath.parentPath;
	if ( ! parentPath ) {
		return false;
	}

	if (
		isStaticMemberExpressionNode( parentPath.node, babel ) &&
		parentPath.node.object === referencePath.node
	) {
		return true;
	}

	if (
		babel.types.isVariableDeclarator( parentPath.node ) &&
		parentPath.node.init === referencePath.node &&
		(
			babel.types.isObjectPattern( parentPath.node.id ) ||
			babel.types.isIdentifier( parentPath.node.id )
		)
	) {
		return true;
	}

	if (
		babel.types.isAssignmentExpression( parentPath.node ) &&
		parentPath.node.right === referencePath.node &&
		babel.types.isIdentifier( parentPath.node.left )
	) {
		return true;
	}

	if (
		babel.types.isJSXExpressionContainer( parentPath.node ) &&
		babel.types.isJSXAttribute( parentPath.parentPath?.node ) &&
		parentPath.node.expression === referencePath.node
	) {
		return true;
	}

	return false;
}

function warnUnsupportedChildParamShape( componentPath, traces, config ) {
	const componentName = getStoreSelectorComponentName( componentPath );
	const propNames = Array.from( new Set( traces.map( trace => trace.propName ).filter( Boolean ) ) );
	const propList = propNames.length > 0 ? ` for prop${ propNames.length === 1 ? '' : 's' } "${ propNames.join( ', ' ) }"` : '';
	const exampleProp = propNames[ 0 ] || 'value';
	const message = `Store selector tracing for child component "${ componentName }" requires a destructured object or props object parameter, for example ({ ${ exampleProp } }) => ... or (props) => props.${ exampleProp }; tracing is disabled${ propList }.`;
	diagnostics.unsupported( componentPath, message, config );
}

function getStoreSelectorComponentName( componentPath ) {
	return getComponentName( componentPath ) || 'child component';
}

function groupChildPropTraces( traces ) {
	const tracesByProp = new Map();
	traces.forEach( ( trace ) => {
		if ( ! trace || ! trace.propName ) {
			return;
		}

		if ( ! tracesByProp.has( trace.propName ) ) {
			tracesByProp.set( trace.propName, [] );
		}
		tracesByProp.get( trace.propName ).push( trace );
	} );
	return tracesByProp;
}

function collectStoreSelectorChildPropFlows( selectorResult, childPropTracesByComponent, childSeedTracesByComponent ) {
	( selectorResult.childPropTraces || [] ).forEach( ( trace ) => {
		pushChildPropFlow( childPropTracesByComponent, trace.componentName, trace );
	} );

	( selectorResult.childPropSeedTraces || [] ).forEach( ( trace ) => {
		const seedTrace = {
			...trace,
			seedOnly: true,
		};
		pushChildPropFlow( childPropTracesByComponent, trace.componentName, seedTrace );
		pushChildPropFlow( childSeedTracesByComponent, trace.componentName, seedTrace );
	} );

	( selectorResult.debug.unsupported || [] ).forEach( ( unsupported ) => {
		if (
			! unsupported.componentName ||
			! unsupported.propName ||
			! [ 'child-prop', 'child-prop-boundary' ].includes( unsupported.kind )
		) {
			return;
		}

		pushChildPropFlow( childPropTracesByComponent, unsupported.componentName, {
			componentName: unsupported.componentName,
			propName: unsupported.propName,
			path: unsupported.path,
			segments: unsupported.segments,
			unsupported: true,
			message: unsupported.message,
		} );
	} );
}

function pushChildPropFlow( flowsByComponent, componentName, flow ) {
	if ( ! componentName ) {
		return;
	}

	if ( ! flowsByComponent.has( componentName ) ) {
		flowsByComponent.set( componentName, [] );
	}
	flowsByComponent.get( componentName ).push( flow );
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
				'Store selector reference could not be processed. Store selectors are currently supported only in top-level capitalized components with a statically supported function body.'
			);
		},
	} );
}

class StoreSelectorCollector {
	constructor( componentPath, selectorLocalNames, babel, config = {} ) {
		this.componentPath = componentPath;
		this.componentFunctionPath = getComponentFunctionPath( componentPath, babel.types );
		this.selectorLocalNames = selectorLocalNames;
		this.babel = babel;
		this.config = config;
		this.seedAliases = Array.isArray( config.storeSelectorSeedAliases ) ? config.storeSelectorSeedAliases : [];
		this.declarations = new Set();
		this.declarationProvenance = new Map();
		this.selectorDeclarations = [];
		this.transparentHookDeclarations = [];
		this.aliasEntries = [];
		this.aliasesByBinding = new WeakMap();
		this.memberAliasesByBinding = new WeakMap();
		this.mapCallPaths = new Set();
		this.unsupportedChildPropExpressions = new WeakSet();
		this.unsupportedHookArgumentExpressions = new WeakSet();
		this.unsupportedPaths = [];
		this.childPropTraces = [];
		this.childPropSeedTraces = [];
		this.hookTaintsByBinding = new WeakMap();
		this.hookSetterTargetsByBinding = new WeakMap();
		this.refBindings = new WeakSet();
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
		this.collectHookTaints();
		this.collectChildComponentPropUsage();
		this.collectAliasUsage();
		this.collectOpaqueHelperUsage();
		if ( this.config.storeSelectorNeutralizeSelectors !== false ) {
			this.neutralizeSelectorDeclarations();
			this.neutralizeTransparentHookDeclarations();
		}

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
					memberName: alias.memberName,
					path: stringifySegments( alias.segments ),
					segments: alias.segments,
					declarationPath: stringifySegments( alias.declarationSegments ),
					declarationSegments: alias.declarationSegments,
					source: alias.source,
				} ) ),
				listShapes: declarations.filter( declaration => declaration.includes( '[]' ) ),
				declarationProvenance: this.getDeclarationProvenance( declarations ),
				unsupported: this.unsupportedPaths,
				childPropTraces: this.childPropTraces,
			},
			childPropTraces: this.childPropTraces,
			childPropSeedTraces: this.childPropSeedTraces,
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
				this.registerAlias( id.name, selectorSegments, path, {
					source: this.config.storeSelectorConfiguredLocalNames?.has?.( init.callee.name ) ?
						'configured-selector-hook' :
						'selector',
				} );
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

				if ( this.isReactHookCall( path.node, path ) ) {
					return;
				}

				if ( this.isHookLikeUseMemoCall( path.node ) ) {
					const selectorSources = this.collectSelectorDerivedSegmentsFromPaths( path.get( 'arguments' ) );
					if ( selectorSources.length > 0 ) {
						diagnostics.error(
							path,
							`Store selector unsupported-hook-call: useMemo must be imported from React before it can summarize selector-derived values such as "${ stringifySegments( selectorSources[ 0 ] ) }".`
						);
					}
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

				const sourceInfo = this.resolveExpressionInfo( init, path.get( 'init' ) );
				if ( ! sourceInfo ) {
					if ( this.isUnsupportedSelectorChainCall( init, path ) ) {
						this.throwUnsupportedListChain( path );
					}
					return;
				}

				if ( sourceInfo.transparentHook && path.parentPath?.node?.kind !== 'const' ) {
					diagnostics.error(
						path,
						`Store selector unsupported-hook-reassignment: transparent hook result "${ id.name || '<pattern>' }" must be assigned with const before it can be used as static template data.`
					);
				}

				if ( sourceInfo.transparentHook ) {
					this.transparentHookDeclarations.push( {
						path,
						segments: sourceInfo.segments,
					} );
				}

				if ( this.babel.types.isIdentifier( id ) ) {
					this.registerAlias( id.name, sourceInfo.segments, path, {
						declarationSegments: sourceInfo.declarationSegments,
						dynamicRoot: sourceInfo.dynamicRoot,
						dynamicRootSegments: sourceInfo.dynamicRootSegments,
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
						dynamicRoot: sourceInfo.dynamicRoot,
						dynamicRootSegments: sourceInfo.dynamicRootSegments,
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

				const sourceInfo = this.resolveExpressionInfo( right, path.get( 'right' ) );
				if ( sourceInfo ) {
					if ( sourceInfo.transparentHook ) {
						diagnostics.error(
							path,
							`Store selector unsupported-hook-reassignment: transparent hook result "${ left.name }" must be assigned in a const declaration before it can be used as static template data.`
						);
					}
					this.registerAlias( left.name, sourceInfo.segments, path, {
						declarationSegments: sourceInfo.declarationSegments,
						dynamicRoot: sourceInfo.dynamicRoot,
						dynamicRootSegments: sourceInfo.dynamicRootSegments,
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

	collectHookTaints() {
		const { types } = this.babel;
		this.componentPath.traverse( {
			VariableDeclarator: ( path ) => {
				if ( this.isInsideNestedFunction( path ) && ! this.isInsideMapCallback( path ) ) {
					return;
				}

				const { id, init } = path.node;
				if ( ! types.isCallExpression( init ) ) {
					return;
				}

				const hookName = this.getReactHookCallName( init, path );
				if ( ! hookName ) {
					return;
				}

				if ( hookName === 'useState' || hookName === 'useReducer' ) {
					this.collectStateHookTaint( path, hookName );
					return;
				}

				if ( hookName === 'useRef' ) {
					this.collectRefHookTaint( path );
					return;
				}

				if ( hookName === 'useCallback' ) {
					this.collectCallbackHookTaint( path );
				}
			},
			CallExpression: ( path ) => {
				if ( this.isInsideNestedFunction( path ) && ! this.isInsideMapCallback( path ) ) {
					return;
				}

				const hookName = this.getReactHookCallName( path.node, path );
				if ( hookName === 'useEffect' || hookName === 'useLayoutEffect' ) {
					const selectorSources = this.collectSelectorDerivedSegmentsFromPaths( path.get( 'arguments' ) );
					if ( selectorSources.length > 0 ) {
						this.recordUnsupported( 'unsupported-hook-argument-flow', selectorSources[ 0 ], `Store selector value "${ stringifySegments( selectorSources[ 0 ] ) }" is used inside ${ hookName }; effect-only hook usage is ignored by template output.`, {
							hookName,
							sourcePaths: selectorSources.map( source => stringifySegments( source ) ),
							sourceSegments: selectorSources.map( source => normalizeSegments( source ) ),
						} );
					}
				}

				const callee = path.node.callee;
				if ( ! types.isIdentifier( callee ) ) {
					return;
				}

				const binding = path.scope.getBinding( callee.name );
				const stateTarget = binding ? this.hookSetterTargetsByBinding.get( binding.identifier ) : null;
				if ( ! stateTarget ) {
					return;
				}

				const selectorSources = this.collectSelectorDerivedSegmentsFromPaths( path.get( 'arguments' ) );
				if ( selectorSources.length === 0 ) {
					return;
				}

				this.markPathsAsUnsupportedHookArguments( path.get( 'arguments' ) );
				const taint = this.createHookTaint( 'unsupported-hook-state-flow', 'useState setter', selectorSources, path );
				this.hookTaintsByBinding.set( stateTarget.stateBinding.identifier, taint );
				this.recordUnsupportedHookTaint( taint );
			},
			AssignmentExpression: ( path ) => {
				if ( this.isInsideNestedFunction( path ) && ! this.isInsideMapCallback( path ) ) {
					return;
				}

				const { left, right } = path.node;
				if ( ! this.isRefCurrentMemberExpression( left ) ) {
					return;
				}

				const refBinding = path.scope.getBinding( left.object.name );
				if ( ! refBinding || ! this.refBindings.has( refBinding.identifier ) ) {
					return;
				}

				const rightPath = path.get( 'right' );
				const selectorSources = this.collectSelectorDerivedSegments( rightPath );
				if ( selectorSources.length === 0 ) {
					return;
				}

				this.unsupportedHookArgumentExpressions.add( right );
				const taint = this.createHookTaint( 'unsupported-hook-ref-flow', 'useRef.current', selectorSources, path );
				this.hookTaintsByBinding.set( refBinding.identifier, taint );
				this.recordUnsupportedHookTaint( taint );
			},
		} );
	}

	collectStateHookTaint( path, hookName ) {
		const { types } = this.babel;
		const { id, init } = path.node;
		if ( ! types.isArrayPattern( id ) ) {
			return;
		}

		const stateElement = id.elements[ 0 ];
		const setterElement = id.elements[ 1 ];
		if ( ! types.isIdentifier( stateElement ) ) {
			return;
		}

		const stateBinding = path.scope.getBinding( stateElement.name );
		if ( ! stateBinding ) {
			return;
		}

		if ( types.isIdentifier( setterElement ) ) {
			const setterBinding = path.scope.getBinding( setterElement.name );
			if ( setterBinding ) {
				this.hookSetterTargetsByBinding.set( setterBinding.identifier, {
					stateBinding,
					hookName,
				} );
			}
		}

		const argumentPaths = path.get( 'init.arguments' ).slice( hookName === 'useReducer' ? 1 : 0 );
		const selectorSources = this.collectSelectorDerivedSegmentsFromPaths( argumentPaths );
		if ( selectorSources.length === 0 ) {
			return;
		}

		this.markPathsAsUnsupportedHookArguments( argumentPaths );
		const taint = this.createHookTaint( 'unsupported-hook-state-flow', hookName, selectorSources, path );
		this.hookTaintsByBinding.set( stateBinding.identifier, taint );
		this.recordUnsupportedHookTaint( taint );
	}

	collectRefHookTaint( path ) {
		const { types } = this.babel;
		const { id } = path.node;
		if ( ! types.isIdentifier( id ) ) {
			return;
		}

		const refBinding = path.scope.getBinding( id.name );
		if ( ! refBinding ) {
			return;
		}

		this.refBindings.add( refBinding.identifier );
		const argumentPaths = path.get( 'init.arguments' );
		const selectorSources = this.collectSelectorDerivedSegmentsFromPaths( argumentPaths );
		if ( selectorSources.length === 0 ) {
			return;
		}

		this.markPathsAsUnsupportedHookArguments( argumentPaths );
		const taint = this.createHookTaint( 'unsupported-hook-ref-flow', 'useRef', selectorSources, path );
		this.hookTaintsByBinding.set( refBinding.identifier, taint );
		this.recordUnsupportedHookTaint( taint );
	}

	collectCallbackHookTaint( path ) {
		const { types } = this.babel;
		const { id } = path.node;
		if ( ! types.isIdentifier( id ) ) {
			return;
		}

		const binding = path.scope.getBinding( id.name );
		if ( ! binding ) {
			return;
		}

		const argumentPaths = path.get( 'init.arguments' );
		const selectorSources = this.collectSelectorDerivedSegmentsFromPaths( argumentPaths );
		if ( selectorSources.length === 0 ) {
			return;
		}

		this.markPathsAsUnsupportedHookArguments( argumentPaths );
		const taint = this.createHookTaint( 'unsupported-hook-callback-flow', 'useCallback', selectorSources, path );
		this.hookTaintsByBinding.set( binding.identifier, taint );
		this.recordUnsupportedHookTaint( taint );
	}

	collectSelectorDerivedSegmentsFromPaths( expressionPaths ) {
		const sources = new Map();
		expressionPaths.forEach( ( expressionPath ) => {
			this.collectSelectorDerivedSegments( expressionPath ).forEach( ( segments ) => {
				sources.set( stringifySegments( segments ), segments );
			} );
		} );
		return Array.from( sources.values() );
	}

	markPathsAsUnsupportedHookArguments( expressionPaths ) {
		expressionPaths.forEach( ( expressionPath ) => {
			if ( expressionPath?.node ) {
				this.unsupportedHookArgumentExpressions.add( expressionPath.node );
			}
		} );
	}

	createHookTaint( kind, hookName, selectorSources, path ) {
		return {
			kind,
			hookName,
			sourceSegments: selectorSources.map( source => normalizeSegments( source ) ),
			sourcePaths: selectorSources.map( source => stringifySegments( source ) ),
			message: `Store selector value "${ stringifySegments( selectorSources[ 0 ] ) }" entered ${ hookName }, which is runtime hook state and cannot be used as static template data.`,
			path,
		};
	}

	recordUnsupportedHookTaint( taint ) {
		this.recordUnsupported( taint.kind, taint.sourceSegments[ 0 ], taint.message, {
			hookName: taint.hookName,
			sourcePaths: taint.sourcePaths,
			sourceSegments: taint.sourceSegments,
		} );
	}

	collectAliasUsage() {
		this.componentPath.traverse( {
			Identifier: ( path ) => {
				if ( this.isInsideNestedFunction( path ) && ! this.isInsideMapCallback( path ) ) {
					return;
				}

				if ( this.isInsideUnsupportedHookArgument( path ) ) {
					return;
				}

				if ( this.isInsideReactHookDependencyArray( path ) ) {
					return;
				}

				if ( ! this.isRenderableIdentifierUsage( path ) ) {
					return;
				}

				if ( this.isUnsupportedChildPropExpression( path ) ) {
					return;
				}

				const hookTaint = this.resolveHookTaintForIdentifier( path.node.name, path );
				if ( hookTaint ) {
					this.throwUnsupportedHookTaint( path, hookTaint );
				}

				const segments = this.resolveIdentifierSegments( path.node.name, path );
				if ( ! segments || ! isSelectorDerivedPath( segments ) ) {
					return;
				}

				this.addDeclarationForExpression( path );
			},
			'MemberExpression|OptionalMemberExpression': ( path ) => {
				if ( this.isInsideNestedFunction( path ) && ! this.isInsideMapCallback( path ) ) {
					return;
				}

				if ( this.isInsideUnsupportedHookArgument( path ) ) {
					return;
				}

				if ( this.isInsideReactHookDependencyArray( path ) ) {
					return;
				}

				const hookTaint = this.resolveHookTaintForMemberExpression( path.node, path );
				if ( hookTaint && ! this.isPartialMemberExpression( path ) ) {
					this.throwUnsupportedHookTaint( path, hookTaint );
				}

				if ( ! this.isUnsupportedChildPropExpression( path ) && this.isComputedSelectorMemberExpression( path ) ) {
					diagnostics.error(
						path,
						'Store selector computed member access is not supported. Use a static member path such as hero.title.'
					);
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
			JSXElement: ( path ) => {
				const openingElement = path.node.openingElement;
				const componentInfo = this.getChildComponentInfo( openingElement?.name );
				if ( ! componentInfo ) {
					return;
				}
				const { elementName, traceable } = componentInfo;

				path.get( 'children' ).forEach( ( childPath ) => {
					if ( ! this.babel.types.isJSXExpressionContainer( childPath.node ) ) {
						return;
					}

					const expressionPath = childPath.get( 'expression' );
					if ( this.isSupportedListRenderExpression( expressionPath.node, expressionPath ) ) {
						return;
					}

					const selectorSources = this.collectSelectorDerivedSegments( expressionPath );
					if ( selectorSources.length === 0 ) {
						return;
					}

					if ( ! traceable ) {
						this.recordUnsupportedChildComponentBoundary(
							childPath,
							childPath.node.expression,
							selectorSources,
							elementName,
							'children',
							'JSXChildren',
							`Store selector value "${ stringifySegments( selectorSources[ 0 ] ) }" is used as children for unsupported member component "${ elementName }".`
						);
						return;
					}

					if ( this.canPassThroughSelectorChildren( elementName ) ) {
						return;
					}

					const sourceSegments = selectorSources[ 0 ];
					const message = `Store selector value "${ stringifySegments( sourceSegments ) }" is used in unsupported children for child component "${ elementName }".`;
					this.unsupportedChildPropExpressions.add( childPath.node.expression );
					this.recordUnsupported( 'child-prop-boundary', sourceSegments, message, {
						boundary: 'JSXChildren',
						componentName: elementName,
						propName: 'children',
						target: `${ elementName }.children`,
						sourcePaths: selectorSources.map( source => stringifySegments( source ) ),
						sourceSegments: selectorSources.map( source => normalizeSegments( source ) ),
					} );
					diagnostics.unsupported(
						childPath,
						message,
						this.config
					);
				} );
			},
			JSXSpreadAttribute: ( path ) => {
				const openingElement = path.parentPath?.node;
				const componentInfo = this.getChildComponentInfo( openingElement?.name );
				if ( ! componentInfo ) {
					return;
				}
				const { elementName, traceable } = componentInfo;

				if ( traceable && this.isSupportedStaticObjectSpread( path, elementName ) ) {
					return;
				}

				const spreadObjectPath = this.getStaticObjectSpreadObjectPath( path, false );
				const selectorSources = this.collectSelectorDerivedSegments( spreadObjectPath || path.get( 'argument' ) );
				if ( selectorSources.length === 0 ) {
					return;
				}

				if ( ! traceable ) {
					this.recordUnsupportedChildComponentBoundary(
						path,
						path.node.argument,
						selectorSources,
						elementName,
						'<spread>',
						'JSXSpreadAttribute',
						`Store selector value "${ stringifySegments( selectorSources[ 0 ] ) }" is used in spread props for unsupported member component "${ elementName }".`
					);
					return;
				}

				const sourceSegments = selectorSources[ 0 ];
				const message = `Store selector value "${ stringifySegments( sourceSegments ) }" is used in unsupported spread props for child component "${ elementName }".`;
				this.unsupportedChildPropExpressions.add( path.node.argument );
				this.recordUnsupported( 'child-prop-boundary', sourceSegments, message, {
					boundary: 'JSXSpreadAttribute',
					componentName: elementName,
					propName: '<spread>',
					target: `${ elementName }.<spread>`,
					sourcePaths: selectorSources.map( segments => stringifySegments( segments ) ),
					sourceSegments: selectorSources.map( segments => normalizeSegments( segments ) ),
				} );
				diagnostics.unsupported(
					path,
					message,
					this.config
				);
			},
			JSXAttribute: ( path ) => {
				const openingElement = path.parentPath?.node;
				const componentInfo = this.getChildComponentInfo( openingElement?.name );
				if ( ! componentInfo ) {
					return;
				}
				const { elementName, traceable } = componentInfo;

				const value = path.node.value;
				if ( ! this.babel.types.isJSXExpressionContainer( value ) ) {
					return;
				}

				const expressionPath = path.get( 'value.expression' );
				if ( ! traceable ) {
					const selectorSources = this.collectSelectorDerivedSegments( expressionPath );
					if ( selectorSources.length === 0 ) {
						return;
					}

					this.recordUnsupportedChildComponentBoundary(
						path,
						value.expression,
						selectorSources,
						elementName,
						path.node.name.name,
						'JSXMemberExpression',
						`Store selector value "${ stringifySegments( selectorSources[ 0 ] ) }" is passed to unsupported member component "${ elementName }".`
					);
					return;
				}

				const expressionInfo = this.resolveExpressionInfo( value.expression, path );
				if ( ! expressionInfo || ! isSelectorDerivedPath( expressionInfo.segments ) ) {
					if ( this.isDynamicRootChildProp( elementName, path.node.name.name ) ) {
						diagnostics.error(
							path,
							`Store selector dynamic root prop "${ path.node.name.name }" for child component "${ elementName }" must receive a selector-derived or descriptor-derived value.`
						);
					}

					const selectorSources = this.collectSelectorDerivedSegments( expressionPath );
					if ( selectorSources.length === 0 ) {
						return;
					}

					const sourceSegments = selectorSources[ 0 ];
					if (
						this.isPotentialDynamicRootBoundary( elementName, path.node.name.name, selectorSources )
					) {
						diagnostics.error(
							path,
							`Store selector unsupported-object-root-expression: prop "${ path.node.name.name }" for child component "${ elementName }" uses an unsupported object-root expression (${ selectorSources.map( source => stringifySegments( source ) ).join( ', ' ) }). Pass one selector-derived object root directly or split the callsites.`
						);
					}

					const message = `Store selector value "${ stringifySegments( sourceSegments ) }" is used in unsupported prop expression for child component "${ elementName }".`;
					this.unsupportedChildPropExpressions.add( value.expression );
					this.recordUnsupported( 'child-prop-boundary', sourceSegments, message, {
						boundary: value.expression.type,
						componentName: elementName,
						propName: path.node.name.name,
						target: `${ elementName }.${ path.node.name.name }`,
						sourcePaths: selectorSources.map( source => stringifySegments( source ) ),
						sourceSegments: selectorSources.map( source => normalizeSegments( source ) ),
					} );
					diagnostics.unsupported(
						path,
						message,
						this.config
					);
					return;
				}

				const segments = expressionInfo.segments;
				if ( this.isDynamicRootChildProp( elementName, path.node.name.name ) ) {
					this.childPropTraces.push( {
						componentName: elementName,
						propName: path.node.name.name,
						path: stringifySegments( segments ),
						segments: normalizeSegments( segments ),
						dynamicRoot: true,
						dynamicRootSegments: expressionInfo.dynamicRootSegments,
					} );
					this.unsupportedChildPropExpressions.add( value.expression );
					return;
				}

				if ( this.shouldSeedObjectRootChildProp( elementName, path.node.name.name, segments ) ) {
					this.childPropSeedTraces.push( {
						componentName: elementName,
						propName: path.node.name.name,
						path: stringifySegments( segments ),
						segments: normalizeSegments( segments ),
						declarationSegments: normalizeSegments( segments ),
						dynamicRoot: expressionInfo.dynamicRoot,
						dynamicRootSegments: expressionInfo.dynamicRootSegments,
					} );
					this.unsupportedChildPropExpressions.add( value.expression );
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

				if ( this.canSeedChildProp( elementName, segments ) ) {
					this.addParentListDeclarationForSeed( expressionInfo.declarationSegments );
					this.childPropSeedTraces.push( {
						componentName: elementName,
						propName: path.node.name.name,
						path: stringifySegments( segments ),
						segments: normalizeSegments( segments ),
						declarationSegments: this.getChildSeedDeclarationSegments( expressionInfo ),
						dynamicRoot: expressionInfo.dynamicRoot,
						dynamicRootSegments: expressionInfo.dynamicRootSegments,
					} );
					this.unsupportedChildPropExpressions.add( value.expression );
					return;
				}

				const message = `Store selector value "${ stringifySegments( segments ) }" is passed to child component "${ elementName }", but prop tracing is not supported in this experiment slice.`;
				this.unsupportedChildPropExpressions.add( value.expression );
				this.recordUnsupported( 'child-prop', segments, message, {
					componentName: elementName,
					propName: path.node.name.name,
					target: `${ elementName }.${ path.node.name.name }`,
					sourcePaths: [ stringifySegments( segments ) ],
					sourceSegments: [ normalizeSegments( segments ) ],
				} );
				diagnostics.unsupported(
					path,
					message,
					this.config
				);
			},
		} );
	}

	recordUnsupportedChildComponentBoundary( path, expressionNode, selectorSources, elementName, propName, boundary, message ) {
		const sourceSegments = selectorSources[ 0 ];
		this.unsupportedChildPropExpressions.add( expressionNode );
		this.recordUnsupported( 'child-prop-boundary', sourceSegments, message, {
			boundary,
			componentName: elementName,
			propName,
			target: `${ elementName }.${ propName }`,
			sourcePaths: selectorSources.map( source => stringifySegments( source ) ),
			sourceSegments: selectorSources.map( source => normalizeSegments( source ) ),
		} );
		diagnostics.unsupported(
			path,
			message,
			this.config
		);
	}

	isSupportedStaticObjectSpread( path, elementName ) {
		const { types } = this.babel;
		const objectPath = this.getStaticObjectSpreadObjectPath( path, true );
		if ( ! objectPath ) {
			return false;
		}

		const properties = objectPath.get( 'properties' );
		for ( const propertyPath of properties ) {
			const property = propertyPath.node;
			if ( ! types.isObjectProperty( property ) || property.computed ) {
				return false;
			}

			const propName = this.getPatternPropertyName( property );
			if ( ! propName ) {
				return false;
			}

			const valuePath = propertyPath.get( 'value' );
			const selectorSources = this.collectSelectorDerivedSegments( valuePath );
			if ( selectorSources.length === 0 ) {
				continue;
			}

			if ( this.isPotentialDynamicRootBoundary( elementName, propName, selectorSources ) ) {
				const message = `Store selector value "${ stringifySegments( selectorSources[ 0 ] ) }" is used as object-root spread prop "${ propName }" for child component "${ elementName }".`;
				this.unsupportedChildPropExpressions.add( property.value );
				this.recordUnsupported( 'child-prop-boundary', selectorSources[ 0 ], message, {
					boundary: 'JSXSpreadAttribute',
					componentName: elementName,
					propName,
					target: `${ elementName }.${ propName }`,
					sourcePaths: selectorSources.map( source => stringifySegments( source ) ),
					sourceSegments: selectorSources.map( source => normalizeSegments( source ) ),
				} );
				diagnostics.unsupported( path, message, this.config );
				return true;
			}
		}

		return true;
	}

	getStaticObjectSpreadObjectPath( path, requireSafeBinding = true ) {
		const { types } = this.babel;
		const argumentPath = path.get( 'argument' );
		if ( types.isObjectExpression( argumentPath.node ) ) {
			return argumentPath;
		}

		if ( ! types.isIdentifier( argumentPath.node ) ) {
			return null;
		}

		const binding = argumentPath.scope.getBinding( argumentPath.node.name );
		if (
			! binding ||
			! binding.constant ||
			! types.isVariableDeclarator( binding.path.node ) ||
			! types.isObjectExpression( binding.path.node.init )
		) {
			return null;
		}

		if (
			requireSafeBinding &&
			(
				binding.referencePaths.length !== 1 ||
				binding.referencePaths[ 0 ].node !== argumentPath.node
			)
		) {
			return null;
		}

		return binding.path.get( 'init' );
	}

	canPassThroughSelectorChildren( elementName ) {
		const componentPath = this.config.storeSelectorComponentPaths?.get?.( elementName );
		if ( ! componentPath ) {
			return false;
		}

		return childComponentPassesThroughChildren( componentPath, this.babel );
	}

	addParentListDeclarationForSeed( segments ) {
		const normalizedSegments = normalizeCanonicalSegments( segments );
		const lastListIndex = normalizedSegments.reduce( ( match, segment, index ) => (
			String( segment ).endsWith( '[]' ) ? index : match
		), -1 );

		if ( lastListIndex < 0 ) {
			return;
		}

		this.addDeclaration( stringifySegments( normalizedSegments.slice( 0, lastListIndex + 1 ) ), {
			kind: 'parent-list-for-child-seed',
			segments: normalizedSegments.slice( 0, lastListIndex + 1 ),
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
			this.addDeclaration( declaration, {
				kind: 'map-list-shape',
				sourcePath: stringifySegments( sourceInfo.segments ),
				sourceSegments: sourceInfo.segments,
				declarationSegments: declarationListSegments,
			} );
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
		return parseStoreSelectorCall( callExpression, path, this.babel );
	}

	parseSelectorExpression( expression, paramName, path ) {
		return parseStoreSelectorExpression( expression, paramName, path, this.babel );
	}

	isStoreSelectorCall( node ) {
		return isStoreSelectorCallNode( node, this.selectorLocalNames, this.babel );
	}

	registerSeedAliases() {
		this.seedAliases.forEach( ( seedAlias ) => {
			if (
				! seedAlias ||
				typeof seedAlias.localName !== 'string' ||
				seedAlias.localName.length === 0 ||
				! Array.isArray( seedAlias.segments )
			) {
				diagnostics.error(
					this.componentPath,
					'Store selector seed aliases must include a localName string and segments array.'
				);
			}

			if (
				typeof seedAlias.declarationSegments !== 'undefined' &&
				! Array.isArray( seedAlias.declarationSegments )
			) {
				diagnostics.error(
					this.componentPath,
					'Store selector seed alias declarationSegments must be an array when provided.'
				);
			}

			const binding = this.componentFunctionPath.scope.getBinding( seedAlias.localName );
			if ( ! binding ) {
				diagnostics.error(
					this.componentPath,
					`Store selector seed alias "${ seedAlias.localName }" could not be resolved in the component scope.`
				);
			}

			if ( typeof seedAlias.memberName === 'string' && seedAlias.memberName.length > 0 ) {
				this.registerMemberAlias( seedAlias.localName, seedAlias.memberName, seedAlias.segments, this.componentFunctionPath, {
					declarationSegments: Array.isArray( seedAlias.declarationSegments ) ? seedAlias.declarationSegments : seedAlias.segments,
					source: 'seed',
					dynamicRoot: seedAlias.dynamicRoot,
					dynamicRootSegments: seedAlias.dynamicRootSegments,
				} );
				return;
			}

			this.registerBindingAlias( binding, seedAlias.localName, seedAlias.segments, {
				declarationSegments: Array.isArray( seedAlias.declarationSegments ) ? seedAlias.declarationSegments : seedAlias.segments,
				source: 'seed',
				dynamicRoot: seedAlias.dynamicRoot,
				dynamicRootSegments: seedAlias.dynamicRootSegments,
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

	registerMemberAlias( objectLocalName, memberName, segments, path, options = {} ) {
		const binding = path.scope.getBinding( objectLocalName );
		if ( ! binding ) {
			return;
		}

		this.registerBindingMemberAlias( binding, objectLocalName, memberName, segments, options );
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
			dynamicRoot: options.dynamicRoot === true,
			dynamicRootSegments: options.dynamicRoot === true ?
				normalizeCanonicalSegments( options.dynamicRootSegments || normalizedDeclarationSegments ) :
				undefined,
		};

		this.aliasesByBinding.set( binding.identifier, entry );
		this.aliasEntries.push( entry );
	}

	registerBindingMemberAlias( binding, objectLocalName, memberName, segments, options = {} ) {
		const normalizedSegments = normalizeCanonicalSegments( segments );
		const normalizedDeclarationSegments = Array.isArray( options.declarationSegments ) ?
			normalizeCanonicalSegments( options.declarationSegments ) :
			normalizedSegments;
		let aliasesByMember = this.memberAliasesByBinding.get( binding.identifier );
		if ( ! aliasesByMember ) {
			aliasesByMember = new Map();
			this.memberAliasesByBinding.set( binding.identifier, aliasesByMember );
		}

		const existing = aliasesByMember.get( memberName );
		if (
			existing &&
			stringifySegments( existing.segments ) === stringifySegments( normalizedSegments ) &&
			stringifySegments( existing.declarationSegments ) === stringifySegments( normalizedDeclarationSegments )
		) {
			return;
		}

		const entry = {
			bindingIdentifier: binding.identifier,
			localName: objectLocalName,
			memberName,
			segments: normalizedSegments,
			declarationSegments: normalizedDeclarationSegments,
			source: options.source || 'local',
			dynamicRoot: options.dynamicRoot === true,
			dynamicRootSegments: options.dynamicRoot === true ?
				normalizeCanonicalSegments( options.dynamicRootSegments || normalizedDeclarationSegments ) :
				undefined,
		};

		aliasesByMember.set( memberName, entry );
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
					dynamicRoot: options.dynamicRoot,
					dynamicRootSegments: options.dynamicRootSegments,
				} );
				return;
			}

			if ( this.babel.types.isObjectPattern( value ) ) {
				this.registerPatternAliases( value, propertySegments, path, {
					declarationSegments: propertyDeclarationSegments,
					dynamicRoot: options.dynamicRoot,
					dynamicRootSegments: options.dynamicRootSegments,
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

	canSeedChildProp( componentName, segments ) {
		const componentNames = this.config.storeSelectorComponentNames;
		if ( ! componentNames || ! componentNames.has( componentName ) ) {
			return false;
		}

		const normalizedSegments = normalizeSegments( segments );
		if ( normalizedSegments.length === 0 ) {
			return false;
		}

		return normalizedSegments.length === 1 || normalizedSegments.some( segment => String( segment ).endsWith( '[]' ) );
	}

	isDynamicRootChildProp( componentName, propName ) {
		const propsByComponent = this.config.storeSelectorDynamicRootPropsByComponent || {};
		const props = propsByComponent[ componentName ];
		return Array.isArray( props ) && props.includes( propName );
	}

	shouldSeedObjectRootChildProp( componentName, propName, segments ) {
		const componentNames = this.config.storeSelectorComponentNames;
		if ( ! componentNames || ! componentNames.has( componentName ) ) {
			return false;
		}

		const normalizedSegments = normalizeSegments( segments );
		if ( normalizedSegments.length === 0 ) {
			return false;
		}

		if ( normalizedSegments.some( segment => String( segment ).endsWith( '[]' ) ) ) {
			return false;
		}

		return this.isPotentialDynamicRootBoundary( componentName, propName, [ normalizedSegments ] );
	}

	isPotentialDynamicRootBoundary( componentName, propName, selectorSources ) {
		if ( selectorSources.length === 0 ) {
			return false;
		}

		const componentPath = this.config.storeSelectorComponentPaths?.get?.( componentName );
		if ( ! componentPath ) {
			return false;
		}

		return childPropHasObjectRootUsage( componentPath, propName, this.babel );
	}

	getChildSeedDeclarationSegments( expressionInfo ) {
		const declarationSegments = normalizeCanonicalSegments( expressionInfo.declarationSegments || expressionInfo.segments );
		const lastListIndex = declarationSegments.reduce( ( match, segment, index ) => (
			String( segment ).endsWith( '[]' ) ? index : match
		), -1 );

		return lastListIndex >= 0 ? declarationSegments.slice( lastListIndex + 1 ) : declarationSegments;
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

	isHookLikeUseMemoCall( node ) {
		if ( ! this.babel.types.isCallExpression( node ) ) {
			return false;
		}

		if ( this.babel.types.isIdentifier( node.callee ) ) {
			return node.callee.name === 'useMemo';
		}

		return (
			this.babel.types.isMemberExpression( node.callee ) &&
			! node.callee.computed &&
			this.babel.types.isIdentifier( node.callee.property ) &&
			node.callee.property.name === 'useMemo'
		);
	}

	isReactUseMemoCall( node, path ) {
		return this.getReactHookCallName( node, path ) === 'useMemo';
	}

	isReactHookCall( node, path ) {
		return Boolean( this.getReactHookCallName( node, path ) );
	}

	getReactHookCallName( node, path ) {
		const { types } = this.babel;
		if ( ! types.isCallExpression( node ) ) {
			return null;
		}

		if ( types.isIdentifier( node.callee ) ) {
			const hookName = node.callee.name;
			if ( hookName !== 'useMemo' && ! REACT_STATEFUL_HOOKS.has( hookName ) ) {
				return null;
			}

			const binding = path.scope.getBinding( hookName );
			return this.isReactNamedHookBinding( binding, hookName ) ? hookName : null;
		}

		if (
			types.isMemberExpression( node.callee ) &&
			! node.callee.computed &&
			types.isIdentifier( node.callee.object ) &&
			types.isIdentifier( node.callee.property )
		) {
			const hookName = node.callee.property.name;
			if ( hookName !== 'useMemo' && ! REACT_STATEFUL_HOOKS.has( hookName ) ) {
				return null;
			}

			const binding = path.scope.getBinding( node.callee.object.name );
			return this.isReactNamespaceBinding( binding ) ? hookName : null;
		}

		return null;
	}

	isReactNamedHookBinding( binding, hookName ) {
		const { types } = this.babel;
		const node = binding?.path?.node;
		const parent = binding?.path?.parentPath?.node;
		return Boolean(
			binding &&
			types.isImportSpecifier( node ) &&
			types.isIdentifier( node.imported ) &&
			node.imported.name === hookName &&
			types.isImportDeclaration( parent ) &&
			parent.source.value === REACT_MODULE
		);
	}

	isReactNamespaceBinding( binding ) {
		const { types } = this.babel;
		const node = binding?.path?.node;
		const parent = binding?.path?.parentPath?.node;
		return Boolean(
			binding &&
			( types.isImportDefaultSpecifier( node ) || types.isImportNamespaceSpecifier( node ) ) &&
			types.isImportDeclaration( parent ) &&
			parent.source.value === REACT_MODULE
		);
	}

	isRefCurrentMemberExpression( expression ) {
		return Boolean(
			this.babel.types.isMemberExpression( expression ) &&
			! expression.computed &&
			this.babel.types.isIdentifier( expression.object ) &&
			this.babel.types.isIdentifier( expression.property ) &&
			expression.property.name === 'current'
		);
	}

	containsStoreSelectorCall( path ) {
		let found = false;
		if ( this.isStoreSelectorCall( path.node ) ) {
			return true;
		}
		path.traverse( {
			CallExpression: ( callPath ) => {
				if ( this.isStoreSelectorCall( callPath.node ) ) {
					found = true;
					callPath.stop();
				}
			},
		} );
		return found;
	}

	containsComputedSelectorMemberExpression( path ) {
		let found = false;
		if (
			(
				this.babel.types.isMemberExpression( path.node ) ||
				( typeof this.babel.types.isOptionalMemberExpression === 'function' && this.babel.types.isOptionalMemberExpression( path.node ) ) ||
				path.node?.type === 'OptionalMemberExpression'
			) &&
			this.isComputedSelectorMemberExpression( path )
		) {
			return true;
		}
		path.traverse( {
			'MemberExpression|OptionalMemberExpression': ( memberPath ) => {
				if ( this.isComputedSelectorMemberExpression( memberPath ) ) {
					found = true;
					memberPath.stop();
				}
			},
		} );
		return found;
	}

	getChildComponentInfo( name ) {
		const elementName = this.getJSXElementName( name );
		if ( ! elementName ) {
			return null;
		}

		if ( this.babel.types.isJSXIdentifier( name ) ) {
			return /^[A-Z]/.test( elementName ) ? {
				elementName,
				traceable: true,
			} : null;
		}

		if ( this.babel.types.isJSXMemberExpression( name ) ) {
			const rootName = elementName.split( '.' )[ 0 ];
			const componentNames = this.config.storeSelectorComponentNames;
			return /^[A-Z]/.test( rootName ) ? {
				elementName,
				traceable: Boolean( componentNames && componentNames.has( elementName ) ),
			} : null;
		}

		return null;
	}

	getJSXElementName( name ) {
		if ( ! name ) {
			return null;
		}

		if ( this.babel.types.isJSXIdentifier( name ) ) {
			return name.name;
		}

		if ( this.babel.types.isJSXMemberExpression( name ) ) {
			const objectName = this.getJSXElementName( name.object );
			const propertyName = this.getJSXElementName( name.property );
			return objectName && propertyName ? `${ objectName }.${ propertyName }` : null;
		}

		return null;
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

		if ( path.node === expression && types.isCallExpression( expression ) && this.isReactUseMemoCall( expression, path ) ) {
			return this.resolveUseMemoExpressionInfo( expression, path );
		}

		if ( path.node === expression && types.isCallExpression( expression ) ) {
			const hookSummaryInfo = this.resolveTransparentHookSummaryInfo( expression, path );
			if ( hookSummaryInfo ) {
				return hookSummaryInfo;
			}
		}

		if ( this.isStaticMemberExpressionNode( expression ) && ! expression.computed && types.isIdentifier( expression.property ) ) {
			const memberInfo = this.resolveMemberAliasInfo( expression, path );
			if ( memberInfo ) {
				return memberInfo;
			}

			const objectInfo = this.resolveExpressionInfo( expression.object, path );
			return objectInfo ? {
				segments: [ ...objectInfo.segments, expression.property.name ],
				declarationSegments: [ ...objectInfo.declarationSegments, expression.property.name ],
				dynamicRoot: objectInfo.dynamicRoot,
				dynamicRootSegments: objectInfo.dynamicRootSegments,
			} : null;
		}

		if ( this.isSafeListChainCall( expression ) ) {
			return this.resolveExpressionInfo( expression.callee.object, path );
		}

		return null;
	}

	resolveUseMemoExpressionInfo( expression, path ) {
		const callbackPath = path.get( 'arguments' )[ 0 ];
		const callback = callbackPath?.node;
		if (
			! this.babel.types.isArrowFunctionExpression( callback ) &&
			! this.babel.types.isFunctionExpression( callback )
		) {
			this.throwUnsupportedHookReturnIfSelectorDerived( path, path.get( 'arguments' ), 'useMemo must receive a static callback before it can summarize selector-derived values.' );
			return null;
		}

		if ( this.containsStoreSelectorCall( callbackPath ) ) {
			diagnostics.error(
				callbackPath,
				'Store selector unsupported-hook-nested: useMemo callbacks cannot contain store selector calls. Assign the selector result before the memo call.'
			);
		}

		if ( this.babel.types.isBlockStatement( callback.body ) ) {
			this.throwUnsupportedHookReturnIfSelectorDerived( path, [ callbackPath.get( 'body' ) ], 'useMemo block bodies are not supported in this experiment slice. Use an expression body that returns a selector-derived path.' );
			return null;
		}

		const returnPath = callbackPath.get( 'body' );
		if ( this.containsComputedSelectorMemberExpression( returnPath ) ) {
			diagnostics.error(
				returnPath,
				'Store selector unsupported-hook-return: useMemo computed member access is not supported. Use a static member path such as hero.title.'
			);
		}

		const info = this.resolveExpressionInfo( callback.body, returnPath );
		if ( info && isSelectorDerivedPath( info.segments ) ) {
			return {
				...info,
				transparentHook: 'useMemo',
			};
		}

		this.throwUnsupportedHookReturnIfSelectorDerived( path, [ returnPath ], 'useMemo return expressions must resolve to a selector-derived static path, object root, or list root.' );
		return null;
	}

	resolveTransparentHookSummaryInfo( expression, path ) {
		if (
			! this.babel.types.isIdentifier( expression.callee ) ||
			expression.arguments.length > 0
		) {
			const selectorSources = this.collectSelectorDerivedSegmentsFromPaths( path.get( 'arguments' ) || [] );
			if ( selectorSources.length > 0 && this.babel.types.isIdentifier( expression.callee ) ) {
				const binding = path.scope.getBinding( expression.callee.name );
				const summary = binding ? this.config.storeSelectorHookSummariesByBinding?.get?.( binding.identifier ) : null;
				if ( summary ) {
					diagnostics.error(
						path,
						`Store selector unsupported-hook-call: hook "${ summary.hookName }" is a source hook and cannot receive selector-derived arguments such as "${ stringifySegments( selectorSources[ 0 ] ) }".`
					);
				}
			}
			return null;
		}

		const binding = path.scope.getBinding( expression.callee.name );
		const summary = binding ? this.config.storeSelectorHookSummariesByBinding?.get?.( binding.identifier ) : null;
		if ( ! summary ) {
			return null;
		}

		return {
			segments: summary.segments,
			declarationSegments: summary.declarationSegments || summary.segments,
			dynamicRoot: summary.dynamicRoot,
			dynamicRootSegments: summary.dynamicRootSegments,
			transparentHook: summary.hookName,
		};
	}

	throwUnsupportedHookReturnIfSelectorDerived( path, expressionPaths, reason ) {
		const selectorSources = this.collectSelectorDerivedSegmentsFromPaths( Array.isArray( expressionPaths ) ? expressionPaths : [ expressionPaths ] );
		if ( selectorSources.length === 0 ) {
			return;
		}

		diagnostics.error(
			path,
			`Store selector unsupported-hook-return: ${ reason } Affected selector path: "${ stringifySegments( selectorSources[ 0 ] ) }".`
		);
	}

	resolveMemberAliasInfo( expression, path ) {
		if (
			! this.babel.types.isIdentifier( expression.object ) ||
			! this.babel.types.isIdentifier( expression.property )
		) {
			return null;
		}

		const binding = path.scope.getBinding( expression.object.name );
		if ( ! binding ) {
			return null;
		}

		const aliasesByMember = this.memberAliasesByBinding.get( binding.identifier );
		const alias = aliasesByMember?.get( expression.property.name );
		return alias ? {
			segments: alias.segments,
			declarationSegments: alias.declarationSegments || alias.segments,
			dynamicRoot: alias.dynamicRoot,
			dynamicRootSegments: alias.dynamicRootSegments,
		} : null;
	}

	isStaticMemberExpressionNode( expression ) {
		return isStaticMemberExpressionNode( expression, this.babel );
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
			dynamicRoot: alias.dynamicRoot,
			dynamicRootSegments: alias.dynamicRootSegments,
		} : null;
	}

	resolveHookTaintForIdentifier( name, path ) {
		const binding = path.scope.getBinding( name );
		return binding ? this.hookTaintsByBinding.get( binding.identifier ) : null;
	}

	resolveHookTaintForMemberExpression( expression, path ) {
		if ( ! this.isRefCurrentMemberExpression( expression ) ) {
			return null;
		}

		const binding = path.scope.getBinding( expression.object.name );
		return binding ? this.hookTaintsByBinding.get( binding.identifier ) : null;
	}

	throwUnsupportedHookTaint( path, taint ) {
		diagnostics.error(
			path,
			`Store selector ${ taint.kind }: ${ taint.message }`
		);
	}

	isInsideUnsupportedHookArgument( path ) {
		let currentPath = path;
		while ( currentPath && currentPath !== this.componentPath ) {
			if ( this.unsupportedHookArgumentExpressions.has( currentPath.node ) ) {
				return true;
			}
			currentPath = currentPath.parentPath;
		}
		return false;
	}

	isInsideReactHookDependencyArray( path ) {
		let currentPath = path;
		while ( currentPath && currentPath !== this.componentPath ) {
			const node = currentPath.node;
			const parentPath = currentPath.parentPath;
			if (
				this.babel.types.isArrayExpression( node ) &&
				this.babel.types.isCallExpression( parentPath?.node )
			) {
				const args = parentPath.get( 'arguments' );
				const index = args.findIndex( argumentPath => argumentPath.node === node );
				if ( index > 0 && this.isReactHookCall( parentPath.node, parentPath ) ) {
					return true;
				}
			}
			currentPath = parentPath;
		}
		return false;
	}

	addDeclarationForExpression( path ) {
		const info = this.resolveExpressionInfo( path.node, path );
		if ( ! info || ! isSelectorDerivedPath( info.segments ) ) {
			return;
		}

		if ( info.dynamicRoot && isBareDynamicRootUsage( info ) ) {
			diagnostics.error(
				path,
				`Store selector dynamic root "${ stringifySegments( info.segments ) }" cannot be rendered directly. Use a member path such as "${ stringifySegments( [ ...info.segments, 'title' ] ) }" or keep the value inside a traceable child prop.`
			);
		}

		const declaration = stringifySegments( info.declarationSegments );
		if ( declaration ) {
			this.addDeclaration( declaration, {
				kind: 'usage',
				sourcePath: stringifySegments( info.segments ),
				sourceSegments: info.segments,
				declarationSegments: info.declarationSegments,
			} );
		}
	}

	addDeclaration( declaration, provenance = {} ) {
		if ( ! declaration ) {
			return;
		}

		this.declarations.add( declaration );
		if ( ! this.declarationProvenance.has( declaration ) ) {
			this.declarationProvenance.set( declaration, [] );
		}
		this.declarationProvenance.get( declaration ).push( {
			declaration,
			...provenance,
		} );
	}

	getDeclarationProvenance( declarations ) {
		return declarations.flatMap( declaration => this.declarationProvenance.get( declaration ) || [] );
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
					this.isStaticMemberExpressionNode( parent ) &&
					(
						( parent.object === path.node && ! parent.computed ) ||
						parent.property === path.node
					)
				) {
					return;
				}
				addInfo( this.resolveIdentifierInfo( path.node.name, path ) );
			},
			'MemberExpression|OptionalMemberExpression': ( path ) => {
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

	neutralizeTransparentHookDeclarations() {
		this.transparentHookDeclarations.forEach( ( hookDeclaration ) => {
			hookDeclaration.path.node.init = this.createNeutralExpression( hookDeclaration.segments );
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

		if ( [ 'VariableDeclarator', 'ObjectProperty', 'MemberExpression', 'OptionalMemberExpression', 'ObjectPattern', 'ArrayPattern', 'AssignmentPattern' ].includes( parent.type ) ) {
			return false;
		}

		return true;
	}

	isPartialMemberExpression( path ) {
		return this.isStaticMemberExpressionNode( path.parentPath?.node ) && path.parentPath.node.object === path.node;
	}

	isComputedSelectorMemberExpression( path ) {
		if ( ! path.node?.computed ) {
			return false;
		}

		const objectSegments = this.resolveExpressionSegments( path.node.object, path );
		return Boolean( objectSegments && isSelectorDerivedPath( objectSegments ) );
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

	isSupportedListRenderExpression( expression, path ) {
		const { types } = this.babel;
		if (
			! types.isCallExpression( expression ) ||
			! types.isMemberExpression( expression.callee ) ||
			! types.isIdentifier( expression.callee.property ) ||
			expression.callee.property.name !== 'map'
		) {
			return false;
		}

		const sourceInfo = this.resolveExpressionInfo( expression.callee.object, path );
		return Boolean( sourceInfo && isSelectorDerivedPath( sourceInfo.segments ) );
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
	const memberAliasesByBinding = new WeakMap();
	aliases.forEach( ( alias ) => {
		if ( alias.bindingIdentifier && alias.memberName ) {
			let aliasesByMember = memberAliasesByBinding.get( alias.bindingIdentifier );
			if ( ! aliasesByMember ) {
				aliasesByMember = new Map();
				memberAliasesByBinding.set( alias.bindingIdentifier, aliasesByMember );
			}
			aliasesByMember.set( alias.memberName, alias );
			return;
		}

		if ( alias.bindingIdentifier ) {
			aliasesByBinding.set( alias.bindingIdentifier, alias );
		}
	} );

	return function resolveSegments( segments, path ) {
		if ( ! segments || segments.length === 0 ) {
			return segments;
		}

		const binding = path?.scope?.getBinding( segments[ 0 ] );
		if ( binding && segments.length > 1 && memberAliasesByBinding.has( binding.identifier ) ) {
			const alias = memberAliasesByBinding.get( binding.identifier ).get( segments[ 1 ] );
			if ( alias ) {
				return [
					...( alias.declarationSegments || alias.segments ),
					...segments.slice( 2 ),
				];
			}
		}

		if ( binding && aliasesByBinding.has( binding.identifier ) ) {
			return [
				...( aliasesByBinding.get( binding.identifier ).declarationSegments || aliasesByBinding.get( binding.identifier ).segments ),
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

function isBareDynamicRootUsage( info ) {
	const declarationSegments = normalizeCanonicalSegments( info.declarationSegments || info.segments || [] );
	const dynamicRootSegments = normalizeCanonicalSegments( info.dynamicRootSegments || [] );
	return dynamicRootSegments.length > 0 &&
		declarationSegments.length === dynamicRootSegments.length &&
		declarationSegments.every( ( segment, index ) => segment === dynamicRootSegments[ index ] );
}

module.exports = {
	STORE_SELECTOR_MODULE,
	STORE_SELECTOR_EXPORT,
	assertNoUnprocessedStoreSelectorReferences,
	collectStoreSelectorImports,
	collectTransparentHookSummaries,
	collectStoreSelectorChildPropFlows,
	collectStoreSelectorTemplateVars,
	createStoreSelectorPropAliases,
	createStoreSelectorSeedAliases,
	createStoreSelectorDynamicRootAliases,
	createAliasResolver,
	isStoreSelectorEnabled,
	isStoreSelectorDebugEnabled,
	neutralizeTransparentHookSummaries,
	removeUnusedImportSpecifiers,
	removeStoreSelectorImportSpecifiers,
};
