import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const languageDir = path.join(__dirname, 'languages');

function readLanguage(name) {
	return JSON.parse(fs.readFileSync(path.join(languageDir, `${ name }.json`), 'utf8'));
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
					close: expect.any(String),
				},
			},
		});
	});

	it('documents the required Handlebars equality helper names in the preset', () => {
		const handlebars = readLanguage('handlebars');

		expect(handlebars.control.ifEqual.open).toBe('{{#if_equal [%variable] [%variable]}}');
		expect(handlebars.control.ifNotEqual.open).toBe('{{#if_not_equal [%variable] [%variable]}}');
	});
});
