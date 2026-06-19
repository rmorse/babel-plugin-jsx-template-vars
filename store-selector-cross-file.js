const path = require( 'path' );
const babel = require( '@babel/core' );
const {
	collectStoreSelectorImports,
	collectStoreSelectorTemplateVars,
	createStoreSelectorSeedAliases,
} = require( './store-selector-template-vars' );

function createStoreSelectorCrossFileManifest( files, options = {} ) {
	const records = createFileRecords( files );
	const diagnostics = [];
	resolveRecordImports( records, diagnostics );

	const seedAliasesByFile = {};
	const totalComponents = Array.from( records.values() )
		.reduce( ( count, record ) => count + record.componentPaths.size, 0 );

	for ( let pass = 0; pass < Math.max( totalComponents, 1 ); pass++ ) {
		let addedSeed = false;

		records.forEach( ( record ) => {
			const componentNames = getRecordComponentNames( record );
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
						storeSelectorSeedAliases: getManifestSeeds( seedAliasesByFile, record.filename, componentName ),
						storeSelectorNeutralizeSelectors: false,
					}
				);

				collectChildPropFlows( selectorResult, childPropTracesByComponent, childSeedTracesByComponent );
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
					if ( addManifestSeedAlias( seedAliasesByFile, target.filename, target.componentName, seedAlias ) ) {
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
		componentNamesByFile: createComponentNamesByFile( records ),
		diagnostics,
	};
}

function createFileRecords( files ) {
	const normalizedFiles = normalizeFiles( files );
	const records = new Map();

	normalizedFiles.forEach( ( source, filename ) => {
		const ast = babel.parseSync( source, {
			filename,
			babelrc: false,
			configFile: false,
			sourceType: 'unambiguous',
			parserOpts: {
				plugins: [ 'jsx' ],
			},
		} );
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
			selectorImports: collectStoreSelectorImports( programPath, babel ),
			imports: new Map(),
			rawImports: collectRawComponentImports( programPath, filename ),
		} );
	} );

	return records;
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
			}
		} );
	} );
	return imports;
}

function resolveRecordImports( records, diagnostics ) {
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
				return;
			}

			const targetRecord = records.get( targetFilename );
			const targetComponentName = importInfo.kind === 'default' ?
				resolveDefaultComponentName( targetRecord, importInfo.localName ) :
				importInfo.importedName;

			if ( ! targetComponentName || ! targetRecord.componentPaths.has( targetComponentName ) ) {
				diagnostics.push( {
					kind: importInfo.kind === 'default' ? 'unsupported-default-import' : 'unsupported-reexport',
					filename: record.filename,
					source: importInfo.source,
					localName: importInfo.localName,
					importedName: importInfo.importedName,
					targetFilename,
					message: `Store selector cross-file tracing could not find component "${ importInfo.importedName }" in "${ targetFilename }". Barrel files and re-exports are not supported in this slice.`,
				} );
				return;
			}

			record.imports.set( importInfo.localName, {
				localName: importInfo.localName,
				componentName: targetComponentName,
				filename: targetFilename,
			} );
		} );
	} );
}

function getImportSpecifierName( imported ) {
	if ( babel.types.isIdentifier( imported ) ) {
		return imported.name;
	}
	return imported?.value;
}

function resolveDefaultComponentName( targetRecord, localName ) {
	if ( targetRecord.componentPaths.has( localName ) ) {
		return localName;
	}
	return null;
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

function collectChildPropFlows( selectorResult, childPropTracesByComponent, childSeedTracesByComponent ) {
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

function addManifestSeedAlias( seedAliasesByFile, filename, componentName, seedAlias ) {
	if ( ! seedAlias || ! seedAlias.localName ) {
		return false;
	}

	const normalizedFilename = normalizeFilename( filename );
	if ( ! seedAliasesByFile[ normalizedFilename ] ) {
		seedAliasesByFile[ normalizedFilename ] = {};
	}
	if ( ! seedAliasesByFile[ normalizedFilename ][ componentName ] ) {
		seedAliasesByFile[ normalizedFilename ][ componentName ] = [];
	}

	const seedAliases = seedAliasesByFile[ normalizedFilename ][ componentName ];
	const seedKey = createSeedAliasKey( seedAlias );
	if ( seedAliases.some( existing => createSeedAliasKey( existing ) === seedKey ) ) {
		return false;
	}

	seedAliases.push( seedAlias );
	return true;
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
	].join( '|' );
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

module.exports = {
	createStoreSelectorCrossFileManifest,
	normalizeFilename,
};
