# Handlebars support

The Handlebars language preset follows the same language conventions as the PHP
preset. Replacement variables and list variables use the shared `variables`
tokens, and control variables map to the same `ifTruthy`, `ifFalsy`, `ifEqual`,
and `ifNotEqual` control names emitted by the Babel transform.

## Required helpers

Handlebars supports truthy and falsy block rendering with built-in helpers, so
the preset maps those controls to `{{#if ...}}` and `{{#unless ...}}`.

Strict equality and strict inequality are not built into Handlebars. Any template
that uses `===` or `!==` control expressions requires these helpers to be
registered before rendering:

```js
Handlebars.registerHelper('if_equal', function (left, right, options) {
	return left === right ? options.fn(this) : options.inverse(this);
});

Handlebars.registerHelper('if_not_equal', function (left, right, options) {
	return left !== right ? options.fn(this) : options.inverse(this);
});
```

The package does not ship or register these helpers yet. For now, applications
using the Handlebars preset must provide compatible helpers themselves before
using strict equality or strict inequality control variables.

## Roadmap

- Ship a helper registration module for Handlebars consumers.
- Document where the helper registration belongs in the prerender pipeline.
- Verify and update ternary control output for Handlebars. Handlebars places
  `{{else}}` inside the active block before the closing tag, while the current
  control code is structured around the PHP-style close-then-else pattern.
