// Specify languages to translate to here
// For now we can categories as replace, list and control
// But we should look at another structure in the future.

const php = {
	replace: {
		format: `<?php echo htmlspecialchars( $data[ "||%1||" ], ENT_QUOTES ); ?>`,
	},
	list: {
		open: `<?php foreach ( $data[ "||%1||" ] as $item ) { ?>`,
		close: `<?php } ?>`,
		formatObject: `<?php echo htmlspecialchars( $item[ "||%1||" ], ENT_QUOTES ); ?>`,
		formatPrimitive: `<?php echo htmlspecialchars( $item, ENT_QUOTES ); ?>`,
	},
	control: {
		ifTruthy: {
			open: `<?php if ( $data[ "||%1||" ] ) { ?>`,
			close: '<?php } ?>',
		},
		ifFalsy: {
			open: `<?php if ( ! $data[ "||%1||" ] ) { ?>`,
			close: '<?php } ?>',
		},
		ifEqual: {
			open: `<?php if ( $data[ "||%1||" ] === ||%2|| ) { ?>`,
			close: '<?php } ?>',
		},
		ifNotEqual: {
			open: `<?php if ( $data[ "||%1||" ] !== ||%2|| ) { ?>`,
			close: '<?php } ?>',
		},
	}
};

const handlebars = {
	replace: {
		format: `{{||%1||}}`,
	},
	list: {
		open: '{{#||%1||}}',
		close: '{{/||%1||}}',
		formatObject: `{{||%1||}}`,
		formatPrimitive: `{{.}}`,
	},
	control: {
		ifTruthy: {
			open: '{{#if_truthy ||%1||}}',
			close: '{{/if_truthy}}',
		},
		ifFalsy: {
			open: '{{#if_falsy ||%1||}}',
			close: '{{/if_falsy}}',
		},
		ifEqual: {
			open: '{{#if_equal ||%1|| ||%2||}}',
			close: '{{/if_equal}}',
		},
		ifNotEqual: {
			open: '{{#if_not_equal ||%1|| ||%2||}}',
			close: '{{/if_not_equal}}',
		},
	}
};

const languages = {
	php,
	handlebars,
};


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
function getLanguageString( language, type, targetString = [], argsArray ) {
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


module.exports = {
	getLanguageReplace,
	getLanguageList,
	getLanguageControl,
	languages,
};
