import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
	e2eFixturesDir,
	normalizeTemplateOutput,
	renderTemplateFixture,
} from './test-utils/transform.js';

const languages = [ 'handlebars', 'php' ];
const selectorParityFixtures = new Map([
	[ 'store-selector-complex-surface', 'full-template-surface' ],
	[ 'store-selector-full-template-surface', 'full-template-surface' ],
]);

function readFixture(name, fileName) {
	return fs.readFileSync(path.join(e2eFixturesDir, name, fileName), 'utf8');
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expectNoOrphanedListDeclarations(code) {
	const declarations = Array.from(code.matchAll(/\b(?:const|let|var)\s+(_uid\d*)\s*=\s*[^;]*getLanguageList[^;]*;/g));
	expect(declarations.length).toBeGreaterThan(0);

	declarations.forEach((match) => {
		const variableName = match[1];
		const usages = code.match(new RegExp(`\\b${ escapeRegExp(variableName) }\\b`, 'g')) || [];
		expect(usages.length).toBeGreaterThan(1);
	});
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

		const { code, output } = await renderTemplateFixture(language, source, 'App', {}, {
			experimentalStoreSelectors: true,
		});

		expect(normalizeTemplateOutput(output)).toBe(normalizeTemplateOutput(expected));
		expect(code).not.toContain('useStoreSelector');
		expect(code).not.toContain('$$');
		expectNoOrphanedListDeclarations(code);
	});

	it.each(Array.from(selectorParityFixtures.entries()).flatMap(([ selectorFixtureName, flatFixtureName ]) => (
		languages.map((language) => [ selectorFixtureName, flatFixtureName, language ])
	)))('%s byte-matches %s expected %s output', async (selectorFixtureName, flatFixtureName, language) => {
		const source = readFixture(selectorFixtureName, 'input.jsx');
		const expected = readFixture(flatFixtureName, `expected.${ language }.html`);

		const { output } = await renderTemplateFixture(language, source, 'App', {}, {
			experimentalStoreSelectors: true,
		});

		expect(normalizeTemplateOutput(output)).toBe(normalizeTemplateOutput(expected));
	});
});
