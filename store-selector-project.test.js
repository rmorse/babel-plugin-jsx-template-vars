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

	it('discovers tsconfig paths for components and transparent hooks', async () => {
		const rootDir = createTempProject({
			'tsconfig.json': JSON.stringify({
				compilerOptions: {
					baseUrl: 'src',
					paths: {
						'@app': [ 'index.jsx' ],
						'@hooks': [ 'hooks/index.jsx' ],
						'@hooks/*': [ 'hooks/*' ],
					},
				},
			}),
			'src/components/Header.jsx': `
				export const Header = ({ hero }) => <h1>{ hero.title }</h1>;
			`,
			'src/hooks/index.jsx': `
				export { useCurrentHero } from './useCurrentHero.jsx';
			`,
			'src/hooks/useCurrentHero.jsx': `
				export function useCurrentHero(hero) {
					return hero;
				}
			`,
			'src/hooks/useHeroStatus.jsx': `
				export function useHeroStatus(hero) {
					return hero.status;
				}
			`,
			'src/hooks/useHeroView.jsx': `
				export function useHeroView(hero) {
					return {
						title: hero.kicker,
					};
				}
			`,
			'src/index.jsx': `
				export { Header } from './components/Header.jsx';
				export { useHeroView } from './hooks/useHeroView.jsx';
			`,
			'src/App.jsx': `
				import { Header, useHeroView } from '@app';
				import * as Hooks from '@hooks';
				import { useHeroStatus } from '@hooks/useHeroStatus';
				import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

				const App = () => {
					const hero = useStoreSelector((state) => state.hero);
					const currentHero = Hooks.useCurrentHero(hero);
					const view = useHeroView(currentHero);
					const status = useHeroStatus(currentHero);
					return (
						<main>
							<Header hero={ currentHero } />
							<aside>{ view.title } { status }</aside>
						</main>
					);
				};

				module.exports = { App };
			`,
		});

		try {
			const manifest = createStoreSelectorProjectManifest({ rootDir });
			const babelOptions = createStoreSelectorBabelOptions(manifest, {
				experimentalStoreSelectors: {
					debug: true,
				},
			});

			expect(manifest.diagnostics).toEqual([]);
			expect(manifest.projectResolver).toEqual(expect.objectContaining({
				baseUrl: path.join(rootDir, 'src'),
				aliases: expect.objectContaining({
					'@hooks': path.join(rootDir, 'src/hooks'),
				}),
				exactAliases: expect.objectContaining({
					'@app': path.join(rootDir, 'src/index.jsx'),
					'@hooks': path.join(rootDir, 'src/hooks/index.jsx'),
				}),
			}));
			expect(manifest.debug.importEdges).toEqual(expect.arrayContaining([
				expect.objectContaining({
					importSource: '@app',
					localName: 'Header',
					targetFilename: path.join(rootDir, 'src/components/Header.jsx'),
				}),
			]));
			expect(manifest.debug.hookImportEdges).toEqual(expect.arrayContaining([
				expect.objectContaining({
					importSource: '@app',
					localName: 'useHeroView',
					targetFilename: path.join(rootDir, 'src/hooks/useHeroView.jsx'),
				}),
				expect.objectContaining({
					importSource: '@hooks',
					localName: 'Hooks.useCurrentHero',
					targetFilename: path.join(rootDir, 'src/hooks/useCurrentHero.jsx'),
				}),
				expect.objectContaining({
					importSource: '@hooks/useHeroStatus',
					localName: 'useHeroStatus',
					targetFilename: path.join(rootDir, 'src/hooks/useHeroStatus.jsx'),
				}),
			]));
			expect(manifest.seedAliasesByFile[path.join(rootDir, 'src/components/Header.jsx')].Header).toEqual([
				expect.objectContaining({
					localName: 'hero',
					segments: [ 'hero' ],
				}),
			]);
			expect(babelOptions.resolver).toBe(manifest.projectResolver);
		} finally {
			removeTempProject(rootDir);
		}
	});

	it('discovers jsconfig baseUrl imports', () => {
		const rootDir = createTempProject({
			'jsconfig.json': JSON.stringify({
				compilerOptions: {
					baseUrl: 'src',
				},
			}),
			'src/components/Header.jsx': `
				export const Header = ({ hero }) => <h1>{ hero.title }</h1>;
			`,
			'src/App.jsx': `
				import { Header } from 'components/Header';
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

			expect(manifest.diagnostics).toEqual([]);
			expect(manifest.projectResolver.baseUrl).toBe(path.join(rootDir, 'src'));
			expect(manifest.debug.importEdges).toEqual([
				expect.objectContaining({
					importSource: 'components/Header',
					targetFilename: path.join(rootDir, 'src/components/Header.jsx'),
				}),
			]);
		} finally {
			removeTempProject(rootDir);
		}
	});

	it('fails closed for unsafe tsconfig path mappings when crossed by selector imports', () => {
		const rootDir = createTempProject({
			'tsconfig.json': JSON.stringify({
				compilerOptions: {
					baseUrl: 'src',
					paths: {
						'@ambiguous/*': [ 'components/*', 'other/*' ],
						'@outside/*': [ '../../outside/*' ],
					},
				},
			}),
			'src/App.jsx': `
				import { Header } from '@ambiguous/Header';
				import { Card } from '@outside/Card';
				import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

				const App = () => {
					const hero = useStoreSelector((state) => state.hero);
					return (
						<main>
							<Header hero={ hero } />
							<Card hero={ hero } />
						</main>
					);
				};

				module.exports = { App };
			`,
		});

		try {
			const manifest = createStoreSelectorProjectManifest({ rootDir });

			expect(manifest.diagnostics).toEqual(expect.arrayContaining([
				expect.objectContaining({
					kind: 'ambiguous-path-mapping',
					source: '@ambiguous/Header',
					localName: 'Header',
				}),
				expect.objectContaining({
					kind: 'out-of-root-path-mapping',
					source: '@outside/Card',
					localName: 'Card',
				}),
			]));
			expect(manifest.projectResolverDiagnostics).toEqual(expect.arrayContaining([
				expect.objectContaining({
					kind: 'ambiguous-path-mapping',
					alias: '@ambiguous',
				}),
				expect.objectContaining({
					kind: 'out-of-root-path-mapping',
					alias: '@outside',
				}),
			]));
			expect(manifest.componentNamesByFile).toEqual({});
			expect(manifest.seedAliasesByFile).toEqual({});
		} finally {
			removeTempProject(rootDir);
		}
	});

	it('creates Babel options that keep manifest internals behind the wrapper', () => {
		const manifest = {
			seedAliasesByFile: {},
			componentNamesByFile: {},
			diagnostics: [],
			projectResolver: {
				aliases: {
					'@app': '/project/src',
				},
			},
		};
		const options = createStoreSelectorBabelOptions(manifest, {
			language: 'handlebars',
			experimentalStoreSelectors: {
				debug: true,
			},
		});

		expect(options.language).toBe('handlebars');
		expect(options.resolver).toEqual({
			aliases: {
				'@app': '/project/src',
			},
		});
		expect(options.experimentalStoreSelectors).toEqual({
			debug: true,
			crossFile: true,
			__crossFileManifest: manifest,
		});
	});
});
