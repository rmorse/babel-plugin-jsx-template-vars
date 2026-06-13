# Dollar marker template vars experiment

## Status

Experimental planning only. This workstream is not intended for the next
release until we can prove it reaches the same output coverage, diagnostics, and
stability as the flat `templateVars` contract.

Related issue: https://github.com/rmorse/babel-plugin-jsx-template-vars/issues/14

## Context

The current API declares template data at the component boundary:

```jsx
ProductList.templateVars = [
	'heading',
	'hero.summary',
	'products[].title',
	'products[].badges[].label',
];
```

This is explicit and stable, but it separates declaration from usage. Issue #14
suggests marking template values at the usage site instead.

The first idea was a single dollar prefix:

```jsx
<h1>{ $name }</h1>
```

Single-dollar identifiers are valid JavaScript and are common in existing code,
especially around jQuery-style APIs, observables, generated values, and internal
framework conventions. To reduce accidental capture, this experiment should use
a double-dollar marker:

```jsx
<h1>{ $$name }</h1>
```

`$$name` is still valid JavaScript, but it is less likely to collide with normal
application code. The transform would treat `$$` as source syntax for "expose
this value to the template registry", not as the runtime variable name.

## Experiment Goal

Determine whether usage-site markers can replace or complement
`Component.templateVars` while preserving the coverage we now have:

- scalar replacement
- nested object paths
- recursive nested object/list paths
- control inference
- list inference
- map-assignment aliases
- helper-call aliases with one declared list source
- multiple roles for the same path
- PHP nested array output
- Handlebars dotted path output
- strict diagnostics for unsupported patterns

The success bar is not "can we transform a simple `{ $$name }` example". The
success bar is whether the existing e2e fixtures can be duplicated in marker
syntax and produce equivalent PHP and Handlebars output.

## Proposed Syntax

### Replacement

```jsx
const Person = ({ name }) => <h1>{ $$name }</h1>;
```

Equivalent declaration:

```js
Person.templateVars = [ 'name' ];
```

The transform should strip the marker when resolving the source path:

```txt
$$name -> name
```

### Nested Object Paths

```jsx
const Card = ({ hero }) => <p>{ $$hero.summary }</p>;
```

Equivalent declaration:

```js
Card.templateVars = [ 'hero.summary' ];
```

The marker is only valid on the root identifier:

```txt
Supported:   $$hero.summary
Unsupported: hero.$$summary
```

### Controls

```jsx
{ $$status === 'ready' && <strong>Ready</strong> }
```

Equivalent declaration and role:

```txt
path: status
role: control
```

If the same marker appears in rendered output, it should become multi-role:

```jsx
<h1>{ $$status }</h1>
{ $$status === 'ready' && <strong>Ready</strong> }
```

Equivalent roles:

```txt
path: status
roles: replace, control
```

### Lists

List shape cannot be written directly in JavaScript expression syntax because
`products[]` is not an expression. Marker mode should infer list shape from
supported list usage instead:

```jsx
{ $$products.map((product) => (
	<article>{ product.title }</article>
)) }
```

Equivalent declaration:

```js
ProductList.templateVars = [ 'products[].title' ];
```

For nested lists:

```jsx
{ $$catalog.sections.map((section) => (
	<section>
		{ section.products.map((product) => (
			<article>
				<h2>{ product.title }</h2>
				{ product.badges.map((badge) => <span>{ badge.label }</span>) }
			</article>
		)) }
	</section>
)) }
```

Equivalent declarations:

```js
Catalog.templateVars = [
	'catalog.sections[].products[].title',
	'catalog.sections[].products[].badges[].label',
];
```

This means the experiment needs a path discovery pass that can follow callback
aliases from a marked list source before the registry is built.

### Primitive Root Lists

The current flat API supports direct primitive root list output:

```jsx
{ tags }
```

with:

```js
Component.templateVars = [ 'tags[]' ];
```

Pure marker syntax has no obvious equivalent for "this direct identifier is a
primitive list" because `{ $$tags }` looks the same as scalar replacement.

Initial recommendation:

- Do not infer direct primitive root lists from `{ $$tags }`.
- Require `.map()` in pure marker mode:

```jsx
{ $$tags.map((tag) => <span>{ tag }</span>) }
```

- Keep this as a measured parity gap until we find a syntax that is explicit and
  not awkward.

## Architecture

The current architecture is:

```txt
templateVars -> normalized registry -> usage-site tagging -> derived controller inputs
```

Marker mode should preserve that architecture. It should only replace the first
input step:

```txt
marked JSX usage -> inferred declarations -> normalized registry -> usage-site tagging -> derived controller inputs
```

This keeps the controllers and language output path as stable as possible.

## Component Discovery

`Component.templateVars = [...]` currently identifies which component should be
processed. Without that assignment, marker mode needs component discovery.

First experimental scope:

- process variable-declared function components:

```jsx
const App = (props) => <main>{ $$props.title }</main>;
```

- process arrow functions and function expressions whose body contains JSX
- skip non-component helper functions
- skip nested callback functions unless they belong to a discovered component's
  JSX/list traversal

Follow-up scope:

- function declarations
- default exports
- wrapped components, such as `memo(() => ...)`
- components returned from factory functions

Component discovery should be enabled only behind an experimental option, for
example:

```js
plugins: [
	[ 'babel-plugin-jsx-template-vars', {
		experimentalDollarMarkers: true,
	} ],
];
```

Without that option, `$$foo` should remain normal JavaScript.

## Marker Collection Pass

The marker collection pass should produce flat path declarations.

Examples:

```txt
$$name              -> name
$$hero.summary      -> hero.summary
$$products.map(...) -> products[] plus item paths discovered in callback output
```

Required collection behavior:

- identify root identifiers starting with `$$`
- strip exactly one `$$` marker from the source path
- reject bare `$$` as invalid
- reject markers outside supported component JSX/control/list contexts
- collect replacement paths from marked JSX output
- collect control paths from marked logical and ternary conditions
- collect list roots from marked `.map()` sources
- follow map callback aliases to discover rendered item fields
- follow nested map aliases recursively
- record unsupported but recognizable patterns through the existing diagnostics
  helper

The collection pass should not mutate the AST directly. It should collect
candidate declarations first, build the registry, then let the current
controllers perform replacement and output generation.

## Important Rewrite Detail

The marker name is not the runtime source name.

```txt
marker identifier: $$hero
source identifier: hero
template path: hero.summary
```

Before normal controller replacement, the transform must resolve marked AST
nodes as if the unmarked identifier had been written. Generated code must not
contain `$$hero` unless the experimental marker option is disabled.

## Collision Strategy

Using `$$` reduces but does not eliminate collisions with real variables named
`$$foo`.

Recommended guardrails:

- marker mode is opt-in
- only root identifiers with `$$` are markers
- `$foo` is never a marker
- `$$foo` outside supported component processing remains untouched
- document that real `$$foo` bindings inside marker-enabled components are
  reserved by the experiment

If this becomes a release candidate, add an escape hatch only if we find a real
consumer need. Avoid adding escape syntax until there is evidence.

## Interaction With Flat `templateVars`

During the experiment, do not remove flat `templateVars`.

Recommended behavior:

- marker mode can coexist with flat declarations in the same component while we
  test parity
- duplicate declarations should merge through the registry
- conflicts should use the same registry validation errors
- long-term decision should be made only after parity fixtures pass

If marker mode eventually replaces `templateVars`, it should be a separate
breaking release with docs and migration notes.

## Test Plan

Add tests before implementation changes.

Unit tests:

- parse marker identifiers into source identifiers
- parse marker member expressions into flat paths
- reject invalid markers, such as bare `$$`
- leave `$foo` untouched
- leave `$$foo` untouched when `experimentalDollarMarkers` is disabled
- collect scalar replacement declarations
- collect nested object path declarations
- collect logical and ternary control declarations
- collect direct `.map()` list declarations
- collect nested `.map()` list declarations
- collect multi-role paths
- diagnose unsupported helper calls with multiple marked list roots

E2e parity fixtures:

- duplicate `fixtures/e2e/flat-template-vars` using marker syntax
- duplicate `fixtures/e2e/nested-template-vars` using marker syntax
- duplicate `fixtures/e2e/full-template-surface` where marker syntax can express
  the same behavior
- compare generated PHP output to the flat API fixture
- compare generated Handlebars output to the flat API fixture

Known parity gap tests:

- direct primitive root list output
- any fixture behavior that requires a shape declaration without a usage site

These should be explicit pending/failing tests during the experiment, not hidden
limitations.

## Risks

- Component discovery may process code that the current explicit API ignores.
- Usage-site collection may miss data paths that are declared but not directly
  rendered.
- List path discovery becomes harder because JavaScript cannot express `[]` in
  identifiers.
- The marker may make JSX look less like normal application code.
- Nested list discovery may duplicate complexity already handled by the
  registry/list controller layer.
- Real `$$foo` bindings become reserved inside marker-enabled components.

## Recommendation

Proceed as a draft experimental PR with a small implementation spike after this
plan:

1. Add marker extraction helpers and unit tests.
2. Build a synthetic declaration list for simple replacement/control examples.
3. Feed those declarations into the existing registry.
4. Add one PHP and one Handlebars e2e parity fixture.
5. Expand into lists only after scalar/control parity is stable.

Do not release marker mode until the e2e parity suite proves it can match the
flat API for the important supported surface, or until we deliberately document
which parts must stay on flat `templateVars`.
