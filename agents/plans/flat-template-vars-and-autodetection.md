# Flat template vars and autodetection plan

## Context

The current public API asks users to declare template variables and, for anything
that is not a simple replacement, provide internal transform details:

```js
Component.templateVars = [
	'name',
	[ 'visible', { type: 'control' } ],
	[
		'products',
		{
			type: 'list',
			child: {
				type: 'object',
				props: [ 'title', 'price' ],
			},
		},
	],
];
```

This exposes too much of the implementation model. The intended direction is a
flat data-path declaration API, with the transform inferring usage roles from
AST context where it can do so safely.

```js
Component.templateVars = [
	'name',
	'visible',
	'hero.title',
	'products[].title',
	'products[].price',
	'products[].available',
	'products[].badges[].label',
];
```

## Goals

- Preserve existing behavior with regression tests before changing the model.
- Introduce flat path notation for objects and lists.
- Support multiple usage roles for the same declared variable or path.
- Keep explicit legacy config working as an escape hatch and compatibility path.
- Keep inference conservative: infer only when source usage is clear.
- Keep custom language output stable by preserving the existing language preset
  contract unless a separate language change is explicitly required.

## Non-goals

- Do not attempt full automatic discovery of every dynamic value in a component.
  Users should still explicitly declare the template data contract.
- Do not require runtime proof that a declared path exists in data. A declaration
  like `products[].title` is a user-owned template contract.
- Do not remove legacy nested config until the flat API is proven and documented.
- Do not infer complex list child shape from ambiguous patterns such as spread
  props in the first pass.

## Key model change

The current buckets are mutually exclusive:

```js
{
	replace: [],
	control: [],
	list: [],
}
```

That is too restrictive. A single value can be used in multiple ways:

```jsx
<h1>{ status }</h1>
{ status === 'published' && <Badge /> }

{ products && <section>{ products.map(...) }</section> }
```

In this model:

- `status` is both replacement and control.
- `products` is both control and list.
- `products[].available` may be both replacement and control inside an item
  component.

The target internal model should represent:

- declared path: `products[].available`
- shape: scalar, object, list
- roles: replace, control, list
- context depth: root, list item, nested list item

## Proposed internal registry

Build one normalized registry from `templateVars`, then derive controller inputs
from that registry.

Conceptual shape:

```js
{
	paths: {
		status: {
			path: 'status',
			segments: [ 'status' ],
			roles: [ 'replace', 'control' ],
		},
		products: {
			path: 'products',
			segments: [ 'products' ],
			shape: 'list',
			roles: [ 'list', 'control' ],
			children: {
				title: {
					path: 'products[].title',
					roles: [ 'replace' ],
				},
				available: {
					path: 'products[].available',
					roles: [ 'replace', 'control' ],
				},
			},
		},
	},
}
```

The exact implementation can be simpler, but this is the conceptual separation
we need: paths describe data, roles describe usage.

## Flat path grammar

Supported first-pass grammar:

```txt
title
hero.title
hero.media.url
products[]
products[].title
products[].price
products[].badges[]
products[].badges[].label
```

Rules:

- `foo` declares a root scalar/object path.
- `foo.bar` declares a nested object property.
- `foo[]` declares a primitive list.
- `foo[].bar` declares an object-list child property.
- `foo[].bar[]` declares a nested primitive list.
- `foo[].bar[].baz` declares a nested object-list child property.

Validation should reject contradictory declarations once the rules are clear,
for example treating the same path as both primitive and object list in the same
component.

## Test-first sequence

Before implementation changes, add tests that lock current behavior:

- Existing replace variables still render in text and attributes.
- Existing control variables still render truthy, falsy, equality, inequality,
  and ternary output for PHP and Handlebars.
- Existing list variables still render primitive lists, object lists, list aliases,
  direct `.map()` output, pre-rendered alias output, and nested list placeholders.
- Current overlapping behavior is documented by tests:
  - a list rendered as `{ renderedItems }` is wrapped with list tags.
  - a control wrapping a list output emits control tags outside list tags.
  - a value cannot currently be both explicit `replace` and explicit `control`
    without duplicated declarations or unintended behavior.
- Nested component behavior is captured:
  - parent list context increments child component context.
  - child components still require their own `templateVars` to transform their
    internal usage.

These tests should use focused unit tests for parser/controller behavior and e2e
fixtures for final PHP/Handlebars output.

## Phase 1: parser support for flat paths

Add path parsing without changing runtime behavior yet.

Deliverables:

- Parse string declarations into path segment metadata.
- Preserve existing string declarations like `name`.
- Preserve existing array config declarations.
- Convert simple flat list paths into the existing list config shape internally:

```js
[
	'products[].title',
	'products[].price',
]
```

becomes equivalent to:

```js
[
	[
		'products',
		{
			type: 'list',
			child: {
				type: 'object',
				props: [ 'title', 'price' ],
			},
		},
	],
]
```

This phase should avoid changing controller behavior where possible.

## Phase 2: nested object path output

Support object paths such as:

```js
Component.templateVars = [ 'hero.title', 'hero.media.url' ];
```

Important language implications:

- Handlebars can naturally emit `{{hero.title}}`.
- PHP should emit nested array access, for example:

```php
$data['hero']['title']
$data['hero']['media']['url']
```

This likely requires path-aware language argument handling rather than treating
`hero.title` as a single variable name.

## Phase 3: conservative role inference

Infer usage roles from AST context for declared paths without explicit `type`.

Initial inference rules:

- Control role:
  - identifier/path appears in supported logical expression conditions.
  - identifier/path appears in supported ternary test expressions.
- List role:
  - root path appears as receiver of `.map()`.
  - root path has `[]` in its flat declaration.
- Replace role:
  - identifier/path appears in JSX text or JSX attributes.
  - fallback role when no stronger usage is detected.

Explicit legacy config remains authoritative.

## Phase 4: multi-role controller inputs

Move from exclusive buckets to derived controller views.

The registry can derive:

- replace controller vars for replacement occurrences.
- control controller vars for supported condition occurrences.
- list controller vars for list declaration and wrapping.

Avoid generating separate UIDs for the same variable path per role unless the
current transform absolutely requires it. Duplicated generated identifiers are a
likely source of incorrect output when one variable is used in multiple roles.

## Phase 5: docs and migration

Update README/wiki-facing docs to make the flat API primary:

```js
Component.templateVars = [
	'title',
	'visible',
	'hero.title',
	'products[].title',
	'products[].price',
	'products[].badges[].label',
];
```

Document legacy config as supported advanced configuration.

Document limitations:

- Explicit declaration is still required.
- Ambiguous list shapes may require legacy config.
- Child components still need their own declarations unless and until a separate
  cross-component discovery feature exists.
- Handlebars strict equality and ternary helpers still need to be provided by the
  consuming app or a compatible helper package.

## Risks and open questions

- How should conflicts be reported when a path is declared inconsistently?
- Should `products[]` plus `products[].title` be invalid, or should object child
  declarations upgrade the list from primitive to object?
- How should object paths be represented in custom languages without breaking
  existing custom language presets?
- Can nested list output be fully supported with the current one-level placeholder
  behavior, or should deep list support be a separate phase?
- How much child-component inference should be allowed before it becomes full
  template var discovery?

## Recommended next step

Start with tests that describe current behavior and expected flat-path behavior.
Then implement the path parser and compile flat list declarations into the
current internal list config. This gives users a simpler API quickly while
keeping the larger multi-role inference work controlled and incremental.
