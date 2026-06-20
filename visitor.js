/**
 * Main visitor works by replacing variables throughout a component with Handlebars tags.
 *
 * Add `templateVars` to a component definition to specify which props are dynamic and need
 * to be exposed as Handlebars tags - to later be rendered with data from a server.
 *
 * Template vars are declared as flat data paths. The registry infers the roles
 * needed at supported usage sites:
 *
 * - *replace* - the path appears in rendered output and needs a template tag.
 * - *control* - the path appears in a supported condition controlling output.
 * - *list*    - the path declares list shape and appears in supported list output.
 *
 * ----
 *
 * Outline
 * - Look for `templateVars`
 * - Build a flat path registry and infer roles from supported AST usage
 * - Locate + visit the component definition - assumes it is the previous path ( sibling ( -1 ) ).
 *
 * Process replace role vars
 * - Declare new identifiers (with new values) for all replacement template props at the top of the component
 * - Replace occurences of the old identifiers with the new ones
 *   (exclude variable declarations and watch out for nested props)
 *
 * Process control role vars
 * - Look for the template var in JSX expressions (TODO: support more expression types)
 * - Remove the condition so the expression is always completed (showing the related JSX)
 * - Wrap JSX in handlebars tags using custom helpers to recreate the conditions
 * 
 * Process list role vars
 * - Declare new arrays with a template style version - eg `[ '{{.}}' ]` or `[ { value: '{{value}}', label: '{{label}}' } ]`
 *   for objects. 
 * - The new arrays will always have a length of 1.
 * - Look for any member expressions in the component definition that use the identifier + a `.map()` and track the new
 *   identifier name / assignment as well as the original identifier name.
 * - Look for the list vars (and any new identifiers from an earlier `.map()`) in JSX expressions - either on their
 *   own as an identifier or combined with `.map()` and wrap them in template tags.
 * - Also check for any control variables in JSX expressions which use list variables on the right of the experssion
 *   and wrap them in template tags.
  */
const {
	getArrayFromExpression,
} = require( './utils' );
const path = require( 'path' );

const templateVarsController = require( './controller' );
const { createTemplateVarsRegistry } = require( './template-vars-registry' );
const {
	getTopLevelComponentPath,
} = require( './component-adapter' );
const {
	collectStoreSelectorImports,
	collectTransparentHookSummaries,
	collectStoreSelectorChildPropFlows,
	collectStoreSelectorTemplateVars,
	createAliasResolver,
	createStoreSelectorPropAliases,
	createStoreSelectorSeedAliases,
	createStoreSelectorDynamicRootAliases,
	assertNoUnprocessedStoreSelectorReferences,
	isStoreSelectorEnabled,
	isStoreSelectorDebugEnabled,
	neutralizeTransparentHookSummaries,
	removeUnusedImportSpecifiers,
	removeStoreSelectorImportSpecifiers,
} = require( './store-selector-template-vars' );
const defaultLanguage = 'handlebars';

/**
 * Gets the template vars from the property definition.
 * 
 * @param {Object} expression The expression
 * @param {Object} types The babel types object
 * 
 * @returns 
 */
function getTemplateVarsFromExpression( expression, types ) {
	const left = expression.left;
	const right = expression.right;
	if ( ! left || ! right ) {
		return false;
	}

	const { object, property } = left;
	// Make sure the property being set is `templateVars`
	if ( ! types.isIdentifier( object ) ) {
		return false;
	}
	if ( ! types.isIdentifier( property ) ) {
		return false;
	}

	const objectName = object.name;
	const propertyName = property.name;

	if ( propertyName === 'templateVars' ) {
		let templatePropsValue = [];
		// Now process the right part of the expression: .templateVars = *right*.
		if ( right && right.type === 'ArrayExpression' ) {
			// Then we have an array to process the props.
			templatePropsValue = getArrayFromExpression( right );
		}
		return templatePropsValue;
	}
	return false;
}

/**
 * The main visitor for the plugin.
 * 
 * @param {Object} param0 Babel instance.
 * @param {Object} config Plugin config.
 * @returns 
 */
function templateVarsVisitor( babel, config ) {
	const { types } = babel;
	const tidyOnly = config.tidyOnly ?? false;
	const experimentalStoreSelectors = isStoreSelectorEnabled( config );
	const debugStoreSelectors = isStoreSelectorDebugEnabled( config );
	const storeSelectorOptions = typeof config.experimentalStoreSelectors === 'object' && config.experimentalStoreSelectors !== null ?
		config.experimentalStoreSelectors :
		{};
	const pendingTemplateVars = new Map();

	const visitor = {
		ExpressionStatement( path, state ) {
			// Try to look for the property assignment of `templateVars` and:
			// - Process the template vars for later
			// - Remove `templateVars` from the source code
			
			const { expression } = path.node;
			
			// Process the expression and get the raw template var declarations.
			const templatePropsValue = getTemplateVarsFromExpression( expression, types );
			if ( ! templatePropsValue ) {
				return;
			}

			// We know this exists because it was checked in getTemplateVarsFromExpression
			const componentName = path.node.expression.left.object.name;
			if ( experimentalStoreSelectors ) {
				pendingTemplateVars.set( componentName, {
					templateVars: templatePropsValue,
					errorPath: path,
				} );
				path.remove();
				return;
			}

			// Find the component path by name
			const componentPath = getComponentPath( path.parentPath, componentName, types );
			
			// Remove templateVars from the source
			path.remove();

			// If tidyOnly is set, exit here (immediately after the removal of the templateVars).
			if ( tidyOnly ) {
				return;
			}

			// If the component path is not found, exit here.
			if ( ! componentPath ) {
				return;
			}

			const templateVars = createTemplateVarsRegistry( templatePropsValue, componentPath, babel, path );
			templateVarsController.init( templateVars, componentName, componentPath, babel, config );
		}
	};

	return {
		visitor,
		processProgram( programPath, state ) {
			if ( ! experimentalStoreSelectors || tidyOnly ) {
				return;
			}

			const selectorImports = collectStoreSelectorImports( programPath, babel, config );
			const hookSummaries = collectTransparentHookSummaries( programPath, selectorImports, babel );
			const componentPaths = getTopLevelComponentPaths( programPath, types );
			const processedComponents = new Set();
			const debugEntries = [];
			const unsupportedEntries = [];
			const filename = normalizeStoreSelectorFilename( state.file.opts.filename );
			const componentNames = new Set( [
				...componentPaths.keys(),
				...getCrossFileComponentNames( storeSelectorOptions, filename ),
			] );
			const selectorResults = new Map();
			const childPropTracesByComponent = new Map();
			const seedAliasesByComponent = createInitialStoreSelectorSeedMap( componentPaths, storeSelectorOptions, filename );
			const crossFileDynamicRootPropsByComponent = getCrossFileDynamicRootPropsByComponent( storeSelectorOptions, filename );
			const crossFileDebug = getCrossFileDebugForFile( storeSelectorOptions, filename );
			const derivedUnsupportedRecords = [];

			for ( let pass = 0; pass < Math.max( componentPaths.size, 1 ); pass++ ) {
				selectorResults.clear();
				childPropTracesByComponent.clear();
				const childSeedTracesByComponent = new Map();
				const dynamicRootPropsForCollection = mergeDynamicRootPropsByComponent(
					createDynamicRootPropsByComponent( seedAliasesByComponent ),
					crossFileDynamicRootPropsByComponent
				);

				componentPaths.forEach( ( componentPath, componentName ) => {
					const selectorResult = collectStoreSelectorTemplateVars( componentPath, selectorImports.localNames, babel, {
						...config,
						storeSelectorComponentNames: componentNames,
						storeSelectorComponentPaths: componentPaths,
						storeSelectorSeedAliases: seedAliasesByComponent.get( componentName ) || [],
						storeSelectorDynamicRootPropsByComponent: dynamicRootPropsForCollection,
						storeSelectorConfiguredLocalNames: selectorImports.configuredLocalNames,
						storeSelectorHookSummariesByBinding: hookSummaries.summariesByBinding,
						storeSelectorNeutralizeSelectors: false,
					} );
					selectorResults.set( componentName, selectorResult );

					collectStoreSelectorChildPropFlows( selectorResult, childPropTracesByComponent, childSeedTracesByComponent );
				} );

				let addedSeed = false;
				childPropTracesByComponent.forEach( ( propTraces, componentName ) => {
					const componentPath = componentPaths.get( componentName );
					if ( ! componentPath ) {
						return;
					}

					const dynamicRootAliases = createStoreSelectorDynamicRootAliases( componentPath, propTraces, babel );
					dynamicRootAliases.forEach( ( seedAlias ) => {
						if ( addStoreSelectorSeedAlias( seedAliasesByComponent, componentName, seedAlias ) ) {
							addedSeed = true;
						}
					} );
				} );

				const dynamicRootPropsForPass = mergeDynamicRootPropsByComponent(
					createDynamicRootPropsByComponent( seedAliasesByComponent ),
					crossFileDynamicRootPropsByComponent
				);
				childSeedTracesByComponent.forEach( ( seedTraces, componentName ) => {
					const componentPath = componentPaths.get( componentName );
					if ( ! componentPath ) {
						return;
					}

					const relatedFlows = childPropTracesByComponent.get( componentName ) || [];
					const seedAliases = createStoreSelectorSeedAliases( componentPath, seedTraces, babel, {
						...config,
						storeSelectorDynamicRootPropsByComponent: dynamicRootPropsForPass,
						storeSelectorUnsupportedRecords: derivedUnsupportedRecords,
					}, relatedFlows );
					seedAliases.forEach( ( seedAlias ) => {
						if ( addStoreSelectorSeedAlias( seedAliasesByComponent, componentName, seedAlias ) ) {
							addedSeed = true;
						}
					} );
				} );

				if ( ! addedSeed ) {
					break;
				}
			}

			const dynamicRootPropsByComponent = mergeDynamicRootPropsByComponent(
				createDynamicRootPropsByComponent( seedAliasesByComponent ),
				crossFileDynamicRootPropsByComponent
			);

			selectorResults.clear();
			childPropTracesByComponent.clear();
			componentPaths.forEach( ( componentPath, componentName ) => {
				const selectorResult = collectStoreSelectorTemplateVars( componentPath, selectorImports.localNames, babel, {
					...config,
					storeSelectorComponentNames: componentNames,
					storeSelectorComponentPaths: componentPaths,
					storeSelectorSeedAliases: seedAliasesByComponent.get( componentName ) || [],
					storeSelectorDynamicRootPropsByComponent: dynamicRootPropsByComponent,
					storeSelectorConfiguredLocalNames: selectorImports.configuredLocalNames,
					storeSelectorHookSummariesByBinding: hookSummaries.summariesByBinding,
				} );
				selectorResults.set( componentName, selectorResult );

				collectStoreSelectorChildPropFlows( selectorResult, childPropTracesByComponent, new Map() );
			} );

			componentPaths.forEach( ( componentPath, componentName ) => {
				const pending = pendingTemplateVars.get( componentName );
				const selectorResult = selectorResults.get( componentName );
				const propTraceResult = createStoreSelectorPropAliases(
					componentPath,
					childPropTracesByComponent.get( componentName ) || [],
					babel,
					{
						...config,
						storeSelectorDynamicRootPropsByComponent: dynamicRootPropsByComponent,
					}
				);
				const aliases = [
					...selectorResult.aliases,
					...propTraceResult.aliases,
				];
				const explicitTemplateVars = pending?.templateVars || [];
				const explicitTemplateVarsSet = new Set( explicitTemplateVars );
				const shadowedTemplateVars = selectorResult.declarations.filter( declaration => explicitTemplateVarsSet.has( declaration ) );
				const selectorDeclarations = selectorResult.declarations.filter( declaration => ! explicitTemplateVarsSet.has( declaration ) );
				const combinedTemplateVars = Array.from( new Set( [
					...explicitTemplateVars,
					...selectorDeclarations,
					...propTraceResult.declarations,
				] ) );
				const dynamicRootAliases = ( seedAliasesByComponent.get( componentName ) || [] ).filter( alias => alias.dynamicRoot );
				const dynamicRootDebugAliases = dynamicRootAliases.map( createDynamicRootDebugAlias );
				const dynamicRootProps = dynamicRootPropsByComponent[ componentName ] || [];
				if ( selectorResult.debug.unsupported.length > 0 ) {
					unsupportedEntries.push( {
						componentName,
						unsupported: selectorResult.debug.unsupported,
					} );
				}

				if (
					debugStoreSelectors &&
					(
						selectorResult.hasSelectors ||
						selectorResult.debug.rawDeclarations.length > 0 ||
						selectorResult.debug.aliases.length > 0 ||
						selectorResult.debug.unsupported.length > 0 ||
						dynamicRootDebugAliases.length > 0 ||
						dynamicRootProps.length > 0
					)
				) {
					debugEntries.push( {
						componentName,
						rawDeclarations: selectorResult.debug.rawDeclarations,
						declarations: selectorResult.debug.declarations,
						aliases: selectorResult.debug.aliases,
						listShapes: selectorResult.debug.listShapes,
						declarationProvenance: selectorResult.debug.declarationProvenance,
						unsupported: selectorResult.debug.unsupported,
						childPropTraces: selectorResult.debug.childPropTraces,
						incomingPropTraces: childPropTracesByComponent.get( componentName ) || [],
						dynamicRootAliases: dynamicRootDebugAliases,
						dynamicRootProps,
						dynamicRootPropsByComponent,
						explicitTemplateVars,
						shadowedTemplateVars,
						combinedTemplateVars,
					} );
				}

				if ( combinedTemplateVars.length === 0 && aliases.length === 0 ) {
					return;
				}

				const aliasResolver = createAliasResolver( aliases );
				const templateVars = createTemplateVarsRegistry(
					combinedTemplateVars,
					componentPath,
					babel,
					pending?.errorPath || componentPath,
					{ resolveSegments: aliasResolver }
				);

				templateVarsController.init( templateVars, componentName, componentPath, babel, {
					...config,
					storeSelectorAliases: aliases,
					dynamicRootAliases,
					dynamicRootPropsByComponent: dynamicRootPropsByComponent,
				} );
				processedComponents.add( componentName );
			} );

			mergeStoreSelectorUnsupportedRecords( unsupportedEntries, derivedUnsupportedRecords );

			pendingTemplateVars.forEach( ( pending, componentName ) => {
				if ( processedComponents.has( componentName ) ) {
					return;
				}

				const componentPath = getComponentPath( programPath, componentName, types );
				if ( ! componentPath ) {
					return;
				}

				const templateVars = createTemplateVarsRegistry( pending.templateVars, componentPath, babel, pending.errorPath );
				templateVarsController.init( templateVars, componentName, componentPath, babel, config );
			} );

			neutralizeTransparentHookSummaries( hookSummaries, babel );
			assertNoUnprocessedStoreSelectorReferences( programPath, selectorImports, babel );
			removeStoreSelectorImportSpecifiers( selectorImports.importSpecifiers );
			removeUnusedImportSpecifiers( selectorImports.reactHookImportSpecifiers );

			if ( debugStoreSelectors ) {
				state.file.metadata.storeSelectorTemplateVars = [
					...( state.file.metadata.storeSelectorTemplateVars || [] ),
					...debugEntries,
				];
				if ( crossFileDebug ) {
					state.file.metadata.storeSelectorTemplateVarsCrossFile = crossFileDebug;
				}
			}
			if ( unsupportedEntries.length > 0 ) {
				state.file.metadata.storeSelectorTemplateVarsUnsupported = [
					...( state.file.metadata.storeSelectorTemplateVarsUnsupported || [] ),
					...unsupportedEntries,
				];
			}
		}
	};
};

// Find and return a component (variable declaration) path via traversal by its name.
function getComponentPath( path, componentName, types ) {
	let componentPath;
	path.traverse( {
		VariableDeclaration( subPath ) {
			const component = getTopLevelComponentPath( subPath, types );
			if ( component?.name === componentName ) {
				componentPath = component.path;
			}
			subPath.skip();
		},
		FunctionDeclaration( subPath ) {
			if ( subPath.node.id?.name === componentName ) {
				componentPath = subPath;
			}
			subPath.skip();
		}
	} );
	return componentPath;
}

function createInitialStoreSelectorSeedMap( componentPaths, storeSelectorOptions, filename ) {
	const seedAliasesByComponent = new Map();
	componentPaths.forEach( ( _componentPath, componentName ) => {
		const seedAliases = [
			...( storeSelectorOptions.__seedAliasesByComponent?.[ componentName ] || [] ),
			...getCrossFileSeedAliases( storeSelectorOptions, filename, componentName ),
		];
		if ( seedAliases.length > 0 ) {
			seedAliasesByComponent.set( componentName, [ ...seedAliases ] );
		}
	} );
	return seedAliasesByComponent;
}

function getCrossFileComponentNames( storeSelectorOptions, filename ) {
	if ( storeSelectorOptions.crossFile !== true ) {
		return [];
	}

	const componentNamesByFile = storeSelectorOptions.__crossFileManifest?.componentNamesByFile || {};
	const componentNames = getCrossFileManifestEntry( componentNamesByFile, filename );
	return Array.isArray( componentNames ) ? componentNames : [];
}

function getCrossFileSeedAliases( storeSelectorOptions, filename, componentName ) {
	if ( storeSelectorOptions.crossFile !== true ) {
		return [];
	}

	const seedAliasesByFile = storeSelectorOptions.__crossFileManifest?.seedAliasesByFile || {};
	const seedAliasesByComponent = getCrossFileManifestEntry( seedAliasesByFile, filename );
	const seedAliases = seedAliasesByComponent?.[ componentName ];
	return Array.isArray( seedAliases ) ? seedAliases : [];
}

function getCrossFileDynamicRootPropsByComponent( storeSelectorOptions, filename ) {
	if ( storeSelectorOptions.crossFile !== true ) {
		return {};
	}

	const dynamicRootPropsByFile = storeSelectorOptions.__crossFileManifest?.dynamicRootPropsByFile || {};
	const propsByComponent = getCrossFileManifestEntry( dynamicRootPropsByFile, filename );
	return propsByComponent && typeof propsByComponent === 'object' && ! Array.isArray( propsByComponent ) ?
		propsByComponent :
		{};
}

function getCrossFileDebugForFile( storeSelectorOptions, filename ) {
	if ( storeSelectorOptions.crossFile !== true ) {
		return null;
	}

	const manifest = storeSelectorOptions.__crossFileManifest;
	if ( ! manifest ) {
		return null;
	}

	const normalizedFilename = normalizeStoreSelectorFilename( filename );
	const callsiteContexts = getCrossFileManifestEntry( manifest.callsiteContextsByFile || {}, normalizedFilename ) || [];
	const childRelativeDiscovery = getCrossFileManifestEntry( manifest.childRelativeDiscoveryByFile || {}, normalizedFilename ) || {};
	const dynamicRootProps = getCrossFileManifestEntry( manifest.dynamicRootPropsByFile || {}, normalizedFilename ) || {};
	const importEdges = ( manifest.debug?.importEdges || [] ).filter( edge => normalizeStoreSelectorFilename( edge.sourceFilename ) === normalizedFilename );
	const seedEdges = ( manifest.debug?.seedEdges || [] ).filter( edge => (
		normalizeStoreSelectorFilename( edge.sourceFilename ) === normalizedFilename ||
		normalizeStoreSelectorFilename( edge.targetFilename ) === normalizedFilename
	) );
	const skippedImports = ( manifest.debug?.skippedImports || [] ).filter( entry => normalizeStoreSelectorFilename( entry.filename ) === normalizedFilename );
	const diagnostics = ( manifest.diagnostics || [] ).filter( diagnostic => (
		diagnostic.filename && normalizeStoreSelectorFilename( diagnostic.filename ) === normalizedFilename
	) );

	if (
		callsiteContexts.length === 0 &&
		Object.keys( childRelativeDiscovery ).length === 0 &&
		Object.keys( dynamicRootProps ).length === 0 &&
		importEdges.length === 0 &&
		seedEdges.length === 0 &&
		skippedImports.length === 0 &&
		diagnostics.length === 0
	) {
		return null;
	}

	return {
		filename: normalizedFilename,
		callsiteContexts: callsiteContexts.map( context => ( {
			...context,
			canonicalPath: stringifyStoreSelectorSegments( context.canonicalSegments || [] ),
			declarationPath: stringifyStoreSelectorSegments( context.declarationSegments || [] ),
			compiledPaths: getCompiledPathsForCallsiteContext( context, manifest ),
		} ) ),
		childRelativeDiscovery,
		dynamicRootProps,
		importEdges,
		seedEdges,
		skippedImports,
		diagnostics,
	};
}

function getCompiledPathsForCallsiteContext( context, manifest ) {
	const canonicalSegments = normalizeStoreSelectorSegments( context.canonicalSegments || [] );
	const discoveryByComponent = getCrossFileManifestEntry( manifest.childRelativeDiscoveryByFile || {}, context.targetFile ) || {};
	const discoveryEntries = discoveryByComponent[ context.targetComponent ] || [];
	const discoveryEntry = discoveryEntries.find( entry => entry.propName === context.propName );
	const localPaths = discoveryEntry?.localPaths || [];
	if ( localPaths.length === 0 ) {
		return [ stringifyStoreSelectorSegments( canonicalSegments ) ].filter( Boolean );
	}

	const dynamicRootSegments = normalizeStoreSelectorSegments(
		discoveryEntry.dynamicRootSegments || [ discoveryEntry.localName ].filter( Boolean )
	);
	const compiledPaths = localPaths.map( localPath => {
		const localSegments = normalizeStoreSelectorSegments( localPath );
		const suffix = segmentsStartWith( localSegments, dynamicRootSegments ) ?
			localSegments.slice( dynamicRootSegments.length ) :
			localSegments;
		return stringifyStoreSelectorSegments( [
			...canonicalSegments,
			...suffix,
		] );
	} ).filter( Boolean );

	return Array.from( new Set( compiledPaths ) ).sort();
}

function getCrossFileManifestEntry( manifestByFile, filename ) {
	if ( ! manifestByFile || ! filename ) {
		return null;
	}

	const normalizedFilename = normalizeStoreSelectorFilename( filename );
	return manifestByFile[ filename ] ||
		manifestByFile[ normalizedFilename ] ||
		manifestByFile[ filename.replace( /\\/g, '/' ) ] ||
		manifestByFile[ normalizedFilename.replace( /\\/g, '/' ) ] ||
		null;
}

function normalizeStoreSelectorFilename( filename ) {
	return path.normalize( path.resolve( filename ) );
}

function addStoreSelectorSeedAlias( seedAliasesByComponent, componentName, seedAlias ) {
	if ( ! seedAliasesByComponent.has( componentName ) ) {
		seedAliasesByComponent.set( componentName, [] );
	}

	const seedAliases = seedAliasesByComponent.get( componentName );
	const seedKey = createStoreSelectorSeedAliasKey( seedAlias );
	if ( seedAliases.some( existing => createStoreSelectorSeedAliasKey( existing ) === seedKey ) ) {
		return false;
	}

	seedAliases.push( seedAlias );
	return true;
}

function createDynamicRootPropsByComponent( seedAliasesByComponent ) {
	const entries = {};
	seedAliasesByComponent.forEach( ( seedAliases, componentName ) => {
		const props = Array.from( new Set(
			seedAliases
				.filter( alias => alias.dynamicRoot && alias.propName )
				.map( alias => alias.propName )
		) );
		if ( props.length > 0 ) {
			entries[ componentName ] = props;
		}
	} );
	return entries;
}

function mergeDynamicRootPropsByComponent( ...sources ) {
	const merged = {};
	sources.forEach( ( source ) => {
		if ( ! source || typeof source !== 'object' ) {
			return;
		}

		Object.entries( source ).forEach( ( [ componentName, props ] ) => {
			if ( ! Array.isArray( props ) ) {
				return;
			}
			const existing = new Set( merged[ componentName ] || [] );
			props.forEach( prop => existing.add( prop ) );
			merged[ componentName ] = Array.from( existing ).sort();
		} );
	} );
	return merged;
}

function createDynamicRootDebugAlias( alias ) {
	return {
		localName: alias.localName,
		memberName: alias.memberName,
		propName: alias.propName,
		path: stringifyStoreSelectorSegments( alias.segments ),
		segments: alias.segments || [],
		declarationPath: stringifyStoreSelectorSegments( alias.declarationSegments || alias.segments ),
		declarationSegments: alias.declarationSegments || alias.segments || [],
		dynamicRootPath: stringifyStoreSelectorSegments( alias.dynamicRootSegments || alias.declarationSegments || alias.segments ),
		dynamicRootSegments: alias.dynamicRootSegments || alias.declarationSegments || alias.segments || [],
		source: alias.source,
	};
}

function mergeStoreSelectorUnsupportedRecords( unsupportedEntries, records ) {
	const seen = new Set();
	unsupportedEntries.forEach( entry => {
		( entry.unsupported || [] ).forEach( unsupported => {
			seen.add( createStoreSelectorUnsupportedKey( entry.componentName, unsupported ) );
		} );
	} );

	records.forEach( ( record ) => {
		const unsupported = record.unsupported;
		const key = createStoreSelectorUnsupportedKey( record.componentName, unsupported );
		if ( seen.has( key ) ) {
			return;
		}
		seen.add( key );
		unsupportedEntries.push( {
			componentName: record.componentName,
			unsupported: [ unsupported ],
		} );
	} );
}

function createStoreSelectorUnsupportedKey( componentName, unsupported = {} ) {
	return [
		componentName,
		unsupported.kind || '',
		unsupported.propName || '',
		( unsupported.sourcePaths || [] ).join( ',' ),
		unsupported.message || '',
	].join( '|' );
}

function normalizeStoreSelectorSegments( segments ) {
	if ( typeof segments === 'string' ) {
		return segments.split( '.' ).filter( Boolean );
	}
	if ( ! Array.isArray( segments ) ) {
		return [];
	}
	return segments.flatMap( segment => String( segment ).split( '.' ).filter( Boolean ) );
}

function segmentsStartWith( segments, prefix ) {
	return prefix.length > 0 &&
		prefix.every( ( segment, index ) => segments[ index ] === segment );
}

function stringifyStoreSelectorSegments( segments = [] ) {
	return segments.join( '.' );
}

function createStoreSelectorSeedAliasKey( seedAlias ) {
	return [
		seedAlias.localName,
		seedAlias.memberName || '',
		( seedAlias.segments || [] ).join( '.' ),
		( seedAlias.declarationSegments || [] ).join( '.' ),
		seedAlias.dynamicRoot ? 'dynamic-root' : '',
		seedAlias.propName || '',
	].join( '|' );
}

function getTopLevelComponentPaths( programPath, types ) {
	const components = new Map();
	programPath.get( 'body' ).forEach( ( childPath ) => {
		const component = getTopLevelComponentPath( childPath, types );
		if ( ! component ) {
			return;
		}

		components.set( component.name, component.path );
	} );
	return components;
}

module.exports = templateVarsVisitor;
