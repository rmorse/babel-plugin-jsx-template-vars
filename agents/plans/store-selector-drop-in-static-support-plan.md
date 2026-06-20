# Store Selector Drop-In Static Support Plan

## Status

Draft research and implementation plan for reviewer analysis.

This plan extends the broad-support roadmap with a specific goal: make the
store-selector experiment feel as close to drop-in as possible for ordinary
static, prop-driven React component trees, while preserving the project's
fail-closed safety model.

It does not replace:

- [store-selector-broad-support-roadmap.md](./store-selector-broad-support-roadmap.md)
- [store-selector-multi-source-path-plan.md](./store-selector-multi-source-path-plan.md)

It narrows the next set of work to import/export breadth, component declaration
breadth, wrapper recognition, and common JSX expression patterns.

## Executive Summary

The current experiment has strong support for statically traceable selector
data through same-file and cross-file component trees. It now handles
path-polymorphic object roots, compatible list-relative reuse, PHP/Handlebars
depth, cross-file callsite contexts, and several common static JSX subsets.

The biggest remaining "drop-in" gap is not the selector path model itself. It
is the shape of real project code around that model:

- imports often come through defaults, barrels, namespaces, aliases, and
  packages
- components are often declared as `function Header()`, `export default`, or
  wrapped in `memo`
- props are often grouped with static spreads
- wrappers often pass through `children`
- TypeScript adds type-only imports/exports and annotations everywhere

The recommendation is to support every form that is statically resolvable and
semantically transparent, and to keep dynamic forms diagnostic-only. The plan
should be judged by whether it expands natural authoring coverage without
turning the transform into React execution or bundler emulation.

## Design Principles

1. **Support the static subset.**
   If a resolver, export, wrapper, spread, or JSX member expression can be
   resolved without evaluating runtime code, it is a candidate for support.

2. **Diagnose the dynamic subset.**
   Dynamic component selection, computed namespace members, broad object
   spreads, HOCs with runtime behavior, and render props should remain
   fail-closed until separately proven.

3. **Do not invent mappings.**
   The transform should not rescue wrong React wiring. If a parent passes the
   wrong prop or the child destructures a different prop, that is an authoring
   error. We may diagnose it, but we should not guess.

4. **Keep output controllers generic.**
   Selector-specific decisions stay in collector, visitor, manifest, and
   resolver handoff. Controllers may consume generic path/context facilities,
   not selector/import concepts.

5. **Every new positive shape gets a fail-closed sibling.**
   Multi-source ambiguity errors are unconditional by design. As support
   broadens, paired negative fixtures are the guard against false-positive hard
   errors and silent partial output.

6. **Debug metadata is part of the feature.**
   Cross-file, alias, barrel, and wrapper resolution must be explainable in
   review mode. If an author cannot tell why a component did or did not trace,
   the support is not complete.

## Current Foundation

Already implemented:

- same-file and cross-file selector graph tracing
- direct relative named imports
- renamed named imports
- multiple named exports from one file
- extensionless and `index` resolution for `.js`, `.jsx`, `.ts`, `.tsx`
- TS/TSX parsing
- explicit diagnostics for unsupported default imports, namespace imports,
  package/non-relative imports, re-exports, cycles, and unsupported component
  declarations
- object-root descriptors for path-polymorphic callsites
- list-relative seed sharing for compatible list shapes
- static optional member chains such as `hero?.title`
- direct `children` passthrough and supported list-rendering children
- inline object-literal scalar spreads
- fail-closed mixed context and incompatible list-relative ambiguity
- broad e2e hygiene checks for orphaned generated template artifacts

The remaining work is therefore not a ground-up design. It is controlled
expansion of what the manifest can resolve and what the collector can prove.

## Definition Of Drop-In Static Support

"Drop-in" does not mean arbitrary application support. It means a typical
author can keep normal static component organization and not restructure code
purely for the transform.

In scope:

- direct relative imports
- extensionless and `index` imports
- named, renamed, default, namespace-member, and barrel exports
- explicit configured aliases and workspace/package entries
- top-level component declarations and transparent wrappers
- statically analyzable props, children, and spreads
- TypeScript syntax that does not affect runtime data flow

Out of scope unless separately proven:

- runtime component selection
- computed namespace/component members
- broad runtime object spread
- arbitrary HOC execution
- render props as data-flow
- generic React context tracing
- shape-polymorphic output
- crawling arbitrary third-party `node_modules` without explicit opt-in

## Target Use Cases

### 1. Default Imports

Common authoring:

```jsx
import Header from './Header';
```

Supported export forms should include:

```jsx
export default Header;
export default function Header(props) {}
export default function(props) {}
const Header = (props) => {};
export { Header as default };
```

Recommended contract:

- For `export default Header`, resolve to the local `Header` binding.
- For `export default function Header() {}`, use `Header`.
- For anonymous default functions, synthesize a manifest component identity such
  as `default` for export resolution, but preserve the local import name for
  JSX callsites and debug metadata.
- Do not use the old unsafe "local import name matches a named export" fallback.
- If multiple default candidates exist or the default export is not a component,
  diagnose and skip.

Positive gates:

- relative default import direct child, object-root replace/control, HBS/PHP
- default import with `export { Header as default }`
- anonymous default function component
- cross-file multi-source object roots through default imports
- debug import edge shows `importedName: 'default'`, target export kind, and
  resolved component identity

Fail-closed gates:

- default export is non-component value
- default export is a call expression with unknown runtime behavior
- default import from barrel with ambiguous default
- local import name differs from default function name but export resolution is
  valid; should still trace by export, not by name matching

### 2. Barrel And Re-Export Resolution

Common authoring:

```jsx
export { Header } from './Header';
export { ProductCard as Card } from './ProductCard';
export * from './cards';
```

Supported subset:

- `export { X } from './X'`
- `export { X as Y } from './X'`
- `export { default as X } from './X'`
- local re-export after import:

  ```jsx
  import { Header } from './Header';
  export { Header };
  ```

- `export * from './module'` when it resolves to a unique exported component
  name and does not conflict

Diagnostics:

- ambiguous star exports
- re-export cycles
- default re-export from a non-component
- conflicts between local export and star export
- package/barrel chains beyond configured resolver boundary

Implementation guidance:

- Build an explicit export graph, separate from the current import edge graph.
- Resolve exports to a canonical target:

  ```txt
  exportedName -> targetFile + targetExportName + targetComponentIdentity
  ```

- Treat a barrel as an edge, not as a component file.
- Keep cycle detection on the export graph as well as the import graph.
- Store debug edges for each hop so reviewers can see:

  ```txt
  App.jsx imports { Header } from ./components
  ./components/index.jsx re-exports Header from ./Header
  ./Header.jsx exports Header
  ```

Positive gates:

- one-hop named barrel
- renamed barrel export
- default-as-named barrel export
- star export with unique match
- two-hop barrel chain
- cross-file object-root and list-relative fixtures through a barrel

Fail-closed gates:

- ambiguous `export *`
- re-export cycle
- missing re-export target
- barrel exporting a non-component under component name
- mixed supported and unsupported exports in the same barrel; supported edges
  should still work if graph consistency permits

### 3. Namespace Imports

Common authoring:

```jsx
import * as Cards from './cards';

const App = () => <Cards.Header hero={ hero } />;
```

Supported subset:

- JSX member expression where the object is a namespace import and the property
  is a static identifier
- namespace source resolves to a file/barrel export graph
- `Cards.Header` maps to exported `Header`

Unsupported:

```jsx
const Name = 'Header';
const Header = Cards[Name];
return <Header />;

return <Cards[variant] />;
```

Implementation guidance:

- Extend child component identity from string-only `openingElement.name.name` to
  a structured component reference:

  ```txt
  local JSX tag: Header
  namespace JSX tag: Cards.Header
  member chain: Cards.Group.Header? (probably defer)
  ```

- Store namespace imports in manifest import records instead of immediately
  diagnosing.
- Resolve `Cards.Header` at callsite collection time to the target export.
- Keep debug metadata readable:

  ```txt
  jsxTag: "Cards.Header"
  namespaceLocalName: "Cards"
  exportedName: "Header"
  targetFile: ...
  ```

Positive gates:

- namespace member JSX direct object-root child
- namespace member JSX list-relative child
- namespace import from a barrel
- namespace import with renamed export in barrel

Fail-closed gates:

- computed member `Cards[name]`
- destructured namespace alias that loses static edge
- nested namespace member chains if not explicitly supported
- namespace import from package without configured resolver

### 4. Package, Workspace, And Alias Imports

Common authoring:

```jsx
import { Header } from '@/components/Header';
import { Header } from '@acme/ui';
import { Header } from '@workspace/components';
```

Recommended rule:

Support only when the project wrapper has an explicit deterministic resolver.
Do not crawl arbitrary installed packages by default.

Resolver sources, in recommended order:

1. explicit plugin resolver config
2. `tsconfig.json` / `jsconfig.json` `baseUrl` and `paths`
3. workspace package map from package manager metadata or explicit config
4. local package `exports`
5. local package `main` / `module`

Do not automatically scan third-party `node_modules` unless the package is
explicitly opted in.

Potential API sketch:

```js
createStoreSelectorProjectManifest({
  rootDir,
  resolver: {
    aliases: {
      '@/*': 'src/*',
      '@components/*': 'src/components/*',
    },
    workspaces: true,
    packages: [
      '@acme/ui',
    ],
  },
});
```

Positive gates:

- `@/components/Header` alias
- `tsconfig.paths` alias
- workspace package import
- package `exports` mapping to source
- package barrel export
- debug edge identifies resolver strategy

Fail-closed gates:

- unconfigured package import
- alias points outside configured project roots
- package resolves to compiled output without source map/source file
- package export condition unsupported
- ambiguous alias match

Security and performance:

- Constrain file reads to configured roots.
- Normalize resolved paths.
- Cache package/alias resolution during manifest creation.
- Include resolver strategy in debug metadata and diagnostics.

### 5. Component Declaration Forms

Common authoring:

```jsx
export function Header({ hero }) {
  return <h1>{ hero.title }</h1>;
}

function Header({ hero }) {
  return <h1>{ hero.title }</h1>;
}
export { Header };
```

Currently supported component paths are mainly top-level variable declarations
with arrow/function expressions. Drop-in support should add:

- function declarations
- exported function declarations
- default function declarations
- named functions exported separately
- TypeScript annotated function/arrow components

Implementation guidance:

- Normalize component declarations into a common internal component path
  interface rather than forcing everything through variable declarations.
- Controller injection currently expects variable declaration shape in several
  places. Add a component adapter that exposes:

  ```txt
  componentName
  functionPath
  paramPath
  bodyPath
  exportIdentity
  declarationPath
  ```

- Avoid converting source shape unless necessary. If conversion is necessary
  for injection, keep it local and covered by generated-code tests.

Positive gates:

- `function Header`
- `export function Header`
- `export default function Header`
- anonymous default function component
- TypeScript props annotation
- cross-file default import into a function declaration component

Fail-closed gates:

- overloaded or nested component declarations
- component declaration inside another function
- multiple runtime params where props param is not statically identifiable
- generator/async components

### 6. Transparent Wrappers: `memo` And `forwardRef`

Common authoring:

```jsx
export const Header = memo(({ hero }) => <h1>{ hero.title }</h1>);
export default React.memo(Header);

const Header = forwardRef(function Header({ hero }, ref) {
  return <h1 ref={ ref }>{ hero.title }</h1>;
});
```

Recommended support:

- Treat a small allowlist of wrappers as transparent when their props function
  is statically visible.
- Start with `memo` and `React.memo`.
- Add `forwardRef` only when the first parameter is clearly props and the second
  parameter is ref.
- Do not execute wrapper arguments.

Implementation guidance:

- Add `unwrapTransparentComponentExpression(expression)` with provenance:

  ```txt
  wrapper: memo | React.memo | forwardRef | React.forwardRef
  wrappedFunctionPath
  propsParamIndex
  refParamIndex?
  ```

- Wrapper support should feed the same component adapter from Gate 5.
- Debug metadata should show the wrapper chain.

Positive gates:

- `memo(({ hero }) => ...)`
- `React.memo(Header)` where `Header` is local top-level component
- `forwardRef(({ hero }, ref) => ...)`
- default export of memo-wrapped component

Fail-closed gates:

- unknown wrapper `withTheme(Header)`
- wrapper with non-function runtime expression
- wrapper composition beyond allowlist if not implemented
- `memo(factory())`
- `forwardRef` with untraceable props param

### 7. Static JSX Spreads

Already supported:

```jsx
<Header {...{ title: hero.title }} />
```

Natural next support:

```jsx
const headerProps = {
  title: hero.title,
  status: hero.status,
};

<Header {...headerProps} />
```

Supported subset:

- local `const` object literal
- no reassignment
- properties are static keys
- values are selector-derived scalar paths or supported descriptors
- spread order is statically known
- later explicit props override earlier spread props using normal JSX semantics

Potential support:

```jsx
const base = { title: hero.title };
const headerProps = { ...base, status: hero.status };
<Header {...headerProps} />;
```

Defer until simple local object support is proven.

Implementation guidance:

- Add a local static object environment collector.
- Resolve JSX spreads into synthetic prop traces before child prop grouping.
- Preserve source locations for diagnostics.
- For object-root values inside spreads, require the same provenance rules as
  direct props.

Positive gates:

- local const object scalar spread
- local const object object-root spread
- spread plus explicit override
- spread through cross-file child
- debug metadata shows spread provenance

Fail-closed gates:

- non-const spread source
- object built through mutation
- computed property key
- spread from function return
- spread from runtime props
- conflicting spread values where override order cannot be proven

### 8. `children` Composition

Already supported:

- direct children passthrough when a wrapper renders `{ children }`
- list-rendering children inside component children

Drop-in target:

```jsx
const Panel = ({ children }) => <section>{ children }</section>;
const App = () => <Panel><Header hero={ hero } /></Panel>;
```

The direct passthrough case should preserve selector tracing through the child
inside `children` without treating the wrapper as the data owner.

Possible support tiers:

1. **Direct passthrough only**:

   ```jsx
   const Panel = ({ children }) => <section>{ children }</section>;
   ```

2. **Static layout passthrough**:

   ```jsx
   const Panel = ({ title, children }) => (
     <section>
       <h2>{ title }</h2>
       <div>{ children }</div>
     </section>
   );
   ```

3. **Multiple direct children slots via props**:

   ```jsx
   const Layout = ({ header, children }) => <>{ header }{ children }</>;
   ```

Recommended first slice:

- Direct `children` passthrough and static layout passthrough.
- Do not support `React.Children.map`, `cloneElement`, conditional children
  manipulation, render props, or function-as-children.

Implementation guidance:

- Distinguish selector data used *as* children from JSX elements containing
  selector-driven components.
- Existing child-boundary diagnostics should not over-capture supported JSX
  child elements or list maps.
- Add wrapper metadata:

  ```txt
  component: Panel
  childrenPolicy: direct-passthrough
  ```

Positive gates:

- wrapper around object-root child
- wrapper around list-relative child
- wrapper with its own selector scalar plus children passthrough
- cross-file wrapper component
- nested wrappers

Fail-closed gates:

- `React.Children.map(children, ...)`
- `cloneElement(children, extraProps)`
- conditional manipulation of children
- render prop children
- children converted to array or inspected

### 9. Optional Chaining Expansion

Already supported:

```jsx
hero?.title
hero?.status === 'published'
```

Potential next support:

- nested static optional chains:

  ```jsx
  hero?.media?.image?.url
  ```

- optional call boundaries should remain unsupported:

  ```jsx
  hero.getTitle?.()
  ```

Recommendation:

- Treat static optional member chains as normal member chains.
- Keep computed optional members hard-error:

  ```jsx
  hero?.[key]
  ```

- Keep optional calls diagnostic-only.

Positive gates:

- nested static optional member in replace
- nested static optional member in control
- optional chain through dynamic root descriptor
- optional chain in cross-file child

Fail-closed gates:

- computed optional member
- optional call
- optional chain over non-selector runtime value into dynamic-root prop

### 10. TypeScript-Specific Syntax

TS/TSX parsing exists, but drop-in behavior needs stronger guarantees.

Support/ignore:

- type-only imports:

  ```ts
  import type { HeaderProps } from './types';
  ```

- interface/type props annotations
- `React.FC<Props>` annotations if the underlying component expression is
  transparent
- `as const` on static object spreads
- `satisfies` on static object spreads
- enums and const enums should not be interpreted as selector data

Diagnostics:

- type-only imports should not produce unsupported import diagnostics
- unresolved type-only imports should not block selector manifest creation
- TS syntax parse failures should diagnose with `parse-error`

Positive gates:

- typed props function declaration
- typed arrow component
- `React.FC<Props>` where props param is still statically visible
- static spread object with `as const`
- `satisfies` object shape

Fail-closed gates:

- component type alias with no runtime binding
- type-only component import used as JSX
- generic component where props param cannot be read

### 11. Package Wrapper And Resolver API

The current wrapper is a synchronous skeleton. Drop-in support needs a stable
integration story before widening project usage.

Minimum wrapper contract:

- deterministic source discovery
- root/include/exclude configuration
- explicit resolver config
- stable diagnostics and debug payload
- no hidden `__crossFileManifest` in user examples
- optional strict/review mode helper

Potential API:

```js
const manifest = createStoreSelectorProjectManifest({
  rootDir,
  include: [ 'src/**/*.{js,jsx,ts,tsx}' ],
  exclude: [ '**/*.test.*', '**/*.stories.*' ],
  resolver: {
    tsconfig: 'tsconfig.json',
    aliases: {
      '@/*': 'src/*',
    },
    packages: [ '@acme/ui' ],
  },
});

const options = createStoreSelectorBabelOptions(manifest, {
  language: 'handlebars',
  strict: true,
  experimentalStoreSelectors: { debug: true },
});
```

Follow-up wrapper requirements:

- cache manifest by file content hash
- expose invalidation hook
- keep manifest output deterministic
- performance smoke on realistic N-file graph
- serialize debug manifest for CI review

## Implementation Phases

### Phase 0: Contract Baseline

Goal: lock the current behavior before broadening.

Tasks:

- Add a plan-specific fixture inventory.
- Ensure every current import diagnostic has a stable `kind`.
- Ensure e2e selector fixtures keep orphaned generated artifact checks.
- Record current unsupported import/component shapes in debug metadata.
- Add reviewer-facing docs for supported static subset vs dynamic subset.

Exit gates:

- full suite passes
- no existing broad-support fixture behavior changes
- debug metadata for unsupported default/namespace/package/barrel imports remains
  stable

### Phase 1: Export Graph And Default Imports

Goal: safely support default imports and build the export graph needed for
barrels.

Tasks:

- Build export table per file.
- Resolve named exports through existing component paths.
- Resolve default exports through explicit export declarations only.
- Remove any name-match fallback.
- Add component identities for anonymous default functions.
- Extend debug import edges with export resolution.

Exit gates:

- default import positive fixtures pass HBS/PHP
- default non-component fails closed
- default anonymous function works or has a documented diagnostic
- no seed invention on bad defaults

### Phase 2: Barrels And Re-Exports

Goal: support common local barrel files without treating them as components.

Tasks:

- Resolve `export { X } from`.
- Resolve `export { X as Y } from`.
- Resolve `export { default as X } from`.
- Resolve local import-then-export barrels.
- Add conservative `export *` support with ambiguity detection.
- Add export graph cycle detection.

Exit gates:

- one-hop and two-hop barrel fixtures
- star export unique match works
- star export ambiguity fails closed
- export cycle diagnostic
- debug metadata shows every barrel hop

### Phase 3: Namespace Member JSX

Goal: support `import * as Cards` plus `<Cards.Header />` for static members.

Tasks:

- Represent JSX component references structurally.
- Resolve namespace member callsites to export graph entries.
- Thread structured component references through child prop collection and
  manifest callsite contexts.
- Add debug tag names for namespace components.

Exit gates:

- namespace direct child object-root
- namespace list-relative child
- namespace through barrel
- computed namespace member fails closed
- package namespace stays diagnostic unless resolver says otherwise

### Phase 4: Component Declaration Breadth

Goal: support normal declaration forms.

Tasks:

- Introduce internal component adapter.
- Support function declarations.
- Support exported function declarations.
- Support default function declarations.
- Support TypeScript annotations on supported component forms.
- Keep unsupported declarations diagnostic-only.

Exit gates:

- same-file and cross-file fixtures for each declaration form
- no controller assumption on variable-only declaration shape remains for new
  supported forms
- unsupported nested/async/generator components diagnose

### Phase 5: Transparent Wrapper Recognition

Goal: support `memo` and carefully scoped `forwardRef`.

Tasks:

- Add transparent wrapper allowlist.
- Resolve direct and `React.` wrapper identifiers.
- Unwrap local references without executing code.
- Feed unwrapped function into component adapter.
- Record wrapper chain in debug metadata.

Exit gates:

- `memo` positive fixtures
- `React.memo` positive fixtures
- `forwardRef` positive fixtures if included
- unknown HOC remains fail-closed
- wrapper factory/runtime call remains fail-closed

### Phase 6: Static Spread Expansion

Goal: support local const object spreads that are equivalent to direct props.

Tasks:

- Collect local static object environments.
- Resolve simple const object spreads into synthetic JSX props.
- Preserve JSX override order.
- Thread spread provenance through debug and diagnostics.

Exit gates:

- scalar local object spread
- object-root local object spread
- spread plus explicit override
- mutated/computed/runtime spread fail-closed
- cross-file child through spread works

### Phase 7: Children Composition Expansion

Goal: support normal layout wrappers that pass children through unchanged.

Tasks:

- Classify direct children passthrough wrappers.
- Support static layout passthrough with wrapper-owned markup.
- Ensure selector components inside children keep their own callsite contexts.
- Keep children manipulation diagnostic-only.

Exit gates:

- wrapper around object-root child
- wrapper around list-relative child
- nested wrappers
- wrapper with own selector scalar plus children passthrough
- `cloneElement`, `React.Children.map`, render prop children fail closed

### Phase 8: Alias And Package Resolver

Goal: support configured aliases and local package/workspace imports.

Tasks:

- Add resolver config.
- Parse tsconfig/jsconfig paths if configured.
- Resolve workspace/local package sources.
- Resolve package exports for explicitly opted-in packages.
- Keep arbitrary package imports diagnostic-only.

Exit gates:

- alias import fixture
- tsconfig paths fixture
- workspace package fixture
- package exports fixture
- out-of-root and unconfigured package fail closed
- debug metadata records resolver strategy

### Phase 9: Final Drop-In Fixture Matrix

Goal: prove realistic project shape.

Fixtures should combine:

- default imports
- barrels
- namespace member components
- function declarations
- memo wrappers
- local static spreads
- children wrappers
- TypeScript syntax
- same-file and cross-file multi-source object roots
- list-relative reuse
- HBS/PHP parity

Must assert:

- no live `useStoreSelector`
- no `$$`
- no orphaned template artifacts
- debug metadata explains successful and skipped edges
- unsupported sibling fixtures hard-error under `warnOnUnsupported: false`

## Recommended Order

1. Phase 0 contract baseline.
2. Phase 1 export graph and default imports.
3. Phase 2 barrels and re-exports.
4. Phase 4 component declaration breadth.
5. Phase 3 namespace member JSX.
6. Phase 6 static spread expansion.
7. Phase 7 children composition expansion.
8. Phase 5 transparent wrappers.
9. Phase 8 alias and package resolver.
10. Phase 9 final drop-in fixture matrix.

Rationale:

- Default imports and barrels unlock many codebases and build resolver
  primitives needed by namespace/package support.
- Component declaration breadth should land before wrapper recognition so
  wrappers can reuse a stable component adapter.
- Static spreads and children wrappers are authoring-pattern breadth; they can
  be developed independently after import graph shape stabilizes.
- Alias/package resolution should wait until export graph semantics and debug
  metadata are stable, because it widens the file graph considerably.

## Diagnostics Taxonomy Additions

Likely new diagnostic kinds:

```txt
unsupported-default-export
ambiguous-default-export
unsupported-reexport-target
ambiguous-star-export
export-cycle
unsupported-namespace-member
computed-namespace-member
unsupported-package-import
unconfigured-package-import
alias-outside-root
ambiguous-alias-resolution
unsupported-component-wrapper
unsupported-component-function
unsupported-static-spread
mutated-static-spread
computed-spread-property
unsupported-children-manipulation
type-only-jsx-component
```

Every kind should include:

- filename
- source/import/export string when relevant
- local name
- target filename if resolved
- target export/component if known
- callsite ID if JSX-specific
- strategy/skip reason
- actionable message

## Debug Metadata Requirements

The debug payload should be able to answer:

- Which import did this JSX tag resolve through?
- Was it direct, default, barrel, namespace, alias, or package?
- Which export chain was followed?
- Which component declaration form was used?
- Was a transparent wrapper unwrapped?
- Which props were direct, spread-derived, descriptor-derived, or static?
- Which `children` policy applied?
- Which paths compiled?
- Which edges were skipped and why?

Suggested additions:

```txt
exportEdges[]
resolverEdges[]
namespaceEdges[]
componentDeclarations[]
wrapperUnwraps[]
spreadPropSources[]
childrenPolicies[]
```

## Reviewer Questions

1. Is supporting local barrels before package aliases the right sequence?
2. Should `export *` support be included early with ambiguity detection, or
   deferred until named re-exports are stable?
3. Is anonymous default function support worth the extra component identity
   complexity, or should it diagnose until wrapper/API shape is more mature?
4. Should `forwardRef` be supported alongside `memo`, or deferred because the
   second parameter changes component semantics?
5. Are static local object spreads safe enough for Phase 6, or should spreads
   remain limited to inline object literals until the import graph work settles?
6. Which package resolver config should be the first supported public API:
   explicit aliases only, tsconfig paths, or workspace package maps?
7. Do we want any support for `export * as Cards from './cards'` before general
   namespace support?
8. Should every unsupported import shape hard-error in strict/review mode, or
   should some remain manifest diagnostics only until a selector path crosses
   them?

## Non-Goals For This Plan

- runtime component resolution
- arbitrary HOC execution
- render-prop data-flow
- generic React context tracing
- shape-polymorphic output
- automatic third-party package crawling
- bundler plugin implementation
- cache/watch implementation beyond API design and deterministic tests

## Success Criteria

This plan is successful when reviewers agree that:

- the static/dynamic boundary is clear
- the import/export graph approach is safe
- every common shape has either a support path or a diagnostic path
- controller boundaries remain protected
- the phase order avoids doing package/bundler work before resolver semantics
  are stable
- the fixture strategy catches both false negatives and false-positive hard
  errors

