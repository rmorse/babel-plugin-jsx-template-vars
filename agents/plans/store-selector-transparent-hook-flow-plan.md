# Store Selector Transparent Hook Flow Plan

## Status

Draft research and implementation plan for reviewer analysis.

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

- `useMemo` with a pure selector-derived return expression
- same-file custom hooks with a single static return
- cross-file custom hooks after same-file summaries are proven
- optional configured source selector hooks such as app-owned `useAppSelector`
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
   Selector-derived values crossing those hooks should fail closed when they
   affect template output.

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

## Supported Candidate Shapes

### 1. Direct `useMemo` Projection

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

- callee must be `useMemo` or `React.useMemo`
- first argument must be an arrow/function expression
- body must be a single expression or single `return`
- return expression must resolve through existing selector alias logic
- dependency array is not used to prove the template path
- dependency array may be recorded in debug metadata for review

Fail-closed siblings:

```jsx
useMemo(() => compute(hero), [ hero ]);
useMemo(() => cond ? hero.title : other.title, [ hero, other ]);
useMemo(() => {
  log(hero.title);
  return hero.title;
}, [ hero ]);
```

### 2. `useMemo` Object Return

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

Implementation should reuse the same synthetic-property model as static object
spreads:

- scalar properties can become member aliases
- object-root properties require descriptor provenance
- computed properties are unsupported
- spread inside returned object is unsupported until separately proven

### 3. `useMemo` Object Root Preservation

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

### 4. Same-File Source Custom Hook

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
- returned expression may be direct `useStoreSelector(...)`, a selector alias,
  or a supported transparent hook call

### 5. Same-File Derived Custom Hook

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

Fail-closed siblings:

```jsx
function useHeroTitle(hero) {
  return formatTitle(hero.title);
}

function useHeroTitle(hero) {
  if (hero.status === 'published') return hero.title;
  return hero.draftTitle;
}
```

### 6. Hook Returning Object Contract

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

Deferred:

- nested object literals
- object spread
- array/tuple returns
- methods/functions in returned object

### 7. Cross-File Transparent Custom Hooks

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

### 8. Configured App-Owned Selector Hooks

Many apps already have:

```jsx
const hero = useAppSelector((state) => state.hero);
```

The project currently recognizes the package-scoped `useStoreSelector` import.
For drop-in adoption, we should investigate an explicit opt-in config:

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

This is different from transparent custom hooks. A configured selector hook is
a new selector source. A transparent custom hook is a summarized wrapper around
an existing selector source.

## Explicitly Unsupported Hook Shapes

### `useState`

```jsx
const [ title ] = useState(hero.title);
return <h1>{ title }</h1>;
```

Even if the initial value is selector-derived, state is mutable. Treating it as
static template data would be misleading.

Policy:

- if selector-derived values enter `useState` and the returned state variable is
  used in template output, hard diagnostic
- otherwise record unsupported metadata only

### `useReducer`

Same policy as `useState`. Reducer state is runtime mutable.

### `useRef`

```jsx
const ref = useRef(hero.title);
return <h1>{ ref.current }</h1>;
```

Refs are mutable and lifecycle-dependent. `ref.current` should not be traced as
static template data.

Policy:

- `useRef(selectorValue)` used only as a DOM ref remains irrelevant
- `ref.current` rendered or passed to selector-traced child props fails closed
- selector-derived data stored into `ref.current` fails closed if consumed

### `useEffect` / `useLayoutEffect`

Effects do not return render data. Any selector-derived value used only inside
an effect is irrelevant to template output. Any value produced by effect-driven
mutation is unsupported.

### `useCallback`

Callbacks are functions, not template values. Do not trace through returned
callbacks as data.

Potential future exception:

- explicitly modeled render helper callbacks passed to a known static API

That should be a separate render-prop/helper research item, not part of this
hook flow plan.

### `useContext`

Context is runtime graph data. Generic context tracing remains out of scope.
Configured context adapters could be researched later, but should not block
transparent hook support.

## Hook Summary Model

Add a hook summary layer that can answer:

```txt
When call expression `useX(arg0, arg1)` appears at this callsite,
what selector-derived value does it return?
```

Suggested summary shape:

```json
{
  "hookName": "useHeroTitle",
  "filename": "App.jsx",
  "params": ["hero"],
  "returnKind": "path",
  "returnSegments": ["hero", "title"],
  "dependencies": ["hero"],
  "source": "same-file",
  "strategy": "transparent-hook-summary"
}
```

For parameterized hooks, summary return paths are local to parameters until
callsite resolution:

```json
{
  "hookName": "useHeroTitle",
  "params": ["hero"],
  "returnKind": "path",
  "returnSegments": ["$param:hero", "title"]
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

## Diagnostics

Use stable diagnostic kinds:

- `unsupported-hook-call`
- `unsupported-hook-return`
- `unsupported-hook-body`
- `unsupported-hook-state-flow`
- `unsupported-hook-ref-flow`
- `unsupported-hook-callback-flow`
- `unsupported-hook-import`
- `ambiguous-hook-return`
- `configured-selector-hook-unresolved`
- `configured-selector-hook-invalid`

Diagnostic severity follows the existing relevance model:

- Manifest/debug note when an unsupported hook is unrelated to selector output.
- Hard error when selector-derived output depends on an unsupported hook path.
- Optional fail-all mode for CI/review audits.

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
      "localReturnPath": "hero.title"
    }
  ],
  "hookCallsites": [
    {
      "componentName": "App",
      "hookName": "useHeroTitle",
      "argumentPaths": ["hero"],
      "compiledPath": "hero.title"
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

## Implementation Phases

### Phase 0: Hook Boundary Baseline

Goal: inventory current behavior and pin dangerous unsupported cases.

Tasks:

- Add fail-closed tests for selector-derived values through `useState`,
  `useReducer`, `useRef`, and `useCallback`.
- Add metadata tests for selector-derived values used only in `useEffect`
  without template output.
- Ensure no case silently renders empty output with `warnOnUnsupported: false`.

Exit gates:

- dangerous state/ref/callback template flows hard-error
- irrelevant effect-only usage does not break output
- metadata records skipped hook boundaries

### Phase 1: Direct `useMemo`

Goal: support pure `useMemo` return expressions.

Positive gates:

- scalar replacement in HBS/PHP
- control condition in HBS/PHP
- object-root prop passed to child component
- list-relative prop passed inside `.map`
- dependency array recorded in debug metadata

Fail-closed gates:

- helper call in memo body
- conditional return
- block body with side effects
- computed member return
- selector-derived value escapes through unsupported object spread

### Phase 2: Same-File Custom Hook Source Wrappers

Goal: support hooks that directly return `useStoreSelector(...)` or a selector
alias.

Positive gates:

- `function useHero() { return useStoreSelector(...); }`
- `const useHero = () => useStoreSelector(...)`
- hook-to-component object-root descriptors
- HBS/PHP parity

Fail-closed gates:

- multiple returns
- conditional return
- async/generator hook
- hook body mutation
- hook body helper call

### Phase 3: Same-File Derived Custom Hooks

Goal: support parameterized transparent hooks.

Positive gates:

- scalar derived path
- object-root preservation
- compatible list-relative path
- hook calls another transparent hook
- object return with scalar properties

Fail-closed gates:

- ambiguous multi-source parameter usage
- computed property access
- object return with spread
- tuple return
- return function/callback

### Phase 4: Hook Object Return Contracts

Goal: support destructuring/member access from transparent object-return hooks.

Positive gates:

- `const view = useHeroView(hero); view.title`
- `const { title } = useHeroView(hero)`
- child props from object return
- explicit templateVars coexistence

Fail-closed gates:

- returned object contains method
- returned object contains opaque helper result
- returned object contains broad spread
- returned object mixes list and non-list shape for same key

### Phase 5: Cross-File Transparent Hooks

Goal: manifest-driven hook summaries across files.

Positive gates:

- named hook import
- default hook import if default support is enabled for functions
- barrel hook import
- hook import through explicit alias resolver
- component tree using hook result across child descriptors

Fail-closed gates:

- unresolved hook import
- unsupported hook body in imported file
- import cycle involving hook file
- ambiguous hook export
- package hook import without explicit source-hook config

### Phase 6: Configured App-Owned Selector Hooks

Goal: support app selectors such as `useAppSelector` by explicit config.

Positive gates:

- named import from configured source
- renamed import from configured source
- default import from configured source if configured
- same selector grammar as `useStoreSelector`
- debug metadata marks configured source hook

Fail-closed gates:

- same local hook name from unconfigured source
- computed selector path
- unassigned selector call
- unsupported selector expression
- package import without config

### Phase 7: Final Hook Fixture Matrix

Goal: prove natural hook use in a realistic component tree.

Fixture should include:

- `useMemo` scalar and object-root values
- same-file custom hook
- cross-file custom hook through barrel
- configured app selector hook
- child component object-root descriptor
- list-relative child prop
- static children wrapper
- HBS/PHP output parity
- no selector leaks, no descriptor leaks, no orphaned artifacts
- debug metadata for successful and skipped hook paths

## Recommended Order

1. Phase 0 hook boundary baseline.
2. Phase 1 direct `useMemo`.
3. Phase 2 same-file source custom hooks.
4. Phase 3 same-file derived custom hooks.
5. Phase 4 object return contracts.
6. Phase 5 cross-file transparent hooks.
7. Phase 6 configured app-owned selector hooks.
8. Phase 7 final hook fixture matrix.

Rationale:

- `useMemo` is high-frequency and has a small local AST surface.
- Same-file custom hooks prove summaries without manifest complexity.
- Object return contracts are common, but they should build on scalar/object-root
  hook return support.
- Cross-file hooks should reuse the proven manifest/export resolver.
- Configured app-owned selector hooks are valuable for drop-in adoption, but
  they create a new public-ish integration surface and should follow the
  transparent-hook proof.

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
2. Should `useMemo` dependency arrays be validated strictly, ignored for path
   proof, or recorded only in debug metadata?
3. Should `useState(selectorValue)` always hard-error, or only when the returned
   state variable reaches template output?
4. Is `useRef` correctly treated as unsupported for template data flow?
5. Should same-file custom hooks support object returns in the first hook slice,
   or only after scalar/object-root returns are proven?
6. Should tuple returns ever be supported for common hooks like
   `const [hero] = useHeroTuple()`?
7. Should configured app-owned selector hooks be part of this plan, or a
   separate public API plan?
8. What debug metadata is sufficient for reviewers to explain a skipped hook
   path?
9. Should cross-file hook summaries reuse the component manifest pass, or run as
   a separate prepass phase?
10. Are there common natural hook patterns missing from this plan?

