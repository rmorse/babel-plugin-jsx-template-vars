# Testing guidelines

This project uses Vitest for unit and transform-level tests. Tests should make
the Babel transform safer to change by covering the behavior we rely on, not the
incidental formatting of every generated node.

## Running tests

Run the full test suite:

```sh
npm test
```

Run tests in watch mode while developing:

```sh
npm run test:watch
```

Run tests with coverage:

```sh
npm run test:coverage
```

Coverage is useful as a baseline signal, but it is not a substitute for
asserting the transform behavior that matters. Prefer meaningful coverage over
chasing a percentage.

## Test locations

Unit tests live beside the JavaScript files they cover:

```text
utils.js
utils.test.js
controllers/control.js
controllers/control.test.js
```

Transform-level and end-to-end tests live at the repository root when they cover
the plugin as a whole:

```text
index.test.js
e2e.test.js
```

Shared test helpers live in:

```text
test-utils/
```

Do not add production code to `test-utils`. It is excluded from published npm
packages.

End-to-end sample fixtures live in:

```text
fixtures/e2e/<case-name>/input.jsx
fixtures/e2e/<case-name>/expected.handlebars.html
fixtures/e2e/<case-name>/expected.php.html
```

Fixtures should represent final output contracts. Prefer a small number of
realistic fixtures over many tiny fixtures that duplicate unit coverage.

## What to test

Use colocated unit tests for small, deterministic behavior:

- parsing config objects and arrays from Babel AST nodes
- choosing control statement types
- building language call expressions
- regression tests for narrow controller behavior

Use language schema tests when controller code expects language preset keys.
These tests should catch drift between `php.json`, `handlebars.json`, and the
runtime lookup conventions.

Use transform-level tests when behavior depends on multiple parts working
together. These tests should cover realistic JSX components and assert the PHP
or Handlebars output that a prerender pipeline depends on.

## Test ethos

Write tests against observable behavior. For small unit tests, direct object
assertions are fine. For transform tests, prefer asserting important output
fragments over snapshotting an entire generated file unless the exact full
output is the behavior under test.

Keep fixtures realistic but small. A good fixture should cover one meaningful
workflow, such as replacement variables plus list wrapping, without becoming a
second application.

When fixing a bug, add the smallest regression test that would have failed
before the fix. If the bug crosses controllers or language runtime behavior,
also add or update a transform-level test.

Avoid tests that depend on generated Babel uid names unless the uid behavior is
the thing being tested. Generated names can change when nearby code changes.

## End-to-end transform harness

The current transform harness in `test-utils/transform.js` uses Babel directly
with this plugin and a test-only JSX pragma. It can render transformed JSX
without adding React or Preact as test dependencies.

Use it when a test needs to verify final template strings for both PHP and
Handlebars. Keep the helper generic; language-specific expectations belong in
the tests.

For fixture-based e2e tests, compare the normalized final rendered template
output against expected output files. These tests should catch regressions in
the public PHP/Handlebars template contract, not incidental generated Babel
formatting.

## Package hygiene

Tests, test helpers, Vitest config, coverage output, and `node_modules` are not
published to npm. If new test-only directories or generated outputs are added,
update `.npmignore` and `.gitignore` as needed.
