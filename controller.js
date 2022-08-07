
const {
	isJSXElementComponent,
	isJSXElementTextInput,
} = require( './utils' );

const { ReplaceController } = require( './controllers/replace' );
const { ListController } = require( './controllers/list' );
const { ControlController } = require( './controllers/control' );
/**
 * Generate new uids for the provided scope.
 * 
 * @param {Object} scope The current scope.
 * @param {Object} vars The vars to generate uids for.
 * @returns 
 */
function generateVarTypeUids( scope, vars ) {
	const varMap = {};
	const varNames = [];
	vars.forEach( ( [ varName, varConfig ] ) => {
		const newIdentifier = scope.generateUidIdentifier("uid");
		varMap[ varName ] = newIdentifier.name;
		varNames.push( varName );
	} );

	return [ varMap, varNames ];
}



const templateVarsController = {
	babel: {},
	vars: {
		replace: {},
		control: {},
		list: {},
	},
	contextIdentifier: null,
	init: function( templateVars, componentPath, babel ) {
		this.babel = babel;
		const { types, parse } = babel;
		// Get the three types of template vars.
		const { replace: replaceVars, control: controlVars, list: listVars } = templateVars;

		// Build the map of vars to replace.
		const replaceVarsParsed = generateVarTypeUids( componentPath.scope, replaceVars );
		this.vars.replace = {
			raw: replaceVars,
			mapped: replaceVarsParsed[0],
			mapInv: Object.fromEntries(Object.entries(replaceVarsParsed[0]).map(a => a.reverse())),
			names: replaceVarsParsed[1],
		}
		//replaceVarsInv

		// Get the control vars names
		const [ controlVarsMap, controlVarsNames ] = generateVarTypeUids( componentPath.scope, controlVars );
		this.vars.control = {
			raw: controlVars,
			mapped: controlVarsMap,
			names: controlVarsNames,
		}

		// Build the map of var lists.
		const [ listVarsMap, listVarsNames ] = generateVarTypeUids( componentPath.scope, listVars );
		this.vars.list = {
			raw: listVars,
			mapped: listVarsMap,
			names: listVarsNames,
			toTag: {},
		}
		
		
		// All the list variable names we need to look for in JSX expressions
		const self = this;
		// Start the main traversal of component

		// TODO - we should look through the params and apply the same logic...
		const componentParam = componentPath.node.declarations[0].init.params[0];

		let propsName = null;
		// If the param is an object pattern, we want to add `__context__` as a property to it.
		if ( componentPath.node.declarations[0].init.params.length === 0 ) {
			// Then there are no params, so lets add an object pattern with one param, __context__.
			componentPath.node.declarations[0].init.params.push( types.objectPattern( [ types.objectProperty( types.identifier( '__context__' ), types.identifier( '__context__' ), false, true ) ] ) );
		} else if ( types.isObjectPattern( componentParam ) ) {
			// Then we at the first param - which is *probably* props passed through as an object.
			// For now lets assume it is, but this means we likely can't work with HOC components which have multiple params.
			// TODO - maybe we should test again the last param as it is usually the props object in HOCs.

			// Add __context__ as a property to the object.
			componentParam.properties.push( types.objectProperty( types.identifier( '__context__' ), types.identifier( '__context__' ), false, true ) );
		} else if ( types.isIdentifier( componentParam ) ) {
			// If it's an identifier we need to declare it in the block statement.
			propsName = componentParam.name;
		}

		this.contextIdentifier = componentPath.scope.generateUidIdentifier("uid");
		let blockStatementDepth = 0; // make sure we only update the correct block statement.

		const replaceController = new ReplaceController( this.vars.replace, babel );
		const listController = new ListController( this.vars.list, this.contextIdentifier.name, babel );
		const controlController = new ControlController( this.vars.control, this.contextIdentifier.name, babel );
	

		componentPath.traverse( {
			// Inject context into all components
			JSXElement(subPath){
				// If we find a JSX element, check to see if it's a component,
				// and if so, inject a `__context__` JSXAttribute.
				if ( isJSXElementComponent( subPath ) ) {
					let expression;
					// check if the component is inside a `map` and increase the context by 1
					if ( parentPathHasMap( subPath, types ) ) {
						expression = types.binaryExpression( '+', self.contextIdentifier, types.numericLiteral( 1 ) );
					} else {
						expression = types.identifier( self.contextIdentifier.name );
					}
					const contextAttribute = types.jSXAttribute( types.jSXIdentifier( '__context__' ), types.jSXExpressionContainer( expression ) );
					subPath.node.openingElement.attributes.push( contextAttribute );
				}

				/**
				 * We also need to track some special exceptions to html elements. 
				 * Because the idea of this transform is that the rendered html is later scraped and saved to a file,
				 * we need to work around some known browser rendering "bugs".
				 */
				/**
				 * Chrome (and other browsers) will not add an accurate `value` attribute to <input> (text) elements,
				 * They are usually moved to the shadow dom, which means when we scrape the page, anything in `value`
				 * will be lost. 
				 * eg:
				 * <input value="test" />
				 * would become:
				 * <input />
				 *
				 * Our workaround will be to copy the value attribute, to a custom attribute with the prefix `jsxtv_`.
				 * When we later scrape this page, it will then need to be converted back to the correct html attribute.
				 */

				if ( isJSXElementTextInput( subPath ) ) {
					// Now get the value attribute from the jsx element.
					const valueAttribute = subPath.node.openingElement.attributes.find( attr => attr?.name?.name === 'value' );

					if ( valueAttribute ) {
						// Create a new attribute `jsxtv_value` and copy the value from the valueAttribute
						const jsxtValueAttribute = types.jSXAttribute( types.jSXIdentifier( 'jsxtv_value' ), valueAttribute.value );

						// And add it to the existing attributes.
						subPath.node.openingElement.attributes.push( jsxtValueAttribute );
					}

				}

			},
			BlockStatement( statementPath ) {
				// TODO: Hacky way of making sure we only catch the first block statement - we should be able to check
				// something on the parent to make this more reliable.
				if ( blockStatementDepth !== 0 ) {
					return;
				}
				blockStatementDepth++;

				// Add replace vars to path.
				replaceController.initVars( self.contextIdentifier.name, statementPath );
				// Add list vars to path.
				listController.initVars( statementPath );
				
				
				// Figure out if we need to add a __context__ variable to the local scope.
				const nodesToAdd = [];
				if ( propsName ) {
					nodesToAdd.push( parse(`let ${ self.contextIdentifier.name } = typeof ${ propsName }.__context__ === 'number' ? ${ propsName }.__context__ : 0;` ) );
				} else {
					nodesToAdd.push( parse(`let ${ self.contextIdentifier.name } = typeof __context__ === 'number' ? __context__ : 0;` ) );
				}
				nodesToAdd.reverse();
				nodesToAdd.forEach( ( node ) => {
					statementPath.node.body.unshift( node );
				} );
			},
			Identifier( subPath ) {

				// Update and Ternary conditions before parsing the other var types (so we can use their names
				// before they're updated).
				controlController.updateTernaryConditions( subPath );
				
				// Now replace any replace or list vars identifier names with the new ones
				// we created earlier.
				replaceController.updateIdentifierNames( subPath );
				listController.updateIdentifierNames( subPath );
			},
			// Track vars in JSX expressions in case we need have any control vars to process
			JSXExpressionContainer( subPath ) {
				const { expression: containerExpression } = subPath.node;

				// Update any control vars in expressions in JSX
				controlController.updateJSXExpressions( containerExpression, subPath, self.vars.list.toTag );

				// And tag and update any list vars in we find in JSX
				listController.updateJSXListExpressions( containerExpression, subPath );
			},
		} );
	}
}

// check if any parent paths contain a map call
function parentPathHasMap( path, types ) {
	let parentPath = path.parentPath;
	while ( parentPath ) {
		if ( types.isCallExpression( parentPath.node ) && types.isMemberExpression( parentPath.node.callee ) ) {
			const memberExpression = parentPath.node.callee;
			if ( types.isIdentifier( memberExpression.property ) && memberExpression.property.name === 'map' ) {
				return true;
			}
		}
		parentPath = parentPath.parentPath;
	}
	return false;
}



module.exports = templateVarsController;
