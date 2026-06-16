# Review: store selector data contract experiment

Pressure-test of
[`store-selector-data-contract-experiment.md`](./store-selector-data-contract-experiment.md)
and
[`store-selector-data-contract-implementation.md`](./store-selector-data-contract-implementation.md)
against the current plugin implementation (flat `templateVars`, normalized registry,
role inference, controllers, and existing e2e fixtures).

**Verdict:** The experiment is worth pursuing as a draft. A single role-neutral
selector API is a cleaner data contract than detached declarations or `$$`
markers, and the plan correctly routes extracted paths through the existing
registry and controllers instead of inventing parallel output machinery. The
first proof slice is scoped about right for validating the idea. The main risks
are not in PHP/Handlebars output — they are in binding metadata, list-shape
discovery without declarations, and the long-term cost of prop tracing versus
teaching flat paths.

This is not release-bound work. Treat the review as architecture stress-testing
before implementation starts.

---

## Executive summary

| Area | Assessment | Recommendation |
| --- | --- | --- |
| Role-neutral selector API | Strong | Keep one hook, path-only selectors; avoid `templateValue` / `templateList` splits |
| Usage-based role inference | Realistic for slice 1 | Reuse `inferUsageRoles`; extend path resolution for selector bindings |
| First proof slice scope | Right-sized | Ship parser + bindings + registry merge; defer prop drilling |
| Registry/controller reuse | Safe if boundaries hold | Synthesize flat strings, then call `createTemplateVarsRegistry` unchanged |
| Selector grammar/diagnostics | Mostly strict enough | Add gates for unassigned calls, optional chaining policy, hook rename aliasing |
| Deferred prop drilling | Realistic in phases | Same-file static graph first; do not promise cross-file early |
| Shape-only hints | Keep flat strings for now | Add selector-based shape API only after slice 1 parity |
| Reasoning cost vs flat API | Higher until tracing lands | Document escape hatches; parity fixtures are mandatory |
| Pre-implementation gates | Missing a few | Add binding-resolution tests, multi-role parity, child-component negative cases |

---

## 1. Is the single role-neutral selector API the right contract?

**Yes, with caveats.**

The experiment correctly separates two concerns that flat `templateVars` currently
merges:

1. **Data path** — what PHP must supply in nested `$data`.
2. **Template role** — replace, control, or list output at a usage site.

Flat declarations already encode (1) explicitly and infer (2) from AST context.
Selectors would encode (1) explicitly through static member paths and still infer
(2) from the same usage sites. That matches the shipped registry model in
`template-vars-registry.js`, where paths carry role sets and
`inferUsageRoles()` tags control and list behavior from `&&`, ternaries, and
`.map()`.

A role-specific selector API (`useTemplateList`, `useTemplateControl`, etc.)
would reintroduce the old bucket model at the JSX boundary and fight multi-role
values such as `status` (replace + control) and `products` (control + list),
which the flat API already supports and tests in
`template-vars-registry.test.js`.

**Recommendations:**

- Keep `useStoreSelector((state) => state.hero.title)` as the canonical shape.
- Recognize calls through import bindings first; defer configurable hook names
  until import-based recognition is proven insufficient.
- Document that the hook may be app-owned at runtime; the plugin only needs a
  stable compile-time call shape.
- Avoid shipping runtime store code in slice 1. The implementation plan already
  says this; keep it that way.

**Open naming question:** `useStoreSelector` reads like Zustand/Redux ergonomics,
which is good for author familiarity but may over-promise runtime behavior during
an experiment. A package-scoped import path
(`babel-plugin-jsx-template-vars/store`) mitigates collision with unrelated hooks.

---

## 2. Is usage-based role inference realistic?

**Yes for slice 1, with the same conservative limits as flat mode.**

The existing pipeline already does what the experiment needs after paths enter
the registry:

- **Replace** — default role on scalar paths; controllers rewrite identifiers in
  JSX output.
- **Control** — `inferUsageRoles()` tags identifiers and root shapes found in
  `&&` / ternary tests via `getExpressionArgs()`.
- **List** — shape comes from declared `products[]` segments; `.map()` adds
  `tagAliases` through `listsBySourceKey`.
- **Multi-role** — one registry entry, multiple roles, derived controller inputs.

The store-selector collector's job is therefore narrower than it appears: build the
same flat path declarations the author would have written, plus a **binding map**
from local identifiers to canonical paths (`title -> hero.title`,
`product.title -> products[].title`).

**What works well in slice 1:**

```jsx
const status = useStoreSelector((state) => state.status);
return (
  <>
    <h1>{ status }</h1>
    { status === 'published' && <Badge /> }
  </>
);
```

After synthesis to `'status'`, existing role inference should behave like flat
declarations.

```jsx
const products = useStoreSelector((state) => state.products);
const rendered = products.map((product) => <a>{ product.title }</a>);
return visible && <section>{ rendered }</section>;
```

Requires:

- list root `products` with item field `title` from `.map()` callback usage
- control on `visible`
- list tag alias `rendered` from map assignment

All of this has flat-API precedents in `full-template-surface` and registry tests.

**Harder cases (plan acknowledges most of these):**

| Case | Slice 1 | Notes |
| --- | --- | --- |
| Scalar replace | Supported | Direct identifier rewrite |
| Nested object field via alias | Supported | `hero.title` binding chain |
| Destructure from selected object | Supported | `{ title } = hero` |
| List fields from `.map()` | Supported | Must match flat list inference rules |
| List fields via opaque helper | Not supported | Same as flat API today |
| Control on nested member without alias | Risky | `hero.title && ...` needs path-aware control matching |
| Direct `{ products }` render | Ambiguous | Plan correctly warns this is replace-only, not list wrap |
| Multi-role on nested list item fields | Supported in flat API | Needs parity fixture |

**Gap not spelled out enough:** today's control tagging resolves identifiers to
registry paths, but control matching in controllers still has root-name heritage.
Before slice 1 ships, add explicit parity tests for selector bindings used only
as nested member expressions in conditions (for example
`hero.title === 'x'`) if that pattern is in scope.

**Recommendation:** treat selector mode as a **declaration synthesizer + binding
map** feeding the existing registry. Do not fork role inference.

---

## 3. Is the first proof slice scoped correctly?

**Yes.** The slice deliberately proves:

1. static selector parsing
2. local binding propagation (alias, destructure, map item aliases)
3. synthesized flat declarations
4. registry merge + controller output parity

Deferring prop drilling, cross-file graphs, context, spread props, and HOCs is
correct. Without slice 1 parity, tracing investment has no stable foundation.

**Scope trims worth keeping explicit:**

- Top-level `const App = () => {}` only — matches current visitor assumptions.
- No `function App() {}` / default export forms until listed — good.
- No `tidyOnly` behavior in slice 1 — good; selector stripping semantics need
  their own design pass.
- No runtime store — good.

**One scope tension to resolve before coding:**

The experiment doc asks whether direct array rendering should infer list output.
The implementation plan says direct rendering is replace-only unless other usage
proves list shape. **Pick one default for slice 1 and test it.** The conservative
choice (require `.map()` or flat shape hints for list fields) matches current flat
behavior and avoids false list wraps.

**Suggested addition to slice 1 exit criteria:**

- A `store-selector-complex-surface` fixture with parity against
  `full-template-surface` output (selector declarations substituted for
  `App.templateVars`, child components still using flat declarations until
  tracing exists).
- A negative fixture where selector + usage cannot infer a field and the transform
  fails clearly unless a flat hint is present.

---

## 4. Does the plan reuse registry/controllers safely?

**Yes, if synthesis stops at the registry boundary.**

The proposed pipeline in the implementation plan is aligned with the shipped
architecture:

```txt
selector calls -> binding map -> flat path strings -> createTemplateVarsRegistry -> controllers
```

That is the right integration point. Controllers should not know selectors exist.

**Safe reuse conditions:**

1. **Emit flat strings compatible with `parseTemplateVarPath()`** — including
   `products[].title` list segments, not runtime variable names.
2. **Merge explicit `templateVars` before registry creation** — plan already
   specifies this; required for shape-only hints and child components during
   the experiment.
3. **Preserve one identity per path** — conflicts should surface through existing
   registry validation, not ad hoc selector logic.
4. **Keep `inferUsageRoles()` on the component AST** — it runs after registry
   construction today; selector bindings must use identifier names the inference
   pass can see (`products`, `renderedProducts`, `product.title` as source keys).

**Watch point:** list metadata keys use `sourceKey` strings such as `products` and
`catalog.sections.items` (via `getListSourceKey`). Selector binding collection
must produce the same source keys flat declarations produce, or list tagging and
list controller wrapping will miss `.map()` calls.

**Watch point:** the visitor currently triggers only on `Component.templateVars =`
assignments. Selector-only components need a second discovery path (scan component
body for recognized selector calls, then run the same registry/controller init).
The plan mentions this; make it an explicit Phase 2 gate with a test for
"selectors only, no templateVars assignment".

---

## 5. Are selector grammar and diagnostics strict enough?

**Mostly yes.** Static member paths, single parameter, no calls inside selectors,
and hard errors on computed access are appropriate.

**Strengthen before implementation:**

| Rule | Plan status | Review note |
| --- | --- | --- |
| Static `state.a.b` | Covered | Good |
| Reject destructured params | Covered | Good |
| Reject conditional selectors | Covered | Good |
| Optional chaining `state.hero?.title` | "Potentially supported" | Decide in slice 1: either support and normalize to `hero.title`, or reject with a clear error. Do not silently drop segments. |
| Selector call not assigned to a binding | Mentioned | Enforce in slice 1 — unassigned calls cannot participate in role inference |
| Renamed import `import { useStoreSelector as useSelector }` | Not mentioned | Support import specifiers or document as unsupported |
| Multiple selector calls merged into one binding | Not mentioned | Reject or pick first; do not guess |
| Selector inside nested function component | Deferred | Document as unsupported in slice 1 |

**Diagnostic quality:** the recommended messages in the implementation plan are
good. Add one more:

```txt
Selected path "products[].title" is used in template output, but list item fields
require visible .map() usage or an explicit templateVars shape hint.
```

That message connects selector mode back to the flat escape hatch and avoids silent
partial transforms.

**Strictness principle:** when path metadata is lost (opaque helper, dynamic access,
unsupported component form), fail closed in strict mode and prefer warnings/errors
over rewriting unknown identifiers. The plan states this; enforce it in tests.

---

## 6. Is the deferred prop drilling / hierarchy tracing plan realistic?

**Yes as a phased follow-up, not as an implicit slice 1 feature.**

The deferred phases (same-file child props → destructured props → aliases → list
item props → local component graph → cross-file → opt-in context) mirror how a
static analyzer would grow safely. The plan's exclusion list (spread props, dynamic
components, HOCs, render props, imported helpers) matches known hard limits from
flat mode and from general React static analysis.

**What makes tracing the real payoff:**

```jsx
const App = () => {
  const title = useStoreSelector((state) => state.hero.title);
  return <Header title={ title } />;
};
const Header = ({ title }) => <h1>{ title }</h1>;
```

Without tracing, authors must either:

- duplicate selectors in child components, or
- keep flat shape hints on parents, or
- accept untransformed child output.

That is acceptable for slice 1 if documented, but it is the main reason selector
mode could feel worse than flat declarations until Phase A–E exist.

**Realistic expectations:**

- **Same-file direct props** — realistic; build a local component map and transfer
  binding metadata through JSX attributes with identifier/literal values.
- **List item prop drilling to child components** — realistic but non-trivial;
  metadata must carry list context depth (`products[]` item → `product` prop →
  `product.title`). Flat mode sidesteps this by declaring paths on each component
  (`Item.templateVars = ['label']` in `list-object-controls`).
- **Cross-file graph** — possible later, but barrel re-exports and duplicate
  component names need explicit limits.
- **Opt-in context pair** — better than generic `createContext` analysis; keep this
  as a separate experiment flag if pursued.

**Recommendation:** keep tracing deferred, but add a **negative e2e fixture** in
slice 1 showing untransformed child output when a selector value is drilled via
props. That documents the gap honestly and prevents false expectations.

---

## 7. What should shape-only hints look like?

**Keep flat `Component.templateVars` strings during the experiment.**

The implementation plan already allows:

```jsx
const products = useStoreSelector((state) => state.products);
App.templateVars = [ 'products[].price' ];
```

when `.map()` usage exposes `title` but not `price`. That is the right escape hatch
because:

- it reuses existing registry merge and validation
- it avoids inventing a second shape language before selector parity exists
- it matches how flat mode treats declarations as user-owned contracts, not
  runtime proofs

**Do not introduce selector-based shape APIs in slice 1**, such as:

```jsx
useStoreSelector.shape((state) => state.products, [ 'title', 'price' ]);
```

If shape hints proliferate, revisit after parity fixtures pass. A future shape API
should still emit flat strings at the registry boundary.

**Policy recommendation:**

| Hint need | Experiment approach |
| --- | --- |
| Hidden list fields not in `.map()` body | flat `templateVars` merge |
| Child component fields before tracing | flat `templateVars` on child |
| Conflicting path shapes | registry error (existing behavior) |
| Opaque helper list rendering | flat hints or helper analysis later |

---

## 8. Where is this harder to reason about than flat declarations?

**Flat declarations remain the mental model.** Selector mode adds indirection.

**Harder for authors:**

- **Implicit list fields** — flat mode makes `products[].price` visible in one
  array; selector mode requires tracing `.map()` bodies or adding hints.
- **Child components** — flat mode expects explicit child declarations today;
  selector mode promises eventual tracing but not in slice 1.
- **Debugging transform output** — authors must mentally compile selectors +
  usage into flat paths; tooling/docs should show synthesized declarations in
  debug output early.
- **Multiple components selecting overlapping paths** — flat mode scopes per
  component; selectors look global, but transform scope is still per component
  until cross-file tracing exists.

**Harder for implementers:**

- Binding map maintenance across aliases, destructures, and nested map callbacks.
- Ensuring `sourceKey` alignment for list tagging.
- Dual discovery paths (`templateVars` assignment vs selector-only components).
- Deciding failure modes when a selector path is declared but never used (flat
  declarations currently allow unused paths as contract documentation).

**Easier for authors (when tracing lands):**

- PHP and JSX share one nested object shape.
- No marker syntax in rendered JSX.
- Data consumption reads like normal application state.

**Net:** slice 1 is primarily an authoring ergonomics trade — less explicit
contract surface, more inference magic — until tracing and diagnostics catch up.

---

## 9. Missing test fixtures and review gates

The implementation plan's fixture list is a good start. Add these **before or
alongside Phase 1**, not after e2e:

### Unit-test gates

- **Selector parser matrix** — already listed; include optional chaining decision.
- **Binding map resolver** — table-driven tests for alias/destructure/map chains.
- **Synthesis merge** — selector paths + flat hints → final declaration set.
- **sourceKey parity** — selector-derived list roots match flat declarations for
  nested lists (`catalog.sections[].items[].label`).

### E2e gates

| Fixture | Purpose |
| --- | --- |
| `store-selector-multi-role` | `status`, `visible`, `products` multi-role parity |
| `store-selector-map-alias` | `renderedProducts = products.map(...)` list wrap |
| `store-selector-shape-hint-only-field` | `.map()` exposes one field, hint adds another |
| `store-selector-nested-member-control` | control on `hero.title` without scalar alias |
| `store-selector-child-untraced` | prop drilling fails predictably pre-tracing |
| `store-selector-selectors-only` | no `templateVars` assignment on component |
| `store-selector-conflict` | selector + flat hint disagree → error |
| Parity pair vs `full-template-surface` | byte-match PHP + Handlebars where applicable |

### Process gates

1. **Architecture gate** — no controller changes for selector mode in slice 1.
2. **Parity gate** — every positive fixture has an equivalent flat fixture or
   documented intentional difference.
3. **Flag isolation gate** — off by default; no interaction with `tidyOnly` until
   specified.
4. **Debug gate** — optional verbose logging of synthesized declarations during
   experiment development.

---

## Recommendation

**Proceed with the experiment** behind `experimentalStoreSelectors`, using the
first proof slice exactly as scoped. The role-neutral selector contract is sound,
registry reuse is the right integration strategy, and deferred tracing is
honestly phased.

**Before implementation starts, update the plans with:**

1. A firm slice 1 policy on direct array rendering vs list inference.
2. A decision on optional chaining (support-normalize or reject).
3. Selector-only component discovery as an explicit pipeline entry.
4. The additional fixtures and negative child-prop case above.
5. A short "compiled view" note for authors: selectors + usage ⇒ equivalent flat
   `templateVars` (for debugging and code review).

**Pause criteria from the plan are correct.** If slice 1 needs broad React data-flow
simulation or frequent opaque-helper escape hatches before it beats flat declarations,
stop and reassess.

---

## Reviewer answers to PR questions

| Question | Answer |
| --- | --- |
| Cleaner than `templateVars` or `$$`? | Cleaner data contract; not cleaner transform mental model until tracing lands |
| Canonical hook name? | `useStoreSelector` is fine with package-scoped import recognition |
| Usage inference for lists/controls/multi-role? | Realistic via existing registry; binding map is the new work |
| First slice small enough? | Yes |
| Essential prop-drilling patterns? | Same-file direct props + list item props; destructuring aliases soon after |
| Shape hints on flat vs selector API? | Flat strings during experiment |
| Opt-in context? | Yes, if ever — not arbitrary context inference |
