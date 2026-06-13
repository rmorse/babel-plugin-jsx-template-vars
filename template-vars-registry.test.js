import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import babel from '@babel/core';

const require = createRequire(import.meta.url);
const {
	createTemplateVarsRegistry,
	parseTemplateVarPath,
} = require('./template-vars-registry');

function buildRegistry(templateVars, source) {
	let controllerInputs;

	const plugin = () => ({
		visitor: {
			VariableDeclaration(path) {
				const declaration = path.node.declarations[0];
				if (declaration?.id?.name !== 'App') {
					return;
				}
				controllerInputs = createTemplateVarsRegistry(templateVars, path, babel, path);
				path.stop();
			},
		},
	});

	babel.transformSync(source, {
		babelrc: false,
		configFile: false,
		parserOpts: {
			plugins: [ 'jsx' ],
		},
		plugins: [ plugin ],
	});

	return controllerInputs;
}

describe('template vars registry', () => {
	it('parses scalar, object, and one-level list paths', () => {
		expect(parseTemplateVarPath('title')).toMatchObject({
			segments: [ 'title' ],
			isList: false,
		});
		expect(parseTemplateVarPath('hero.media.url')).toMatchObject({
			segments: [ 'hero', 'media', 'url' ],
			isList: false,
		});
		expect(parseTemplateVarPath('products[].title')).toMatchObject({
			segments: [ 'products', 'title' ],
			isList: true,
			rootName: 'products',
			childSegments: [ 'title' ],
		});
	});

	it('rejects malformed and deferred paths', () => {
		expect(() => parseTemplateVarPath('hero..title')).toThrow(/cannot be empty/);
		expect(() => parseTemplateVarPath('products[].badges[].label')).toThrow(/Deep nested list paths are deferred/);
		expect(() => parseTemplateVarPath('products[].meta.title')).toThrow(/one child property/);
	});

	it('rejects legacy array or object declaration entries', () => {
		expect(() => buildRegistry([
			[ 'visible', { type: 'control' } ],
		], `
			const App = ({ visible }) => {
				return <main>{ visible && <p>Visible</p> }</main>;
			};
		`)).toThrow(/only supports flat string paths/);

		expect(() => buildRegistry([
			{ name: 'visible' },
		], `
			const App = ({ visible }) => {
				return <main>{ visible && <p>Visible</p> }</main>;
			};
		`)).toThrow(/only supports flat string paths/);
	});

	it('derives multi-role controller inputs from flat declarations and supported usage', () => {
		const result = buildRegistry([
			'title',
			'hero.summary',
			'status',
			'visible',
			'products[].label',
			'products[].url',
		], `
			const App = ({ title, hero, status, visible, products }) => {
				const renderedProducts = products.map((product) => (
					<a href={ product.url }>{ product.label }</a>
				));
				return (
					<main>
						<h1>{ title }</h1>
						<p>{ hero.summary }</p>
						{ status === 'published' && <aside>{ status }</aside> }
						{ visible && <section>{ renderedProducts }</section> }
					</main>
				);
			};
		`);

		expect(result.replace).toEqual([
			[ 'title', { segments: [ 'title' ] } ],
			[ 'hero.summary', { segments: [ 'hero', 'summary' ] } ],
			[ 'status', { segments: [ 'status' ] } ],
			[ 'visible', { segments: [ 'visible' ] } ],
		]);
		expect(result.control).toEqual([
			[ 'status', { segments: [ 'status' ] } ],
			[ 'visible', { segments: [ 'visible' ] } ],
		]);
		expect(result.list).toEqual([
			[
				'products',
				{
					kind: 'list',
					item: {
						kind: 'object',
						properties: [ 'label', 'url' ],
					},
					tagAliases: [ 'renderedProducts' ],
				},
			],
		]);
	});
});
