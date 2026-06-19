
const {
	isJSXElementComponent,
	isJSXElementInput,
	getMemberExpressionSegments,
} = require('./utils');

const { ReplaceController } = require('./controllers/replace');
const { ListController } = require('./controllers/list');
const { ControlController } = require('./controllers/control');
const diagnostics = require('./diagnostics');
/**
 * Generate new uids for the provided scope.
 * 
 * @param {Object} scope The current scope.
 * @param {Object} vars The vars to generate uids for.
 * @returns 
 */
function generateVarTypeUids(scope, vars, sharedVarMap = {}) {
	const varMap = {};
	const varNames = [];
	vars.forEach(([varName, varConfig]) => {
		if ( ! sharedVarMap[ varName ] ) {
			const newIdentifier = scope.generateUidIdentifier("uid");
			sharedVarMap[ varName ] = newIdentifier.name;
		}
		varMap[varName] = sharedVarMap[ varName ];
		varNames.push(varName);
	});

	return [varMap, varNames];
}

const isHookCall = (callee, types) => {
	const hookPattern = /^use[A-Z]/;
	return types.isIdentifier(callee) && hookPattern.test(callee.name);
};

function normalizeExpressionBodiedArrowComponent( componentPath, types ) {
	const component = componentPath.node.declarations?.[ 0 ]?.init;
	if ( ! types.isArrowFunctionExpression( component ) || types.isBlockStatement( component.body ) ) {
		return;
	}

	component.body = types.blockStatement([
		types.returnStatement( component.body ),
	]);
}

const templateVarsController = {
	babel: {},
	vars: {
		replace: {},
		control: {},
		list: {},
	},
	contextIdentifier: null,
	recursionIdentifier: null,
	init: function (templateVars, componentName, componentPath, babel, config = {}) {
		this.babel = babel;
		const { types, parse } = babel;
		normalizeExpressionBodiedArrowComponent( componentPath, types );
		// Get the three types of template vars.
		const { replace: replaceVars, control: controlVars, list: listVars } = templateVars;
		const sharedVarMap = {};

		// Build the map of vars to replace.
		const replaceVarsParsed = generateVarTypeUids(componentPath.scope, replaceVars, sharedVarMap);
		this.vars.replace = {
			raw: replaceVars,
			mapped: replaceVarsParsed[0],
			mapInv: Object.fromEntries(Object.entries(replaceVarsParsed[0]).map(a => a.reverse())),
			names: replaceVarsParsed[1],
		}
		//replaceVarsInv

		// Get the control vars names
		const [controlVarsMap, controlVarsNames] = generateVarTypeUids(componentPath.scope, controlVars, sharedVarMap);
		this.vars.control = {
			raw: controlVars,
			mapped: controlVarsMap,
			names: controlVarsNames,
		}

		// Build the map of var lists.
		const [listVarsMap, listVarsNames] = generateVarTypeUids(componentPath.scope, listVars, sharedVarMap);
		this.vars.list = {
			raw: listVars,
			mapped: listVarsMap,
			mapInv: Object.fromEntries(Object.entries(listVarsMap).map(a => a.reverse())),
			names: listVarsNames,
			toTag: {},
			listMetadata: templateVars.listMetadata || [],
			scalarMetadata: templateVars.scalarMetadata || [],
		}


		// All the list variable names we need to look for in JSX expressions
		const self = this;
		// Start the main traversal of component

		// TODO - we should look through the params and apply the same logic...
		const componentParam = componentPath.node.declarations[0].init.params[0];
		let propsName = null;
		// If the param is an object pattern, we want to add `__context__` as a property to it.
		if (componentPath.node.declarations[0].init.params.length === 0) {
			// Then there are no params, so lets add an object pattern with the generated props.
			componentPath.node.declarations[0].init.params.push(types.objectPattern([
				types.objectProperty(types.identifier('__context__'), types.identifier('__context__'), false, true),
				types.objectProperty(types.identifier('__config__'), types.identifier('__config__'), false, true),
			]));
		} else if (types.isObjectPattern(componentParam)) {
			// Then we at the first param - which is *probably* props passed through as an object.
			// For now lets assume it is, but this means we likely can't work with HOC components which have multiple params.
			// TODO - maybe we should test again the last param as it is usually the props object in HOCs.

			// Add __context__ as a property to the object.
			componentParam.properties.push(types.objectProperty(types.identifier('__context__'), types.identifier('__context__'), false, true));
			componentParam.properties.push(types.objectProperty(types.identifier('__config__'), types.identifier('__config__'), false, true));
		} else if (types.isIdentifier(componentParam)) {
			// If it's an identifier we need to declare it in the block statement.
			propsName = componentParam.name;
		}

		this.contextIdentifier = componentPath.scope.generateUidIdentifier("uid");
		this.recursionIdentifier = componentPath.scope.generateUidIdentifier("uid");
		let blockStatementDepth = 0; // make sure we only update the correct block statement.

		const listController = new ListController(this.vars.list, this.contextIdentifier.name, babel, config);
		const replaceController = new ReplaceController(this.vars.replace, this.contextIdentifier.name, babel, listController);
		const controlController = new ControlController(this.vars.control, this.contextIdentifier.name, babel, listController);
		if (types.isObjectPattern(componentParam)) {
			const componentParamPath = componentPath.get('declarations.0.init.params.0');
			listController.registerPatternAliases(componentParam, [], componentParamPath);
		}
		listController.registerExternalPathAliases( config.storeSelectorAliases || [] );


		// Prevent infinite recursion by adding early return statements.
		let lastFunctionCallPath;
		let firstReturnPath;
		componentPath.traverse({
			CallExpression(subPath) {
				if (!isHookCall(subPath.node.callee, types)) {
					return;
				}
				lastFunctionCallPath = subPath;
			},
			ReturnStatement(subPath) {
				if (!firstReturnPath) {
					firstReturnPath = subPath;
				}
			},
		});

		// Find the last hook call
		if (lastFunctionCallPath) {
			const ifStatement = getConditionalReturn(self.recursionIdentifier.name, componentName, types);

			const lastFunctionCallStatementPath = lastFunctionCallPath.getStatementParent();
			if (firstReturnPath) {
				const firstReturnStatementPath = firstReturnPath.getStatementParent();
				if (lastFunctionCallStatementPath === firstReturnStatementPath) {
					firstReturnPath.insertBefore(ifStatement);
				} else {
					lastFunctionCallStatementPath.insertAfter(ifStatement);
				}
			} else {
				lastFunctionCallStatementPath.insertAfter(ifStatement);
			}
		}



		componentPath.traverse({
			// Inject context into all components
			JSXElement(subPath) {
				// If we find a JSX element, check to see if it's a component,
				// and if so, inject a `__context__` JSXAttribute.
				if (isJSXElementComponent(subPath)) {
					let expression;
					const contextOffset = listController.getContainingListContextOffset(subPath);
					if (contextOffset > 0) {
						expression = types.binaryExpression('+', self.contextIdentifier, types.numericLiteral(contextOffset));
					} else {
						expression = types.identifier(self.contextIdentifier.name);
					}
					const contextAttribute = types.jSXAttribute(types.jSXIdentifier('__context__'), types.jSXExpressionContainer(expression));
					subPath.node.openingElement.attributes.push(contextAttribute);


					// Add config attribute
					const configAttribute = types.jSXAttribute(types.jSXIdentifier('__config__'), types.jSXExpressionContainer(types.identifier(self.recursionIdentifier.name)));
					subPath.node.openingElement.attributes.push(configAttribute);

					injectDynamicRootDescriptors(subPath, listController, config, types);
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
				 * <input type="checkbox" checked="true" value="1" />
				 * would become:
				 * <input type="checkbox" />
				 *
				 * Our workaround will be to copy the value attribute, to a custom attribute with the prefix `jsxtv_`.
				 * When we later scrape this page, it will then need to be converted back to the correct html attribute.
				 */

				if (isJSXElementInput(subPath)) {
					// Now get the value attribute from the jsx element.
					const valueAttribute = subPath.node.openingElement.attributes.find(attr => attr?.name?.name === 'value');

					if (valueAttribute) {
						// Create a new attribute `jsxtv_value` and copy the value from the valueAttribute
						const jsxtValueAttribute = types.jSXAttribute(types.jSXIdentifier('jsxtv_value'), valueAttribute.value);

						// And add it to the existing attributes.
						subPath.node.openingElement.attributes.push(jsxtValueAttribute);
					}

					// Now get the checked attribute from the jsx element.
					// TODO - this needs investigating.  The issue is, the presence of the checked attribute will render it checked
					// in most browsers, regardless of the value.  Therefor, having a replace var in the checked attribute will
					// always render it checked... I think its best (for now) to render checkboxes unchecked and add the checked status
					// via the JS app only.
					// It would be nice to add conditions in the html output to conditionally add the checked attribute, but I don't
					// think that will be possible.
					/* const checkedAttribute = subPath.node.openingElement.attributes.find( attr => attr?.name?.name === 'checked' );

					if ( checkedAttribute ) {
						// Create a new attribute `jsxtv_checked` and copy the value from the checkedAttribute
						const jsxtCheckedAttribute = types.jSXAttribute( types.jSXIdentifier( 'jsxtv_checked' ), checkedAttribute.value );

						// And add it to the existing attributes.
						subPath.node.openingElement.attributes.push( jsxtCheckedAttribute );
					} */

				}

			},
			BlockStatement(statementPath) {
				// TODO: Hacky way of making sure we only catch the first block statement - we should be able to check
				// something on the parent to make this more reliable.
				if (blockStatementDepth !== 0) {
					return;
				}
				blockStatementDepth++;

				// Add replace vars to path.
				replaceController.initVars(statementPath);
				// Add list vars to path.
				listController.initVars(statementPath);


				// Figure out if we need to add a __context__ variable to the local scope.
				const nodesToAdd = [];
				if (propsName) {
					nodesToAdd.push(parse(`let ${self.contextIdentifier.name} = typeof ${propsName}.__context__ === 'number' ? ${propsName}.__context__ : 0;`));
					nodesToAdd.push(parse(`let ${self.recursionIdentifier.name} = typeof ${propsName}.__config__ !== 'undefined' ? ${propsName}.__config__ : {};`));
				} else {
					nodesToAdd.push(parse(`let ${self.contextIdentifier.name} = typeof __context__ === 'number' ? __context__ : 0;`));
					nodesToAdd.push(parse(`let ${self.recursionIdentifier.name} = typeof __config__ !== 'undefined' ? __config__ : {};`));
				}

				// Setup and incremement the recursionIdentifier for each component.
				// Don't allow more than 20 levels of recursion - TODO this should be set via a prop "depth"
				const recursionDepth = 20;
				nodesToAdd.push(parse(
					`${self.recursionIdentifier.name} = { ...${self.recursionIdentifier.name} };
					if ( typeof ${self.recursionIdentifier.name}.${componentName} === 'undefined' ) { ${self.recursionIdentifier.name}.${componentName} = 0; }
					${self.recursionIdentifier.name}.${componentName}++;`
				));

				// If we didn't detect a hook (or lastHook) then insert the early return here.
				if (typeof lastFunctionCallPath === 'undefined') {
					nodesToAdd.push(getConditionalReturn(self.recursionIdentifier.name, componentName, types));
				}

				nodesToAdd.reverse();
				nodesToAdd.forEach((node) => {
					statementPath.node.body.unshift(node);
				});

			},
			Identifier(subPath) {

				// Update and Ternary conditions before parsing the other var types (so we can use their names
				// before they're updated).
				controlController.updateTernaryConditions(subPath);

				// Now replace any replace or list vars identifier names with the new ones
				// we created earlier.
				replaceController.updateIdentifierNames(subPath);
				listController.updateIdentifierNames(subPath);
			},
			VariableDeclarator(subPath) {
				listController.trackVariableAliases(subPath);
			},
			AssignmentExpression(subPath) {
				listController.trackAssignmentAliases(subPath);
			},
			CallExpression(subPath) {
				listController.trackMapAliases(subPath);
			},
			ConditionalExpression(subPath) {
				controlController.updateTernaryExpressions(subPath.node, subPath);
			},
			MemberExpression(subPath) {
				controlController.updateTernaryMemberConditions(subPath);
				replaceController.updateMemberExpressionNames(subPath);
			},
			OptionalMemberExpression(subPath) {
				controlController.updateTernaryMemberConditions(subPath);
				replaceController.updateMemberExpressionNames(subPath);
			},
			// Track vars in JSX expressions in case we need have any control vars to process
			JSXExpressionContainer(subPath) {
				const { expression: containerExpression } = subPath.node;

				// Update any control vars in expressions in JSX
				controlController.updateJSXExpressions(containerExpression, subPath, self.vars.list.toTag);

				// And tag and update any list vars in we find in JSX on their
				listController.updateJSXListExpressions(containerExpression, subPath);
			},

		});

	}
}

function getConditionalReturn(recursionIdentifier, componentName, types) {
	const recursionDepth = 20;
	const earlyReturn = types.ifStatement(
		types.binaryExpression('>', types.memberExpression(types.identifier(recursionIdentifier), types.identifier(componentName)), types.numericLiteral(recursionDepth)),
		types.blockStatement([
			types.returnStatement(types.nullLiteral())
		])
	);
	return earlyReturn;
}


module.exports = templateVarsController;

function injectDynamicRootDescriptors(path, listController, config, types) {
	const elementName = path.node.openingElement?.name?.name;
	const rootProps = getDynamicRootPropsForComponent(config, elementName);
	if (rootProps.size === 0) {
		return;
	}

	path.get('openingElement.attributes').forEach((attributePath) => {
		const attribute = attributePath.node;
		const propName = attribute.name?.name;
		if (!rootProps.has(propName) || !types.isJSXExpressionContainer(attribute.value)) {
			return;
		}

		const expressionPath = attributePath.get('value.expression');
		if (isLocalDynamicRootExpression(expressionPath.node, config, types)) {
			return;
		}

		const segments = listController.resolveAliasedExpressionSegments(expressionPath.node, expressionPath);
		if (!segments) {
			diagnostics.error(
				expressionPath,
				`Dynamic root prop "${propName}" for child component "${elementName}" must receive a selector-derived or descriptor-derived value.`
			);
		}

		const descriptorSegments = segments;
		expressionPath.replaceWith(types.callExpression(
			types.identifier('createTemplateRootDescriptor'),
			[
				types.arrayExpression(descriptorSegments.map(segment => types.stringLiteral(segment))),
				types.arrayExpression(descriptorSegments.map(segment => types.stringLiteral(segment))),
			]
		));
	});
}

function getDynamicRootPropsForComponent(config, componentName) {
	const propsByComponent = config.dynamicRootPropsByComponent || {};
	const props = propsByComponent[componentName];
	return new Set(Array.isArray(props) ? props : []);
}

function getExpressionSegmentsForDescriptor(expression, types) {
	if (types.isIdentifier(expression)) {
		return [expression.name];
	}

	return getMemberExpressionSegments(expression, types);
}

function isLocalDynamicRootExpression(expression, config, types) {
	const segments = getExpressionSegmentsForDescriptor(expression, types);
	if (!segments) {
		return false;
	}

	return (config.dynamicRootAliases || []).some((alias) => {
		const rootSegments = [alias.localName, alias.memberName].filter(Boolean);
		return rootSegments.length === segments.length &&
			rootSegments.every((segment, index) => segment === segments[index]);
	});
}
