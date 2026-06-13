
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
	return (
		types.isMemberExpression( path.parentPath?.node ) ||
		( typeof types.isOptionalMemberExpression === 'function' && types.isOptionalMemberExpression( path.parentPath?.node ) ) ||
		path.parentPath?.node?.type === 'OptionalMemberExpression'
	) && path.parentPath.node.object === path.node;
}


class ReplaceController {
	constructor( vars, contextName, babel, pathResolver = null ) {
		this.vars = vars;
		this.contextName = contextName;
		this.babel = babel;
		this.pathResolver = pathResolver;
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
		const replacementPath = this.getReplacementPathForIdentifier( path );
		// We need to update all the identifiers with the new variables declared in the block statement
		if ( replacementPath ) {
			// Make sure we only replace identifiers that are not props and also that
			// they are not variable declarations.
			const excludeTypes = [ 'ObjectProperty', 'MemberExpression', 'VariableDeclarator', 'ArrayPattern', 'AssignmentPattern' ];
			if ( path.parentPath.node && ! excludeTypes.includes( path.parentPath.node.type ) ) {
				path.node.name = this.vars.mapped[ replacementPath ];
			}

			// Now lets carefully update the node in 'ObjectProperty' types.
			// We can only re-assign the property value name, not the property key name
			// So we want { varName } to become { varName: _uid } or { something: varName } to become { something: _uid }
			if ( types.isObjectProperty( path.parentPath.node ) && ! types.isObjectPattern( path.parentPath.parentPath.node ) ) {
				if ( types.isIdentifier( path.parentPath.node.value ) ) {
					const valueName = path.parentPath.node.value.name;
					const valuePath = this.getReplacementPathForIdentifier( path );
					if ( valuePath && valueName === path.node.name ) {
						path.parentPath.node.value.name = this.vars.mapped[ valuePath ];
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

		const pathName = this.getReplacementPathForSegments( segments, path );
		if ( ! this.vars.names.includes( pathName ) ) {
			return;
		}

		path.replaceWith( types.identifier( this.vars.mapped[ pathName ] ) );
	}

	getReplacementPathForIdentifier( path ) {
		return this.getReplacementPathForSegments( [ path.node.name ], path );
	}

	getReplacementPathForSegments( segments, path ) {
		if ( this.pathResolver ) {
			const resolvedArg = this.pathResolver.resolveTemplateArg( {
				type: segments.length > 1 ? 'path' : 'identifier',
				value: segments.join( '.' ),
				segments,
			}, path );

			if ( resolvedArg.matchedTemplatePath && this.vars.names.includes( resolvedArg.matchedTemplatePath ) ) {
				return resolvedArg.matchedTemplatePath;
			}
		}

		const pathName = segments.join( '.' );
		return this.vars.names.includes( pathName ) ? pathName : null;
	}
};

module.exports = { ReplaceController };
