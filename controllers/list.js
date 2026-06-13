const {
	getExpressionPath,
	getLanguageCallExpression,
	getLanguageListCallExpression,
	getMemberExpressionSegments,
} = require( "../utils" );
const { createCombinedBinaryExpression } = require( "./control" );

class ListController {
	constructor( vars, contextName, babel ) {
		this.vars = vars;
		this.contextName = contextName;
		this.babel = babel;
		this.rootConfigByName = new Map( ( vars.raw || [] ).map( ( [ name, config ] ) => [ name, config ] ) );
		this.listMetadataByPath = new Map( ( vars.listMetadata || [] ).map( meta => [ meta.path, meta ] ) );
		this.listMetadataBySourceKey = new Map( ( vars.listMetadata || [] ).map( meta => [ meta.sourceKey, meta ] ) );
		this.scalarMetadataByPath = new Map( ( vars.scalarMetadata || [] ).map( meta => [ meta.path, meta ] ) );

		this.initVars = this.initVars.bind( this );
		this.buildDeclaration = this.buildDeclaration.bind( this );
		this.updateIdentifierNames = this.updateIdentifierNames.bind( this );
		this.updateJSXListExpressions = this.updateJSXListExpressions.bind( this );
		this.trackMapAliases = this.trackMapAliases.bind( this );
		this.getContainingListContextOffset = this.getContainingListContextOffset.bind( this );
		this.resolveTemplateArg = this.resolveTemplateArg.bind( this );
		this.resolveRenderedListMeta = this.resolveRenderedListMeta.bind( this );
	}

	initVars( path ) {
		this.vars.raw.forEach( ( templateVar ) => {
			const [ varName, varConfig ] = templateVar;
			const newAssignmentExpression = this.buildDeclaration( this.vars.mapped[ varName ], varConfig );
			if ( newAssignmentExpression ) {
				path.node.body.unshift( newAssignmentExpression );
			}

			this.registerConfigTagAliases( varName, varConfig );
		} );
	}

	registerConfigTagAliases( varName, varConfig ) {
		if ( ! varConfig ) {
			return;
		}

		if ( varConfig.kind === 'list' ) {
			const metadata = this.getListMetadata( varConfig );
			this.vars.toTag[ varName ] = metadata;
			( varConfig.tagAliases || [] ).forEach( ( alias ) => {
				this.vars.toTag[ alias ] = metadata;
			} );
			return;
		}

		( varConfig.properties || [] ).forEach( ( property ) => {
			if ( property.kind === 'list' ) {
				const metadata = this.getListMetadata( property );
				( property.tagAliases || [] ).forEach( ( alias ) => {
					this.vars.toTag[ alias ] = metadata;
				} );
			}
			this.registerConfigTagAliases( property.name, property );
		} );
	}

	buildDeclaration( varName, varConfig ) {
		const { types } = this.babel;
		const right = this.buildValueForNode( varConfig );

		if ( ! right ) {
			return null;
		}

		return types.variableDeclaration( 'let', [
			types.variableDeclarator( types.identifier( varName ), right ),
		] );
	}

	buildValueForNode( node ) {
		const { types } = this.babel;

		if ( ! node ) {
			return null;
		}

		if ( node.kind === 'list' ) {
			return types.arrayExpression( [ this.buildListItem( node ) ] );
		}

		if ( node.kind === 'object' ) {
			return types.objectExpression(
				( node.properties || [] ).map( property => (
					types.objectProperty( types.identifier( property.name ), this.buildValueForNode( property ) )
				) )
			);
		}

		if ( node.kind === 'scalar' ) {
			return this.buildScalarExpression( node );
		}

		if ( node.kind === 'primitive' ) {
			return this.buildPrimitiveExpression( node );
		}

		return null;
	}

	buildListItem( listNode ) {
		const item = listNode.item || { kind: 'primitive' };
		if ( item.kind === 'primitive' ) {
			return this.buildPrimitiveExpression( {
				...item,
				parentContextDepth: listNode.parentContextDepth,
			} );
		}

		return this.buildValueForNode( item );
	}

	buildScalarExpression( node ) {
		const { types } = this.babel;
		const contextDepth = node.contextDepth || 0;
		const arg = {
			type: Array.isArray( node.segments ) && node.segments.length > 1 ? 'path' : 'identifier',
			value: ( node.segments || [ node.name ] ).join( '.' ),
			segments: node.segments || [ node.name ],
		};

		const templateExpression = contextDepth > 0
			? getLanguageListCallExpression( 'objectProperty', arg, this.createContextExpression( contextDepth - 1 ), types )
			: types.callExpression(
				types.identifier( 'getLanguageReplace' ),
				[
					types.stringLiteral( 'format' ),
					this.createArgObjectExpression( arg ),
					this.createContextExpression( 0 ),
				]
			);

		return this.wrapLanguageExpression( templateExpression, Math.max( contextDepth - 1, 0 ) );
	}

	buildPrimitiveExpression( node ) {
		const { types } = this.babel;
		const contextDepth = node.parentContextDepth || 0;
		const templateExpression = getLanguageListCallExpression( 'primitive', null, this.createContextExpression( contextDepth ), types );
		return this.wrapLanguageExpression( templateExpression, contextDepth );
	}

	createArgObjectExpression( arg ) {
		const { types } = this.babel;
		const props = [
			types.objectProperty( types.identifier( 'type' ), types.stringLiteral( arg.type ) ),
			types.objectProperty( types.identifier( 'value' ), types.stringLiteral( arg.value ) ),
		];

		if ( Array.isArray( arg.segments ) ) {
			props.push(
				types.objectProperty(
					types.identifier( 'segments' ),
					types.arrayExpression( arg.segments.map( segment => types.stringLiteral( segment ) ) )
				)
			);
		}

		return types.objectExpression( props );
	}

	createContextExpression( offset = 0 ) {
		const { types } = this.babel;
		const baseContext = types.identifier( this.contextName );

		if ( offset <= 0 ) {
			return baseContext;
		}

		return types.binaryExpression( '+', baseContext, types.numericLiteral( offset ) );
	}

	wrapLanguageExpression( templateExpression, contextDepth ) {
		const { types } = this.babel;
		return createCombinedBinaryExpression( [
			getLanguageCallExpression( [ 'language', 'open' ], [], this.createContextExpression( contextDepth ), types ),
			templateExpression,
			getLanguageCallExpression( [ 'language', 'close' ], [], this.createContextExpression( contextDepth ), types ),
		], '+', types );
	}

	updateIdentifierNames( path ) {
		const { types } = this.babel;
		const sourceVarName = path.node.name;

		if ( ! this.vars.names.includes( sourceVarName ) ) {
			return;
		}

		if ( ! this.shouldReplaceIdentifier( path ) ) {
			return;
		}

		path.node.name = this.vars.mapped[ sourceVarName ];
	}

	shouldReplaceIdentifier( path ) {
		const { types } = this.babel;
		const parentNode = path.parentPath?.node;
		const rootConfig = this.rootConfigByName.get( path.node.name );

		if ( ! rootConfig || ! parentNode ) {
			return false;
		}

		if ( [ 'ObjectProperty', 'VariableDeclarator', 'ArrayPattern', 'ObjectPattern' ].includes( parentNode.type ) ) {
			return false;
		}

		if ( types.isMemberExpression( parentNode ) && parentNode.property === path.node && ! parentNode.computed ) {
			return false;
		}

		if ( rootConfig.kind === 'object' ) {
			return this.shouldReplaceRootObjectIdentifier( path );
		}

		if ( ! types.isMemberExpression( parentNode ) ) {
			return true;
		}

		if ( types.isIdentifier( parentNode.property ) && parentNode.property.name === 'map' ) {
			return true;
		}

		return false;
	}

	shouldReplaceRootObjectIdentifier( path ) {
		const { types } = this.babel;
		const memberPath = this.getContainingMemberPath( path );

		if ( ! memberPath ) {
			return false;
		}

		const pathName = getExpressionPath( memberPath.node, types );
		if ( pathName && this.scalarMetadataByPath.has( pathName ) ) {
			return true;
		}

		if ( this.isMapCalleePath( memberPath ) ) {
			return Boolean( this.resolveListMetaFromExpression( memberPath.node.object, memberPath ) );
		}

		return false;
	}

	getContainingMemberPath( path ) {
		let currentPath = path;

		while (
			currentPath.parentPath &&
			this.babel.types.isMemberExpression( currentPath.parentPath.node ) &&
			currentPath.parentPath.node.object === currentPath.node
		) {
			currentPath = currentPath.parentPath;
		}

		return currentPath === path ? null : currentPath;
	}

	isMapCalleePath( path ) {
		const { types } = this.babel;
		return (
			types.isMemberExpression( path.node ) &&
			types.isIdentifier( path.node.property ) &&
			path.node.property.name === 'map' &&
			types.isCallExpression( path.parentPath?.node ) &&
			path.parentPath.node.callee === path.node
		);
	}

	trackMapAliases( path ) {
		const { types } = this.babel;
		const { node } = path;

		if ( ! types.isMemberExpression( node.callee ) ) {
			return;
		}

		if ( ! types.isIdentifier( node.callee.property ) || node.callee.property.name !== 'map' ) {
			return;
		}

		const metadata = this.resolveListMetaFromExpression( node.callee.object, path );
		if ( ! metadata ) {
			return;
		}

		const variableDeclarator = path.parentPath;
		if ( variableDeclarator && types.isVariableDeclarator( variableDeclarator.node ) && types.isIdentifier( variableDeclarator.node.id ) ) {
			this.vars.toTag[ variableDeclarator.node.id.name ] = metadata;
		}
	}

	updateJSXListExpressions( expressionSource, path ) {
		const { types } = this.babel;

		if ( ! types.isJSXFragment( path.parentPath.node ) && ! types.isJSXElement( path.parentPath.node ) ) {
			return;
		}

		const metadata = this.resolveRenderedListMeta( expressionSource, path );
		if ( ! metadata ) {
			return;
		}

		const partsBefore = this.createListWrapperParts( metadata, 'open' );
		const partsAfter = this.createListWrapperParts( metadata, 'close' );

		partsBefore.forEach( part => path.insertBefore( part ) );
		partsAfter.reverse().forEach( part => path.insertAfter( part ) );
	}

	resolveRenderedListMeta( expressionSource, path ) {
		const { types } = this.babel;

		if ( types.isIdentifier( expressionSource ) && this.vars.toTag[ expressionSource.name ] ) {
			return this.vars.toTag[ expressionSource.name ];
		}

		if (
			types.isCallExpression( expressionSource ) &&
			types.isMemberExpression( expressionSource.callee ) &&
			types.isIdentifier( expressionSource.callee.property ) &&
			expressionSource.callee.property.name === 'map'
		) {
			return this.resolveListMetaFromExpression( expressionSource.callee.object, path );
		}

		return null;
	}

	createListWrapperParts( metadata, action ) {
		const { types } = this.babel;
		const languageOpen = getLanguageCallExpression( [ 'language', 'open' ], [], this.createContextExpression( metadata.parentContextDepth ), types );
		const listExpression = this.createListBoundaryExpression( metadata, action );
		const languageClose = getLanguageCallExpression( [ 'language', 'close' ], [], this.createContextExpression( metadata.parentContextDepth ), types );

		return [ languageOpen, listExpression, languageClose ];
	}

	createListBoundaryExpression( metadata, action ) {
		const { types } = this.babel;
		return getLanguageListCallExpression(
			action,
			this.createListArg( metadata ),
			this.createContextExpression( metadata.parentContextDepth ),
			types
		);
	}

	createListArg( metadata ) {
		return {
			type: metadata.sourceSegments && metadata.sourceSegments.length > 1 ? 'path' : 'identifier',
			value: metadata.sourceSegments.join( '.' ),
			segments: metadata.sourceSegments,
		};
	}

	resolveTemplateArg( arg, path ) {
		if ( arg.type !== 'identifier' && arg.type !== 'path' ) {
			return arg;
		}

		const segments = arg.segments || [ arg.value ];
		const scalarMetadata = this.resolveScalarMetaFromSegments( segments, path );
		if ( scalarMetadata ) {
			return {
				type: scalarMetadata.segments.length > 1 ? 'path' : 'identifier',
				value: scalarMetadata.segments.join( '.' ),
				segments: scalarMetadata.segments,
				contextOffset: scalarMetadata.contextDepth,
				matchedTemplatePath: scalarMetadata.path,
			};
		}

		const listMetadata = this.resolveListMetaFromSegments( segments, path );
		if ( listMetadata ) {
			return {
				type: listMetadata.sourceSegments.length > 1 ? 'path' : 'identifier',
				value: listMetadata.sourceSegments.join( '.' ),
				segments: listMetadata.sourceSegments,
				contextOffset: listMetadata.parentContextDepth,
				matchedTemplatePath: listMetadata.path,
			};
		}

		return arg;
	}

	resolveScalarMetaFromSegments( segments, path ) {
		const directPath = [ this.normalizeRootSegment( segments[ 0 ] ), ...segments.slice( 1 ) ].join( '.' );
		if ( this.scalarMetadataByPath.has( directPath ) ) {
			return this.scalarMetadataByPath.get( directPath );
		}

		const callbackContext = this.findCallbackListContext( path, segments[ 0 ] );
		if ( ! callbackContext || segments.length === 1 ) {
			return null;
		}

		const parentMetadata = this.resolveListMetaFromExpression( callbackContext.listExpression, callbackContext.callPath );
		if ( ! parentMetadata ) {
			return null;
		}

		const nestedPath = `${ parentMetadata.path }.${ segments.slice( 1 ).join( '.' ) }`;
		return this.scalarMetadataByPath.get( nestedPath ) || null;
	}

	resolveListMetaFromExpression( expression, path ) {
		const segments = getMemberExpressionSegments( expression, this.babel.types );
		if ( ! segments ) {
			return null;
		}

		return this.resolveListMetaFromSegments( segments, path );
	}

	resolveListMetaFromSegments( segments, path ) {
		const sourceKey = [ this.normalizeRootSegment( segments[ 0 ] ), ...segments.slice( 1 ) ].join( '.' );
		if ( this.listMetadataBySourceKey.has( sourceKey ) ) {
			return this.listMetadataBySourceKey.get( sourceKey );
		}

		const callbackContext = this.findCallbackListContext( path, segments[ 0 ] );
		if ( ! callbackContext || segments.length === 1 ) {
			return null;
		}

		const parentMetadata = this.resolveListMetaFromExpression( callbackContext.listExpression, callbackContext.callPath );
		if ( ! parentMetadata ) {
			return null;
		}

		const nestedSourceKey = `${ parentMetadata.path }.${ segments.slice( 1 ).join( '.' ) }`;
		return this.listMetadataBySourceKey.get( nestedSourceKey ) || null;
	}

	findCallbackListContext( path, paramName ) {
		let currentPath = path;
		const { types } = this.babel;

		while ( currentPath ) {
			if (
				types.isCallExpression( currentPath.node ) &&
				types.isMemberExpression( currentPath.node.callee ) &&
				types.isIdentifier( currentPath.node.callee.property ) &&
				currentPath.node.callee.property.name === 'map'
			) {
				const callback = currentPath.node.arguments[ 0 ];
				const firstParam = callback?.params?.[ 0 ];
				if ( types.isIdentifier( firstParam ) && firstParam.name === paramName ) {
					return {
						callPath: currentPath,
						listExpression: currentPath.node.callee.object,
					};
				}
			}
			currentPath = currentPath.parentPath;
		}

		return null;
	}

	getContainingListContextOffset( path ) {
		let currentPath = path;
		let offset = 0;
		const { types } = this.babel;

		while ( currentPath ) {
			if (
				types.isCallExpression( currentPath.node ) &&
				types.isMemberExpression( currentPath.node.callee ) &&
				types.isIdentifier( currentPath.node.callee.property ) &&
				currentPath.node.callee.property.name === 'map'
			) {
				const metadata = this.resolveListMetaFromExpression( currentPath.node.callee.object, currentPath );
				if ( metadata ) {
					offset = Math.max( offset, metadata.itemContextDepth );
				}
			}
			currentPath = currentPath.parentPath;
		}

		return offset;
	}

	getListMetadata( node ) {
		return this.listMetadataByPath.get( node.path ) || node;
	}

	normalizeRootSegment( segment ) {
		return this.vars.mapInv?.[ segment ] || segment;
	}
};

module.exports = { ListController };
