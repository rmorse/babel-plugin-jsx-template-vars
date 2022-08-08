// Specify languages to translate to here
// For now we can categories as replace, list and control
// But we should look at another structure in the future.

// The main language object the currently used language is stored in
// const language = ...;
// Which will be injected above here by the template vars plugin.

/**
 * Detering if a arg is an identifier or string, by checking the first
 * and last character to see if they are single quotes.
 */
function isArgString( arg ) {
	return arg.charAt(0) === "'" && arg.charAt(arg.length - 1) === "'";
}
/**
 * Generates the variable string from the language with the correct context.
 *
 * @param {*} arg 
 * @param {*} context 
 * @returns 
 */
function getVariableString( arg, context ) {
	return getLanguageString( 'variable', [], [], context ).replace( "||%v||", arg );
}
/**
 * Replaces tokens such as ||%1|| and ||%2|| with the arguments passed in.
 *
 * Note: index starts at 1, not 0.
 *
 * @param {String} string The soruce string
 * @param {Array} argsArray The arguments to replace
 * @returns {String} The string with the arguments replaced
 */

export function createLanguageString( string, argsArray, context, tags = {} ) {
	// look for `[%...]
	let str = string.replace( /\[\%(.+?)\]/g, ( match, key ) => {
		const tagName = match.replace( /\[|\]|\%/g, '' );

		// Built in tags
		if ( tagName === '_context_' ) {
			return context === 0 ? 'data' : `data_${ context }`;
		} else if ( tagName === '_subcontext_' ) {
			return `data_${ context + 1 }`;
		} else if ( tagName === '_variable_' ) {
			const returnArg = argsArray.shift();
			return returnArg.value;
		}

		// Now lets get custom language tags.
		const variableNames = [
			'variable',
			'subvariable',
		]

		if ( tags[ tagName ] ) {
			// Instead of getting the language string, return the actual string or value.
			if ( variableNames.includes( tagName ) ) {
				// Instead of getting the language string, return the value.
				if ( argsArray[0].type === 'value' ) {
					const arg = argsArray.shift();
					return arg.value;
				}
			}
			return createLanguageString( tags[ tagName ], argsArray, context, tags );
		}
		
		return '';
	} );

	return str;
}

/**
 * @param {String} type The variable type (replace, list, control)
 * @param {Array} targetPath And array of paths/properties to target the desired string.
 * @param {Array} argsArray The arguments to replace
 * @returns {String} The string with the arguments replaced
 */
 export function getLanguageString( targetPath = [], argsArray = [], context ) {
	let languagePart = window.templateVarsLanguage;
	targetPath.forEach( ( target, index ) => {
		if ( languagePart[ target ] ) {
			languagePart = languagePart[ target ];
		}
	} );

	return createLanguageString( languagePart, [ ...argsArray ], context, window.templateVarsLanguage['variables'] );
}

export function getLanguageReplace( target, arg, context ) {
	return getLanguageString( [ 'replace', target ], [ arg ], context );
}

export function getLanguageList( target, arg, context ) {
	return getLanguageString( [ 'list', target ], [ arg ], context );
}

export function getLanguageControl( targets, args, context ) {
	console.log("getLanguageControl", targets, args, context);
	return getLanguageString( [ 'control', ...targets ], args, context );
}
