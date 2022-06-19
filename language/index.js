// Specify languages to translate to here
// For now we can categories as replace, list and control
// But we should look at another structure in the future.

// The main language object the currently used language is stored in
// const language = ...;
// Which will be injected above here by the template vars plugin.

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
 * @param {String} type The variable type (replace, list, control)
 * @param {Array} targetString And array of paths/properties to target the desired string.
 * @param {Array} argsArray The arguments to replace
 * @returns {String} The string with the arguments replaced
 */
 export function getLanguageString( type, targetString = [], argsArray = [], context ) {
	let languageWithPath = window.templateVarsLanguage[ type ];
	targetString.forEach( ( targetString, index ) => {
		if ( languageWithPath[ targetString ] ) {
			languageWithPath = languageWithPath[ targetString ];
		}
	} );

	return createLanguageString( languageWithPath, argsArray, context );
}

export function getLanguageReplace( target, arg, context ) {
	return getLanguageString( 'replace', [ target ], [ arg ], context );
}

export function getLanguageList( target, arg, context ) {
	return getLanguageString( 'list', [ target ], [ arg ], context );
}

export function getLanguageControl( targets, args, context ) {
	return getLanguageString( 'control', targets, args, context );
}
