const { getLanguageCallExpression, getLanguageListCallExpression } = require("../utils");
const { createCombinedBinaryExpression } = require("./control");


class ListController {
	constructor( vars, contextName, babel ) {
		this.vars = vars;
		this.contextName = contextName;
		this.babel = babel;
		this.initVars = this.initVars.bind( this );
		this.buildDeclaration = this.buildDeclaration.bind( this );
		this.normaliseListVar = this.normaliseListVar.bind( this );
		this.updateIdentifierNames = this.updateIdentifierNames.bind( this );
		this.updateJSXListExpressions = this.updateJSXListExpressions.bind( this );
	}
	initVars( path ) {
		// Add the new list vars to to top of the block statement.
		const { parse, types } = this.babel;
		const self = this;

		this.vars.raw.forEach( ( templateVar, index ) => {
			const [ varName, varConfig ] = templateVar;
			// Alway declare as `let` so we don't need to worry about its usage later.
			const newAssignmentExpression = self.buildDeclaration( self.vars.mapped[ varName ], varConfig );
			if ( newAssignmentExpression ) {
				path.node.body.unshift( newAssignmentExpression );
			}
			// Now keep track of the list vars and aliaes we need to tag (and keep track of their original source var)
			self.vars.toTag[ varName ] = varName;
			if ( varConfig.aliases ) {
				varConfig.aliases.forEach( ( alias ) => {
					self.vars.toTag[ alias ] = varName;
				} );
			}
		} );
	}
	// Build the object for the replacement var in list type vars.
	buildDeclaration( varName, varConfig ) {
		const { parse, types } = this.babel;
		const normalisedConfig = this.normaliseListVar( varConfig );
		const { type, props } = normalisedConfig.child;
		const self = this;
		const newProp = [];
		if ( type === 'object' ) {
			const childProp = {};
			const propsArr = [];
			props.forEach( ( propName ) => {
				const listObject = [
					getLanguageCallExpression( [ 'language', 'open' ], [], this.contextName, types ),
					getLanguageListCallExpression( 'objectProperty', propName, self.contextName, types ),
					getLanguageCallExpression( [ 'language', 'close' ], [], this.contextName, types ),
				]
				propsArr.push( types.objectProperty( types.identifier( propName ), createCombinedBinaryExpression( listObject, '+', types ) ) );
			} );
			newProp.push( childProp );
			const templateObject = types.objectExpression( propsArr )
			const right = types.arrayExpression( [ templateObject ] );
			
			const left = types.identifier( varName );
			return types.variableDeclaration('let', [
				types.variableDeclarator(left, right),
			]);
		} else if ( type === 'primitive' ) {
			// Then we're dealing with a normal array.
			// TODO: maybe "primitive" is not the best name for this type.
			const listPrimitiveString = `let ${ varName } = [ getLanguageString( [ 'language', 'open' ], [], ${ this.contextName } ) + getLanguageList( 'primitive', null, ${ this.contextName } ) + getLanguageString( [ 'language', 'close' ], [], ${ this.contextName } ) ];`;
			return parse( listPrimitiveString );
		}
		return null;
	}	
	normaliseListVar( varConfig ) {
		let normalisedConfig = { 
			type: 'list',
			child: { type: 'primitive' }
		};
		if ( varConfig ) {
			normalisedConfig = varConfig;
			if ( ! varConfig.child ) {
				normalisedConfig.child = { type: 'primitive' }
			}
		}
		
		return normalisedConfig;
	};
	updateIdentifierNames( path ) {
		const { types } = this.babel;
		// We also need to replace any lists / arrays with our own templatevars version.
		if ( this.vars.names.includes( path.node.name ) ) {
			const sourceVarName = path.node.name;
			// Make sure we only replace identifiers that are not props and also that
			// they are not variable declarations.
			const excludeTypes = [ 'ObjectProperty', 'VariableDeclarator', 'ArrayPattern' ];

			if ( path.parentPath.node && ! excludeTypes.includes( path.parentPath.node.type ) ) {
				// We want to only allow one case of a member expression when we find a `const x = y.map(...);`
				if ( types.isMemberExpression( path.parentPath.node ) ) {
					// then we want to make sure its a `.map` otherwise we don't want to support it for now.
					if ( types.isIdentifier( path.parentPath.node.property ) && path.parentPath.node.property.name === 'map' ) {
						// Inject list context to components inside the map
						if ( this.vars.mapped[ path.node.name ] ) {
							path.node.name = this.vars.mapped[ path.node.name ];
							// If we found a map, we want to track which identifier it was assigned to...
							if ( types.isCallExpression( path.parentPath.parentPath.node ) && types.isVariableDeclarator( path.parentPath.parentPath.parentPath.node ) ) {
								// Check if its an identifier and if so, add it to the listVars to tag.
								if ( types.isIdentifier( path.parentPath.parentPath.parentPath.node.id ) ) {
									const identifierName = path.parentPath.parentPath.parentPath.node.id.name;
									this.vars.toTag[ identifierName ] = sourceVarName;
								}
							}
						}
					} else {
						// Support other member expressions.
						path.node.name = this.vars.mapped[ path.node.name ];
					}
				} else {
					path.node.name = this.vars.mapped[ path.node.name ];
				}
			}
		}
	}
	updateJSXListExpressions( expressionSource, path ) {
		const { types } = this.babel;

		const languageOpen = getLanguageCallExpression( [ 'language', 'open' ], [], this.contextName, types );
		const languageClose = getLanguageCallExpression( [ 'language', 'close' ], [], this.contextName, types );

		// Now look for identifers only, so we can look for list vars that need tagging.
		if ( types.isIdentifier( expressionSource ) ) {
			// Then we should be looking at something like: `{ myVar }`
			if ( this.vars.toTag[ expressionSource.name ] ) {
				
				const listOpen = getLanguageListCallExpression( 'open', this.vars.toTag[ expressionSource.name ], this.contextName, types );
				const listClose = getLanguageListCallExpression( 'close', this.vars.toTag[ expressionSource.name ], this.contextName, types );

				path.insertBefore( languageOpen );
				path.insertBefore( listOpen );
				path.insertBefore( languageClose );

				path.insertAfter( languageClose );
				path.insertAfter( listClose );
				path.insertAfter( languageOpen );

			}
		}

		// Also, lets support list vars that have .map() directly in the JSX (ie, they are not re-assigned to variable before being added to the output)
		if ( types.isCallExpression( expressionSource ) && types.isMemberExpression( expressionSource.callee ) ) {
			const memberExpression = expressionSource.callee;
			if ( types.isIdentifier( memberExpression.property ) && memberExpression.property.name === 'map' ) {
				// Add the before / after tags to the list.
				const objectName = memberExpression.object.name;

				if ( this.vars.toTag[ objectName ] ) {
					// Inject list context to components inside the map
					// injectContextToJSXElementComponents( subPath, contextIdentifier.name, types );
				
					const listVarSourceName = this.vars.toTag[ objectName ];
					const listOpen = getLanguageListCallExpression( 'open', listVarSourceName, this.contextName, types );
					const listClose = getLanguageListCallExpression( 'close', listVarSourceName, this.contextName, types );

					path.insertBefore( languageOpen );
					path.insertBefore( listOpen );
					path.insertBefore( languageClose );

					path.insertAfter( languageClose );
					path.insertAfter( listClose );
					path.insertAfter( languageOpen );
				}
			}
		}
	}
};



module.exports = { ListController };
