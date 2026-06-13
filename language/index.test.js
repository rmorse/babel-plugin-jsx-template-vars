import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	createLanguageString,
	getLanguageControl,
	getLanguageList,
	getLanguageReplace,
	getLanguageString,
} from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const languageDir = path.join(__dirname, 'languages');

function readLanguage(name) {
	return JSON.parse(fs.readFileSync(path.join(languageDir, `${ name }.json`), 'utf8'));
}

function withLanguage(language, callback) {
	const previousWindow = globalThis.window;
	globalThis.window = {
		templateVarsLanguage: language,
	};

	try {
		return callback();
	} finally {
		if (typeof previousWindow === 'undefined') {
			delete globalThis.window;
		} else {
			globalThis.window = previousWindow;
		}
	}
}

describe('language presets', () => {
	it.each([ 'handlebars', 'php' ])('%s defines the language keys used by the controllers', (name) => {
		const language = readLanguage(name);

		expect(language).toMatchObject({
			variables: expect.any(Object),
			language: {
				open: expect.any(String),
				close: expect.any(String),
			},
			replace: {
				format: expect.any(String),
			},
			list: {
				open: expect.any(String),
				close: expect.any(String),
				objectProperty: expect.any(String),
				primitive: expect.any(String),
			},
			control: {
				ifTruthy: {
					open: expect.any(String),
					close: expect.any(String),
				},
				ifFalsy: {
					open: expect.any(String),
					close: expect.any(String),
				},
				ifEqual: {
					open: expect.any(String),
					close: expect.any(String),
				},
				ifNotEqual: {
					open: expect.any(String),
					close: expect.any(String),
				},
				else: {
					open: expect.any(String),
				},
			},
		});
	});

	it('does not keep legacy PHP generic control tokens in the preset', () => {
		const php = readLanguage('php');

		expect(php.control).not.toHaveProperty('if');
		expect(php.control).not.toHaveProperty('elseif');
		expect(php.control).not.toHaveProperty('end');
		expect(php.control.else).not.toHaveProperty('close');
	});

	it('documents the required Handlebars equality helper names in the preset', () => {
		const handlebars = readLanguage('handlebars');

		expect(handlebars.control.ifEqual.open).toBe('{{#if_equal [%variable] [%variable]}}');
		expect(handlebars.control.ifNotEqual.open).toBe('{{#if_not_equal [%variable] [%variable]}}');
	});
});

describe('language runtime', () => {
	it('expands PHP variable tags with context-aware data names', () => {
		const php = readLanguage('php');

		expect(createLanguageString(
			'echo [%variable];',
			[ { type: 'identifier', value: 'title' } ],
			0,
			php.variables
		)).toBe("echo $data['title'];");

		expect(createLanguageString(
			'echo [%subvariable];',
			[ { type: 'identifier', value: 'label' } ],
			1,
			php.variables
		)).toBe("echo $data_2['label'];");
	});

	it('passes literal comparison values through variable tags', () => {
		const php = readLanguage('php');

		expect(createLanguageString(
			'[%variable]',
			[ { type: 'value', value: "'ready'" } ],
			0,
			php.variables
		)).toBe("'ready'");
	});

	it('expands structured path args for PHP and Handlebars presets', () => {
		const php = readLanguage('php');
		const handlebars = readLanguage('handlebars');
		const pathArg = {
			type: 'path',
			value: 'hero.summary',
			segments: [ 'hero', 'summary' ],
		};

		withLanguage(php, () => {
			expect(getLanguageReplace('format', pathArg, 0)).toBe("echo $data['hero']['summary'];");
			expect(getLanguageControl([ 'ifTruthy', 'open' ], [ pathArg ], 0)).toBe("if ( $data['hero']['summary'] ) {");
		});

		withLanguage(handlebars, () => {
			expect(getLanguageReplace('format', pathArg, 0)).toBe('{{hero.summary}}');
			expect(getLanguageControl([ 'ifTruthy', 'open' ], [ pathArg ], 0)).toBe('{{#if hero.summary}}');
		});
	});

	it('applies per-argument context offsets for nested list controls', () => {
		const php = readLanguage('php');

		withLanguage(php, () => {
			expect(getLanguageControl(
				[ 'ifTruthy', 'open' ],
				[
					{
						type: 'identifier',
						value: 'available',
						segments: [ 'available' ],
						contextOffset: 2,
					},
				],
				0
			)).toBe("if ( $data_2['available'] ) {");
		});
	});

	it('reads nested language strings from the active language preset', () => {
		const php = readLanguage('php');

		withLanguage(php, () => {
			expect(getLanguageString([ 'language', 'open' ], [], 0)).toBe('<?php ');
			expect(getLanguageReplace('format', { value: 'title' }, 0)).toBe("echo $data['title'];");
			expect(getLanguageList('open', { type: 'identifier', value: 'items' }, 0)).toBe("foreach ( $data['items'] as $data_1 ) {");
			expect(getLanguageControl(
				[ 'ifEqual', 'open' ],
				[
					{ type: 'identifier', value: 'status' },
					{ type: 'value', value: "'ready'" },
				],
				0
			)).toBe("if ( $data['status'] === 'ready' ) {");
			expect(getLanguageControl([ 'else', 'open' ], [], 0)).toBe('} else {');
		});
	});

	it('expands Handlebars runtime strings without language wrappers', () => {
		const handlebars = readLanguage('handlebars');

		withLanguage(handlebars, () => {
			expect(getLanguageString([ 'language', 'open' ], [], 0)).toBe('');
			expect(getLanguageReplace('format', { value: 'title' }, 0)).toBe('{{title}}');
			expect(getLanguageList('objectProperty', { type: 'identifier', value: 'label' }, 1)).toBe('{{label}}');
			expect(getLanguageControl(
				[ 'ifNotEqual', 'open' ],
				[
					{ type: 'identifier', value: 'status' },
					{ type: 'value', value: "'archived'" },
				],
				0
			)).toBe("{{#if_not_equal status 'archived'}}");
		});
	});
});
