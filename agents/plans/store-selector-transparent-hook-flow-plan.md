# Store Selector Transparent Hook Flow Plan

## Status

Implementation plan for the transparent hook-flow milestone.

The core hook-flow milestone has been implemented through the current hook
stream. The remaining hook-related work in this document should be read as
either a narrow diagnostic hardening follow-up or as part of the broader
drop-in import/export resolver track, not as unfinished core hook-flow work.

This plan extends the store-selector drop-in work with a focused goal:
support natural React hook-shaped value flow when the hook is statically
transparent, while preserving the fail-closed safety model for stateful,
mutable, lifecycle, and runtime-dependent hooks.

It complements:

- [store-selector-drop-in-static-support-plan.md](./store-selector-drop-in-static-support-plan.md)
- [store-selector-broad-support-roadmap.md](./store-selector-broad-support-roadmap.md)
- [store-selector-data-contract-implementation.md](./store-selector-data-contract-implementation.md)

The drop-in static support plan covers component identity, imports, exports,
wrappers, JSX member components, spreads, and children. This plan covers value
flow through hook calls inside those components.

## Milestone Boundary And Deferred Resolver Work

The hook milestone intentionally supports direct statically resolved hook
summaries and configured selector hooks. It does not attempt to make every
project import shape work for hooks independently of components.

The broader drop-in track owns all import/export breadth that should apply to
both components and hooks:

- named and renamed barrel re-exports
- default-as-named barrel re-exports
- namespace imports and namespace exports
- explicit aliases, workspace maps, package maps, and package `exports`
- `export *` ambiguity handling
- type-only import/export filtering across resolver hops

The current hook work introduced hook import summary records so cross-file hooks
can function before the full drop-in resolver exists. That should be treated as
a temporary slice of the same concept, not a second long-term resolver. When the
drop-in resolver work resumes, hook imports and component imports should resolve
through one shared export graph with typed targets:

```txt
resolvedImportEdge
  localName
  importedName
  targetFilename
  targetExportName
  targetKind: "component" | "hook" | "other"
  exportEdgeChain[]
  resolverStrategy
```

The shared resolver must preserve wrong-kind diagnostics:

- a component JSX tag resolving to a hook export is unsupported
- a hook call resolving to a component export is unsupported
- an ambiguous export that could be a component or hook stays fail-closed until
  the export graph proves the target kind

Do not add hook-specific barrel, namespace, alias, or package resolution as a
parallel implementation. Add those shapes once in the drop-in resolver and make
the hook summary builder consume the same resolved edges as component tracing.

The one hook-local follow-up worth keeping near this milestone is a relink
guard: if a manifest contains a hook summary for a local binding but the per-file
transform cannot re-bind that hook call, the transform should report a
diagnostic or hard-error instead of silently dropping the summary.

## Executive Summary

The current experiment recognizes selector sources directly:

```jsx
const hero = useStoreSelector((state) => state.hero);
return <Header hero={ hero } />;
```

Real React code often wraps that value flow in hooks:

```jsx
const hero = useHero();
const title = useMemo(() => hero.title, [ hero ]);
const view = useHeroView(hero);
```

Supporting all React hooks generically would be unsafe. Hooks can represent
mutable state, lifecycle effects, refs, context, subscriptions, callbacks, or
arbitrary app logic. But many hook patterns are statically transparent:
they simply return a selector-derived value or a pure projection of one.

The recommended direction is to support a transparent subset:

- configured app-owned selector hooks such as `useAppSelector`
- import-bound React `useMemo` with a pure selector-derived return expression
- same-file custom hooks with a single static return
- cross-file custom hooks after same-file summaries are proven
- object-return hooks when properties are statically selector-derived

Everything stateful or opaque should remain diagnostic-only:

- `useState`
- `useReducer`
- `useRef` / `.current`
- `useEffect`
- `useLayoutEffect`
- `useCallback` as data flow
- conditional/multiple-return hooks
- hooks with mutation, loops, async work, helper calls, or runtime branching

Reviewer probing found that some unsupported hook shapes are not merely future
work: they can be mishandled by the current collector. For example,
selector-derived values inside `useState(hero.title)` or `useRef(hero.title)`
can be declared as static template replacements even though they entered mutable
runtime state, while `useMemo(() => hero.title)` can under-render because the
collector skips nested function bodies. Phase 0 is therefore a safety fix, not
just an inventory phase.

The goal is not to execute hooks. The goal is to summarize hook return values
when a static AST proof exists.

## Core Distinction

### Component Wrappers

`memo`, `React.memo`, `forwardRef`, and `React.forwardRef` are component identity
wrappers:

```jsx
export const Header = memo(({ hero }) => <h1>{ hero.title }</h1>);
```

They hide the component function, but they do not create a new template data
value. The component adapter can unwrap them and pass the same component body
to the existing collector.

### Hook Value Flow

Hooks hide value flow:

```jsx
const title = useMemo(() => hero.title, [ hero ]);
return <h1>{ title }</h1>;
```

The collector must prove what the hook returns and map that result back to
selector-derived segments. This is not a component adapter problem. It needs a
hook summary model.

## Implementation Blockers To Clear First

Reviewer probes identified three code-level constraints that must be handled
before positive hook support lands:

1. **Opaque helper usage must recognize transparent hook boundaries.**
   Existing helper-call diagnostics should not treat `useMemo` dependency-array
   entries as opaque helper arguments. A transparent-hook allowlist must exempt
   dependency arrays for debug-only collection and analyze memo callback bodies
   through the hook summary path, not through general helper-call tracing.

2. **Hook bodies need a dedicated scanner.**
   Component-body nested selector rules are correct for JSX components, but
   top-level custom hooks are separate summary candidates. Hook summaries should
   be built by a dedicated hook-body scanner over top-level `use[A-Z]`
   declarations/exports, not by reusing component `collectSelectorAssignments`
   traversal inside component bodies.

3. **Hook discovery must use hook identity, not component identity.**
   Component names use `/^[A-Z]/`; hook names use `/^use[A-Z]/`. Add a
   hook-specific discovery adapter for top-level function declarations, const
   arrow/function expressions, and supported exports. Do not route hook
   discovery through `isComponentName`.

## Design Principles

1. **Support transparent value flow only.**
   A hook is supported only when the returned value can be described as the
   same selector-derived path/object/list shape that the collector already
   knows how to consume.

2. **Do not execute hook bodies.**
   Static AST summaries only. No React semantics, no dependency-array
   evaluation, no runtime branch evaluation.

3. **Stateful hooks are not template data sources.**
   `useState`, `useReducer`, and `useRef` represent mutable runtime state.
   Selector-derived values crossing those hooks must not synthesize template
   declarations from hook arguments. If the returned mutable value reaches
   template output, the transform should hard-error.

4. **Custom hooks are allowed only when transparent.**
   A function named `useX` is not automatically safe. It needs a supported
   body shape and a stable return contract.

5. **Every positive hook shape gets a fail-closed sibling.**
   Each supported shape must have tests for nearby unsupported shapes so the
   feature does not regress into silent empty output.

6. **Controllers remain generic.**
   Hook reasoning belongs in collector/visitor/manifest/debug metadata. Output
   controllers should continue to consume selector-agnostic path/context data.

7. **Do not rescue incorrect React architecture.**
   If a hook returns the wrong shape for the component consuming it, the plugin
   may diagnose, but it should not guess or synthesize missing mappings.

8. **Configured selector hooks are selector sources, not summaries.**
   An app-owned hook such as `useAppSelector` should extend the import-bound
   selector local-name set. It should not wait for transparent custom-hook
   summary machinery.

9. **React built-ins are binding-aware, not name-aware.**
   `useMemo` support must prove that the callee binding comes from React.
   Local functions named `useMemo`, shadowed imports, and unrelated packages
   remain unsupported.

## Supported Candidate Shapes

### 1. Configured App-Owned Selector Hooks

Many apps already have:

```jsx
const hero = useAppSelector((state) => state.hero);
```

The project currently recognizes the package-scoped `useStoreSelector` import.
For drop-in adoption, support an explicit opt-in config:

```js
experimentalStoreSelectors: {
  selectorHooks: [
    {
      source: '@/store/hooks',
      importName: 'useAppSelector',
      selectorArg: 0,
    },
  ],
}
```

Rules:

- opt-in only
- import-bound, not name-only
- same selector grammar as `useStoreSelector`
- unsupported selector shapes keep the same hard-error policy
- debug metadata must show that the source hook was configured
- same local hook name from an unconfigured source is not treated as a selector

This is different from transparent custom hooks. A configured selector hook is
a new selector source. A transparent custom hook is a summarized wrapper around
an existing selector source.

Implementation should extend `selectorLocalNames` / `isStoreSelectorCall`
behavior rather than adding hook-summary logic.

### 2. Direct `useMemo` Projection

```jsx
const hero = useStoreSelector((state) => state.hero);
const title = useMemo(() => hero.title, [ hero ]);
return <h1>{ title }</h1>;
```

Expected:

```hbs
<h1>{{hero.title}}</h1>
```

Rules:

- callee must be import-bound to React, not name-matched:
  - `import { useMemo } from 'react'; useMemo(...)`
  - `import { useMemo as useStableMemo } from 'react'; useStableMemo(...)`
  - `import * as React from 'react'; React.useMemo(...)`
  - `import React from 'react'; React.useMemo(...)`
- a local function or variable named `useMemo` is not transparent
- first argument must be an arrow/function expression
- first slice supports expression-body returns only
- block bodies, even with one `return`, remain diagnostic-only until the
  expression-body path is proven
- return expression must resolve through existing selector alias logic
- first slice return kinds are scalar paths, object-root preservation, and
  list-root/list-relative preservation when the memo returns the original
  selector-derived value
- dependency array is not used to prove the template path
- dependency array may be recorded in debug metadata for review
- omitted dependency arrays are allowed when the return expression is statically
  provable; debug should record `dependencies: "omitted"`
- dependency-array values must not trigger opaque-helper diagnostics

Fail-closed siblings:

```jsx
function useMemo(fn) { return fn(); }
useMemo(() => compute(hero), [ hero ]);
useMemo(() => cond ? hero.title : other.title, [ hero, other ]);
useMemo(() => {
  log(hero.title);
  return hero.title;
}, [ hero ]);
useMemo(() => useStoreSelector((state) => state.hero), []);
```

### 3. Deferred `useMemo` Object Return

```jsx
const hero = useStoreSelector((state) => state.hero);
const view = useMemo(() => ({
  title: hero.title,
  status: hero.status,
}), [ hero ]);

return <Header title={ view.title } status={ view.status } />;
```

Expected:

```hbs
<Header title="{{hero.title}}" status="{{hero.status}}" />
```

This is intentionally **not** in the first `useMemo` slice. Object returns need
the same object member alias contract as custom object-return hooks, including
destructuring, static spread consumption, object-root descriptor provenance, and
list-relative member shapes. Until Phase 5, `useMemo` object literals should be
diagnostic-only.

When enabled, implementation should reuse the same synthetic-property model as
static object spreads:

- scalar properties can become member aliases
- object-root properties require descriptor provenance
- computed properties are unsupported
- spread inside returned object is unsupported until separately proven

### 4. `useMemo` Object Root Preservation

```jsx
const hero = useStoreSelector((state) => state.hero);
const currentHero = useMemo(() => hero, [ hero ]);
return <Header hero={ currentHero } />;
```

Expected:

```hbs
<h1>{{hero.title}}</h1>
```

This should preserve object-root provenance and dynamic-root descriptor
behavior. It must not materialize the object root as a replacement string.

### 5. `useMemo` List Preservation

```jsx
const products = useStoreSelector((state) => state.products);
const visibleProducts = useMemo(() => products, [ products ]);

return visibleProducts.map((product) => <ProductCard product={ product } />);
```

This should preserve list-relative provenance and PHP context depth. It must
not materialize a list root as a replacement string and must not double-apply
the list root inside child output.

Fail-closed siblings:

```jsx
useMemo(() => products.map(product => product.name), [ products ]);
useMemo(() => cond ? products : saleProducts, [ products, saleProducts ]);
```

List-returning transforms can be added later. The first list gate is root
preservation through `useMemo`.

### 6. Same-File Source Custom Hook

```jsx
function useHero() {
  return useStoreSelector((state) => state.hero);
}

const App = () => {
  const hero = useHero();
  return <Header hero={ hero } />;
};
```

Expected:

```hbs
<h1>{{hero.title}}</h1>
```

Rules:

- hook function must be top-level in the same file
- name must match `use[A-Z]`
- single supported return statement
- no conditionals, loops, mutation, nested functions, async/generator, or
  unsupported helper calls
- no non-return hook/helper statements in the body
- no state/ref/effect/callback hooks in the body, even when the returned value
  looks selector-derived
- returned expression may be direct `useStoreSelector(...)`, a selector alias,
  or a supported transparent hook call
- hook result aliases must be `const`; `let`/`var` or reassignment are
  unsupported

### 7. Same-File Derived Custom Hook

```jsx
function useHeroTitle(hero) {
  return hero.title;
}

const App = () => {
  const hero = useStoreSelector((state) => state.hero);
  const title = useHeroTitle(hero);
  return <h1>{ title }</h1>;
};
```

Expected:

```hbs
<h1>{{hero.title}}</h1>
```

Rules:

- hook summary is parameterized
- callsite arguments supply selector-derived path info
- return expression is resolved against the callsite argument environment
- hook summary key must include parameter mapping and return shape
- callsite resolution must inherit object-root, mixed-context, and
  list-relative ambiguity hard-errors from component prop tracing
- hook result aliases must be `const`; reassignment invalidates the summary

Fail-closed siblings:

```jsx
function useHeroTitle(hero) {
  return formatTitle(hero.title);
}

function useHeroTitle(hero) {
  if (hero.status === 'published') return hero.title;
  return hero.draftTitle;
}

let title = useHeroTitle(hero);
title = otherTitle;
```

### 8. Hook Returning Object Contract

```jsx
function useHeroView(hero) {
  return {
    title: hero.title,
    status: hero.status,
  };
}

const view = useHeroView(hero);
return <Header title={ view.title } status={ view.status } />;
```

This is common in real component trees. It should be supported after scalar
return hooks because it requires an object member alias table.

Supported subset:

- object literal return
- non-computed properties
- selector-derived scalar/object-root/list-relative values
- destructuring from the returned object:

  ```jsx
  const { title } = useHeroView(hero);
  ```
- static spreads from returned objects into child props:

  ```jsx
  const view = useHeroView(hero);
  return <Header {...view} />;
  ```

Deferred:

- nested object literals
- object spread
- array/tuple returns
- methods/functions in returned object

### 9. Source Hook Object-Root Destructuring

```jsx
function useHero() {
  return useStoreSelector((state) => state.hero);
}

const { title } = useHero();
return <h1>{ title }</h1>;
```

This differs from object-return hooks. The hook returns an object root, and the
callsite destructures that root. The collector should preserve provenance as if
the destructure happened directly from `useStoreSelector`.

### 10. Cross-File Transparent Custom Hooks

```jsx
// hooks.js
export function useHero() {
  return useStoreSelector((state) => state.hero);
}

// App.jsx
import { useHero } from './hooks';

const hero = useHero();
return <Header hero={ hero } />;
```

This should reuse the import/export graph from the drop-in static support work.

Rules:

- direct/named/default/barrel/namespace hook imports should eventually use the
  same resolver surface as component imports
- same static hook body restrictions as same-file hooks
- hook summaries should be manifest records, not per-file transform side effects
- unresolved/unsupported hook imports remain manifest diagnostics until
  selector-derived output needs them

## Explicitly Unsupported Hook Shapes

### `useState`

```jsx
const [ title ] = useState(hero.title);
return <h1>{ title }</h1>;
```

Even if the initial value is selector-derived, state is mutable. Treating it as
static template data would be misleading.

Policy:

- selector-derived arguments to `useState` must not create template
  declarations
- if selector-derived values enter `useState`, record unsupported hook metadata
  even when warnings are suppressed
- if the returned state variable reaches template output or selector-traced
  child props, hard diagnostic
- regression tests must assert that no `{{hero.title}}` / PHP equivalent is
  emitted from a state initializer
- otherwise record unsupported metadata only

### `useReducer`

Same policy as `useState`. Reducer state is runtime mutable. Selector-derived
initializer values must not synthesize template declarations.

### `useRef`

```jsx
const ref = useRef(hero.title);
return <h1>{ ref.current }</h1>;
```

Refs are mutable and lifecycle-dependent. `ref.current` should not be traced as
static template data.

Policy:

- `useRef(selectorValue)` used only as a DOM ref remains irrelevant
- `ref={ref}` JSX attributes remain irrelevant because they are not template
  data
- selector-derived arguments to `useRef` must not create template declarations
- `ref.current` rendered or passed to selector-traced child props fails closed
- selector-derived data stored into `ref.current` fails closed if consumed

### Mutable Hook Taint Model

Stateful and mutable hooks should not register normal selector aliases from
their arguments. Instead, the collector should record taint metadata:

```json
{
  "kind": "unsupported-hook-state-flow",
  "hookName": "useState",
  "sourceSegments": ["hero", "title"],
  "stateBinding": "title",
  "setterBinding": "setTitle",
  "refBinding": null,
  "hookCall": "useState(hero.title)"
}
```

Rules:

- selector-derived values entering `useState`, `useReducer`, or `useRef` do not
  create replacement/control/list declarations
- setter calls such as `setTitle(hero.title)` taint the target state binding
- `ref.current = hero.title` taints the ref binding
- effect-driven writes to tainted state/ref bindings stay unsupported if the
  mutable value later reaches output
- rendering tainted state, passing tainted state to selector-traced child props,
  using tainted refs as replacement/control/list data, or rendering
  `ref.current` hard-errors
- effect-only reads that never feed output may remain metadata-only

### `useEffect` / `useLayoutEffect`

Effects do not return render data. Any selector-derived value used only inside
an effect is irrelevant to template output. Any value produced by effect-driven
mutation is unsupported.

Policy:

- selector-derived values used only inside effects should be recorded in
  `skippedHooks` metadata without changing output
- if an effect writes selector-derived values into mutable state/ref that is
  later rendered, hard diagnostic through the state/ref policy

### `useCallback`

Callbacks are functions, not template values. Do not trace through returned
callbacks as data.

Potential future exception:

- explicitly modeled render helper callbacks passed to a known static API

That should be a separate render-prop/helper research item, not part of this
hook flow plan.

Fail-closed siblings:

```jsx
const renderTitle = useCallback(() => hero.title, [ hero ]);
return <Header renderTitle={ renderTitle } />;
```

If selector-derived data reaches template output only by calling the returned
callback, the transform should fail closed rather than execute or inline the
callback.

### `useContext`

Context is runtime graph data. Generic context tracing remains out of scope.
Configured context adapters could be researched later, but should not block
transparent hook support.

### Opaque React Runtime Hooks

Concurrency, subscription, identity, and transition hooks are not selector data
sources:

- `useDeferredValue`
- `useSyncExternalStore`
- `useId`
- `useTransition`
- `useOptimistic`
- `useActionState`
- `useImperativeHandle`

Policy:

- selector-derived values entering these hooks are recorded as unsupported hook
  metadata
- if their returned value reaches replacement/control/list output or
  selector-traced child props, hard-error
- otherwise they remain review/debug metadata only

## Hook Summary Model

Add a hook summary layer that can answer:

```txt
When call expression `useX(arg0, arg1)` appears at this callsite,
what selector-derived value does it return?
```

Suggested summary shape must carry the same expression-info contract the
collector already uses. A hook summary is not just a canonical path string; it
must preserve declaration relativity, dynamic-root provenance, list context,
and object-member maps when those are supported.

```json
{
  "hookName": "useHeroTitle",
  "filename": "App.jsx",
  "params": ["hero"],
  "returnKind": "path",
  "expressionInfo": {
    "segments": ["hero", "title"],
    "declarationSegments": ["hero", "title"],
    "dynamicRoot": false,
    "dynamicRootSegments": null,
    "listRelative": null,
    "objectMembers": null
  },
  "dependencies": ["hero"],
  "source": "same-file",
  "strategy": "transparent-hook-summary"
}
```

Fields:

- `segments`: canonical selector path segments
- `declarationSegments`: path segments relative to the template declaration
  context; this is load-bearing for list-relative PHP depth
- `dynamicRoot`: whether the return preserves an object-root descriptor
- `dynamicRootSegments`: object-root path used for descriptor composition
- `listRelative`: source/declaration/context-depth metadata for list roots and
  list item values
- `objectMembers`: member-to-expression-info map for object-return hooks; this
  remains disabled until Phase 5
- `returnKind`: `scalar-path`, `object-root`, `list-root`, `list-item`,
  `object-map`, or `unsupported`

For parameterized hooks, summary return paths are local to parameters until
callsite resolution:

```json
{
  "hookName": "useHeroTitle",
  "params": ["hero"],
  "returnKind": "path",
  "expressionInfo": {
    "segments": ["$param:hero", "title"],
    "declarationSegments": ["$param:hero", "title"],
    "dynamicRoot": false,
    "dynamicRootSegments": null,
    "listRelative": null,
    "objectMembers": null
  }
}
```

At callsite:

```jsx
const title = useHeroTitle(featuredHero);
```

If `featuredHero` resolves to `featured.hero`, the call resolves to:

```json
{
  "segments": ["featured", "hero", "title"],
  "declarationSegments": ["featured", "hero", "title"]
}
```

If the argument resolves to a dynamic object root or a list-relative value, the
callsite must substitute the full expression-info object, not just splice
canonical segments. This is what lets hook summaries participate in descriptor
composition, list-relative declaration slicing, and PHP context-depth handling.

### Internal Selector Consumption

Custom hooks that contain `useStoreSelector` create an interaction with the
existing unprocessed-selector guard:

```jsx
function useHero() {
  return useStoreSelector((state) => state.hero);
}
```

Today, a selector call outside a supported component body should trigger
`assertNoUnprocessedStoreSelectorReferences`. Hook summaries must deliberately
consume supported hook-internal selector calls so they do not remain as stray
selectors after import removal.

Required policy before implementing source custom hooks:

- only candidate hook bodies selected for a valid summary may contain internal
  selector calls
- the summary consumes the internal selector as metadata, not as standalone
  component output
- unsupported hook bodies containing selector calls must fail closed rather than
  leaving a live selector reference
- no double emission: a selector inside `useHero` should not create a template
  declaration unless a callsite uses the summarized hook result
- hook-in-callback patterns remain illegal:

  ```jsx
  useMemo(() => useStoreSelector((state) => state.hero), []);
  ```

  This should fail closed as an unsupported hook body, not become a nested
  selector source.

### Ambiguity Inheritance

Parameterized transparent hooks must inherit the same hard-fail behavior as
component prop tracing.

Example:

```jsx
function useHeroTitle(hero) {
  return hero.title;
}

const homeTitle = useHeroTitle(home.hero);
const articleTitle = useHeroTitle(article.hero);
```

This is path-polymorphic and can be valid if each callsite resolves locally.
But once a hook result is forwarded into a shared child, list context, object
root, or object-return contract, the same ambiguity classes apply:

- object-root multi-source ambiguity
- mixed list/non-list context
- incompatible list-relative declaration paths
- conditional/unsupported hook return expressions

Implementation should route these through the same unconditional
`diagnostics.error` policy used by component prop tracing, not a hook-specific
warn-only fallback. The test matrix must include multi-source hook callsites
that prove both successful local composition and hard failures for incompatible
contexts.

## Collector Integration

The current collector already resolves identifiers, member expressions, local
aliases, list chains, dynamic roots, children, and static spreads.

Hook flow should enter through the same path:

1. Add `resolveTransparentHookCallInfo(callPath)`.
2. Extend `resolveExpressionInfo` for supported `CallExpression` nodes.
3. Register local aliases from hook call results in `collectLocalAliases`.
4. Reuse existing child prop/seed/dynamic-root logic after the hook call is
   reduced to expression info.

This keeps output controllers unchanged.

### Collector Activation

The collector must not require a direct selector import in the current file
once transparent hook summaries exist. A consumer may import only a summarized
hook:

```jsx
import { useHero } from './hooks';

const App = () => {
  const hero = useHero();
  return <Header hero={ hero } />;
};
```

That file has no `useStoreSelector` import, but still needs selector tracing.
Collector activation should consider:

- direct selector imports
- configured selector hook imports
- same-file transparent hook candidates
- imported hook summaries from the manifest
- hook callsites that can resolve to summaries
- seed aliases / dynamic-root props from component tracing

Without this activation input, cross-file hook consumers would skip collection
before `resolveTransparentHookCallInfo` can run.

### Hook Discovery And Body Scanning

Add a hook-specific adapter, parallel to component discovery:

- hook candidates are top-level declarations or supported exports named
  `use[A-Z]`
- supported declaration forms should mirror the component adapter where
  practical: function declaration, const arrow, const function expression, and
  default/named export forms once the export graph can identify them
- nested hooks are ignored or diagnosed; they are not summary candidates
- non-hook helpers such as `selectHeroTitle` remain unsupported unless a future
  explicit configuration makes them selector sources

Hook body scanning should be separate from component collection:

- top-level custom hook bodies may contain an internal selector only when the
  body is selected for a valid hook summary
- selector calls inside memo callbacks or unsupported nested functions remain
  hard failures
- disallowed calls/statements in a hook body (`useState`, `useRef`,
  `useEffect`, assignments, loops, helper calls) reject the summary even if the
  final return expression looks selector-derived
- a hook import resolving to a component export, or a component import resolving
  to a hook export, is a wrong-kind import diagnostic

## Manifest Integration

Cross-file hook summaries should be manifest-owned:

```json
{
  "hookSummariesByFile": {
    "hooks.js": {
      "useHero": {
        "returnKind": "selector",
        "segments": ["hero"]
      }
    }
  },
  "hookImportEdges": [
    {
      "sourceFilename": "App.jsx",
      "localName": "useHero",
      "importedName": "useHero",
      "targetFilename": "hooks.js"
    }
  ]
}
```

The per-file transform can then consume summaries as an extension of the same
manifest handoff used for component callsite contexts.

Do not derive cross-file hook summaries from transform order.

Implementation should extend the existing manifest pass:

1. Build file records.
2. Resolve imports/exports.
3. Build component graph records.
4. Build hook summaries from top-level hook records.
5. Resolve hook import edges with the same export graph.

Cross-file diagnostics must include:

- unresolved hook import
- import resolves to a component export instead of a hook export
- ambiguous hook export, including star-export ambiguity
- unsupported hook body in the target file
- hook import cycle

## Diagnostics

Use stable diagnostic kinds:

- `unsupported-hook-call`
- `unsupported-hook-return`
- `unsupported-hook-body`
- `unsupported-hook-state-flow`
- `unsupported-hook-ref-flow`
- `unsupported-hook-callback-flow`
- `unsupported-hook-argument-flow`
- `unsupported-hook-opaque-flow`
- `unsupported-hook-nested`
- `unsupported-hook-reassignment`
- `unsupported-hook-state-in-body`
- `unsupported-hook-import`
- `ambiguous-hook-return`
- `configured-selector-hook-unresolved`
- `configured-selector-hook-invalid`
- `transparent-hook-deps-audit`

Diagnostic severity follows the existing relevance model:

- Manifest/debug note when an unsupported hook is unrelated to selector output.
- Hard error when selector-derived output depends on an unsupported hook path.
- Hard error, or at minimum declaration suppression plus metadata, when a
  selector-derived expression appears inside a mutable state/ref initializer.
- Optional fail-all mode for CI/review audits, e.g. an experimental
  `auditHooks`/strict-review mode that surfaces skipped hooks even when they
  are unrelated to output.
- `transparent-hook-deps-audit` is review-only metadata and must not influence
  path proof or output.

## Debug Metadata

Add review-mode metadata:

```json
{
  "hookSummaries": [
    {
      "hookName": "useHeroTitle",
      "filename": "App.jsx",
      "strategy": "same-file-transparent-hook",
      "returnKind": "path",
      "calleeBinding": "useMemo imported from react",
      "localReturnPath": "hero.title",
      "segments": ["hero", "title"],
      "declarationSegments": ["hero", "title"],
      "dynamicRoot": false,
      "listRelative": null
    }
  ],
  "hookCallsites": [
    {
      "componentName": "App",
      "hookName": "useHeroTitle",
      "argumentPaths": ["hero"],
      "returnKind": "scalar-path",
      "compiledPath": "hero.title",
      "dependencyPaths": ["hero"]
    }
  ],
  "skippedHooks": [
    {
      "kind": "unsupported-hook-body",
      "hookName": "useHeroTitle",
      "reason": "conditional-return"
    }
  ]
}
```

Debug metadata must explain both successful and skipped hook paths.

## First-Wave Implementation Scope

The first implementation stream should stay intentionally narrow:

1. Baseline diagnostics and taint handling for state/ref/reducer/callback flows.
2. Configured app-owned selector hooks as import-bound selector sources.
3. Import-bound direct React `useMemo` expression bodies only.

Steps 2 and 3 are independent after Phase 0. Configured selector hooks are the
lowest-risk drop-in source-recognition win; `useMemo` is the first transparent
hook-summary proof. They can land in either order if their gates stay separate.

Supported first-wave `useMemo` return kinds:

- scalar selector path
- object-root preservation for child descriptor composition
- list-root/list-relative preservation when the memo returns the original
  selector-derived value

Explicitly not in the first wave:

- object literals / object-return hooks
- block-bodied memo callbacks
- custom hook summaries
- cross-file hook summaries
- non-hook helper summaries
- tuple returns
- safe-list-chain transforms such as `useMemo(() => products.filter(...))`

First-wave debug metadata must include callee binding, return kind, compiled
path, dependency-array raw paths, and skip reason.

## Implementation Phases

### Phase 0: Hook Safety Hardening

Goal: fix live unsafe baseline behavior before adding positive hook support.

Tasks:

- suppress selector-member declarations inside stateful hook arguments
- add mutable-hook taint tracking for state bindings, setter bindings, refs,
  and `ref.current` writes
- add a transparent-hook exemption to opaque helper diagnostics so `useMemo`
  dependency arrays are collected for debug rather than treated as helper
  arguments
- split nested-selector policy between unsupported component nested functions
  and top-level hook-body summary scanning
- add fail-closed tests for selector-derived values through `useState`,
  `useReducer`, `useRef`, and `useCallback`
- add fail-closed tests for `setTitle(hero.title)`, `ref.current = hero.title`,
  effect-driven state/ref writes, and rendered `ref.current`
- add metadata tests for selector-derived values used only in `useEffect`
  without template output
- ensure no case silently renders empty output with `warnOnUnsupported: false`

Exit gates:

- `useState(hero.title)` and `useRef(hero.title)` do not emit
  `{{hero.title}}` / PHP equivalents from the initializer argument
- dangerous state/ref/callback template flows hard-error with stable hook
  diagnostic kinds
- setter/ref mutation paths hard-error when the mutated value reaches output
- `useMemo(() => hero.title, [ hero ])` dependencies do not trigger opaque
  helper diagnostics
- irrelevant effect-only usage does not break output
- metadata records skipped hook boundaries
- unsupported hook metadata is present even with warnings suppressed

### Phase 1: Configured App-Owned Selector Hooks

Goal: support high-frequency app selector hooks such as `useAppSelector`
without waiting for hook summaries.

Positive gates:

- configured named import behaves exactly like `useStoreSelector`
- configured renamed import behaves exactly like `useStoreSelector`
- configured default import if explicitly configured
- HBS/PHP parity for replacement, control, object-root child props, and
  list-relative child props
- debug metadata marks the selector source as configured

Fail-closed gates:

- same local hook name from an unconfigured source is not treated as a selector
- computed selector path
- unassigned selector call
- unsupported selector expression
- package import without matching config

### Phase 2: Direct `useMemo`

Goal: support pure `useMemo` return expressions.

Positive gates:

- import-bound `useMemo`, renamed `useMemo`, React namespace `React.useMemo`,
  and React default/namespace member forms are recognized only when the binding
  resolves to React
- scalar replacement in HBS/PHP
- control condition in HBS/PHP
- object-root prop passed to child component
- list-relative prop passed inside `.map`
- list root preserved through `useMemo(() => products)` and then mapped
- static optional member in memo return
- dependency array recorded in debug metadata
- omitted dependency array compiles the same statically proven return and is
  recorded as omitted in debug metadata

Fail-closed gates:

- local fake `useMemo`
- helper call in memo body
- conditional return
- block body with side effects
- block body with a return remains diagnostic-only in the first slice
- computed member return
- object literal return before Phase 5
- selector-derived value escapes through unsupported object spread
- hook-in-callback such as `useMemo(() => useStoreSelector(...))`
- nested selector inside memo callback hard-errors

Metadata gates:

- dependency array is surfaced in debug metadata
- missing/wrong dependency array does not change path proof or output

### Phase 3: Same-File Custom Hook Source Wrappers

Goal: support hooks that directly return `useStoreSelector(...)` or a selector
alias.

Positive gates:

- `function useHero() { return useStoreSelector(...); }`
- `const useHero = () => useStoreSelector(...)`
- hook-to-component object-root descriptors
- destructuring from source hook object roots:
  `const { title } = useHero()`
- HBS/PHP parity

Fail-closed gates:

- multiple returns
- conditional return
- async/generator hook
- hook body mutation
- hook body helper call
- hook body contains state/ref/effect/callback hooks
- non-return hook/helper statement before the return
- unsupported internal selector call does not survive import removal
- valid internal selector call is consumed by the summary and does not double
  emit
- hook result assigned to `let`/`var` or reassigned later

### Phase 4: Same-File Derived Custom Hooks

Goal: support parameterized transparent hooks.

Positive gates:

- scalar derived path
- object-root preservation
- compatible list-relative path
- hook calls another transparent hook
- local multi-source callsites compose per callsite when compatible

Fail-closed gates:

- ambiguous multi-source parameter usage
- mixed list/non-list parameter usage
- incompatible list-relative parameter usage
- computed property access
- object return before Phase 5
- object return with spread
- tuple return
- return function/callback
- reassigned hook-result alias

### Phase 5: Hook Object Return Contracts

Goal: support destructuring/member access from transparent object-return hooks.

Positive gates:

- `const view = useMemo(() => ({ title: hero.title }), [ hero ]); view.title`
- `const view = useHeroView(hero); view.title`
- `const { title } = useHeroView(hero)`
- child props from object return
- hook result consumed by static spread: `<Header {...view} />`
- explicit templateVars coexistence

Fail-closed gates:

- returned object contains method
- returned object contains opaque helper result
- returned object contains broad spread
- returned object mixes list and non-list shape for same key

### Phase 6: Cross-File Transparent Hooks

Goal: manifest-driven hook summaries across files.

Positive gates:

- named hook import
- default hook import if default support is enabled for functions
- barrel hook import through the shared drop-in resolver, not a hook-specific
  barrel implementation
- hook import through explicit alias resolver only after the shared drop-in
  resolver supports aliases
- component tree using hook result across child descriptors

Fail-closed gates:

- unresolved hook import
- unsupported hook body in imported file
- import cycle involving hook file
- ambiguous hook export
- package hook import without explicit source-hook config
- wrong-kind import where a hook call resolves to a component export

### Phase 7: Final Hook Fixture Matrix

Goal: prove natural hook use in a realistic component tree.

Fixture should include:

- configured app selector hook
- `useMemo` scalar and object-root values
- `useMemo` list-root preservation
- same-file custom hook
- cross-file custom hook through barrel if the shared drop-in barrel resolver has
  landed; otherwise direct/default cross-file hooks with barrel coverage deferred
- hook-return object spread into child props
- child component object-root descriptor
- list-relative child prop
- static children wrapper
- HBS/PHP output parity
- no selector leaks, no descriptor leaks, no orphaned artifacts
- debug metadata for successful and skipped hook paths

## Recommended Order

1. Phase 0 hook safety hardening.
2. Phase 1 configured app-owned selector hooks and Phase 2 direct `useMemo` as
   separate first-positive slices; configured hooks are source recognition,
   `useMemo` is the first summary proof.
3. Phase 3 same-file source custom hooks.
4. Phase 4 same-file derived custom hooks.
5. Phase 5 object return contracts.
6. Phase 6 cross-file transparent hooks.
7. Phase 7 final hook fixture matrix.

Rationale:

- Phase 0 fixes live silent/surprising behavior before expanding support.
- Configured selector hooks are source recognition, not hook summaries; they are
  high-value and low-risk for Redux/RTK-style codebases.
- `useMemo` is high-frequency and has a small local AST surface.
- Same-file custom hooks prove summaries without manifest complexity.
- Object return contracts are common, but they should build on scalar/object-root
  hook return support.
- Cross-file hooks should reuse the proven manifest/export resolver.

## Non-Goals

- Executing hooks
- Evaluating dependency arrays semantically
- Supporting mutable runtime state as static template data
- Generic React context tracing
- Generic render props
- Arbitrary HOC or helper execution
- Inferring selector hooks by local name only
- Supporting every library hook

## Review Questions

1. Is the transparent hook summary model the right abstraction, or should hook
   calls be lowered directly into local aliases?
2. Does the summary contract carry enough of the existing expression-info shape
   (`segments`, `declarationSegments`, dynamic roots, object members, and
   list-relative provenance) for descriptors and PHP depth?
3. Are the import-bound React built-in rules strict enough to prevent local
   fake `useMemo` functions from becoming transparent?
4. Should `useMemo` dependency arrays be validated strictly, ignored for path
   proof, or recorded only in debug metadata?
5. Does Phase 0 correctly handle the live stateful-hook argument leak by
   suppressing declarations inside `useState` / `useRef` / `useReducer`
   initializers and tracking setter/ref writes as taint?
6. Should state/ref/callback hooks hard-error immediately when selector-derived
   data enters them, or only when their returned value reaches template output?
7. Is configured app-owned selector hook support correctly moved before
   `useMemo` and custom hook summaries?
8. Is the design note for hook-internal selectors sufficient to avoid
   `assertNoUnprocessedStoreSelectorReferences` failures and double emission?
9. Is ambiguity inheritance for parameterized hooks sufficiently specified?
10. Should same-file custom hooks support object returns in the first hook slice,
   or only after scalar/object-root returns are proven?
11. Should hook object returns remain diagnostic-only until the dedicated Phase
    5 object-member alias contract lands?
12. Does collector activation cover hook-only consumer components that import a
    summarized hook but do not import a selector source directly?
13. Are the opaque-helper and dependency-array exemptions narrow enough for
    `useMemo` without weakening helper diagnostics elsewhere?
14. Is the dedicated hook-body scanner sufficiently separate from component
    nested-function selector rules?
15. Does the hook discovery adapter cover the right declaration/export forms
    without reusing component identity rules?
16. Should tuple returns ever be supported for common hooks like
   `const [hero] = useHeroTuple()`?
17. What debug metadata is sufficient for reviewers to explain a skipped hook
   path?
18. Should cross-file hook summaries reuse the component manifest pass, or run as
   a separate prepass phase?
19. Are there common natural hook patterns missing from this plan?
