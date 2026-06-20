# Store Selector Multi-Source Path Implementation Plan

## Status

Active implementation plan for the next store-selector experiment stream.

Current implementation status:

- **Completed in the first implementation slice:**
  - Phase 0 safety baseline now hard-errors unsupported same-file object-root
    ambiguity for covered component forms. Conditional object-root expressions
    and other unsupported expressions that would need descriptor context are
    rejected before they can render empty output.
  - Phase 0.5 descriptor composition is proven with focused Handlebars and PHP
    tests for replacement, control, one-hop relay, and descriptor containment.
  - Phase 1 same-file object-root path-polymorphism is implemented for
    destructured child props and renamed props-object parameters. Covered
    multi-source object-root callsites are routed into descriptor composition;
    unsupported ambiguity still fails closed.
  - A narrow Phase 2 same-file hardening slice is implemented for multi-hop
    relay and intermediate components that both consume and forward an object
    root. This is not the full Phase 2 surface; broader relay, mixed-context,
    and future cross-file relay diagnostics remain review gates as the stream
    expands.
  - A narrow cross-file object-root slice is implemented for direct relative
    named imports: two parent files can pass different object roots to one child
    component, the child transforms with relative dynamic-root discovery, and
    each parent injects its own template-root descriptor callsite context.
    Replacement and control output are covered in Handlebars and PHP.
  - Cross-file review/debug metadata for the direct object-root slice is
    exposed through transform metadata, including per-file callsite contexts,
    child relative-discovery records, dynamic-root props, import edges, seed
    edges, diagnostics, and root compiled-path hints.
  - Dynamic root containment is enforced at transform time for covered same-file
    descriptor paths: bare dynamic-root rendering is rejected before codegen.
  - Minimal dynamic-root debug metadata is exposed for review mode, including
    `dynamicRootAliases`, component-local `dynamicRootProps`, and
    `dynamicRootPropsByComponent`.
- **Still pending:**
  - Cross-file relay through intermediate files.
  - Full cross-file debug metadata for relay/list-relative cases and
    child-suffix compiled paths beyond the direct object-root root-path hints.
  - List-relative multi-source variants.
  - Shape-polymorphic specialization research.
- **Later residuals to revisit:**
  - Conditional object-root expressions currently fail closed even when every
    branch resolves to the same canonical root. This is intentionally safe for
    now. If real usage hits it, dedupe selector-derived source paths before
    deciding whether an unsupported conditional must hard-error.
  - `createTemplateRootDescriptor(segments, declarationSegments?)` currently
    receives identical arguments from object-root descriptor injection. Keep the
    second argument for the list-relative phase, where canonical segments and
    declaration-relative segments are expected to diverge.

The completed slice uses internal template-root descriptors. Parent callsites
pass descriptors for traced object-root props, and child components compose
replacement/control paths from those descriptors at template render time. This
keeps one authored child component and avoids component cloning for the covered
same-file path-polymorphic cases.

Descriptor helpers are now part of the template runtime contract for this
experiment. Generated descriptor output may call:

```txt
createTemplateRootDescriptor(segments, declarationSegments?)
getTemplateRootPathArg(descriptor, suffixSegments)
```

The plugin import injection must provide those helpers whenever descriptor
composition is generated. Custom language integrations must tolerate composed
path args produced by `getTemplateRootPathArg`. Descriptors may flow through
traced relay props, but they must never reach rendered output directly; covered
bare-root render paths fail at transform time.

Background research:
[store-selector-multi-source-path-research.md](./store-selector-multi-source-path-research.md).

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
2. Spike descriptor composition in isolation.
3. Prove same-file relative object-root context.
4. Harden object-root context for controls, multi-hop, and diagnostics.
5. Extend relative object context across the cross-file manifest.
6. Extend path-polymorphism to list-relative multi-source variants.
7. Use callsite-specific specialization only if relative contexts cannot solve
   the path-polymorphic cases.

This order deliberately avoids starting with component cloning/import rewrites.
The key reason to try descriptor composition first is cross-file cost asymmetry:
component specialization needs generated variants plus import/callsite rewrites,
while descriptor composition can keep the authored child component singular and
avoid generated module exports. Existing list handling proves that relative
declarations are viable in the output model, but object-root descriptor
composition is a distinct transform mechanic that must be proven directly.

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
- Do not let compiler-internal root descriptors reach rendered output. Bare
  object-root descriptor rendering must fail closed, not produce `[object
  Object]` or any other runtime descriptor string.
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
- broad spread tracing beyond static object-literal scalar spreads
- render props
- optional call/data-flow tracing beyond static optional member chains
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
  hard diagnostic by default.
- Use a dedicated diagnostic kind such as
  `object-root-multi-source-ambiguity` so this change is surgical. It should not
  hard-error scalar member materialization cases that already render correctly.
- Preserve machine-readable debug metadata for the competing sources.
- Do not change unrelated unsupported warnings unless they share the same
  partial-output risk.

Likely code areas:

- `store-selector-template-vars.js`
- `store-selector-cross-file.js`
- `diagnostics.js`
- same-file and cross-file selector tests

### Required Tests

- Same-file two object-root callsites for one child prop hard-error by default.
- Cross-file two parent files seeding the same child prop with different roots
  remains fail-closed.
- Existing scalar parent materialization tests still pass.
- Scalar member multi-source cases that parent-materialize correctly do not
  trigger the object-root ambiguity diagnostic.
- Existing unsupported boundary tests still produce the expected diagnostics.
- Debug metadata includes every competing source path.

### Gate

Pass this phase only when:

- no ambiguous object-root multi-source case renders empty output silently
- no last-wins behavior exists
- `npm test` passes

## Phase 0.5 - Descriptor Composition Spike

### Goal

Validate the transform shape that underpins Phases 1 through 4 before building
the full feature.

This phase should answer whether a parent can pass a compiler-internal root
descriptor and a child can compose member paths from that descriptor during the
template render pass.

### Core Mechanic

Today, unsupported object-root callsites may effectively pass a rendered
replacement string:

```txt
hero={{home.hero}}
```

That cannot support child member access:

```jsx
hero.title
```

because the child receives a rendered string, not path metadata.

The intended mechanic is:

```txt
parent passes descriptor: hero -> { kind: 'templateRoot', segments: ['home', 'hero'] }
child composes:           hero.title -> ['home', 'hero', 'title']
```

This is not pure build-time string rewriting. It is template-render-time
descriptor composition: the child function remains singular, but its prop value
is a compiler-internal descriptor that the transform/runtime helpers can use to
resolve replacement and control paths.

This means Phase 1 must explicitly prevent the current fallback shape:

```txt
hero={{home.hero}}
```

from being used for traced object-root props. A rendered replacement string does
not contain the path metadata needed by the child.

### Spike Scope

Hand-write or minimally transform the intended output shape for:

```jsx
const Header = ({ hero }) => (
	<header>
		<h1>{ hero.title }</h1>
		{ hero.status === 'published' && <span>Published</span> }
	</header>
);
```

with two parent callsites:

```jsx
<Header hero={ homeHero } />
<Header hero={ articleHero } />
```

The spike should prove:

- descriptor values can be passed as props through the current render harness
- child replacement paths can compose from descriptor segments
- child control paths can compose from descriptor segments
- descriptors can relay through one intermediate component
- the parent does not materialize traced object-root props as replacement strings
- bare descriptor rendering fails closed:

```jsx
const Header = ({ hero }) => <h1>{ hero }</h1>;
```

should not produce `[object Object]`, `{{home.hero}}`, or silent empty output.

### Implementation Guidance

- Prefer a focused test helper or temporary spike test over broad production
  wiring.
- Do not add final public API or broad transform behavior in this phase.
- Keep descriptors internal and unobservable in user-authored output.
- Define the exact descriptor shape before writing production transform code.
  Initial candidate:

```js
{
	kind: 'templateRoot',
	segments: ['home', 'hero'],
	declarationSegments: ['home', 'hero'],
}
```

- Confirm `getLanguageReplace` and `getLanguageControl` can already consume the
  composed segment arrays for Handlebars and PHP.
- If descriptor composition requires controller changes, those changes must be
  generic path/context support, not store-selector-specific output logic.
- Treat the intended extension point as the existing parent JSX callsite
  injection model, analogous to `__context__` injection for lists: the parent
  injects a root descriptor, and child-relative path resolution consumes it.
- Prefer generic `resolveSegments` / `pathResolver` integration for composing
  descriptor segments with member paths. Controllers should continue to receive
  ordinary structured path args after resolution.

### Required Tests

- Descriptor replacement composition works for Handlebars.
- Descriptor replacement composition works for PHP.
- Descriptor control composition works for Handlebars.
- Descriptor control composition works for PHP.
- One-hop relay preserves descriptor segments.
- A traced object-root prop is not materialized as a replacement string before
  entering the child.
- Bare descriptor rendering fails closed.

### Gate

Pass this phase only when:

- the descriptor composition mechanic is proven in isolation
- descriptor containment is enforced
- no component cloning/import rewriting is needed for the spike
- the findings are folded back into this plan before Phase 1 implementation

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

### Output Strategy

Phase 1 should use descriptor composition if Phase 0.5 proves it. Context block
wrapping is a last resort, not a co-equal option.

#### Preferred: Template-Render-Time Descriptor Composition

The parent passes an internal root descriptor instead of materializing the object
prop as a rendered replacement string:

```txt
hero -> { kind: 'templateRoot', segments: ['home', 'hero'] }
```

Child discovery records local relative usage:

```txt
hero.title -> title relative to incoming hero root
```

The child composes each template path from the descriptor:

```txt
home.hero descriptor + title -> home.hero.title
article.hero descriptor + title -> article.hero.title
```

Risks:

- descriptor values must never reach rendered output directly
- replacement, control, and nested member usage must all compose correctly
- descriptor relay through intermediate components must preserve segments
- generic path/context wiring may be needed, but selector-specific controller
  output must be avoided

#### Last Resort: Context Block Wrapping

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
- It changes output semantics: if the object is falsy, a `#with` block can omit
  wrapper HTML that absolute path replacement would otherwise render as empty
  content.
- There is no current PHP object-context equivalent.

### Recommendation For The First Spike

Use descriptor composition first. Fall back to explicit object-context helpers
only if descriptor composition cannot support controls, nested objects, or
relay.

### Implementation Guidance

- Introduce a callsite context record for object-root props.
- Keep the child component root-agnostic.
- Discover child usage relative to the incoming prop root.
- Pass an internal root descriptor for traced object-root props.
- Resolve replacement/control arguments by composing member segments from that
  descriptor.
- Anchor this in the parent JSX callsite injection path, not in global
  per-component seed state. The model is:

```txt
parent JSX callsite injects descriptor -> child pathResolver composes member paths
```

- Fail closed if a descriptor is rendered bare or crosses an unsupported sink.
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
- Do not rely on a global `seedAliasesByComponent` entry for multi-source
  object-root context. That is the model that loses callsite identity.
- Track a callsite-edge environment through each JSX component edge:

```txt
App -> Shell:    hero -> { kind: 'templateRoot', segments: ['home', 'hero'] }
Shell -> Header: hero -> { kind: 'templateRoot', segments: ['home', 'hero'] }
```

- Relay components inherit and forward the same object-root descriptor. They do
  not re-root the descriptor at the local prop name. In the example above,
  `Shell.hero` and `Header.hero` both resolve against `home.hero`.
- Treat each edge environment as the unit of propagation. A component can be
  visited multiple times with different incoming environments without collapsing
  them into one global component binding.
- Deduplicate only identical environments: same target component, same prop
  bundle, same canonical segments, same declaration segments, and same inherited
  context metadata.
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
- Same relay component used with two different object roots in one parent.
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

Same-file descriptor success does not imply cross-file readiness. The current
cross-file manifest still emits one seed set per child component and suppresses
ambiguous multi-parent seeds. Phase 3 must introduce the callsite-context model
below before cross-file multi-source object roots can be treated as supported.

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

- Extend the manifest to record callsite edge environments, not one global seed
  per child prop.
- Conceptually replace the single-seed model with two manifest views:

```txt
callsiteContextsByFile
  parent-file callsite edges and canonical object roots

childRelativeDiscoveryByFile
  child-file relative paths discovered without one global canonical seed
```

- Parent-side manifest records should include:
  - source file
  - source component
  - target file
  - target component/export
  - JSX local tag/import name
  - prop name
  - descriptor shape
  - canonical segments
  - declaration segments
  - unsupported reason, if the edge is skipped
- Child-side manifest input should expose incoming environments so the child can
  discover relative usage against each environment without guessing a global
  component seed.
- Debug metadata should connect:

```txt
import edge -> JSX callsite edge -> incoming descriptor -> child local path -> compiled path
```

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
- Manifest debug metadata includes parent edge and child incoming environment.
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

### Sub-Phase 4A - List Item Props From Different List Roots

Support the same child component under two different list roots when both
callsites are list-item contexts:

```jsx
homeProducts.map((product) => <ProductCard product={ product } />)
articleProducts.map((product) => <ProductCard product={ product } />)
```

Expected behavior:

- each callsite preserves its own list root
- child fields such as `product.name` render relative to the active list item
- Handlebars and PHP maintain correct list depth

### Sub-Phase 4B - Same Child Inside And Outside `.map()`

Handle or deliberately reject mixed contexts:

```jsx
<ProductCard product={ featuredProduct } />
{ products.map((product) => <ProductCard product={ product } />) }
```

Intended first behavior: fail closed unless descriptor composition can prove
both the object-root callsite and list-item callsite render correctly without
partial output. Do not allow the non-list source to leak into the list callsite,
and do not allow empty list cards without a hard diagnostic.

### Sub-Phase 4C - Nested List Object Fields

Support list-context object-field props:

```jsx
products.map((product) => (
	<ProductCard badges={ product.badges } />
))
```

where `ProductCard` may render:

```jsx
badges.map((badge) => <Badge badge={ badge } />)
```

Expected behavior:

- `product.badges` becomes a list-relative descriptor
- nested `badge.label` uses the nested list context
- PHP output uses the correct `$data_1` / `$data_2` depth

### Sub-Phase 4D - Primitive List Rendering Remains Deferred

Do not infer primitive list output from bare render:

```jsx
const Tags = ({ tags }) => <div>{ tags }</div>;
```

This is shape-polymorphism unless there is explicit shape evidence. It belongs
to Phase 6.

### Implementation Guidance

- Reuse the existing declaration relativity model from list children.
- Keep canonical source segments and declaration segments distinct.
- Implement 4A before 4B.
- Treat mixed list/non-list contexts as hard errors until correct rendering is
  proven.
- Test same child used under two different list roots before nested list fields.
- Preserve PHP context depth.
- Do not infer primitive list rendering from bare `{ value }`.

### Required Tests

- Same child with list-item object props from different list roots.
- Same child inside and outside `.map()` hard-errors until supported, or renders
  correctly with no partial output.
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
