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

describe('e2e template output fixtures', () => {
	it.each(fixtureNames.flatMap((fixtureName) => (
		languages.map((language) => [ fixtureName, language ])
	)))('%s renders expected %s output', async (fixtureName, language) => {
		const source = readFixture(fixtureName, 'input.jsx');
		const expected = readFixture(fixtureName, `expected.${ language }.html`);
		const pluginOptions = fixtureName.startsWith('dollar-marker-')
			? { experimentalDollarMarkers: true }
			: {};

		const { code, output } = await renderTemplateFixture(language, source, 'App', {}, pluginOptions);

		expect(normalizeTemplateOutput(output)).toBe(normalizeTemplateOutput(expected));
		if (fixtureName.startsWith('dollar-marker-')) {
			expect(code).not.toMatch(/\$\$/);
		}
	});
});
