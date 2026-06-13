/**
 * Main visitor works by replacing variables throughout a component with Handlebars tags.
 *
 * Add `templateVars` to a component definition to specify which props are dynamic and need
 * to be exposed as Handlebars tags - to later be rendered with data from a server.
 *
 * Template vars are declared as flat data paths. The registry infers the roles
 * needed at supported usage sites:
 *
 * - *replace* - the path appears in rendered output and needs a template tag.
 * - *control* - the path appears in a supported condition controlling output.
 * - *list*    - the path declares list shape and appears in supported list output.
 *
 * ----
 *
 * Outline
 * - Look for `templateVars`
 * - Build a flat path registry and infer roles from supported AST usage
 * - Locate + visit the component definition - assumes it is the previous path ( sibling ( -1 ) ).
 *
 * Process replace role vars
 * - Declare new identifiers (with new values) for all replacement template props at the top of the component
 * - Replace occurences of the old identifiers with the new ones
 *   (exclude variable declarations and watch out for nested props)
 *
 * Process control role vars
 * - Look for the template var in JSX expressions (TODO: support more expression types)
 * - Remove the condition so the expression is always completed (showing the related JSX)
 * - Wrap JSX in handlebars tags using custom helpers to recreate the conditions
 * 
 * Process list role vars
 * - Declare new arrays with a template style version - eg `[ '{{.}}' ]` or `[ { value: '{{value}}', label: '{{label}}' } ]`
 *   for objects. 
 * - The new arrays will always have a length of 1.
 * - Look for any member expressions in the component definition that use the identifier + a `.map()` and track the new
 *   identifier name / assignment as well as the original identifier name.
 * - Look for the list vars (and any new identifiers from an earlier `.map()`) in JSX expressions - either on their
 *   own as an identifier or combined with `.map()` and wrap them in template tags.
 * - Also check for any control variables in JSX expressions which use list variables on the right of the experssion
 *   and wrap them in template tags.
  */
const {
	getArrayFromExpression,
} = require( './utils' );

const templateVarsController = require( './controller' );
const { createTemplateVarsRegistry } = require( './template-vars-registry' );
const defaultLanguage = 'handlebars';

/**
 * Gets the template vars from the property definition.
 * 
 * @param {Object} expression The expression
 * @param {Object} types The babel types object
 * 
 * @returns 
 */
function getTemplateVarsFromExpression( expression, types ) {
	const left = expression.left;
	const right = expression.right;
	if ( ! left || ! right ) {
		return false;
	}

	const { object, property } = left;
	// Make sure the property being set is `templateVars`
	if ( ! types.isIdentifier( object ) ) {
		return false;
	}
	if ( ! types.isIdentifier( property ) ) {
		return false;
	}

	const objectName = object.name;
	const propertyName = property.name;

	if ( propertyName === 'templateVars' ) {
		let templatePropsValue = [];
		// Now process the right part of the expression: .templateVars = *right*.
		if ( right && right.type === 'ArrayExpression' ) {
			// Then we have an array to process the props.
			templatePropsValue = getArrayFromExpression( right );
		}
		return templatePropsValue;
	}
	return false;
}

/**
 * The main visitor for the plugin.
 * 
 * @param {Object} param0 Babel instance.
 * @param {Object} config Plugin config.
 * @returns 
 */
function templateVarsVisitor( babel, config ) {
	const { types } = babel;
	const tidyOnly = config.tidyOnly ?? false;

	return {
		ExpressionStatement( path, state ) {
			// Try to look for the property assignment of `templateVars` and:
			// - Process the template vars for later
			// - Remove `templateVars` from the source code
			
			const { expression } = path.node;
			
			// Process the expression and get the raw template var declarations.
			const templatePropsValue = getTemplateVarsFromExpression( expression, types );
			if ( ! templatePropsValue ) {
				return;
			}

			// We know this exists because it was checked in getTemplateVarsFromExpression
			const componentName = path.node.expression.left.object.name;
			// Find the component path by name
			const componentPath = getComponentPath( path.parentPath, componentName );
			
			// Remove templateVars from the source
			path.remove();

			// If tidyOnly is set, exit here (immediately after the removal of the templateVars).
			if ( tidyOnly ) {
				return;
			}

			// If the component path is not found, exit here.
			if ( ! componentPath ) {
				return;
			}

			const templateVars = createTemplateVarsRegistry( templatePropsValue, componentPath, babel, path );
			templateVarsController.init( templateVars, componentName, componentPath, babel );
		}
	}
};

// Find and return a component (variable declaration) path via traversal by its name.
function getComponentPath( path, componentName ) {
	let componentPath;
	path.traverse( {
		VariableDeclaration( subPath ) {
			const declarationName = subPath.node.declarations[0].id.name
			if ( declarationName === componentName ) {
				componentPath = subPath;
			}
			subPath.skip();
		}
	} );
	return componentPath;
}

module.exports = templateVarsVisitor;
