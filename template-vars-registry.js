const diagnostics = require( './diagnostics' );
const {
	getExpressionArgs,
	getExpressionPath,
} = require( './utils' );

const identifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function normaliseConfigProp( prop ) {
	if ( ! Array.isArray( prop ) ) {
		return [ prop, {} ];
	}
	return prop;
}

function parseTemplateVarPath( value, errorPath ) {
	if ( typeof value !== 'string' ) {
		diagnostics.error( errorPath, `templateVars declarations must use string paths. Received ${ typeof value }.` );
	}

	if ( value.length === 0 || value.trim() !== value ) {
		diagnostics.error( errorPath, `Invalid template var path "${ value }". Paths cannot be empty or contain surrounding whitespace.` );
	}

	const rawSegments = value.split( '.' );
	let listIndex = -1;
	const segments = rawSegments.map( ( rawSegment, index ) => {
		if ( rawSegment.length === 0 ) {
			diagnostics.error( errorPath, `Invalid template var path "${ value }". Path segments cannot be empty.` );
		}

		const isList = rawSegment.endsWith( '[]' );
		const name = isList ? rawSegment.slice( 0, -2 ) : rawSegment;

		if ( name.includes( '[' ) || name.includes( ']' ) ) {
			diagnostics.error( errorPath, `Invalid template var path "${ value }". Only root list markers like "items[]" are supported.` );
		}

		if ( ! identifierPattern.test( name ) ) {
			diagnostics.error( errorPath, `Invalid template var path "${ value }". "${ name }" is not a supported identifier segment.` );
		}

		if ( isList ) {
			if ( listIndex !== -1 ) {
				diagnostics.error( errorPath, `Invalid template var path "${ value }". Deep nested list paths are deferred.` );
			}
			listIndex = index;
		}

		return name;
	} );

	if ( listIndex > 0 ) {
		diagnostics.error( errorPath, `Invalid template var path "${ value }". First-pass list paths must use the root segment as the list.` );
	}

	if ( listIndex === 0 && segments.length > 2 ) {
		diagnostics.error( errorPath, `Invalid template var path "${ value }". First-pass list paths support one child property only.` );
	}

	return {
		value,
		segments,
		rootName: segments[ 0 ],
		isList: listIndex === 0,
		childSegments: listIndex === 0 ? segments.slice( 1 ) : [],
	};
}

function createTemplateVarsRegistry( templatePropsValue, componentPath, babel, errorPath ) {
	const registry = {
		paths: new Map(),
		lists: new Map(),
	};

	templatePropsValue.forEach( ( prop ) => {
		const [ varName, varConfig ] = normaliseConfigProp( prop );
		addDeclaration( registry, varName, varConfig || {}, errorPath );
	} );

	inferUsageRoles( registry, componentPath, babel );

	return deriveControllerInputs( registry );
}

function addDeclaration( registry, varName, varConfig, errorPath ) {
	const declarationType = varConfig.type || 'replace';

	if ( declarationType === 'list' ) {
		addListDeclaration( registry, varName, {
			explicitConfig: varConfig,
			errorPath,
		} );
		return;
	}

	const parsedPath = parseTemplateVarPath( varName, errorPath );
	if ( parsedPath.isList ) {
		addFlatListDeclaration( registry, parsedPath, errorPath );
		return;
	}

	const entry = getPathEntry( registry, parsedPath.segments );
	if ( declarationType === 'control' ) {
		entry.roles.add( 'control' );
		return;
	}

	if ( declarationType === 'replace' ) {
		entry.roles.add( 'replace' );
		return;
	}

	diagnostics.error( errorPath, `Unsupported template var type "${ declarationType }" for "${ varName }".` );
}

function addFlatListDeclaration( registry, parsedPath, errorPath ) {
	const listEntry = getListEntry( registry, parsedPath.rootName );
	listEntry.roles.add( 'list' );

	if ( parsedPath.childSegments.length === 0 ) {
		listEntry.primitiveDeclared = true;
		return;
	}

	const childName = parsedPath.childSegments[ 0 ];
	if ( ! identifierPattern.test( childName ) ) {
		diagnostics.error( errorPath, `Invalid list child path "${ parsedPath.value }".` );
	}

	listEntry.props.add( childName );
}

function addListDeclaration( registry, varName, options ) {
	const { explicitConfig, errorPath } = options;
	const parsedPath = parseTemplateVarPath( varName, errorPath );
	if ( parsedPath.isList || parsedPath.segments.length !== 1 ) {
		diagnostics.error( errorPath, `Explicit list declarations must target a root list identifier. Received "${ varName }".` );
	}

	const listEntry = getListEntry( registry, parsedPath.rootName );

	listEntry.roles.add( 'list' );
	listEntry.explicitConfig = explicitConfig;

	if ( Array.isArray( explicitConfig.aliases ) ) {
		explicitConfig.aliases.forEach( alias => listEntry.aliases.add( alias ) );
	}
}

function getPathEntry( registry, segments ) {
	const pathName = segments.join( '.' );
	if ( ! registry.paths.has( pathName ) ) {
		registry.paths.set( pathName, {
			path: pathName,
			segments,
			roles: new Set(),
		} );
	}
	return registry.paths.get( pathName );
}

function getListEntry( registry, rootName ) {
	if ( ! registry.lists.has( rootName ) ) {
		registry.lists.set( rootName, {
			path: rootName,
			segments: [ rootName ],
			roles: new Set(),
			props: new Set(),
			aliases: new Set(),
			primitiveDeclared: false,
			explicitConfig: null,
		} );
	}
	return registry.lists.get( rootName );
}

function inferUsageRoles( registry, componentPath, babel ) {
	if ( ! componentPath ) {
		return;
	}

	const { types } = babel;

	componentPath.traverse( {
		LogicalExpression( subPath ) {
			if ( subPath.node.operator === '&&' ) {
				tagControlArgs( registry, subPath.node.left, types );
			}
		},
		ConditionalExpression( subPath ) {
			tagControlArgs( registry, subPath.node.test, types );
		},
		CallExpression( subPath ) {
			tagListMapUsage( registry, subPath, types );
		},
	} );
}

function tagControlArgs( registry, expression, types ) {
	const args = getExpressionArgs( expression, types );
	args.forEach( ( arg ) => {
		if ( arg.type !== 'identifier' && arg.type !== 'path' ) {
			return;
		}

		if ( registry.paths.has( arg.value ) ) {
			registry.paths.get( arg.value ).roles.add( 'control' );
		}

		if ( registry.lists.has( arg.value ) ) {
			registry.lists.get( arg.value ).roles.add( 'control' );
		}
	} );
}

function tagListMapUsage( registry, callPath, types ) {
	const { node } = callPath;
	if ( ! types.isMemberExpression( node.callee ) ) {
		return;
	}

	if ( ! types.isIdentifier( node.callee.property ) || node.callee.property.name !== 'map' ) {
		return;
	}

	const receiverPath = getExpressionPath( node.callee.object, types );
	if ( ! receiverPath || receiverPath.includes( '.' ) ) {
		return;
	}

	let listEntry = registry.lists.get( receiverPath );
	if ( ! listEntry && registry.paths.has( receiverPath ) ) {
		listEntry = getListEntry( registry, receiverPath );
		listEntry.roles.add( 'list' );
		registry.paths.get( receiverPath ).roles.delete( 'replace' );
	}

	if ( ! listEntry ) {
		return;
	}

	listEntry.roles.add( 'list' );

	const variableDeclarator = callPath.parentPath;
	if ( variableDeclarator && types.isVariableDeclarator( variableDeclarator.node ) && types.isIdentifier( variableDeclarator.node.id ) ) {
		listEntry.aliases.add( variableDeclarator.node.id.name );
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

	registry.lists.forEach( ( entry ) => {
		if ( entry.roles.has( 'control' ) ) {
			control.push( [ entry.path, { segments: entry.segments } ] );
		}

		if ( ! entry.roles.has( 'list' ) ) {
			return;
		}

		list.push( [ entry.path, getListConfig( entry ) ] );
	} );

	return {
		replace,
		control,
		list,
		registry,
	};
}

function getListConfig( entry ) {
	const aliases = Array.from( entry.aliases );

	if ( entry.explicitConfig ) {
		const config = { ...entry.explicitConfig };
		if ( aliases.length > 0 ) {
			config.aliases = Array.from( new Set( [ ...( entry.explicitConfig.aliases || [] ), ...aliases ] ) );
		}
		return config;
	}

	const config = {
		type: 'list',
		child: {
			type: 'primitive',
		},
	};

	if ( entry.props.size > 0 ) {
		config.child = {
			type: 'object',
			props: Array.from( entry.props ),
		};
	}

	if ( aliases.length > 0 ) {
		config.aliases = aliases;
	}

	return config;
}

module.exports = {
	createTemplateVarsRegistry,
	parseTemplateVarPath,
};
