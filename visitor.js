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
	collectStoreSelectorImports,
	collectStoreSelectorChildPropFlows,
	collectStoreSelectorTemplateVars,
	createAliasResolver,
	createStoreSelectorPropAliases,
	createStoreSelectorSeedAliases,
	createStoreSelectorDynamicRootAliases,
	assertNoUnprocessedStoreSelectorReferences,
	isStoreSelectorEnabled,
	isStoreSelectorDebugEnabled,
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
			const componentPath = getComponentPath( path.parentPath, componentName );
			
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

			const selectorImports = collectStoreSelectorImports( programPath, babel );
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

			pendingTemplateVars.forEach( ( pending, componentName ) => {
				if ( processedComponents.has( componentName ) ) {
					return;
				}

				const componentPath = getComponentPath( programPath, componentName );
				if ( ! componentPath ) {
					return;
				}

				const templateVars = createTemplateVarsRegistry( pending.templateVars, componentPath, babel, pending.errorPath );
				templateVarsController.init( templateVars, componentName, componentPath, babel, config );
			} );

			assertNoUnprocessedStoreSelectorReferences( programPath, selectorImports, babel );
			removeStoreSelectorImportSpecifiers( selectorImports.importSpecifiers );

			if ( debugStoreSelectors ) {
				state.file.metadata.storeSelectorTemplateVars = [
					...( state.file.metadata.storeSelectorTemplateVars || [] ),
					...debugEntries,
				];
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
function getComponentPath( path, componentName ) {
	let componentPath;
	path.traverse( {
		VariableDeclaration( subPath ) {
			const declarationName = subPath.node.declarations[0].id.name
			if ( declarationName === componentName ) {
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

module.exports = templateVarsVisitor;
