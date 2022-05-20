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
function createLanguageString( string, argsArray ) {
	return string.replace( /\|\|\%(\d+)\|\|/g, ( match, key ) => {
		const matchIndex = parseInt( match.replace( /\D/g, '' ) );
		return argsArray[ matchIndex -1 ];
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
function getLanguageString( language, type, targetString = [], argsArray = [] ) {
	let languageWithPath = languages[ language ][ type ];
	targetString.forEach( ( targetString, index ) => {
		if ( languageWithPath[ targetString ] ) {
			languageWithPath = languageWithPath[ targetString ];
		}
	} );

	return createLanguageString( languageWithPath, argsArray );
}

function getLanguageReplace( language, target, subject ) {
	return getLanguageString( language, 'replace', [ target ], [ subject ] );
}

function getLanguageList( language, target, subject ) {
	return getLanguageString( language, 'list', [ target ], [ subject ] );
}

function getLanguageControl( language, targets, subjects ) {
	return getLanguageString( language, 'control', targets, subjects );
}

function registerLanguage( language ) {
	languages[ language.name ] = language;
}

// Now register the built-in languages.
registerLanguage( php );
registerLanguage( handlebars );

module.exports = {
	getLanguageReplace,
	getLanguageList,
	getLanguageControl,
	registerLanguage,
	languages,
};
