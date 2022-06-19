// Specify languages to translate to here
// For now we can categories as replace, list and control
// But we should look at another structure in the future.
const php = require('./languages/php');
const handlebars = require('./languages/handlebars');

// The main language object containing all registered languages.
const languages = {};

/**
 * Replaces tokens such as ||%1|| and ||%2|| with the arguments passed in.
 *
 * Note: index starts at 1, not 0.
 *
 * @param {String} string The soruce string
 * @param {Array} argsArray The arguments to replace
 * @returns {String} The string with the arguments replaced
 */
export function createLanguageString( string, argsArray, context ) {
	let str = string.replace( /\|\|\%(\d+)\|\|/g, ( match, key ) => {
		const matchIndex = parseInt( match.replace( /\D/g, '' ) );
		return argsArray[ matchIndex -1 ];
	} );

	// Now replace the var with the context
	str = str.replace( /\|\|\%(var)\|\|/g, ( match, key ) => {
		if ( context === 0 ) {
			return `data`;
		}
		return `data_${ context }`;
	} );

	return str.replace( /\|\|\%(subVar)\|\|/g, ( match, key ) => {
		return `data_${ context + 1 }`;
	} );
}

/**
 * 
 * @param {String} language The language to use
 * @param {String} type The variable type (replace, list, control)
 * @param {Array} targetString And array of paths/properties to target the desired string.
 * @param {Array} argsArray The arguments to replace
 * @returns {String} The string with the arguments replaced
 */
 export function getLanguageString( language, type, targetString = [], argsArray = [], context ) {
	let languageWithPath = languages[ language ][ type ];
	targetString.forEach( ( targetString, index ) => {
		if ( languageWithPath[ targetString ] ) {
			languageWithPath = languageWithPath[ targetString ];
		}
	} );

	return createLanguageString( languageWithPath, argsArray, context );
}

export function getLanguageReplace( language, target, arg, context ) {
	return getLanguageString( language, 'replace', [ target ], [ arg ], context );
}

export function getLanguageList( language, target, arg, context ) {
	return getLanguageString( language, 'list', [ target ], [ arg ], context );
}

export function getLanguageControl( language, targets, args, context ) {
	return getLanguageString( language, 'control', targets, args, context );
}

export function registerLanguage( language ) {
	languages[ language.name ] = language;
}

// Now register the built-in languages.
registerLanguage( php );
registerLanguage( handlebars );
