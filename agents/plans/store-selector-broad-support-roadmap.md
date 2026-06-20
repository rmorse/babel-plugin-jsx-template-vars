# Store Selector Broad Support Roadmap

## Goal

Define the remaining work needed before the store-selector experiment can be
considered high-level support for statically traceable, prop-driven component
tree authoring patterns.

This is a roadmap, not a single implementation plan. Detailed implementation
plans should remain focused and link back here. The active detailed plan for
multi-source object-root path-polymorphism is
[store-selector-multi-source-path-plan.md](./store-selector-multi-source-path-plan.md).
The next detailed proposal for making static component graphs feel more
drop-in is
[store-selector-drop-in-static-support-plan.md](./store-selector-drop-in-static-support-plan.md).

## What Broad Support Means

Broad support means an author can use common statically traceable prop-driven
patterns:

- select data from one store-shaped state object
- pass selected values through ordinary same-file and cross-file component trees
- rename local variables and props naturally
- render scalar replacements, controls, lists, and nested lists
- reuse the same child component from multiple callsites with different
  canonical roots
- rely on Handlebars and PHP output parity for the supported shapes
- get clear diagnostics when a shape is unsupported

It does not mean arbitrary React data-flow simulation. The transform should
still fail closed for dynamic components, HOCs, render props, generic context,
and shape-polymorphic output until those are separately proven. Optional
chaining, `children` composition, and JSX spreads are common enough that they
need explicit investigation gates rather than being treated as permanent
non-goals.

## Proven Foundation

Already implemented and reviewed:

- Role-neutral `useStoreSelector` path declarations.
- Usage-based role inference through the existing registry/controllers.
- Selector-only component discovery.
- Local aliasing, destructuring, map aliases, and safe list chains.
- Child prop auto-seeding for same-file component trees.
- Same-file multi-hop relay for object and list contexts.
- Same-file path-polymorphic object roots via template-root descriptors.
- Direct cross-file path-polymorphic object roots for relative named imports,
  with parent-side descriptor callsite contexts and child-side relative
  dynamic-root discovery.
- Manifest parser/resolver/component-shape hardening for cross-file tracing:
  parse errors diagnose instead of throwing, TS/TSX parse intentionally,
  extensionless/index resolution is locked down, unsupported component
  declarations diagnose, and import cycles fail closed.
- Relative named import breadth:
  - renamed named imports, such as `import { Header as PageHeader }`, trace
    correctly
  - multiple exports from one child file keep independent component/prop
    decisions
  - default, package, and namespace imports remain diagnostic-only
- Minimal mixed-context policy for list-relative work: scalar member
  multi-source remains parent-materialized when possible, list/non-list reuse
  fails closed unless safe, and explicit flat hint collision behavior remains
  registry-validated.
- Same-file and cross-file list-relative multi-source support for compatible
  child-relative shapes, including whole item props and object-field list props
  such as `badges={ product.badges }`.
- Common React pattern static subsets:
  - static optional member chains, such as `hero?.title`, normalize to normal
    template paths
  - selector scalar children render through direct children-passthrough
    components
  - list-rendering children remain supported inside component children
  - static object-literal spreads with scalar selector fields are
    parent-materialized
- Descriptor hardening:
  - generated runtime helper imports
  - transform-time containment for bare descriptors
  - ordinary runtime props rejected for dynamic-root child props
  - local aliases and props-object params supported
- Selector-only `full-template-surface` parity.
- Split-file `full-template-surface` parity for the current manifest model.
- PHP nested list depth coverage.
- Minimal dynamic-root debug metadata in review mode, plus manifest-level
  callsite context records for the direct cross-file object-root slice.
- Shape-agnostic filesystem wrapper skeleton:
  - deterministic project source discovery
  - manifest creation from filesystem sources
  - Babel option handoff that hides `__crossFileManifest` behind an
    experimental helper
  - README documentation for strict/review mode and supported static subsets
- Final parity fixture coverage for supported broad-support surfaces:
  - same-file selector-only full surface
  - split-file selector-only full surface
  - same-file list-relative multi-source
  - cross-file object-root multi-source
  - cross-file list-relative multi-source
  - cross-file object-root relay multi-source
  - nested list-relative multi-source
  - mixed-context and incompatible-list fail-closed fixtures

Latest broad-support review follow-ups now covered:

- same child reused at different list depths keeps PHP context depth correct
  for both same-file and cross-file list-relative multi-source cases
- computed optional member usage such as `hero?.[key]` fails closed instead of
  rendering empty output
- dangerous mixed list/non-list child prop cases and incompatible
  list-relative shapes hard-error even when warnings are suppressed
- multi-source ambiguity diagnostics are intentionally unconditional. This
  shifts risk from silent under-rendering to possible over-rejection, so every
  newly supported static shape must add a nearby positive fixture and a
  fail-closed sibling fixture for the unsupported variant.
- extensionless `.ts` / `.tsx` and `index.ts` / `index.tsx` relative imports
  resolve in the cross-file manifest
- cross-file debug `compiledPaths` report composed child paths such as
  `home.hero.title`, not only the canonical root

Architecture note: object-root path-polymorphism uses descriptor callsite
contexts, where parents inject root descriptors and children compose relative
member paths. Compatible list-relative multi-source uses seed-sharing via
child-relative `declarationSegments`; it should not introduce descriptor
wrapping for every list item because the parent list wrapper and PHP context
depth are already the owning context.

Current boundaries are documented in:

- [store-selector-data-contract-implementation.md](./store-selector-data-contract-implementation.md)
- [store-selector-hierarchy-tracing.md](./store-selector-hierarchy-tracing.md)
- [store-selector-multi-source-path-plan.md](./store-selector-multi-source-path-plan.md)

## Remaining Gates

### 1. Cross-File Object-Root Callsite Contexts

The same-file descriptor model must work when parent and child components live
in different files.

Must prove:

- `HomePage.jsx` and `ArticlePage.jsx` both import `Header.jsx`.
- Both pass different object roots into the same child prop.
- One authored `Header` component renders correct paths for both parents.
- Handlebars and PHP output match expected byte output.
- Multi-hop cross-file relay works.
- Valid path-polymorphic callsites do not fall back to ambiguous seed
  suppression.
- Unsupported import shapes still fail closed.

Implementation direction:

- Replace the single global child seed model with manifest callsite contexts.
- Track parent file, parent component, JSX callsite, target file/component, prop,
  canonical root, declaration segments, and skip reason.
- Keep descriptor injection in parent transforms and relative child discovery in
  child transforms.
- Cross-file child transforms must be configured for relative dynamic-root
  discovery only. For example, `Header.jsx` should know that `Header.hero` is a
  dynamic root, but it should not receive a single global canonical seed for
  `hero`. `HomePage.jsx` and `ArticlePage.jsx` each receive their own callsite
  descriptor contexts and inject `createTemplateRootDescriptor(...)` at their
  JSX callsites.
- Add stable callsite IDs before grouping flows by component. The current
  same-file/cross-file seed flows group by component name; Phase 3 must preserve
  callsite identity before that grouping can erase source distinctions.
- Keep the first implementation slice deliberately narrow:
  - direct relative named imports only
  - `const` / `export const` component declarations only
  - two parent files importing one child
  - one object-root prop
  - child replacement plus control
  - Handlebars and PHP expected output
  - no relay in the first proof
- Add one cross-file relay hop only after the direct parent-to-child proof
  passes. This is the second slice, not part of the smallest proof.

Minimum manifest context schema:

```txt
callsiteId
parentFile
parentComponent
targetFile
targetComponent
importEdgeId
jsxTag
propName
canonicalSegments
declarationSegments
strategy
skipReason?
```

The manifest should compute one dynamic-root decision per
`targetFile + targetComponent + propName` and derive both parent callsite
descriptor injection records and child relative-discovery records from that
decision. Do not compute `callsiteContextsByFile` and
`childRelativeDiscoveryByFile` independently; a parent injecting a descriptor
for a child that was not configured to consume one is a manifest consistency
bug.

Keep legacy `seedAliasesByFile` compatibility while migrating so existing
cross-file tests keep running during the transition.

Regression note: the existing `ambiguous-cross-file-seed` negative fixture
should become a positive multi-source object-root fixture for the supported
direct named-import shape. Unsupported import or component shapes should keep
their negative diagnostics.

### 2. Cross-File Debug Metadata

Cross-file tracing must be inspectable before the graph becomes broad.

Must expose:

- resolved import edge
- normalized parent and target filenames
- parent component and JSX callsite ordinal or source location
- target component/export
- import edge ID
- prop name
- role
- canonical root
- canonical segments
- declaration segments
- context depth
- strategy
- local child paths
- compiled paths
- skip reason for skipped edges
- cross-file seed/callsite propagation hops

This should build on the existing dynamic-root debug metadata, but it needs
callsite identity and file-level provenance.

### 3. Manifest Resolver, Parser, And Component Shape Contract

Before scanning real projects, the manifest must have a narrow but stable
resolver/parser/component declaration contract.

Must prove:

- parser failures are diagnostics, not crashes
- `.js` / `.jsx` / extensionless / index resolution behavior is locked down
  against the current resolver
- `.ts` / `.tsx` are either parsed intentionally or diagnosed cleanly
- supported component forms are explicit:
  - `const Header = () => ...`
  - `export const Header = () => ...`
- unsupported component forms are diagnostic-only:
  - `export function Header()`
  - `export default Header`
  - `export default function Header()`
  - `memo(Header)` / HOCs / wrappers
- unsupported prop-contract forms are diagnostic-only:
  - bare single-param components that rely on parameter names as prop names,
    such as `const Header = ( hero ) => hero.title` paired with
    `<Header hero={ hero } />`; this is a React prop-shape mismatch, and the
    transform should not guess intent
- import cycles are detected and fail closed
- manifest output is deterministic
- stale-cache invalidation expectations are specified before caching exists

This gate should not add broad import support. It should make current narrow
support predictable enough for a project wrapper.

### 4. Minimal Runtime And Package Validation

Some runtime/package checks must be pre-wrapper, because the wrapper should not
validate a harness-only path.

Must prove:

- generated imports only reference exported runtime helpers
- package contents include runtime helper entrypoints
- non-harness transformed modules can resolve generated imports
- descriptor helpers remain part of the documented template runtime contract

Full runtime/package optimization can happen later.

### 5. List-Relative Multi-Source

Support path-polymorphic child components in list contexts.

Do this in two steps. Same-file list-relative multi-source should land before
cross-file list-relative multi-source, because cross-file combines manifest
callsite contexts, list depth, and declaration relativity.

Prerequisite minimal mixed-context policy:

- explicit `templateVars` shadowing and collision behavior under dynamic roots
- same child used in list and non-list contexts must either render correctly or
  fail closed
- scalar member multi-source, such as `featured.name` and `secondary.name`, is
  intentionally parent-materialized when possible and should not be treated as
  an object-root ambiguity

Must prove:

- same child used under different list roots
- whole item props: `product={ product }` then child reads `product.name`
- object-field list props: `badges={ product.badges }` then child maps
  `badges`
- nested child maps produce correct PHP context depth (`$data_1`, `$data_2`,
  etc.)
- no duplicate list wrappers
- no list/non-list leakage
- mixed list and non-list callsites fail closed unless the transform can prove a
  correct relative context
- exact wrapper-count assertions catch duplicate wrapping

This should build on descriptor `declarationSegments`, where canonical segments
and list-relative declaration segments diverge.

Same-file gate:

- one parent file, same child under two different list roots
- `product={ product }` plus child `product.name`
- `badges={ product.badges }` plus child `badges.map(...)`
- `product={ product }` and `badges={ product.badges }` in the same subtree
- child used at two PHP depths in separate callsites
- debug metadata asserts both canonical segments and list-relative declaration
  segments

Cross-file gate:

- only after cross-file object-root callsite contexts and cross-file debug
  metadata are proven
- parent files import the same child and pass different list roots
- same child at `$data_1` and `$data_2`
- nested list depths preserve the expected PHP context variables
- descriptors composed inside a list context do not re-apply the list root, for
  example `products[]` + `name` inside `{{#products}}` must become `$data_1['name']`,
  not `$data_1['products']['name']`
- descriptor values passed into `.map()` preserve declaration-relative segments
- relay through one intermediate component
- object-field list prop under different list roots, for example
  `badges={ product.badges }` from different `.map()` parents
- HBS/PHP byte parity

### 6. Mixed Context Safety

Real component trees reuse children in several contexts.

Must decide and prove:

- same child outside a list and inside a list
- same prop as object root in one callsite and scalar in another
- same prop as object root in one callsite and list in another
- explicit `templateVars` coexistence and collision behavior
- selector-derived props crossing unsupported boundaries
- dynamic-root child inside a control/conditional, for example
  `{ visible && <Header hero={ hero } /> }`
- destructured or props-object defaults that can shadow descriptors, for example
  `({ hero = {} }) => ...`
- `warnOnUnsupported: false` does not hide dangerous partial output

Policy:

- Path-polymorphism may be supported through descriptors.
- Shape-polymorphism must fail closed unless explicit shape evidence exists.

### 7. Common React Pattern Investigations

These patterns are common in real React code. They should be investigated and
either supported for static subsets or diagnosed clearly.

Status: the first static subset is implemented. The remaining work in this
gate is broader local-static proofs and diagnostics polish, not basic support
for the common simple forms.

#### Optional chaining

Supported for static member chains because template paths are static:

```jsx
hero?.title
props.hero?.title
product?.badge?.label
```

Policy:

- normalize static optional member chains to the same path as normal member
  access
- keep computed optional access and call results unsupported:
  - `hero?.[key]`
  - `getHero()?.title`

#### Children composition

Supported for direct children-passthrough components and existing supported
list children. This intentionally does not try to simulate arbitrary
`children` logic:

```jsx
<Card title={ hero.title }>
	<h2>{ hero.subtitle }</h2>
</Card>
```

Policy:

- support selector scalar data in children when the child directly renders the
  `children` prop, such as `({ children }) => <div>{ children }</div>`
- allow list-rendering children that are already supported by map/list handling
- fail closed when the child component inspects, transforms, clones, or
  conditionally renders `children`
- add explicit diagnostics for selector-derived data crossing unsupported
  `children` boundaries

#### JSX spreads

Harder than optional chaining and children. The first supported subset is
inline object-literal spreads with scalar selector fields; support only when
the AST contains strong static evidence.

Supported:

```jsx
<Header {...{ title: hero.title, status: hero.status }} />
```

Still investigate later:

```jsx
const headerProps = { title: hero.title };
<Header {...headerProps} />
```

Remain fail-closed:

```jsx
<Header {...props} />
<Header {...getHeaderProps(hero)} />
<Header {...{ hero }} /> // object-root spread props need descriptor injection support first
```

### 8. Import Graph Breadth

The initial cross-file support should remain narrow. Broaden only after the
manifest shape and diagnostics are stable.

Status: relative named import breadth is now covered for direct imports,
renamed named imports, multiple exports from one child file, extensionless
resolution, and index resolution. Default, namespace, package, and path-alias
imports remain diagnostic-only or future gated support.

Prioritized support or diagnostics:

- relative named imports
- renamed named imports, for example `import { Header as PageHeader }`
- default imports
- multiple exports from one child file, including different dynamic-root props
  per export
- index files / folder imports
- `.js`, `.jsx`, `.ts`, `.tsx`
- TypeScript or bundler path aliases
- barrel files and re-exports
- namespace imports
- package imports

Recommended order:

1. Keep package and namespace imports diagnostic-only.
2. Lock down existing `.js` / `.jsx` / extensionless / index resolution with
   diagnostics and tests.
3. Prove import renames and multiple exports for relative named imports.
4. Add default imports only with a strict export contract and real usage
   pressure.
5. Add project alias support only through explicit config.

### 9. Shape-Agnostic Production Manifest Wrapper

The current manifest is explicit and test-oriented. Real project use needs a
wrapper that can produce and consume it predictably, but the wrapper should not
bake in an unstable manifest shape.

Status: a first skeleton exists in `store-selector-project.js`. It discovers
project source files deterministically, creates a manifest from filesystem
sources, and returns Babel options for the cross-file manifest handoff. It does
this synchronously with full file reads at manifest creation time. It does not
yet provide cache invalidation, watch/bundler integration, or broad import
semantics.

Must provide:

- project source discovery
- filename normalization
- manifest caching and invalidation policy
- Babel integration contract
- strict handling of manifest diagnostics in CI/review mode
- stable internal API for passing the manifest into plugin config
- no assumptions that prevent object-root, list-relative, and mixed-context
  manifest records from evolving

Do this after cross-file object roots, list-relative context shape, and the
resolver/parser/component contract are proven. A shape-agnostic skeleton is
acceptable earlier only if it limits itself to discovery, normalization,
diagnostic propagation, cache invalidation, and config handoff.

Wrapper v1 may remain limited to relative named imports. Import breadth gates
unlock broader real-project adoption; they should not be confused with the
wrapper's core responsibility of producing and handing off a deterministic
manifest.

### 10. Diagnostics And Review Mode

Diagnostics must remain as important as output generation.
This is cross-cutting and should be validated in every gate, not treated as a
single late implementation phase.

Must prove:

- diagnostics use a structured `kind` taxonomy shared across manifest prepass
  and in-transform paths
- every unsupported boundary has a specific diagnostic kind/message
- strict mode is required as the CI/review default for the experiment
- multi-source ambiguity classes that can produce partial or empty output
  hard-error by default, independent of `warnOnUnsupported`
- wrong prop names are diagnosed without guessing intended mappings
- conditionals, logical expressions, spreads, render props, and dynamic
  components fail clearly
- every explicit non-goal has a fail-closed diagnostic test
- debug metadata explains both successful and skipped paths

Known polish:

- identical-root conditional expressions currently fail closed; dedupe source
  paths later if real usage requires it.

### 11. Runtime And Package Contract

Descriptor helpers are part of the generated template runtime contract.

Must prove:

- generated imports only reference exported runtime helpers
- package contents include the runtime entrypoints
- custom language integrations accept composed path args
- descriptors cannot leak into rendered output in covered transform paths
- descriptor imports can be optimized later if bundle size matters

Do not optimize unconditional descriptor imports until the experiment stabilizes.

### 12. Performance And Stable API

Before this moves beyond experiment status, add project-scale safety gates.

Must prove:

- fixed-point tracing and manifest generation have a bounded performance profile
  on a realistic file count
- manifest output is deterministic across runs
- stale-cache invalidation is tested once caching exists
- a real-app integration fixture runs through the production wrapper
- public/stable integration API is documented
- `__crossFileManifest` and other `__` internals are not the promoted user API

### 13. Final Parity Fixture Gates

Before broad support is claimed, add fixture gates that represent realistic app
surfaces. This is the explicit closing gate for the roadmap, after the earlier
feature and infrastructure gates are complete.

Status: fixture coverage exists for the supported surfaces listed in the
proven foundation. Broader future gates, such as shape-polymorphic output or
arbitrary spread data-flow, still need their own fixtures if they are pursued
later.

Required gates:

- same-file selector-only `full-template-surface`
- split-file selector-only `full-template-surface`
- cross-file multi-source object roots
- cross-file multi-hop relay
- list-relative multi-source
- nested list-relative multi-source
- mixed context fail-closed fixture
- stable flat fixtures with selector mode off
- stable flat fixtures with selector mode on

Each positive gate should assert Handlebars and PHP output.
Each new supported static shape should land with a paired fail-closed fixture
for the closest unsupported sibling shape. This is the main guard against
false-positive hard errors as the experiment broadens.

Each selector fixture should assert:

- no live `useStoreSelector`
- no `$$`
- no orphaned template declarations
- expected debug metadata when debug mode is enabled

### 14. Shape-Polymorphism Research

Shape-polymorphism remains a separate research track.

Example:

```jsx
<Output value={ title } />
<Output value={ tags } />
```

The same child usage `{ value }` may require scalar replacement for `title` and
primitive-list wrapping for `tags`. Bare usage does not provide enough evidence
to choose safely.

Likely options:

- fail closed by default
- require explicit shape hints
- specialize component output per shape
- introduce a future template-specific shape API

Do not block broad path-polymorphic support on shape-polymorphism.

## Recommended Order

1. Cross-file object-root callsite contexts.
2. Cross-file debug metadata.
3. Manifest resolver, parser, and component shape contract.
4. Minimal runtime/package validation.
5. Minimal mixed-context policy needed by list-relative tracing.
6. Same-file list-relative multi-source.
7. Cross-file list-relative multi-source.
8. Broader mixed context hardening.
9. Common React pattern investigations.
10. Import graph breadth.
11. Shape-agnostic production wrapper skeleton.
12. Runtime/package polish.
13. Performance and stable API.
14. Final parity fixture gates.
15. Shape-polymorphism research.

## Review Checkpoints

Pause for review after each major gate:

- after cross-file object-root HBS/PHP parity
- after manifest debug metadata lands
- after resolver/parser/component-shape diagnostics are locked down
- before same-file list-relative multi-source implementation
- before cross-file list-relative multi-source implementation
- before broadening optional chaining, children, or spread support beyond the
  current static subsets
- before expanding import graph support
- before introducing the production wrapper
- before final parity fixture gates
- before any shape-polymorphism design is implemented

Each review should ask:

- Does the implementation preserve registry/controller boundaries?
- Are unsupported paths fail-closed?
- Are diagnostics actionable?
- Does debug metadata explain the result?
- Do HBS and PHP agree?
- Did any stable flat API behavior change?

## Broad Support Exit Criteria

Treat the experiment as broadly supported only when:

- same-file and cross-file object-root path-polymorphism work
- same-file and cross-file list-relative path-polymorphism work
- parser failures and unsupported component declarations diagnose cleanly
- common React patterns are supported for static subsets or have explicit
  fail-closed diagnostics
- common import shapes are supported or clearly diagnosed
- a production manifest wrapper exists
- debug metadata explains successful and skipped paths
- stable diagnostic `kind` values exist for all supported skip/fail paths
- manifest graph traversal has tested cycle and depth bounds
- parent and child transforms are order-independent when given the same
  manifest
- strict mode is the CI/review default and the full unit/e2e suite passes under
  that policy
- cross-file ambiguous-seed negative fixtures are flipped to positive fixtures
  where callsite contexts intentionally support the shape
- full-template-surface parity passes in same-file and split-file forms
- cross-file multi-source object-root e2e fixtures live under `fixtures/e2e/`
- same-file and cross-file list-relative multi-source e2e fixtures exist
- mixed-context fail-closed e2e fixture documents the expected diagnostic
- every selector e2e fixture asserts its debug payload where debug mode is
  relevant
- PHP nested context depth is proven for all list-relative gates
- package/runtime imports are valid
- performance bound is documented and tested on a realistic project size
- real-app integration fixture passes through the production wrapper
- every permanent non-goal has an explicit fail-closed diagnostic test
- author-facing config is documented for `experimentalStoreSelectors`,
  cross-file manifest handoff, strict/review mode, and any production wrapper
- stable integration API is documented

Until then, keep the feature experimental and documented as draft review work.
