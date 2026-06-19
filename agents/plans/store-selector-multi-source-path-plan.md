# Store Selector Multi-Source Path Implementation Plan

## Status

Step-by-step implementation plan for the next store-selector experiment stream.

Background research:
[store-selector-callsite-specialization-research.md](./store-selector-callsite-specialization-research.md).

This plan converts the multi-source path research into concrete checkpoints,
implementation guidance, caveats, and testing criteria. It is intentionally
phased. The first implementation should prove the smallest safe path before
expanding to cross-file graphs, list-relative variants, or shape-polymorphic
components.

## Problem Statement

The store-selector experiment can trace selected data through same-file and
cross-file component trees, but it still models a child prop binding as having
one canonical source.

That fails for valid reusable components:

```jsx
const Header = ({ hero }) => <h1>{ hero.title }</h1>;

const App = () => {
	const homeHero = useStoreSelector((state) => state.home.hero);
	const articleHero = useStoreSelector((state) => state.article.hero);

	return (
		<main>
			<Header hero={ homeHero } />
			<Header hero={ articleHero } />
		</main>
	);
};
```

Both callsites satisfy the same local child contract:

```txt
Header reads hero.title
```

but they map that contract to different canonical data roots:

```txt
home callsite:    Header.hero -> home.hero
article callsite: Header.hero -> article.hero
```

The current single-seed model cannot represent that. It must not pick one source
with last-wins behavior. Suppression is safer, but warning-only degraded output
is still not safe enough for review or CI.

## Target Outcome

Support path-polymorphic reusable components where:

- the child component's local prop contract is stable
- different callsites map that contract to different canonical data paths
- output is correct for Handlebars and PHP
- unsupported shapes fail closed with useful diagnostics
- debug metadata explains every callsite context and compiled path

Do not support shape-polymorphic output in this stream. Shape-polymorphism means
the same child prop name has different data shape and therefore may require
different output structure:

```jsx
<Output value={ title } /> // scalar
<Output value={ tags } />  // primitive list
```

Bare `{ value }` does not prove whether to emit scalar replacement or primitive
list wrapping. That remains a separate research gate.

## Strategy

Use a staged decision model:

1. Make unsafe ambiguity loud.
2. Prove same-file relative object-root context.
3. Harden object-root context for controls, multi-hop, and diagnostics.
4. Extend relative object context across the cross-file manifest.
5. Extend path-polymorphism to list-relative multi-source variants.
6. Use callsite-specific specialization only if relative contexts cannot solve
   the path-polymorphic cases.

This order deliberately avoids starting with component cloning/import rewrites.
List children already prove that relative child output can work under a parent
context. Object roots should be evaluated against that architecture first.

## Global Invariants

Every phase must preserve these constraints:

- Keep selector-specific logic in collector, visitor, or manifest handoff.
- Do not add selector-specific output behavior to controllers unless the change
  is a generic context/path-resolution facility.
- Do not rescue broken React component contracts.
- Do not infer intended prop names when the author passed the wrong prop.
- Do not silently drop selector-derived data.
- Do not produce last-wins behavior.
- Do not emit orphaned replace/list/control declarations.
- Preserve flat `templateVars` behavior.
- Preserve existing selector fixtures unless a fixture intentionally pins a
  safer fail-closed behavior.
- Keep `__seedAliasesByComponent` and `__crossFileManifest` internal and
  undocumented.

Supported reasoning:

```txt
selector path -> local binding -> JSX prop -> child prop binding -> child usage
```

Unsupported reasoning:

```txt
wrong prop name -> transform guesses intended prop
```

## Non-Goals

Do not implement these in this stream:

- shape-polymorphic specialization
- dynamic components
- HOCs
- spreads
- render props
- optional chaining
- generic React context tracing
- default import support
- namespace import support
- package or `node_modules` graph tracing
- filesystem/project wrapper for the manifest
- production bundler integration for generated variants

## Phase 0 - Safety Baseline And Ambiguity Hardening

### Goal

Make the current multi-source ambiguity fail loudly before adding new behavior.
This prevents warning-only empty output from masquerading as a successful
template build.

### Implementation Guidance

- Identify same-file and cross-file ambiguity paths where one child prop binding
  receives multiple canonical sources.
- Keep existing last-wins prevention.
- Change this specific ambiguity class from warning-only degraded output to a
  hard diagnostic by default, or require `strict: true` for this experiment in
  CI/review mode.
- Preserve machine-readable debug metadata for the competing sources.
- Do not change unrelated unsupported warnings unless they share the same
  partial-output risk.

Likely code areas:

- `store-selector-template-vars.js`
- `store-selector-cross-file.js`
- `diagnostics.js`
- same-file and cross-file selector tests

### Required Tests

- Same-file two object-root callsites for one child prop hard-error or require
  strict mode.
- Cross-file two parent files seeding the same child prop with different roots
  remains fail-closed.
- Existing scalar parent materialization tests still pass.
- Existing unsupported boundary tests still produce the expected diagnostics.
- Debug metadata includes every competing source path.

### Gate

Pass this phase only when:

- no ambiguous object-root multi-source case renders empty output silently
- no last-wins behavior exists
- `npm test` passes

## Phase 1 - Same-File Relative Object-Root Proof

### Goal

Prove that same-shape/different-root object props can render correctly without
component cloning.

The first proof should support:

```jsx
const Header = ({ hero }) => (
	<header>
		<h1>{ hero.title }</h1>
		{ hero.status === 'published' && <span>Published</span> }
	</header>
);

const App = () => {
	const homeHero = useStoreSelector((state) => state.home.hero);
	const articleHero = useStoreSelector((state) => state.article.hero);

	return (
		<main>
			<Header hero={ homeHero } />
			<Header hero={ articleHero } />
		</main>
	);
};
```

Expected semantics:

```txt
first Header  -> home.hero.title / home.hero.status
second Header -> article.hero.title / article.hero.status
```

### Output Strategy Decision

Choose and document one of these implementation strategies during this phase.

#### Option A: Context Block Wrapping

Parent callsites wrap child output in an object context:

```hbs
{{#with home.hero}}<h1>{{title}}</h1>{{/with}}
{{#with article.hero}}<h1>{{title}}</h1>{{/with}}
```

Risks:

- Handlebars `#with` has truthy/falsy behavior.
- We may need a required helper for strict object context.
- PHP needs equivalent context behavior.
- Context nesting with lists must be proven.

#### Option B: Build-Time Prefix Composition

Child discovery records local relative usage:

```txt
hero.title -> title relative to incoming hero root
```

Each callsite composes the relative path with its canonical root:

```txt
home.hero + title -> home.hero.title
article.hero + title -> article.hero.title
```

Risks:

- Must preserve child controls and nested member usage.
- May require a generic context/path-resolution extension in controller wiring.
- Must avoid selector-specific output branches.

### Recommendation For The First Spike

Try build-time prefix composition first if it can preserve current output
semantics. Fall back to an explicit object-context helper only if prefix
composition cannot support controls or nested context.

### Implementation Guidance

- Introduce a callsite context record for object-root props.
- Keep the child component root-agnostic.
- Discover child usage relative to the incoming prop root.
- Resolve replacement/control arguments through the callsite context.
- Ensure callsite identity is preserved before component/prop grouping erases
  source distinctions.
- Do not generate cloned component variants in this phase.
- Add debug metadata under the existing store selector metadata structure.

Suggested debug shape:

```json
{
  "callsiteContexts": [
    {
      "strategy": "relative-object-context",
      "component": "Header",
      "propName": "hero",
      "canonicalRoot": "home.hero",
      "localPaths": ["hero.title", "hero.status"],
      "compiledPaths": ["home.hero.title", "home.hero.status"]
    }
  ]
}
```

### Required Tests

- Same child used twice in one parent with different object roots.
- Child replacement through object root.
- Child control through object root.
- Replacement and control in the same child.
- Handlebars output.
- PHP output.
- Debug metadata maps callsite to context root and compiled paths.
- No `useStoreSelector` leaks.
- No `$$` leaks.
- No orphaned declarations.

### Gate

Pass this phase only when:

- same-file object-root path-polymorphism works for replacement and control
- ambiguity no longer degrades to empty output in the covered case
- no component cloning is required
- existing flat and selector tests remain green

## Phase 2 - Same-File Object Context Hardening

### Goal

Make same-file object-root context robust enough for real component trees.

### Required Behavior

- Multi-hop relay:

```jsx
<Shell hero={ homeHero } />
// Shell renders <Header hero={ hero } />
```

- Intermediate component both consumes and forwards:

```jsx
const Shell = ({ hero }) => (
	<section>
		<p>{ hero.subtitle }</p>
		<Header hero={ hero } />
	</section>
);
```

- Explicit child `templateVars` coexistence.
- Explicit child `templateVars` collision behavior.
- Conditional prop source fails closed:

```jsx
<Header hero={ condition ? homeHero : articleHero } />
```

- Wrong prop names remain unsupported.
- Props-object params remain supported:

```jsx
const Header = (props) => <h1>{ props.hero.title }</h1>;
```

- Bare param-as-prop remains unsupported for named JSX props:

```jsx
const Header = (hero) => <h1>{ hero.title }</h1>;
<Header hero={ homeHero } />
```

### Implementation Guidance

- Reuse the existing bounded fixed-point pass where possible.
- Track context through relay components without creating global per-component
  aliases.
- Distinguish confirmed callsite contexts from unsupported boundary metadata.
- Record unsupported metadata even when warnings are suppressed.
- Keep collision rules deterministic and documented.

Suggested collision policy:

- explicit child `templateVars` wins for exact duplicate local paths
- traced context is suppressed for that local path
- debug metadata records the shadowed trace
- incompatible explicit/traced declarations fail closed

### Required Tests

- Two-hop object-root propagation.
- Three-hop object-root propagation or a focused fixed-point depth test.
- Intermediate consumes and forwards.
- Props-object child param replacement and control.
- Conditional prop source diagnostic.
- Wrong prop name diagnostic.
- Explicit child `templateVars` exact-match shadow.
- Explicit child `templateVars` incompatible collision.
- `warnOnUnsupported: false` still records machine-readable metadata.

### Gate

Pass this phase only when:

- same-file object context works through relay chains
- unsupported boundaries are visible in metadata
- no partial transforms occur when provenance is lost
- no existing selector fixtures regress

## Phase 3 - Cross-File Relative Object Context

### Goal

Extend object-root path-polymorphism through the explicit cross-file manifest
without generated component variants.

### Required Behavior

Support:

```jsx
// Header.jsx
export const Header = ({ hero }) => <h1>{ hero.title }</h1>;

// HomePage.jsx
const hero = useStoreSelector((state) => state.home.hero);
return <Header hero={ hero } />;

// ArticlePage.jsx
const hero = useStoreSelector((state) => state.article.hero);
return <Header hero={ hero } />;
```

Expected output:

```txt
HomePage Header    -> home.hero.title
ArticlePage Header -> article.hero.title
```

### Implementation Guidance

- Extend the manifest to record callsite object contexts, not one global seed
  per child prop.
- Keep current unsupported import diagnostics.
- Do not add default import or namespace import support.
- Do not rewrite imports in this phase unless relative object context proves
  impossible without rewrites.
- Include per-file debug metadata with import edge, callsite edge, context root,
  and compiled child paths.
- Preserve existing ambiguous seed suppression for unsupported shapes.

### Required Tests

- Two parent files import the same child and use different object roots.
- Cross-file child replacement through object root.
- Cross-file child control through object root.
- Cross-file two-hop relay if feasible with current manifest.
- Cross-file diagnostic for conditional prop source.
- Cross-file debug metadata includes both parent callsites.
- Existing split `full-template-surface` fixture remains green.

### Gate

Pass this phase only when:

- same child can be reused across files with different canonical object roots
- output is correct for Handlebars and PHP
- manifest diagnostics remain fail-closed for unsupported imports
- no generated import/export variants are needed

## Phase 4 - List-Relative Multi-Source Path Variants

### Goal

Extend path-polymorphic handling beyond object roots into list-relative contexts.

This is still path-polymorphism, not shape-polymorphism. The local child shape is
stable, but the list root differs by callsite.

### Required Behavior

Support cases like:

```jsx
<ProductCard product={ featuredProduct } />
{ products.map((product) => <ProductCard product={ product } />) }
```

and:

```jsx
<ProductCard product={ homeProduct } />
<ProductCard product={ articleProduct } />
```

where `ProductCard` may read:

```jsx
product.name
product.badges.map((badge) => badge.label)
```

### Implementation Guidance

- Reuse the existing declaration relativity model from list children.
- Keep canonical source segments and declaration segments distinct.
- Test same child inside and outside `.map()`.
- Test same child used under two different list roots.
- Preserve PHP context depth.
- Do not infer primitive list rendering from bare `{ value }`.

### Required Tests

- Same child with list-item object props from different list roots.
- Same child inside and outside `.map()` fails closed or renders correctly.
- Nested list object-field prop such as `badges={ product.badges }`.
- Handlebars nested list output.
- PHP `$data_1` / `$data_2` output.
- No duplicate wrappers.
- No orphaned list declarations.

### Gate

Pass this phase only when:

- list-relative contexts remain depth-correct in Handlebars and PHP
- mixed list/non-list contexts do not produce partial output
- `full-template-surface` parity remains green

## Phase 5 - Conditional Specialization Fallback

### Goal

Only start this phase if relative object/list contexts cannot support required
path-polymorphic behavior.

### Required Pipeline

If specialization is needed, callsite identity must exist before traces are
grouped by component/prop.

Required pipeline shape:

```txt
collect callsite trace contexts
-> assign callsite/specialization IDs
-> build specialization records from complete alias environments
-> expose each specialization as a virtual component instance
-> run discovery and registry/controller processing per virtual instance
-> rewrite callsites to the selected instance before final output
```

### Specialization Key

Use a stable hash over the complete incoming trace context:

- target component file
- target component export/local name
- all incoming prop names
- all canonical source paths
- all declaration paths
- list depth
- declaration relativity
- shape metadata
- explicit child `templateVars` participating in the context

Readable generated names should be debug labels only:

```txt
Header__jsxTemplateVars_a1b2c3
```

### Cross-File Default If Needed

If specialization reaches cross-file mode, use this provisional rule:

- child files emit generated/exported variants
- parent files rewrite imports and JSX callsites to those variants
- production bundler behavior remains deferred

### Required Tests

- Same-file object-root path specialization if relative context failed.
- Multi-prop specialization.
- Multi-hop specialization.
- Cycle/recursion fail-closed behavior.
- Variant count hard bound.
- No orphaned generated variants.
- No orphaned generated imports.
- Handlebars and PHP parity.
- Debug metadata maps callsite to variant hash and compiled paths.

### Gate

Pass this phase only when:

- specialization is proven necessary by a documented relative-context blocker
- generated variants are bounded, deterministic, and debuggable
- no selector-specific output logic leaks into controllers

## Phase 6 - Shape-Polymorphism Research Gate

### Goal

Research only. Do not implement until path-polymorphism is stable.

### Problem

The same child prop name may receive different data shapes:

```jsx
<Output value={ title } />
<Output value={ tags } />
```

Bare child usage does not prove whether `value` is scalar or a primitive list:

```jsx
const Output = ({ value }) => <div>{ value }</div>;
```

### Required Evidence Before Implementation

One of:

- explicit flat shape hint
- visible `.map()` usage proving list shape
- future schema metadata
- PHP/data contract metadata
- another agreed compile-time shape signal

### Gate

Do not proceed unless reviewers agree on:

- how shape is proven
- what bare `{ value }` means without evidence
- how debug metadata explains the shape decision
- how PHP and Handlebars should render every supported shape

## Debug Metadata Requirements

Every implemented phase must expose enough metadata to explain:

- component name
- file name
- callsite identity
- prop name
- canonical root
- local child paths
- compiled paths
- strategy used: `relative-object-context`, `relative-list-context`, or
  `specialization`
- unsupported reason when skipped
- shadowed explicit `templateVars`
- source paths involved in ambiguity

For cross-file phases, include:

- import edge
- source filename
- target filename
- target export/component
- manifest diagnostic, if any

## Test Harness Criteria

Positive tests should assert all relevant outputs:

- transformed code contains no live `useStoreSelector`
- transformed code contains no `$$`
- no orphaned `getLanguageReplace`
- no orphaned `getLanguageList`
- no orphaned `getLanguageControl`
- Handlebars output
- PHP output
- debug metadata

Negative tests should assert:

- diagnostic type/message
- no partial output when provenance is lost
- unsupported metadata is recorded even when warnings are suppressed
- no synthesized declaration for unsupported expressions

Run for implementation phases:

```sh
npm test
npm run test:coverage
npm pack --dry-run
```

## Review Checkpoints

Request reviewer feedback after:

1. Phase 0 ambiguity hardening.
2. Phase 1 same-file relative object-root proof.
3. Phase 3 cross-file relative object context.
4. Phase 4 list-relative multi-source variants.
5. Any decision to enter Phase 5 specialization.

Each review handoff should include:

- exact scope implemented
- examples that now work
- examples still unsupported
- diagnostics behavior
- Handlebars and PHP verification
- debug metadata sample
- known risks before the next phase

## Success Criteria For This Stream

The stream succeeds if path-polymorphic reusable components work without
component cloning for the core object-root cases:

```jsx
<Header hero={ homeHero } />
<Header hero={ articleHero } />
```

and, later:

```jsx
<ProductCard product={ homeProduct } />
<ProductCard product={ articleProduct } />
```

while preserving:

- correct Handlebars output
- correct PHP output
- no last-wins behavior
- no silent empty output
- stable debug metadata
- existing flat API behavior

If relative contexts cannot meet those gates, the stream should produce a
documented blocker and then move deliberately into the conditional
specialization phase.
