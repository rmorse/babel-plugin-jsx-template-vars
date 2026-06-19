# Store Selector Callsite Specialization Research

## Status

Research and investigation note for reviewer feedback.

This document is not an implementation plan yet. It explores a limitation in
the current experimental store-selector hierarchy tracing model and proposes a
possible next architecture direction.

The immediate problem is multiple parent callsites using the same child
component with different canonical data paths. A related, harder problem is
shape-polymorphic props, where the same child prop name may receive a scalar in
one callsite and a list or object in another.

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
- fail-closed diagnostics for unsupported import and child-boundary shapes

The cross-file manifest currently suppresses ambiguous seeds. If two different
parent files try to seed the same child component prop with different canonical
paths, the manifest records ambiguity and does not emit a seed for that child
binding. This prevents last-wins output bugs, but it is too conservative for a
valid reusable-component pattern.

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
be a last-wins bug; suppressing both is safe but blocks an important authoring
pattern.

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

This is shape-polymorphism. It is not solved by path specialization alone,
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

Keep the current ambiguous-seed suppression as the safe interim behavior.

Investigate callsite-specific specialization as the next architecture direction
for valid multi-source reuse. Treat shape-polymorphic specialization as a
separate, later extension unless reviewers find a simpler way to prove shape
safely.

In short:

```txt
path-polymorphic reuse:   should be supported next
shape-polymorphic reuse:  possible later, but needs stricter proof
```

## Proposed Direction: Callsite-Specific Component Specialization

The most promising architecture is to compile a child component separately for
each unique incoming trace context.

Conceptually:

```jsx
<Header hero={ homeHero } />
<Header hero={ articleHero } />
```

would behave as though the transform created internal specializations:

```txt
Header__homeHero:
  local hero.title -> canonical home.hero.title

Header__articleHero:
  local hero.title -> canonical article.hero.title
```

The source component remains reusable. The compiled template output gains
callsite-specific variants where needed.

This is a compiler specialization model:

```txt
one authored component + multiple incoming trace contexts -> multiple compiled variants
```

## Why A Single Child Transform Cannot Represent This

A transformed `Header` body cannot emit both:

```hbs
{{home.hero.title}}
```

and:

```hbs
{{article.hero.title}}
```

from the same JSX usage:

```jsx
<h1>{ hero.title }</h1>
```

without knowing which parent callsite invoked it. That context is not available
inside a single global child transform. Therefore either:

- the child must be cloned/specialized per trace context
- the parent must render or bind the child differently per callsite
- a runtime/template binding map must be introduced

The first option appears most consistent with the existing architecture.

## Alternative Architectures Considered

### 1. Keep Failing Closed On Ambiguity

This is the current behavior.

Benefits:

- simple
- safe
- prevents last-wins bugs
- preserves current registry/controller assumptions

Costs:

- blocks valid reusable child components
- limits cross-file tracing usefulness
- pushes authors back toward manual child declarations or duplicated components

Recommendation: keep this until specialization is proven, but do not treat it as
the final design.

### 2. Runtime Or Template Binding Maps

The transform could pass a binding map into the child:

```txt
Header receives:
  hero -> home.hero
```

Then child output resolves `hero.title` through the active binding map.

Benefits:

- avoids cloning components
- can represent different callsite paths dynamically

Costs:

- more invasive than current architecture
- likely leaks selector-specific concepts into output generation
- harder for static PHP and Handlebars output
- complicates debugging
- risks making controllers aware of store-selector semantics

Recommendation: avoid unless specialization proves unworkable.

### 3. Parent-Side Materialization

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

### 4. Callsite-Specific Specialization

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

Recommendation: investigate this first.

## What The Specialization Key Must Include

A specialization should not be keyed only by component name.

The key probably needs to include:

- target component file
- target component export/local name
- incoming prop name
- incoming canonical source path
- incoming declaration path, especially for list-relative child contexts
- whether the prop is object-root, scalar, list-item, or list-context object-field
- inherited list context depth
- any shape information that affects output role

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

## Same-File Specialization Sketch

First investigation slice:

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

Expected PHP output should similarly render:

```php
$data['home']['hero']['title']
$data['article']['hero']['title']
```

High-level transform idea:

1. Discover both callsite contexts.
2. Generate two internal child variants.
3. Seed each variant with one unambiguous incoming trace context.
4. Rewrite each `<Header />` callsite to the matching variant.
5. Run normal registry/controller output through each variant.

The child source code should remain the same from the author's perspective.

## Cross-File Specialization Sketch

Cross-file support is more complex because the parent and child transforms run
on separate files.

The manifest may need to emit:

```json
{
  "specializationsByFile": {
    "Header.jsx": [
      {
        "id": "Header__homeHero",
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
        "id": "Header__articleHero",
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
        "to": "Header__homeHero",
        "sourcePath": "home.hero"
      }
    ],
    "ArticlePage.jsx": [
      {
        "from": "Header",
        "to": "Header__articleHero",
        "sourcePath": "article.hero"
      }
    ]
  }
}
```

Open questions:

- Should specialized variants be emitted in the child file or parent file?
- Should specialized variants be exported?
- How should parent imports be rewritten in transformed test modules?
- How does this fit production bundlers?
- Can the manifest assign stable specialization IDs without inspecting output
  code?

For the current test harness, child-file variants plus parent callsite rewrites
may be enough. For real package use, this likely needs more thought.

## Shape-Polymorphic Specialization

Path specialization maps the same child shape to different canonical paths.
Shape-polymorphic specialization maps the same child prop name to different data
shapes.

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

- support path specialization only when the local child usage shape is stable
- do not infer primitive-list rendering from bare `{ value }` alone
- allow shape-polymorphic specialization only when shape is proven by explicit
  evidence
- fail closed or warn when different callsites require incompatible shapes and
  the transform cannot prove the intended output

Longer term:

- model each specialization as a combination of incoming path and inferred shape
- require debug metadata to show why a value was treated as scalar, object, list
  item, or primitive list
- add a dedicated shape-polymorphism gate after path specialization works

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

This distinction should remain explicit in docs and diagnostics.

## Debug Metadata Requirements

Specialization will be very hard to review without detailed debug metadata.

A useful debug payload should include:

```json
{
  "specializations": [
    {
      "id": "Header__homeHero",
      "component": "Header",
      "file": "Header.jsx",
      "sourceCallsite": "HomePage.jsx:<Header hero={hero} />",
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

For multi-hop traces, reviewers likely need hop-by-hop provenance:

```txt
HomePage.hero -> Shell.hero -> Header.hero -> hero.title
```

Debug output should also record why a potential specialization was skipped:

- unsupported boundary
- ambiguous shape
- incompatible prop contract
- dynamic component
- spread props
- render prop
- unresolved import
- unsupported import shape

## Acceptance Gates For Path Specialization

Before treating path specialization as viable, require tests for:

1. Same child used twice in one parent with different object roots.
2. Same child used from two parent files with different object roots.
3. Same child used from multiple parents with the same canonical source, deduped
   to one specialization where possible.
4. Same child used with scalar props in different canonical paths.
5. Same child used with list-item object props from different list roots.
6. Nested list object-field prop, such as `badges={ product.badges }`.
7. Multi-hop specialization through an intermediate component.
8. Handlebars and PHP output parity.
9. No last-wins behavior.
10. No orphaned replace/list/control declarations.
11. Debug metadata mapping callsite -> specialization -> compiled paths.
12. Existing ambiguous fail-closed behavior remains for unsupported flows.
13. Existing flat API behavior remains unchanged.
14. Existing non-specialized selector fixtures remain unchanged.

## Acceptance Gates For Shape-Polymorphism

Do not combine this with the first path-specialization proof unless reviewers
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

1. Is callsite-specific specialization the right architecture for multiple
   canonical sources?
2. Is there a simpler model that supports this without cloning or specializing
   components?
3. Should specialization be generated in the child file, the parent file, or
   entirely through manifest metadata?
4. How should parent import/callsite rewriting work in cross-file mode?
5. What should determine a stable specialization key?
6. How aggressively should specializations be deduped?
7. How much generated code growth is acceptable?
8. Does specialization preserve the registry/controller boundary, or does it
   risk leaking selector-specific concepts into output generation?
9. What additional PHP context-depth risks should be tested?
10. Should shape-polymorphic specialization be considered now, or explicitly
    deferred until path specialization is proven?
11. What evidence should be required before treating bare `{ value }` as a
    primitive list rather than scalar replacement?
12. Are there cases where supporting multiple canonical sources would hide real
    user/component architecture errors?
13. Should ambiguous cross-file seeds remain fail-closed until specialization
    lands?
14. What is the smallest safe first implementation slice?

## Recommended Next Step

Keep the current ambiguous-seed suppression in place.

Ask reviewers to evaluate this document before implementation.

If the architecture is accepted, the first implementation slice should be a
narrow same-file path-specialization proof:

- one child component
- two parent callsites
- same local object prop contract
- different canonical source paths
- Handlebars and PHP assertions
- no cross-file rewriting yet
- full debug metadata for both specializations

Only after that should we extend the model to cross-file manifest output.

Shape-polymorphic specialization should remain a follow-up research gate unless
reviewers identify a low-risk way to prove source shape at each callsite.
