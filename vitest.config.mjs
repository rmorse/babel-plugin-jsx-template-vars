import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: [ '**/*.test.js' ],
		coverage: {
			exclude: [
				'coverage/**',
				'fixtures/**',
				'test-utils/**',
				'**/*.test.js',
			],
			reporter: [ 'text', 'json-summary' ],
		},
	},
});
