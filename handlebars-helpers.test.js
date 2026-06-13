import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
	ifEqual,
	ifNotEqual,
	registerJsxTemplateVarsHandlebarsHelpers,
} = require('./handlebars-helpers');

function options() {
	return {
		fn: context => `yes:${ context.label }`,
		inverse: context => `no:${ context.label }`,
	};
}

describe('Handlebars helper registration', () => {
	it('registers strict equality helpers on a Handlebars instance', () => {
		const registered = {};
		const Handlebars = {
			registerHelper(name, helper) {
				registered[ name ] = helper;
			},
		};

		expect(registerJsxTemplateVarsHandlebarsHelpers(Handlebars)).toBe(Handlebars);
		expect(registered.if_equal).toBe(ifEqual);
		expect(registered.if_not_equal).toBe(ifNotEqual);
	});

	it('renders main and inverse blocks using strict equality', () => {
		const context = { label: 'ctx' };

		expect(ifEqual.call(context, 1, 1, options())).toBe('yes:ctx');
		expect(ifEqual.call(context, 1, '1', options())).toBe('no:ctx');
		expect(ifNotEqual.call(context, 1, '1', options())).toBe('yes:ctx');
		expect(ifNotEqual.call(context, 1, 1, options())).toBe('no:ctx');
	});

	it('requires a Handlebars-compatible registerHelper API', () => {
		expect(() => registerJsxTemplateVarsHandlebarsHelpers({})).toThrow(/registerHelper/);
	});
});
