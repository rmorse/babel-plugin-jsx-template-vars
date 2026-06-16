const diagnostics = require( './diagnostics' );
const {
	getExpressionArgs,
} = require( './utils' );

const identifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function parseTemplateVarPath( value, errorPath ) {
	if ( typeof value !== 'string' ) {
		diagnostics.error( errorPath, `templateVars declarations must use string paths. Received ${ typeof value }.` );
	}

	if ( value.length === 0 || value.trim() !== value ) {
		diagnostics.error( errorPath, `Invalid template var path "${ value }". Paths cannot be empty or contain surrounding whitespace.` );
	}

	const parts = value.split( '.' ).map( ( rawSegment ) => {
		if ( rawSegment.length === 0 ) {
			diagnostics.error( errorPath, `Invalid template var path "${ value }". Path segments cannot be empty.` );
		}

		const isList = rawSegment.endsWith( '[]' );
		const name = isList ? rawSegment.slice( 0, -2 ) : rawSegment;

		if ( name.includes( '[' ) || name.includes( ']' ) ) {
			diagnostics.error( errorPath, `Invalid template var path "${ value }". List markers must use the "items[]" suffix form.` );
		}

		if ( ! identifierPattern.test( name ) ) {
			diagnostics.error( errorPath, `Invalid template var path "${ value }". "${ name }" is not a supported identifier segment.` );
		}

		return {
			name,
			isList,
		};
	} );

	const segments = parts.map( part => part.name );
	const listParts = parts.filter( part => part.isList );

	return {
		value,
		parts,
		segments,
		rootName: segments[ 0 ],
		isList: parts[ 0 ].isList,
		hasList: listParts.length > 0,
		listDepth: listParts.length,
		childSegments: parts[ 0 ].isList ? segments.slice( 1 ) : [],
	};
}

function createTemplateVarsRegistry( templatePropsValue, componentPath, babel, errorPath, options = {} ) {
	const declarations = templatePropsValue.map( ( prop ) => {
		if ( typeof prop !== 'string' ) {
			diagnostics.error( errorPath, 'templateVars only supports flat string paths. Legacy array/object configuration is not supported.' );
		}
		return parseTemplateVarPath( prop, errorPath );
	} );

	const rootsWithLists = new Set(
		declarations
			.filter( declaration => declaration.hasList )
			.map( declaration => declaration.rootName )
	);

	const registry = {
		paths: new Map(),
		rootShapes: new Map(),
		listsByPath: new Map(),
		listsBySourceKey: new Map(),
		scalarsByPath: new Map(),
	};

	declarations.forEach( ( declaration ) => {
		if ( rootsWithLists.has( declaration.rootName ) ) {
			addShapeDeclaration( registry, declaration, errorPath );
			return;
		}

		addScalarPath( registry, declaration.segments );
	} );

	inferUsageRoles( registry, componentPath, babel, options );

	return deriveControllerInputs( registry );
}

function addScalarPath( registry, segments ) {
	const pathName = segments.join( '.' );
	if ( ! registry.paths.has( pathName ) ) {
		registry.paths.set( pathName, {
			path: pathName,
			segments,
			roles: new Set( [ 'replace' ] ),
		} );
	}
	if ( ! registry.scalarsByPath.has( pathName ) ) {
		registry.scalarsByPath.set( pathName, {
			path: pathName,
			segments,
			contextDepth: 0,
		} );
	}
}

function addShapeDeclaration( registry, declaration, errorPath ) {
	if ( declaration.parts.length === 1 && ! declaration.parts[ 0 ].isList ) {
		diagnostics.error( errorPath, `Invalid template var path "${ declaration.value }". A root object with nested list declarations must declare concrete child paths.` );
	}

	const rootPart = declaration.parts[ 0 ];
	const root = getRootShape( registry, rootPart.name, rootPart.isList ? 'list' : 'object', errorPath );

	let current = root;
	let listDepth = 0;
	let fullParts = [];
	let relativeSegments = [];

	declaration.parts.forEach( ( part, index ) => {
		const isRoot = index === 0;
		const isLast = index === declaration.parts.length - 1;
		fullParts.push( part );

		if ( isRoot ) {
			if ( part.isList ) {
				const listNode = current;
				listNode.parentContextDepth = 0;
				listNode.itemContextDepth = 1;
				listNode.sourceSegments = [ part.name ];
				listNode.path = getCanonicalPath( fullParts );
				listNode.sourceKey = getListSourceKey( fullParts );
				registerListNode( registry, listNode );
				listDepth = 1;
				current = ensureListItem( listNode, ! isLast );
				relativeSegments = [];
			} else {
				relativeSegments = [ part.name ];
			}
			return;
		}

		if ( part.isList ) {
			const listNode = ensureChildNode( current, part.name, 'list', errorPath );
			listNode.parentContextDepth = listDepth;
			listNode.itemContextDepth = listDepth + 1;
			listNode.sourceSegments = listDepth === 0
				? [ ...relativeSegments, part.name ]
				: [ ...relativeSegments, part.name ];
			listNode.path = getCanonicalPath( fullParts );
			listNode.sourceKey = getListSourceKey( fullParts );
			registerListNode( registry, listNode );

			listDepth++;
			current = ensureListItem( listNode, ! isLast );
			relativeSegments = [];
			return;
		}

		if ( isLast ) {
			const scalarNode = ensureChildNode( current, part.name, 'scalar', errorPath );
			scalarNode.contextDepth = listDepth;
			scalarNode.segments = listDepth === 0
				? declaration.segments
				: [ ...relativeSegments, part.name ];
			scalarNode.path = getCanonicalPath( fullParts );
			registry.scalarsByPath.set( scalarNode.path, scalarNode );
			return;
		}

		current = ensureChildNode( current, part.name, 'object', errorPath );
		relativeSegments = [ ...relativeSegments, part.name ];
	} );
}

function getRootShape( registry, name, kind, errorPath ) {
	if ( ! registry.rootShapes.has( name ) ) {
		registry.rootShapes.set( name, {
			name,
			kind,
			properties: new Map(),
			roles: new Set(),
		} );
		return registry.rootShapes.get( name );
	}

	const root = registry.rootShapes.get( name );
	if ( root.kind !== kind ) {
		diagnostics.error( errorPath, `Invalid template var declarations for "${ name }". The same root cannot be both a list and an object.` );
	}
	return root;
}

function ensureChildNode( parent, name, kind, errorPath ) {
	if ( ! parent.properties ) {
		parent.properties = new Map();
	}

	if ( ! parent.properties.has( name ) ) {
		parent.properties.set( name, {
			name,
			kind,
			properties: kind === 'object' ? new Map() : undefined,
		} );
		return parent.properties.get( name );
	}

	const child = parent.properties.get( name );
	if ( child.kind === 'scalar' && kind !== 'scalar' ) {
		diagnostics.error( errorPath, `Invalid template var declarations for "${ name }". A scalar path cannot also contain child paths.` );
	}
	if ( child.kind !== kind ) {
		diagnostics.error( errorPath, `Invalid template var declarations for "${ name }". Conflicting path shapes are not supported.` );
	}
	return child;
}

function ensureListItem( listNode, needsObject ) {
	if ( ! listNode.item ) {
		listNode.item = needsObject
			? { kind: 'object', properties: new Map() }
			: { kind: 'primitive' };
	}

	if ( needsObject && listNode.item.kind === 'primitive' ) {
		listNode.item = { kind: 'object', properties: new Map() };
	}

	return listNode.item;
}

function registerListNode( registry, listNode ) {
	registry.listsByPath.set( listNode.path, listNode );
	registry.listsBySourceKey.set( listNode.sourceKey, listNode );
}

function inferUsageRoles( registry, componentPath, babel, options = {} ) {
	if ( ! componentPath ) {
		return;
	}

	const { types } = babel;

	componentPath.traverse( {
		LogicalExpression( subPath ) {
			if ( subPath.node.operator === '&&' ) {
				tagControlArgs( registry, subPath.node.left, types, subPath, options );
			}
		},
		ConditionalExpression( subPath ) {
			tagControlArgs( registry, subPath.node.test, types, subPath, options );
		},
		CallExpression( subPath ) {
			tagListMapUsage( registry, subPath, types, options );
		},
	} );
}

function tagControlArgs( registry, expression, types, path, options = {} ) {
	const args = getExpressionArgs( expression, types );
	args.forEach( ( arg ) => {
		if ( arg.type !== 'identifier' && arg.type !== 'path' ) {
			return;
		}

		const resolvedValue = getResolvedArgValue( arg, path, options );

		if ( registry.paths.has( resolvedValue ) ) {
			registry.paths.get( resolvedValue ).roles.add( 'control' );
		}

		if ( registry.rootShapes.has( resolvedValue ) ) {
			registry.rootShapes.get( resolvedValue ).roles.add( 'control' );
		}
	} );
}

function tagListMapUsage( registry, callPath, types, options = {} ) {
	const { node } = callPath;
	if ( ! types.isMemberExpression( node.callee ) ) {
		return;
	}

	if ( ! types.isIdentifier( node.callee.property ) || node.callee.property.name !== 'map' ) {
		return;
	}

	const sourceKey = getExpressionSourceKey( node.callee.object, types, callPath, options );
	if ( ! sourceKey ) {
		return;
	}

	const listNode = registry.listsBySourceKey.get( sourceKey );
	if ( ! listNode ) {
		return;
	}

	const variableDeclarator = callPath.parentPath;
	if ( variableDeclarator && types.isVariableDeclarator( variableDeclarator.node ) && types.isIdentifier( variableDeclarator.node.id ) ) {
		listNode.tagAliases = listNode.tagAliases || new Set();
		listNode.tagAliases.add( variableDeclarator.node.id.name );
	}
}

function deriveControllerInputs( registry ) {
	const replace = [];
	const control = [];
	const list = [];

	registry.paths.forEach( ( entry ) => {
		const config = {
			segments: entry.segments,
		};

		if ( entry.roles.has( 'replace' ) ) {
			replace.push( [ entry.path, config ] );
		}

		if ( entry.roles.has( 'control' ) ) {
			control.push( [ entry.path, config ] );
		}
	} );

	registry.rootShapes.forEach( ( entry ) => {
		if ( entry.roles.has( 'control' ) ) {
			control.push( [ entry.name, { segments: [ entry.name ] } ] );
		}

		list.push( [ entry.name, serializeShapeNode( entry ) ] );
	} );

	return {
		replace,
		control,
		list,
		registry,
		listMetadata: Array.from( registry.listsByPath.values() ).map( serializeListMetadata ),
		scalarMetadata: Array.from( registry.scalarsByPath.values() ).map( serializeScalarMetadata ),
	};
}

function serializeShapeNode( node ) {
	if ( node.kind === 'scalar' ) {
		return {
			name: node.name,
			kind: 'scalar',
			segments: node.segments,
			contextDepth: node.contextDepth,
		};
	}

	if ( node.kind === 'list' ) {
		return {
			name: node.name,
			kind: 'list',
			path: node.path,
			sourceKey: node.sourceKey,
			sourceSegments: node.sourceSegments,
			parentContextDepth: node.parentContextDepth,
			itemContextDepth: node.itemContextDepth,
			tagAliases: node.tagAliases ? Array.from( node.tagAliases ) : undefined,
			item: serializeShapeNode( node.item || { kind: 'primitive' } ),
		};
	}

	if ( node.kind === 'primitive' ) {
		return {
			kind: 'primitive',
		};
	}

	const objectNode = {
		kind: 'object',
		properties: Array.from( node.properties.values() ).map( serializeShapeNode ),
	};
	if ( node.name ) {
		objectNode.name = node.name;
	}
	return objectNode;
}

function serializeListMetadata( node ) {
	return {
		name: node.name,
		path: node.path,
		sourceKey: node.sourceKey,
		sourceSegments: node.sourceSegments,
		parentContextDepth: node.parentContextDepth,
		itemContextDepth: node.itemContextDepth,
		tagAliases: node.tagAliases ? Array.from( node.tagAliases ) : [],
	};
}

function serializeScalarMetadata( node ) {
	return {
		path: node.path,
		segments: node.segments,
		contextDepth: node.contextDepth,
	};
}

function getResolvedArgValue( arg, path, options = {} ) {
	const segments = arg.segments || String( arg.value ).split( '.' );
	if ( typeof options.resolveSegments === 'function' ) {
		return options.resolveSegments( segments, path ).join( '.' );
	}
	return segments.join( '.' );
}

function getExpressionSourceKey( expression, types, path = null, options = {} ) {
	if ( types.isIdentifier( expression ) ) {
		if ( typeof options.resolveSegments === 'function' ) {
			return options.resolveSegments( [ expression.name ], path ).join( '.' );
		}
		return expression.name;
	}
	if ( ! types.isMemberExpression( expression ) ) {
		return null;
	}
	const segments = [];
	let current = expression;
	while ( types.isMemberExpression( current ) && ! current.computed ) {
		if ( ! types.isIdentifier( current.property ) ) {
			return null;
		}
		segments.unshift( current.property.name );
		current = current.object;
	}
	if ( ! types.isIdentifier( current ) ) {
		return null;
	}
	segments.unshift( current.name );
	if ( typeof options.resolveSegments === 'function' ) {
		return options.resolveSegments( segments, path ).join( '.' );
	}
	return segments.join( '.' );
}

function getCanonicalPath( parts ) {
	return parts.map( part => `${ part.name }${ part.isList ? '[]' : '' }` ).join( '.' );
}

function getListSourceKey( parts ) {
	const canonical = getCanonicalPath( parts );
	return canonical.endsWith( '[]' ) ? canonical.slice( 0, -2 ) : canonical;
}

module.exports = {
	createTemplateVarsRegistry,
	parseTemplateVarPath,
};
