# Store Selector Hierarchy Tracing Plan

## Current State

The store selector experiment has proven the selector contract at the
registry/controller boundary:

- selectors synthesize flat declarations
- aliases resolve local names to canonical paths
- list shapes are discovered from visible `.map()` usage
- safe list chains are supported before `.map()`
- `store-selector-complex-surface` byte-matches `full-template-surface` for
  Handlebars and PHP
- debug metadata is available through `metadata.storeSelectorTemplateVars`
- Phase A tracing supports same-file direct scalar child props

Phase A scope is deliberately narrow:

```jsx
const App = () => {
	const title = useStoreSelector((state) => state.hero.title);
	return <Header title={ title } />;
};

const Header = ({ title }) => <h1>{ title }</h1>;
```

The next work is broader hierarchy tracing. This is the riskiest part of the
experiment because it moves beyond local expression analysis into static
component graph analysis.

## Guiding Model

Keep tracing as metadata transfer, not React simulation.

```txt
selector path -> local binding -> JSX prop -> child prop binding -> child usage
```

Each phase should:

- preserve the registry-first architecture
- synthesize the same flat paths that a user could have declared manually
- keep controllers selector-agnostic apart from generic alias wiring
- fail closed or warn when metadata crosses an unsupported boundary
- avoid partial transforms when metadata is known to be lost
- add debug metadata for traced paths so authors can inspect the compiled view

## Non-Goals For This Stream

- arbitrary React runtime analysis
- cross-bundle or build-system-specific module graph resolution
- broad support for spreads, HOCs, render props, or dynamic component names
- generic `React.createContext()` inference
- implicit tracing through imported helper functions
- changing PHP or Handlebars output semantics

## Phase B - Same-File Object Prop Tracing

### Goal

Support object-root selector props passed to same-file child components when the
child accesses static object members.

```jsx
const App = () => {
	const hero = useStoreSelector((state) => state.hero);
	return <Header hero={ hero } />;
};

const Header = ({ hero }) => <h1>{ hero.title }</h1>;
```

Expected synthesized path:

```txt
hero.title
```

### Required Behavior

- Trace direct object props into same-file child components.
- Allow child usage to decide which nested paths are synthesized.
- Support replacement usage, control usage, and local child aliases.
- Do not synthesize the object root unless the child renders the object root
  directly.
- Preserve warning/strict behavior for unsupported object flows.

### Tests

- `hero -> Header.hero -> hero.title` replacement.
- `hero -> Header.hero -> hero.status === 'published'` control.
- child alias: `const heading = hero.title`.
- child destructure: `const { title } = hero`.
- object root direct render remains replacement usage.
- unsupported nested dynamic member: `hero[key]` warns or errors according to the
  existing unsupported policy.

### Risks

- Object roots can look like generic runtime objects. The transform must avoid
  treating all child object reads as template paths unless the object binding is
  selector-derived.
- This phase can create many paths from a single prop. Debug output must make
  those paths inspectable.

## Phase C - Same-File List Item Prop Tracing

### Goal

Support list item metadata passed to same-file child components.

```jsx
const App = () => {
	const products = useStoreSelector((state) => state.products);
	return products.map((product) => (
		<ProductCard product={ product } />
	));
};

const ProductCard = ({ product }) => (
	<article>{ product.name }</article>
);
```

Expected synthesized path:

```txt
products[].name
```

### Required Behavior

- Transfer list item context through direct JSX props.
- Preserve list context depth for PHP output.
- Support child replacement, control, and nested list usage.
- Support child aliases and child destructuring from the list item prop.
- Avoid partial transforms if the child prop cannot be traced.

### Tests

- `product -> ProductCard.product -> product.name`.
- `product.available && ...` control inside child.
- `product.badges.map(...)` nested list inside child.
- child destructure: `const { name, badges } = product`.
- child alias: `const item = product`.
- safe list chain before child map source:
  `products.filter(...).map(product => <ProductCard product={product} />)`.
- PHP e2e context depth with `$data_1` and `$data_2`.

### Risks

- This phase touches the same behavior as the `full-template-surface` parity
  fixture. Any bug can create dangling replacement variables in generated list
  item objects.
- The transform must distinguish passing the whole list item object from passing
  a single scalar field. Phase A already supports the scalar field case.

## Phase D - Prop Rename And Destructure Variants

### Goal

Support normal same-file prop naming variations after object and list-item
tracing are stable.

```jsx
<ProductCard item={ product } />

const ProductCard = ({ item: product }) => (
	<article>{ product.name }</article>
);
```

### Required Behavior

- Support JSX prop rename: `item={ product }`.
- Support child destructure rename: `{ item: product }`.
- Support nested object destructure where static:
  `{ hero: { title } }`.
- Support default values only when they do not obscure binding metadata:
  `{ title = '' }`.
- Reject or warn on rest destructuring.

### Tests

- prop rename from parent to child.
- child destructure rename.
- nested destructure.
- assignment aliases after destructure.
- unsupported rest destructure.

### Risks

- Defaults and rest patterns can silently hide whether a value came from the
  selector path or runtime fallback data.
- This should not become a general destructuring engine beyond static patterns.

## Phase E - Same-File Component Graph

### Goal

Allow tracing through multiple same-file component hops.

```jsx
const App = () => <Shell hero={ hero } />;
const Shell = ({ hero }) => <Header hero={ hero } />;
const Header = ({ hero }) => <h1>{ hero.title }</h1>;
```

Expected synthesized path:

```txt
hero.title
```

### Required Behavior

- Build a same-file component definition map.
- Trace direct JSX component references through multiple hops.
- Detect cycles and stop with a diagnostic.
- Keep dynamic component references unsupported.
- Include trace paths in debug metadata.

### Tests

- two-hop trace.
- three-hop trace.
- sibling components receiving the same selector path.
- cycle detection.
- dynamic component variable rejected or warned.

### Risks

- Repeated traversal can become expensive or duplicate declarations.
- Recursion guards already exist for rendered output; tracing needs its own graph
  cycle guard.

## Phase F - Cross-File Graph

### Goal

Explore whether component graph tracing can cross file boundaries in a way that
is reliable enough to ship.

### Required Behavior

- Start with explicit opt-in only.
- Resolve direct named imports from relative files.
- Avoid barrel files and re-exports in the first slice.
- Cache parsed files to avoid repeated work.
- Emit diagnostics when the graph cannot be resolved.

### Tests

- parent and child in two files with named import.
- default import if supported.
- unresolved import diagnostic.
- barrel/re-export unsupported diagnostic.
- no tracing through `node_modules`.

### Risks

- Babel plugin execution may not have enough project graph context.
- Bundler aliases, TS path aliases, and build systems complicate resolution.
- Cross-file tracing may be better handled by a separate prepass or explicit
  manifest rather than inside the transform.

## Phase G - Opt-In Context Tracing

### Goal

Only after prop tracing is stable, explore an explicit template context API.

### Direction

Do not infer arbitrary React context. Instead, consider a package-scoped API:

```jsx
<TemplateDataProvider value={ hero }>
	<Header />
</TemplateDataProvider>
```

or a recognized consumer hook that can be parsed like selectors.

### Risks

- Generic context inference is too runtime-dependent.
- A template-specific context API may be useful, but it is a separate authoring
  model and should not be mixed into prop tracing prematurely.

## Diagnostics Policy

Default mode:

- warn for unsupported boundaries that can still produce valid output
- fail closed when output would be broken or import removal would leave live
  selector references

Strict mode:

- throw for all unsupported selector-derived metadata loss
- recommended for CI and review gates while selector mode is experimental

Never:

- knowingly synthesize a declaration for a value that has crossed an unsupported
  metadata boundary
- emit dangling replacement identifiers
- silently drop selector-derived data without debug metadata

## Debug Metadata Additions

Extend `metadata.storeSelectorTemplateVars` as tracing grows:

- outgoing prop traces
- incoming prop traces
- graph hop count
- source component and target component
- unsupported boundary kind
- reason a trace was skipped
- synthesized declarations caused by child usage

## Review Questions

- Should Phase B object props support direct object root rendering, or should root
  object rendering remain a warning until a real use case appears?
- In Phase C, should list item props passed to child components preserve flat
  child `templateVars` support, or should selector tracing replace that path?
- Is same-file multi-hop tracing worth doing before cross-file import tracing, or
  does real usage require cross-file support sooner?
- Should cross-file tracing be part of this Babel plugin, or a separate prepass
  that feeds a manifest into the plugin?
- Should the runtime API remain `useStoreSelector`, or should the template-only
  nature be made explicit with a different exported name before release?

## Recommended Next Step

Implement Phase B only. Do not start with list item tracing.

Phase B will prove whether object-root metadata can be transferred safely without
creating partial transforms. Once Phase B is green and reviewed, Phase C can
reuse the same graph transfer model with list context depth added.
