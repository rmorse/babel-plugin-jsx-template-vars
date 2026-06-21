const fs = require( 'fs' );
const path = require( 'path' );
const { createStoreSelectorCrossFileManifest } = require( './store-selector-cross-file' );

const DEFAULT_EXTENSIONS = new Set( [ '.js', '.jsx', '.ts', '.tsx' ] );
const DEFAULT_IGNORE_DIRS = new Set( [ 'node_modules', '.git' ] );

function createStoreSelectorProjectManifest( options = {} ) {
	const rootDir = path.resolve( options.rootDir || process.cwd() );
	const extensions = new Set( options.extensions || DEFAULT_EXTENSIONS );
	const ignoreDirs = new Set( [
		...DEFAULT_IGNORE_DIRS,
		...( options.ignoreDirs || [] ),
	] );
	const files = getProjectSourceFiles( rootDir, {
		files: options.files,
		extensions,
		ignoreDirs,
	} );
	const sources = Object.fromEntries( files.map( filename => [
		filename,
		fs.readFileSync( filename, 'utf8' ),
	] ) );
	const resolver = createProjectResolver( rootDir, options );
	const manifest = createStoreSelectorCrossFileManifest( sources, {
		config: options.config || {},
		resolver,
	} );

	return {
		...manifest,
		projectRoot: rootDir,
		projectFiles: files,
		projectResolver: resolver,
		projectResolverDiagnostics: resolver.diagnostics || [],
	};
}

function createStoreSelectorBabelOptions( manifest, options = {} ) {
	const experimentalStoreSelectors = typeof options.experimentalStoreSelectors === 'object' &&
		options.experimentalStoreSelectors !== null ?
		options.experimentalStoreSelectors :
		{};

	return {
		...options,
		...( ( options.resolver || manifest.projectResolver ) ? {
			resolver: options.resolver || manifest.projectResolver,
		} : {} ),
		experimentalStoreSelectors: {
			...experimentalStoreSelectors,
			crossFile: true,
			__crossFileManifest: manifest,
		},
	};
}

function getProjectSourceFiles( rootDir, options = {} ) {
	if ( Array.isArray( options.files ) ) {
		return options.files
			.map( filename => path.resolve( rootDir, filename ) )
			.filter( filename => options.extensions.has( path.extname( filename ).toLowerCase() ) )
			.sort();
	}

	const files = [];
	walkProjectFiles( rootDir, {
		files,
		extensions: options.extensions,
		ignoreDirs: options.ignoreDirs,
	} );
	return files.sort();
}

function walkProjectFiles( currentDir, options ) {
	const entries = fs.readdirSync( currentDir, { withFileTypes: true } );
	entries.forEach( ( entry ) => {
		const filename = path.join( currentDir, entry.name );
		if ( entry.isDirectory() ) {
			if ( options.ignoreDirs.has( entry.name ) ) {
				return;
			}
			walkProjectFiles( filename, options );
			return;
		}

		if ( entry.isFile() && options.extensions.has( path.extname( entry.name ).toLowerCase() ) ) {
			options.files.push( filename );
		}
	} );
}

function createProjectResolver( rootDir, options = {} ) {
	const discoveredResolver = options.discoverConfig === false ? {} : discoverConfigResolver( rootDir, options );
	const explicitResolver = options.resolver || options.config?.resolver || {};
	return {
		...discoveredResolver,
		...explicitResolver,
		aliases: {
			...( discoveredResolver.aliases || {} ),
			...( explicitResolver.aliases || {} ),
		},
		exactAliases: {
			...( discoveredResolver.exactAliases || {} ),
			...( explicitResolver.exactAliases || {} ),
		},
		unsupportedAliases: {
			...( discoveredResolver.unsupportedAliases || {} ),
			...( explicitResolver.unsupportedAliases || {} ),
		},
		diagnostics: [
			...( discoveredResolver.diagnostics || [] ),
			...( explicitResolver.diagnostics || [] ),
		],
	};
}

function discoverConfigResolver( rootDir, options = {} ) {
	const configFilename = findProjectConfigFile( rootDir, options );
	if ( ! configFilename ) {
		return {};
	}

	const diagnostics = [];
	const config = readJsonConfigFile( configFilename, diagnostics );
	if ( ! config ) {
		return {
			configFile: configFilename,
			diagnostics,
		};
	}

	const compilerOptions = config.compilerOptions || {};
	const configDir = path.dirname( configFilename );
	const baseUrl = compilerOptions.baseUrl ?
		path.resolve( configDir, compilerOptions.baseUrl ) :
		configDir;
	const resolver = {
		configFile: configFilename,
		diagnostics,
		aliases: {},
		exactAliases: {},
		unsupportedAliases: {},
	};

	if ( compilerOptions.baseUrl ) {
		if ( isPathInsideRoot( baseUrl, rootDir ) ) {
			resolver.baseUrl = baseUrl;
		} else {
			diagnostics.push( {
				kind: 'out-of-root-base-url',
				configFile: configFilename,
				baseUrl,
				message: `Store selector project resolver ignored baseUrl "${ compilerOptions.baseUrl }" because it resolves outside the project root.`,
			} );
		}
	}

	const paths = compilerOptions.paths && typeof compilerOptions.paths === 'object' ? compilerOptions.paths : {};
	Object.entries( paths ).forEach( ( [ pattern, targets ] ) => {
		addPathMapping( resolver, pattern, targets, baseUrl, rootDir, configFilename );
	} );

	return resolver;
}

function findProjectConfigFile( rootDir, options = {} ) {
	if ( options.configFile ) {
		const configFilename = path.resolve( rootDir, options.configFile );
		return fs.existsSync( configFilename ) ? configFilename : null;
	}

	const candidates = [
		path.join( rootDir, 'tsconfig.json' ),
		path.join( rootDir, 'jsconfig.json' ),
	];
	return candidates.find( filename => fs.existsSync( filename ) ) || null;
}

function readJsonConfigFile( filename, diagnostics ) {
	try {
		return JSON.parse( stripJsonComments( fs.readFileSync( filename, 'utf8' ) ) );
	} catch ( error ) {
		diagnostics.push( {
			kind: 'resolver-config-parse-error',
			configFile: filename,
			message: `Store selector project resolver could not parse "${ filename }": ${ error.message }`,
		} );
		return null;
	}
}

function stripJsonComments( source ) {
	return source
		.replace( /\/\*[\s\S]*?\*\//g, '' )
		.replace( /^\s*\/\/.*$/gm, '' );
}

function addPathMapping( resolver, pattern, targets, baseUrl, rootDir, configFilename ) {
	const alias = getAliasPrefixForPattern( pattern );
	if ( ! alias ) {
		return;
	}

	if ( ! Array.isArray( targets ) || targets.length !== 1 || typeof targets[ 0 ] !== 'string' ) {
		const diagnostic = {
			kind: 'ambiguous-path-mapping',
			configFile: configFilename,
			alias,
			message: `Store selector project resolver skipped path mapping "${ pattern }" because it has multiple or invalid targets.`,
		};
		resolver.unsupportedAliases[ alias ] = diagnostic;
		resolver.diagnostics.push( diagnostic );
		return;
	}

	const targetPattern = targets[ 0 ];
	const wildcard = pattern.includes( '*' ) || targetPattern.includes( '*' );
	if ( wildcard && ! ( isTrailingWildcardPattern( pattern ) && isTrailingWildcardPattern( targetPattern ) ) ) {
		const diagnostic = {
			kind: 'unsupported-path-mapping',
			configFile: configFilename,
			alias,
			message: `Store selector project resolver skipped path mapping "${ pattern }" because only trailing wildcard mappings are supported.`,
		};
		resolver.unsupportedAliases[ alias ] = diagnostic;
		resolver.diagnostics.push( diagnostic );
		return;
	}

	const target = wildcard ?
		path.resolve( baseUrl, targetPattern.slice( 0, -2 ) ) :
		path.resolve( baseUrl, targetPattern );
	if ( ! isPathInsideRoot( target, rootDir ) ) {
		const diagnostic = {
			kind: 'out-of-root-path-mapping',
			configFile: configFilename,
			alias,
			target,
			message: `Store selector project resolver skipped path mapping "${ pattern }" because it resolves outside the project root.`,
		};
		resolver.unsupportedAliases[ alias ] = diagnostic;
		resolver.diagnostics.push( diagnostic );
		return;
	}

	if ( wildcard ) {
		resolver.aliases[ alias ] = target;
		return;
	}

	resolver.exactAliases[ alias ] = target;
}

function getAliasPrefixForPattern( pattern ) {
	if ( typeof pattern !== 'string' || ! pattern ) {
		return null;
	}
	return isTrailingWildcardPattern( pattern ) ? pattern.slice( 0, -2 ) : pattern;
}

function isTrailingWildcardPattern( pattern ) {
	return typeof pattern === 'string' && pattern.endsWith( '/*' ) && pattern.indexOf( '*' ) === pattern.length - 1;
}

function isPathInsideRoot( target, rootDir ) {
	const relative = path.relative( path.resolve( rootDir ), path.resolve( target ) );
	return relative === '' || ( relative && ! relative.startsWith( '..' ) && ! path.isAbsolute( relative ) );
}

module.exports = {
	createStoreSelectorBabelOptions,
	createStoreSelectorProjectManifest,
	getProjectSourceFiles,
};
