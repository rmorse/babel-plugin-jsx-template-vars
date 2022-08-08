

class ReplaceController {
	constructor( vars, contextName, babel ) {
		this.vars = vars;
		this.contextName = contextName;
		this.babel = babel;
		this.initVars = this.initVars.bind( this );
		this.updateIdentifierNames = this.updateIdentifierNames.bind( this );
	}
	initVars( path ) {
		// Add the new replace vars to to top of the block statement.
		const { parse } = this.babel;
		const self = this;
		this.vars.raw.forEach( ( templateVar ) => {
			const [ varName, varConfig ] = templateVar;
			// Alway declare as `let` so we don't need to worry about its usage later.
			const replaceString = `getLanguageString( [ 'language', 'open' ], [], ${ this.contextName } ) + getLanguageReplace( 'format', { value: '${ varName }' }, ${ self.contextName } ) + getLanguageString( [ 'language', 'close' ], [], ${ this.contextName } )`; 
			path.node.body.unshift( parse(`let ${ self.vars.mapped[ varName ] } = ${ replaceString };`) );
		} );
	}
	updateIdentifierNames( path ) {
		const { types } = this.babel;
		// We need to update all the identifiers with the new variables declared in the block statement
		if ( this.vars.names.includes( path.node.name ) ) {
			// Make sure we only replace identifiers that are not props and also that
			// they are not variable declarations.
			const excludeTypes = [ 'ObjectProperty', 'MemberExpression', 'VariableDeclarator', 'ArrayPattern' ];
			if ( path.parentPath.node && ! excludeTypes.includes( path.parentPath.node.type ) ) {
				path.node.name = this.vars.mapped[ path.node.name ];
			}

			// Now lets carefully update the node in 'ObjectProperty' types.
			// We can only re-assign the property value name, not the property key name
			// So we want { varName } to become { varName: _uid } or { something: varName } to become { something: _uid }
			if ( types.isObjectProperty( path.parentPath.node ) ) {
				if ( types.isIdentifier( path.parentPath.node.value ) ) {
					const valueName = path.parentPath.node.value.name;
					if ( this.vars.names.includes( valueName ) ) {
						path.parentPath.node.value.name = this.vars.mapped[ valueName ];
					}
				}
			}
		}
	}
};

module.exports = { ReplaceController };