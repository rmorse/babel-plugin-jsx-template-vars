import { describe, expect, it } from 'vitest';
import {
	normalizeTemplateOutput,
	renderTemplateFixture,
	transformTemplateVars,
} from '../test-utils/transform.js';

describe('ReplaceController', () => {
	it('does not rewrite destructured prop bindings to generated replacement variables', () => {
		const result = transformTemplateVars(`
			const Person = ({ name }) => {
				return <h1>{ name }</h1>;
			};
			Person.templateVars = [ 'name' ];
			module.exports = { Person };
		`, { language: 'handlebars' });

		expect(result.code).toMatch(/const Person = \(\{\s+name,\s+__context__,\s+__config__\s+\}\)/);
		expect(result.code).not.toMatch(/name:\s*_uid/);
		expect(result.code).toContain('getLanguageReplace');
	});

	it('replaces declared object member paths for both language presets', async () => {
		const source = `
			const App = ({ hero }) => {
				return <p>{ hero.summary }</p>;
			};
			App.templateVars = [ 'hero.summary' ];
			module.exports = { App };
		`;

		const handlebars = await renderTemplateFixture('handlebars', source, 'App', {});
		const php = await renderTemplateFixture('php', source, 'App', {});

		expect(normalizeTemplateOutput(handlebars.output)).toBe('<p>{{hero.summary}}</p>');
		expect(normalizeTemplateOutput(php.output)).toBe("<p><?php echo $data['hero']['summary']; ?></p>");
	});
});
