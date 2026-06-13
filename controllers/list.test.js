import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import babel from '@babel/core';
import {
	normalizeTemplateOutput,
	renderTemplateFixture,
} from '../test-utils/transform.js';

const require = createRequire(import.meta.url);
const { ListController } = require('./list');

function createController(vars = {}) {
	return new ListController({
		raw: [],
		mapped: { items: '_items' },
		names: [ 'items' ],
		toTag: {},
		...vars,
	}, '_context', babel);
}

function statementToCode(statement) {
	const body = statement.type === 'File' ? statement.program.body : [ statement ];
	const ast = babel.types.file(babel.types.program(body));
	return babel.transformFromAstSync(ast, '', {
		babelrc: false,
		configFile: false,
	}).code;
}

describe('ListController', () => {
	it('normalises list variable config to primitive children by default', () => {
		const controller = createController();

		expect(controller.normaliseListVar()).toEqual({
			type: 'list',
			child: { type: 'primitive' },
		});
		expect(controller.normaliseListVar({ type: 'list' })).toEqual({
			type: 'list',
			child: { type: 'primitive' },
		});
	});

	it('normalises primitive and object child properties', () => {
		const controller = createController();

		expect(controller.normalisedProp('label')).toEqual({
			name: 'label',
			type: 'primitive',
		});
		expect(controller.normalisedProp({ name: 'children', type: 'list' })).toEqual({
			name: 'children',
			type: 'list',
		});
	});

	it('builds primitive list placeholder arrays', () => {
		const controller = createController();
		const code = statementToCode(controller.buildDeclaration('_items'));

		expect(code).toContain('let _items = [getLanguageString');
		expect(code).toContain("getLanguageList('primitive', null, _context)");
	});

	it('builds object list placeholder arrays from child props', () => {
		const controller = createController();
		const declaration = controller.buildDeclaration('_items', {
			type: 'list',
			child: {
				type: 'object',
				props: [ 'label', 'active' ],
			},
		});
		const code = statementToCode(declaration);

		expect(code).toContain('let _items = [{');
		expect(code).toContain('label: getLanguageString');
		expect(code).toContain('active: getLanguageString');
		expect(code).toContain('getLanguageList("objectProperty"');
	});

	it('represents nested list child props as empty arrays for now', () => {
		const controller = createController();
		const declaration = controller.buildDeclaration('_items', {
			type: 'list',
			child: {
				type: 'object',
				props: [
					'label',
					{ name: 'children', type: 'list' },
				],
			},
		});
		const code = statementToCode(declaration);

		expect(code).toContain('label: getLanguageString');
		expect(code).toContain('children: []');
	});

	it('registers list source names and aliases for JSX wrapping', () => {
		const vars = {
			raw: [
				[ 'items', { type: 'list', aliases: [ 'renderedItems' ] } ],
			],
			mapped: { items: '_items' },
			names: [ 'items' ],
			toTag: {},
		};
		const controller = createController(vars);
		const path = { node: { body: [] } };

		controller.initVars(path);

		expect(path.node.body).toHaveLength(1);
		expect(vars.toTag).toEqual({
			items: 'items',
			renderedItems: 'items',
		});
	});

	it('wraps direct list map output with language list tags', async () => {
		const source = `
			const Item = ({ label }) => {
				return <li>{ label }</li>;
			};
			Item.templateVars = [ 'label' ];

			const App = ({ items }) => {
				return <ul>{ items.map((item) => <Item label={ item.label } />) }</ul>;
			};
			App.templateVars = [
				[
					'items',
					{
						type: 'list',
						child: {
							type: 'object',
							props: [ 'label' ],
						},
					},
				],
			];

			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {
			items: [],
		});

		expect(output).toBe('<ul>{{#items}}<li>{{label}}</li>{{/items}}</ul>');
	});

	it('supports flat primitive direct root list rendering', async () => {
		const source = `
			const App = ({ items }) => {
				return <section>{ items }</section>;
			};
			App.templateVars = [ 'items[]' ];
			module.exports = { App };
		`;

		const handlebars = await renderTemplateFixture('handlebars', source, 'App', {});
		const php = await renderTemplateFixture('php', source, 'App', {});

		expect(normalizeTemplateOutput(handlebars.output)).toBe('<section>{{#items}}{{.}}{{/items}}</section>');
		expect(normalizeTemplateOutput(php.output)).toBe("<section><?php foreach ( $data['items'] as $data_1 ) { ?><?php echo $data_1; ?><?php } ?></section>");
	});

	it('does not treat non-map list member calls as list wrapping usage', async () => {
		const source = `
			const App = ({ items }) => {
				return <p>{ items.join(', ') }</p>;
			};
			App.templateVars = [ 'items[]' ];
			module.exports = { App };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'App', {
			items: [ 'red', 'blue' ],
		});

		expect(normalizeTemplateOutput(output)).toBe('<p>red, blue</p>');
	});
});
