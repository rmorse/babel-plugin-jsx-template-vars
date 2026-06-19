# Store Selector Broad Support Roadmap

## Goal

Define the remaining work needed before the store-selector experiment can be
considered high-level support for most normal component-tree authoring patterns.

This is a roadmap, not a single implementation plan. Detailed implementation
plans should remain focused and link back here. The active detailed plan for
multi-source object-root path-polymorphism is
[store-selector-multi-source-path-plan.md](./store-selector-multi-source-path-plan.md).

## What Broad Support Means

Broad support means an author can:

- select data from one store-shaped state object
- pass selected values through ordinary same-file and cross-file component trees
- rename local variables and props naturally
- render scalar replacements, controls, lists, and nested lists
- reuse the same child component from multiple callsites with different
  canonical roots
- rely on Handlebars and PHP output parity for the supported shapes
- get clear diagnostics when a shape is unsupported

It does not mean arbitrary React data-flow simulation. The transform should
still fail closed for dynamic components, HOCs, spreads, render props, generic
context, and shape-polymorphic output until those are separately proven.

## Proven Foundation

Already implemented and reviewed:

- Role-neutral `useStoreSelector` path declarations.
- Usage-based role inference through the existing registry/controllers.
- Selector-only component discovery.
- Local aliasing, destructuring, map aliases, and safe list chains.
- Child prop auto-seeding for same-file component trees.
- Same-file multi-hop relay for object and list contexts.
- Same-file path-polymorphic object roots via template-root descriptors.
- Descriptor hardening:
  - generated runtime helper imports
  - transform-time containment for bare descriptors
  - ordinary runtime props rejected for dynamic-root child props
  - local aliases and props-object params supported
- Selector-only `full-template-surface` parity.
- Split-file `full-template-surface` parity for the current manifest model.
- PHP nested list depth coverage.
- Minimal dynamic-root debug metadata in review mode.

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

### 2. Cross-File Debug Metadata

Cross-file tracing must be inspectable before the graph becomes broad.

Must expose:

- resolved import edge
- parent component and JSX callsite
- target component/export
- prop name
- canonical root
- local child paths
- compiled paths
- skipped edges and reasons
- cross-file seed/callsite propagation hops

This should build on the existing dynamic-root debug metadata, but it needs
callsite identity and file-level provenance.

### 3. Production Manifest Wrapper

The current manifest is explicit and test-oriented. Real project use needs a
wrapper that can produce and consume it predictably.

Must provide:

- project source discovery
- filename normalization
- manifest caching and invalidation policy
- Babel integration contract
- strict handling of manifest diagnostics in CI/review mode
- stable internal API for passing the manifest into plugin config

Do this after cross-file callsite contexts are proven, so the wrapper integrates
the correct manifest shape.

### 4. List-Relative Multi-Source

Support path-polymorphic child components in list contexts.

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

This should build on descriptor `declarationSegments`, where canonical segments
and list-relative declaration segments diverge.

### 5. Import Graph Breadth

The initial cross-file support should remain narrow. Broaden only after the
manifest shape and diagnostics are stable.

Prioritized support or diagnostics:

- relative named imports
- default imports
- index files / folder imports
- `.js`, `.jsx`, `.ts`, `.tsx`
- TypeScript or bundler path aliases
- barrel files and re-exports
- namespace imports
- package imports

Recommended order:

1. Keep package and namespace imports diagnostic-only.
2. Add index-file and extension resolution.
3. Add default imports only with a strict export contract.
4. Add project alias support only through explicit config.

### 6. Mixed Context Safety

Real component trees reuse children in several contexts.

Must decide and prove:

- same child outside a list and inside a list
- same prop as object root in one callsite and scalar in another
- same prop as object root in one callsite and list in another
- explicit `templateVars` coexistence and collision behavior
- selector-derived props crossing unsupported boundaries
- `warnOnUnsupported: false` does not hide dangerous partial output

Policy:

- Path-polymorphism may be supported through descriptors.
- Shape-polymorphism must fail closed unless explicit shape evidence exists.

### 7. Diagnostics And Review Mode

Diagnostics must remain as important as output generation.

Must prove:

- every unsupported boundary has a specific diagnostic kind/message
- strict mode is viable as the CI/review default
- wrong prop names are diagnosed without guessing intended mappings
- conditionals, logical expressions, spreads, render props, and dynamic
  components fail clearly
- debug metadata explains both successful and skipped paths

Known polish:

- identical-root conditional expressions currently fail closed; dedupe source
  paths later if real usage requires it.

### 8. Runtime And Package Contract

Descriptor helpers are part of the generated template runtime contract.

Must prove:

- generated imports only reference exported runtime helpers
- package contents include the runtime entrypoints
- custom language integrations accept composed path args
- descriptors cannot leak into rendered output in covered transform paths
- descriptor imports can be optimized later if bundle size matters

Do not optimize unconditional descriptor imports until the experiment stabilizes.

### 9. Final Parity Fixture Gates

Before broad support is claimed, add fixture gates that represent realistic app
surfaces.

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

Each selector fixture should assert:

- no live `useStoreSelector`
- no `$$`
- no orphaned template declarations
- expected debug metadata when debug mode is enabled

### 10. Shape-Polymorphism Research

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
3. Production manifest wrapper basics.
4. List-relative multi-source.
5. Import graph breadth.
6. Mixed context hardening.
7. Runtime/package polish.
8. Shape-polymorphism research.

## Review Checkpoints

Pause for review after each major gate:

- after cross-file object-root HBS/PHP parity
- after manifest debug metadata lands
- before introducing the production wrapper
- before list-relative multi-source implementation
- before expanding import graph support
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
- common import shapes are supported or clearly diagnosed
- a production manifest wrapper exists
- debug metadata explains successful and skipped paths
- strict mode is usable for CI
- full-template-surface parity passes in same-file and split-file forms
- PHP nested context depth is proven for all list-relative gates
- package/runtime imports are valid

Until then, keep the feature experimental and documented as draft review work.
