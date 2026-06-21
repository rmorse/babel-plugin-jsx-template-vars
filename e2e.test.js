import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crossFileSelectors from './store-selector-cross-file.js';
import {
	e2eFixturesDir,
	normalizeTemplateOutput,
	renderTemplateFixture,
	renderTemplateModules,
} from './test-utils/transform.js';

const { createStoreSelectorCrossFileManifest } = crossFileSelectors;
const languages = [ 'handlebars', 'php' ];
const selectorParityFixtures = new Map([
	[ 'store-selector-complex-surface', 'full-template-surface' ],
	[ 'store-selector-full-template-surface', 'full-template-surface' ],
]);

function readFixture(name, fileName) {
	return fs.readFileSync(path.join(e2eFixturesDir, name, fileName), 'utf8');
}

function readJsonFixture(name, fileName) {
	return JSON.parse(readFixture(name, fileName));
}

function readModuleFixtureFiles(name) {
	const modulesDir = path.join(e2eFixturesDir, name, 'modules');
	const files = {};
	const walk = (dir) => {
		fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
			const filename = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(filename);
				return;
			}
			if (entry.isFile()) {
				files[filename] = fs.readFileSync(filename, 'utf8');
			}
		});
	};
	walk(modulesDir);
	return files;
}

function hasModuleFixture(name) {
	return fs.existsSync(path.join(e2eFixturesDir, name, 'modules'));
}

function hasExpectedErrorFixture(name) {
	return fs.existsSync(path.join(e2eFixturesDir, name, 'expected-error.txt'));
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expectNoOrphanedTemplateArtifacts(code) {
	const declarations = Array.from(code.matchAll(/\b(?:const|let|var)\s+(_uid\d*)\s*=\s*[^;]*(?:getLanguage(?:Replace|List|Control)|getTemplateRootPathArg|createTemplateRootDescriptor)[^;]*;/g));

	declarations.forEach((match) => {
		const variableName = match[1];
		const usages = code.match(new RegExp(`\\b${ escapeRegExp(variableName) }\\b`, 'g')) || [];
		expect(usages.length).toBeGreaterThan(1);
	});
}

const fixtureNames = fs.readdirSync(e2eFixturesDir)
	.filter((name) => fs.statSync(path.join(e2eFixturesDir, name)).isDirectory());
const moduleFixtureNames = fixtureNames.filter((name) => hasModuleFixture(name) && ! hasExpectedErrorFixture(name));
const moduleFailClosedFixtureNames = fixtureNames.filter((name) => hasModuleFixture(name) && hasExpectedErrorFixture(name));
const selectorFailClosedFixtureNames = fixtureNames.filter((name) => name.startsWith('store-selector-') && ! hasModuleFixture(name) && hasExpectedErrorFixture(name));
const selectorFixtureNames = fixtureNames.filter((name) => name.startsWith('store-selector-') && ! hasModuleFixture(name) && ! hasExpectedErrorFixture(name));
const stableFixtureNames = fixtureNames.filter((name) => ! name.startsWith('store-selector-') && ! hasModuleFixture(name));

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
		expectNoOrphanedTemplateArtifacts(code);
	});

	it.each(selectorFailClosedFixtureNames.flatMap((fixtureName) => (
		languages.map((language) => [ fixtureName, language ])
	)))('%s fails closed for unsupported selector output in %s', async (fixtureName, language) => {
		const source = readFixture(fixtureName, 'input.jsx');
		const expectedError = readFixture(fixtureName, 'expected-error.txt').trim();

		await expect(renderTemplateFixture(language, source, 'App', {}, {
			experimentalStoreSelectors: true,
			warnOnUnsupported: false,
		})).rejects.toThrow(expectedError);
	});

	it.each(moduleFixtureNames.flatMap((fixtureName) => (
		languages.map((language) => [ fixtureName, language ])
	)))('%s renders expected %s output with cross-file store selectors enabled', async (fixtureName, language) => {
		const fixtureConfig = readJsonFixture(fixtureName, 'fixture.json');
		const files = readModuleFixtureFiles(fixtureName);
		const manifest = createStoreSelectorCrossFileManifest(files);
		const entryFilename = path.join(e2eFixturesDir, fixtureName, 'modules', fixtureConfig.entry);
		const expected = readFixture(fixtureName, `expected.${ language }.html`);

		const { codeByFile, metadataByFile, output } = await renderTemplateModules(language, files, entryFilename, fixtureConfig.exportName, {}, {
			experimentalStoreSelectors: {
				crossFile: true,
				debug: true,
				__crossFileManifest: manifest,
			},
		});
		const combinedCode = Object.values(codeByFile).join('\n');
		const crossFileDebugEntries = Object.values(metadataByFile)
			.map(metadata => metadata.storeSelectorTemplateVarsCrossFile)
			.filter(Boolean);

		expect(manifest.diagnostics).toEqual([]);
		expect(normalizeTemplateOutput(output)).toBe(normalizeTemplateOutput(expected));
		expect(combinedCode).not.toContain('useStoreSelector');
		expect(combinedCode).not.toContain('$$');
		expectNoOrphanedTemplateArtifacts(combinedCode);
		expect(crossFileDebugEntries.length).toBeGreaterThan(0);
		expect(crossFileDebugEntries.some(entry => (
			(entry.importEdges || []).length > 0 ||
			(entry.callsiteContexts || []).length > 0 ||
			Object.keys(entry.childRelativeDiscovery || {}).length > 0
		))).toBe(true);
	});

	it.each(moduleFailClosedFixtureNames.flatMap((fixtureName) => (
		languages.map((language) => [ fixtureName, language ])
	)))('%s fails closed for unsupported cross-file selector output in %s', async (fixtureName, language) => {
		const fixtureConfig = readJsonFixture(fixtureName, 'fixture.json');
		const files = readModuleFixtureFiles(fixtureName);
		const entryFilename = path.join(e2eFixturesDir, fixtureName, 'modules', fixtureConfig.entry);
		const expectedError = readFixture(fixtureName, 'expected-error.txt').trim();

		await expect(async () => {
			const manifest = createStoreSelectorCrossFileManifest(files);
			await renderTemplateModules(language, files, entryFilename, fixtureConfig.exportName, {}, {
				experimentalStoreSelectors: {
					crossFile: true,
					debug: true,
					__crossFileManifest: manifest,
				},
				warnOnUnsupported: false,
			});
		}).rejects.toThrow(expectedError);
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
