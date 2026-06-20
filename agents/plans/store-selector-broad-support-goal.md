# Store Selector Broad Support Goal

Use this file when the full goal text is too long to paste directly into the
goal box.

## Copy-Pastable Goal Command

```text
/goal: Complete the store-selector broad-support roadmap in agents/plans/store-selector-broad-support-goal.md. Start by reading agents/plans/store-selector-broad-support-roadmap.md and agents/plans/store-selector-multi-source-path-plan.md, then work through the goal file end-to-end. Commit all completed changes with clear descriptive messages, push the branch, and report verification results.
```

## Full Goal Specification

Work from branch `experiment/store-selector-data-contract` and PR #23.

Start by re-reading:

- `agents/plans/store-selector-broad-support-roadmap.md`
- `agents/plans/store-selector-multi-source-path-plan.md`

Treat the roadmap as the source of truth.

## Objective

Complete the remaining broad-support gates for statically traceable,
prop-driven component trees in the store-selector experiment.

## Required Work

### 1. Cross-File Object-Root Callsite Contexts

- Replace single aggregated cross-file seed behavior with per-callsite context
  records.
- Child files must transform with relative dynamic-root discovery only.
- Parent files must inject `createTemplateRootDescriptor(...)` per JSX
  callsite.
- Flip the supported `ambiguous-cross-file-seed` case from negative to
  positive.
- Keep unsupported import/component shapes fail-closed.

### 2. Cross-File Debug Metadata

Expose normalized parent/target filenames, import edge ID, callsite ID or
source location, prop, strategy, canonical segments, declaration segments,
context depth, compiled paths, and skip reason.

Successful and skipped paths must both be visible in review/debug mode.

### 3. Manifest Resolver, Parser, And Component Shape Contract

- Parser failures are diagnostics, not crashes.
- `.js`, `.jsx`, extensionless, and index resolution are locked down.
- `.ts` and `.tsx` are either parsed intentionally or diagnosed cleanly.
- Only the component forms chosen in the roadmap are supported.
- Unsupported forms such as `export function`, default exports, HOCs/wrappers,
  namespace/package imports, and bare single-param prop-shape mismatches are
  diagnosed.
- Graph cycles and traversal/depth bounds are tested.

### 4. Runtime And Package Validation

- Generated imports only reference exported helpers.
- `npm pack --dry-run` includes required runtime entrypoints.
- Non-harness transformed modules can resolve generated imports.

### 5. Minimal Mixed-Context Policy

Before list-relative work, define and test:

- explicit `templateVars` shadow/collision behavior under dynamic roots
- same child used in list and non-list contexts
- scalar member multi-source as intentionally parent-materialized when possible

### 6. Same-File List-Relative Multi-Source

- Support different list roots using the same child.
- Support `product={ product }` then child `product.name`.
- Support `badges={ product.badges }` then child `badges.map(...)`.
- Preserve `declarationSegments` distinct from canonical segments.
- Prove Handlebars/PHP parity and no duplicate wrappers.

### 7. Cross-File List-Relative Multi-Source

- Extend list-relative behavior across files.
- Prove same child at different PHP depths.
- Prove descriptor composition inside list contexts does not re-apply the list
  root.
- Prove nested badge/list output in Handlebars and PHP.

### 8. Broader Mixed-Context Hardening

- Test object-root vs scalar vs list on the same prop name.
- Test selector-derived props crossing unsupported boundaries.
- Ensure `warnOnUnsupported: false` cannot hide dangerous partial output.

### 9. Common React Pattern Investigations

Investigate and either support the static subset or fail closed with diagnostics.

- Optional chaining:
  - support static member chains such as `hero?.title` as equivalent to
    `hero.title`
  - reject computed/call forms such as `hero?.[key]` and `getHero()?.title`
- `children` composition:
  - support direct/static selector usage in JSX children where traceable,
    currently the direct `children` passthrough subset
  - allow supported map/list children
  - fail closed when a child inspects, transforms, clones, or conditionally
    renders `children`
- JSX spreads:
  - support only strongly static evidence, starting with inline object literal
    spreads such as `<Header {...{ title: hero.title }} />`
  - reject arbitrary identifier/call spreads unless a conservative
    local-static-object proof is implemented

Current status: the initial static subset is implemented for optional member
chains, direct `children` passthrough, supported list children, and inline
object-literal scalar spreads. Broader local-static object spread proofs,
object-root spread descriptor injection, and manipulated `children` remain
future work and should stay fail-closed.

### 10. Import Graph Breadth

- Support or diagnose renamed named imports.
- Support or diagnose multiple exports from one child file with different
  dynamic-root props.
- Keep package/namespace imports diagnostic-only.
- Add default imports only if a strict export contract is implemented and
  tested.
- Add aliases only through explicit config if implemented.

### 11. Shape-Agnostic Production Manifest Wrapper

- Discover project sources.
- Normalize filenames.
- Handle manifest caching/invalidation.
- Propagate diagnostics.
- Hand manifest config to Babel.
- Keep wrapper v1 limited to relative named imports if needed.
- Do not bake in unstable manifest schema assumptions.

### 12. Diagnostics, Review Mode, And Stable API

- Use stable diagnostic `kind` values for all skip/fail paths.
- Make strict mode the CI/review default for the experiment.
- Document author-facing config for `experimentalStoreSelectors`, cross-file
  manifest handoff, strict/review mode, and any wrapper API.
- Ensure `__` internals are not presented as the promoted public API.

### 13. Final Parity Gates

Add fixtures and assertions for:

- same-file selector-only `full-template-surface`
- split-file selector-only `full-template-surface`
- cross-file multi-source object-root
- same-file and cross-file list-relative multi-source
- mixed-context fail-closed behavior with expected diagnostic

Every positive selector fixture must assert:

- Handlebars and PHP output
- no live `useStoreSelector`
- no `$$`
- no orphaned declarations
- debug metadata where relevant

## Implementation Constraints

- Keep selector-specific logic in collector, visitor, and manifest handoff.
- Controllers may receive generic path/context-resolution facilities only.
- Do not add selector-specific controller branches.
- Preserve existing flat `templateVars` behavior.
- Preserve existing selector tests.
- Unsupported or dynamic React behavior must fail closed with diagnostics, not
  partial output.
- Do not implement arbitrary React simulation, HOCs, dynamic components, generic
  context tracing, runtime data-flow, or shape-polymorphism unless explicitly
  gated and proven.

## Verification Gates

Run:

- `npm test`
- `npm run test:coverage`
- `npm pack --dry-run`
- `git diff --check`

Also run or add focused e2e fixtures for Handlebars and PHP parity.

After pushing, check PR status.

## Finish

- Update docs and PR text with exactly what is now supported, what is still
  fail-closed, and any deferred follow-ups.
- Commit all changes with clear descriptive commit messages.
- Push the branch.
- Do not stop at a plan unless a genuine blocker is found. If blocked, commit
  completed work and document the exact blocker, repro, and next slice.
