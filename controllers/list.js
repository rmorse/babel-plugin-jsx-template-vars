const {
	getExpressionPath,
	getLanguageCallExpression,
	getLanguageListCallExpression,
	getMemberExpressionSegments,
} = require( "../utils" );
const { createCombinedBinaryExpression } = require( "./control" );
const diagnostics = require( "../diagnostics" );

const safeListChainMethods = new Set( [
	'filter',
	'slice',
	'sort',
	'toSorted',
	'reverse',
	'toReversed',
] );

class ListController {
	constructor( vars, contextName, babel, config = {} ) {
		this.vars = vars;
		this.contextName = contextName;
		this.babel = babel;
		this.config = config;
		this.rootConfigByName = new Map( ( vars.raw || [] ).map( ( [ name, config ] ) => [ name, config ] ) );
		this.listMetadataByPath = new Map( ( vars.listMetadata || [] ).map( meta => [ meta.path, meta ] ) );
		this.listMetadataBySourceKey = new Map( ( vars.listMetadata || [] ).map( meta => [ meta.sourceKey, meta ] ) );
		this.scalarMetadataByPath = new Map( ( vars.scalarMetadata || [] ).map( meta => [ meta.path, meta ] ) );
		this.pathAliasesByBinding = new WeakMap();
		this.renderedListAliasesByBinding = new WeakMap();
		this.unsupportedRenderedAliasesByBinding = new WeakMap();

		this.initVars = this.initVars.bind( this );
		this.buildDeclaration = this.buildDeclaration.bind( this );
		this.updateIdentifierNames = this.updateIdentifierNames.bind( this );
		this.updateJSXListExpressions = this.updateJSXListExpressions.bind( this );
		this.trackVariableAliases = this.trackVariableAliases.bind( this );
		this.trackAssignmentAliases = this.trackAssignmentAliases.bind( this );
		this.trackMapAliases = this.trackMapAliases.bind( this );
		this.getContainingListContextOffset = this.getContainingListContextOffset.bind( this );
		this.resolveTemplateArg = this.resolveTemplateArg.bind( this );
		this.resolveRenderedListMeta = this.resolveRenderedListMeta.bind( this );
		this.registerExternalPathAliases = this.registerExternalPathAliases.bind( this );
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

	trackVariableAliases( path ) {
		const { types } = this.babel;
		const { id, init } = path.node;

		if ( ! init ) {
			return;
		}

		if ( types.isIdentifier( id ) ) {
			const renderedUsage = this.resolveRenderedListUsage( init, path );
			if ( renderedUsage && renderedUsage.kind !== 'source' ) {
				if ( renderedUsage.kind === 'unsupported' ) {
					this.registerUnsupportedRenderedAlias( id.name, renderedUsage.message, path );
					return;
				}
				this.registerRenderedListAlias( id.name, renderedUsage.metadata, path );
				return;
			}

			const sourceSegments = this.resolveExpressionSegments( init, path );
			if ( sourceSegments ) {
				this.registerPathAlias( id.name, sourceSegments, path );
			}
			return;
		}

		if ( types.isObjectPattern( id ) ) {
			const sourceSegments = this.resolveExpressionSegments( init, path );
			if ( sourceSegments ) {
				this.registerPatternAliases( id, sourceSegments, path );
			}
		}
	}

	trackAssignmentAliases( path ) {
		const { types } = this.babel;
		const { left, right } = path.node;

		if ( ! types.isIdentifier( left ) ) {
			return;
		}

		const renderedUsage = this.resolveRenderedListUsage( right, path );
		if ( renderedUsage && renderedUsage.kind !== 'source' ) {
			if ( renderedUsage.kind === 'unsupported' ) {
				this.registerUnsupportedRenderedAlias( left.name, renderedUsage.message, path );
				return;
			}
			this.registerRenderedListAlias( left.name, renderedUsage.metadata, path );
			return;
		}

		const sourceSegments = this.resolveExpressionSegments( right, path );
		if ( sourceSegments ) {
			this.registerPathAlias( left.name, sourceSegments, path );
		}
	}

	registerRenderedListAlias( localName, metadata, path ) {
		this.vars.toTag[ localName ] = metadata;
		const binding = path.scope.getBinding( localName );
		if ( binding ) {
			this.renderedListAliasesByBinding.set( binding.identifier, metadata );
		}
	}

	registerUnsupportedRenderedAlias( localName, message, path ) {
		const binding = path.scope.getBinding( localName );
		if ( binding ) {
			this.unsupportedRenderedAliasesByBinding.set( binding.identifier, message );
		}
	}

	registerPathAlias( localName, segments, path ) {
		const binding = path.scope.getBinding( localName );
		if ( ! binding ) {
			return;
		}

		this.pathAliasesByBinding.set( binding.identifier, {
			segments: this.normalizeCanonicalSegments( segments ),
			declarationSegments: this.normalizeCanonicalSegments( segments ),
		} );
	}

	registerExternalPathAliases( aliases = [] ) {
		aliases.forEach( ( alias ) => {
			if ( ! alias.bindingIdentifier || ! Array.isArray( alias.segments ) ) {
				return;
			}

			this.pathAliasesByBinding.set( alias.bindingIdentifier, {
				segments: this.normalizeCanonicalSegments( alias.segments ),
				declarationSegments: this.normalizeCanonicalSegments( alias.declarationSegments || alias.segments ),
			} );
		} );
	}

	registerPatternAliases( pattern, baseSegments, path ) {
		( pattern.properties || [] ).forEach( ( property ) => {
			if ( property.type === 'RestElement' ) {
				return;
			}

			const propertyName = this.getPatternPropertyName( property );
			if ( ! propertyName ) {
				return;
			}

			const propertySegments = [ ...baseSegments, propertyName ];
			const value = property.value;
			if ( this.babel.types.isIdentifier( value ) ) {
				this.registerPathAlias( value.name, propertySegments, path );
				return;
			}

			if ( this.babel.types.isObjectPattern( value ) ) {
				this.registerPatternAliases( value, propertySegments, path );
			}
		} );
	}

	getPatternPropertyName( property ) {
		if ( this.babel.types.isIdentifier( property.key ) ) {
			return property.key.name;
		}
		if ( this.babel.types.isStringLiteral( property.key ) ) {
			return property.key.value;
		}
		return null;
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
		if ( this.vars.mapInv?.[ sourceVarName ] ) {
			return;
		}

		const aliasListMetadata = this.resolveListMetaFromExpression( path.node, path );
		const replacementExpression = aliasListMetadata
			? this.createReplacementExpressionForListMetadata( aliasListMetadata )
			: null;

		if ( ! this.vars.names.includes( sourceVarName ) && ! replacementExpression ) {
			return;
		}

		if ( ! this.shouldReplaceIdentifier( path, aliasListMetadata ) ) {
			return;
		}

		if ( replacementExpression ) {
			path.replaceWith( replacementExpression );
			return;
		}

		path.node.name = this.vars.mapped[ sourceVarName ];
	}

	shouldReplaceIdentifier( path, aliasListMetadata = null ) {
		const { types } = this.babel;
		const parentNode = path.parentPath?.node;
		const rootConfig = this.rootConfigByName.get( path.node.name ) || aliasListMetadata;

		if ( ! rootConfig || ! parentNode ) {
			return false;
		}

		if ( [ 'ObjectProperty', 'VariableDeclarator', 'ArrayPattern', 'ObjectPattern', 'AssignmentPattern' ].includes( parentNode.type ) ) {
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

		if ( types.isIdentifier( parentNode.property ) && ( parentNode.property.name === 'map' || safeListChainMethods.has( parentNode.property.name ) ) ) {
			return true;
		}

		return false;
	}

	createReplacementExpressionForListMetadata( metadata ) {
		const { types } = this.babel;
		const sourceSegments = metadata.sourceSegments || [];
		const rootName = sourceSegments[ 0 ];
		const mappedRoot = this.vars.mapped?.[ rootName ];

		if ( ! mappedRoot ) {
			return null;
		}

		return sourceSegments.slice( 1 ).reduce( ( expression, segment ) => (
			types.memberExpression( expression, types.identifier( segment.replace( /\[\]$/, '' ) ) )
		), types.identifier( mappedRoot ) );
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

		this.registerMapCallbackAliases( path, metadata );

		const variableDeclarator = path.parentPath;
		if ( variableDeclarator && types.isVariableDeclarator( variableDeclarator.node ) && types.isIdentifier( variableDeclarator.node.id ) ) {
			this.registerRenderedListAlias( variableDeclarator.node.id.name, metadata, variableDeclarator );
		}
	}

	registerMapCallbackAliases( path, metadata ) {
		const callback = path.node.arguments[ 0 ];
		const firstParam = callback?.params?.[ 0 ];
		if ( ! firstParam ) {
			return;
		}

		const firstParamPath = path.get( 'arguments.0.params.0' );
		const itemSegments = this.splitCanonicalPath( metadata.path );
		if ( this.babel.types.isIdentifier( firstParam ) ) {
			this.registerPathAlias( firstParam.name, itemSegments, firstParamPath );
			return;
		}

		if ( this.babel.types.isObjectPattern( firstParam ) ) {
			this.registerPatternAliases( firstParam, itemSegments, firstParamPath );
		}
	}

	updateJSXListExpressions( expressionSource, path ) {
		const { types } = this.babel;

		if ( ! types.isJSXFragment( path.parentPath.node ) && ! types.isJSXElement( path.parentPath.node ) ) {
			return;
		}

		const usage = this.resolveRenderedListUsage( expressionSource, path );
		if ( ! usage ) {
			return;
		}

		if ( usage.kind === 'unsupported' ) {
			this.reportUnsupportedRenderedUsage( usage.message, path );
			return;
		}

		this.assertRenderableListUsage( usage, path );

		const partsBefore = this.createListWrapperParts( usage.metadata, 'open' );
		const partsAfter = this.createListWrapperParts( usage.metadata, 'close' );

		partsBefore.forEach( part => path.insertBefore( part ) );
		partsAfter.reverse().forEach( part => path.insertAfter( part ) );
	}

	resolveRenderedListMeta( expressionSource, path ) {
		const usage = this.resolveRenderedListUsage( expressionSource, path );
		return usage ? usage.metadata : null;
	}

	resolveRenderedListUsage( expressionSource, path ) {
		const { types } = this.babel;

		if ( types.isIdentifier( expressionSource ) ) {
			const binding = path.scope.getBinding( expressionSource.name );
			if ( binding && this.unsupportedRenderedAliasesByBinding.has( binding.identifier ) ) {
				return {
					kind: 'unsupported',
					message: this.unsupportedRenderedAliasesByBinding.get( binding.identifier ),
				};
			}
			if ( binding && this.renderedListAliasesByBinding.has( binding.identifier ) ) {
				return {
					kind: 'renderedAlias',
					metadata: this.renderedListAliasesByBinding.get( binding.identifier ),
				};
			}

			if ( this.vars.toTag[ expressionSource.name ] ) {
				return {
					kind: this.vars.names.includes( expressionSource.name ) ? 'source' : 'renderedAlias',
					metadata: this.vars.toTag[ expressionSource.name ],
				};
			}

			const sourceMetadata = this.resolveListMetaFromExpression( expressionSource, path );
			return sourceMetadata ? {
				kind: 'source',
				metadata: sourceMetadata,
			} : null;
		}

		if (
			types.isCallExpression( expressionSource ) &&
			types.isMemberExpression( expressionSource.callee ) &&
			types.isIdentifier( expressionSource.callee.property ) &&
			expressionSource.callee.property.name === 'map'
		) {
			const metadata = this.resolveListMetaFromExpression( expressionSource.callee.object, path );
			return metadata ? {
				kind: 'mapCall',
				metadata,
			} : null;
		}

		if ( types.isCallExpression( expressionSource ) ) {
			const listArguments = this.resolveListArgumentMetas( expressionSource, path );
			if ( listArguments.length > 1 ) {
				return {
					kind: 'unsupported',
					message: this.createMultiRootHelperMessage( listArguments ),
				};
			}
			const metadata = listArguments[ 0 ] || null;
			return metadata ? {
				kind: 'helperCall',
				metadata,
			} : null;
		}

		return null;
	}

	assertRenderableListUsage( usage, path ) {
		if ( usage.kind !== 'source' ) {
			return;
		}

		if ( this.getListItemKind( usage.metadata ) === 'primitive' ) {
			return;
		}

		diagnostics.error(
			path,
			`Cannot render object list "${ usage.metadata.sourceKey }" directly. Use .map(), a rendered .map() alias, or a helper call that renders the list items.`
		);
	}

	reportUnsupportedRenderedUsage( message, path ) {
		diagnostics.unsupported( path, message, this.config );
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

		const segmentCandidates = this.resolvePathSegmentCandidates( arg.segments || [ arg.value ], path );
		for ( const segments of segmentCandidates ) {
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
		}

		return arg;
	}

	resolveScalarMetaFromSegments( segments, path ) {
		const directPath = this.normalizeCanonicalSegments( segments ).join( '.' );
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
		if ( this.isSafeListChainCall( expression ) ) {
			return this.resolveListMetaFromExpression( expression.callee.object, path );
		}

		const segments = this.resolveExpressionSegments( expression, path );
		if ( ! segments ) {
			return null;
		}

		return this.resolveListMetaFromSegments( segments, path );
	}

	resolveListMetaFromSegments( segments, path ) {
		const sourceKey = this.normalizeCanonicalSegments( segments ).join( '.' );
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

	resolveSingleListArgumentMeta( expression, path ) {
		const metas = this.resolveListArgumentMetas( expression, path );

		if ( metas.length !== 1 ) {
			return null;
		}

		return metas[ 0 ];
	}

	resolveListArgumentMetas( expression, path ) {
		const metas = [];
		const seen = new Set();

		expression.arguments.forEach( ( argument ) => {
			const meta = this.resolveListMetaFromExpression( argument, path );
			if ( meta && ! seen.has( meta.path ) ) {
				seen.add( meta.path );
				metas.push( meta );
			}
		} );

		return metas;
	}

	createMultiRootHelperMessage( metas ) {
		const names = metas.map( meta => `"${ meta.sourceKey }"` ).join( ', ' );
		return `Cannot infer list template wrapping for a helper call that uses multiple declared list roots: ${ names }. Render each list separately or expose a single combined list shape.`;
	}

	resolveExpressionSegments( expression, path ) {
		const { types } = this.babel;

		if ( types.isIdentifier( expression ) ) {
			return this.resolveIdentifierSegments( expression.name, path );
		}

		if ( this.isStaticMemberExpression( expression ) ) {
			const objectSegments = this.resolveExpressionSegments( expression.object, path );
			if ( ! objectSegments || ! types.isIdentifier( expression.property ) ) {
				return null;
			}

			return [ ...objectSegments, expression.property.name ];
		}

		if ( this.isSafeListChainCall( expression ) ) {
			return this.resolveExpressionSegments( expression.callee.object, path );
		}

		return null;
	}

	resolvePathSegments( segments, path ) {
		return this.resolvePathSegmentCandidates( segments, path )[ 0 ];
	}

	resolvePathSegmentCandidates( segments, path ) {
		if ( ! segments || segments.length === 0 ) {
			return [ segments ];
		}

		const tail = segments.slice( 1 );
		const candidates = this.resolveIdentifierSegmentCandidates( segments[ 0 ], path )
			.map( rootSegments => [ ...rootSegments, ...tail ] );
		return dedupeSegmentCandidates( candidates );
	}

	resolveIdentifierSegments( name, path ) {
		return this.resolveIdentifierSegmentCandidates( name, path )[ 0 ];
	}

	resolveIdentifierSegmentCandidates( name, path ) {
		const binding = path?.scope?.getBinding( name );
		if ( binding && this.pathAliasesByBinding.has( binding.identifier ) ) {
			const alias = this.pathAliasesByBinding.get( binding.identifier );
			return dedupeSegmentCandidates( [
				alias.declarationSegments || alias.segments,
				alias.segments,
			] );
		}

		return [ [ this.normalizeRootSegment( name ) ] ];
	}

	isStaticMemberExpression( expression ) {
		const { types } = this.babel;
		return (
			types.isMemberExpression( expression ) ||
			( typeof types.isOptionalMemberExpression === 'function' && types.isOptionalMemberExpression( expression ) ) ||
			expression?.type === 'OptionalMemberExpression'
		) && ! expression.computed;
	}

	isSafeListChainCall( expression ) {
		const { types } = this.babel;
		return (
			types.isCallExpression( expression ) &&
			this.isStaticMemberExpression( expression.callee ) &&
			types.isIdentifier( expression.callee.property ) &&
			safeListChainMethods.has( expression.callee.property.name )
		);
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

	getListItemKind( metadata ) {
		let listNode = null;
		for ( const rootConfig of this.rootConfigByName.values() ) {
			listNode = this.findListNodeInConfig( rootConfig, metadata.path );
			if ( listNode ) {
				break;
			}
		}
		return listNode?.item?.kind || 'primitive';
	}

	findListNodeInConfig( node, path ) {
		if ( ! node ) {
			return null;
		}

		if ( node.kind === 'list' && node.path === path ) {
			return node;
		}

		if ( node.kind === 'list' ) {
			return this.findListNodeInConfig( node.item, path );
		}

		if ( node.kind === 'object' ) {
			for ( const property of node.properties || [] ) {
				const found = this.findListNodeInConfig( property, path );
				if ( found ) {
					return found;
				}
			}
		}

		return null;
	}

	normalizeRootSegment( segment ) {
		return this.vars.mapInv?.[ segment ] || segment;
	}

	normalizeCanonicalSegments( segments ) {
		return segments.flatMap( segment => this.splitCanonicalPath( this.normalizeRootSegment( segment ) ) );
	}

	splitCanonicalPath( path ) {
		return String( path ).split( '.' ).filter( Boolean );
	}
};

function dedupeSegmentCandidates( candidates ) {
	const seen = new Set();
	const result = [];
	candidates.forEach( ( candidate ) => {
		if ( ! Array.isArray( candidate ) ) {
			return;
		}
		const key = candidate.join( '.' );
		if ( seen.has( key ) ) {
			return;
		}
		seen.add( key );
		result.push( candidate );
	} );
	return result;
}

module.exports = { ListController };
