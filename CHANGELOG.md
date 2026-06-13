# Changelog

## 0.1.0-beta.0

This release replaces the old public `templateVars` declaration model with the
flat template variable architecture.

### Breaking Changes

- `templateVars` entries must now be flat string paths.
- Legacy declaration entries such as `[ 'status', { type: 'control' } ]`,
  `[ 'items', { type: 'list', child: ... } ]`, alias config, child config, props
  config, and nested public config objects are no longer supported.
- Non-string `templateVars` entries now fail deliberately during transform.
- Object root lists can no longer render directly as `{ products }`; render them
  through `.map()`, a supported render alias, or a helper call with a single
  declared list source.

### New Template Vars Contract

Declare the data contract as flat paths:

```jsx
Component.templateVars = [
	'title',
	'hero.summary',
	'items[]',
	'items[].label',
	'catalog.sections[].products[].badges[].label',
];
```

Supported path behavior:

- scalar paths, such as `title`
- nested object paths, such as `hero.media.url`
- primitive list paths, such as `tags[]`
- recursive object/list paths, such as
  `catalog.sections[].products[].badges[].label`
- component-local declarations; child components still declare their own
  `templateVars`

### Architecture

The transform now follows this model:

```txt
templateVars -> normalized registry -> usage-site tagging -> derived controller inputs
```

The normalized registry owns path parsing, validation, identity, and shape. AST
usage-site tagging then infers how each declared path is used: replacement,
control, list, or multiple roles at once. Controllers consume the derived
internal views instead of accepting old user-facing config objects.

This unlocks:

- automatic role inference from JSX usage
- multiple roles for the same declared path
- one generated identity per declared path
- path-aware language arguments for custom language presets
- PHP nested array output, such as `$data['hero']['summary']`
- Handlebars dotted path output, such as `{{hero.summary}}`
- recursive list context output for mixed object/list paths

### Source Pattern Support

The flat API supports:

- bare identifiers
- simple and nested member paths
- optional member paths
- destructure renames and intermediate aliases
- direct `.map()` usage on declared list paths
- nested map callbacks
- safe chained list transforms before `.map()`
- same-scope render aliases assigned from `.map()`
- reassigned render aliases
- helper calls with one declared list source
- declared spread props in mapped child components
- logical and ternary controls

Unsupported but recognizable patterns warn by default and can be promoted to
transform errors with `strict: true`.

### Handlebars Helpers

Handlebars equality and ternary-style control output requires the shipped helper
registration module:

```js
const {
	registerJsxTemplateVarsHandlebarsHelpers,
} = require('babel-plugin-jsx-template-vars/handlebars-helpers');

registerJsxTemplateVarsHandlebarsHelpers(Handlebars);
```

The module registers strict equality and strict inequality helpers used by the
generated Handlebars output.

### Still Out Of Scope

- helper/render aliases that combine multiple declared list roots
- arbitrary helper-body dataflow analysis
- automatic cross-component inference

### Verification

Release verification should run:

```sh
npm test
npm run test:coverage
npm pack --dry-run
```
