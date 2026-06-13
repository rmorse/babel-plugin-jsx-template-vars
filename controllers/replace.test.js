import { describe, expect, it } from 'vitest';
import { transformTemplateVars } from '../test-utils/transform.js';

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
});
