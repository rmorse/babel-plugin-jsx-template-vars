import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
	useStoreSelector,
} = require('./store');

describe('store selector runtime helper', () => {
	it('returns undefined for one-argument calls without runtime state', () => {
		expect(useStoreSelector((state) => state.hero.title)).toBeUndefined();
	});

	it('runs a selector against provided state', () => {
		expect(useStoreSelector((state) => state.hero.title, {
			hero: {
				title: 'Example',
			},
		})).toBe('Example');
	});

	it('rejects non-function selectors', () => {
		expect(() => useStoreSelector(null)).toThrow(/expects a selector function/);
	});
});
