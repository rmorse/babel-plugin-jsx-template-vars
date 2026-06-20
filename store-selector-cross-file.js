const path = require( 'path' );
const babel = require( '@babel/core' );
const {
	collectStoreSelectorImports,
	collectStoreSelectorChildPropFlows,
	collectStoreSelectorTemplateVars,
	createStoreSelectorDynamicRootAliases,
	createStoreSelectorSeedAliases,
} = require( './store-selector-template-vars' );

function createStoreSelectorCrossFileManifest( files, options = {} ) {
	const diagnostics = [];
	const debug = {
		importEdges: [],
		seedEdges: [],
		callsiteContexts: [],
		skippedImports: [],
		skippedFiles: [],
		importCycles: [],
		ambiguousSeeds: [],
	};
	const records = createFileRecords( files, diagnostics, debug );
	resolveRecordImports( records, diagnostics, debug );
	detectImportCycles( records, diagnostics, debug );

	const seedAliasesByFile = {};
	const dynamicRootPropsByFile = {};
	const callsiteContextsByFile = {};
	const childRelativeDiscoveryByFile = {};
	const seedAliasStates = new Map();
	const totalComponents = Array.from( records.values() )
		.reduce( ( count, record ) => count + record.componentPaths.size, 0 );
	debug.maxPasses = Math.max( totalComponents, 1 );
	debug.passCount = 0;

	for ( let pass = 0; pass < debug.maxPasses; pass++ ) {
		let addedSeed = false;
		debug.passCount = pass + 1;

		records.forEach( ( record ) => {
			const componentNames = getRecordComponentNames( record );
			const componentPaths = getRecordComponentPaths( record, records );
			const childPropTracesByComponent = new Map();
			const childSeedTracesByComponent = new Map();

			record.componentPaths.forEach( ( componentPath, componentName ) => {
				const selectorResult = collectStoreSelectorTemplateVars(
					componentPath,
					record.selectorImports.localNames,
					babel,
					{
						...options.config,
						storeSelectorComponentNames: componentNames,
						storeSelectorComponentPaths: componentPaths,
						storeSelectorSeedAliases: getManifestSeeds( seedAliasesByFile, record.filename, componentName ),
						storeSelectorNeutralizeSelectors: false,
					}
				);

				collectStoreSelectorChildPropFlows(
					annotateSelectorResultSource( selectorResult, record.filename, componentName ),
					childPropTracesByComponent,
					childSeedTracesByComponent
				);
			} );

			childSeedTracesByComponent.forEach( ( seedTraces, localComponentName ) => {
				const target = resolveChildComponent( record, localComponentName, records, diagnostics );
				if ( ! target ) {
					return;
				}

				const relatedFlows = childPropTracesByComponent.get( localComponentName ) || [];
				const seedAliases = createStoreSelectorSeedAliases(
					target.componentPath,
					seedTraces,
					babel,
					options.config || {},
					relatedFlows
				);

				seedAliases.forEach( ( seedAlias ) => {
					if ( addManifestSeedAlias( seedAliasesByFile, dynamicRootPropsByFile, callsiteContextsByFile, childRelativeDiscoveryByFile, seedAliasStates, diagnostics, debug, target.filename, target.componentName, target.componentPath, seedAlias, {
						sourceFilename: seedTraces[ 0 ]?.sourceFilename || record.filename,
						sourceComponentName: seedTraces[ 0 ]?.sourceComponentName,
						sourceChildComponentName: localComponentName,
					} ) ) {
						addedSeed = true;
					}
				} );
			} );
		} );

		if ( ! addedSeed ) {
			break;
		}
	}

	return {
		seedAliasesByFile,
		dynamicRootPropsByFile,
		callsiteContextsByFile,
		childRelativeDiscoveryByFile,
		componentNamesByFile: createComponentNamesByFile( records ),
		diagnostics,
		debug: {
			...debug,
			diagnostics,
		},
	};
}

function annotateSelectorResultSource( selectorResult, sourceFilename, sourceComponentName ) {
	const annotate = trace => ( {
		...trace,
		sourceFilename,
		sourceComponentName,
	} );
	return {
		...selectorResult,
		childPropTraces: ( selectorResult.childPropTraces || [] ).map( annotate ),
		childPropSeedTraces: ( selectorResult.childPropSeedTraces || [] ).map( annotate ),
		debug: {
			...selectorResult.debug,
			unsupported: ( selectorResult.debug.unsupported || [] ).map( annotate ),
		},
	};
}

function createFileRecords( files, diagnostics, debug ) {
	const normalizedFiles = normalizeFiles( files );
	const records = new Map();

	normalizedFiles.forEach( ( source, filename ) => {
		let ast;
		try {
			ast = babel.parseSync( source, {
				filename,
				babelrc: false,
				configFile: false,
				sourceType: 'unambiguous',
				parserOpts: {
					plugins: getParserPlugins( filename ),
				},
			} );
		} catch ( error ) {
			const diagnostic = {
				kind: 'parse-error',
				filename,
				message: `Store selector cross-file tracing could not parse "${ filename }": ${ error.message }`,
			};
			diagnostics.push( diagnostic );
			debug.skippedFiles.push( diagnostic );
			return;
		}
		let programPath;
		babel.traverse( ast, {
			Program( path ) {
				programPath = path;
				path.stop();
			},
		} );

		records.set( filename, {
			filename,
			source,
			programPath,
			componentPaths: getTopLevelComponentPaths( programPath, babel.types ),
			unsupportedComponents: getUnsupportedComponentDeclarations( programPath, babel.types ),
			selectorImports: collectStoreSelectorImports( programPath, babel ),
			imports: new Map(),
			rawImports: collectRawComponentImports( programPath, filename ),
		} );
	} );

	return records;
}

function getParserPlugins( filename ) {
	const extension = path.extname( filename ).toLowerCase();
	const plugins = [ 'jsx' ];
	if ( extension === '.ts' || extension === '.tsx' ) {
		plugins.push( 'typescript' );
	}
	return plugins;
}

function normalizeFiles( files ) {
	if ( ! files || typeof files !== 'object' || Array.isArray( files ) ) {
		throw new Error( 'Cross-file store selector manifest requires a filename-to-source object.' );
	}

	const normalized = new Map();
	Object.entries( files ).forEach( ( [ filename, source ] ) => {
		if ( typeof source !== 'string' ) {
			throw new Error( `Cross-file store selector source for "${ filename }" must be a string.` );
		}
		normalized.set( normalizeFilename( filename ), source );
	} );
	return normalized;
}

function collectRawComponentImports( programPath, filename ) {
	const imports = [];
	programPath.get( 'body' ).forEach( ( childPath ) => {
		const node = childPath.node;
		if ( ! babel.types.isImportDeclaration( node ) ) {
			return;
		}

		childPath.get( 'specifiers' ).forEach( ( specifierPath ) => {
			const specifier = specifierPath.node;
			if ( babel.types.isImportSpecifier( specifier ) ) {
				const localName = specifier.local.name;
				if ( isComponentName( localName ) ) {
					imports.push( {
						kind: 'named',
						localName,
						importedName: getImportSpecifierName( specifier.imported ),
						source: node.source.value,
						filename,
					} );
				}
				return;
			}

			if ( babel.types.isImportDefaultSpecifier( specifier ) && isComponentName( specifier.local.name ) ) {
				imports.push( {
					kind: 'default',
					localName: specifier.local.name,
					importedName: 'default',
					source: node.source.value,
					filename,
				} );
				return;
			}

			if ( babel.types.isImportNamespaceSpecifier( specifier ) && isComponentName( specifier.local.name ) ) {
				imports.push( {
					kind: 'namespace',
					localName: specifier.local.name,
					importedName: '*',
					source: node.source.value,
					filename,
				} );
			}
		} );
	} );
	return imports;
}

function resolveRecordImports( records, diagnostics, debug ) {
	records.forEach( ( record ) => {
		record.rawImports.forEach( ( importInfo ) => {
			if ( ! isRelativeImport( importInfo.source ) ) {
				diagnostics.push( {
					kind: 'unsupported-import-source',
					filename: record.filename,
					source: importInfo.source,
					localName: importInfo.localName,
					message: `Store selector cross-file tracing only supports relative imports; "${ importInfo.source }" is skipped.`,
				} );
				debug.skippedImports.push( createSkippedImportDebugEntry( diagnostics[ diagnostics.length - 1 ], importInfo ) );
				return;
			}

			if ( importInfo.kind === 'default' ) {
				diagnostics.push( {
					kind: 'unsupported-default-import',
					filename: record.filename,
					source: importInfo.source,
					localName: importInfo.localName,
					importedName: importInfo.importedName,
					message: `Store selector cross-file tracing does not support default imports yet; "${ importInfo.localName }" from "${ importInfo.source }" is skipped.`,
				} );
				debug.skippedImports.push( createSkippedImportDebugEntry( diagnostics[ diagnostics.length - 1 ], importInfo ) );
				return;
			}

			if ( importInfo.kind === 'namespace' ) {
				diagnostics.push( {
					kind: 'unsupported-namespace-import',
					filename: record.filename,
					source: importInfo.source,
					localName: importInfo.localName,
					importedName: importInfo.importedName,
					message: `Store selector cross-file tracing does not support namespace imports yet; "${ importInfo.localName }" from "${ importInfo.source }" is skipped.`,
				} );
				debug.skippedImports.push( createSkippedImportDebugEntry( diagnostics[ diagnostics.length - 1 ], importInfo ) );
				return;
			}

			const targetFilename = resolveImportFilename( record.filename, importInfo.source, records );
			if ( ! targetFilename ) {
				diagnostics.push( {
					kind: 'unresolved-import',
					filename: record.filename,
					source: importInfo.source,
					localName: importInfo.localName,
					message: `Store selector cross-file tracing could not resolve "${ importInfo.source }" from "${ record.filename }".`,
				} );
				debug.skippedImports.push( createSkippedImportDebugEntry( diagnostics[ diagnostics.length - 1 ], importInfo ) );
				return;
			}

			const targetRecord = records.get( targetFilename );
			const targetComponentName = importInfo.importedName;

			if ( ! targetComponentName || ! targetRecord.componentPaths.has( targetComponentName ) ) {
				const unsupportedComponent = targetRecord.unsupportedComponents?.get( targetComponentName );
				if ( unsupportedComponent ) {
					diagnostics.push( {
						kind: 'unsupported-component-declaration',
						filename: record.filename,
						source: importInfo.source,
						localName: importInfo.localName,
						importedName: importInfo.importedName,
						targetFilename,
						componentName: targetComponentName,
						declarationKind: unsupportedComponent.kind,
						message: `Store selector cross-file tracing does not support component declaration "${ targetComponentName }" in "${ targetFilename }" (${ unsupportedComponent.kind }).`,
					} );
					debug.skippedImports.push( createSkippedImportDebugEntry( diagnostics[ diagnostics.length - 1 ], importInfo, targetFilename ) );
					return;
				}

				diagnostics.push( {
					kind: 'unsupported-reexport',
					filename: record.filename,
					source: importInfo.source,
					localName: importInfo.localName,
					importedName: importInfo.importedName,
					targetFilename,
					message: `Store selector cross-file tracing could not find component "${ importInfo.importedName }" in "${ targetFilename }". Barrel files and re-exports are not supported in this slice.`,
				} );
				debug.skippedImports.push( createSkippedImportDebugEntry( diagnostics[ diagnostics.length - 1 ], importInfo, targetFilename ) );
				return;
			}

			record.imports.set( importInfo.localName, {
				localName: importInfo.localName,
				componentName: targetComponentName,
				filename: targetFilename,
			} );
			debug.importEdges.push( {
				sourceFilename: record.filename,
				importSource: importInfo.source,
				localName: importInfo.localName,
				importedName: importInfo.importedName,
				targetFilename,
				targetComponentName,
			} );
		} );
	} );
}

function detectImportCycles( records, diagnostics, debug ) {
	const visiting = new Set();
	const visited = new Set();
	const cyclicFiles = new Set();

	const visit = ( filename, stack ) => {
		if ( cyclicFiles.has( filename ) ) {
			return;
		}
		if ( visiting.has( filename ) ) {
			const cycle = [ ...stack.slice( stack.indexOf( filename ) ), filename ];
			const normalizedCycle = cycle.map( normalizeFilename );
			normalizedCycle.forEach( file => cyclicFiles.add( file ) );
			const diagnostic = {
				kind: 'import-cycle',
				filename,
				files: normalizedCycle,
				message: `Store selector cross-file tracing detected an import cycle: ${ normalizedCycle.join( ' -> ' ) }.`,
			};
			diagnostics.push( diagnostic );
			debug.importCycles.push( diagnostic );
			return;
		}
		if ( visited.has( filename ) ) {
			return;
		}

		visiting.add( filename );
		const record = records.get( filename );
		record?.imports.forEach( imported => {
			visit( normalizeFilename( imported.filename ), [ ...stack, filename ] );
		} );
		visiting.delete( filename );
		visited.add( filename );
	};

	records.forEach( ( _record, filename ) => visit( filename, [] ) );

	cyclicFiles.forEach( ( filename ) => {
		const record = records.get( filename );
		if ( record ) {
			record.imports.clear();
		}
	} );
}

function createSkippedImportDebugEntry( diagnostic, importInfo, targetFilename ) {
	return {
		kind: diagnostic.kind,
		filename: diagnostic.filename,
		source: importInfo.source,
		localName: importInfo.localName,
		importedName: importInfo.importedName,
		targetFilename,
		message: diagnostic.message,
	};
}

function getImportSpecifierName( imported ) {
	if ( babel.types.isIdentifier( imported ) ) {
		return imported.name;
	}
	return imported?.value;
}

function resolveImportFilename( fromFilename, source, records ) {
	const base = path.resolve( path.dirname( fromFilename ), source );
	const candidates = [
		base,
		`${ base }.jsx`,
		`${ base }.js`,
		path.join( base, 'index.jsx' ),
		path.join( base, 'index.js' ),
	].map( normalizeFilename );

	return candidates.find( candidate => records.has( candidate ) ) || null;
}

function resolveChildComponent( record, localComponentName, records, diagnostics ) {
	if ( record.componentPaths.has( localComponentName ) ) {
		return {
			filename: record.filename,
			componentName: localComponentName,
			componentPath: record.componentPaths.get( localComponentName ),
		};
	}

	const imported = record.imports.get( localComponentName );
	if ( ! imported ) {
		diagnostics.push( {
			kind: 'unresolved-child-component',
			filename: record.filename,
			localName: localComponentName,
			message: `Store selector cross-file tracing could not resolve child component "${ localComponentName }".`,
		} );
		return null;
	}

	const importedTarget = getImportedComponentPath( imported, records, diagnostics, record.filename );
	if ( ! importedTarget.componentPath ) {
		return null;
	}

	return {
		filename: imported.filename,
		componentName: imported.componentName,
		...importedTarget,
	};
}

function getImportedComponentPath( imported, records, diagnostics, fromFilename ) {
	const targetRecord = records?.get( imported.filename );
	if ( ! targetRecord || ! targetRecord.componentPaths.has( imported.componentName ) ) {
		diagnostics.push( {
			kind: 'unresolved-child-component',
			filename: fromFilename,
			localName: imported.localName,
			targetFilename: imported.filename,
			componentName: imported.componentName,
			message: `Store selector cross-file tracing could not load child component "${ imported.componentName }".`,
		} );
		return {
			componentPath: null,
		};
	}

	return {
		componentPath: targetRecord.componentPaths.get( imported.componentName ),
	};
}

function getRecordComponentNames( record ) {
	return new Set( [
		...record.componentPaths.keys(),
		...record.imports.keys(),
	] );
}

function getRecordComponentPaths( record, records ) {
	const componentPaths = new Map( record.componentPaths );
	record.imports.forEach( ( imported, localName ) => {
		const targetRecord = records.get( imported.filename );
		const componentPath = targetRecord?.componentPaths.get( imported.componentName );
		if ( componentPath ) {
			componentPaths.set( localName, componentPath );
		}
	} );
	return componentPaths;
}

function createComponentNamesByFile( records ) {
	const componentNamesByFile = {};
	records.forEach( ( record ) => {
		const names = Array.from( record.imports.keys() ).sort();
		if ( names.length > 0 ) {
			componentNamesByFile[ record.filename ] = names;
		}
	} );
	return componentNamesByFile;
}

function addManifestSeedAlias(
	seedAliasesByFile,
	dynamicRootPropsByFile,
	callsiteContextsByFile,
	childRelativeDiscoveryByFile,
	seedAliasStates,
	diagnostics,
	debug,
	filename,
	componentName,
	componentPath,
	seedAlias,
	source = {}
) {
	if ( ! seedAlias || ! seedAlias.localName ) {
		return false;
	}

	const normalizedFilename = normalizeFilename( filename );
	const stateKey = createSeedAliasStateKey( normalizedFilename, componentName, seedAlias );
	const sourceKey = createSeedAliasSourceKey( seedAlias );
	const propName = getSeedAliasPropName( seedAlias );
	const existingState = seedAliasStates.get( stateKey );
	if ( existingState?.dynamicRoot ) {
		addDynamicRootCallsiteContext(
			dynamicRootPropsByFile,
			callsiteContextsByFile,
			debug,
			source,
			normalizedFilename,
			componentName,
			existingState.seedAlias,
			seedAlias
		);
		return false;
	}
	if ( existingState?.ambiguous ) {
		return false;
	}

	if ( existingState && existingState.sourceKey !== sourceKey ) {
		if ( isListRelativeSeedAliasConflict( existingState.seedAlias, seedAlias ) ) {
			debug.seedEdges.push( {
				sourceFilename: source.sourceFilename,
				sourceComponentName: source.sourceComponentName,
				sourceChildComponentName: source.sourceChildComponentName,
				targetFilename: normalizedFilename,
				targetComponentName: componentName,
				localName: existingState.seedAlias.localName,
				memberName: existingState.seedAlias.memberName,
				sourcePath: stringifySegments( seedAlias.segments || [] ),
				declarationPath: stringifySegments( seedAlias.declarationSegments || [] ),
				strategy: 'list-relative-shared',
			} );
			return false;
		}

		const dynamicRootAlias = createDynamicRootAliasForSeedConflict(
			componentPath,
			componentName,
			existingState.seedAlias,
			seedAlias
		);
		if ( dynamicRootAlias ) {
			removeManifestSeedAlias( seedAliasesByFile, normalizedFilename, componentName, existingState.seedAlias );
			pushManifestSeedAlias( seedAliasesByFile, normalizedFilename, componentName, dynamicRootAlias );
			seedAliasStates.set( stateKey, {
				dynamicRoot: true,
				sourceKey: createSeedAliasSourceKey( dynamicRootAlias ),
				seedAlias: dynamicRootAlias,
			} );
			addChildRelativeDiscovery(
				childRelativeDiscoveryByFile,
				normalizedFilename,
				componentName,
				dynamicRootAlias
			);
			addDynamicRootCallsiteContext(
				dynamicRootPropsByFile,
				callsiteContextsByFile,
				debug,
				existingState.source,
				normalizedFilename,
				componentName,
				dynamicRootAlias,
				existingState.seedAlias
			);
			addDynamicRootCallsiteContext(
				dynamicRootPropsByFile,
				callsiteContextsByFile,
				debug,
				source,
				normalizedFilename,
				componentName,
				dynamicRootAlias,
				seedAlias
			);
			debug.seedEdges.push( {
				sourceFilename: source.sourceFilename,
				sourceComponentName: source.sourceComponentName,
				sourceChildComponentName: source.sourceChildComponentName,
				targetFilename: normalizedFilename,
				targetComponentName: componentName,
				localName: dynamicRootAlias.localName,
				memberName: dynamicRootAlias.memberName,
				sourcePath: stringifySegments( dynamicRootAlias.segments || [] ),
				declarationPath: stringifySegments( dynamicRootAlias.declarationSegments || [] ),
				strategy: 'dynamic-root',
			} );
			return true;
		}

		removeManifestSeedAlias( seedAliasesByFile, normalizedFilename, componentName, existingState.seedAlias );
		const sourcePaths = Array.from( new Set( [
			stringifySegments( existingState.seedAlias.segments || [] ),
			stringifySegments( seedAlias.segments || [] ),
		] ) ).filter( Boolean );
		const diagnostic = {
			kind: 'ambiguous-cross-file-seed',
			filename: normalizedFilename,
			componentName,
			localName: seedAlias.localName,
			memberName: seedAlias.memberName,
			propName,
			declarationPath: stringifySegments( seedAlias.declarationSegments || [] ),
			sourcePaths,
			message: `Store selector cross-file tracing found ambiguous sources for "${ componentName }.${ seedAlias.memberName || seedAlias.localName }" (${ sourcePaths.join( ', ' ) }); seed tracing is disabled for this binding.`,
		};
		diagnostics.push( diagnostic );
		debug.ambiguousSeeds.push( diagnostic );
		seedAliasStates.set( stateKey, {
			ambiguous: true,
		} );
		return false;
	}

	if ( ! pushManifestSeedAlias( seedAliasesByFile, normalizedFilename, componentName, seedAlias ) ) {
		return false;
	}

	seedAliasStates.set( stateKey, {
		sourceKey,
		seedAlias,
		source,
	} );
	debug.seedEdges.push( {
		sourceFilename: source.sourceFilename,
		sourceComponentName: source.sourceComponentName,
		sourceChildComponentName: source.sourceChildComponentName,
		targetFilename: normalizedFilename,
		targetComponentName: componentName,
		localName: seedAlias.localName,
		memberName: seedAlias.memberName,
		sourcePath: stringifySegments( seedAlias.segments || [] ),
		declarationPath: stringifySegments( seedAlias.declarationSegments || [] ),
	} );
	return true;
}

function pushManifestSeedAlias( seedAliasesByFile, filename, componentName, seedAlias ) {
	if ( ! seedAliasesByFile[ filename ] ) {
		seedAliasesByFile[ filename ] = {};
	}
	if ( ! seedAliasesByFile[ filename ][ componentName ] ) {
		seedAliasesByFile[ filename ][ componentName ] = [];
	}

	const seedAliases = seedAliasesByFile[ filename ][ componentName ];
	const seedKey = createSeedAliasKey( seedAlias );
	if ( seedAliases.some( existing => createSeedAliasKey( existing ) === seedKey ) ) {
		return false;
	}

	seedAliases.push( seedAlias );
	return true;
}

function createDynamicRootAliasForSeedConflict( componentPath, componentName, existingSeedAlias, seedAlias ) {
	if (
		! componentPath ||
		getSeedAliasPropName( existingSeedAlias ) !== getSeedAliasPropName( seedAlias ) ||
		seedAliasHasListContext( existingSeedAlias ) ||
		seedAliasHasListContext( seedAlias )
	) {
		return null;
	}

	const traces = [ existingSeedAlias, seedAlias ].map( alias => ( {
		componentName,
		propName: getSeedAliasPropName( alias ),
		path: stringifySegments( alias.segments || [] ),
		segments: alias.segments || [],
		declarationSegments: alias.declarationSegments || alias.segments || [],
	} ) );
	const dynamicRootAliases = createStoreSelectorDynamicRootAliases( componentPath, traces, babel );
	return dynamicRootAliases[ 0 ] || null;
}

function addDynamicRootCallsiteContext(
	dynamicRootPropsByFile,
	callsiteContextsByFile,
	debug,
	source,
	targetFilename,
	targetComponentName,
	dynamicRootAlias,
	sourceSeedAlias
) {
	if ( ! source?.sourceFilename || ! source?.sourceChildComponentName ) {
		return;
	}

	const sourceFilename = normalizeFilename( source.sourceFilename );
	const propName = getSeedAliasPropName( dynamicRootAlias );
	if ( ! dynamicRootPropsByFile[ sourceFilename ] ) {
		dynamicRootPropsByFile[ sourceFilename ] = {};
	}
	if ( ! dynamicRootPropsByFile[ sourceFilename ][ source.sourceChildComponentName ] ) {
		dynamicRootPropsByFile[ sourceFilename ][ source.sourceChildComponentName ] = [];
	}
	if ( ! dynamicRootPropsByFile[ sourceFilename ][ source.sourceChildComponentName ].includes( propName ) ) {
		dynamicRootPropsByFile[ sourceFilename ][ source.sourceChildComponentName ].push( propName );
	}

	if ( ! callsiteContextsByFile[ sourceFilename ] ) {
		callsiteContextsByFile[ sourceFilename ] = [];
	}

	const context = {
		callsiteId: createCallsiteContextId( callsiteContextsByFile, sourceFilename, source, propName ),
		parentFile: sourceFilename,
		parentComponent: source.sourceComponentName,
		targetFile: targetFilename,
		targetComponent: targetComponentName,
		importEdgeId: `${ sourceFilename }::${ source.sourceChildComponentName }->${ targetFilename }::${ targetComponentName }`,
		jsxTag: source.sourceChildComponentName,
		propName,
		canonicalSegments: sourceSeedAlias.segments || [],
		declarationSegments: sourceSeedAlias.declarationSegments || sourceSeedAlias.segments || [],
		strategy: 'dynamic-root-descriptor',
	};
	const contextKey = createCallsiteContextKey( context );
	if ( callsiteContextsByFile[ sourceFilename ].some( existing => createCallsiteContextKey( existing ) === contextKey ) ) {
		return;
	}

	callsiteContextsByFile[ sourceFilename ].push( context );
	if ( ! debug.callsiteContexts ) {
		debug.callsiteContexts = [];
	}
	debug.callsiteContexts.push( context );
}

function createCallsiteContextId( callsiteContextsByFile, sourceFilename, source, propName ) {
	const ordinal = ( callsiteContextsByFile[ sourceFilename ] || [] ).length + 1;
	return `${ sourceFilename }#${ source.sourceComponentName || 'unknown' }#${ source.sourceChildComponentName }.${ propName }#${ ordinal }`;
}

function createCallsiteContextKey( context ) {
	return [
		context.parentFile,
		context.parentComponent || '',
		context.jsxTag,
		context.propName,
		context.targetFile,
		context.targetComponent,
		( context.canonicalSegments || [] ).join( '.' ),
		( context.declarationSegments || [] ).join( '.' ),
	].join( '|' );
}

function addChildRelativeDiscovery( childRelativeDiscoveryByFile, filename, componentName, dynamicRootAlias ) {
	if ( ! childRelativeDiscoveryByFile[ filename ] ) {
		childRelativeDiscoveryByFile[ filename ] = {};
	}
	if ( ! childRelativeDiscoveryByFile[ filename ][ componentName ] ) {
		childRelativeDiscoveryByFile[ filename ][ componentName ] = [];
	}

	const entry = {
		localName: dynamicRootAlias.localName,
		memberName: dynamicRootAlias.memberName,
		propName: getSeedAliasPropName( dynamicRootAlias ),
		dynamicRootSegments: dynamicRootAlias.dynamicRootSegments || dynamicRootAlias.declarationSegments || dynamicRootAlias.segments || [],
	};
	const entryKey = [
		entry.localName,
		entry.memberName || '',
		entry.propName,
		( entry.dynamicRootSegments || [] ).join( '.' ),
	].join( '|' );
	if ( childRelativeDiscoveryByFile[ filename ][ componentName ].some( existing => [
		existing.localName,
		existing.memberName || '',
		existing.propName,
		( existing.dynamicRootSegments || [] ).join( '.' ),
	].join( '|' ) === entryKey ) ) {
		return;
	}

	childRelativeDiscoveryByFile[ filename ][ componentName ].push( entry );
}

function removeManifestSeedAlias( seedAliasesByFile, filename, componentName, seedAlias ) {
	const seedAliases = seedAliasesByFile[ filename ]?.[ componentName ];
	if ( ! seedAliases ) {
		return;
	}

	const seedKey = createSeedAliasKey( seedAlias );
	const nextSeedAliases = seedAliases.filter( existing => createSeedAliasKey( existing ) !== seedKey );
	if ( nextSeedAliases.length > 0 ) {
		seedAliasesByFile[ filename ][ componentName ] = nextSeedAliases;
		return;
	}

	delete seedAliasesByFile[ filename ][ componentName ];
	if ( Object.keys( seedAliasesByFile[ filename ] ).length === 0 ) {
		delete seedAliasesByFile[ filename ];
	}
}

function getManifestSeeds( seedAliasesByFile, filename, componentName ) {
	return seedAliasesByFile[ normalizeFilename( filename ) ]?.[ componentName ] || [];
}

function createSeedAliasKey( seedAlias ) {
	return [
		seedAlias.localName,
		seedAlias.memberName || '',
		( seedAlias.segments || [] ).join( '.' ),
		( seedAlias.declarationSegments || [] ).join( '.' ),
		seedAlias.dynamicRoot ? 'dynamic-root' : '',
		seedAlias.propName || '',
	].join( '|' );
}

function createSeedAliasStateKey( filename, componentName, seedAlias ) {
	return [
		filename,
		componentName,
		seedAlias.localName,
		seedAlias.memberName || '',
	].join( '|' );
}

function createSeedAliasSourceKey( seedAlias ) {
	return ( seedAlias.segments || [] ).join( '.' );
}

function getSeedAliasPropName( seedAlias ) {
	return seedAlias?.propName || seedAlias?.memberName || seedAlias?.localName;
}

function seedAliasHasListContext( seedAlias ) {
	return [
		...( seedAlias?.segments || [] ),
		...( seedAlias?.declarationSegments || [] ),
	].some( segment => String( segment ).endsWith( '[]' ) );
}

function isListRelativeSeedAliasConflict( existingSeedAlias, seedAlias ) {
	if (
		getSeedAliasPropName( existingSeedAlias ) !== getSeedAliasPropName( seedAlias ) ||
		! seedAliasHasListContext( existingSeedAlias ) ||
		! seedAliasHasListContext( seedAlias )
	) {
		return false;
	}

	return stringifySegments( existingSeedAlias.declarationSegments || [] ) ===
		stringifySegments( seedAlias.declarationSegments || [] );
}

function getTopLevelComponentPaths( programPath, types ) {
	const components = new Map();
	programPath.get( 'body' ).forEach( ( childPath ) => {
		const declarationPath = getVariableDeclarationPath( childPath, types );
		if ( ! declarationPath || declarationPath.node.declarations.length !== 1 ) {
			return;
		}

		const declaration = declarationPath.node.declarations[ 0 ];
		if ( ! types.isIdentifier( declaration.id ) || ! isComponentName( declaration.id.name ) ) {
			return;
		}

		if (
			! types.isArrowFunctionExpression( declaration.init ) &&
			! types.isFunctionExpression( declaration.init )
		) {
			return;
		}

		components.set( declaration.id.name, declarationPath );
	} );
	return components;
}

function getUnsupportedComponentDeclarations( programPath, types ) {
	const unsupported = new Map();
	programPath.get( 'body' ).forEach( ( childPath ) => {
		const node = childPath.node;

		if ( types.isFunctionDeclaration( node ) && node.id && isComponentName( node.id.name ) ) {
			unsupported.set( node.id.name, {
				kind: 'function-declaration',
			} );
			return;
		}

		if ( types.isExportNamedDeclaration( node ) && types.isFunctionDeclaration( node.declaration ) ) {
			const name = node.declaration.id?.name;
			if ( isComponentName( name ) ) {
				unsupported.set( name, {
					kind: 'export-function-declaration',
				} );
			}
			return;
		}

		if ( types.isExportDefaultDeclaration( node ) ) {
			const declaration = node.declaration;
			if ( types.isIdentifier( declaration ) && isComponentName( declaration.name ) ) {
				unsupported.set( declaration.name, {
					kind: 'export-default-identifier',
				} );
				return;
			}
			if ( types.isFunctionDeclaration( declaration ) ) {
				const name = declaration.id?.name || 'default';
				if ( name === 'default' || isComponentName( name ) ) {
					unsupported.set( name, {
						kind: 'export-default-function',
					} );
				}
			}
			return;
		}

		const declarationPath = getVariableDeclarationPath( childPath, types );
		if ( ! declarationPath || declarationPath.node.declarations.length !== 1 ) {
			return;
		}

		const declaration = declarationPath.node.declarations[ 0 ];
		if (
			types.isIdentifier( declaration.id ) &&
			isComponentName( declaration.id.name ) &&
			types.isCallExpression( declaration.init )
		) {
			unsupported.set( declaration.id.name, {
				kind: 'hoc-or-wrapper',
			} );
		}
	} );
	return unsupported;
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

function isComponentName( name ) {
	return typeof name === 'string' && /^[A-Z]/.test( name );
}

function isRelativeImport( source ) {
	return typeof source === 'string' && ( source.startsWith( './' ) || source.startsWith( '../' ) );
}

function normalizeFilename( filename ) {
	return path.normalize( path.resolve( filename ) );
}

function stringifySegments( segments ) {
	return segments.map( segment => String( segment ) ).join( '.' );
}

module.exports = {
	createStoreSelectorCrossFileManifest,
	normalizeFilename,
};
