import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import babel from '@babel/core';

const require = createRequire(import.meta.url);
const {
	getArrayFromExpression,
	getExpressionArgs,
} = require('./utils');

function expressionFrom(source) {
	const ast = babel.parseSync(`const value = ${ source };`);
	return ast.program.body[0].declarations[0].init;
}

describe('utils', () => {
	it('reads nested template var config arrays from Babel expressions', () => {
		const expression = expressionFrom(`[
			'name',
			[
				'items',
				{
					type: 'list',
					aliases: [ 'renderedItems' ],
					child: {
						type: 'object',
						props: [ 'label', 'active' ],
					},
				},
			],
		]`);

		expect(getArrayFromExpression(expression)).toEqual([
			'name',
			[
				'items',
				{
					type: 'list',
					aliases: [ 'renderedItems' ],
					child: {
						type: 'object',
						props: [ 'label', 'active' ],
					},
				},
			],
		]);
	});

	it('extracts identifiers and literal values from control expressions', () => {
		const expression = expressionFrom(`status === 'ready'`);

		expect(getExpressionArgs(expression, babel.types)).toEqual([
			{ type: 'identifier', value: 'status' },
			{ type: 'value', value: "'ready'" },
		]);
	});

	it('extracts structured path args from member expressions', () => {
		const expression = expressionFrom(`hero.media.url === 'ready'`);

		expect(getExpressionArgs(expression, babel.types)).toEqual([
			{
				type: 'path',
				value: 'hero.media.url',
				segments: [ 'hero', 'media', 'url' ],
			},
			{ type: 'value', value: "'ready'" },
		]);
	});
});
