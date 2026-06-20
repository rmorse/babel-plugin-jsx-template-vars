import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crossFileSelectors from './store-selector-cross-file.js';
import {
	e2eFixturesDir,
	normalizeTemplateOutput,
	renderTemplateFixture,
	renderTemplateModules,
	transformTemplateVars,
} from './test-utils/transform.js';

const { createStoreSelectorCrossFileManifest } = crossFileSelectors;

const selectorOptions = {
	experimentalStoreSelectors: true,
};

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expectNoOrphanedTemplateReplacements(code, rawAccesses = []) {
	rawAccesses.forEach((rawAccess) => {
		expect(code).not.toContain(rawAccess);
	});

	const declarations = Array.from(code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]*getLanguage(?:Replace|List)/g));
	expect(declarations.length).toBeGreaterThan(0);

	declarations.forEach((match) => {
		const variableName = match[1];
		const usages = code.match(new RegExp(`\\b${ escapeRegExp(variableName) }\\b`, 'g')) || [];
		expect(usages.length).toBeGreaterThan(1);
	});
}

function crossFileFixtureFiles(sources) {
	const root = path.join(process.cwd(), '__cross_file_store_selector_tests__');
	return Object.fromEntries(Object.entries(sources).map(([ filename, source ]) => [
		path.join(root, filename),
		source,
	]));
}

function createCrossFileOptions(manifest) {
	return {
		experimentalStoreSelectors: {
			crossFile: true,
			__crossFileManifest: manifest,
		},
		warnOnUnsupported: false,
	};
}

function readE2eFixture(fixtureName, fileName) {
	return fs.readFileSync(path.join(e2eFixturesDir, fixtureName, fileName), 'utf8');
}

describe('experimental store selectors', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('renders selector-only renamed scalar bindings through canonical paths', async () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				const title = useStoreSelector((state) => state.hero.title);
				return <h1>{ title }</h1>;
			};

			module.exports = { App };
		`;

		const { code, output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(code).not.toContain('useStoreSelector');
		expect(normalizeTemplateOutput(output)).toBe('<h1>{{hero.title}}</h1>');
	});

	it('discovers list fields from map body children and JSX prop values', async () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				const items = useStoreSelector((state) => state.products);
				return (
					<ul>
						{ items.map((item) => (
							<li data-name={ item.name }>{ item.title }</li>
						)) }
					</ul>
				);
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<ul>{{#products}}<li data-name="{{name}}">{{title}}</li>{{/products}}</ul>');
	});

	it('supports safe chained list calls before map', async () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				const products = useStoreSelector((state) => state.products);
				return (
					<ul>
						{ products.filter((product) => product.available).slice(0, 3).map((product) => (
							<li>{ product.title }</li>
						)) }
					</ul>
				);
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<ul>{{#products}}<li>{{title}}</li>{{/products}}</ul>');
	});

	it('supports aliases of safe chained list calls before map', async () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				const products = useStoreSelector((state) => state.products);
				const visibleProducts = products.filter((product) => product.available);
				return (
					<ul>
						{ visibleProducts.map((product) => (
							<li>{ product.title }</li>
						)) }
					</ul>
				);
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<ul>{{#products}}<li>{{title}}</li>{{/products}}</ul>');
	});

	it('discovers nested list paths from nested map bodies', async () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				const sections = useStoreSelector((state) => state.catalog.sections);
				return (
					<main>
						{ sections.map((section) => (
							<section>
								<h2>{ section.heading }</h2>
								<ul>
									{ section.items.map((item) => (
										<li>{ item.label }</li>
									)) }
								</ul>
							</section>
						)) }
					</main>
				);
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<main>{{#catalog.sections}}<section><h2>{{heading}}</h2><ul>{{#items}}<li>{{label}}</li>{{/items}}</ul></section>{{/catalog.sections}}</main>');
	});

	it('supports nested safe chained list calls before map', async () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				const sections = useStoreSelector((state) => state.catalog.sections);
				return (
					<main>
						{ sections.filter((section) => section.visible).map((section) => (
							<section>
								<h2>{ section.heading }</h2>
								<ul>
									{ section.items.filter((item) => item.visible).map((item) => (
										<li>{ item.label }</li>
									)) }
								</ul>
							</section>
						)) }
					</main>
				);
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<main>{{#catalog.sections}}<section><h2>{{heading}}</h2><ul>{{#items}}<li>{{label}}</li>{{/items}}</ul></section>{{/catalog.sections}}</main>');
	});

	it('supports aliases of nested safe chained list calls inside map callbacks', async () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				const sections = useStoreSelector((state) => state.catalog.sections);
				return (
					<main>
						{ sections.map((section) => {
							const visibleItems = section.items.filter((item) => item.visible);
							return (
								<section>
									<h2>{ section.heading }</h2>
									<ul>
										{ visibleItems.map((item) => (
											<li>{ item.label }</li>
										)) }
									</ul>
								</section>
							);
						}) }
					</main>
				);
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<main>{{#catalog.sections}}<section><h2>{{heading}}</h2><ul>{{#items}}<li>{{label}}</li>{{/items}}</ul></section>{{/catalog.sections}}</main>');
	});

	it('supports function selectors, destructuring, and assignment aliases', async () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				const hero = useStoreSelector(function (state) {
					return state.hero;
				});
				const { title } = hero;
				let heading;
				heading = title;
				return <h1>{ heading }</h1>;
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<h1>{{hero.title}}</h1>');
	});

	it('synthesizes object selector member declarations from usage only', async () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				const hero = useStoreSelector((state) => state.hero);
				return <h1>{ hero.title }</h1>;
			};

			module.exports = { App };
		`;

		const { code, output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<h1>{{hero.title}}</h1>');
		expect(code).toContain('value: "hero.title"');
		expect(code).not.toContain('value: "hero",');
	});

	it('supports primitive lists discovered from map item identifiers', async () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				const tags = useStoreSelector((state) => state.tags);
				return (
					<p>
						{ tags.map((tag) => (
							<span>{ tag }</span>
						)) }
					</p>
				);
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<p>{{#tags}}<span>{{.}}</span>{{/tags}}</p>');
	});

	it('processes multiple selector components independently', async () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = () => {
				const title = useStoreSelector((state) => state.hero.title);
				return <h1>{ title }</h1>;
			};

			const Footer = () => {
				const title = useStoreSelector((state) => state.footer.title);
				return <footer>{ title }</footer>;
			};

			const App = () => {
				return (
					<main>
						<Header />
						<Footer />
					</main>
				);
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<main><h1>{{hero.title}}</h1><footer>{{footer.title}}</footer></main>');
	});

	it('infers control roles through renamed selector bindings', async () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				const status = useStoreSelector((state) => state.article.status);
				return (
					<main>
						{ status === 'published' && <aside>{ status }</aside> }
					</main>
				);
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe("<main>{{#if_equal article.status 'published'}}<aside>{{article.status}}</aside>{{/if_equal}}</main>");
	});

	it('infers nested member control roles through object selector bindings', async () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				const hero = useStoreSelector((state) => state.hero);
				return (
					<main>
						{ hero.status === 'featured' && <aside>{ hero.title }</aside> }
					</main>
				);
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe("<main>{{#if_equal hero.status 'featured'}}<aside>{{hero.title}}</aside>{{/if_equal}}</main>");
	});

	it('merges flat shape hints with selector-discovered list fields', async () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				const products = useStoreSelector((state) => state.products);
				return (
					<ul>
						{ products.map((product) => (
							<li>{ product.title } { product.price }</li>
						)) }
					</ul>
				);
			};

			App.templateVars = [
				'products[].price',
			];

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<ul>{{#products}}<li>{{title}} {{price}}</li>{{/products}}</ul>');
	});

	it('treats direct rendering of selected arrays as replacement usage without list proof', async () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				const products = useStoreSelector((state) => state.products);
				return <p>{ products }</p>;
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<p>{{products}}</p>');
	});

	it('exposes selector synthesis debug metadata when requested', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Card = ({ name }) => {
				return <article>{ name }</article>;
			};

			Card.templateVars = [ 'name' ];

			const App = () => {
				const title = useStoreSelector((state) => state.title);
				const products = useStoreSelector((state) => state.products);
				return (
					<main>
						<h1>{ title }</h1>
						{ products.map((product) => (
							<Card name={ product.name } />
						)) }
					</main>
				);
			};

			module.exports = { App };
		`;

		const result = transformTemplateVars(source, {
			language: 'handlebars',
			experimentalStoreSelectors: {
				debug: true,
			},
		});
		const debug = result.metadata.storeSelectorTemplateVars.find( entry => entry.componentName === 'App' );
		const childDebug = result.metadata.storeSelectorTemplateVars.find( entry => entry.componentName === 'Card' );

		expect(debug.componentName).toBe('App');
		expect(debug.declarations).toEqual([ 'products[]', 'title' ]);
		expect(debug.listShapes).toEqual([ 'products[]' ]);
		expect(debug.aliases).toEqual(expect.arrayContaining([
			expect.objectContaining({ localName: 'title', path: 'title' }),
			expect.objectContaining({ localName: 'products', path: 'products' }),
			expect.objectContaining({ localName: 'product', path: 'products[]' }),
		]));
		expect(debug.declarationProvenance).toEqual(expect.arrayContaining([
			expect.objectContaining({ declaration: 'title', kind: 'usage', sourcePath: 'title' }),
			expect.objectContaining({ declaration: 'products[]', kind: 'map-list-shape', sourcePath: 'products' }),
		]));
		expect(debug.unsupported).toEqual([]);
		expect(childDebug.aliases).toEqual(expect.arrayContaining([
			expect.objectContaining({ localName: 'name', path: 'products[].name', declarationPath: 'name' }),
		]));
		expect(childDebug.declarationProvenance).toEqual(expect.arrayContaining([
			expect.objectContaining({ declaration: 'name', kind: 'usage', sourcePath: 'products[].name' }),
		]));
		expect(warn).not.toHaveBeenCalled();
	});

	it('can seed child-body discovery from an incoming object alias without selector calls', async () => {
		const source = `
			const Header = ({ hero }) => {
				const heading = hero.title;
				return <h1>{ heading }</h1>;
			};

			module.exports = { Header };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'Header', {}, {
			experimentalStoreSelectors: {
				__seedAliasesByComponent: {
					Header: [
						{
							localName: 'hero',
							segments: [ 'hero' ],
						},
					],
				},
			},
		});

		expect(normalizeTemplateOutput(output)).toBe('<h1>{{hero.title}}</h1>');
	});

	it('can seed list-relative discovery without creating a duplicate list wrapper', async () => {
		const source = `
			const ProductCard = ({ product }) => {
				return <article>{ product.name }</article>;
			};

			module.exports = { ProductCard };
		`;

		const options = {
			language: 'handlebars',
			experimentalStoreSelectors: {
				debug: true,
				__seedAliasesByComponent: {
					ProductCard: [
						{
							localName: 'product',
							segments: [ 'products[]' ],
							declarationSegments: [],
						},
					],
				},
			},
		};
		const result = transformTemplateVars(source, options);
		const { output } = await renderTemplateFixture('handlebars', source, 'ProductCard', {
			product: {
				name: 'Runtime name',
			},
		}, options);
		const [ debug ] = result.metadata.storeSelectorTemplateVars;

		expect(debug.declarations).toEqual([ 'name' ]);
		expect(debug.listShapes).toEqual([]);
		expect(debug.declarationProvenance).toEqual([
			expect.objectContaining({ declaration: 'name', kind: 'usage', sourcePath: 'products[].name' }),
		]);
		expect(result.code).not.toContain('{{#products}}');
		expectNoOrphanedTemplateReplacements(result.code, [ 'product.name' ]);
		expect(normalizeTemplateOutput(output)).toBe('<article>{{name}}</article>');
	});

	it('records props-object member aliases in selector debug metadata', () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = (whatever) => {
				return <h1>{ whatever.item.title }</h1>;
			};

			const App = () => {
				const anything = useStoreSelector((state) => state.hero);
				return <Header item={ anything } />;
			};

			module.exports = { App };
		`;

		const result = transformTemplateVars(source, {
			language: 'handlebars',
			experimentalStoreSelectors: {
				debug: true,
			},
		});
		const childDebug = result.metadata.storeSelectorTemplateVars.find( entry => entry.componentName === 'Header' );

		expect(childDebug.aliases).toEqual(expect.arrayContaining([
			expect.objectContaining({
				localName: 'whatever',
				memberName: 'item',
				path: 'hero',
				declarationPath: 'hero',
				source: 'seed',
			}),
		]));
		expect(childDebug.declarationProvenance).toEqual(expect.arrayContaining([
			expect.objectContaining({ declaration: 'hero.title', kind: 'usage', sourcePath: 'hero.title' }),
		]));
	});

	it('records dynamic root debug metadata when requested', () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ({ hero }) => {
				return <h1>{ hero.title }</h1>;
			};

			const App = () => {
				const homeHero = useStoreSelector((state) => state.home.hero);
				const articleHero = useStoreSelector((state) => state.article.hero);
				return (
					<main>
						<Header hero={ homeHero } />
						<Header hero={ articleHero } />
					</main>
				);
			};

			module.exports = { App };
		`;

		const result = transformTemplateVars(source, {
			language: 'handlebars',
			experimentalStoreSelectors: {
				debug: true,
			},
		});
		const childDebug = result.metadata.storeSelectorTemplateVars.find( entry => entry.componentName === 'Header' );

		expect(childDebug.dynamicRootProps).toEqual([ 'hero' ]);
		expect(childDebug.dynamicRootPropsByComponent).toEqual({
			Header: [ 'hero' ],
		});
		expect(childDebug.dynamicRootAliases).toEqual([
			expect.objectContaining({
				localName: 'hero',
				propName: 'hero',
				path: 'hero',
				declarationPath: 'hero',
				dynamicRootPath: 'hero',
			}),
		]);
	});

	it.each([
		[
			'handlebars',
			'<main>{{#products}}<article>{{name}}</article>{{/products}}</main>',
		],
		[
			'php',
			"<main><?php foreach ( $data['products'] as $data_1 ) { ?><article><?php echo $data_1['name']; ?></article><?php } ?></main>",
		],
	])('auto-seeds list-relative children through parent list context for %s', async (language, expected) => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const ProductCard = ({ product }) => <article>{ product.name }</article>;

			const App = () => {
				const products = useStoreSelector((state) => state.products);
				return (
					<main>
						{ products.map((product) => (
							<ProductCard product={ product } />
						)) }
					</main>
				);
			};

			module.exports = { App };
		`;
		const options = {
			experimentalStoreSelectors: true,
			warnOnUnsupported: false,
		};
		const { code, output } = await renderTemplateFixture(language, source, 'App', {}, options);

		expectNoOrphanedTemplateReplacements(code, [ 'product.name' ]);
		expect(normalizeTemplateOutput(output)).toBe(expected);
	});

	it.each([
		[
			'handlebars',
			'<main>{{#products}}<article><ul>{{#badges}}<li>{{label}}</li>{{/badges}}</ul></article>{{/products}}</main>',
		],
		[
			'php',
			"<main><?php foreach ( $data['products'] as $data_1 ) { ?><article><ul><?php foreach ( $data_1['badges'] as $data_2 ) { ?><li><?php echo $data_2['label']; ?></li><?php } ?></ul></article><?php } ?></main>",
		],
	])('auto-seeds nested list-relative children through parent list context for %s', async (language, expected) => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const ProductCard = ({ product }) => (
				<article>
					<ul>
						{ product.badges.map((badge) => (
							<li>{ badge.label }</li>
						)) }
					</ul>
				</article>
			);

			const App = () => {
				const products = useStoreSelector((state) => state.products);
				return (
					<main>
						{ products.map((product) => (
							<ProductCard product={ product } />
						)) }
					</main>
				);
			};

			module.exports = { App };
		`;
		const options = {
			experimentalStoreSelectors: true,
			warnOnUnsupported: false,
		};
		const { code, output } = await renderTemplateFixture(language, source, 'App', {}, options);

		expectNoOrphanedTemplateReplacements(code, [ 'product.badges' ]);
		expect(normalizeTemplateOutput(output)).toBe(expected);
	});

	it.each([
		[
			'handlebars',
			'<main>{{#products}}<article><span>{{name}}</span></article>{{/products}}</main>',
		],
		[
			'php',
			"<main><?php foreach ( $data['products'] as $data_1 ) { ?><article><span><?php echo $data_1['name']; ?></span></article><?php } ?></main>",
		],
	])('auto-seeds list item props through forwarding intermediates for %s', async (language, expected) => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Inner = ({ product }) => <span>{ product.name }</span>;

			const ProductCard = ({ product }) => (
				<article>
					<Inner product={ product } />
				</article>
			);

			const App = () => {
				const products = useStoreSelector((state) => state.products);
				return (
					<main>
						{ products.map((product) => (
							<ProductCard product={ product } />
						)) }
					</main>
				);
			};

			module.exports = { App };
		`;
		const { code, output } = await renderTemplateFixture(language, source, 'App', {}, {
			experimentalStoreSelectors: true,
			warnOnUnsupported: false,
		});

		expectNoOrphanedTemplateReplacements(code, [ 'product.name' ]);
		expect(normalizeTemplateOutput(output)).toBe(expected);
	});

	it.each([
		[
			'handlebars',
			'<main>{{#products}}<article>{{#badges}}<span data-tone="{{tone}}">{{label}}</span>{{/badges}}</article>{{/products}}</main>',
		],
		[
			'php',
			"<main><?php foreach ( $data['products'] as $data_1 ) { ?><article><?php foreach ( $data_1['badges'] as $data_2 ) { ?><span data-tone=\"<?php echo $data_2['tone']; ?>\"><?php echo $data_2['label']; ?></span><?php } ?></article><?php } ?></main>",
		],
	])('auto-seeds object-field list props through focused multi-hop components for %s', async (language, expected) => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Badge = ({ badge }) => <span data-tone={ badge.tone }>{ badge.label }</span>;

			const ProductCard = ({ badges }) => (
				<article>
					{ badges.map((badge) => (
						<Badge badge={ badge } />
					)) }
				</article>
			);

			const App = () => {
				const products = useStoreSelector((state) => state.products);
				return (
					<main>
						{ products.map((product) => (
							<ProductCard badges={ product.badges } />
						)) }
					</main>
				);
			};

			module.exports = { App };
		`;
		const { code, output } = await renderTemplateFixture(language, source, 'App', {}, selectorOptions);

		expectNoOrphanedTemplateReplacements(code, [ 'badge.label', 'badge.tone' ]);
		expect(normalizeTemplateOutput(output)).toBe(expected);
		expect(warn).not.toHaveBeenCalled();
	});

	it('builds a cross-file manifest for direct relative named imports', async () => {
		const files = crossFileFixtureFiles({
			'Header.jsx': `
				export const Header = ({ hero }) => <h1>{ hero.title }</h1>;
			`,
			'App.jsx': `
				import { Header } from './Header.jsx';
				import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

				const App = () => {
					const hero = useStoreSelector((state) => state.hero);
					return <main><Header hero={ hero } /></main>;
				};

				module.exports = { App };
			`,
		});
		const manifest = createStoreSelectorCrossFileManifest(files);
		const options = createCrossFileOptions(manifest);

		const { output, codeByFile } = await renderTemplateModules(
			'handlebars',
			files,
			path.join(process.cwd(), '__cross_file_store_selector_tests__', 'App.jsx'),
			'App',
			{},
			options
		);

		expect(manifest.diagnostics).toEqual([]);
		expect(manifest.debug.importEdges).toEqual([
			expect.objectContaining({
				sourceFilename: path.join(process.cwd(), '__cross_file_store_selector_tests__', 'App.jsx'),
				localName: 'Header',
				importedName: 'Header',
				targetFilename: path.join(process.cwd(), '__cross_file_store_selector_tests__', 'Header.jsx'),
				targetComponentName: 'Header',
			}),
		]);
		expect(manifest.debug.seedEdges).toEqual([
			expect.objectContaining({
				sourceFilename: path.join(process.cwd(), '__cross_file_store_selector_tests__', 'App.jsx'),
				sourceComponentName: 'App',
				sourceChildComponentName: 'Header',
				targetFilename: path.join(process.cwd(), '__cross_file_store_selector_tests__', 'Header.jsx'),
				targetComponentName: 'Header',
				localName: 'hero',
				sourcePath: 'hero',
				declarationPath: 'hero',
			}),
		]);
		expect(manifest.seedAliasesByFile[path.join(process.cwd(), '__cross_file_store_selector_tests__', 'Header.jsx')].Header).toEqual([
			expect.objectContaining({
				localName: 'hero',
				segments: [ 'hero' ],
				declarationSegments: [ 'hero' ],
			}),
		]);
		expect(Object.values(codeByFile).join('\n')).not.toContain('useStoreSelector');
		expect(normalizeTemplateOutput(output)).toBe('<main><h1>{{hero.title}}</h1></main>');
	});

	it('does not consume a cross-file manifest unless crossFile is enabled', async () => {
		const files = crossFileFixtureFiles({
			'Header.jsx': `
				export const Header = ({ hero }) => <h1>{ hero.title }</h1>;
			`,
			'App.jsx': `
				import { Header } from './Header.jsx';
				import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

				const App = () => {
					const hero = useStoreSelector((state) => state.hero);
					return <main><Header hero={ hero } /></main>;
				};

				module.exports = { App };
			`,
		});
		const manifest = createStoreSelectorCrossFileManifest(files);

		const { output } = await renderTemplateModules(
			'handlebars',
			files,
			path.join(process.cwd(), '__cross_file_store_selector_tests__', 'App.jsx'),
			'App',
			{},
			{
				experimentalStoreSelectors: {
					__crossFileManifest: manifest,
				},
				warnOnUnsupported: false,
			}
		);

		expect(manifest.seedAliasesByFile[path.join(process.cwd(), '__cross_file_store_selector_tests__', 'Header.jsx')].Header).toHaveLength(1);
		expect(normalizeTemplateOutput(output)).toBe('<main><h1></h1></main>');
	});

	it.each([
		[
			'handlebars',
			'<main>{{#products}}<article><h2>{{name}}</h2>{{#badges}}<span>{{label}}</span>{{/badges}}</article>{{/products}}</main>',
		],
		[
			'php',
			"<main><?php foreach ( $data['products'] as $data_1 ) { ?><article><h2><?php echo $data_1['name']; ?></h2><?php foreach ( $data_1['badges'] as $data_2 ) { ?><span><?php echo $data_2['label']; ?></span><?php } ?></article><?php } ?></main>",
		],
	])('traces cross-file list item and nested list props for %s', async (language, expected) => {
		const root = path.join(process.cwd(), '__cross_file_store_selector_tests__');
		const files = crossFileFixtureFiles({
			'Badge.jsx': `
				export const Badge = ({ badge }) => <span>{ badge.label }</span>;
			`,
			'ProductCard.jsx': `
				import { Badge } from './Badge.jsx';

				export const ProductCard = ({ product }) => (
					<article>
						<h2>{ product.name }</h2>
						{ product.badges.map((badge) => (
							<Badge badge={ badge } />
						)) }
					</article>
				);
			`,
			'App.jsx': `
				import { ProductCard } from './ProductCard.jsx';
				import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

				const App = () => {
					const products = useStoreSelector((state) => state.products);
					return (
						<main>
							{ products.map((product) => (
								<ProductCard product={ product } />
							)) }
						</main>
					);
				};

				module.exports = { App };
			`,
		});
		const manifest = createStoreSelectorCrossFileManifest(files);
		const options = createCrossFileOptions(manifest);

		const { codeByFile, output } = await renderTemplateModules(
			language,
			files,
			path.join(root, 'App.jsx'),
			'App',
			{},
			options
		);
		const combinedCode = Object.values(codeByFile).join('\n');

		expect(manifest.diagnostics).toEqual([]);
		expectNoOrphanedTemplateReplacements(combinedCode, [ 'product.name', 'product.badges', 'badge.label' ]);
		expect(normalizeTemplateOutput(output)).toBe(expected);
	});

	it.each([ 'handlebars', 'php' ])('byte-matches full template surface across files for %s', async (language) => {
		const root = path.join(process.cwd(), '__cross_file_store_selector_tests__', 'full-surface');
		const files = crossFileFixtureFiles({
			'full-surface/Badge.jsx': `
				export const Badge = ({ label, tone }) => {
					return (
						<span className="badge" data-tone={ tone }>
							{ label }
						</span>
					);
				};
			`,
			'full-surface/ProductCard.jsx': `
				import { Badge } from './Badge.jsx';

				export const ProductCard = ({ name, price, url, badges, available, featured, mode, status, tone }) => {
					const renderedBadges = badges.map((badge) => (
						<Badge label={ badge.label } tone={ badge.tone } />
					));

					return (
						<article className="product-card">
							<a href={ url }>
								<h2>{ name }</h2>
							</a>
							<input type="hidden" value={ name } />
							{ available && <p className="price">{ price }</p> }
							{ !available && <p className="unavailable">Unavailable</p> }
							{ mode === 'grid' && <div className="grid-only">Grid layout</div> }
							{ status !== 'archived' && <small>Visible product</small> }
							{ featured ? <strong>Featured</strong> : <span>Standard</span> }
							{ tone === 'sale' ? <em>Sale</em> : <em>Info</em> }
							<div className="badges">{ renderedBadges }</div>
						</article>
					);
				};
			`,
			'full-surface/App.jsx': `
				import { ProductCard } from './ProductCard.jsx';
				import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

				const App = () => {
					const title = useStoreSelector((state) => state.title);
					const summary = useStoreSelector((state) => state.summary);
					const products = useStoreSelector((state) => state.products);
					const status = useStoreSelector((state) => state.status);
					const visible = useStoreSelector((state) => state.visible);
					const renderedProducts = products.map((product) => (
						<ProductCard
							name={ product.name }
							price={ product.price }
							url={ product.url }
							badges={ product.badges }
							available={ product.available }
							featured={ product.featured }
							mode={ product.mode }
							status={ product.status }
							tone={ product.tone }
						/>
					));

					return (
						<main>
							<header>
								<h1>{ title }</h1>
								<p>{ summary }</p>
							</header>
							{ status === 'published' && <aside>Published</aside> }
							{ visible && <section className="catalog">{ renderedProducts }</section> }
						</main>
					);
				};

				module.exports = { App };
			`,
		});
		const manifest = createStoreSelectorCrossFileManifest(files);
		const options = createCrossFileOptions(manifest);
		const expected = readE2eFixture('full-template-surface', `expected.${ language }.html`);

		const { codeByFile, output } = await renderTemplateModules(
			language,
			files,
			path.join(root, 'App.jsx'),
			'App',
			{},
			options
		);
		const combinedCode = Object.values(codeByFile).join('\n');

		expect(manifest.diagnostics).toEqual([]);
		expect(combinedCode).not.toContain('useStoreSelector');
		expect(combinedCode).not.toContain('$$');
		expectNoOrphanedTemplateReplacements(combinedCode);
		expect(normalizeTemplateOutput(output)).toBe(normalizeTemplateOutput(expected));
	});

	it('reports unresolved cross-file imports without inventing component seeds', () => {
		const files = crossFileFixtureFiles({
			'App.jsx': `
				import { Header } from './Missing.jsx';
				import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

				const App = () => {
					const hero = useStoreSelector((state) => state.hero);
					return <Header hero={ hero } />;
				};

				module.exports = { App };
			`,
		});

		const manifest = createStoreSelectorCrossFileManifest(files);

		expect(manifest.diagnostics).toEqual([
			expect.objectContaining({
				kind: 'unresolved-import',
				source: './Missing.jsx',
				localName: 'Header',
			}),
		]);
		expect(manifest.componentNamesByFile).toEqual({});
		expect(manifest.seedAliasesByFile).toEqual({});
	});

	it('does not trace non-relative cross-file imports', () => {
		const files = crossFileFixtureFiles({
			'App.jsx': `
				import { Header } from '@components/Header';
				import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

				const App = () => {
					const hero = useStoreSelector((state) => state.hero);
					return <Header hero={ hero } />;
				};

				module.exports = { App };
			`,
		});

		const manifest = createStoreSelectorCrossFileManifest(files);

		expect(manifest.diagnostics).toEqual([
			expect.objectContaining({
				kind: 'unsupported-import-source',
				source: '@components/Header',
				localName: 'Header',
			}),
		]);
		expect(manifest.componentNamesByFile).toEqual({});
		expect(manifest.seedAliasesByFile).toEqual({});
	});

	it('does not trace default cross-file imports', () => {
		const files = crossFileFixtureFiles({
			'Header.jsx': `
				export const Header = ({ hero }) => <h1>{ hero.title }</h1>;
			`,
			'App.jsx': `
				import Header from './Header.jsx';
				import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

				const App = () => {
					const hero = useStoreSelector((state) => state.hero);
					return <Header hero={ hero } />;
				};

				module.exports = { App };
			`,
		});

		const manifest = createStoreSelectorCrossFileManifest(files);

		expect(manifest.diagnostics).toEqual([
			expect.objectContaining({
				kind: 'unsupported-default-import',
				source: './Header.jsx',
				localName: 'Header',
				importedName: 'default',
			}),
		]);
		expect(manifest.debug.skippedImports).toEqual([
			expect.objectContaining({
				kind: 'unsupported-default-import',
				source: './Header.jsx',
				localName: 'Header',
				importedName: 'default',
			}),
		]);
		expect(manifest.componentNamesByFile).toEqual({});
		expect(manifest.seedAliasesByFile).toEqual({});
	});

	it('does not trace namespace cross-file imports', () => {
		const files = crossFileFixtureFiles({
			'Cards.jsx': `
				export const Header = ({ hero }) => <h1>{ hero.title }</h1>;
			`,
			'App.jsx': `
				import * as Cards from './Cards.jsx';
				import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

				const App = () => {
					const hero = useStoreSelector((state) => state.hero);
					return <Cards.Header hero={ hero } />;
				};

				module.exports = { App };
			`,
		});

		const manifest = createStoreSelectorCrossFileManifest(files);

		expect(manifest.diagnostics).toEqual([
			expect.objectContaining({
				kind: 'unsupported-namespace-import',
				source: './Cards.jsx',
				localName: 'Cards',
				importedName: '*',
			}),
		]);
		expect(manifest.componentNamesByFile).toEqual({});
		expect(manifest.seedAliasesByFile).toEqual({});
	});

	it('reports re-export barrels as unsupported cross-file targets', () => {
		const files = crossFileFixtureFiles({
			'Header.jsx': `
				export const Header = ({ hero }) => <h1>{ hero.title }</h1>;
			`,
			'index.jsx': `
				export { Header } from './Header.jsx';
			`,
			'App.jsx': `
				import { Header } from './index.jsx';
				import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

				const App = () => {
					const hero = useStoreSelector((state) => state.hero);
					return <Header hero={ hero } />;
				};

				module.exports = { App };
			`,
		});

		const manifest = createStoreSelectorCrossFileManifest(files);

		expect(manifest.diagnostics).toEqual([
			expect.objectContaining({
				kind: 'unsupported-reexport',
				source: './index.jsx',
				localName: 'Header',
				importedName: 'Header',
			}),
		]);
		expect(manifest.componentNamesByFile).toEqual({});
		expect(manifest.seedAliasesByFile).toEqual({});
	});

	it('records parser failures as manifest diagnostics without throwing', () => {
		const files = crossFileFixtureFiles({
			'Header.jsx': `
				export const Header = ({ hero }) => <h1>{ hero.title }</h1
			`,
			'App.jsx': `
				import { Header } from './Header.jsx';
				import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

				const App = () => {
					const hero = useStoreSelector((state) => state.hero);
					return <Header hero={ hero } />;
				};

				module.exports = { App };
			`,
		});

		const manifest = createStoreSelectorCrossFileManifest(files);

		expect(manifest.diagnostics).toEqual(expect.arrayContaining([
			expect.objectContaining({
				kind: 'parse-error',
				filename: path.join(process.cwd(), '__cross_file_store_selector_tests__', 'Header.jsx'),
			}),
			expect.objectContaining({
				kind: 'unresolved-import',
				source: './Header.jsx',
			}),
		]));
		expect(manifest.debug.skippedFiles).toEqual([
			expect.objectContaining({
				kind: 'parse-error',
			}),
		]);
		expect(manifest.seedAliasesByFile).toEqual({});
	});

	it('parses TSX files intentionally during manifest discovery', () => {
		const root = path.join(process.cwd(), '__cross_file_store_selector_tests__');
		const files = crossFileFixtureFiles({
			'Header.tsx': `
				type HeaderProps = { hero: { title: string } };
				export const Header = ({ hero }: HeaderProps) => <h1>{ hero.title }</h1>;
			`,
			'App.jsx': `
				import { Header } from './Header.tsx';
				import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

				const App = () => {
					const hero = useStoreSelector((state) => state.hero);
					return <Header hero={ hero } />;
				};

				module.exports = { App };
			`,
		});

		const manifest = createStoreSelectorCrossFileManifest(files);

		expect(manifest.diagnostics).toEqual([]);
		expect(manifest.seedAliasesByFile[path.join(root, 'Header.tsx')].Header).toEqual([
			expect.objectContaining({
				localName: 'hero',
				segments: [ 'hero' ],
				declarationSegments: [ 'hero' ],
			}),
		]);
	});

	it('diagnoses unsupported exported function components', () => {
		const files = crossFileFixtureFiles({
			'Header.jsx': `
				export function Header({ hero }) {
					return <h1>{ hero.title }</h1>;
				}
			`,
			'App.jsx': `
				import { Header } from './Header.jsx';
				import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

				const App = () => {
					const hero = useStoreSelector((state) => state.hero);
					return <Header hero={ hero } />;
				};

				module.exports = { App };
			`,
		});

		const manifest = createStoreSelectorCrossFileManifest(files);

		expect(manifest.diagnostics).toEqual([
			expect.objectContaining({
				kind: 'unsupported-component-declaration',
				componentName: 'Header',
				declarationKind: 'export-function-declaration',
			}),
		]);
		expect(manifest.seedAliasesByFile).toEqual({});
	});

	it('locks down extensionless and index relative import resolution', () => {
		const root = path.join(process.cwd(), '__cross_file_store_selector_tests__');
		const files = crossFileFixtureFiles({
			'Header.jsx': `
				export const Header = ({ hero }) => <h1>{ hero.title }</h1>;
			`,
			'components/index.jsx': `
				export const Footer = ({ hero }) => <footer>{ hero.title }</footer>;
			`,
			'App.jsx': `
				import { Header } from './Header';
				import { Footer } from './components';
				import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

				const App = () => {
					const hero = useStoreSelector((state) => state.hero);
					return <main><Header hero={ hero } /><Footer hero={ hero } /></main>;
				};

				module.exports = { App };
			`,
		});

		const manifest = createStoreSelectorCrossFileManifest(files);

		expect(manifest.diagnostics).toEqual([]);
		expect(manifest.componentNamesByFile[path.join(root, 'App.jsx')]).toEqual([ 'Footer', 'Header' ]);
		expect(manifest.seedAliasesByFile[path.join(root, 'Header.jsx')].Header).toHaveLength(1);
		expect(manifest.seedAliasesByFile[path.join(root, 'components', 'index.jsx')].Footer).toHaveLength(1);
	});

	it('detects import cycles and skips tracing cyclic edges', () => {
		const files = crossFileFixtureFiles({
			'A.jsx': `
				import { B } from './B.jsx';
				import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

				export const A = () => {
					const hero = useStoreSelector((state) => state.hero);
					return <B hero={ hero } />;
				};
			`,
			'B.jsx': `
				import { A } from './A.jsx';

				export const B = ({ hero }) => <A hero={ hero } />;
			`,
		});

		const manifest = createStoreSelectorCrossFileManifest(files);

		expect(manifest.diagnostics).toEqual([
			expect.objectContaining({
				kind: 'import-cycle',
				files: expect.arrayContaining([
					path.join(process.cwd(), '__cross_file_store_selector_tests__', 'A.jsx'),
					path.join(process.cwd(), '__cross_file_store_selector_tests__', 'B.jsx'),
				]),
			}),
		]);
		expect(manifest.debug.importCycles).toHaveLength(1);
		expect(manifest.debug.maxPasses).toBeGreaterThan(0);
		expect(manifest.debug.passCount).toBeLessThanOrEqual(manifest.debug.maxPasses);
		expect(manifest.componentNamesByFile).toEqual({});
		expect(manifest.seedAliasesByFile).toEqual({});
	});

	it.each([
		[
			'handlebars',
			'HomePage',
			"<main><h1>{{home.hero.title}}</h1>{{#if_equal home.hero.status 'published'}}<span>Published</span>{{/if_equal}}</main>",
		],
		[
			'handlebars',
			'ArticlePage',
			"<main><h1>{{article.hero.title}}</h1>{{#if_equal article.hero.status 'published'}}<span>Published</span>{{/if_equal}}</main>",
		],
		[
			'php',
			'HomePage',
			"<main><h1><?php echo $data['home']['hero']['title']; ?></h1><?php if ( $data['home']['hero']['status'] === 'published' ) { ?><span>Published</span><?php } ?></main>",
		],
		[
			'php',
			'ArticlePage',
			"<main><h1><?php echo $data['article']['hero']['title']; ?></h1><?php if ( $data['article']['hero']['status'] === 'published' ) { ?><span>Published</span><?php } ?></main>",
		],
	])('traces cross-file multi-source object roots for %s %s', async (language, exportName, expected) => {
		const root = path.join(process.cwd(), '__cross_file_store_selector_tests__');
		const files = crossFileFixtureFiles({
			'Header.jsx': `
				export const Header = ({ hero }) => (
					<main>
						<h1>{ hero.title }</h1>
						{ hero.status === 'published' && <span>Published</span> }
					</main>
				);
			`,
			'HomePage.jsx': `
				import { Header } from './Header.jsx';
				import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

				const HomePage = () => {
					const hero = useStoreSelector((state) => state.home.hero);
					return <Header hero={ hero } />;
				};

				module.exports = { HomePage };
			`,
			'ArticlePage.jsx': `
				import { Header } from './Header.jsx';
				import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

				const ArticlePage = () => {
					const hero = useStoreSelector((state) => state.article.hero);
					return <Header hero={ hero } />;
				};

				module.exports = { ArticlePage };
			`,
		});

		const manifest = createStoreSelectorCrossFileManifest(files);
		const options = createCrossFileOptions(manifest);
		const entryFilename = path.join(root, `${ exportName }.jsx`);
		const { codeByFile, output } = await renderTemplateModules(
			language,
			files,
			entryFilename,
			exportName,
			{},
			options
		);
		const combinedCode = Object.values(codeByFile).join('\n');

		expect(manifest.diagnostics).toEqual([]);
		expect(manifest.seedAliasesByFile[path.join(root, 'Header.jsx')].Header).toEqual([
			expect.objectContaining({
				localName: 'hero',
				propName: 'hero',
				dynamicRoot: true,
				dynamicRootSegments: [ 'hero' ],
			}),
		]);
		expect(manifest.dynamicRootPropsByFile[path.join(root, 'HomePage.jsx')]).toEqual({
			Header: [ 'hero' ],
		});
		expect(manifest.dynamicRootPropsByFile[path.join(root, 'ArticlePage.jsx')]).toEqual({
			Header: [ 'hero' ],
		});
		expect(manifest.childRelativeDiscoveryByFile[path.join(root, 'Header.jsx')].Header).toEqual([
			expect.objectContaining({
				localName: 'hero',
				propName: 'hero',
				dynamicRootSegments: [ 'hero' ],
			}),
		]);
		expect(manifest.callsiteContextsByFile[path.join(root, 'HomePage.jsx')]).toEqual([
			expect.objectContaining({
				parentComponent: 'HomePage',
				targetComponent: 'Header',
				propName: 'hero',
				canonicalSegments: [ 'home', 'hero' ],
				strategy: 'dynamic-root-descriptor',
			}),
		]);
		expect(manifest.callsiteContextsByFile[path.join(root, 'ArticlePage.jsx')]).toEqual([
			expect.objectContaining({
				parentComponent: 'ArticlePage',
				targetComponent: 'Header',
				propName: 'hero',
				canonicalSegments: [ 'article', 'hero' ],
				strategy: 'dynamic-root-descriptor',
			}),
		]);
		expect(combinedCode).not.toContain('useStoreSelector');
		expect(combinedCode).toContain('createTemplateRootDescriptor');
		expect(combinedCode).toContain('getTemplateRootPathArg');
		expect(normalizeTemplateOutput(output)).toBe(expected);
	});

	it('exposes cross-file callsite context debug metadata when requested', () => {
		const root = path.join(process.cwd(), '__cross_file_store_selector_tests__');
		const files = crossFileFixtureFiles({
			'Header.jsx': `
				export const Header = ({ hero }) => (
					<main>
						<h1>{ hero.title }</h1>
						{ hero.status === 'published' && <span>Published</span> }
					</main>
				);
			`,
			'HomePage.jsx': `
				import { Header } from './Header.jsx';
				import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

				const HomePage = () => {
					const hero = useStoreSelector((state) => state.home.hero);
					return <Header hero={ hero } />;
				};

				module.exports = { HomePage };
			`,
			'ArticlePage.jsx': `
				import { Header } from './Header.jsx';
				import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

				const ArticlePage = () => {
					const hero = useStoreSelector((state) => state.article.hero);
					return <Header hero={ hero } />;
				};

				module.exports = { ArticlePage };
			`,
		});
		const manifest = createStoreSelectorCrossFileManifest(files);
		const options = {
			language: 'handlebars',
			experimentalStoreSelectors: {
				crossFile: true,
				debug: true,
				__crossFileManifest: manifest,
			},
			warnOnUnsupported: false,
		};
		const homeFilename = path.join(root, 'HomePage.jsx');
		const headerFilename = path.join(root, 'Header.jsx');
		const homeResult = transformTemplateVars(files[homeFilename], options, { filename: homeFilename });
		const headerResult = transformTemplateVars(files[headerFilename], options, { filename: headerFilename });

		expect(homeResult.metadata.storeSelectorTemplateVarsCrossFile).toEqual(expect.objectContaining({
			filename: homeFilename,
			callsiteContexts: [
				expect.objectContaining({
					parentFile: homeFilename,
					parentComponent: 'HomePage',
					targetFile: headerFilename,
					targetComponent: 'Header',
					importEdgeId: expect.stringContaining('HomePage.jsx::Header'),
					jsxTag: 'Header',
					propName: 'hero',
					canonicalSegments: [ 'home', 'hero' ],
					declarationSegments: [ 'home', 'hero' ],
					canonicalPath: 'home.hero',
					declarationPath: 'home.hero',
					compiledPaths: [ 'home.hero' ],
					strategy: 'dynamic-root-descriptor',
				}),
			],
			dynamicRootProps: {
				Header: [ 'hero' ],
			},
			importEdges: [
				expect.objectContaining({
					sourceFilename: homeFilename,
					localName: 'Header',
					importedName: 'Header',
					targetFilename: headerFilename,
					targetComponentName: 'Header',
				}),
			],
		}));
		expect(headerResult.metadata.storeSelectorTemplateVarsCrossFile).toEqual(expect.objectContaining({
			filename: headerFilename,
			childRelativeDiscovery: {
				Header: [
					expect.objectContaining({
						localName: 'hero',
						propName: 'hero',
						dynamicRootSegments: [ 'hero' ],
					}),
				],
			},
			seedEdges: expect.arrayContaining([
				expect.objectContaining({
					targetFilename: headerFilename,
					targetComponentName: 'Header',
					localName: 'hero',
				}),
			]),
		}));
	});

	it('records unsupported selector metadata for JSX member components', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import * as Cards from './Cards.jsx';
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				const hero = useStoreSelector((state) => state.hero);
				return <Cards.Header hero={ hero } />;
			};

			module.exports = { App };
		`;

		const result = transformTemplateVars(source, selectorOptions);

		expect(result.metadata.storeSelectorTemplateVarsUnsupported).toEqual([
			expect.objectContaining({
				componentName: 'App',
				unsupported: [
					expect.objectContaining({
						kind: 'child-prop-boundary',
						path: 'hero',
						componentName: 'Cards.Header',
						propName: 'hero',
						target: 'Cards.Header.hero',
						boundary: 'JSXMemberExpression',
						sourcePaths: [ 'hero' ],
					}),
				],
			}),
		]);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('unsupported member component "Cards.Header"'));
	});

	it('throws for selector values passed to JSX member components in strict mode', () => {
		const source = `
			import * as Cards from './Cards.jsx';
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				const hero = useStoreSelector((state) => state.hero);
				return <Cards.Header hero={ hero } />;
			};

			module.exports = { App };
		`;

		expect(() => transformTemplateVars(source, {
			...selectorOptions,
			strict: true,
		})).toThrow(/unsupported member component "Cards.Header"/);
	});

	it('bounds same-file auto-seeding cycles during discovery', () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Leaf = ({ hero }) => <h1>{ hero.title }</h1>;

			const A = ({ hero }) => (
				<section>
					<Leaf hero={ hero } />
					<B hero={ hero } />
				</section>
			);

			const B = ({ hero }) => <A hero={ hero } />;

			const App = () => {
				const hero = useStoreSelector((state) => state.hero);
				return <A hero={ hero } />;
			};

			module.exports = { App };
		`;

		const result = transformTemplateVars(source, selectorOptions);

		expect(result.code).not.toContain('useStoreSelector');
		expect(result.code).toContain('hero.title');
	});

	it.each([
		[
			{ localName: 'hero' },
			/seed aliases must include a localName string and segments array/,
		],
		[
			{ localName: 'hero', segments: [ 'hero' ], declarationSegments: 'hero' },
			/declarationSegments must be an array/,
		],
		[
			{ localName: 'missing', segments: [ 'hero' ] },
			/could not be resolved in the component scope/,
		],
	])('throws for malformed internal seed aliases %#', (seedAlias, message) => {
		const source = `
			const Header = ({ hero }) => {
				return <h1>{ hero.title }</h1>;
			};

			module.exports = { Header };
		`;

		expect(() => transformTemplateVars(source, {
			language: 'handlebars',
			experimentalStoreSelectors: {
				__seedAliasesByComponent: {
					Header: [ seedAlias ],
				},
			},
		})).toThrow(message);
	});

	it('records unsupported selector metadata even when warnings are suppressed', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ({ title }) => {
				return <h1>{ title }</h1>;
			};

			const App = () => {
				const title = useStoreSelector((state) => state.hero.title);
				return <Header title={ title || '' } />;
			};

			module.exports = { App };
		`;

		const result = transformTemplateVars(source, {
			...selectorOptions,
			warnOnUnsupported: false,
		});

		expect(warn).not.toHaveBeenCalled();
		expect(result.metadata.storeSelectorTemplateVarsUnsupported).toEqual([
			expect.objectContaining({
				componentName: 'App',
				unsupported: [
					expect.objectContaining({
						kind: 'child-prop-boundary',
						path: 'hero.title',
						componentName: 'Header',
						propName: 'title',
						target: 'Header.title',
						sourcePaths: [ 'hero.title' ],
					}),
				],
			}),
		]);
	});

	it('records explicit templateVars that shadow seeded discovery declarations', async () => {
		const source = `
			const ProductCard = ({ product }) => {
				return <article>{ product.name }</article>;
			};

			ProductCard.templateVars = [ 'name' ];

			module.exports = { ProductCard };
		`;

		const options = {
			language: 'handlebars',
			experimentalStoreSelectors: {
				debug: true,
				__seedAliasesByComponent: {
					ProductCard: [
						{
							localName: 'product',
							segments: [ 'products[]' ],
							declarationSegments: [],
						},
					],
				},
			},
		};
		const result = transformTemplateVars(source, options);
		const { output } = await renderTemplateFixture('handlebars', source, 'ProductCard', {
			product: {
				name: 'Runtime name',
			},
		}, options);
		const [ debug ] = result.metadata.storeSelectorTemplateVars;

		expect(debug.declarations).toEqual([ 'name' ]);
		expect(debug.explicitTemplateVars).toEqual([ 'name' ]);
		expect(debug.shadowedTemplateVars).toEqual([ 'name' ]);
		expect(debug.combinedTemplateVars).toEqual([ 'name' ]);
		expectNoOrphanedTemplateReplacements(result.code, [ 'product.name' ]);
		expect(normalizeTemplateOutput(output)).toBe('<article>{{name}}</article>');
	});

	it('records unsupported selector-derived child prop boundary expressions', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const cases = [
			{
				name: 'logical',
				render: 'return <Header hero={ hero && hero.title } />;',
				boundary: 'LogicalExpression',
			},
			{
				name: 'conditional',
				render: 'return <Header hero={ hero.featured ? hero.title : hero.summary } />;',
				boundary: 'ConditionalExpression',
			},
			{
				name: 'computed member',
				extraSetup: 'const key = "title";',
				render: 'return <Header hero={ hero[key] } />;',
				boundary: 'MemberExpression',
			},
			{
				name: 'object literal',
				render: 'return <Header hero={{ title: hero.title }} />;',
				boundary: 'ObjectExpression',
			},
			{
				name: 'array literal',
				render: 'return <Header hero={[ hero.title ]} />;',
				boundary: 'ArrayExpression',
			},
			{
				name: 'template literal',
				render: 'return <Header hero={ `${ hero.title }` } />;',
				boundary: 'TemplateLiteral',
			},
			{
				name: 'call expression',
				render: 'return <Header hero={ formatHero(hero) } />;',
				boundary: 'CallExpression',
			},
			{
				name: 'spread',
				render: 'return <Header {...hero} />;',
				boundary: 'JSXSpreadAttribute',
			},
			{
				name: 'render prop',
				render: 'return <Header render={() => hero.title} />;',
				boundary: 'ArrowFunctionExpression',
			},
			{
				name: 'children',
				render: 'return <Header>{ hero.title }</Header>;',
				boundary: 'JSXChildren',
				propName: 'children',
				target: 'Header.children',
			},
			{
				name: 'multiple selector sources',
				extraSetup: 'const fallbackHero = useStoreSelector((state) => state.fallbackHero);',
				render: 'return <Header hero={ hero || fallbackHero } />;',
				boundary: 'LogicalExpression',
				sourcePaths: [ 'hero', 'fallbackHero' ],
			},
		];

		cases.forEach( ( testCase ) => {
			const source = `
				import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

				const formatHero = (hero) => hero.title;
				const Header = ({ hero }) => {
					return <h1>{ hero }</h1>;
				};

				const App = () => {
					const hero = useStoreSelector((state) => state.hero);
					${ testCase.extraSetup || '' }
					${ testCase.render }
				};

				module.exports = { App };
			`;

			const result = transformTemplateVars(source, {
				...selectorOptions,
				warnOnUnsupported: false,
			});
			const [ entry ] = result.metadata.storeSelectorTemplateVarsUnsupported;

			expect(entry.unsupported).toEqual(expect.arrayContaining([
				expect.objectContaining({
					kind: 'child-prop-boundary',
					boundary: testCase.boundary,
					componentName: 'Header',
					propName: testCase.propName || expect.any(String),
					target: testCase.target || expect.any(String),
					sourcePaths: testCase.sourcePaths ? expect.arrayContaining(testCase.sourcePaths) : expect.any(Array),
				}),
			]));
		});
		expect(warn).not.toHaveBeenCalled();
	});

	it('allows supported list maps as child component children', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Wrapper = ({ children }) => {
				return <div className="wrap">{ children }</div>;
			};

			const App = () => {
				const products = useStoreSelector((state) => state.products);
				return (
					<Wrapper>
						{ products.map((product) => (
							<li>{ product.title }</li>
						)) }
					</Wrapper>
				);
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<div className="wrap">{{#products}}<li>{{title}}</li>{{/products}}</div>');
		expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('unsupported children'));
	});

	it('does not globally alias child props with multiple selector sources', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Card = ({ name }) => {
				return <article>{ name }</article>;
			};

			const App = () => {
				const featured = useStoreSelector((state) => state.featured);
				const secondary = useStoreSelector((state) => state.secondary);
				return (
					<main>
						<Card name={ featured.name } />
						<Card name={ secondary.name } />
					</main>
				);
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<main><article>{{featured.name}}</article><article>{{secondary.name}}</article></main>');
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('has ambiguous or unsupported sources'));
	});

	it('fails closed when an ambiguously sourced child prop is used in a child control', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Card = ({ name }) => {
				return <article>{ name === 'featured' && <strong>Featured</strong> }</article>;
			};

			const App = () => {
				const featured = useStoreSelector((state) => state.featured);
				const secondary = useStoreSelector((state) => state.secondary);
				return (
					<main>
						<Card name={ featured.name } />
						<Card name={ secondary.name } />
					</main>
				);
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<main><article></article><article></article></main>');
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('has ambiguous or unsupported sources'));
	});

	it('fails closed when one child receives selector props inside and outside list context', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Card = ({ name }) => {
				return <article>{ name }</article>;
			};

			const App = () => {
				const featured = useStoreSelector((state) => state.featured);
				const products = useStoreSelector((state) => state.products);
				return (
					<main>
						<Card name={ featured.name } />
						{ products.map((product) => (
							<Card name={ product.name } />
						)) }
					</main>
				);
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, {
			...selectorOptions,
			warnOnUnsupported: false,
		});
		expect(normalizeTemplateOutput(output)).toBe('<main><article>{{featured.name}}</article>{{#products}}<article></article>{{/products}}</main>');
		expect(warn).not.toHaveBeenCalled();
	});

	it('preserves registry validation for selector and flat hint conflicts', () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				const products = useStoreSelector((state) => state.products);
				return (
					<ul>
						{ products.map((product) => (
							<li>{ product.title }</li>
						)) }
					</ul>
				);
			};

			App.templateVars = [
				'products.title',
			];

			module.exports = { App };
		`;

		expect(() => transformTemplateVars(source, selectorOptions)).toThrow(/same root cannot be both a list and an object/);
	});

	it('auto-seeds object root props into child component usage', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ({ hero }) => {
				return <h1>{ hero.title }</h1>;
			};

			const App = () => {
				const hero = useStoreSelector((state) => state.hero);
				return <Header hero={ hero } />;
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<h1>{{hero.title}}</h1>');
		expect(warn).not.toHaveBeenCalled();
	});

	it.each([
		[
			'handlebars',
			'<h1>{{home.hero.title}}</h1>',
		],
		[
			'php',
			"<h1><?php echo $data['home']['hero']['title']; ?></h1>",
		],
	])('auto-seeds nested object root props into child component usage for %s', async (language, expected) => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ({ hero }) => {
				return <h1>{ hero.title }</h1>;
			};

			const App = () => {
				const hero = useStoreSelector((state) => state.home.hero);
				return <Header hero={ hero } />;
			};

			module.exports = { App };
		`;

		const { code, output } = await renderTemplateFixture(language, source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe(expected);
		expect(code).not.toContain('return h("h1", null, hero.title)');
		expect(code).not.toContain('value: "home.hero"');
		expectNoOrphanedTemplateReplacements(code);
		expect(warn).not.toHaveBeenCalled();
	});

	it('auto-seeds renamed selector locals into renamed child props', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ({ item }) => {
				return <h1>{ item.title }</h1>;
			};

			const App = () => {
				const anything = useStoreSelector((state) => state.hero);
				return <Header item={ anything } />;
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<h1>{{hero.title}}</h1>');
		expect(warn).not.toHaveBeenCalled();
	});

	it('auto-seeds object root props into child component controls', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ({ hero }) => {
				return (
					<header>
						{ hero.status === 'published' && <aside>Published</aside> }
					</header>
				);
			};

			const App = () => {
				const hero = useStoreSelector((state) => state.hero);
				return <Header hero={ hero } />;
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe("<header>{{#if_equal hero.status 'published'}}<aside>Published</aside>{{/if_equal}}</header>");
		expect(warn).not.toHaveBeenCalled();
	});

	it('auto-seeds nested object root props into child component controls', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ({ hero }) => {
				return (
					<header>
						{ hero.status === 'published' && <aside>Published</aside> }
					</header>
				);
			};

			const App = () => {
				const hero = useStoreSelector((state) => state.home.hero);
				return <Header hero={ hero } />;
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe("<header>{{#if_equal home.hero.status 'published'}}<aside>Published</aside>{{/if_equal}}</header>");
		expect(warn).not.toHaveBeenCalled();
	});

	it('auto-seeds object root props into props-object child params', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = (props) => {
				return <h1>{ props.hero.title }</h1>;
			};

			const App = () => {
				const hero = useStoreSelector((state) => state.hero);
				return <Header hero={ hero } />;
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<h1>{{hero.title}}</h1>');
		expect(warn).not.toHaveBeenCalled();
	});

	it('auto-seeds nested object root props into props-object child params', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = (props) => {
				return <h1>{ props.hero.title }</h1>;
			};

			const App = () => {
				const hero = useStoreSelector((state) => state.home.hero);
				return <Header hero={ hero } />;
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<h1>{{home.hero.title}}</h1>');
		expect(warn).not.toHaveBeenCalled();
	});

	it('auto-seeds props-object child params regardless of parameter name', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = (whatever) => {
				return <h1>{ whatever.item.title }</h1>;
			};

			const App = () => {
				const anything = useStoreSelector((state) => state.hero);
				return <Header item={ anything } />;
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<h1>{{hero.title}}</h1>');
		expect(warn).not.toHaveBeenCalled();
	});

	it('does not invent mappings for mismatched props-object member names', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = (hero) => {
				return <h1>{ hero.title }</h1>;
			};

			const App = () => {
				const anything = useStoreSelector((state) => state.hero);
				return <Header hero={ anything } />;
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<h1></h1>');
		expect(warn).not.toHaveBeenCalled();
	});

	it('auto-seeds object root props into props-object child controls', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = (props) => {
				return (
					<header>
						{ props.hero.status === 'published' && <aside>Published</aside> }
					</header>
				);
			};

			const App = () => {
				const hero = useStoreSelector((state) => state.hero);
				return <Header hero={ hero } />;
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe("<header>{{#if_equal hero.status 'published'}}<aside>Published</aside>{{/if_equal}}</header>");
		expect(warn).not.toHaveBeenCalled();
	});

	it('auto-seeds list-context object fields into props-object child params', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const ProductCard = (props) => (
				<article>
					{ props.badges.map((badge) => (
						<span>{ badge.label }</span>
					)) }
				</article>
			);

			const App = () => {
				const products = useStoreSelector((state) => state.products);
				return (
					<main>
						{ products.map((product) => (
							<ProductCard badges={ product.badges } />
						)) }
					</main>
				);
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<main>{{#products}}<article>{{#badges}}<span>{{label}}</span>{{/badges}}</article>{{/products}}</main>');
		expect(warn).not.toHaveBeenCalled();
	});

	it('throws for unsupported traced child param patterns in strict mode', () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ([ hero ]) => {
				return <h1>{ hero.title }</h1>;
			};

			const App = () => {
				const hero = useStoreSelector((state) => state.hero);
				return <Header hero={ hero } />;
			};

			module.exports = { App };
		`;

		expect(() => transformTemplateVars(source, {
			...selectorOptions,
			strict: true,
		})).toThrow(/requires a destructured object or props object parameter/);
	});

	it('auto-seeds object root props across same-file relay components', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ({ hero }) => {
				return <h1>{ hero.title }</h1>;
			};

			const Shell = ({ hero }) => {
				return <section><Header hero={ hero } /></section>;
			};

			const Layout = ({ hero }) => {
				return <main><Shell hero={ hero } /></main>;
			};

			const App = () => {
				const hero = useStoreSelector((state) => state.hero);
				return <Layout hero={ hero } />;
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<main><section><h1>{{hero.title}}</h1></section></main>');
		expect(warn).not.toHaveBeenCalled();
	});

	it('auto-seeds relay components that also consume incoming props', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ({ hero }) => {
				return <h1>{ hero.title }</h1>;
			};

			const Shell = ({ hero }) => {
				return (
					<section>
						<p>{ hero.subtitle }</p>
						<Header hero={ hero } />
					</section>
				);
			};

			const App = () => {
				const hero = useStoreSelector((state) => state.hero);
				return <Shell hero={ hero } />;
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<section><p>{{hero.subtitle}}</p><h1>{{hero.title}}</h1></section>');
		expect(warn).not.toHaveBeenCalled();
	});

	it.each([
		[
			'handlebars',
			"<main><header><h1>{{home.hero.title}}</h1>{{#if_equal home.hero.status 'published'}}<span>Published</span>{{/if_equal}}</header><header><h1>{{article.hero.title}}</h1>{{#if_equal article.hero.status 'published'}}<span>Published</span>{{/if_equal}}</header></main>",
		],
		[
			'php',
			"<main><header><h1><?php echo $data['home']['hero']['title']; ?></h1><?php if ( $data['home']['hero']['status'] === 'published' ) { ?><span>Published</span><?php } ?></header><header><h1><?php echo $data['article']['hero']['title']; ?></h1><?php if ( $data['article']['hero']['status'] === 'published' ) { ?><span>Published</span><?php } ?></header></main>",
		],
	])('renders one object-root child prop from multiple selector sources for %s', async (language, expected) => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ({ hero }) => {
				return (
					<header>
						<h1>{ hero.title }</h1>
						{ hero.status === 'published' && <span>Published</span> }
					</header>
				);
			};

			const App = () => {
				const homeHero = useStoreSelector((state) => state.home.hero);
				const articleHero = useStoreSelector((state) => state.article.hero);
				return (
					<main>
						<Header hero={ homeHero } />
						<Header hero={ articleHero } />
					</main>
				);
			};

			module.exports = { App };
		`;

		const { code, output } = await renderTemplateFixture(language, source, 'App', {}, selectorOptions);

		expect(code).not.toContain('useStoreSelector');
		expect(code).not.toContain('hero: _uid');
		expect(normalizeTemplateOutput(output)).toBe(expected);
	});

	it('imports descriptor helpers for generated dynamic root descriptors', () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ({ hero }) => <h1>{ hero.title }</h1>;

			const App = () => {
				const homeHero = useStoreSelector((state) => state.home.hero);
				const articleHero = useStoreSelector((state) => state.article.hero);
				return (
					<main>
						<Header hero={ homeHero } />
						<Header hero={ articleHero } />
					</main>
				);
			};

			module.exports = { App };
		`;

		const { code } = transformTemplateVars(source, {
			language: 'handlebars',
			...selectorOptions,
		}, {
			filename: path.resolve(process.cwd(), '..', 'descriptor-helper-import.jsx'),
		});

		expect(code).toMatch(/import\s+\{[^}]*createTemplateRootDescriptor[^}]*getTemplateRootPathArg[^}]*\}/);
		const importMatch = code.match(/import\s+\{([^}]+)\}\s+from\s+["'][^"']+\/language\/index\.js["']/);
		expect(importMatch).not.toBeNull();
		const languageSource = fs.readFileSync(path.resolve(process.cwd(), 'language/index.js'), 'utf8');
		const exportedNames = new Set(Array.from(languageSource.matchAll(/export function\s+([A-Za-z_$][\w$]*)/g)).map(match => match[1]));
		const importedNames = importMatch[1].split(',').map(name => name.trim()).filter(Boolean);

		expect(importedNames).toContain('createTemplateRootDescriptor');
		expect(importedNames).toContain('getTemplateRootPathArg');
		importedNames.forEach((name) => {
			expect(exportedNames.has(name)).toBe(true);
		});
	});

	it('does not descriptor-wrap ordinary runtime props for dynamic-root child props', () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ({ hero }) => <h1>{ hero.title }</h1>;

			const App = ({ runtimeHero }) => {
				const homeHero = useStoreSelector((state) => state.home.hero);
				const articleHero = useStoreSelector((state) => state.article.hero);
				return (
					<main>
						<Header hero={ homeHero } />
						<Header hero={ articleHero } />
						<Header hero={ runtimeHero } />
					</main>
				);
			};

			module.exports = { App };
		`;

		expect(() => transformTemplateVars(source, {
			language: 'handlebars',
			...selectorOptions,
		})).toThrow(/must receive a selector-derived or descriptor-derived value/);
	});

	it('throws for conditional object-root sources before rendering empty output', () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ({ hero }) => <h1>{ hero.title }</h1>;

			const App = ({ useArticle }) => {
				const homeHero = useStoreSelector((state) => state.home.hero);
				const articleHero = useStoreSelector((state) => state.article.hero);
				return <Header hero={ useArticle ? articleHero : homeHero } />;
			};

			module.exports = { App };
		`;

		expect(() => transformTemplateVars(source, {
			language: 'handlebars',
			...selectorOptions,
		})).toThrow(/unsupported-object-root-expression/);
	});

	it('throws when a dynamic root is rendered both as a member and bare value', () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ({ hero }) => (
				<header>
					<h1>{ hero.title }</h1>
					<p>{ hero }</p>
				</header>
			);

			const App = () => {
				const homeHero = useStoreSelector((state) => state.home.hero);
				const articleHero = useStoreSelector((state) => state.article.hero);
				return (
					<main>
						<Header hero={ homeHero } />
						<Header hero={ articleHero } />
					</main>
				);
			};

			module.exports = { App };
		`;

		expect(() => transformTemplateVars(source, {
			language: 'handlebars',
			...selectorOptions,
		})).toThrow(/cannot be rendered directly/);
	});

	it('renders multi-source object roots through local aliases in child components', async () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ({ hero }) => {
				const item = hero;
				return <h1>{ item.title }</h1>;
			};

			const App = () => {
				const homeHero = useStoreSelector((state) => state.home.hero);
				const articleHero = useStoreSelector((state) => state.article.hero);
				return (
					<main>
						<Header hero={ homeHero } />
						<Header hero={ articleHero } />
					</main>
				);
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<main><h1>{{home.hero.title}}</h1><h1>{{article.hero.title}}</h1></main>');
	});

	it('renders multi-source object roots through a renamed props-object parameter', async () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = (anything) => {
				return (
					<header>
						<h1>{ anything.hero.title }</h1>
						{ anything.hero.status === 'published' && <span>Published</span> }
					</header>
				);
			};

			const App = () => {
				const homeHero = useStoreSelector((state) => state.home.hero);
				const articleHero = useStoreSelector((state) => state.article.hero);
				return (
					<main>
						<Header hero={ homeHero } />
						<Header hero={ articleHero } />
					</main>
				);
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe("<main><header><h1>{{home.hero.title}}</h1>{{#if_equal home.hero.status 'published'}}<span>Published</span>{{/if_equal}}</header><header><h1>{{article.hero.title}}</h1>{{#if_equal article.hero.status 'published'}}<span>Published</span>{{/if_equal}}</header></main>");
	});

	it.each([
		[
			'handlebars',
			'<main><section><p>{{primaryHero.subtitle}}</p><h1>{{primaryHero.title}}</h1></section><section><p>{{secondaryHero.subtitle}}</p><h1>{{secondaryHero.title}}</h1></section></main>',
		],
		[
			'php',
			"<main><section><p><?php echo $data['primaryHero']['subtitle']; ?></p><h1><?php echo $data['primaryHero']['title']; ?></h1></section><section><p><?php echo $data['secondaryHero']['subtitle']; ?></p><h1><?php echo $data['secondaryHero']['title']; ?></h1></section></main>",
		],
	])('renders relay props with multiple object-root selector sources for %s', async (language, expected) => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ({ hero }) => {
				return <h1>{ hero.title }</h1>;
			};

			const Shell = ({ hero }) => {
				return (
					<section>
						<p>{ hero.subtitle }</p>
						<Header hero={ hero } />
					</section>
				);
			};

			const App = () => {
				const primary = useStoreSelector((state) => state.primaryHero);
				const secondary = useStoreSelector((state) => state.secondaryHero);
				return (
					<main>
						<Shell hero={ primary } />
						<Shell hero={ secondary } />
					</main>
				);
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture(language, source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe(expected);
	});

	it.each([
		[
			'handlebars',
			'<main><div><aside>{{primaryHero.eyebrow}}</aside><section><p>{{primaryHero.subtitle}}</p><h1>{{primaryHero.title}}</h1></section></div><div><aside>{{secondaryHero.eyebrow}}</aside><section><p>{{secondaryHero.subtitle}}</p><h1>{{secondaryHero.title}}</h1></section></div></main>',
		],
		[
			'php',
			"<main><div><aside><?php echo $data['primaryHero']['eyebrow']; ?></aside><section><p><?php echo $data['primaryHero']['subtitle']; ?></p><h1><?php echo $data['primaryHero']['title']; ?></h1></section></div><div><aside><?php echo $data['secondaryHero']['eyebrow']; ?></aside><section><p><?php echo $data['secondaryHero']['subtitle']; ?></p><h1><?php echo $data['secondaryHero']['title']; ?></h1></section></div></main>",
		],
	])('renders three-hop multi-source relay props for %s', async (language, expected) => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ({ hero }) => {
				return <h1>{ hero.title }</h1>;
			};

			const Shell = ({ hero }) => {
				return (
					<section>
						<p>{ hero.subtitle }</p>
						<Header hero={ hero } />
					</section>
				);
			};

			const Layout = ({ hero }) => {
				return (
					<div>
						<aside>{ hero.eyebrow }</aside>
						<Shell hero={ hero } />
					</div>
				);
			};

			const App = () => {
				const primary = useStoreSelector((state) => state.primaryHero);
				const secondary = useStoreSelector((state) => state.secondaryHero);
				return (
					<main>
						<Layout hero={ primary } />
						<Layout hero={ secondary } />
					</main>
				);
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture(language, source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe(expected);
	});

	it('keeps explicit child templateVars compatible with dynamic root composition', async () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ({ hero }) => {
				return (
					<header>
						<h1>{ hero.title }</h1>
						{ hero.status === 'published' && <span>Published</span> }
					</header>
				);
			};

			Header.templateVars = [ 'hero.title', 'hero.status' ];

			const App = () => {
				const homeHero = useStoreSelector((state) => state.home.hero);
				const articleHero = useStoreSelector((state) => state.article.hero);
				return (
					<main>
						<Header hero={ homeHero } />
						<Header hero={ articleHero } />
					</main>
				);
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe("<main><header><h1>{{home.hero.title}}</h1>{{#if_equal home.hero.status 'published'}}<span>Published</span>{{/if_equal}}</header><header><h1>{{article.hero.title}}</h1>{{#if_equal article.hero.status 'published'}}<span>Published</span>{{/if_equal}}</header></main>");
	});

	it('preserves registry validation for explicit templateVars collisions under dynamic roots', () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ({ hero }) => {
				return <h1>{ hero.title }</h1>;
			};

			Header.templateVars = [ 'hero[]' ];

			const App = () => {
				const homeHero = useStoreSelector((state) => state.home.hero);
				const articleHero = useStoreSelector((state) => state.article.hero);
				return (
					<main>
						<Header hero={ homeHero } />
						<Header hero={ articleHero } />
					</main>
				);
			};

			module.exports = { App };
		`;

		expect(() => transformTemplateVars(source, {
			language: 'handlebars',
			...selectorOptions,
		})).toThrow(/same root cannot be both a list and an object/);
	});

	it('records diagnostics for wrong prop names in multi-source object-root callsites', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ({ hero }) => <h1>{ hero.title }</h1>;

			const App = () => {
				const homeHero = useStoreSelector((state) => state.home.hero);
				const articleHero = useStoreSelector((state) => state.article.hero);
				return (
					<main>
						<Header item={ homeHero } />
						<Header item={ articleHero } />
					</main>
				);
			};

			module.exports = { App };
		`;

		const result = transformTemplateVars(source, {
			language: 'handlebars',
			...selectorOptions,
		});

		expect(warn).toHaveBeenCalledWith(expect.stringContaining('prop "item"'));
		expect(result.code).not.toContain('createTemplateRootDescriptor');
	});

	it('throws for multi-source object-root callsites with unsupported child param shapes in strict mode', () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ([ hero ]) => <h1>{ hero.title }</h1>;

			const App = () => {
				const homeHero = useStoreSelector((state) => state.home.hero);
				const articleHero = useStoreSelector((state) => state.article.hero);
				return (
					<main>
						<Header hero={ homeHero } />
						<Header hero={ articleHero } />
					</main>
				);
			};

			module.exports = { App };
		`;

		expect(() => transformTemplateVars(source, {
			language: 'handlebars',
			...selectorOptions,
			strict: true,
		})).toThrow(/requires a destructured object or props object parameter/);
	});

	it.each([
		[
			'handlebars',
			"<main><header><h1>{{home.hero.title}}</h1>{{#if_equal home.hero.status 'published'}}<span>Published</span>{{/if_equal}}</header><header><h1>{{article.hero.title}}</h1>{{#if_equal article.hero.status 'published'}}<span>Published</span>{{/if_equal}}</header></main>",
		],
		[
			'php',
			"<main><header><h1><?php echo $data['home']['hero']['title']; ?></h1><?php if ( $data['home']['hero']['status'] === 'published' ) { ?><span>Published</span><?php } ?></header><header><h1><?php echo $data['article']['hero']['title']; ?></h1><?php if ( $data['article']['hero']['status'] === 'published' ) { ?><span>Published</span><?php } ?></header></main>",
		],
	])('spikes descriptor-composed replacement, control, and relay output for %s', async (language, expected) => {
		const source = `
			const templateReplace = (arg, context = 0) => (
				getLanguageString(['language', 'open'], [], context) +
				getLanguageReplace('format', arg, context) +
				getLanguageString(['language', 'close'], [], context)
			);

			const templateControl = (target, args, body, context = 0) => (
				getLanguageString(['language', 'open'], [], context) +
				getLanguageControl([target, 'open'], args, context) +
				getLanguageString(['language', 'close'], [], context) +
				body +
				getLanguageString(['language', 'open'], [], context) +
				getLanguageControl([target, 'close'], args, context) +
				getLanguageString(['language', 'close'], [], context)
			);

			const Header = ({ hero, __context__ = 0 }) => {
				const title = getTemplateRootPathArg(hero, ['title']);
				const status = getTemplateRootPathArg(hero, ['status']);
				return (
					<header>
						<h1>{ templateReplace(title, __context__) }</h1>
						{ templateControl('ifEqual', [status, { type: 'value', value: "'published'" }], <span>Published</span>, __context__) }
					</header>
				);
			};

			const Shell = ({ hero }) => <Header hero={ hero } />;

			const App = () => (
				<main>
					<Shell hero={ createTemplateRootDescriptor(['home', 'hero']) } />
					<Shell hero={ createTemplateRootDescriptor(['article', 'hero']) } />
				</main>
			);

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture(language, source, 'App');

		expect(normalizeTemplateOutput(output)).toBe(expected);
	});

	it('throws when a template root descriptor reaches rendered output', async () => {
		const source = `
			const Header = ({ hero }) => <h1>{ hero }</h1>;

			const App = () => (
				<Header hero={ createTemplateRootDescriptor(['home', 'hero']) } />
			);

			module.exports = { App };
		`;

		await expect(
			renderTemplateFixture('handlebars', source, 'App')
		).rejects.toThrow(/Template root descriptor escaped into rendered children/);
	});

	it('traces same-file selector props into child component replacements', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ({ title }) => {
				return <h1>{ title }</h1>;
			};

			const App = () => {
				const title = useStoreSelector((state) => state.hero.title);
				return <Header title={ title } />;
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<h1>{{hero.title}}</h1>');
		expect(warn).not.toHaveBeenCalled();
	});

	it('traces same-file selector props into child component controls', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Status = ({ status }) => {
				return (
					<section>
						{ status === 'published' && <aside>Published</aside> }
					</section>
				);
			};

			const App = () => {
				const status = useStoreSelector((state) => state.article.status);
				return <Status status={ status } />;
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe("<section>{{#if_equal article.status 'published'}}<aside>Published</aside>{{/if_equal}}</section>");
		expect(warn).not.toHaveBeenCalled();
	});

	it('auto-seeds object root props in strict mode', async () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ({ hero }) => {
				return <h1>{ hero.title }</h1>;
			};

			const App = () => {
				const hero = useStoreSelector((state) => state.hero);
				return <Header hero={ hero } />;
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, {
			...selectorOptions,
			strict: true,
		});

		expect(normalizeTemplateOutput(output)).toBe('<h1>{{hero.title}}</h1>');
	});

	it('auto-seeds nested object root props in strict mode', async () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ({ hero }) => {
				return <h1>{ hero.title }</h1>;
			};

			const App = () => {
				const hero = useStoreSelector((state) => state.home.hero);
				return <Header hero={ hero } />;
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, {
			...selectorOptions,
			strict: true,
		});

		expect(normalizeTemplateOutput(output)).toBe('<h1>{{home.hero.title}}</h1>');
	});

	it('auto-seeds object root props when unsupported warnings are suppressed', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Header = ({ hero }) => {
				return <h1>{ hero.title }</h1>;
			};

			const App = () => {
				const hero = useStoreSelector((state) => state.hero);
				return <Header hero={ hero } />;
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, {
			...selectorOptions,
			warnOnUnsupported: false,
		});

		expect(normalizeTemplateOutput(output)).toBe('<h1>{{hero.title}}</h1>');
		expect(warn).not.toHaveBeenCalled();
	});

	it('auto-seeds selector list item props passed to child components', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Card = ({ name }) => {
				return <article>{ name }</article>;
			};

			Card.templateVars = [ 'name' ];

			const App = () => {
				const products = useStoreSelector((state) => state.catalog.products);
				return (
					<main>
						{ products.map((product) => (
							<Card name={ product.name } />
						)) }
					</main>
				);
			};

			module.exports = { App };
		`;

		const { code, output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<main>{{#catalog.products}}<article>{{name}}</article>{{/catalog.products}}</main>');
		expect(code).not.toContain('name: getLanguageString');
		expect(warn).not.toHaveBeenCalled();
	});

	it('auto-seeds selector list item props passed to child components in strict mode', async () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const Card = ({ name }) => {
				return <article>{ name }</article>;
			};

			Card.templateVars = [ 'name' ];

			const App = () => {
				const products = useStoreSelector((state) => state.catalog.products);
				return (
					<main>
						{ products.map((product) => (
							<Card name={ product.name } />
						)) }
					</main>
				);
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, {
			...selectorOptions,
			strict: true,
		});

		expect(normalizeTemplateOutput(output)).toBe('<main>{{#catalog.products}}<article>{{name}}</article>{{/catalog.products}}</main>');
	});

	it('warns when selector values cross opaque helper boundaries', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const renderHero = (hero) => {
				return <h1>{ hero.title }</h1>;
			};

			const App = () => {
				const hero = useStoreSelector((state) => state.hero);
				return renderHero(hero);
			};

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {}, selectorOptions);

		expect(normalizeTemplateOutput(output)).toBe('<h1></h1>');
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('helper-body field inference is not supported'));
	});

	it('throws for selector values crossing opaque helper boundaries in strict mode', () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const renderHero = (hero) => {
				return <h1>{ hero.title }</h1>;
			};

			const App = () => {
				const hero = useStoreSelector((state) => state.hero);
				return renderHero(hero);
			};

			module.exports = { App };
		`;

		expect(() => transformTemplateVars(source, {
			...selectorOptions,
			strict: true,
		})).toThrow(/helper-body field inference is not supported/);
	});

	it('rejects optional chaining in selector paths for slice 1', () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				const title = useStoreSelector((state) => state.hero?.title);
				return <h1>{ title }</h1>;
			};

			module.exports = { App };
		`;

		expect(() => transformTemplateVars(source, selectorOptions)).toThrow(/optional chaining is not supported/);
	});

	it('rejects computed selector paths for the package-scoped selector hook', () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				const key = 'title';
				const title = useStoreSelector((state) => state.hero[key]);
				return <h1>{ title }</h1>;
			};

			module.exports = { App };
		`;

		expect(() => transformTemplateVars(source, selectorOptions)).toThrow(/computed properties/);
	});

	it('rejects selector functions with unsupported params', () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				const title = useStoreSelector(({ hero }) => hero.title);
				return <h1>{ title }</h1>;
			};

			module.exports = { App };
		`;

		expect(() => transformTemplateVars(source, selectorOptions)).toThrow(/one identifier parameter/);
	});

	it('rejects unassigned selector calls', () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				useStoreSelector((state) => state.hero.title);
				return <h1>Title</h1>;
			};

			module.exports = { App };
		`;

		expect(() => transformTemplateVars(source, selectorOptions)).toThrow(/assigned to a local identifier/);
	});

	it('rejects selector calls rebound through assignment', () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				let title = useStoreSelector((state) => state.hero.title);
				title = useStoreSelector((state) => state.footer.title);
				return <h1>{ title }</h1>;
			};

			module.exports = { App };
		`;

		expect(() => transformTemplateVars(source, selectorOptions)).toThrow(/assigned to a local identifier/);
	});

	it('rejects selector calls in unsupported nested functions before import removal', () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				const renderTitle = () => {
					const title = useStoreSelector((state) => state.hero.title);
					return <h1>{ title }</h1>;
				};
				return renderTitle();
			};

			module.exports = { App };
		`;

		expect(() => transformTemplateVars(source, selectorOptions)).toThrow(/inside nested functions are not supported/);
	});

	it('rejects unsupported selector-derived list chains before map', () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				const products = useStoreSelector((state) => state.products);
				return (
					<ul>
						{ products.reduce((rows, product) => rows.concat(product), []).map((product) => (
							<li>{ product.title }</li>
						)) }
					</ul>
				);
			};

			module.exports = { App };
		`;

		expect(() => transformTemplateVars(source, selectorOptions)).toThrow(/list chains only support/);
	});

	it('rejects aliases of unsupported selector-derived list chains before map', () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				const products = useStoreSelector((state) => state.products);
				const rows = products.reduce((items, product) => items.concat(product), []);
				return (
					<ul>
						{ rows.map((product) => (
							<li>{ product.title }</li>
						)) }
					</ul>
				);
			};

			module.exports = { App };
		`;

		expect(() => transformTemplateVars(source, selectorOptions)).toThrow(/list chains only support/);
	});

	it('rejects selector calls in unsupported function declaration components before import removal', () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			function App() {
				const title = useStoreSelector((state) => state.hero.title);
				return <h1>{ title }</h1>;
			}

			module.exports = { App };
		`;

		expect(() => transformTemplateVars(source, selectorOptions)).toThrow(/could not be processed/);
	});

	it('rejects selector calls in unsupported default exported components before import removal', () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			export default function App() {
				const title = useStoreSelector((state) => state.hero.title);
				return <h1>{ title }</h1>;
			}
		`;

		expect(() => transformTemplateVars(source, selectorOptions)).toThrow(/could not be processed/);
	});

	it('leaves selectors untouched when the experiment flag is off', () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				const title = useStoreSelector((state) => state.hero.title);
				return <h1>{ title }</h1>;
			};

			module.exports = { App };
		`;

		const result = transformTemplateVars(source, { language: 'handlebars' });

		expect(result.code).toContain('useStoreSelector');
		expect(result.code).toContain('babel-plugin-jsx-template-vars/store');
	});

	it('leaves selectors untouched in tidyOnly mode', () => {
		const source = `
			import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

			const App = () => {
				const title = useStoreSelector((state) => state.hero.title);
				return <h1>{ title }</h1>;
			};

			App.templateVars = [ 'legacy' ];

			module.exports = { App };
		`;

		const result = transformTemplateVars(source, {
			...selectorOptions,
			tidyOnly: true,
		});

		expect(result.code).toContain('useStoreSelector');
		expect(result.code).toContain('babel-plugin-jsx-template-vars/store');
		expect(result.code).not.toContain('templateVars');
	});
});
