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
	const manifest = createStoreSelectorCrossFileManifest( sources, {
		config: options.config || {},
	} );

	return {
		...manifest,
		projectRoot: rootDir,
		projectFiles: files,
	};
}

function createStoreSelectorBabelOptions( manifest, options = {} ) {
	const experimentalStoreSelectors = typeof options.experimentalStoreSelectors === 'object' &&
		options.experimentalStoreSelectors !== null ?
		options.experimentalStoreSelectors :
		{};

	return {
		...options,
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

module.exports = {
	createStoreSelectorBabelOptions,
	createStoreSelectorProjectManifest,
	getProjectSourceFiles,
};
