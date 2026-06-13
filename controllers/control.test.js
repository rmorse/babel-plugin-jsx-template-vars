import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import babel from '@babel/core';
import {
	normalizeTemplateOutput,
	renderTemplateFixture,
} from '../test-utils/transform.js';

const require = createRequire(import.meta.url);
const {
	ControlController,
	createCombinedBinaryExpression,
} = require('./control');

function expressionFrom(source) {
	const ast = babel.parseSync(`const value = ${ source };`);
	return ast.program.body[0].declarations[0].init;
}

describe('ControlController', () => {
	it('maps supported control expressions to language control names', () => {
		const controller = new ControlController({ names: [ 'visible', 'status' ] }, '_context', babel);

		expect(controller.getExpressionStatement(expressionFrom('visible'))).toEqual({
			statementType: 'ifTruthy',
			args: [ { type: 'identifier', value: 'visible' } ],
		});
		expect(controller.getExpressionStatement(expressionFrom('!visible'))).toEqual({
			statementType: 'ifFalsy',
			args: [ { type: 'identifier', value: 'visible' } ],
		});
		expect(controller.getExpressionStatement(expressionFrom(`status === 'ready'`))).toEqual({
			statementType: 'ifEqual',
			args: [
				{ type: 'identifier', value: 'status' },
				{ type: 'value', value: "'ready'" },
			],
		});
		expect(controller.getExpressionStatement(expressionFrom(`status !== 'ready'`))).toEqual({
			statementType: 'ifNotEqual',
			args: [
				{ type: 'identifier', value: 'status' },
				{ type: 'value', value: "'ready'" },
			],
		});
	});

	it('leaves expressions without configured control identifiers unmatched', () => {
		const controller = new ControlController({ names: [ 'visible' ] }, '_context', babel);

		expect(controller.getExpressionStatement(expressionFrom(`status === 'ready'`))).toEqual({
			statementType: undefined,
			args: [
				{ type: 'identifier', value: 'status' },
				{ type: 'value', value: "'ready'" },
			],
		});
	});

	it('combines generated language parts into a left-associative binary expression', () => {
		const expression = createCombinedBinaryExpression([
			babel.types.stringLiteral('a'),
			babel.types.stringLiteral('b'),
			babel.types.stringLiteral('c'),
		], '+', babel.types);

		expect(expression).toMatchObject({
			type: 'BinaryExpression',
			operator: '+',
			left: {
				type: 'BinaryExpression',
				operator: '+',
				left: { value: 'a' },
				right: { value: 'b' },
			},
			right: { value: 'c' },
		});
	});

	it('renders ternary controls as inverse blocks for both language presets', async () => {
		const source = `
			const App = ({ status }) => {
				return (
					<p>
						{ status === 'ready' ? <strong>Ready</strong> : <span>Waiting</span> }
					</p>
				);
			};

			App.templateVars = [
				[ 'status', { type: 'control' } ],
			];

			module.exports = { App };
		`;

		const handlebars = await renderTemplateFixture('handlebars', source, 'App', {});
		const php = await renderTemplateFixture('php', source, 'App', {});

		expect(normalizeTemplateOutput(handlebars.output)).toBe(
			"<p>{{#if_equal status 'ready'}}<strong>Ready</strong>{{else}}<span>Waiting</span>{{/if_equal}}</p>"
		);
		expect(normalizeTemplateOutput(php.output)).toBe(
			"<p><?php if ( $data['status'] === 'ready' ) { ?><strong>Ready</strong><?php } else { ?><span>Waiting</span><?php } ?></p>"
		);
	});
});
