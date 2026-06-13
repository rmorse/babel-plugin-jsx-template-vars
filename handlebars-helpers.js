function ifEqual( left, right, options ) {
	return left === right ? options.fn( this ) : options.inverse( this );
}

function ifNotEqual( left, right, options ) {
	return left !== right ? options.fn( this ) : options.inverse( this );
}

function registerJsxTemplateVarsHandlebarsHelpers( Handlebars ) {
	if ( ! Handlebars || typeof Handlebars.registerHelper !== 'function' ) {
		throw new TypeError( 'A Handlebars instance with registerHelper is required.' );
	}

	Handlebars.registerHelper( 'if_equal', ifEqual );
	Handlebars.registerHelper( 'if_not_equal', ifNotEqual );

	return Handlebars;
}

module.exports = {
	ifEqual,
	ifNotEqual,
	registerJsxTemplateVarsHandlebarsHelpers,
};
