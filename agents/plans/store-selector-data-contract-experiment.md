# Store selector data contract experiment

## Status

Proposed experimental workstream for a separate draft PR.

Detailed implementation plan:
[store-selector-data-contract-implementation.md](./store-selector-data-contract-implementation.md).

This is not intended for release yet. The goal is to evaluate a different data
contract from both flat `templateVars` and the `$$` marker experiment:

- PHP supplies one nested `$data` object.
- JSX reads from a matching JavaScript state object.
- The transform extracts template paths from recognized store selector APIs.
- Later phases trace those selected values through normal React prop drilling
  and component hierarchy.

## Problem

The current library asks JSX authors to separately declare the template data
contract:

```jsx
ProductList.templateVars = [
	'heading',
	'products[].title',
];
```

The `$$` marker experiment moves that declaration closer to usage:

```jsx
<h1>{ $$heading }</h1>
```

Both approaches still require the author to think in terms of template exposure.
The PHP side also needs to construct one nested `$data` object whose shape
matches the inferred or declared JSX paths.

For PHP output, that server-side shape is the real contract:

```php
$data = array(
	'heading' => $heading,
	'products' => $products,
	'hero' => array(
		'title' => $hero_title,
	),
);
```

This experiment asks whether the JSX side should use that same contract
directly.

## Proposed Contract

Introduce a recognized store-selector API. Components read template-backed data
through a role-neutral selector over a shared state object:

```jsx
const heading = useStoreSelector((state) => state.heading);
const heroTitle = useStoreSelector((state) => state.hero.title);
const products = useStoreSelector((state) => state.products);
```

The JavaScript state shape mirrors PHP:

```js
const state = {
	heading,
	products,
	hero: {
		title,
	},
};
```

and:

```php
$data = array(
	'heading' => $heading,
	'products' => $products,
	'hero' => array(
		'title' => $hero_title,
	),
);
```

The selector API becomes the source of truth for data paths. The transform only
infers template paths from recognized selector calls, not arbitrary state
variables, and then infers replace/control/list roles from usage sites.

## Candidate API

Names are provisional:

```jsx
const value = useStoreSelector((state) => state.value);
const child = useStoreSelector((state) => state.parent.child);
const options = useStoreSelector((state) => state.options);
```

List usage stays normal:

```jsx
const options = useStoreSelector((state) => state.options);

return (
	<ul>
		{ options.map((option) => (
			<li>{ option.label }</li>
		)) }
	</ul>
);
```

Possible transform output should be equivalent to flat declarations:

```jsx
App.templateVars = [
	'value',
	'parent.child',
	'options[].label',
];
```

but the author would not write that declaration manually.

The author should not choose a selector type at the usage point. A selected path
can be used as a replacement, a control, a list, or multiple roles at once. The
same role inference model used by the flat API should decide that from the AST
context.

## Why This May Be Better

- The PHP and JavaScript data shape match directly.
- Components declare data consumption through normal state reads.
- There is no JSX marker syntax in rendered expressions.
- Store selectors are explicit enough for reliable AST extraction.
- The same API can work at runtime as real app state and at build time as a
  template contract.
- During the experiment, shape-only hints stay on flat `templateVars` so we can
  reuse the existing registry merge and validation behavior.

## First Proof Slice

Start deliberately small and prove the core contract before tracing through the
whole app.

Required first-slice support:

- detect recognized selector calls in variable declarations
- support static member selectors only:

```jsx
(state) => state.hero.title
```

- reject dynamic selectors:

```jsx
(state) => state[group][field]
(state) => getValue(state)
(state) => state.hero?.title
```

- infer selected data paths from recognized selector calls
- infer replace/control/list roles from supported usage sites
- infer list roots from `.map()` and other supported list-shaped usage
- infer item fields from visible `.map()` callbacks over selected lists,
  including JSX child output, JSX prop values, and nested map bodies
- support local aliases and destructures after selector assignment
- support selector-only components with no `Component.templateVars` assignment
- strip or neutralize recognized selector declarations in template output after
  successful collection so e2e rendering does not require a runtime selector
  hook
- reuse the existing normalized registry and controller output/role logic
- preserve current PHP and Handlebars output behavior
- keep this behind an experimental flag, for example
  `experimentalStoreSelectors`

Slice 1 should reject optional chaining instead of normalizing it. It can be
added later once the static selector parser has a stable baseline.

Direct rendering of a selected array-like value should be treated as replacement
usage, not list inference. List shape should require `.map()` or another
explicitly supported list-shaped usage, or a flat `templateVars` shape hint.

Example:

```jsx
const App = () => {
	const heading = useStoreSelector((state) => state.heading);
	const products = useStoreSelector((state) => state.products);

	return (
		<section>
			<h1>{ heading }</h1>
			{ products.map((product) => (
				<article>{ product.title }</article>
			)) }
		</section>
	);
};
```

Should infer:

```js
[
	'heading',
	'products[].title',
]
```

## Prop Drilling And Tracing Direction

The larger goal is to support typical React prop drilling and component
hierarchy as far as static analysis remains reliable.

This should be included in the experiment direction, but deferred until the
selector contract itself is proven.

Until tracing exists, authors must duplicate selectors in children, keep flat
shape hints on child components, or accept untransformed child output. That is
acceptable for the first proof slice, but it must be documented and tested as an
intentional gap.

### Target Follow-Up Support

Same-file direct component propagation:

```jsx
const App = () => {
	const title = useStoreSelector((state) => state.hero.title);
	return <Header title={ title } />;
};

const Header = ({ title }) => <h1>{ title }</h1>;
```

Expected trace:

```txt
state.hero.title -> title -> <Header title> -> Header props.title -> output
```

Destructured props:

```jsx
const Header = ({ title }) => <h1>{ title }</h1>;
```

Intermediate aliases:

```jsx
const heading = title;
return <h1>{ heading }</h1>;
```

Simple object destructuring:

```jsx
const hero = useStoreSelector((state) => state.hero);
const { title } = hero;
return <Header title={ title } />;
```

List item propagation:

```jsx
const products = useStoreSelector((state) => state.products);

return products.map((product) => (
	<ProductCard product={ product } />
));

const ProductCard = ({ product }) => (
	<article>{ product.title }</article>
);
```

Expected trace:

```txt
state.products[].title
```

### Later, Higher-Risk Tracing

These may be possible, but should not be part of the first proof:

- cross-file component graph tracing
- spread props:

```jsx
<Header { ...props } />
```

- conditional/dynamic component references:

```jsx
const Component = isHero ? HeroHeader : CompactHeader;
return <Component title={ title } />;
```

- generic React context tracing
- render props
- HOCs and wrapper components
- imported helper functions

Context support should probably be opt-in through a known template provider and
consumer pair rather than arbitrary `React.createContext()` analysis.

## Tracing Constraints

AST traversal can cover a lot of normal prop drilling, but it should not claim
to infer arbitrary React data flow.

Good first principles:

- selectors define source paths
- local aliases and destructures preserve path metadata
- direct JSX prop assignments can transfer metadata to a child component
- same-file component definitions are the first component graph boundary
- unsupported flows should fail clearly or remain runtime values
- dynamic keys and computed selectors should not be inferred

This keeps the experiment useful without pretending React runtime composition is
fully statically knowable.

## Testing Strategy

Unit tests:

- selector parser accepts static paths
- selector parser rejects computed/dynamic paths
- selector parser rejects optional chaining in slice 1
- scalar selected values render replacement tags
- list selected values render list wrappers
- local alias and destructure propagation
- selector-only component discovery with no `templateVars` assignment
- selector binding handoff for local renames such as `title -> hero.title`
- `.map()` body field discovery, including JSX attributes and nested maps
- selector declaration stripping or neutralization before e2e execution
- child component prop drilling warning by default and error in strict mode
- unsupported selectors do not produce partial transforms

E2e tests:

- basic scalar store selector fixture
- nested object selector fixture
- renamed scalar selector fixture for `hero.title -> title`
- selected-list usage fixture
- multi-role selector fixture
- map-alias selector fixture
- shape-hint-only field fixture
- nested-member control fixture
- selector-only component fixture
- selector plus flat-hint conflict fixture
- child-untraced negative fixture
- PHP nested-list selector fixture
- multi-component selector fixture
- tidyOnly selector fixture
- complex fixture equivalent to `full-template-surface`
- same-file prop drilling fixture once tracing starts
- PHP and Handlebars expected output for every fixture

Regression tests:

- flat `templateVars` remains unchanged with the experiment flag off
- store selectors do not run in `tidyOnly` unless explicitly designed later
- `$$` marker coexistence is deferred until the marker experiment is merged or
  the store selector branch is explicitly rebased onto it

## Review Decisions Before Implementation

- Keep one role-neutral selector API. Do not split selectors into template value,
  template list, or template control hooks.
- Treat selector calls as data-path declarations only. Existing role inference
  decides replace/control/list usage.
- Support import aliases such as `import { useStoreSelector as useSel }` by
  tracking the local import binding.
- Reject optional chaining in slice 1.
- Treat direct rendering of selected arrays as replacement usage unless list
  shape is proven elsewhere.
- Keep flat `templateVars` strings as the shape-hint escape hatch during the
  experiment.
- Add selector-only component discovery as an explicit pipeline entry.
- Do not add selector-specific output or role logic to controllers in slice 1.
  Alias-injection wiring in controller orchestration or the generic path
  resolver is expected.
- Seed selector-derived binding/source aliases into the generic path-resolution
  layer so local names such as `title` and `items` resolve to canonical paths
  such as `hero.title` and `products`.
- Discover list fields from `.map()` bodies before registry creation; flat mode
  does not currently infer these fields from usage.
- Strip or neutralize recognized selector declarations in template builds after
  successful collection.
- Ship a minimal package runtime export for `babel-plugin-jsx-template-vars/store`
  so the import path exists outside template builds.
- Warn when selector-derived values are passed to child components before prop
  tracing exists; strict mode should throw.
- Treat unsupported dynamic selectors as hard errors for the package-scoped
  template selector hook. If future config supports arbitrary app-owned hooks,
  unsupported dynamic selectors should skip or warn via diagnostics instead.
- Drop marker coexistence from slice-1 gates until the marker experiment is
  merged or this branch is rebased onto it.
- Add a compiled-view debugging note for authors: selectors plus supported usage
  should be explainable as equivalent flat `templateVars` declarations.

## Hardening Status And Follow-Up Work

These items were kept as the first concrete backlog for the draft PR. The next
hardening pass has now been implemented in the current selector experiment
branch.

### Completed Hardening Pass

- Split e2e execution so existing flat fixtures keep a default flag-off pass.
  Selector fixtures should opt into `experimentalStoreSelectors`; a separate
  flag-on coexistence pass can remain useful, but should not replace the default
  regression baseline.
- Fail closed when selector calls are present in unsupported component forms.
  Examples include `function App() { ... }`, default-exported components, and
  other shapes not returned by selector component discovery. The transform
  should either process every recognized selector call or leave the import
  intact; it should not remove the import while live selector calls remain.
- Treat selector assignments as alias declarations only. A selector call such as
  `const hero = useStoreSelector((state) => state.hero)` should establish
  `hero -> hero`; supported usage should decide whether `hero`, `hero.title`, or
  `hero[]` becomes a synthesized template declaration.
- Add a nested-member-control test where an object selector is used directly in
  a condition, such as `hero.title === 'Featured'`, without selecting
  `hero.title` into a separate local binding.
- Add explicit coverage for opaque helper metadata loss. Prop drilling now warns
  by default and throws in strict mode, but helper boundaries can still hide
  fields from the collector; this is now covered with warning and strict-mode
  error tests.

### Remaining Later Release Gates

- Add a byte-for-byte parity fixture against `full-template-surface` once the
  selector implementation can express the same surface without excessive flat
  shape hints.
- Add compiled-view or verbose debug output that shows the synthesized flat
  declarations and alias map for a component. This is important because authors
  will otherwise have to mentally compile selectors plus usage into equivalent
  `templateVars`.
- Revisit a package `exports` map only when the runtime API is no longer
  experimental. The current package has no `exports` field, so
  `babel-plugin-jsx-template-vars/store` resolves through legacy subpath
  resolution; adding an exports map too early could restrict existing consumers.
- Re-run marker coexistence once the `$$` marker branch is merged or this branch
  is rebased onto it.

### Latest Review Follow-Ups

The latest review agrees that slice 1 plus the hardening pass are complete and
that selector mode should remain a draft experiment until the release gates below
are handled.

- Treat the `full-template-surface` parity fixture as the next P0 gate. The
  fixture should byte-match the flat fixture output where possible, with child
  components still using flat `templateVars` until prop tracing lands.
- Keep compiled-view or verbose diagnostics as the P1 gate. The debug output
  should show synthesized paths, alias maps, filtered versus raw declarations,
  list shapes, and skipped or unsupported paths.
- Recommend `strict: true` for CI while selector mode remains experimental,
  because default warnings can still produce empty template output for known
  unsupported boundaries.
- Keep opaque helper warnings broad for now, but revisit the policy after real
  usage. Possible future refinements include safe built-in allowlists, helper
  annotations, or helper-body analysis.
- Defer prop drilling Phase A until parity and debug output are in place. The
  first tracing slice should be same-file direct child props only, with spreads,
  dynamic components, and cross-file graphs excluded.
- Add minor follow-up tests/docs for `warnOnUnsupported: false`, the difference
  between unused flat declarations and usage-only selector synthesis, and
  multiple selector calls rebinding the same local.

## Open Questions

- Is the minimal runtime `useStoreSelector(selector, state)` helper enough for
  experiment consumers, or should a later release provide a richer store API?
- Should child components select their own data from the store instead of
  relying on parent-to-child tracing?
- How much tracing is enough before this becomes more complicated than flat
  declarations?

## Recommendation

Open this as a draft experiment and prove the selector contract first.

Do not start with full prop/context tracing. Include it as the intended follow-up
direction, because it is the feature that could make this approach feel
substantially simpler for users, but only build it once selector extraction,
registry integration, and output parity are proven.

The experiment should be judged on whether it makes real component authoring
simpler while keeping the PHP/JavaScript data contract explicit, matching, and
testable.
