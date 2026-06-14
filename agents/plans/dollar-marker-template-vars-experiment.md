# Dollar marker template vars experiment

## Status

Experimental implementation spike in progress on draft PR #22. This workstream
is not intended for release until we decide marker mode is stable enough to
document as public API.

The first implementation slice is behind `experimentalDollarMarkers` and keeps
the stable flat `templateVars` API unchanged.

Related issue: https://github.com/rmorse/babel-plugin-jsx-template-vars/issues/14

Reviewer notes are captured in
[`dollar-marker-template-vars-experiment-review.md`](./dollar-marker-template-vars-experiment-review.md).
This plan folds in the agreed changes while keeping the experiment deliberately
open-ended: marker syntax may complement flat `templateVars`, or it may prove
strong enough to replace it later. That is a result to measure, not a conclusion
to assume.

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

Single-dollar markers remain an open syntax decision. They may be reasonable in
user-authored component trees if we avoid processing dependencies, but marker
prefix bikeshedding is not the priority of this spike. Use `$$` for the
experiment so collision behavior is easy to isolate.

## Implementation Status

Implemented in the first spike:

- marker parsing and stripping for `$$name`, `$$hero.summary`, and
  `$$hero?.summary`
- invalid marker diagnostics for bare `$$`, non-root markers, computed marker
  access, binding-position markers, and JSX marker names
- opt-in discovery through `experimentalDollarMarkers`
- `node_modules` filename skip
- capitalized variable-declared function component discovery
- expression-bodied arrow components normalized to block bodies before the
  existing controllers run
- marker collection -> strip -> synthesized flat declarations -> registry ->
  existing controllers
- flat `templateVars` plus marker declaration merging
- scalar, nested object, optional member, JSX attribute, logical, unary, binary,
  and ternary control support
- direct `.map()`, safe-chain `.map()`, map assignment aliases, reassigned map
  aliases, helper calls with one marked list source, and nested `.map()` paths
- marker-origin plain aliases and object destructure aliases
- marker e2e parity clones for all current fixture families:
  `basic-replace-input`, `flat-template-vars`, `list-object-controls`,
  `nested-template-vars`, `full-template-surface`, and `deferred-resolution`

Remaining explicit gaps:

- `{ $$tags }` does not infer primitive root list shape
- shape-only declarations still require flat `templateVars`
- alias/destructure chains without a marked source origin are not inferred

## Experiment Goal

Determine whether usage-site markers can replace or complement
`Component.templateVars` while preserving the coverage we now have:

- scalar replacement
- nested object paths
- plain object aliases and destructure aliases
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
input step and must make marker stripping explicit:

```txt
marked JSX usage
	-> collect marker candidates
	-> strip markers from AST
	-> synthesize flat declarations
	-> normalized registry
	-> usage-site tagging
	-> derived controller inputs
```

This keeps the controllers and language output path as stable as possible.

Marker collection should focus on path shape and list boundaries. After markers
are stripped from the AST, the existing registry usage-site inference should tag
replacement, control, and list roles wherever possible. This avoids building a
second role-inference engine that can drift from the flat API.

The first meaningful e2e spike must include the strip step. A collection-only
prototype can validate parsing helpers, but it cannot prove PHP or Handlebars
parity because the existing controllers match unmarked identifiers and paths.

## Component Discovery

`Component.templateVars = [...]` currently identifies which component should be
processed. Without that assignment, marker mode needs component discovery.

Marker mode must be enabled only behind an experimental option:

```js
plugins: [
	[ 'babel-plugin-jsx-template-vars', {
		experimentalDollarMarkers: true,
	} ],
];
```

Without that option, `$foo` and `$$foo` must remain normal JavaScript.

Initial discovery scope:

- process capitalized, variable-declared function components with JSX and at
  least one valid `$$` marker:

```jsx
const App = (props) => <main>{ $$props.title }</main>;
```

- process arrow functions and function expressions whose body contains JSX
- do not require a specific JSX root shape; fragments, DOM roots, and
  conditional returns are normal component output
- skip lowercase render helpers such as `renderRow`
- skip nested callback functions unless they belong to a discovered component's
  JSX/list traversal
- skip nested local functions by default, even if they return JSX and contain
  markers
- do not process files whose Babel filename is under `node_modules`
- do not follow imports into dependency source

Follow-up scope:

- function declarations
- default exports
- wrapped components, such as `memo(() => ...)`
- components returned from factory functions

Discovery needs explicit negative tests. A helper like:

```jsx
const renderRow = (row) => <li>{ $$row.label }</li>;
```

must not be transformed unless we deliberately add helper discovery later.

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
- reject bare `$$` as invalid
- reject markers on non-root path segments, such as `hero.$$summary`
- reject marker identifiers in binding positions, such as `const $$title = ...`,
  function parameters, object patterns, import specifiers, and JSX component
  names
- reject computed access such as `$$items[0]` unless a future phase explicitly
  supports it
- reject markers outside supported component JSX/control/list contexts
- collect replacement paths from marked JSX output
- collect replacement paths from marked JSX attributes
- collect control paths from marked logical, unary, binary, and ternary
  conditions
- collect list roots used as controls, such as `$$products && <section />`
- collect list roots from marked `.map()` sources
- support safe list chains before `.map()`, such as
  `$$products.filter(Boolean).map(...)`
- support helper calls with one marked list source, such as
  `renderProducts($$products)`
- track marker-origin plain aliases, such as `const heroAlias = $$hero`
- track marker-origin object destructures, such as
  `const { title: heading } = heroAlias`
- follow map callback aliases to discover rendered item fields
- follow destructured map callback aliases where the flat API supports them
- follow nested map aliases recursively
- collect JSX prop assignments from list item aliases as parent shape hints, such
  as `title={ product.title } -> products[].title`
- collect supported spread props from list item aliases as parent shape hints,
  such as `<ProductCard {...product} /> -> products[].*` only where an explicit
  flat declaration or child contract can make the fields concrete
- collect optional member paths, such as `$$hero?.summary`
- record unsupported but recognizable patterns through the existing diagnostics
  helper

The collection pass itself should not mutate the AST. It should emit candidate
flat declarations and metadata. A separate strip pass should then rewrite the
markers before the registry and controllers run.

Plain alias collection is required for parity with `deferred-resolution`.
Without a marked origin such as `const heroAlias = $$hero`, later rendered uses
like `{ heading }` or `{ heroAlias?.summary }` cannot be mapped back to the
canonical `hero.title` and `hero.summary` paths.

## Marker Strip Pass

Marker stripping is required before e2e parity is meaningful.

The strip pass should:

- rewrite root marker identifiers, such as `$$hero`, to `hero`
- rewrite member and optional-member roots, such as `$$hero.summary` and
  `$$hero?.summary`, to unmarked roots
- rewrite marked list roots before `.map()`, helper calls, and safe chain calls
- run before `createTemplateVarsRegistry(..., componentPath, ...)`
- refuse to rewrite marker identifiers in binding positions; those are syntax
  errors for this experiment, not alternate source declarations
- leave `$foo` untouched
- leave `$$foo` untouched when `experimentalDollarMarkers` is disabled
- guarantee transformed output contains no `$$` identifiers for marker-enabled
  components unless the marker was outside supported discovery scope

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

This is also why the preferred implementation order is:

```txt
collect -> strip -> registry -> controllers
```

If strip is incomplete, registry role inference and controller replacement will
silently miss marked paths.

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
- add a test that documents whether a real `$$theme` binding inside a
  marker-enabled component is transformed or rejected

If this becomes a release candidate, add an escape hatch only if we find a real
consumer need. Avoid adding escape syntax until there is evidence.

## Interaction With Flat `templateVars`

During the experiment, do not remove flat `templateVars`.

Recommended behavior:

- marker mode can coexist with flat declarations in the same component while we
  test parity
- explicit flat declarations and marker-synthesized declarations should be
  merged before registry construction
- duplicate declarations should merge through the registry
- conflicts should use the same registry validation errors
- current `templateVars` assignments should still be removed from transformed
  source when the component is processed, matching existing behavior
- markers should be stripped from processed components even when flat
  declarations are also present
- long-term decision should be made only after parity fixtures pass

If marker mode eventually replaces `templateVars`, it should be a separate
breaking release with docs and migration notes.

During parity work, use two fixture styles:

- parent marker mode with child components still using flat `templateVars`
- fully marked component trees where each component owns its own marker contract

This keeps component-local boundaries explicit while letting the experiment
measure how far marker syntax can go.

## Test Plan

Add tests before implementation changes.

Unit tests:

- parse marker identifiers into source identifiers
- parse marker member expressions into flat paths
- parse optional marker member expressions into flat paths
- reject invalid markers, such as bare `$$`
- reject non-root markers, such as `hero.$$summary`
- reject computed marker access, such as `$$items[0]`
- leave `$foo` untouched
- leave `$$foo` untouched when `experimentalDollarMarkers` is disabled
- strip marker identifiers before controller processing
- verify transformed output contains no `$$` identifiers when marker mode is
  enabled and supported
- collect scalar replacement declarations
- collect nested object path declarations
- collect JSX attribute replacement declarations
- collect logical, unary, binary, and ternary control declarations
- collect control-only declarations, such as `$$visible && <X />`
- collect list-root control declarations, such as `$$products && <X />`
- collect direct `.map()` list declarations
- collect safe chain `.map()` list declarations
- collect nested `.map()` list declarations
- collect marker-origin plain aliases
- collect marker-origin object destructure aliases
- collect same-scope map-assignment aliases
- collect reassigned map aliases
- collect helper calls with one marked list source
- collect multi-role paths
- collect spread props in mapped child components where the flat API supports
  the same pattern
- collect JSX prop assignments from list items where they are needed for parent
  shape hints
- merge marker declarations with flat `templateVars`
- throw the existing registry validation errors for marker/flat shape conflicts
- avoid discovering lowercase helpers, nested local functions, and non-component
  arrows
- preserve component-local boundaries; parent markers must not auto-declare a
  child component contract
- diagnose unsupported helper calls with multiple marked list roots
- reject marker identifiers in binding positions with a clear diagnostic
- skip marker discovery and stripping for `node_modules` filenames

E2e parity fixtures:

- duplicate `fixtures/e2e/basic-replace-input` using marker syntax
- duplicate `fixtures/e2e/flat-template-vars` using marker syntax
- duplicate `fixtures/e2e/list-object-controls` using marker syntax
- duplicate `fixtures/e2e/nested-template-vars` using marker syntax
- duplicate `fixtures/e2e/full-template-surface` where marker syntax can express
  the same behavior
- duplicate `fixtures/e2e/deferred-resolution` where marker syntax can express
  the same behavior
- compare generated PHP output to the flat API fixture
- compare generated Handlebars output to the flat API fixture

Recommended e2e order:

1. `basic-replace-input`
2. `flat-template-vars` with marker parent and flat child components
3. `list-object-controls`
4. `nested-template-vars`
5. `full-template-surface`
6. partial `deferred-resolution`, with explicit pending tests for any gaps

The `deferred-resolution` fixture is the hardest parity gate because it covers
destructure aliases, optional chaining, filter chains, helper calls, reassigned
map aliases, nested list callbacks, and spread props.

Known parity gap tests:

- direct primitive root list output
- any fixture behavior that requires a shape declaration without a usage site
- pass-through list props that are never rendered by the declaring component
- shape-only declarations used as server-side data contracts
- helper bodies that consume marked arguments in ways not visible from the call
  site
- alias/destructure chains where no marked source origin is present

These should be explicit pending or skipped tests during the experiment, not
hidden limitations. Keep the pending set small and high signal so CI remains
useful on the draft branch.

## Risks

- Component discovery may process code that the current explicit API ignores.
- Usage-site collection may miss data paths that are declared but not directly
  rendered.
- Marker stripping bugs can leave `$$` identifiers in generated output or cause
  the existing controllers to miss declarations.
- List path discovery becomes harder because JavaScript cannot express `[]` in
  identifiers.
- Alias and destructure discovery may need a marker-origin map before the
  existing controller alias tracking can help.
- The marker may make JSX look less like normal application code.
- Nested list discovery may duplicate complexity already handled by the
  registry/list controller layer.
- Real `$$foo` bindings become reserved inside marker-enabled components.

## Recommendation

Proceed as a draft experimental PR with a small implementation spike after this
plan:

1. Add marker extraction and strip helpers with unit tests.
2. Add narrow component discovery behind `experimentalDollarMarkers`.
3. Build synthetic declarations for scalar replacement, nested object paths, and
   simple controls.
4. Strip markers, feed declarations into the existing registry, and run the
   current controllers unchanged.
5. Add marker e2e parity for `basic-replace-input` and `flat-template-vars`.
6. Expand to list fixtures only after scalar/control parity is stable:
   `list-object-controls`, then `nested-template-vars`.
7. Add `full-template-surface` and partial `deferred-resolution` parity once
   alias/helper/list discovery is ready.

Do not release marker mode until the e2e parity suite proves it can match the
flat API for the important supported surface, or until we deliberately document
which parts must stay on flat `templateVars`.

## Follow-Up Work From Review

Review feedback after the first implementation spike found several experiment
boundary issues that should be addressed before the draft PR is promoted out of
draft. Review #1 mostly clarified boundaries and missing tests; Review #2 added
two concrete behavior fixes that should be implemented next: binding-position
rejection and helper-only list inference.

### 1. Complete Binding-Position Marker Validation

Status: agreed, high priority.

Markers are value-use syntax. They must not define or rename bindings. The
current implementation rejects some binding positions, but review probes showed
these can still be transformed silently:

```jsx
const App = ({ $$title }) => <h1>{ title }</h1>;
const App = ($$props) => <h1>{ props.title }</h1>;
const App = ({ $$title: heading }) => <h1>{ heading }</h1>;
```

Those rewrites change source binding semantics and violate the experiment
contract.

Required fixes:

- reject arrow/function parameters named with `$$`
- reject object-pattern parameter keys and shorthand bindings, including
  `{ $$title }`
- reject renamed object-pattern marker bindings, including
  `{ $$title: heading }`
- reject nested object-pattern bindings, such as
  `{ hero: { $$title } }`
- reject assignment-pattern bindings where the left side is a marker
- keep import binding diagnostics where parser/source setup allows practical
  coverage
- make the error message explicit that markers cannot be used in binding
  positions

Required tests:

- `const App = ($$props) => ...` throws
- `const App = ({ $$title }) => ...` throws
- `const App = ({ $$title: heading }) => ...` throws
- nested object-pattern marker bindings throw
- assignment-pattern marker bindings throw
- import marker bindings throw or are documented if parser setup makes the test
  impractical

Do this as an implementation fix, not just a plan note. These are actual
incorrect transforms.

### 2. Make Capitalized Helper Discovery An Explicit Experiment Rule

Status: agreed with clarification.

The current discovery rule intentionally starts simple:

```txt
top-level capitalized variable-declared function + JSX + marker -> processed
```

That means a helper like this is processed:

```jsx
const RenderRow = ({ label }) => <li>{ $$label }</li>;
```

This is broader than "only functions used as JSX components", but that is an
intentional tradeoff for the experiment. Proving actual component usage would
require cross-reference analysis and would add complexity before we know marker
syntax is worth shipping.

Required follow-up:

- document the current discovery rule in the plan and PR summary
- add a test confirming capitalized JSX helpers are processed intentionally
- keep the existing lowercase helper negative test
- revisit stricter discovery only if real usage shows the blast radius is too
  broad

Non-goal for now:

- do not add broad "is this function used as JSX" analysis in this spike

### 3. Reject Or Diagnose Markers In Skipped Nested Local Functions

Status: agreed, high priority.

The collector intentionally skips nested local functions that are not map
callbacks. That boundary is correct, but current behavior can still discover the
parent component because the broad JSX scan sees JSX inside the skipped helper.
If the only marker is inside that skipped nested helper, the component may be
processed with no useful declarations and the marker can remain in emitted code.

Example:

```jsx
const App = () => {
	const helper = () => <h1>{ $$title }</h1>;
	return helper();
};
```

Preferred behavior:

- do not silently leave processable-looking markers in emitted code when
  `experimentalDollarMarkers` is enabled
- either avoid discovering the component when all markers are inside skipped
  nested functions, or throw a clear unsupported-pattern diagnostic

Recommendation:

- throw a clear diagnostic for markers inside skipped nested local functions
  during marker-enabled processing
- message should explain that marker mode only supports component body usage and
  map callback usage in this spike

Required tests:

- nested local helper with the only marker throws clearly
- nested local helper markers do not get stripped silently
- map callback markers remain supported

### 4. Fix Helper-Only List Source Inference

Status: agreed, medium priority but concrete bug.

This should be enough to synthesize a root list declaration:

```jsx
<section>{ renderRows($$products) }</section>
```

Current behavior only adds a helper-call list declaration when the source path
already contains `[]`, which means helper-only list roots are missed unless the
same list is also mapped elsewhere.

Required fix:

- when a helper call receives a marked root argument such as `$$products`, treat
  that as a list root declaration for wrapping purposes
- synthesize `products[]` at minimum
- do not infer item fields from an opaque helper body unless they are visible
  elsewhere or supplied by flat declarations
- keep multi-root helper diagnostics unchanged

Required tests:

- `renderRows($$products)` wraps output with list open/close tags
- helper-only root does not require a second `.map()` occurrence elsewhere
- helper call with multiple marked list roots still warns/throws through the
  existing unsupported-pattern path

### 5. Harden `node_modules` Filename Skipping

Status: agreed, low-risk fix.

The skip helper currently handles absolute paths containing `/node_modules/`,
but relative filenames such as `node_modules/pkg/App.jsx` should also be
skipped.

Required fixes:

- normalize `\` to `/`
- match both `/node_modules/` and `node_modules/` at the start of the filename

Required tests:

- absolute Windows/Unix-like path under `node_modules` remains skipped
- relative `node_modules/pkg/App.jsx` remains skipped
- marker stripping does not run for skipped dependency filenames

### 6. Decide Multi-Declarator Behavior

Status: acceptable gap for the experiment, but make it visible.

The current candidate discovery requires exactly one variable declarator:

```jsx
const App = ({ title }) => <h1>{ $$title }</h1>, other = 1;
```

This is skipped silently today. For the experiment, keeping multi-declarator
component declarations unsupported is fine, but it should not be a hidden
surprise.

Preferred follow-up:

- add a known-gap test or targeted diagnostic when a skipped multi-declarator
  declaration contains a valid-looking marker
- document that marker-enabled components should use one component declaration
  per `const` statement

Implementation preference:

- keep the first fix small: add a known-gap/pending test and plan note
- only add diagnostics if the skip proves confusing during implementation or
  review

### 7. Add Output-Hygiene Coverage Across Marker Fixtures

Status: agreed, useful confidence test.

Current unit tests check selected transformed output for `$$` removal. We should
also prove this across the marker e2e fixture family.

Required tests:

- transform every `fixtures/e2e/dollar-marker-*` fixture with
  `experimentalDollarMarkers: true`
- assert transformed code contains no `$$`
- keep skipped dependency filename cases separate, because those intentionally
  leave marker syntax untouched

### 8. Add Explicit Non-Support Tests For Component Forms

Status: agreed, documentation/test gap.

The experiment intentionally does not discover broader component forms yet:

- `function App() { ... }`
- default export components
- HOC or wrapper forms such as `memo(() => ...)`

Required follow-up:

- add tests proving these forms are untouched or documented as unsupported
- make sure they do not half-transform and leave broken code
- keep discovery expansion separate from this stability pass

### 9. Add Tidy-Only And Conflict Tests

Status: agreed.

The current visitor skips marker processing in `tidyOnly` mode. That should be
locked with tests.

Required tests:

- `tidyOnly: true` plus `experimentalDollarMarkers: true` leaves markers
  untouched
- flat `templateVars` declarations are still removed in tidy-only mode
- marker plus flat declaration conflicts still surface through the registry
  validation errors

Example conflict:

```jsx
const App = ({ hero, products }) => (
	<main>
		<h1>{ $$hero.title }</h1>
		{ $$products.map((product) => <p>{ product.title }</p>) }
	</main>
);

App.templateVars = [ 'hero[]' ];
```

The conflict should fail through the same registry validation path as flat-only
shape conflicts.

### 10. Add Focused Unit Coverage Where E2e Is Too Broad

Status: agree selectively.

The marker e2e fixtures are valuable and should remain the primary parity
signal, but a few collector behaviors deserve direct unit tests because they are
small and fragile:

- empty-declaration guard for marker-enabled components
- strip pass scope boundaries
- safe-chain alias origin tracking
- filter predicate field inference, such as `product.available` and
  `badge.visible`
- helper-only list root declaration

Avoid overfitting unit tests to every internal traversal detail while the
experiment is still moving.

### 11. Keep Known Syntax Decisions Separate From Stability Fixes

Status: agreed.

`$$` is still the experiment marker. Single-dollar syntax may be viable later,
especially if we only process user-authored component files and never traverse
dependencies. Do not spend implementation effort on single-dollar syntax until
the current marker pipeline is stable.

Current syntax stance:

- support `$$` only
- leave `$foo` untouched
- keep single-dollar as a future product decision, not part of this stability
  follow-up
