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
];
```

Review feedback confirmed the direction, with several amendments:

- The normalized registry should be the architecture that ships.
- Flat paths compiled into legacy list config are acceptable only as an internal
  stepping stone.
- `[]` declares data shape. It does not by itself mean "wrap this JSX usage with
  list tags".
- List wrapping should be driven by usage, such as `.map()` or a rendered alias
  assigned from `.map()`.
- Deep nested list paths are not first-pass scope because today's context and
  placeholder machinery only support one list level reliably.
- Multi-role variables and single identity per declared path are release
  requirements, not optional polish.

## Goals

- Preserve existing behavior with regression tests before changing the model.
- Introduce flat path notation for scalar values, object paths, and one-level
  lists.
- Support multiple usage roles for the same declared variable or path.
- Build a normalized registry early and derive controller inputs from it.
- Keep explicit legacy config working as an escape hatch and compatibility path.
- Keep inference conservative: infer only when source usage is clear.
- Add a release gate so partial parser shims cannot become the final
  architecture accidentally.
- Keep custom language output stable where possible, but accept that path-aware
  variables require a documented language argument extension.

## Non-goals

- Do not attempt full automatic discovery of every dynamic value in a component.
  Users should still explicitly declare the template data contract.
- Do not require runtime proof that a declared path exists in data. A declaration
  like `products[].title` is a user-owned template contract.
- Do not remove legacy nested config until the flat API is proven and documented.
- Do not infer complex list child shape from ambiguous patterns such as spread
  props in the first pass.
- Do not support deep nested list output, such as
  `products[].badges[].label`, in the first pass.
- Do not infer template vars across component boundaries. Child components still
  need their own declarations.

## Key Model Change

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
  component that declares local `available`.

The target internal model should represent:

- declared path: `products[].available`
- shape: scalar, object, list
- roles: replace, control, list
- context depth: root or one-level list item in the first pass
- one generated identity per declared path

## Proposed Internal Registry

Build one normalized registry from `templateVars`, then derive controller inputs
from that registry.

The intended final architecture is:

```txt
templateVars -> normalized registry -> usage-site tagging -> derived controller inputs
```

`templateVars` declares the data contract. The normalized registry owns path
shape, validation, and identity. Usage-site tagging determines what each AST
occurrence is doing. Controller inputs are then derived from those tagged usage
sites, rather than from mutually exclusive user-declared type buckets.

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

The registry should be introduced before broad inference work. Even if early
controller compatibility uses a legacy-config shim, the registry should own path
identity and validation from the start.

## Flat Path Grammar

Supported first-pass grammar:

```txt
title
hero.title
hero.media.url
products[]
products[].title
products[].price
products[].available
```

Deferred grammar:

```txt
products[].badges[]
products[].badges[].label
```

Rules:

- `foo` declares a root scalar or object path.
- `foo.bar` declares a nested object property.
- `foo[]` declares a primitive list item shape when no child paths are declared.
- `foo[].bar` declares an object-list child property.
- `foo[]` plus `foo[].bar` upgrades `foo` to an object list, rather than being
  treated as a contradiction.
- `[]` declares data shape only. Actual list wrapping is inferred from JSX usage.
- Duplicate declarations merge into the same registry entry.
- Conflicting shapes that cannot be upgraded safely should produce a clear
  validation error.

## Path To AST Resolution

Flat declarations describe data paths. The transform operates on AST nodes:

```js
hero.title
const { title } = hero;
products.map((product) => product.title)
```

We need an explicit path-resolution layer before role inference can be reliable.

First-pass supported resolution:

- bare identifiers matching root declarations, such as `title`
- simple member expressions matching object paths, such as `hero.title`
- simple nested member expressions, such as `hero.media.url`
- map callback member access for one-level lists, such as `product.title`
  inside `products.map((product) => ...)`

First-pass unsupported resolution:

- destructure renames, such as `const { title: headline } = hero`
- intermediate aliases, such as `const h = hero; h.title`
- optional chaining, such as `hero?.title`
- spread props, such as `<Card {...product} />`
- chained transforms before map, such as `products.filter(...).map(...)`

Unsupported patterns should remain explicit legacy-config territory until they
are intentionally implemented.

## Test-First Sequence

Before implementation changes, add tests that lock current behavior. These tests
should be based on the README, local docs, and GitHub wiki pages, especially the
documented examples in `Variable-types`.

Use focused unit tests for parser/controller behavior and e2e fixtures for final
PHP/Handlebars output.

### Replacement Baseline

Cover:

- destructured prop replacement in text nodes
- local variable replacement from component scope
- replacement in standard attributes
- replacement in input `value`, including the `jsxtv_value` mirror
- explicit `{ type: 'replace' }`
- current limitation around object member replacement, so we know what changes
  when `hero.title` support lands
- data-fetching caveat from README: replacement should remain scoped to declared
  components, not upstream data-loading code

### Control Baseline

Cover all documented control expressions:

- truthy: `{ isActive && <X /> }`
- falsy: `{ !isActive && <X /> }`
- equality: `{ isActive === 'yes' && <X /> }`
- inequality: `{ isActive !== 'yes' && <X /> }`
- subject on either side: `{ 'yes' === isActive && <X /> }`
- multiple template vars in a comparison:
  `{ isActive === anotherVar && <X /> }`
- ternary controls:
  `{ status === 'ready' ? <Ready /> : <Waiting /> }`
- control wrapping normal JSX
- control wrapping list output
- current unsupported control-like expressions, captured as limitations rather
  than silently treated as valid inference targets

### List Baseline

Lists need their own e2e coverage because the documented and current behaviors
have several distinct usage shapes.

Cover:

- primitive list declared with legacy `{ type: 'list' }`
- primitive list mapped directly in JSX:
  `{ favoriteColors.map((color) => <p>{ color }</p>) }`
- object list declared with child props:
  `{ type: 'list', child: { type: 'object', props: [ 'value', 'label' ] } }`
- object list mapped to an alias first, then rendered:
  `const favoriteColorsList = favoriteColors.map(...); return { favoriteColorsList }`
- object list mapped directly in JSX
- list item property replacement in text
- list item property replacement in attributes
- list output rendered from a precomputed alias, as used by the advanced fixture
- direct root list output if current behavior supports it; if it does not,
  capture the current limitation before changing it
- list output wrapped by a control expression
- control expressions inside list item components
- parent components rendering child components inside `.map()`, including
  `__context__ + 1`
- nested list child props currently represented as empty arrays, so the current
  one-level depth limit is explicit
- aliases from legacy `aliases` config
- map-assignment alias inference as the future replacement for most legacy
  `aliases` config

### Custom Language And Preset Baseline

Cover:

- PHP root variable output
- PHP list context and subcontext output
- PHP control output
- Handlebars replacement, list, and control output
- custom language behavior that uses `variables.variable` and
  `variables.subvariable`
- a future failing or pending test for path-aware args, so we have a clear target
  for `$data['hero']['title']` instead of `$data['hero.title']`

### Multi-Role Baseline

Cover current gaps and desired behavior:

- same root value used as replacement and control
- same list root used as control and list
- same list item property used as replacement and control inside an item
  component
- single generated identity per declared path in the future registry model

These tests should initially document current behavior, including known gaps.
Then implementation phases can change the expected output deliberately.

## Phase 1: Registry And Path Parser

Add path parsing and registry construction without changing public behavior yet.

Deliverables:

- Parse string declarations into path segment metadata.
- Preserve existing string declarations like `name`.
- Preserve existing array config declarations.
- Merge duplicate flat declarations into one registry entry.
- Validate obvious malformed paths.
- Assign one internal identity per declared path.
- Add temporary derivation from registry to the current controller buckets.

Temporary compatibility shim:

```js
[
	'products[].title',
	'products[].price',
]
```

can derive the equivalent legacy list input while controllers are still being
refactored:

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

This shim must not become the final architecture. The release gate should fail
if multi-role behavior still depends on mutually exclusive legacy buckets.

## Phase 1.5: Path To AST Resolution

Resolve declared paths to supported AST usage sites.

Deliverables:

- Match root identifiers to root paths.
- Match simple member expressions to object paths.
- Match one-level list callback item properties to list child paths.
- Keep an explicit unsupported list for renames, optional chaining, spreads, and
  complex aliases.
- Add tests for each supported and unsupported pattern.

## Phase 2: Language Path Arguments

Support structured path arguments in the language runtime.

Current args are string-like:

```js
{ type: 'identifier', value: 'title' }
```

Path-aware args should preserve segments:

```js
{ type: 'path', segments: [ 'hero', 'title' ], value: 'hero.title' }
```

Expected output:

```hbs
{{hero.title}}
```

```php
$data['hero']['title']
```

Custom languages need a migration note. Existing custom language definitions
should continue working for flat identifiers, but nested paths require the new
structured path behavior.

## Phase 3: Conservative Role Inference

Infer usage roles from AST context for declared paths without explicit `type`.

Initial inference rules:

- Control role:
  - identifier/path appears in supported logical expression conditions.
  - identifier/path appears in supported ternary test expressions.
- List role:
  - root path is the receiver of `.map()`.
  - identifier rendered in JSX was assigned from `.map()` on a declared list
    root.
- Replace role:
  - identifier/path appears in JSX text or JSX attributes.
  - fallback role only outside control-like contexts.

Important rule:

- `[]` declares list shape, not list wrapping. A declaration like `products[]`
  should not wrap arbitrary usages such as `products.join(', ')`.

Unsupported control-like usage should not silently become a replacement
inference. It should either remain untouched with a test-documented limitation
or require explicit legacy config until we support it.

Explicit legacy config remains authoritative.

## Phase 4: Multi-Role Controller Inputs

Move from exclusive buckets to derived controller views.

The registry can derive:

- replace controller inputs for replacement occurrences
- control controller inputs for supported condition occurrences
- list controller inputs for list declaration and wrapping

Avoid generating separate UIDs for the same variable path per role. Duplicated
generated identifiers are a likely source of incorrect output when one variable
is used in multiple roles.

This phase is release-blocking.

## Phase 5: Documentation And Migration

Update README/wiki-facing docs to make the flat API primary:

```js
Component.templateVars = [
	'title',
	'visible',
	'hero.title',
	'products[].title',
	'products[].price',
	'products[].available',
];
```

Document legacy config as supported advanced configuration.

Document limitations:

- Explicit declaration is still required.
- Ambiguous list shapes may require legacy config.
- Child components still need their own declarations.
- Deep nested list paths are deferred until deeper context support exists.
- Unsupported AST patterns require explicit config or simpler local bindings.
- Handlebars strict equality and ternary helpers still need to be provided by the
  consuming app or a compatible helper package.

This should be treated as a semantic major-version change because projects that
currently rely on implicit replacement may gain control or list behavior once
role inference lands.

## Deferred Phase: Deep List Contexts

Only add deep paths such as:

```js
Component.templateVars = [
	'products[].badges[].label',
];
```

after explicit context-depth work.

Required work:

- count nested `.map()` depth, not just "inside any map"
- support list open/close at each nested depth
- build non-empty nested list placeholder arrays
- extend PHP context/subcontext generation beyond one level
- add e2e fixtures for nested list output in PHP and Handlebars

Until then, use the child-component pattern:

```js
// Parent component
App.templateVars = [ 'products[].name', 'products[].badges' ];

// Child component that renders badges locally
ProductCard.templateVars = [ 'name', 'badges[].label' ];
```

## Release Gate

Do not document or release the flat API until these checks pass:

- current documented behavior remains covered by tests
- flat scalar paths work
- one-level object paths work
- one-level list paths work
- `[]` acts as shape, not automatic wrapping
- map-assignment aliases work without legacy `aliases` for common cases
- legacy `aliases` still work as an escape hatch
- same value can be replacement and control
- same list root can be control and list
- same list item field can be replacement and control in an item component
- one generated identity per declared path
- PHP nested object paths render as nested array access
- Handlebars nested object paths render as dotted paths
- custom language migration is documented
- unsupported AST patterns fail clearly or stay explicitly documented

## Risks And Open Questions

- Should malformed flat paths throw during transform, or warn and ignore?
- What should the exact error message be for conflicting path shapes?
- How much alias detection is enough for the first release?
- Should direct root list rendering be part of the official API if current
  behavior is inconsistent?
- How should custom language authors express path-aware variables if they copied
  older `php.json` examples from the wiki?
- How far should we go with warnings before this plugin needs a structured
  diagnostics surface?

## Recommended Next Step

Start with tests that describe current behavior across all documented examples,
with extra e2e focus on list variants. Then implement the registry and path
parser, deriving the current controller inputs as a temporary shim.

Keep the first implementation narrow: scalar paths, one-level object paths,
one-level list paths, map-assignment aliases, and legacy config overrides. Defer
deep nested lists until the context machinery is deliberately redesigned.
