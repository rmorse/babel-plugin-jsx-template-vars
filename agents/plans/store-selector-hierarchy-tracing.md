# Store Selector Hierarchy Tracing Plan

## Current State

The store selector experiment has proven the selector contract at the
registry/controller boundary:

- selectors synthesize flat declarations
- aliases resolve local names to canonical paths
- list shapes are discovered from visible `.map()` usage
- safe list chains are supported before `.map()`
- `store-selector-complex-surface` byte-matches `full-template-surface` for
  Handlebars and PHP as a parent-selector parity fixture, while child components
  still use explicit flat `templateVars`
- `store-selector-full-template-surface` byte-matches `full-template-surface`
  for Handlebars and PHP without child component `templateVars`, including
  list-context object-field props such as `badges={ product.badges }`
- debug metadata is available through `metadata.storeSelectorTemplateVars`
- debug metadata includes declaration provenance and props-object member aliases
- cross-file tracing has an explicit in-memory manifest/prepass prototype for
  direct relative named imports
- Phase A tracing supports same-file direct scalar child props
- same-file top-level multi-hop tracing is intentionally supported by the
  bounded auto-seeding pass
- focused multi-hop and cycle-safety tests cover the bounded fixed-point pass
- simple props-object child params such as `(props) => props.hero.title` are
  supported for replacement, control, and list-context child usage
- unsupported child param patterns warn by default and throw in strict mode

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
- preserve normal React component semantics; do not reinterpret a component's
  parameter name as a prop name or invent mappings to rescue mismatched
  parent/child prop contracts
- synthesize the same flat paths that a user could have declared manually
- keep controllers selector-agnostic apart from generic alias wiring
- fail closed or warn when metadata crosses an unsupported boundary
- avoid partial transforms when metadata is known to be lost
- add debug metadata for traced paths so authors can inspect the compiled view

The implementation constraint from Phase A is important: incoming prop traces
must become selector-derived aliases in the child collector before declaration
synthesis. They should not be converted directly into declarations except for
the already-supported scalar one-hop case. Object and list item tracing must let
child usage create concrete flat paths, then continue through the existing
registry/controller handoff.

The central refactor for all later phases is a seedable usage-discovery core.
Today the collector discovers member paths from usage only after it has been
seeded by local selector calls. Phase B/C/E need the same discovery machinery to
run from an incoming prop alias, for example `Header.hero -> hero`, even when the
child has no selector calls. This refactor should happen before adding more
user-facing tracing behavior.

## Phase Alignment With The Implementation Plan

This document uses the hierarchy-tracing phase names below. The earlier
`store-selector-data-contract-implementation.md` file has a shorter deferred
outline where destructured props and child aliases appear as separate early
phases. Treat this table as the source of truth for the tracing stream:

| Hierarchy phase | Earlier outline topic | Scope in this document |
| --- | --- | --- |
| Phase A | direct child props | already implemented for same-file scalar paths |
| Phase B | destructured child props / child aliases | object-root child tracing plus child-side usage discovery |
| Phase C | list item propagation | list item roots, scalar item props, and list-context object-field props |
| Phase D | rename/destructure variants | child-side rename, nested destructure, defaults, and rest rejection |
| Phase E | same-file component graph | implemented for top-level relay; remaining graph hardening and diagnostics |
| Phase F | cross-file graph | opt-in import graph tracing |
| Phase G | opt-in context tracing | template-specific context API exploration |

## Non-Goals For This Stream

- arbitrary React runtime analysis
- cross-bundle or build-system-specific module graph resolution
- broad support for spreads, HOCs, render props, or dynamic component names
- generic `React.createContext()` inference
- implicit tracing through imported helper functions
- changing PHP or Handlebars output semantics

## Refactor Slice - Seedable Discovery And Boundary Catalog

### Goal

Extract the local usage-discovery logic so it can be seeded from either:

- selector assignments in the component body
- incoming prop aliases produced by a parent component trace

This slice should not add new user-facing tracing support by itself. It prepares
Phase B and Phase C to use the same discovery engine.

### Required Behavior

- Extract or isolate the discovery core currently responsible for local aliases,
  map shapes, and alias usage.
- Accept seed aliases shaped like `local binding -> canonical segments`.
- Support a seed mode for object roots and a C-ready seed mode for list-relative
  roots.
- Keep `experimentalStoreSelectors.__seedAliasesByComponent` as an
  undocumented internal bridge for tests and future cross-file prepass input. It
  must remain validated/fail-closed and should not be documented as supported
  author-facing API while the experiment is in draft.
- Preserve existing selector-call collection behavior.
- Always record unsupported metadata in transform metadata, even when warnings
  are suppressed with `warnOnUnsupported: false`.
- Add a boundary catalog for unsupported JSX prop/expression shapes before they
  can be mis-synthesized.
- Decide traced-field versus explicit child `templateVars` collision behavior
  before Phase C. Default policy: explicit child `templateVars` wins; tracing for
  that local path is suppressed; debug metadata records the shadowed trace.

### Boundary Catalog

Unsupported selector-derived prop boundaries should warn by default and throw in
strict mode unless a phase explicitly supports them:

- spread props
- computed member reads
- logical expressions: `x={ a && b }`
- conditional expressions: `x={ condition ? a : b }`
- template literals
- call expressions / opaque helper results
- multiple selector-derived sources for one prop
- the same child rendered inside and outside a list context with the same traced
  prop
- traced child components whose first parameter cannot be statically resolved as
  either a destructured object pattern or a props-object identifier. Supported
  examples are `({ hero }) => hero.title` and `(props) => props.hero.title`;
  bare param-as-prop forms such as `(hero) => hero.title` for
  `<Header hero={ hero } />` remain outside this slice.
- dynamic component names
- imported/unknown child components before cross-file tracing
- prop mutation or rebinding that obscures provenance

### Tests

- seedable discovery from an object prop alias produces the same member
  declarations as same-component selector usage.
- seedable discovery from a list-relative alias does not synthesize a nested list
  wrapper inside the child.
- every boundary catalog item fails closed instead of synthesizing a guessed
  declaration.
- `warnOnUnsupported: false` suppresses user-facing warnings but still records
  machine-readable unsupported metadata.
- explicit child `templateVars` shadow a traced path and appear in debug metadata
  as an explicit override.

### Pass/Fail Gate

- all existing selector and flat tests remain green
- no new user-facing tracing behavior is exposed before Phase B
- child-body discovery can run with incoming aliases and no selector imports
- unsupported metadata is always available to debug/review tooling
- registry/controller output behavior is unchanged

## Phase A Versus Phase B Tracing Models

Phase A traces fully resolved scalar paths at the parent prop boundary:

```txt
title -> hero.title -> <Header title={title}> -> Header.title
```

The parent already knows the final flat path (`hero.title`), so the child can be
seeded with a concrete alias and declaration.

Phase B is different. The parent only knows an object root:

```txt
hero -> hero -> <Header hero={hero}> -> Header.hero
```

The final paths are discovered by reading child usage:

```txt
Header.hero.title -> hero.title
Header.hero.status -> hero.status
```

That requires a child-side usage collector that can run with incoming aliases,
even when the child component has no selector calls of its own. The collector
must produce declarations from child usage, not from the object root crossing the
prop boundary.

Phase B implementation note: the current scalar path can use
`createStoreSelectorPropAliases()` as a shortcut because the parent trace already
contains the final scalar declaration. Object and list props cannot use that
shortcut safely. They need either a bounded child re-collection pass seeded with
incoming aliases, or an equivalent collector entry point that analyzes the child
body after incoming metadata is known.

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
- Add a child usage collector that can run with incoming prop aliases and does
  not require selector imports or selector calls inside the child component.
- Seed incoming object props as alias-only metadata in the child collector; do
  not widen the current scalar `createStoreSelectorPropAliases()` path and
  accidentally synthesize the object root.
- Split child prop trace policy by source shape instead of using one broad
  boolean:
  `object-root`, `list-item-root`, `list-item-field`, and `scalar-field`.
- Do not synthesize the object root from member usage.
- Default object-root policy: no root declaration for `hero` unless there is a
  flat shape hint. Member usage such as `hero.title` should synthesize only the
  member path.
- Direct child render of an object root, for example `{ hero }`, is unsupported
  in Phase B by default. It should warn in default mode and throw in strict mode
  unless a future review identifies a concrete object-root render contract worth
  supporting.
- Keep this phase one-hop only. A child that forwards the object to another
  child remains unsupported until the same-file graph phase.
- Preserve warning/strict behavior for unsupported object flows.
- Build on the seedable discovery refactor. Phase B should not implement a
  second object-only discovery path.

### Tests

- `hero -> Header.hero -> hero.title` replacement.
- `hero -> Header.hero -> hero.status === 'published'` control.
- child alias: `const heading = hero.title`.
- child destructure: `const { title } = hero`.
- object root direct render is explicitly unsupported in Phase B and covered by a
  warning/strict negative test.
- unsupported nested dynamic member: `hero[key]` warns or errors according to the
  existing unsupported policy.
- no root declaration is generated for `hero` when only `hero.title` is used.
- negative: object prop passed to a child with no traceable usage warns or
  errors, and does not synthesize a root path.
- debug metadata shows the incoming prop trace, child usage that caused the
  synthesized declaration, and any skipped usage.

### Risks

- Object roots can look like generic runtime objects. The transform must avoid
  treating all child object reads as template paths unless the object binding is
  selector-derived.
- This phase can create many paths from a single prop. Debug output must make
  those paths inspectable.
- The current Phase A implementation collects child declarations before incoming
  prop aliases are known. Phase B needs a bounded second collection pass or an
  equivalent pre-seeded alias path for child components.
- The collector must avoid a partial flat fallback where the child has local
  `templateVars` that make the output look valid while selector provenance was
  actually lost.

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
- Limit support to direct same-file component references whose child definition
  is known. Imported children, dynamic component variables, spreads, render
  props, and HOCs stay unsupported.
- Distinguish whole-item props (`product={ product }`) from scalar item props
  (`name={ product.name }`). Both may be useful, but they need separate tests
  because scalar item props do not carry the same child object shape.
- Support list-context object-field props, for example
  `badges={ product.badges }`, as a separate bridge case from whole-item and
  scalar props. This is required for child maps such as
  `badges.map(badge => badge.label)`, which should synthesize
  `products[].badges[].label`.
- Reject or warn on shadowed callback params, computed members, ambiguous
  aliases, and unsupported chains before the child boundary.
- Use relative child synthesis for list-item children. A child receiving
  `product` from a parent-owned `products.map(...)` should render item-relative
  paths such as `name` with inherited context metadata, not create a second
  canonical `products[].name` list wrapper inside the child.
- Carry enough context metadata to prevent double `{{#products}}` /
  `foreach ($data['products']...)` wrapping.
- Apply the explicit-child-`templateVars` collision policy: explicit child
  declarations win and suppress tracing for the same child-local path, with a
  debug note.

### Tests

- `product -> ProductCard.product -> product.name`.
- `product.available && ...` control inside child.
- `product.badges.map(...)` nested list inside child.
- child destructure: `const { name, badges } = product`.
- child alias: `const item = product`.
- scalar item prop: `name={ product.name }` into `{ name }`.
- nested map child boundary:
  `product.badges.map(badge => <Badge badge={ badge } />)`.
- list-context object-field prop:
  `badges={ product.badges }` into `badges.map(...)`.
- nested list child with parent and nested item data, for example
  `sections[].items[]` rendering an `ItemCard` that receives both `section` and
  `item`. This must prove both parent list metadata and nested item metadata
  reach the child without PHP context-depth regressions.
- shadowed alias rejection:
  `products.map(product => other.map(product => <Card product={product} />))`.
- imported or unknown `ProductCard` stays unsupported with diagnostics.
- safe list chain before child map source:
  `products.filter(...).map(product => <ProductCard product={product} />)`.
- PHP e2e context depth with `$data_1` and `$data_2`.
- no-explicit-child-`templateVars` parity fixture that byte-matches
  `full-template-surface` once Phase C is expected to replace the child
  declarations.
- double-wrap regression: traced list-item children must not emit their own
  duplicate `products` list wrapper.
- collision with explicit child `templateVars` follows the documented policy.

### Risks

- This phase touches the same behavior as the `full-template-surface` parity
  fixture. Any bug can create dangling replacement variables in generated list
  item objects.
- The transform must distinguish passing the whole list item object from passing
  a single scalar field. Phase A already supports the scalar field case.
- Nested maps can cross two context depths before the child component renders.
  The pass/fail gate must verify both Handlebars relative paths and PHP
  `$data_N` depth, not just synthesized flat strings.
- The current `store-selector-complex-surface` fixture is a parent-selector
  parity gate because child components still use flat declarations. It does not
  prove Phase C until list-item child declarations are removed incrementally and
  byte-matched again.
- Phase C is not just Phase B with list depth added. It needs relative path
  synthesis plus inherited context metadata, whereas Phase B emits canonical
  object paths such as `hero.title`.

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

- Treat JSX prop naming (`item={ product }`) as part of the Phase B/C trace
  record. Do not defer it if the child receives the value through a simple
  destructured prop.
- Support child destructure rename: `{ item: product }`.
- Support nested object destructure where static:
  `{ hero: { title } }`.
- Support default values only when they do not obscure binding metadata:
  `{ title = '' }`.
- Reject or warn on rest destructuring.

### Tests

- prop rename from parent to child if not already covered in Phase B/C.
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

Maintain and harden tracing through multiple same-file component hops.

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

- Keep the same-file top-level component definition map as the tracing boundary.
- Trace direct JSX component references through multiple hops with the bounded
  fixed-point seed pass.
- Allow relay components without selector calls to run the child usage collector
  when they receive incoming prop aliases. This is what lets
  `App -> Shell -> Header` work when `Shell` only forwards `hero`.
- Detect cycles and stop with a diagnostic.
- Keep dynamic component references unsupported.
- Include trace paths in debug metadata.

### Tests

- two-hop trace.
- three-hop trace.
- non-selector relay:
  `App` selects `hero`, `Shell` forwards `hero`, and `Header` reads
  `hero.title`.
- sibling components receiving the same selector path.
- cycle detection.
- dynamic component variable rejected or warned.

### Risks

- Repeated traversal can become expensive or duplicate declarations.
- The fixed-point pass is bounded by same-file component count and dedupes seed
  aliases, but explicit cycle diagnostics are still useful before release.
- Recursion guards already exist for rendered output; tracing should continue to
  keep its own graph safety checks.

## Phase F - Cross-File Graph

### Goal

Explore whether component graph tracing can cross file boundaries in a way that
is reliable enough to ship.

### Current Prototype

The first cross-file gate is implemented as an explicit manifest/prepass rather
than implicit per-file build-order state:

- `createStoreSelectorCrossFileManifest(files)` accepts a filename-to-source map.
- It parses each file once, resolves direct relative named component imports, and
  runs the same bounded seed discovery model across the file graph.
- The manifest exposes `seedAliasesByFile` and `componentNamesByFile`.
- The normal plugin consumes that manifest through
  `experimentalStoreSelectors.__crossFileManifest`.
- The transform remains per-file; the manifest is the handoff that makes child
  seeds available regardless of transform order.

Validated behavior:

- parent and child split across two files with a direct named relative import
- three-file `App -> ProductCard -> Badge` list propagation
- nested list context depth for Handlebars and PHP
- named exported variable components
- unresolved imports, non-relative imports, and barrel/re-export targets do not
  invent seeds and report diagnostics

### Required Behavior

- Keep cross-file tracing explicit opt-in only.
- Resolve direct named imports from relative files.
- Avoid barrel files and re-exports in the first slice.
- Cache parsed files to avoid repeated work.
- Emit diagnostics when the graph cannot be resolved.
- Keep the manifest shape internal until the experiment is reviewed.

### Tests

- parent and child in two files with named import: implemented.
- nested list child chain across three files: implemented.
- PHP nested context depth across files: implemented.
- unresolved import diagnostic: implemented.
- barrel/re-export unsupported diagnostic: implemented.
- no tracing through non-relative/package imports: implemented.
- default import: not supported in this slice unless a later review decides to
  add a strict default-export contract.

### Risks

- Babel plugin execution may not have enough project graph context.
- Bundler aliases, TS path aliases, and build systems complicate resolution.
- Cross-file tracing may be better handled by a separate prepass or explicit
  manifest rather than inside the transform.
- The current helper accepts in-memory sources. A production integration still
  needs a file-system/project wrapper that controls included files and cache
  invalidation.

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
- emit a non-suppressible safety diagnostic when selector-derived data crosses
  an unsupported boundary and a child component's flat `templateVars` appear to
  provide a local fallback for the same prop name. This "partial flat fallback"
  can look correct while losing canonical selector provenance.
- never treat `warnOnUnsupported: false` as a review or release gate; it is only a
  noise-suppression escape hatch for callers that knowingly accept degraded
  output
- review evidence should come from strict mode or warning-visible default mode.
  A passing transform with `warnOnUnsupported: false` does not prove the output is
  complete.
- distinguish broken output from lossy output:
  broken output leaves dangling references or live selector imports; lossy output
  is syntactically valid but has silently empty template content after
  neutralization. Both need metadata, and lossy output must not count as a green
  tracing gate.

Strict mode:

- throw for all unsupported selector-derived metadata loss
- recommended for CI and review gates while selector mode is experimental

Never:

- knowingly synthesize a declaration for a value that has crossed an unsupported
  metadata boundary
- emit dangling replacement identifiers
- silently drop selector-derived data when debug mode is enabled; the metadata
  must record what was skipped and why
- omit machine-readable unsupported metadata because user-facing warnings were
  suppressed
- mark a phase complete without strict-mode negative tests for every unsupported
  selector-derived boundary added by that phase

## Debug Metadata Additions

`metadata.storeSelectorTemplateVars` now includes:

- synthesized declarations and raw declarations
- list shapes
- aliases, including props-object member aliases via `memberName`
- outgoing prop traces
- incoming prop traces
- unsupported boundaries
- explicit, shadowed, and combined template vars
- `declarationProvenance`, keyed by synthesized declaration, with the usage or
  map-list source path that caused the declaration

Remaining metadata hardening as tracing grows:

- graph hop count
- source component and target component
- source prop name, child local binding name, and canonical path
- trace status:
  `supported`, `unsupported`, `partial-flat-fallback`, or `skipped`
- usage kind that caused synthesis: replacement, control, list, or direct root
- unsupported boundary kind
- reason a trace was skipped
- synthesized declarations caused by child usage
- per-path provenance keyed by synthesized declaration, including the
  prop-to-param-to-component chain that produced it
- context depth for list-derived traced paths
- enough source location data to identify the JSX prop and child usage when Babel
  provides locations

Warnings for unsupported traced props should also include a compact trace
summary, even when full debug metadata is disabled. Example:

```txt
hero -> Header.hero (unsupported: object-root tracing is not enabled)
```

## Implementation Review Findings

Ordered by severity against the current implementation:

- P0: Phase B cannot be implemented by only relaxing
  `canTraceChildProp()`. The visitor currently collects all component selector
  usage first, then converts incoming traces into aliases and declarations in a
  later pass (`visitor.js:174`, `visitor.js:189`,
  `store-selector-template-vars.js:86`). That is enough for scalar Phase A, but
  object roots need incoming aliases before child usage is scanned. Otherwise
  `hero={ hero }` either remains unsupported or incorrectly generates a root
  `hero` declaration instead of `hero.title`.
- P0: The plan should make "metadata transfer, not React simulation" more
  operational. The safe model is still selector path -> binding -> JSX prop ->
  child binding -> registry/controller alias wiring. The unsafe model is walking
  arbitrary render behavior. Phase B/C should stay inside the existing
  registry/controller reuse path: `createTemplateVarsRegistry()` plus
  `templateVarsController.init()` and `ListController.registerExternalPathAliases()`
  (`template-vars-registry.js:54`, `controller.js:115`,
  `controllers/list.js:142`).
- P1: Phase B before Phase C is correct. Object roots prove usage-driven child
  declaration synthesis without list context depth. List item tracing adds
  context offsets, nested list metadata, and PHP `$data_N` concerns, so it should
  come after the object pass is stable.
- P1: Phase C needs stronger safeguards around aliases and nested maps. It must
  reject shadowed map params, imported children, unknown component definitions,
  computed item reads, spreads, and ambiguous aliases. Nested map tests must
  assert generated PHP and Handlebars, not only the debug declarations.
- P1: The diagnostics policy is close, but default warning mode can still render
  valid-looking empty output when an author ignores a warning. Each phase needs
  strict-mode negative tests and debug assertions for every skipped
  selector-derived boundary (`diagnostics.js:19`,
  `store-selector-template-vars.test.js:456`).
- P1: Debug metadata is currently useful for synthesized declarations, aliases,
  unsupported paths, and incoming/outgoing traces, but it is not yet sufficient
  to explain why a child usage created a specific path. Add child usage origin,
  usage kind, and context depth before calling a phase complete
  (`visitor.js:216`, `store-selector-template-vars.js:214`,
  `store-selector-template-vars.test.js:379`).
- P2: Phase D currently mixes already-supported/required JSX prop naming with
  harder child binding variants. Simple JSX prop renames should be accepted in
  Phase B/C because traces already carry `propName`; Phase D should focus on
  child-side destructure rename, nested destructure, defaults, and rest rejection.
- P2: Same-file top-level multi-hop tracing is now intentionally supported by
  the bounded fixed-point traversal. Keep explicit tests for two-hop/three-hop
  relay, ambiguous relay sources, and cycle safety. Cross-file graph tracing
  remains a separate Phase F concern.
- P0: Every phase after Phase A depends on seedable child-body usage discovery.
  The current collector is hard-seeded from selector calls, so adding Phase B
  directly risks either synthesizing object roots or duplicating discovery logic.
  Implement the seedable discovery refactor first.
- P0: Phase C list-item tracing must not synthesize canonical list paths inside
  the child in a way that creates a second list wrapper. It needs relative child
  paths plus inherited context metadata.
- P1: The current complex-surface parity fixture is a parent-selector parity
  baseline, not a hierarchy-tracing proof. This is now covered by
  `store-selector-full-template-surface`, which removes child `templateVars` and
  byte-matches `full-template-surface`.

## Review Questions

- Direct object root rendering is not a Phase B default. It remains unsupported
  unless reviewers identify a concrete object-root render contract that should be
  promoted into a later gate.
- In Phase C, explicit child `templateVars` should win over traced fields for the
  same child-local path, with debug metadata recording that tracing was
  shadowed. Do reviewers see a reason to prefer merge-or-error instead?
- Is same-file multi-hop tracing worth doing before cross-file import tracing, or
  does real usage require cross-file support sooner?
- Should cross-file tracing be part of this Babel plugin, or a separate prepass
  that feeds a manifest into the plugin?
- Should the runtime API remain `useStoreSelector`, or should the template-only
  nature be made explicit with a different exported name before release?

## Completed Full-Surface Parity Gate

The seedable discovery refactor, boundary catalog, same-file auto-seeding pass,
and selector-based `full-template-surface` parity fixture are now implemented.
The parity fixture verifies:

- no child component `templateVars`
- top-level selectors in the parent
- child object-root and list-item props inferred through auto-seeding
- `badges={ product.badges }` covered as a list-context object-field prop
- byte-matched Handlebars and PHP output against `full-template-surface`
- no orphaned template declarations or leaked runtime selector calls

This proves the no-explicit-child-`templateVars` version of the hard fixture
before broader context tracing work starts.

## Recommended Next Step

Send the completed cross-file manifest gate through review. If reviewers agree
the explicit prepass shape is sound, choose the next slice from the remaining
documented boundaries: a production file-system wrapper for the manifest,
bare param-as-prop diagnostics, broader unsupported-boundary/debug metadata
hardening, marker coexistence, or context tracing.

Historical refactor pass/fail gates, now completed:

- local usage discovery can be seeded by incoming prop aliases without selector
  imports in the child
- selector-call behavior remains unchanged
- list-relative seed tests prove the engine can support Phase C without double
  wrapping
- boundary catalog negative tests fail closed for every unsupported prop shape
- unsupported metadata is always recorded, even when warnings are suppressed
- explicit child `templateVars` collision policy is tested and represented in
  debug metadata

Phase B pass/fail gates:

- child usage collector can run on a child component with incoming aliases and no
  local selector calls
- same-file one-hop object prop replacement, control, alias, and simple child
  destructure pass for Handlebars and PHP
- no synthesized root object declaration unless direct root rendering is
  explicitly supported in a later phase
- object-root direct render policy is covered by an explicit unsupported
  warning/strict negative test
- unsupported computed members, child forwarding, unknown/imported child
  components, unsupported param patterns, and spreads warn by default and throw
  in strict mode
- selector parent plus flat child `templateVars` does not silently byte-match a
  fully traced target when provenance was lost; it emits the partial-flat-fallback
  diagnostic
- debug metadata identifies outgoing trace, incoming trace, child usage kind,
  synthesized declaration, trace status, and skipped boundaries
- implementation keeps selector-specific behavior in the collector/visitor alias
  handoff and continues to reuse the existing registry and controllers for
  output generation
- gate verification must run in strict mode or warning-visible default mode;
  `warnOnUnsupported: false` cannot be used to claim Phase B completeness
