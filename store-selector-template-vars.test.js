import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	normalizeTemplateOutput,
	renderTemplateFixture,
	transformTemplateVars,
} from './test-utils/transform.js';

const selectorOptions = {
	experimentalStoreSelectors: true,
};

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
		const [ debug ] = result.metadata.storeSelectorTemplateVars;

		expect(debug.componentName).toBe('App');
		expect(debug.declarations).toEqual([ 'products[]', 'title' ]);
		expect(debug.listShapes).toEqual([ 'products[]' ]);
		expect(debug.aliases).toEqual(expect.arrayContaining([
			expect.objectContaining({ localName: 'title', path: 'title' }),
			expect.objectContaining({ localName: 'products', path: 'products' }),
			expect.objectContaining({ localName: 'product', path: 'products[]' }),
		]));
		expect(debug.unsupported).toEqual([
			expect.objectContaining({
				kind: 'child-prop',
				path: 'products[].name',
			}),
		]);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('prop tracing is not supported'));
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
		expect(result.code).not.toContain('{{#products}}');
		expect(normalizeTemplateOutput(output)).toBe('<article>{{name}}</article>');
	});

	it('records unsupported selector metadata even when warnings are suppressed', () => {
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
						kind: 'child-prop',
						path: 'hero',
						componentName: 'Header',
						propName: 'hero',
						target: 'Header.hero',
						sourcePaths: [ 'hero' ],
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
					sourcePaths: testCase.sourcePaths ? expect.arrayContaining(testCase.sourcePaths) : expect.any(Array),
				}),
			]));
		});
		expect(warn).not.toHaveBeenCalled();
	});

	it('records unsupported metadata when one child receives selector props inside and outside list context', () => {
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

		const result = transformTemplateVars(source, {
			...selectorOptions,
			warnOnUnsupported: false,
		});
		const [ entry ] = result.metadata.storeSelectorTemplateVarsUnsupported;

		expect(entry.unsupported).toEqual(expect.arrayContaining([
			expect.objectContaining({
				kind: 'child-prop',
				path: 'products[].name',
			}),
		]));
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

	it('warns when selector values are passed to child components before tracing exists', async () => {
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

		expect(normalizeTemplateOutput(output)).toBe('<h1></h1>');
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('prop tracing is not supported'));
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

	it('throws for selector values passed to child components in strict mode', () => {
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

		expect(() => transformTemplateVars(source, {
			...selectorOptions,
			strict: true,
		})).toThrow(/prop tracing is not supported/);
	});

	it('suppresses unsupported selector warnings when configured', async () => {
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

		expect(normalizeTemplateOutput(output)).toBe('<h1></h1>');
		expect(warn).not.toHaveBeenCalled();
	});

	it('does not partially synthesize selector list item props passed to child components', async () => {
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
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('prop tracing is not supported'));
	});

	it('throws for selector list item props passed to child components in strict mode', () => {
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

		expect(() => transformTemplateVars(source, {
			...selectorOptions,
			strict: true,
		})).toThrow(/prop tracing is not supported/);
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
