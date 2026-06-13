# Review: dollar marker template vars experiment

Pressure-test of
[`dollar-marker-template-vars-experiment.md`](./dollar-marker-template-vars-experiment.md)
against the shipped flat `templateVars` API (`0.1.0-beta.0`), the normalized
registry in `template-vars-registry.js`, the three controllers, and the current
e2e fixture suite.

Related issue: https://github.com/rmorse/babel-plugin-jsx-template-vars/issues/14

**Verdict:** The experiment is worth pursuing as a draft PR behind an opt-in
flag. The core architectural bet — synthesize flat path declarations from marked
usage, then feed the existing registry and controllers — is sound and aligns
with how the flat API already separates **shape declaration** from **role
inference at usage sites**. The phased spike (scalar/control first, lists
second) is the right sequencing.

The plan understates three areas that will determine success: (1) **component
discovery** scope and false positives, (2) **marker stripping and AST
rewriting** before the existing controllers run, and (3) **gaps versus
`deferred-resolution` and child-component boundaries**, which are harder than
the fixtures named in the test plan.

Long term, marker syntax can plausibly **complement** flat `templateVars` for
most rendered paths, but full **replacement** is unlikely without either
accepting documented parity gaps or adding explicit shape-only marker syntax.

---

## Executive summary

| Area | Risk | Recommendation |
| --- | --- | --- |
| Registry-first architecture | Low | Keep the proposed two-step pipeline; do not fork controllers |
| Component discovery | High | Start narrow; add explicit negative tests for helpers/HOCs |
| Marker strip / rewrite pass | High | Treat as release-blocking for any marker-enabled output |
| Scalar + nested object paths | Low | Straightforward; add optional chaining early |
| List path discovery from `.map()` | Medium–High | Feasible for direct/nested maps; harder for aliases and helpers |
| Parity with e2e fixtures | Medium | Named fixtures are necessary but not sufficient |
| Child components | Medium | Each component still owns its contract via markers or flat API |
| Primitive root lists | Known gap | Document explicitly; do not hide behind silent inference |
| Complement vs replace | Product | Stay complement-first; replacement needs migration story |

---

## Architectural risks

### 1. Component discovery expands blast radius

Today, `Component.templateVars = [...]` is both the **data contract** and the
**processing gate**. Only assigned components are transformed. Marker mode
inverts that: any discovered function with JSX and `$$` markers becomes a
transform target.

The plan's first scope (`const Foo = () => ...` with JSX) is reasonable, but
even that scope will hit:

- render helpers that return JSX but are not "components"
- factory functions that happen to contain JSX
- test utilities and Storybook wrappers
- nested functions inside a component body that contain JSX (event handlers,
  local render helpers)

The plan says to skip nested callbacks unless they belong to list traversal.
That boundary is correct in principle but needs precise rules and tests. Without
them, discovery will either miss list callback bodies or accidentally transform
helper functions.

**Recommendation:** Discovery should require **all** of:

- capitalized JSX root return (or explicit experimental allowlist)
- no discovery inside `node_modules` (already true for imports; discovery must
  not follow re-exports from dependencies)
- a file-level or component-level marker count threshold only after validation,
  not as the sole gate

Add negative fixtures: a lowercase `renderRow()` helper with `{ $$label }` must
**not** be processed unless it is a discovered component.

### 2. Declaration collection is not enough — markers must be stripped before controllers

The plan correctly states that `$$hero` is not the runtime identifier and that
generated code must not retain `$$` when marker mode is enabled. That implies a
**rewrite pass**, not only a synthetic declaration list.

Current controllers match AST nodes against declared paths and source keys
(`hero.summary`, `products`, `section.products`). They do not understand
`$$`-prefixed identifiers. If markers remain in the AST:

- `inferUsageRoles()` in the registry will not tag controls/lists on marked nodes
- `ReplaceController` will not rewrite `$$title`
- `ListController` will not match `$$products.map(...)`

**Recommendation:** Split marker mode into three explicit phases per component:

1. **Collect** — walk discovered component AST; emit flat path strings + role hints
2. **Strip** — rewrite marked identifiers/member roots to unmarked source names
3. **Registry + controllers** — existing pipeline unchanged

Collection-only spikes will prove syntax parsing but not e2e parity. Step 2
should be in scope before the first PHP/Handlebars parity fixture.

### 3. Dual role inference paths

The plan assigns roles during marker collection (replace, control, list roots)
while the registry still runs `inferUsageRoles()` on the component path. After
marker stripping, the existing inference should largely work — but only if
strip happens **before** `createTemplateVarsRegistry(..., componentPath, ...)`.

If collection assigns roles manually **and** inference runs on stripped AST,
duplicate role tagging is harmless (sets merge). If collection assigns roles but
strip is incomplete, inference silently misses roles.

**Recommendation:** Prefer **strip first, infer second** for roles. Use
collection primarily for **path shape** (especially `[]` segments inference
cannot recover from bare identifiers). Document that marker collection should not
try to reimplement all of `inferUsageRoles()` long term.

### 4. Coexistence with flat `templateVars`

Merging marker-synthesized declarations with explicit `templateVars` through the
same registry is the right approach. Conflicts should surface via existing
`addShapeDeclaration` / root kind validation.

**Missing detail:** processing order when both exist on one component. If flat
`templateVars` is removed from source in non-`tidyOnly` mode today, marker mode
must decide whether to:

- still remove flat assignments when present (consistent with current tidy behavior)
- leave them in place during the experiment (noisier source, easier diffing)

Pick one and test it.

### 5. Reserved `$$foo` bindings

Opt-in marker mode with documented reservation is acceptable for an experiment.
Call out that **prop names**, **hook return values**, and **generated codegen**
could collide in large apps. An escape hatch can wait, but unit tests should
include a component that legitimately uses `$$theme` as a real binding and
assert whether it is transformed or rejected with a clear diagnostic.

---

## Missing AST cases

The plan covers the happy paths well. The following appear in the shipped flat
API or fixtures but are absent or implicit in the experiment plan.

### Marker placement and expression forms

| Pattern | Flat API today | Plan coverage |
| --- | --- | --- |
| `$$hero?.summary` | supported (`hero?.summary`) | not mentioned |
| `$$title` in JSX attributes | supported | implied, not explicit |
| `hero.$$summary` | unsupported | correctly rejected |
| bare `$$` | n/a | correctly rejected |
| computed access `$$items[0]` | unsupported | should stay unsupported + diagnostic |

Add optional chaining to the first scalar spike; it appears in
`deferred-resolution` (`heroAlias?.summary`).

### Control expressions

Flat API supports controls via `getExpressionArgs()` over:

- logical `&&` / `\|\|`
- ternary tests
- unary `!` on identifiers/paths (`!available` in fixtures)
- binary comparisons (`status !== 'archived'`, `mode === 'grid'`)

The plan shows `$$status === 'ready' && ...` but not:

- `{ !$$available && ... }`
- `{ $$status !== 'archived' && ... }`
- `{ $$visible && <footer>...</footer> }` — scalar control without replacement
- `{ $$products && <section>...</section> }` — **list/object root used as control**
  (see `flat-template-vars`: `products && <section>` with declared
  `products[].label`)

List-root controls are multi-role (control + list) and require the list shape
to be inferred even when `.map()` is not marked directly on the same expression
(e.g. control on `products`, list on `renderedProducts` alias).

### List usage beyond direct `.map()`

Current list support (see `docs/template-vars.md` and `ListController`) includes:

- same-scope alias from `.map()` (`const renderedProducts = products.map(...)`)
- reassigned alias (`reassignedProducts = products.map(...)`)
- safe chain before `.map()` (`products.filter(...).map(...)`)
- helper call with one list source (`renderHelperProducts(products)`)
- nested `.map()` callbacks
- destructuring in map callbacks (`({ title, available }) => ...`)
- spread props to child (`<ProductCard {...product} />`)

The plan covers direct and nested `.map()` on marked roots. It does not yet
specify marker behavior for:

| Pattern | Marker question |
| --- | --- |
| `const rendered = $$products.map(...)` | Is mark on `$$products` enough? (likely yes after strip) |
| `$$products.filter(...).map(...)` | Must `$$` sit on root only — confirm chain still resolves |
| `renderHelperProducts($$products)` | Must mark call argument; helper body unmarked |
| `<ProductCard {...product} />` inside `$$products.map` | Item fields inferred from spread, not from `$$` on props |
| `badges={ product.badges }` without `badges.map` in parent | Flat API declares `products[].badges`; marker mode may miss intermediate object-list props passed to children |

The last row is important for `full-template-surface`, where `ProductCard`
receives `badges={ product.badges }` and declares its own nested list paths.
Parent marker mode can infer `products[].name` from rendered JSX props, but
**pass-through list props** may need either child markers or an explicit
`products[].badges` path inferred from prop assignment shape analysis.

### Component and module forms

Follow-up scope in the plan (function declarations, default exports, `memo`,
factory returns) matches known gaps in `getComponentPath()` today (variable
declarations only). Marker mode will expose these immediately because discovery
is broader than assignment lookup.

**Recommendation:** Track parity with `visitor.js` limitations separately. Marker
mode should not accidentally support `function App()` before the flat API does
unless that is an intentional experiment-only advantage.

---

## Can marker syntax infer nested paths realistically?

### Nested object paths — yes

`$$hero.summary` → `hero.summary` is a direct mapping. This aligns with how
`getExpressionPath()` and scalar metadata already work. Confidence: **high**.

### Nested list paths — yes, with constraints

The plan's catalog example is accurate:

```txt
$$catalog.sections.map → catalog.sections[]
  section.products.map → catalog.sections[].products[]
    badge.label        → catalog.sections[].products[].badges[].label
```

This is feasible by reusing concepts already in `ListController`:

- walk outward from nested `.map()` calls
- correlate callback parameters with member paths in callback JSX
- emit `[]` segments at each marked or inferred list boundary

Confidence: **medium**. Complexity approaches what the registry already encodes;
the new work is **synthesizing** declarations from usage rather than reading
them. The hardest cases mirror existing list alias and helper analysis — not
new conceptual ground, but easy to get wrong.

### Paths declared but not directly rendered — partial

Flat `templateVars` allows declaring paths that are only passed through props or
used indirectly. Marker mode inherently prefers **rendered** usage.

Examples at risk:

- `products[].badges` passed as a prop, rendered only inside `ProductCard`
- shape-only declarations for server-side data contracts not yet referenced in JSX
- list roots used only as controls (`products && ...`) while rendering uses an alias

The plan's list-control gap and primitive-list gap are related. **Recommendation:**
during the experiment, accept that marker-only components may need flat
`templateVars` for pass-through shapes — or extend collection to inspect JSX
prop assignments (`badges={ product.badges }` → `products[].badges`).

### Primitive root lists — correctly flagged as a gap

`tags[]` rendered as `{ tags }` has no marker equivalent distinct from scalar
`{ $$tags }`. The plan's `.map()`-only workaround is honest. Do not attempt
silent inference; it would conflate scalar replace with list shape.

---

## Gaps versus current e2e fixture coverage

Current fixtures under `fixtures/e2e/`:

| Fixture | Marker parity difficulty | In plan? |
| --- | --- | --- |
| `basic-replace-input` | trivial | no (should add) |
| `flat-template-vars` | medium | yes |
| `nested-template-vars` | high | yes |
| `full-template-surface` | high | yes (partial) |
| `list-object-controls` | low–medium | no |
| `deferred-resolution` | very high | **no** |

### `flat-template-vars`

Requires:

- nested object path (`$$hero.summary`)
- multi-role scalar (`$$status` replace + control)
- list inference + child `ProductLink` with its **own** markers or flat assignments
- list root control: `$$products && <section>` while list render uses alias

Good early parity target after scalar/control spike.

### `nested-template-vars`

Requires triple-nested list path inference and nested child `Badge` component
boundaries. This is the definitive test for list discovery quality. Should remain
phase 2+, not phase 1.

### `full-template-surface`

Exercises many roles simultaneously: map-assignment alias (`renderedBadges`),
multi-control product fields, nested badges inside `ProductCard`, child
components, hidden input replace paths. Marker duplication must decide:

- mark only `App` and keep flat `templateVars` on `ProductCard` / `Badge` during
  experiment, **or**
- mark every component independently (purer test, more syntax noise)

Both are valid; the plan should state which parity mode the fixtures use.

### `deferred-resolution` — critical missing fixture

This fixture stress-tests features marker mode is most likely to miss:

- destructure alias (`const { title: heading } = heroAlias`)
- optional chaining (`heroAlias?.summary`)
- filter chain before map (`products.filter(...).map(...)`)
- nested list inside map with inner filter/map
- reassigned map alias
- helper call rendering (`renderHelperProducts(products)`)
- spread props child (`<ProductCard {...product} />`)

If marker mode never duplicates `deferred-resolution`, parity claims remain
weak. **Recommendation:** add it to the e2e parity list with explicit
sub-bullets for patterns that remain flat-only during the experiment.

### `list-object-controls`

Simple list + footer control. Good phase-2 gate between `flat-template-vars` and
`nested-template-vars`.

---

## Test plan strength

The proposed unit and e2e tests are a solid skeleton. Strengthen them as follows.

### Unit tests to add

- **strip pass**: `$$hero.summary` AST → `hero.summary` before controllers run
- **optional chaining** marker roots
- **unary/binary controls** (`!$$visible`, `$$status !== 'archived'`)
- **list root control** without marked `.map()` on same node (`$$products && ...`)
- **filter/map chain** on marked root
- **map assignment alias** with marked source only on root
- **helper call** with single marked list argument
- **nested map** three deep (minimal synthetic component)
- **JSX prop inference** for `` `foo={ item.bar }` `` → `items[].bar`
- **coexistence merge** — flat + marker declarations merge; conflicting shapes error
- **discovery negatives** — helper with JSX, nested function, non-component arrow
- **child component isolation** — parent markers do not auto-declare child paths
- **output hygiene** — transformed source contains no `$$` identifiers when option enabled
- **disabled mode** — `experimentalDollarMarkers: false` leaves `$$foo` untouched

### E2e tests to add

- `basic-replace-input` marker clone (smoke)
- `list-object-controls` marker clone
- `deferred-resolution` marker clone with explicit pending tests for known gaps
- split fixtures: `App`-only markers + flat child components vs fully marked tree

### Known parity gap tests (explicit pending)

The plan mentions primitive root lists. Also add explicit pending/failing tests for:

- pass-through list props without usage in declaring component
- shape-only declarations with no marker occurrence
- helper bodies that consume marked arguments (unless call-site mark is sufficient)
- any `deferred-resolution` pattern not yet implemented

Use Vitest `it.fails` or tagged pending tests so gaps are visible in CI during
the experiment branch.

---

## Edge cases by topic

### Controls

- Multi-role (`replace` + `control`) is documented; add **control-only** paths
  (`$$visible && ...` without `{ $$visible }`).
- Ensure stripped AST still matches `tagControlArgs()` for comparison operators;
  marker collection should not be the sole control detection path.
- Ternary controls (`$$featured ? ... : ...`) appear in fixtures but not in the
  plan's control examples — add them.

### Nested lists

- Confirm nested list metadata (`contextDepth`, `__context__` injection) works
  when list declarations are synthesized rather than authored.
- Nested child components inside deeply mapped JSX (`Badge` inside
  `product.badges.map`) rely on existing context injection — marker mode should
  not special-case this if child declares its own contract.

### Helper aliases

- Single-source helper calls should work when the argument root is marked
  (`renderHelperProducts($$products)` → strip → existing helper analysis).
- Multi-root helper calls should use existing `diagnostics.unsupported()` — the
  plan mentions this; add a unit test mirroring `full-template-surface` /
  `deferred-resolution` patterns.

### Child components

- Align with `docs/template-vars.md`: template contracts are component-local.
- Marker mode must not infer child component declarations from parent JSX alone
  except by reading prop values as **path hints** for the parent's list item shape.
- Recommend experiment fixtures that keep flat `ProductCard.templateVars` until
  child marker syntax is tested independently.

### Multi-role variables

- Scalar multi-role is covered.
- Add list multi-role: control + list on same root (`$$products` in both
  existence check and `.map()` / alias render).
- Object-list pass-through props may create multi-segment paths without multi-role
  on the root — different problem, still needs coverage.

---

## Complement vs replace

| Mode | When |
| --- | --- |
| **Complement (recommended now)** | Pass-through shapes, primitive lists, helper-heavy modules, shared data-contract headers via flat `templateVars` |
| **Replace (possible later)** | Components where every exposed path appears in JSX/control/list usage the plugin already understands |

Full replacement would require:

- accepted parity gaps **or** additional syntax (e.g. shape-only comments/markers)
- migration tooling from flat strings to marked usage
- stable discovery for common export patterns
- a breaking major release note

The plan's stance — experiment complements flat API, merge through registry,
breaking replacement deferred — is correct. Issue #14's ergonomics goal is met
by **complement** alone for the common case (scalars, nested members, direct
maps). Replacement is a product decision, not a technical inevitability.

---

## Recommendations for the draft PR spike

1. **Implement `parseMarkerIdentifier` / `parseMarkerPath` helpers + unit tests**
   before touching the visitor.
2. **Add discovery + strip + registry wiring** behind `experimentalDollarMarkers`.
3. **First e2e parity:** marker clone of `basic-replace-input` + `flat-template-vars`
   (App marked, children flat).
4. **Second wave:** `list-object-controls`, then `nested-template-vars`.
5. **Third wave:** `full-template-surface` and a **partial** `deferred-resolution`
   fixture with explicit pending tests for gaps.
6. **Do not parse `node_modules`** — discovery and marker collection should
   respect the same file boundaries as language import injection in `index.js`.
7. **Document reserved identifiers and parity gaps** in the experiment PR description,
   not in shipped user docs until release candidacy.

---

## Bottom line

Proceed with the experiment. The registry-first architecture preserves the
investment in `0.1.0-beta.0` and keeps PHP/Handlebars output paths stable. The
plan's success criteria (e2e parity, not toy examples) are exactly right.

Before calling marker mode "parity-ready", require:

- marker strip in transformed output
- marker clones of **all six** existing e2e fixtures or documented exceptions
- explicit pending tests for primitive lists and pass-through shapes
- discovery negative tests
- a written decision on child component marker strategy in parity fixtures

Marker syntax can realistically infer nested object and list paths for **rendered**
usage patterns the flat API already supports. It is unlikely to fully replace
flat `templateVars` without keeping it for shape-only, pass-through, and
helper-adjacent cases — and that split is a reasonable long-term design.
