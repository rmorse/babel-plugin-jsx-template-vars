import { describe, expect, it } from 'vitest';
import {
	renderTemplateFixture,
	transformTemplateVars,
} from './test-utils/transform.js';

const COMPLEX_COMPONENT = `
const Item = ({ label, active }) => {
	return (
		<li>
			{ active && <span>{ label }</span> }
		</li>
	);
};
Item.templateVars = [
	'label',
	'active',
];

const App = ({ title, items, status }) => {
	const renderedItems = items.map((item) => (
		<Item label={ item.label } active={ item.active } />
	));

	return (
		<section>
			<h1>{ title }</h1>
			<ul>{ renderedItems }</ul>
			{ status === 'ready' && <strong>Ready</strong> }
		</section>
	);
};
App.templateVars = [
	'title',
	'status',
	'items[].label',
	'items[].active',
];

module.exports = { App };
`;

describe('template vars plugin', () => {
	it('removes templateVars declarations in tidyOnly mode', () => {
		const result = transformTemplateVars(`
			const Person = ({ name }) => {
				return <h1>{ name }</h1>;
			};
			Person.templateVars = [ 'name' ];
		`, { tidyOnly: true }, { jsx: false });

		expect(result.code).not.toContain('templateVars');
		expect(result.code).not.toContain('window.templateVarsLanguage');
	});

	it('renders Handlebars output for replacement, list, and control vars', async () => {
		const { output } = await renderTemplateFixture('handlebars', COMPLEX_COMPONENT, 'App', {
			title: 'Ignored',
			items: [],
			status: 'ignored',
		});

		expect(output).toContain('<h1>{{title}}</h1>');
		expect(output).toContain('<ul>{{#items}}');
		expect(output).toContain('{{#if active}}<span>{{label}}</span>{{/if}}');
		expect(output).toContain('{{/items}}</ul>');
		expect(output).toContain("{{#if_equal status 'ready'}}<strong>Ready</strong>{{/if_equal}}");
	});

	it('renders expression-bodied arrow components with flat templateVars', async () => {
		const source = `
			const Person = ({ name }) => <h1>{ name }</h1>;
			Person.templateVars = [ 'name' ];

			module.exports = { Person };
		`;

		const { output } = await renderTemplateFixture('handlebars', source, 'Person', {
			name: 'Runtime name',
		});

		expect(output).toBe('<h1>{{name}}</h1>');
	});

	it('renders PHP output for replacement, list, and control vars', async () => {
		const { output } = await renderTemplateFixture('php', COMPLEX_COMPONENT, 'App', {
			title: 'Ignored',
			items: [],
			status: 'ignored',
		});

		expect(output).toContain("<h1><?php echo $data['title']; ?></h1>");
		expect(output).toContain("<ul><?php foreach ( $data['items'] as $data_1 ) { ?>");
		expect(output).toContain("<?php if ( $data_1['active'] ) { ?><span><?php echo $data_1['label']; ?></span><?php } ?>");
		expect(output).toContain('<?php } ?></ul>');
		expect(output).toContain("<?php if ( $data['status'] === 'ready' ) { ?><strong>Ready</strong><?php } ?>");
	});
});
