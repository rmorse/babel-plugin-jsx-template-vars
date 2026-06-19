# Store Selector Multi-Source Path Research

## Status

Research and investigation note for reviewer feedback.

This document is not an implementation plan yet. It explores a limitation in
the current experimental store-selector hierarchy tracing model and compares
possible next architecture directions.

The immediate problem is multiple parent callsites using the same child
component with different canonical data paths. The first version of this note
recommended callsite-specific component specialization. Reviewer feedback
identified a lighter option that better matches the existing list-context
machinery: root-relative child emission with a per-callsite object context.

A related, harder problem is shape-polymorphic props, where the same child prop
name may receive a scalar in one callsite and a list or object in another.

Both problems matter because the long-term goal of the store-selector
experiment is to let authors write ordinary React component trees while the
transform infers as much template data shape as it safely can.

## Current Context

The store-selector experiment currently supports a role-neutral selector API:

```jsx
import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

const App = () => {
	const hero = useStoreSelector((state) => state.hero);
	return <Header hero={ hero } />;
};

const Header = ({ hero }) => <h1>{ hero.title }</h1>;
```

The transform can trace:

```txt
state.hero -> hero binding -> Header.hero prop -> Header hero binding -> hero.title usage
```

and synthesize the equivalent flat template path:

```js
Header.templateVars = [ 'hero.title' ];
```

The current implementation supports:

- same-file auto-seeding through a bounded fixed-point pass
- cross-file tracing through an explicit manifest/prepass
- object-root child props such as `<Header hero={ hero } />`
- list-item child props such as `<ProductCard product={ product } />`
- list-context object-field props such as `badges={ product.badges }`
- nested list output for Handlebars and PHP
- no-child-`templateVars` parity with `full-template-surface`
- diagnostics for unsupported import and child-boundary shapes

The cross-file manifest currently suppresses ambiguous seeds. If two different
parent files try to seed the same child component prop with different canonical
paths, the manifest records ambiguity and does not emit a seed for that child
binding. This prevents last-wins output bugs, but it is too conservative for a
valid reusable-component pattern.

Important current-state correction: unsupported selector flows are not always
hard failures. `diagnostics.unsupported()` warns by default and throws only when
`strict: true` is enabled. In some ambiguous same-file cases, the transform can
therefore continue and produce degraded empty output rather than fail closed.
That behavior should not be described as safe. The safe interim policy should be
to make this specific multi-source ambiguity a hard error until a correct
architecture lands, or require `strict: true` for this experiment in CI.

## The Current Ambiguity

Consider:

```jsx
// Header.jsx
export const Header = ({ hero }) => <h1>{ hero.title }</h1>;
```

and two parent contexts:

```jsx
// HomePage.jsx
import { Header } from './Header.jsx';

const HomePage = () => {
	const hero = useStoreSelector((state) => state.home.hero);
	return <Header hero={ hero } />;
};
```

```jsx
// ArticlePage.jsx
import { Header } from './Header.jsx';

const ArticlePage = () => {
	const hero = useStoreSelector((state) => state.article.hero);
	return <Header hero={ hero } />;
};
```

The local child contract is the same in both cases:

```txt
Header receives prop hero
Header reads hero.title
```

The canonical source path differs:

```txt
HomePage:    Header.hero -> home.hero
ArticlePage: Header.hero -> article.hero
```

The current single-seed model tries to describe `Header.hero` with one
canonical source. That cannot safely represent both callsites. Picking one would
be a last-wins bug. Suppressing the seed avoids that particular bug, but warning
and continuing can still produce empty child output. This is a degraded-output
failure, not a fully safe fail-closed state.

This limitation is not cross-file-only. The same ambiguity exists in one file:

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

The underlying limitation is global per component binding:

```txt
Header.hero -> one canonical source
```

but reusable components need per-callsite context:

```txt
Home callsite:    Header.hero -> home.hero
Article callsite: Header.hero -> article.hero
```

Cross-file reuse makes this more visible, but same-file multi-callsite reuse has
the same root cause.

## Important Distinction: Path Difference Vs Shape Difference

There are two different problems here.

### Same Shape, Different Canonical Path

This is the immediate problem.

```jsx
<Header hero={ homeHero } />
<Header hero={ articleHero } />
```

where `Header` consistently expects:

```jsx
hero.title
hero.status
```

This is not a user error. The child component has one stable local contract, and
different parent callsites map that contract to different locations in the
global server data object.

The transform should eventually support this.

Scalar member props are less urgent because some parent-side materialization
already works today:

```jsx
<Card name={ featured.name } />
<Card name={ secondary.name } />
```

can render distinct scalar replacements at the parent callsites. The hard case
is object-root child usage and role inference inside the child:

```jsx
const Header = ({ hero }) => (
	<header>
		<h1>{ hero.title }</h1>
		{ hero.status === 'published' && <span>Published</span> }
	</header>
);
```

That is where the child needs a per-callsite object context rather than a
single global `Header.hero` seed.

### Same Prop Name, Different Shape

This is a harder adjacent problem.

```jsx
const Output = ({ thevar }) => <div>{ thevar }</div>;
```

Callsite A passes a scalar:

```jsx
const title = useStoreSelector((state) => state.title);
return <Output thevar={ title } />;
```

Callsite B passes a list:

```jsx
const items = useStoreSelector((state) => state.items);
return <Output thevar={ items } />;
```

The local child usage is identical:

```jsx
{ thevar }
```

but the source shapes differ:

```txt
title -> scalar/string
items -> list/array
```

This is shape-polymorphism. It is not solved by path-polymorphic handling alone,
because the generated output form may differ:

```hbs
{{title}}
```

versus:

```hbs
{{#items}}{{.}}{{/items}}
```

or equivalent PHP output.

The bare child usage `{ thevar }` does not prove which output form is intended.
The transform would need shape evidence from the callsite, a selector-derived
shape hint, visible `.map()` usage, flat shape hints, a schema, or another
explicit signal.

## Current Recommendation

Do not start with component cloning.

First evaluate root-relative object emission with a per-callsite object context.
This is closer to how list-item children already work:

```txt
parent supplies context root -> child emits relative paths inside that context
```

Keep the current ambiguous-seed suppression in place, but do not describe it as
safe unless the ambiguity hard-errors. The current default warning-only behavior
can produce empty output, so this ambiguity should become a hard error by
default or require `strict: true` until relative object-context handling is
implemented.

Callsite-specific specialization remains a candidate, but it should not be the
first path-polymorphism implementation unless the lighter relative-context model
fails. Specialization is more clearly load-bearing for shape-polymorphism, where
the child output structure itself may differ between callsites.

In short:

```txt
path-polymorphic reuse:   evaluate relative object contexts first
shape-polymorphic reuse:  likely needs specialization or hard failure
```

## Candidate Direction A: Relative Object-Root Emission

The lighter architecture is to keep the child root-agnostic and let the parent
callsite supply the object root as context.

For lists, the project already emits child-relative paths under a parent list
context. A child such as:

```jsx
const Badge = ({ badge }) => <span>{ badge.label }</span>;
```

inside:

```jsx
product.badges.map((badge) => <Badge badge={ badge } />)
```

can output relative fields inside the list context:

```hbs
{{#badges}}<span>{{label}}</span>{{/badges}}
```

The same idea may apply to object roots:

```jsx
<Header hero={ homeHero } />
<Header hero={ articleHero } />
```

where:

```jsx
const Header = ({ hero }) => <h1>{ hero.title }</h1>;
```

could compile as object-context-wrapped callsites:

```hbs
{{#with home.hero}}<h1>{{title}}</h1>{{/with}}
{{#with article.hero}}<h1>{{title}}</h1>{{/with}}
```

or through equivalent build-time path-prefix composition:

```txt
Header local hero.title + callsite root home.hero -> home.hero.title
Header local hero.title + callsite root article.hero -> article.hero.title
```

The important difference from specialization is that the child source does not
need to be cloned for path-polymorphism. The child can emit relative paths, and
the parent callsite supplies the root context.

### Why This Fits The Existing Architecture

This direction is consistent with the existing list machinery:

- list output already distinguishes canonical source paths from relative child
  declarations
- PHP output already tracks context depth through `$data_1`, `$data_2`, and so
  on
- nested list child components already prove that one authored child can render
  correctly under different inherited list contexts
- the registry already carries structured path metadata, not only strings

The new work would be object-context support rather than full component cloning.

### Possible Output Models

There are two possible implementation models.

#### Context Block Wrapping

The parent wraps the child output in an object context:

```hbs
{{#with home.hero}}<h1>{{title}}</h1>{{/with}}
```

Open questions:

- Which Handlebars helper should provide strict object context behavior?
- Does `#with` introduce unwanted truthy/falsy behavior when the object is
  absent?
- Do we need a project-provided helper for object context, similar to the
  planned strict equality helper?
- What is the exact PHP equivalent?
- Can object context nesting compose cleanly with list context nesting?

#### Build-Time Prefix Composition

The child continues to discover relative usage:

```txt
hero.title -> title relative to incoming hero root
```

The parent/callsite metadata composes that relative path with each canonical
root:

```txt
home.hero + title -> home.hero.title
article.hero + title -> article.hero.title
```

Open questions:

- Can this be implemented without leaking selector-specific behavior into
  controllers?
- Does it work when the child uses the prop in control expressions?
- Does it work when the child passes the object onward to another child?
- Does it work for nested object fields inside list contexts?
- How does it interact with explicit child `templateVars`?

### Immediate Interim Policy

Until this is implemented, multi-source object-root ambiguity should fail
loudly. Warning-only degraded output is not good enough for this case because it
looks like a successful template build.

Recommended interim:

- hard-error on ambiguous same-file or cross-file object-root seed groups
- keep current last-wins prevention
- keep debug metadata explaining the competing sources
- allow warning-only mode only for explicitly non-authoritative exploratory
  runs, not for review/CI gates

## Candidate Direction B: Callsite-Specific Component Specialization

Component specialization remains a valid candidate, especially if relative
object contexts cannot support all required path-polymorphic cases.

Conceptually:

```jsx
<Header hero={ homeHero } />
<Header hero={ articleHero } />
```

would behave as though the transform created internal variants:

```txt
Header__jsxTemplateVars_a1b2c3:
  local hero.title -> canonical home.hero.title

Header__jsxTemplateVars_d4e5f6:
  local hero.title -> canonical article.hero.title
```

The source component remains reusable. The compiled template output gains
callsite-specific variants where needed.

This is a compiler specialization model:

```txt
one authored component + multiple incoming trace contexts -> multiple compiled variants
```

### When Specialization Is Actually Load-Bearing

Specialization may still be necessary when the component's output structure
differs by callsite shape.

For example:

```jsx
const Output = ({ value }) => <div>{ value }</div>;
```

where one callsite passes a scalar and another passes a primitive list. A
relative object context does not decide whether the child should emit:

```hbs
{{value}}
```

or:

```hbs
{{#value}}{{.}}{{/value}}
```

That is shape-polymorphism, not merely path-polymorphism.

## Alternative Architectures Considered

### 1. Keep Suppressing Ambiguous Seeds

This is the current cross-file manifest behavior, but same-file ambiguity can
still degrade to warning-only empty output unless `strict: true` is enabled.

Benefits:

- simple
- prevents last-wins bugs
- preserves current registry/controller assumptions

Costs:

- not fully safe unless it hard-errors
- blocks valid reusable child components
- limits cross-file tracing usefulness
- pushes authors back toward manual child declarations or duplicated components

Recommendation: keep suppression but make this ambiguity fail loudly until a
correct path-polymorphism model lands.

### 2. Relative Object Contexts

The child emits relative paths and the parent supplies an object root per
callsite.

Benefits:

- directly analogous to current list-context output
- avoids component cloning
- avoids cross-file generated exports/import rewrites for path-polymorphism
- can keep authored components unchanged
- may preserve the registry/controller boundary better than specialization

Costs:

- object context semantics need careful language support
- Handlebars may need a helper if `#with` truthiness is not acceptable
- PHP context-depth behavior must be proven
- controls, nested lists, and multi-hop object context need explicit tests
- may not solve shape-polymorphism

Recommendation: prototype this before specialization.

### 3. Runtime Or Template Binding Maps

The transform could pass a binding map into the child:

```txt
Header receives:
  hero -> home.hero
```

Then child output resolves `hero.title` through the active binding map.

Benefits:

- avoids cloning components
- can represent different callsite paths dynamically
- can be resolved at build time if the binding map is known during template
  rendering

Costs:

- more invasive than current architecture
- may leak selector-specific concepts into output generation
- complicates debugging
- risks making controllers aware of store-selector semantics

Recommendation: keep as a fallback idea. If the map is resolved at build time,
static PHP/Handlebars output is not the main blocker; boundary cleanliness is.

### 4. Parent-Side Materialization

The parent could pre-render scalar values before passing them to the child.

For simple replacement-only props:

```jsx
<Header title={ hero.title } />
```

the parent can sometimes pass a template replacement string directly.

Benefits:

- already useful as a fail-closed fallback in some cases
- avoids child specialization for simple scalar rendering

Costs:

- insufficient for child controls
- insufficient for child list maps
- insufficient for member access on object props
- does not solve the general reusable-component problem

Recommendation: keep as a fallback, not the main architecture.

### 5. Callsite-Specific Specialization

Benefits:

- preserves normal React authoring style
- supports reusable child components with different canonical data roots
- keeps registry/controller output mostly generic
- makes debug metadata explicit per callsite
- aligns with the existing seed/context model

Costs:

- requires AST cloning or generated component variants
- requires parent callsites to be rewritten to the correct variant
- requires deterministic specialization keys
- increases generated code size
- needs cycle and recursion safeguards
- cross-file specialization needs coordination between manifest and per-file
  transform

Recommendation: do not start here for path-polymorphism. Keep it as the heavier
option if relative object contexts are insufficient, and as the likely model for
shape-polymorphism.

## Specialization Pipeline Requirements

If specialization survives the relative-context comparison, the implementation
must define a concrete phase order before any coding.

The important point is that callsite identity must exist before traces are
grouped by component/prop. Cloning a component after ambiguity has already been
collapsed does not solve the problem.

Required pipeline shape:

```txt
collect callsite trace contexts
-> assign callsite/specialization IDs
-> build specialization records from complete alias environments
-> expose each specialization as a virtual component instance
-> run discovery and registry/controller processing per virtual instance
-> rewrite callsites to the selected instance before final output
```

This should be treated as a virtual component model, not as late AST cloning.

Cross-file specialization also needs a module-boundary rule before coding. A
reasonable first rule, if needed, is:

- child files emit generated/exported variants
- parent files rewrite imports and JSX callsites to those variants
- bundler integration remains deferred

This rule is intentionally heavier than relative object contexts, which is why
relative object contexts should be evaluated first.

## What The Specialization Key Must Include

A specialization should not be keyed only by component name.

The key should be a stable hash over the complete incoming alias environment,
with a readable prefix only for debugging. It should not use readable source-path
names such as `Header__homeHero` as identity.

The hashed identity needs to include:

- target component file
- target component export/local name
- every incoming prop name
- every incoming canonical source path
- every incoming declaration path, especially for list-relative child contexts
- whether each prop is object-root, scalar, list-item, or list-context
  object-field
- inherited list context depth
- any shape information that affects output role
- explicit child `templateVars` that coexist with the trace context
- role-affecting metadata, if shape inference starts depending on it

For multi-hop chains, the key should be based on the normalized incoming trace
context at the specialized component boundary, not on whichever parent happened
to relay the prop most recently. For example:

```txt
App.homeHero -> Shell.hero -> Header.hero
```

and:

```txt
App.homeHero -> Layout.hero -> Header.hero
```

may be dedupable only if the resulting `Header.hero` incoming context is
identical, including canonical path, declaration relativity, list depth, and
shape metadata.

For list-context variants, same canonical segments are not enough. Two contexts
that share a source path but differ in inherited list depth or relative
declaration segments must remain distinct unless a test proves they generate
identical output.

For example:

```json
{
  "component": "Header",
  "file": "Header.jsx",
  "props": {
    "hero": {
      "canonicalPath": "home.hero",
      "declarationPath": "home.hero",
      "shape": "object"
    }
  }
}
```

For list-item contexts:

```json
{
  "component": "ProductCard",
  "file": "ProductCard.jsx",
  "props": {
    "product": {
      "canonicalPath": "catalog.products[]",
      "declarationPath": "",
      "shape": "list-item"
    }
  }
}
```

The `declarationPath` distinction matters because a list-item child should emit
relative declarations such as `name`, not re-wrap `catalog.products[].name`.

## Same-File Relative Object-Context Proof

The first implementation proof should not be specialization. It should test
whether relative object-root emission can solve the same motivating case without
clones.

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

Expected Handlebars output:

```hbs
<main><h1>{{home.hero.title}}</h1><h1>{{article.hero.title}}</h1></main>
```

or, if the implementation uses explicit object context blocks:

```hbs
<main>{{#with home.hero}}<h1>{{title}}</h1>{{/with}}{{#with article.hero}}<h1>{{title}}</h1>{{/with}}</main>
```

Expected PHP output should similarly render:

```php
$data['home']['hero']['title']
$data['article']['hero']['title']
```

High-level transform idea:

1. Discover both callsite contexts.
2. Keep the child root-agnostic.
3. Discover child-relative usage such as `title`.
4. Compose or wrap each callsite with its canonical root.
5. Preserve correct Handlebars and PHP output.

The child source code should remain the same from the author's perspective.

If this cannot support controls, nested objects, list contexts, or multi-hop
propagation, document the exact reason and reconsider specialization.

## Same-File Specialization Sketch

If specialization is still needed after the relative object-context proof, the
same example would become a virtual-component test:

```txt
Header + { hero -> home.hero }    -> Header__jsxTemplateVars_<hashA>
Header + { hero -> article.hero } -> Header__jsxTemplateVars_<hashB>
```

The parent callsites would be rewritten to the matching virtual component
instances before the final controller pass.

This sketch is deliberately second in priority.

## Cross-File Specialization Sketch

Cross-file support is more complex because the parent and child transforms run
on separate files.

The manifest may need to emit:

```json
{
  "specializationsByFile": {
    "Header.jsx": [
      {
        "id": "Header__jsxTemplateVars_a1b2c3",
        "baseComponent": "Header",
        "incomingAliases": [
          {
            "localName": "hero",
            "canonicalPath": "home.hero",
            "declarationPath": "home.hero"
          }
        ]
      },
      {
        "id": "Header__jsxTemplateVars_d4e5f6",
        "baseComponent": "Header",
        "incomingAliases": [
          {
            "localName": "hero",
            "canonicalPath": "article.hero",
            "declarationPath": "article.hero"
          }
        ]
      }
    ]
  },
  "callsiteRewritesByFile": {
    "HomePage.jsx": [
      {
        "from": "Header",
        "to": "Header__jsxTemplateVars_a1b2c3",
        "sourcePath": "home.hero"
      }
    ],
    "ArticlePage.jsx": [
      {
        "from": "Header",
        "to": "Header__jsxTemplateVars_d4e5f6",
        "sourcePath": "article.hero"
      }
    ]
  }
}
```

This should not be implemented until the same-file relative object-context proof
has been evaluated. If specialization is still needed, open questions include:

- Should specialized variants be emitted in the child file or parent file?
- Should specialized variants be exported?
- How should parent imports be rewritten in transformed test modules?
- How does this fit production bundlers?
- Can the manifest assign stable specialization IDs without inspecting output
  code?

For the current test harness, child-file variants plus parent callsite rewrites
may be enough. For real package use, this likely needs more thought.

## Recursion And Cycle Policy

Any specialization model needs an explicit recursion policy before
implementation.

Recommended first-slice policy:

- recursive components are unsupported for specialization
- cyclic component graphs must fail closed or skip specialization with a clear
  diagnostic
- variant expansion must have a hard cap
- a specialized component should not recursively create a new specialization of
  itself unless the incoming alias environment is exactly identical and the
  behavior is explicitly tested
- debug metadata must record the cycle or recursion reason

Relative object-context output may avoid some cloning-specific recursion
problems, but it still needs cycle tests for any fixed-point graph discovery.

## Shape-Polymorphic Specialization

Path-polymorphic handling maps the same child shape to different canonical
paths. Shape-polymorphic specialization maps the same child prop name to
different data shapes.

Example:

```jsx
const Output = ({ value }) => <div>{ value }</div>;

const App = () => {
	const title = useStoreSelector((state) => state.title);
	const tags = useStoreSelector((state) => state.tags);

	return (
		<>
			<Output value={ title } />
			<Output value={ tags } />
		</>
	);
};
```

If `title` is scalar and `tags` is a primitive list, the two specializations may
need different output forms:

```hbs
<div>{{title}}</div>
<div>{{#tags}}{{.}}{{/tags}}</div>
```

The difficulty is proof. A bare render:

```jsx
{ value }
```

does not by itself prove whether `value` is a scalar replacement, a primitive
list, a pre-rendered HTML string, or some object coerced by React.

### Possible Shape Evidence Sources

The transform could infer or confirm shape from:

- selector path plus known list usage elsewhere in the same trace context
- visible `.map()` usage
- flat shape hints such as `Component.templateVars = [ 'tags[]' ]`
- future schema metadata
- PHP/data contract metadata supplied by the build integration
- explicit future selector helpers, if we ever choose to introduce them

Without evidence, scalar replacement should remain the conservative default.

### Shape-Polymorphism Risks

- The same local JSX usage can require different generated output.
- Bare `{ value }` is intentionally ambiguous.
- Treating every selected array as a list wrapper could break cases where arrays
  are pre-rendered or joined before output.
- Treating every bare render as scalar could under-render primitive list output.
- A component may use the same prop in multiple roles, such as replacement and
  control.
- PHP list context depth needs explicit tests for every supported shape.

### Recommended Policy

For now:

- support path-polymorphic reuse only when the local child usage shape is stable
- do not infer primitive-list rendering from bare `{ value }` alone
- allow shape-polymorphic specialization only when shape is proven by explicit
  evidence
- fail closed or warn when different callsites require incompatible shapes and
  the transform cannot prove the intended output

Longer term:

- model each specialization as a combination of incoming path and inferred shape
- require debug metadata to show why a value was treated as scalar, object, list
  item, or primitive list
- add a dedicated shape-polymorphism gate after path-polymorphism works

## User/Data Architecture Errors

The transform should preserve normal React semantics. It should not try to
rescue component wiring that is already incorrect in React.

For example:

```jsx
const Header = ({ hero }) => <h1>{ hero.title }</h1>;

// Wrong local contract: Header receives user but reads hero.
<Header user={ hero } />
```

This is a user/component architecture error. The transform should not infer that
`user` was meant to be `hero`.

Similarly:

```jsx
const Header = (props) => <h1>{ props.hero.title }</h1>;
```

The parameter name `props` is not special. The transform should understand
ordinary props-object usage, but it should not look for a prop literally called
`props`.

Supported reasoning:

```txt
function parameter -> props object -> property access
```

Unsupported reasoning:

```txt
author passed wrong prop name -> transform guesses intended prop
```

Supporting multiple valid canonical paths does not change this boundary. These
are valid mappings:

```txt
Home callsite:    Header.hero -> home.hero
Article callsite: Header.hero -> article.hero
```

because both callsites satisfy the same local child contract:

```txt
Header reads hero.title
```

But wrong prop names, mismatched destructuring, dynamic props, or incompatible
local shapes should still fail closed. Multi-source support should remove false
conflicts between valid callsites; it should not infer intended wiring when the
React component contract itself is wrong.

This distinction should remain explicit in docs and diagnostics.

## Debug Metadata Requirements

Either relative object contexts or specialization will be very hard to review
without detailed debug metadata.

A useful debug payload should include:

```json
{
  "callsiteContexts": [
    {
      "component": "Header",
      "file": "Header.jsx",
      "sourceCallsite": "HomePage.jsx:<Header hero={hero} />",
      "strategy": "relative-object-context",
      "incomingProps": [
        {
          "propName": "hero",
          "canonicalPath": "home.hero",
          "declarationPath": "home.hero",
          "shape": "object"
        }
      ],
      "discoveredLocalPaths": [ "hero.title" ],
      "compiledPaths": [ "home.hero.title" ]
    }
  ]
}
```

If specialization is used, debug metadata should additionally include the
generated variant ID and specialization key hash.

For multi-hop traces, reviewers likely need hop-by-hop provenance:

```txt
HomePage.hero -> Shell.hero -> Header.hero -> hero.title
```

Debug output should also record why a potential context or specialization was
skipped:

- unsupported boundary
- ambiguous shape
- incompatible prop contract
- dynamic component
- spread props
- render prop
- unresolved import
- unsupported import shape

## Acceptance Gates For Path-Polymorphism

Before treating path-polymorphic reuse as viable, require tests for the relative
object-context model:

1. Same child used twice in one parent with different object roots.
2. Same child used from two parent files with different object roots.
3. Same child used from multiple parents with the same canonical source, deduped
   where possible.
4. Object-root child control, such as `hero.status === 'published'`.
5. Object-root child replacement and control in the same component.
6. Same child used with list-item object props from different list roots.
7. Nested list object-field prop, such as `badges={ product.badges }`.
8. Multi-hop propagation through an intermediate component.
9. Explicit child `templateVars` coexistence.
10. Explicit child `templateVars` collision with traced declarations fails
    closed or has a documented precedence rule.
11. Conditional prop source in one callsite, such as `hero={ cond ? a : b }`,
    fails closed unless the transform can prove one canonical source.
12. Same child inside and outside `.map()` in one parent fails closed or renders
    correctly without partial output.
13. Mixed list/non-list contexts fail closed or render correctly without partial
    output.
14. Child usage covers replacement, control, and list roles where those roles are
    supported by the strategy.
15. Handlebars and PHP output parity.
16. No last-wins behavior.
17. No orphaned replace/list/control declarations.
18. Debug metadata mapping callsite -> context root -> compiled paths.
19. Existing ambiguous warning-only degraded output is replaced by a hard error
    or a correct transform.
20. Existing flat API behavior remains unchanged.
21. Existing non-specialized selector fixtures remain unchanged.

Scalar prop reuse should remain a regression test, but it is not the motivating
hard case because parent-side materialization already handles many scalar leaf
flows.

## Acceptance Gates If Specialization Is Needed

If relative object contexts cannot support the path-polymorphic cases, then
specialization needs additional gates:

1. Callsite identity exists before traces are grouped by component/prop.
2. Specialization records are built from complete incoming alias environments.
3. Generated variant names use a readable prefix plus stable hash, not readable
   source-path names as identity.
4. Parent callsites are rewritten before the final controller pass.
5. Cross-file mode has an explicit import/export strategy.
6. Multi-prop specializations are covered.
7. Conditional prop sources fail closed unless one canonical source can be
   proven.
8. Same child inside and outside `.map()` is covered.
9. Specialized children used in control and list roles are covered.
10. Explicit child `templateVars` coexistence and collision behavior is covered.
11. Transitive multi-hop closure is bounded and tested.
12. Recursive/cyclic component graphs fail closed or use a tested fixed-point
   policy.
13. Variant count has a hard bound and debug metadata reports generated variants.
14. No orphaned generated variants or imports.
15. Handlebars and PHP output parity.
16. Existing ambiguous fail-closed behavior remains for unsupported flows.

## Acceptance Gates For Shape-Polymorphism

Do not combine this with the first path-polymorphism proof unless reviewers
strongly recommend it.

Shape-polymorphism needs its own tests:

1. Same child prop receives scalar at one callsite and primitive list at another.
2. Shape evidence is explicit and visible.
3. Bare `{ value }` without shape evidence remains scalar or fails closed,
   according to the agreed policy.
4. Primitive list output is correct in Handlebars and PHP.
5. Same prop used as replacement and control in one specialization.
6. Same prop used as list and control in another specialization.
7. Shape mismatch diagnostics explain which callsite required which shape.
8. Debug metadata explains the shape decision.
9. No double wrapping.
10. No silent conversion of arrays into list templates without proof.

## Open Questions For Reviewers

1. Can relative object-root emission solve the same-shape/different-root problem
   without component specialization?
2. Should the implementation use explicit object context blocks, build-time
   prefix composition, or another relative-context model?
3. What Handlebars helper or convention should represent object context?
4. What PHP context-depth risks does object-root context introduce?
5. Can object contexts compose cleanly with nested list contexts?
6. Can object-root controls be emitted correctly without cloning?
7. Does relative object context preserve the registry/controller boundary, or
   does it require invasive output changes?
8. Should ambiguous object-root tracing hard-error by default until this is
   solved?
9. If specialization is still needed, should variants be generated in the child
   file, the parent file, or entirely through manifest metadata?
10. If specialization is used, what should determine the stable hash key?
11. If specialization is used, how should transitive multi-hop variant closure
    and cycle handling be bounded?
12. Should shape-polymorphic specialization be considered now, or explicitly
    deferred until path-polymorphism is proven?
13. What evidence should be required before treating bare `{ value }` as a
    primitive list rather than scalar replacement?
14. Are there cases where supporting multiple canonical sources would hide real
    user/component architecture errors?
15. What is the smallest safe first implementation slice?

## Recommended Next Step

Keep the current ambiguous-seed suppression in place, but do not rely on
warning-only degraded output as a safe interim. This ambiguity should become a
hard error by default or require `strict: true` in review/CI mode.

Ask reviewers to evaluate this document before implementation.

If the revised direction is accepted, the first implementation slice should be a
narrow same-file relative object-context proof:

- one child component
- two parent callsites
- same local object prop contract
- different canonical source paths
- Handlebars and PHP assertions
- no cross-file rewriting yet
- object-root control coverage
- full debug metadata for both callsite contexts

That first slice is object-root only. The broader path-polymorphism program
still includes list-relative multi-source variants, including child components
used inside and outside `.map()` and list-context object-field props.

Only after that should we extend the model to cross-file manifest output.

Component specialization should remain conditional until relative object
contexts are proven insufficient. Shape-polymorphic specialization should remain
a follow-up research gate unless reviewers identify a low-risk way to prove
source shape at each callsite.
