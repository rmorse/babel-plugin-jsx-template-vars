import path from 'node:path';
import { fileURLToPath } from 'node:url';
import babel from '@babel/core';
import jsxPlugin from '@babel/plugin-transform-react-jsx';
import templateVarsPlugin from '../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultFixtureFilename = path.join(repoRoot, '__fixtures__', 'component.jsx');

export const Fragment = Symbol('Fragment');

export function transformTemplateVars(source, pluginOptions = {}, options = {}) {
	const plugins = [
		[ templateVarsPlugin, pluginOptions ],
	];

	if (options.jsx !== false) {
		plugins.push([ jsxPlugin, { pragma: 'h', pragmaFrag: 'Fragment' } ]);
	}

	return babel.transformSync(source, {
		filename: options.filename || defaultFixtureFilename,
		babelrc: false,
		configFile: false,
		sourceType: 'script',
		parserOpts: {
			plugins: [ 'jsx' ],
		},
		plugins,
	});
}

export async function renderTemplateFixture(language, source, exportName, props = {}) {
	const result = transformTemplateVars(source, { language });
	const runtime = await import('../language/index.js');
	const module = { exports: {} };
	const previousWindow = globalThis.window;
	const windowObject = {};

	globalThis.window = windowObject;

	try {
		const execute = new Function(
			'module',
			'exports',
			'h',
			'Fragment',
			'window',
			'getLanguageString',
			'getLanguageReplace',
			'getLanguageList',
			'getLanguageControl',
			`${ result.code }\nreturn module.exports;`
		);

		const exports = execute(
			module,
			module.exports,
			h,
			Fragment,
			windowObject,
			runtime.getLanguageString,
			runtime.getLanguageReplace,
			runtime.getLanguageList,
			runtime.getLanguageControl
		);

		return {
			code: result.code,
			output: exports[ exportName ](props),
		};
	} finally {
		if (typeof previousWindow === 'undefined') {
			delete globalThis.window;
		} else {
			globalThis.window = previousWindow;
		}
	}
}

function h(type, props, ...children) {
	const normalizedProps = props || {};

	if (type === Fragment) {
		return renderChildren(children);
	}

	if (typeof type === 'function') {
		return type({
			...normalizedProps,
			children,
		});
	}

	const attrs = renderAttributes(normalizedProps);
	const renderedChildren = renderChildren(children);
	const voidElements = new Set([ 'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr' ]);

	if (voidElements.has(type)) {
		return `<${ type }${ attrs }>`;
	}

	return `<${ type }${ attrs }>${ renderedChildren }</${ type }>`;
}

function renderAttributes(props) {
	return Object.entries(props)
		.filter(([ name, value ]) => name !== 'children' && value !== false && value !== null && typeof value !== 'undefined')
		.map(([ name, value ]) => {
			if (value === true) {
				return ` ${ name }`;
			}
			return ` ${ name }="${ String(value) }"`;
		})
		.join('');
}

function renderChildren(children) {
	return children.flat(Infinity).map((child) => {
		if (child === false || child === true || child === null || typeof child === 'undefined') {
			return '';
		}
		return String(child);
	}).join('');
}
