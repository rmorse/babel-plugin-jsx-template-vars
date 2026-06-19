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

const templateVarsController = require( './controller' );
const { createTemplateVarsRegistry } = require( './template-vars-registry' );
const {
	collectStoreSelectorImports,
	collectStoreSelectorTemplateVars,
	createAliasResolver,
	createStoreSelectorPropAliases,
	createStoreSelectorSeedAliases,
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
			const componentNames = new Set( componentPaths.keys() );
			const selectorResults = new Map();
			const childPropTracesByComponent = new Map();
			const seedAliasesByComponent = createInitialStoreSelectorSeedMap( componentPaths, storeSelectorOptions );

			for ( let pass = 0; pass < Math.max( componentPaths.size, 1 ); pass++ ) {
				selectorResults.clear();
				childPropTracesByComponent.clear();
				const childSeedTracesByComponent = new Map();

				componentPaths.forEach( ( componentPath, componentName ) => {
					const selectorResult = collectStoreSelectorTemplateVars( componentPath, selectorImports.localNames, babel, {
						...config,
						storeSelectorComponentNames: componentNames,
						storeSelectorSeedAliases: seedAliasesByComponent.get( componentName ) || [],
						storeSelectorNeutralizeSelectors: false,
					} );
					selectorResults.set( componentName, selectorResult );

					collectChildPropFlows( selectorResult, childPropTracesByComponent, childSeedTracesByComponent );
				} );

				let addedSeed = false;
				childSeedTracesByComponent.forEach( ( seedTraces, componentName ) => {
					const componentPath = componentPaths.get( componentName );
					if ( ! componentPath ) {
						return;
					}

					const relatedFlows = childPropTracesByComponent.get( componentName ) || [];
					const seedAliases = createStoreSelectorSeedAliases( componentPath, seedTraces, babel, config, relatedFlows );
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

			selectorResults.clear();
			childPropTracesByComponent.clear();
			componentPaths.forEach( ( componentPath, componentName ) => {
				const selectorResult = collectStoreSelectorTemplateVars( componentPath, selectorImports.localNames, babel, {
					...config,
					storeSelectorComponentNames: componentNames,
					storeSelectorSeedAliases: seedAliasesByComponent.get( componentName ) || [],
				} );
				selectorResults.set( componentName, selectorResult );

				collectChildPropFlows( selectorResult, childPropTracesByComponent, new Map() );
			} );

			componentPaths.forEach( ( componentPath, componentName ) => {
				const pending = pendingTemplateVars.get( componentName );
				const selectorResult = selectorResults.get( componentName );
				const propTraceResult = createStoreSelectorPropAliases(
					componentPath,
					childPropTracesByComponent.get( componentName ) || [],
					babel,
					config
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
						selectorResult.debug.unsupported.length > 0
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

function createInitialStoreSelectorSeedMap( componentPaths, storeSelectorOptions ) {
	const seedAliasesByComponent = new Map();
	componentPaths.forEach( ( _componentPath, componentName ) => {
		const seedAliases = storeSelectorOptions.__seedAliasesByComponent?.[ componentName ] || [];
		if ( seedAliases.length > 0 ) {
			seedAliasesByComponent.set( componentName, [ ...seedAliases ] );
		}
	} );
	return seedAliasesByComponent;
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

function createStoreSelectorSeedAliasKey( seedAlias ) {
	return [
		seedAlias.localName,
		( seedAlias.segments || [] ).join( '.' ),
		( seedAlias.declarationSegments || [] ).join( '.' ),
	].join( '|' );
}

function getTopLevelComponentPaths( programPath, types ) {
	const components = new Map();
	programPath.get( 'body' ).forEach( ( childPath ) => {
		if ( ! types.isVariableDeclaration( childPath.node ) || childPath.node.declarations.length !== 1 ) {
			return;
		}

		const declaration = childPath.node.declarations[ 0 ];
		if ( ! types.isIdentifier( declaration.id ) || ! isComponentName( declaration.id.name ) ) {
			return;
		}

		if (
			! types.isArrowFunctionExpression( declaration.init ) &&
			! types.isFunctionExpression( declaration.init )
		) {
			return;
		}

		components.set( declaration.id.name, childPath );
	} );
	return components;
}

function isComponentName( name ) {
	return typeof name === 'string' && /^[A-Z]/.test( name );
}

module.exports = templateVarsVisitor;
