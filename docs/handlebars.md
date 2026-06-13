# Handlebars support

The Handlebars language preset follows the same language conventions as the PHP
preset. Replacement variables and list variables use the shared `variables`
tokens, and control variables map to the same `ifTruthy`, `ifFalsy`, `ifEqual`,
and `ifNotEqual` control names emitted by the Babel transform.

## Required helpers

Handlebars supports truthy and falsy block rendering with built-in helpers, so
the preset maps those controls to `{{#if ...}}` and `{{#unless ...}}`.

Strict equality and strict inequality are not built into Handlebars. Any template
that uses `===` or `!==` control expressions requires compatible helpers to be
registered before rendering. Those helpers must support both the main block and
the inverse block because ternary expressions emit `{{else}}` inside the helper
block:

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
using strict equality or strict inequality control variables. That can be a
project-local helper implementation or an off-the-shelf Handlebars helper
package, as long as it uses the helper names and inverse-block behavior above.

## Ternary output

Ternary control expressions are emitted as normal Handlebars inverse blocks. For
example, `status === 'ready' ? 'Ready' : 'Waiting'` renders as:

```hbs
{{#if_equal status 'ready'}}Ready{{else}}Waiting{{/if_equal}}
```

The generated output assumes the equality helpers described above are available.
This package does not create or register those helpers yet.

## Roadmap

- Ship a helper registration module for Handlebars consumers, or document a
  supported off-the-shelf helper package.
- Document where the helper registration belongs in the prerender pipeline.
