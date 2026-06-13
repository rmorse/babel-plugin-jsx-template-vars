# Handlebars support

The Handlebars language preset follows the same language conventions as the PHP
preset. Replacement variables and list variables use the shared `variables`
tokens, and control variables map to the same `ifTruthy`, `ifFalsy`, `ifEqual`,
and `ifNotEqual` control names emitted by the Babel transform.

## Required helpers

Handlebars supports truthy and falsy block rendering with built-in helpers, so
the preset maps those controls to `{{#if ...}}` and `{{#unless ...}}`.

Strict equality and strict inequality are not built into Handlebars. Any
template that uses `===` or `!==` control expressions requires compatible
helpers to be registered before rendering. This package ships those helpers:

```js
const {
	registerJsxTemplateVarsHandlebarsHelpers,
} = require('babel-plugin-jsx-template-vars/handlebars-helpers');

registerJsxTemplateVarsHandlebarsHelpers(Handlebars);
```

The module registers:

- `if_equal`: strict `===`
- `if_not_equal`: strict `!==`

Both helpers support the main block and inverse block because ternary
expressions emit `{{else}}` inside the helper block.

## Ternary output

Ternary control expressions are emitted as normal Handlebars inverse blocks. For
example, `status === 'ready' ? 'Ready' : 'Waiting'` renders as:

```hbs
{{#if_equal status 'ready'}}Ready{{else}}Waiting{{/if_equal}}
```

The generated output assumes the equality helpers described above are available
before the template is rendered.
