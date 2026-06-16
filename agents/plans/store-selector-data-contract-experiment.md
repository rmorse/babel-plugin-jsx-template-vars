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
- Shape-only hints can eventually live in selector APIs instead of detached
  component config.

## First Proof Slice

Start deliberately small and prove the core contract before tracing through the
whole app.

Required first-slice support:

- detect recognized selector calls in variable declarations
- support static member selectors only:

```jsx
(state) => state.hero.title
```

- reject or ignore dynamic selectors:

```jsx
(state) => state[group][field]
(state) => getValue(state)
```

- infer selected data paths from recognized selector calls
- infer replace/control/list roles from supported usage sites
- infer list roots from `.map()` and other supported list-shaped usage
- infer item fields from visible `.map()` callbacks over selected lists
- support local aliases and destructures after selector assignment
- reuse the existing normalized registry and controllers
- preserve current PHP and Handlebars output behavior
- keep this behind an experimental flag, for example
  `experimentalStoreSelectors`

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
- scalar selected values render replacement tags
- list selected values render list wrappers
- local alias and destructure propagation
- unsupported selectors do not produce partial transforms

E2e tests:

- basic scalar store selector fixture
- nested object selector fixture
- selected-list usage fixture
- complex fixture equivalent to `full-template-surface`
- same-file prop drilling fixture once tracing starts
- PHP and Handlebars expected output for every fixture

Regression tests:

- flat `templateVars` remains unchanged with the experiment flag off
- `$$` marker mode remains independent
- store selectors do not run in `tidyOnly` unless explicitly designed later

## Open Questions

- Should direct rendering of a selected array-like value infer list output, or
  should list output require `.map()` or another supported list-shaped usage?
- Should shape-only list hints use a selector-based shape API, or stay on flat
  `templateVars` during the experiment?
- Should the selector API be real runtime code shipped by this package, or only
  recognized by the Babel plugin and provided by the consuming app?
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
