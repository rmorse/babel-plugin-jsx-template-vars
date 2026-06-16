import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
	e2eFixturesDir,
	normalizeTemplateOutput,
	renderTemplateFixture,
} from './test-utils/transform.js';

const languages = [ 'handlebars', 'php' ];

function readFixture(name, fileName) {
	return fs.readFileSync(path.join(e2eFixturesDir, name, fileName), 'utf8');
}

const fixtureNames = fs.readdirSync(e2eFixturesDir)
	.filter((name) => fs.statSync(path.join(e2eFixturesDir, name)).isDirectory());
const selectorFixtureNames = fixtureNames.filter((name) => name.startsWith('store-selector-'));
const stableFixtureNames = fixtureNames.filter((name) => ! name.startsWith('store-selector-'));

describe('e2e template output fixtures', () => {
	it.each(stableFixtureNames.flatMap((fixtureName) => (
		languages.map((language) => [ fixtureName, language ])
	)))('%s renders expected %s output with default options', async (fixtureName, language) => {
		const source = readFixture(fixtureName, 'input.jsx');
		const expected = readFixture(fixtureName, `expected.${ language }.html`);

		const { output } = await renderTemplateFixture(language, source, 'App');

		expect(normalizeTemplateOutput(output)).toBe(normalizeTemplateOutput(expected));
	});

	it.each(stableFixtureNames.flatMap((fixtureName) => (
		languages.map((language) => [ fixtureName, language ])
	)))('%s renders expected %s output with store selectors enabled', async (fixtureName, language) => {
		const source = readFixture(fixtureName, 'input.jsx');
		const expected = readFixture(fixtureName, `expected.${ language }.html`);

		const { output } = await renderTemplateFixture(language, source, 'App', {}, {
			experimentalStoreSelectors: true,
		});

		expect(normalizeTemplateOutput(output)).toBe(normalizeTemplateOutput(expected));
	});

	it.each(selectorFixtureNames.flatMap((fixtureName) => (
		languages.map((language) => [ fixtureName, language ])
	)))('%s renders expected %s output with store selectors enabled', async (fixtureName, language) => {
		const source = readFixture(fixtureName, 'input.jsx');
		const expected = readFixture(fixtureName, `expected.${ language }.html`);

		const { output } = await renderTemplateFixture(language, source, 'App', {}, {
			experimentalStoreSelectors: true,
		});

		expect(normalizeTemplateOutput(output)).toBe(normalizeTemplateOutput(expected));
	});
});
