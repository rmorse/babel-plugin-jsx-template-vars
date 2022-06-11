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

function getLanguageReplace( language, target, arg ) {
	return getLanguageString( language, 'replace', [ target ], [ arg ] );
}

function getLanguageList( language, target, arg ) {
	return getLanguageString( language, 'list', [ target ], [ arg ] );
}

function getLanguageControl( language, targets, args ) {
	return getLanguageString( language, 'control', targets, args );
}

function registerLanguage( language ) {
	languages[ language.name ] = language;
}
