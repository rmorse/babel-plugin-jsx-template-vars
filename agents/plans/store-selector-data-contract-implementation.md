# Store selector data contract implementation plan

## Status And Scope

This document breaks the store selector data contract experiment into practical
implementation phases.

The experiment should live behind a new flag:

```js
{
	experimentalStoreSelectors: true,
}
```

The first implementation should prove that explicit store selector calls can
replace manual flat `templateVars` declarations for normal same-component
usage. It should not try to solve broad app-wide React data flow in the first
slice.

The intended contract is:

- PHP owns one nested `$data` object.
- JavaScript reads from a matching state object through recognized selector
  APIs.
- The Babel plugin extracts static paths from those selector APIs.
- The extracted paths are normalized into the existing template vars registry.
- Existing PHP and Handlebars controllers produce the final template output.

This is a draft experiment, not a release-ready API.

## Implementation Goals

The first proof should support:

- role-neutral selectors such as `useStoreSelector((state) => state.hero.title)`
- nested object paths of arbitrary static depth
- nested list paths when visible usage proves item fields
- automatic replace/control/list role inference from usage
- multiple roles for the same selected path
- local aliases assigned from selector results
- local destructuring from selector results
- visible `.map()` usage over selected lists
- PHP nested array output through the existing path-aware language machinery
- Handlebars dotted path output through the existing language machinery
- coexistence with flat `templateVars` and the `$$` marker experiment

The first proof should not support:

- cross-file component graph tracing
- prop drilling through child components
- generic React context tracing
- spread props
- HOCs or wrapper component discovery
- dynamic selector keys
- optional chaining in selectors
- calls inside selectors
- runtime store implementation details
- generating PHP data assembly code

Prop drilling and hierarchy tracing are important to the long-term value of the
experiment, but they should be deferred until selector extraction and registry
integration are proven.

## Candidate Public API

The selector names are provisional:

```jsx
import {
	useStoreSelector,
} from 'babel-plugin-jsx-template-vars/store';

const App = () => {
	const title = useStoreSelector((state) => state.hero.title);
	const products = useStoreSelector((state) => state.products);

	return (
		<section>
			<h1>{ title }</h1>
			{ products.map((product) => (
				<article>{ product.title }</article>
			)) }
		</section>
	);
};
```

This should synthesize the same internal declarations as:

```js
App.templateVars = [
	'hero.title',
	'products[].title',
];
```

The consuming application may provide the runtime hook implementation during the
experiment. The Babel plugin only needs to recognize the calls at compile time.
If the API later ships from this package, the runtime helpers can be added in a
separate release after the transform contract is stable.

## API Recognition Rules

Use import-based recognition first.

Supported:

```jsx
import {
	useStoreSelector,
} from 'babel-plugin-jsx-template-vars/store';
```

Then only calls through those local bindings are recognized:

```jsx
const title = useStoreSelector((state) => state.hero.title);
```

This keeps the blast radius small and avoids transforming unrelated functions
named `useStoreSelector`.

Renamed imports should be supported by tracking the local binding:

```jsx
import {
	useStoreSelector as useSel,
} from 'babel-plugin-jsx-template-vars/store';

const title = useSel((state) => state.hero.title);
```

Potential follow-up:

```js
{
	experimentalStoreSelectors: {
		selectorHooks: [ 'useStoreSelector' ],
	}
}
```

Do not add configurable hook names in the first proof unless import-based
recognition blocks realistic testing.

## Selector Grammar

Selectors must be static and path-shaped.

Supported selector forms:

```jsx
(state) => state.title
(state) => state.hero.title
state => state.catalog.sections
function (state) {
	return state.hero.title;
}
```

Unsupported selector forms should throw clear transform errors:

```jsx
(state) => state[group]
(state) => state.hero[field]
(state) => state.hero?.title
(state) => getHero(state)
(state) => state.hero.title || fallback
(state) => condition ? state.a : state.b
({ hero }) => hero.title
(state, props) => state.hero.title
```

The error should identify the selector call and explain that store selectors
only support static member paths for now.

Optional chaining should be rejected in slice 1. It may be normalized to a
static path later, but the first parser should keep optional runtime semantics
out of the template contract.

## Path Mapping

Selector paths are data paths, not JavaScript variable names.

```jsx
useStoreSelector((state) => state.hero.title)
```

maps to:

```txt
hero.title
```

and in PHP:

```php
$data['hero']['title']
```

and in Handlebars:

```hbs
{{hero.title}}
```

Selectors do not declare scalar versus list roles. They declare paths only:

```jsx
useStoreSelector((state) => state.products)
```

maps initially to:

```txt
products
```

Visible list usage upgrades the path into list shape:

```jsx
products.map((product) => product.title)
```

maps to:

```txt
products[].title
```

Nested lists follow the same rule:

```jsx
const sections = useStoreSelector((state) => state.catalog.sections);

sections.map((section) => (
	<ul>
		{ section.items.map((item) => (
			<li>{ item.label }</li>
		)) }
	</ul>
));
```

maps to:

```txt
catalog.sections[].items[].label
```

The implementation should reuse the existing infinite-depth flat path registry
and list controllers where possible.

## Babel Pipeline

Add a new module, likely:

```txt
store-selector-template-vars.js
```

The pipeline should be:

1. When `experimentalStoreSelectors` is disabled, do nothing.
2. When `tidyOnly` is enabled, do nothing in the first proof.
3. Find recognized selector imports.
4. Discover selector-only components with recognized calls even when they have
   no `Component.templateVars` assignment.
5. Traverse component bodies for recognized selector calls.
6. Parse selector paths.
7. Track local bindings created from selector calls.
8. Infer additional paths from visible usage.
9. Synthesize flat string declarations.
10. Merge with any explicit flat `templateVars` declarations.
11. Pass the combined declarations into `createTemplateVarsRegistry`.
12. Reuse `templateVarsController.init`.

The output should still flow through the registry and controllers. The store
selector collector should not generate PHP or Handlebars directly.

Selectors plus supported usage should have a debuggable compiled view: the
collector should be able to report the equivalent flat `templateVars` strings it
synthesized before registry creation.

## Component Discovery

Start with the same component shapes currently supported by the transform:

```jsx
const App = () => <main />;
```

and template var assignment:

```jsx
App.templateVars = [ 'title' ];
```

For store selectors, a component can be processable without a `templateVars`
assignment if it contains recognized selector calls:

```jsx
const App = () => {
	const title = useStoreSelector((state) => state.title);
	return <h1>{ title }</h1>;
};
```

The first proof should keep discovery conservative:

- process top-level capitalized variable declarations
- skip nested local functions unless they are `.map()` callbacks tied to a
  selected list
- skip unsupported forms such as `function App() {}` and `export default ()`
  until explicitly added
- do not scan `node_modules`

Unsupported component forms should be documented and covered by tests.

## Selector Binding Model

Every recognized selector assignment creates path metadata.

Scalar:

```jsx
const title = useStoreSelector((state) => state.hero.title);
```

binding:

```txt
title -> hero.title
```

Object root:

```jsx
const hero = useStoreSelector((state) => state.hero);
const title = hero.title;
```

bindings:

```txt
hero -> hero
title -> hero.title
```

Destructure:

```jsx
const hero = useStoreSelector((state) => state.hero);
const { title } = hero;
```

bindings:

```txt
hero -> hero
title -> hero.title
```

List:

```jsx
const products = useStoreSelector((state) => state.products);
```

binding:

```txt
products -> products
```

Map alias:

```jsx
products.map((product) => product.title)
```

binding inside callback:

```txt
product -> products[]
product.title -> products[].title
```

Nested list item:

```jsx
section.items.map((item) => item.label)
```

binding inside callback:

```txt
item -> catalog.sections[].items[]
item.label -> catalog.sections[].items[].label
```

The collector should treat path metadata as structured segments internally. It
can emit flat strings at the registry boundary.

## Binding Map Handoff

The selector collector must hand off two separate artifacts:

- synthesized flat declarations, such as `hero.title` and `products[].title`
- binding/source aliases that connect local JSX identifiers back to canonical
  data paths

Example:

```jsx
const title = useStoreSelector((state) => state.hero.title);
const items = useStoreSelector((state) => state.products);

return (
	<section>
		<h1>{ title }</h1>
		{ items.map((item) => (
			<article>{ item.title }</article>
		)) }
	</section>
);
```

Required handoff:

```txt
title -> hero.title
items -> products
item -> products[]
item.title -> products[].title
```

Existing role inference and controller inputs must be able to resolve local
source keys through that binding map:

- replacement usage of `title` should tag and render `hero.title`
- `.map()` usage of `items` should be treated as list usage of `products`
- item usage of `item.title` should synthesize `products[].title`

This bridge belongs in the collector, registry, or generic path-resolution
layer. Controllers should receive the same kind of derived registry views they
receive for flat `templateVars`; they should not need to know selectors exist.

## List Shape Inference

The selector does not declare a list root. List shape comes from usage.

Visible `.map()` usage is enough to infer list output:

```jsx
const products = useStoreSelector((state) => state.products);

return products.map((product) => (
	<article>{ product.title }</article>
));
```

This infers:

```txt
products[].title
```

Direct rendering is role-inferred as replacement unless another supported usage
also proves list shape:

```jsx
const products = useStoreSelector((state) => state.products);

return <>{ products }</>;
```

This direct render must not upgrade `products` into list output by itself. The
conservative rule is: list output requires `.map()`, another explicitly
supported list-shaped usage, or a flat shape hint.

It is not enough to infer object fields hidden inside opaque helpers:

```jsx
const products = useStoreSelector((state) => state.products);

return renderProducts(products);
```

If `renderProducts` is not analyzed, the transform can know that `products` is a
selected path, but it cannot know whether the helper treats it as a list or uses
`title`, `price`, or other fields.

The first proof should require one of these for object list fields:

- visible `.map()` usage in the processed component
- explicit flat shape hints alongside selector usage
- a later dedicated helper-analysis feature

Do not guess object fields from runtime names.

## Flat Template Vars Coexistence

During the experiment, flat `templateVars` should remain valid and can be used
as shape hints:

```jsx
const products = useStoreSelector((state) => state.products);

App.templateVars = [
	'products[].title',
	'products[].price',
];
```

The collector should merge selector-derived declarations with flat declarations
before registry creation.

Conflicts should use existing registry validation where possible. For example,
if two sources imply incompatible shapes for the same path, the transform should
throw rather than silently choosing one.

Do not introduce a selector-based shape API in slice 1. If a future API is
needed, it should still emit flat strings at the registry boundary.

## Relation To The Dollar Marker Experiment

The store selector experiment should be independent from the `$$` marker
experiment.

Rules:

- flag off means no behavior change
- marker mode should not be required for selector mode
- selector mode should not strip or interpret `$$`
- both flags may be enabled in a test fixture, but only to prove they do not
  corrupt each other

If both features infer the same flat path, the registry should de-duplicate it.
If they infer conflicting paths, the registry should surface the conflict.

## Diagnostics

Use clear transform errors for unsupported selector patterns.

Recommended messages:

```txt
Store selector must be a static member path, for example:
useStoreSelector((state) => state.hero.title)
```

```txt
Store selector only supports one selector parameter.
```

```txt
Store selector does not support computed properties yet.
```

```txt
Store selector call must be assigned to a local binding before use.
```

```txt
Store selector optional chaining is not supported yet; use a static member path.
```

```txt
Selected path metadata was lost before template output. Use visible supported
usage or an explicit templateVars shape hint.
```

Unsupported tracing should be explicit. Do not partially transform a value when
the collector knows it lost the source path.

## Testing Plan

Add unit tests for the selector parser:

- accepts `state.title`
- accepts `state.hero.title`
- accepts deep static paths
- accepts function selectors with a direct return
- rejects computed keys
- rejects optional chaining in slice 1
- rejects call expressions
- rejects conditional expressions
- rejects multiple params
- rejects destructured params

Add unit tests for binding collection:

- scalar selector assignment
- object selector assignment
- local alias from selected object
- destructure from selected object
- selected list binding
- list `.map()` item alias
- nested list `.map()` item alias
- sourceKey parity with equivalent flat nested-list declarations
- selector-only component discovery
- unsupported opaque helper body does not invent fields

Add e2e fixtures:

- `store-selector-basic`
- `store-selector-nested-object`
- `store-selector-list`
- `store-selector-nested-list`
- `store-selector-multi-role`
- `store-selector-map-alias`
- `store-selector-shape-hint-only-field`
- `store-selector-nested-member-control`
- `store-selector-child-untraced`
- `store-selector-selectors-only`
- `store-selector-conflict`
- `store-selector-complex-surface`
- `store-selector-with-flat-shape-hints`
- `store-selector-unsupported-dynamic`
- `store-selector-flag-off`
- `store-selector-marker-coexistence`

Each e2e fixture should assert both PHP and Handlebars output. Where practical,
add parity fixtures that compare selector-derived output to equivalent flat
`templateVars` output.

The `store-selector-complex-surface` fixture should have a parity pair against
`full-template-surface`. Until prop tracing exists, child components can keep
flat declarations so the fixture tests selector synthesis without implying
hierarchy tracing.

Expected verification commands:

```sh
npm test
npm run test:coverage
npm pack --dry-run
```

## First Implementation Slice

Phase 1 - parser:

- add selector path parser
- add parser unit tests
- reject optional chaining
- produce structured path metadata
- convert structured paths to flat strings at the boundary

Phase 2 - import and call discovery:

- detect recognized selector imports
- collect local imported names
- support renamed import bindings
- find calls to those local names
- discover selector-only components with no `templateVars` assignment
- skip all work when the flag is disabled
- skip `node_modules`

Phase 3 - local binding inference:

- support selector call assignments
- support direct aliases
- support object destructuring
- support list map aliases
- support nested list map aliases

Phase 4 - registry integration:

- synthesize flat declarations
- merge with explicit flat declarations
- seed selector-derived binding/source aliases into the generic path-resolution
  layer
- call `createTemplateVarsRegistry`
- reuse existing controllers
- preserve flat API behavior
- do not add selector-specific controller behavior

Phase 5 - e2e coverage:

- add basic scalar fixture
- add nested object fixture
- add list fixture
- add nested list fixture
- add multi-role fixture
- add map-alias fixture
- add shape-hint-only field fixture
- add nested-member control fixture
- add selector-only component fixture
- add conflict fixture
- add child-untraced negative fixture
- add complex surface fixture
- add unsupported selector fixture

Phase 6 - PR documentation:

- update README only if the experiment becomes worth exposing
- keep detailed notes in `agents/plans` while still draft-only
- document unsupported component and tracing cases
- document the compiled-view debugging model: selectors plus supported usage are
  equivalent to generated flat `templateVars`

## Deferred Prop Drilling And Hierarchy Tracing

The long-term goal is to make normal component composition work with minimal
manual declarations. That should be a follow-up once selector extraction is
stable.

Recommended tracing phases:

Phase A - same-file direct child props:

```jsx
const App = () => {
	const title = useStoreSelector((state) => state.hero.title);
	return <Header title={ title } />;
};

const Header = ({ title }) => <h1>{ title }</h1>;
```

Trace:

```txt
hero.title -> App:title -> Header:props.title -> rendered output
```

Phase B - destructured child props:

```jsx
const Header = ({ title }) => <h1>{ title }</h1>;
```

Phase C - child aliases:

```jsx
const Header = ({ title }) => {
	const heading = title;
	return <h1>{ heading }</h1>;
};
```

Phase D - list item propagation:

```jsx
products.map((product) => (
	<ProductCard product={ product } />
));

const ProductCard = ({ product }) => (
	<article>{ product.title }</article>
);
```

Trace:

```txt
products[].title
```

Phase E - same-file component graph:

- build a local component definition map
- resolve JSX element names to component definitions
- transfer path metadata through supported props
- avoid dynamic component references

Phase F - cross-file graph:

- only after same-file tracing is proven
- require import graph awareness
- require clear limits around barrel files and re-exports

Phase G - opt-in context tracing:

- support known provider and consumer APIs only
- do not infer arbitrary `React.createContext()` usage

Deferred tracing should still reject or skip:

- spread props
- render props
- dynamic component names
- HOCs and memo wrappers
- prop mutation
- object rest destructuring
- imported helper functions

These patterns can be revisited one by one with tests.

## Open Reviewer Questions

- Is `useStoreSelector` the right name, or should the plugin recognize an
  application-owned selector hook so the API feels even more like a normal
  store?
- Should import-based recognition be mandatory, or should config allowlists be
  supported from the start?
- After slice 1, do flat `templateVars` hints remain ergonomic enough, or do we
  need a selector-based shape API that still emits flat strings internally?
- Should same-file prop drilling be included in the first implementation slice,
  or deferred until selector parity is proven?
- What unsupported selector cases should throw hard errors versus remain runtime
  values?
- How much helper-body analysis is worth doing before this becomes harder to
  reason about than flat declarations?

## Slice 1 Gates

- Architecture gate: selector mode must not require controller changes.
- Parity gate: every positive fixture should have equivalent flat output or a
  documented intentional difference.
- Discovery gate: selector-only components work without `Component.templateVars`.
- Debug gate: synthesized declarations can be explained as equivalent flat
  `templateVars`.
- Isolation gate: flag off means zero behavior change; `tidyOnly` remains
  unchanged until explicitly designed.

## Success Criteria

The experiment is worth continuing if:

- selector fixtures can match equivalent flat `templateVars` output
- nested objects and nested lists work through visible usage
- unsupported selectors fail clearly
- selector-only components process without a flat declaration assignment
- flat shape hints merge before registry creation
- controllers stay unaware of selectors
- current flat API behavior does not regress
- marker mode behavior does not regress
- reviewers can understand the data contract without reading controller code
- the follow-up path for prop drilling is concrete enough to implement in small
  tested phases

The experiment should pause or be abandoned if:

- selector collection needs broad React runtime simulation before it is useful
- too many normal components require manual escape hatches
- diagnostics become unclear
- the resulting API is harder to teach than flat path declarations
