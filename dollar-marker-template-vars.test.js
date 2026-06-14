import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
	normalizeTemplateOutput,
	renderTemplateFixture,
	transformTemplateVars,
} from './test-utils/transform.js';

const require = createRequire(import.meta.url);
const {
	filenameIncludesNodeModules,
	isDollarMarkerName,
	unmarkName,
} = require('./dollar-marker-template-vars');

describe('dollar marker template vars experiment', () => {
	it('parses marker identifiers without treating single-dollar names as markers', () => {
		expect(isDollarMarkerName('$$title')).toBe(true);
		expect(isDollarMarkerName('$title')).toBe(false);
		expect(unmarkName('$$title')).toBe('title');
		expect(unmarkName('$$')).toBe(null);
	});

	it('leaves markers untouched when experimentalDollarMarkers is disabled', () => {
		const result = transformTemplateVars(`
			const App = ({ title }) => <h1>{ $$title }</h1>;
			module.exports = { App };
		`);

		expect(result.code).toContain('$$title');
		expect(result.code).not.toContain('getLanguageReplace');
	});

	it('skips marker discovery for node_modules filenames', () => {
		const result = transformTemplateVars(`
			const App = ({ title }) => <h1>{ $$title }</h1>;
			module.exports = { App };
		`, {
			experimentalDollarMarkers: true,
		}, {
			filename: 'D:/project/node_modules/pkg/App.jsx',
		});

		expect(result.code).toContain('$$title');
		expect(result.code).not.toContain('getLanguageReplace');
	});

	it('skips marker discovery for relative node_modules filenames', () => {
		expect(filenameIncludesNodeModules('node_modules/pkg/App.jsx')).toBe(true);
		expect(filenameIncludesNodeModules('pkg/node_modules/App.jsx')).toBe(true);
		expect(filenameIncludesNodeModules('src/components/App.jsx')).toBe(false);

		const result = transformTemplateVars(`
			const App = ({ title }) => <h1>{ $$title }</h1>;
			module.exports = { App };
		`, {
			experimentalDollarMarkers: true,
		}, {
			filename: 'node_modules/pkg/App.jsx',
		});

		expect(result.code).toContain('$$title');
		expect(result.code).not.toContain('getLanguageReplace');
	});

	it('renders scalar and nested object marker replacements', async () => {
		const source = `
			const App = ({ title, hero }) => (
				<main>
					<h1>{ $$title }</h1>
					<p>{ $$hero.summary }</p>
				</main>
			);
			module.exports = { App };
		`;

		const { code, output } = await renderTemplateFixture('handlebars', source, 'App', {}, {
			experimentalDollarMarkers: true,
		});

		expect(code).not.toContain('$$title');
		expect(code).not.toContain('$$hero');
		expect(output).toBe('<main><h1>{{title}}</h1><p>{{hero.summary}}</p></main>');
	});

	it('renders marker controls and multi-role values', async () => {
		const source = `
			const App = ({ status, visible }) => (
				<main>
					<h1>{ $$status }</h1>
					{ $$status === 'ready' && <strong>Ready</strong> }
					{ !$$visible && <span>Hidden</span> }
				</main>
			);
			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, {
			experimentalDollarMarkers: true,
		});

		expect(output).toContain('<h1>{{status}}</h1>');
		expect(output).toContain("{{#if_equal status 'ready'}}<strong>Ready</strong>{{/if_equal}}");
		expect(output).toContain('{{#unless visible}}<span>Hidden</span>{{/unless}}');
	});

	it('merges marker declarations with flat templateVars declarations', async () => {
		const source = `
			const App = ({ title, status }) => (
				<main>
					<h1>{ $$title }</h1>
					{ status === 'ready' && <strong>Ready</strong> }
				</main>
			);
			App.templateVars = [ 'status' ];
			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, {
			experimentalDollarMarkers: true,
		});

		expect(output).toContain('<h1>{{title}}</h1>');
		expect(output).toContain("{{#if_equal status 'ready'}}<strong>Ready</strong>{{/if_equal}}");
	});

	it('renders direct marker map lists and strips marker roots', async () => {
		const source = `
			const Item = ({ label }) => <li>{ label }</li>;
			Item.templateVars = [ 'label' ];

			const App = ({ items }) => (
				<ul>{ $$items.map((item) => <Item label={ item.label } />) }</ul>
			);
			module.exports = { App };
		`;

		const { code, output } = await renderTemplateFixture('handlebars', source, 'App', {}, {
			experimentalDollarMarkers: true,
		});

		expect(code).not.toContain('$$items');
		expect(output).toBe('<ul>{{#items}}<li>{{label}}</li>{{/items}}</ul>');
	});

	it('collects marker-origin aliases and destructures', async () => {
		const source = `
			const App = ({ hero = {} }) => {
				const heroAlias = $$hero;
				const { title: heading } = heroAlias;
				return (
					<main>
						<h1>{ heading }</h1>
						<p>{ heroAlias?.summary }</p>
					</main>
				);
			};
			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, {
			experimentalDollarMarkers: true,
		});

		expect(output).toBe('<main><h1>{{hero.title}}</h1><p>{{hero.summary}}</p></main>');
	});

	it('renders helper-only primitive list roots from direct marker arguments', async () => {
		const source = `
			const renderRows = (rows) => rows.map((row) => <li>{ row }</li>);
			const App = ({ products = [] }) => (
				<ul>{ renderRows($$products) }</ul>
			);
			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, {
			experimentalDollarMarkers: true,
		});

		expect(normalizeTemplateOutput(output)).toBe('<ul>{{#products}}<li>{{.}}</li>{{/products}}</ul>');
	});

	it('infers list item fields from safe-chain callbacks', async () => {
		const source = `
			const App = ({ products = [] }) => {
				const availableProducts = $$products.filter((product) => product.available);
				return (
					<ul>
						{ availableProducts.map((product) => <li>{ product.title }</li>) }
					</ul>
				);
			};
			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, {
			experimentalDollarMarkers: true,
		});

		expect(normalizeTemplateOutput(output)).toBe('<ul>{{#products}}<li>{{title}}</li>{{/products}}</ul>');
	});

	it('intentionally discovers top-level capitalized JSX helpers', async () => {
		const source = `
			const RenderRow = ({ label }) => <li>{ $$label }</li>;
			module.exports = { RenderRow };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'RenderRow', {}, {
			experimentalDollarMarkers: true,
		});

		expect(output).toBe('<li>{{label}}</li>');
	});

	it('does not discover lowercase render helpers', () => {
		const result = transformTemplateVars(`
			const renderRow = ({ label }) => <li>{ $$label }</li>;
			module.exports = { renderRow };
		`, {
			experimentalDollarMarkers: true,
		});

		expect(result.code).toContain('$$label');
		expect(result.code).not.toContain('getLanguageReplace');
	});

	it('leaves unsupported component forms untouched in marker mode', () => {
		const functionDeclaration = transformTemplateVars(`
			function App({ title }) {
				return <h1>{ $$title }</h1>;
			}
			module.exports = { App };
		`, {
			experimentalDollarMarkers: true,
		});

		const defaultExport = transformTemplateVars(`
			export default function App({ title }) {
				return <h1>{ $$title }</h1>;
			}
		`, {
			experimentalDollarMarkers: true,
		}, {
			sourceType: 'module',
		});

		const wrappedComponent = transformTemplateVars(`
			const App = memo(({ title }) => <h1>{ $$title }</h1>);
			module.exports = { App };
		`, {
			experimentalDollarMarkers: true,
		});

		expect(functionDeclaration.code).toContain('$$title');
		expect(functionDeclaration.code).not.toContain('getLanguageReplace');
		expect(defaultExport.code).toContain('$$title');
		expect(defaultExport.code).not.toContain('getLanguageReplace');
		expect(wrappedComponent.code).toContain('$$title');
		expect(wrappedComponent.code).not.toContain('getLanguageReplace');
	});

	it('leaves multi-declarator component candidates untouched for now', () => {
		const result = transformTemplateVars(`
			const App = ({ title }) => <h1>{ $$title }</h1>, other = 1;
			module.exports = { App };
		`, {
			experimentalDollarMarkers: true,
		});

		expect(result.code).toContain('$$title');
		expect(result.code).not.toContain('getLanguageReplace');
	});

	it('leaves markers untouched while removing flat declarations in tidyOnly mode', () => {
		const result = transformTemplateVars(`
			const App = ({ title }) => <h1>{ $$title }</h1>;
			App.templateVars = [ 'title' ];
			module.exports = { App };
		`, {
			experimentalDollarMarkers: true,
			tidyOnly: true,
		}, {
			jsx: false,
		});

		expect(result.code).toContain('$$title');
		expect(result.code).not.toContain('templateVars');
		expect(result.code).not.toContain('window.templateVarsLanguage');
	});

	it('preserves registry validation for conflicting flat and marker declarations', () => {
		expect(() => transformTemplateVars(`
			const App = ({ hero, products }) => (
				<main>
					<h1>{ $$hero.title }</h1>
					{ $$products.map((product) => <p>{ product.title }</p>) }
				</main>
			);
			App.templateVars = [ 'hero[]' ];
			module.exports = { App };
		`, {
			experimentalDollarMarkers: true,
		})).toThrow(/same root cannot be both a list and an object/);
	});

	it('throws when marker usage cannot infer any supported declarations', () => {
		expect(() => transformTemplateVars(`
			const App = () => {
				const unused = $$title;
				return <h1>Static</h1>;
			};
			module.exports = { App };
		`, {
			experimentalDollarMarkers: true,
		})).toThrow(/no supported template var declarations could be inferred/);
	});

	it('throws for markers inside unsupported nested local functions', () => {
		expect(() => transformTemplateVars(`
			const App = () => {
				const helper = () => <h1>{ $$title }</h1>;
				return helper();
			};
			module.exports = { App };
		`, {
			experimentalDollarMarkers: true,
		})).toThrow(/nested local functions are not supported/);
	});

	it('rejects invalid marker positions', () => {
		expect(() => transformTemplateVars(`
			const App = () => <h1>{ $$ }</h1>;
			module.exports = { App };
		`, { experimentalDollarMarkers: true })).toThrow(/must include an identifier/);

		expect(() => transformTemplateVars(`
			const App = ({ hero }) => <h1>{ hero.$$summary }</h1>;
			module.exports = { App };
		`, { experimentalDollarMarkers: true })).toThrow(/root identifiers/);

		expect(() => transformTemplateVars(`
			const App = ({ items }) => <h1>{ $$items[0] }</h1>;
			module.exports = { App };
		`, { experimentalDollarMarkers: true })).toThrow(/Computed marker access/);

		expect(() => transformTemplateVars(`
			const App = () => {
				const $$title = 'Title';
				return <h1>{ $$title }</h1>;
			};
			module.exports = { App };
		`, { experimentalDollarMarkers: true })).toThrow(/binding positions/);

		expect(() => transformTemplateVars(`
			const App = ($$props) => <h1>{ $$props.title }</h1>;
			module.exports = { App };
		`, { experimentalDollarMarkers: true })).toThrow(/binding positions/);

		expect(() => transformTemplateVars(`
			const App = ({ $$title }) => <h1>{ $$title }</h1>;
			module.exports = { App };
		`, { experimentalDollarMarkers: true })).toThrow(/binding positions/);

		expect(() => transformTemplateVars(`
			const App = ({ $$title: heading }) => <h1>{ heading }</h1>;
			module.exports = { App };
		`, { experimentalDollarMarkers: true })).toThrow(/binding positions/);

		expect(() => transformTemplateVars(`
			const App = ({ hero: { $$title } }) => <h1>{ $$title }</h1>;
			module.exports = { App };
		`, { experimentalDollarMarkers: true })).toThrow(/binding positions/);

		expect(() => transformTemplateVars(`
			const App = ($$title = 'Title') => <h1>{ $$title }</h1>;
			module.exports = { App };
		`, { experimentalDollarMarkers: true })).toThrow(/binding positions/);

		expect(() => transformTemplateVars(`
			const App = (...$$props) => <h1>{ $$props.title }</h1>;
			module.exports = { App };
		`, { experimentalDollarMarkers: true })).toThrow(/binding positions/);

		expect(() => transformTemplateVars(`
			import $$title from './title';
			const App = () => <h1>{ $$title }</h1>;
			export { App };
		`, { experimentalDollarMarkers: true }, { sourceType: 'module' })).toThrow(/marker-named bindings/);
	});

	it.todo('does not infer direct primitive root lists from { $$tags }');
	it.todo('keeps shape-only declarations on flat templateVars until marker syntax has an explicit shape form');
	it.todo('does not infer alias/destructure chains that have no marked source origin');
});
