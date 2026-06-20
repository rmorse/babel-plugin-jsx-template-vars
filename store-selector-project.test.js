import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import projectSelectors from './store-selector-project.js';

const {
	createStoreSelectorBabelOptions,
	createStoreSelectorProjectManifest,
	getProjectSourceFiles,
} = projectSelectors;

function createTempProject(files) {
	const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsx-template-vars-store-selector-'));
	Object.entries(files).forEach(([ filename, source ]) => {
		const target = path.join(rootDir, filename);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, source, 'utf8');
	});
	return rootDir;
}

function removeTempProject(rootDir) {
	fs.rmSync(rootDir, { recursive: true, force: true });
}

describe('store selector project manifest wrapper', () => {
	it('discovers project files deterministically and ignores unsupported directories', () => {
		const rootDir = createTempProject({
			'App.jsx': 'export const App = () => null;',
			'components/Header.jsx': 'export const Header = () => null;',
			'components/Notes.md': '# ignored',
			'node_modules/pkg/Widget.jsx': 'export const Widget = () => null;',
		});

		try {
			const files = getProjectSourceFiles(rootDir, {
				extensions: new Set([ '.jsx' ]),
				ignoreDirs: new Set([ 'node_modules' ]),
			});

			expect(files.map(filename => path.relative(rootDir, filename))).toEqual([
				'App.jsx',
				path.join('components', 'Header.jsx'),
			]);
		} finally {
			removeTempProject(rootDir);
		}
	});

	it('creates a cross-file manifest from filesystem sources', () => {
		const rootDir = createTempProject({
			'Header.jsx': `
				export const Header = ({ hero }) => <h1>{ hero.title }</h1>;
			`,
			'App.jsx': `
				import { Header } from './Header.jsx';
				import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

				const App = () => {
					const hero = useStoreSelector((state) => state.hero);
					return <Header hero={ hero } />;
				};

				module.exports = { App };
			`,
		});

		try {
			const manifest = createStoreSelectorProjectManifest({ rootDir });
			const headerFilename = path.join(rootDir, 'Header.jsx');

			expect(manifest.projectRoot).toBe(rootDir);
			expect(manifest.projectFiles.map(filename => path.relative(rootDir, filename))).toEqual([
				'App.jsx',
				'Header.jsx',
			]);
			expect(manifest.diagnostics).toEqual([]);
			expect(manifest.seedAliasesByFile[headerFilename].Header).toEqual([
				expect.objectContaining({
					localName: 'hero',
					segments: [ 'hero' ],
				}),
			]);
		} finally {
			removeTempProject(rootDir);
		}
	});

	it('creates Babel options that keep manifest internals behind the wrapper', () => {
		const manifest = {
			seedAliasesByFile: {},
			componentNamesByFile: {},
			diagnostics: [],
		};
		const options = createStoreSelectorBabelOptions(manifest, {
			language: 'handlebars',
			experimentalStoreSelectors: {
				debug: true,
			},
		});

		expect(options.language).toBe('handlebars');
		expect(options.experimentalStoreSelectors).toEqual({
			debug: true,
			crossFile: true,
			__crossFileManifest: manifest,
		});
	});
});
