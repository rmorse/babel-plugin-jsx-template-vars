/**
 * Generates a template ready version of a JSX app for processing server side for achieving SSR.
 * 
 * Support PHP and Handlebars as well as custom languages.
 * 
 */
const templateVarsVisitor = require( './visitor' );
const fs = require('fs')
const { fileURLToPath, pathToFileURL, format } = require( 'url' );
const path = require( 'path' );


const injectedFiles = [];
const filePath = pathToFileURL( __dirname ).href;
module.exports = ( babel, config ) => {
	// Creat custom import template for injecting language functions into components.
	const buildImport = babel.template(`
		import { getLanguageList, getLanguageReplace, getLanguageControl, registerLanguage } from "${ filePath }/language/index.js";
	`);
	const languageImportDeclaration = buildImport();
	const pluginPathURL = pathToFileURL( __dirname ).href;

	// Build custom language either from PHP or Handlebars preset, or a custom language.
	let language;
	// Try to read default location of custom language file.
	let languagePath;
	
	if ( config.language ) {
		languagePath = `${ __dirname }/language/languages/${ config.language }.json`;
	} else {
		languagePath = config.customLanguage ? config.customLanguage : './.tvlang';
	}

	/**
	 * *Note - we need to assign the template vars language to the window, so it doesn't matter
		when its loaded...
		We did inject this into `/languages/index.js` but most default webpack builds exclude
		node_modules so we can't inject it there (because we can't visit it)
	 */
	try {
		const data = fs.readFileSync( languagePath, { encoding: 'utf8' } );
		language = babel.parse( "window.templateVarsLanguage = " + data );
	} catch (err) {
		language = babel.parse( "window.templateVarsLanguage = {};" );
		console.log(err);
	}

	return {
		name: "template-vars-plugin",
		visitor: {
			Program(path, state) {
				const root = path;
				// The main plugin visitor.
				path.traverse( templateVarsVisitor( babel, config ) );

				// Inject our language functions to existing files via imports.
				// Make sure we haven't already added to the current file.
				if ( ! injectedFiles.includes( state.file.opts.filename ) ) {
					// Inject our language functions to existing files via imports.
					// Make sure we haven't already added to the current file.
					// And don't import into our own files, or node_modules.
					const filenameUrl = pathToFileURL( state.file.opts.filename ).href;
					if ( ! filenameUrl.includes( pluginPathURL ) && ! state.file.opts.filename.includes( 'node_modules' ) ) {
						injectedFiles.push( state.file.opts.filename );
						root.node.body.unshift( languageImportDeclaration );
					}
				}
			}
		},
	};
};
