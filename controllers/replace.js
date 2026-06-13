
const {
	getArgObjectExpression,
	getLanguageCallExpression,
	getMemberExpressionSegments,
} = require( '../utils' );

function createTemplateArg( varName, varConfig, types ) {
	const segments = Array.isArray( varConfig.segments ) ? varConfig.segments : null;
	return {
		type: segments && segments.length > 1 ? 'path' : 'identifier',
		value: varName,
		segments,
	};
}

function isPartialMemberExpression( path, types ) {
	return types.isMemberExpression( path.parentPath?.node ) && path.parentPath.node.object === path.node;
}


class ReplaceController {
	constructor( vars, contextName, babel ) {
		this.vars = vars;
		this.contextName = contextName;
		this.babel = babel;
		this.initVars = this.initVars.bind( this );
		this.updateIdentifierNames = this.updateIdentifierNames.bind( this );
		this.updateMemberExpressionNames = this.updateMemberExpressionNames.bind( this );
	}
	initVars( path ) {
		// Add the new replace vars to to top of the block statement.
		const { types } = this.babel;
		const self = this;
		this.vars.raw.forEach( ( templateVar ) => {
			const [ varName, varConfig ] = templateVar;
			// Alway declare as `let` so we don't need to worry about its usage later.
			const languageOpen = getLanguageCallExpression( [ 'language', 'open' ], [], this.contextName, types );
			const replaceCall = types.callExpression(
				types.identifier( 'getLanguageReplace' ),
				[
					types.stringLiteral( 'format' ),
					getArgObjectExpression( createTemplateArg( varName, varConfig, types ), types ),
					types.identifier( self.contextName ),
				]
			);
			const languageClose = getLanguageCallExpression( [ 'language', 'close' ], [], this.contextName, types );
			const replaceExpression = types.binaryExpression(
				'+',
				types.binaryExpression( '+', languageOpen, replaceCall ),
				languageClose
			);

			path.node.body.unshift( types.variableDeclaration( 'let', [
				types.variableDeclarator( types.identifier( self.vars.mapped[ varName ] ), replaceExpression ),
			] ) );
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
			if ( types.isObjectProperty( path.parentPath.node ) && ! types.isObjectPattern( path.parentPath.parentPath.node ) ) {
				if ( types.isIdentifier( path.parentPath.node.value ) ) {
					const valueName = path.parentPath.node.value.name;
					if ( this.vars.names.includes( valueName ) ) {
						path.parentPath.node.value.name = this.vars.mapped[ valueName ];
					}
				}
			}
		}
	}
	updateMemberExpressionNames( path ) {
		const { types } = this.babel;
		if ( isPartialMemberExpression( path, types ) ) {
			return;
		}

		const segments = getMemberExpressionSegments( path.node, types );
		if ( ! segments ) {
			return;
		}

		const pathName = segments.join( '.' );
		if ( ! this.vars.names.includes( pathName ) ) {
			return;
		}

		path.replaceWith( types.identifier( this.vars.mapped[ pathName ] ) );
	}
};

module.exports = { ReplaceController };
