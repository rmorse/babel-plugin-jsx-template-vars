import path from 'node:path';
import { fileURLToPath } from 'node:url';
import babel from '@babel/core';
import jsxPlugin from '@babel/plugin-transform-react-jsx';
import templateVarsPlugin from '../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultFixtureFilename = path.join(repoRoot, '__fixtures__', 'component.jsx');

export const Fragment = Symbol('Fragment');
export const e2eFixturesDir = path.join(repoRoot, 'fixtures', 'e2e');

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
		sourceType: 'unambiguous',
		parserOpts: {
			plugins: [ 'jsx' ],
		},
		plugins,
	});
}

export async function renderTemplateFixture(language, source, exportName, props = {}, pluginOptions = {}) {
	const result = transformTemplateVars(source, { language, ...pluginOptions });
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
			'createTemplateRootDescriptor',
			'getTemplateRootPathArg',
			'isTemplateRootDescriptor',
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
			runtime.getLanguageControl,
			runtime.createTemplateRootDescriptor,
			runtime.getTemplateRootPathArg,
			runtime.isTemplateRootDescriptor
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

export async function renderTemplateModules(language, sources, entryFilename, exportName, props = {}, pluginOptions = {}) {
	const runtime = await import('../language/index.js');
	const normalizedSources = new Map(Object.entries(sources).map(([ filename, source ]) => [
		path.normalize(path.resolve(filename)),
		source,
	]));
	const transformed = new Map();
	normalizedSources.forEach((source, filename) => {
		transformed.set(filename, transformTemplateVars(source, { language, ...pluginOptions }, { filename }).code);
	});

	const modules = new Map();
	const previousWindow = globalThis.window;
	const windowObject = {};

	globalThis.window = windowObject;

	try {
		const loadModule = (filename) => {
			const normalizedFilename = path.normalize(path.resolve(filename));
			if (modules.has(normalizedFilename)) {
				return modules.get(normalizedFilename);
			}

			const code = transformed.get(normalizedFilename);
			if (!code) {
				throw new Error(`No transformed module found for ${ normalizedFilename }`);
			}

			const module = { exports: {} };
			modules.set(normalizedFilename, module.exports);
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
				'createTemplateRootDescriptor',
				'getTemplateRootPathArg',
				'isTemplateRootDescriptor',
				'loadModule',
				`${ rewriteRelativeImportsForExecution(code, normalizedFilename) }\nreturn module.exports;`
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
				runtime.getLanguageControl,
				runtime.createTemplateRootDescriptor,
				runtime.getTemplateRootPathArg,
				runtime.isTemplateRootDescriptor,
				loadModule
			);
			modules.set(normalizedFilename, exports);
			return exports;
		};

		const entryExports = loadModule(entryFilename);
		return {
			codeByFile: Object.fromEntries(transformed),
			output: entryExports[ exportName ](props),
		};
	} finally {
		if (typeof previousWindow === 'undefined') {
			delete globalThis.window;
		} else {
			globalThis.window = previousWindow;
		}
	}
}

export function normalizeTemplateOutput(value) {
	return String(value).replace(/\r\n/g, '\n').trim();
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

function rewriteRelativeImportsForExecution(code, filename) {
	const exportedNames = [];
	const nextCode = code
		.replace(/import\s+\{\s*([^}]+?)\s*\}\s+from\s+['"]([^'"]+)['"];\s*/g, (_match, imports, source) => {
			const resolved = resolveRelativeModuleForExecution(filename, source);
			return `const { ${ rewriteNamedImportsForExecution(imports) } } = loadModule(${ JSON.stringify(resolved) });\n`;
		})
		.replace(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=/g, (_match, name) => {
			exportedNames.push(name);
			return `const ${ name } =`;
		})
		.replace(/module\.exports\s*=\s*\{\s*([^}]+?)\s*\};?/g, (_match, exportsList) => {
			return `module.exports = { ${ exportsList.trim() } };`;
		});

	if (exportedNames.length === 0) {
		return nextCode;
	}

	return `${ nextCode }\nObject.assign(module.exports, { ${ exportedNames.join(', ') } });`;
}

function rewriteNamedImportsForExecution(imports) {
	return imports
		.split(',')
		.map((importName) => importName.trim())
		.filter(Boolean)
		.map((importName) => {
			const aliasMatch = importName.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
			return aliasMatch ? `${ aliasMatch[1] }: ${ aliasMatch[2] }` : importName;
		})
		.join(', ');
}

function resolveRelativeModuleForExecution(filename, source) {
	if (!source.startsWith('.')) {
		return source;
	}

	const base = path.resolve(path.dirname(filename), source);
	const extension = path.extname(base);
	return path.normalize(extension ? base : `${ base }.jsx`);
}

function renderAttributes(props) {
	return Object.entries(props)
		.filter(([ name, value ]) => name !== 'children' && value !== false && value !== null && typeof value !== 'undefined')
		.map(([ name, value ]) => {
			if (isTemplateRootDescriptorValue(value)) {
				throw new Error('Template root descriptor escaped into rendered attributes.');
			}
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
		if (isTemplateRootDescriptorValue(child)) {
			throw new Error('Template root descriptor escaped into rendered children.');
		}
		return String(child);
	}).join('');
}

function isTemplateRootDescriptorValue(value) {
	return Boolean(
		value &&
		typeof value === 'object' &&
		value.__jsxTemplateVarsTemplateRoot === true
	);
}
