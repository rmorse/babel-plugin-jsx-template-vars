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
