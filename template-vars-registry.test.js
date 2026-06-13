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
	it('parses scalar, object, and recursive list paths', () => {
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
		expect(parseTemplateVarPath('products[].badges[].label')).toMatchObject({
			segments: [ 'products', 'badges', 'label' ],
			isList: true,
			rootName: 'products',
			hasList: true,
			listDepth: 2,
		});
	});

	it('rejects malformed paths', () => {
		expect(() => parseTemplateVarPath('hero..title')).toThrow(/cannot be empty/);
		expect(() => parseTemplateVarPath('products[0].label')).toThrow(/List markers must use/);
		expect(() => parseTemplateVarPath('products[].bad-name')).toThrow(/not a supported identifier/);
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
					name: 'products',
					kind: 'list',
					path: 'products[]',
					sourceKey: 'products',
					sourceSegments: [ 'products' ],
					parentContextDepth: 0,
					itemContextDepth: 1,
					item: {
						kind: 'object',
						properties: [
							{
								name: 'label',
								kind: 'scalar',
								segments: [ 'label' ],
								contextDepth: 1,
							},
							{
								name: 'url',
								kind: 'scalar',
								segments: [ 'url' ],
								contextDepth: 1,
							},
						],
					},
					tagAliases: [ 'renderedProducts' ],
				},
			],
		]);
	});

	it('derives recursive object/list metadata for nested declarations', () => {
		const result = buildRegistry([
			'catalog.title',
			'catalog.sections[].heading',
			'catalog.sections[].products[].details.sku',
			'catalog.sections[].products[].badges[].label',
		], `
			const App = ({ catalog }) => {
				return (
					<main>
						<h1>{ catalog.title }</h1>
						{ catalog.sections.map((section) => (
							<section>
								<h2>{ section.heading }</h2>
								{ section.products.map((product) => (
									<article data-sku={ product.details.sku }>
										{ product.badges.map((badge) => <span>{ badge.label }</span>) }
									</article>
								)) }
							</section>
						)) }
					</main>
				);
			};
		`);

		expect(result.listMetadata).toEqual([
			expect.objectContaining({
				path: 'catalog.sections[]',
				sourceSegments: [ 'catalog', 'sections' ],
				parentContextDepth: 0,
				itemContextDepth: 1,
			}),
			expect.objectContaining({
				path: 'catalog.sections[].products[]',
				sourceSegments: [ 'products' ],
				parentContextDepth: 1,
				itemContextDepth: 2,
			}),
			expect.objectContaining({
				path: 'catalog.sections[].products[].badges[]',
				sourceSegments: [ 'badges' ],
				parentContextDepth: 2,
				itemContextDepth: 3,
			}),
		]);
		expect(result.scalarMetadata).toContainEqual({
			path: 'catalog.sections[].products[].badges[].label',
			segments: [ 'label' ],
			contextDepth: 3,
		});
	});
});
