# Review: store selector hierarchy tracing plan

Critical review of [`store-selector-hierarchy-tracing.md`](./store-selector-hierarchy-tracing.md)
against the shipped implementation (collector, registry, controllers, e2e
fixtures) on `experiment/store-selector-data-contract`.

**Verdict:** Direction is sound; phase sequencing and the "metadata transfer"
framing hide the one hard problem — every phase past A needs *child-body usage
discovery*, which the collector cannot currently do. Fix that framing and the
B-before-C ordering before coding. Registry/controller reuse is genuinely clean.

---

## Three lenses (per request)

- **Neutral:** The plan correctly keeps tracing static and registry-first, and
  its non-goals match real static-analysis limits. But it describes the *output*
  (synthesized paths) more than the *new mechanism* (reading a second
  component's body to synthesize them), so it reads easier than it will build.
- **Devil's advocate:** The flagship parity fixture (`store-selector-complex-surface`)
  proves almost nothing about tracing — it byte-matches while emitting 9
  "unsupported" warnings and tracing zero list-item fields (evidence below).
  Phase C, not B, is the case real React code hits, yet C is sequenced last of
  the same-file phases and its mechanism is materially different from B's.
- **Encouraging:** The hard architectural boundaries already hold — controllers
  are selector-agnostic (one line: `controller.js:122`), the registry is reused
  unchanged, and fail-closed guards exist. The seedable-discovery refactor below
  is contained, and once it lands B–E become small increments.

---

## Findings by severity

### S1 — Every phase past A needs child-body usage discovery; the plan never names it

The guiding model `… -> child prop binding -> child usage` makes the last hop
look passive. It is not. Phase A works because the **full path is known in the
parent**: `title = state.hero.title`, so `title={ title }` carries `hero.title`
and the child only needs an alias `title -> hero.title`
(`createStoreSelectorPropAliases`, `store-selector-template-vars.js:86`).

Phase B breaks this. `hero={ hero }` carries only the root `['hero']`. Which
members become template vars (`hero.title`) is decided **inside the child body**,
which nothing currently reads. `createStoreSelectorPropAliases` only inspects the
child's *param pattern* (`:97`, `findObjectPatternBindingPath` `:132`) and
declares the *passed* path. Confirmed failure if shipped as-is:

```jsx
const App = () => { const hero = useStoreSelector(s => s.hero); return <Header hero={ hero } />; };
const Header = ({ hero }) => <h1>{ hero.title }</h1>;
```

→ Header's `combinedTemplateVars` would be `['hero']` (scalar), and the replace
controller rewrites the `hero` base → `{{hero}}`, not `{{hero.title}}`.

**Only the collector synthesizes member paths from usage** (`collectAliasUsage`,
`:377`). But `collect()` (`:196`) is hard-seeded from selector calls
(`collectSelectorAssignments` `:237`). Phase B/C need to run that same discovery
seeded from an **incoming prop alias** instead.

> Recommendation: before any new phase, extract a seedable discovery core
> (`collectLocalAliases` + `collectMapShapes` + `collectAliasUsage`) that accepts
> either selector assignments *or* a seed alias `{ paramBinding -> segments }`.
> This is the real Phase B/C/E primitive and the central architecture decision.
> Note `collect()` runs `collectLocalAliases`/`collectMapShapes` twice (`:203-206`)
> as an undocumented fixpoint — child discovery likely needs the same; comment it.

### S2 — "Phase C reuses B's model + list context depth" is wrong; the synthesis is structurally different

For object roots (B) the child emits **canonical** paths (`hero.title`). For list
items (C) the child must emit **relative** paths (`name`) tagged with an inherited
**list context depth**, *not* canonical `products[].name`. If C synthesizes
`products[].name` into the child, the registry treats `products` as a list root
*inside the child* and emits a second `{{#products}}` / `foreach` — double
wrapping, because the list block is owned by the parent's `.map()` site, not the
child. The child renders item-relative content at runtime via `__context__`
injection (`controller.js:168`, registry `contextDepth`/`itemContextDepth`).

The prior review already flagged this (`store-selector-data-contract-review.md:302`);
the new plan drops the insight and frames C as B-plus-depth. It is a different
code path: relative-path synthesis + context-depth carry vs canonical synthesis.

> Recommendation: design the seedable-discovery seed to carry a context-depth /
> "relative root" marker from day one, and validate the engine against C's
> constraints even if B lands first. Otherwise B's abstraction will be redesigned
> for C.

### S3 — The parity fixture masks that list-item tracing is completely unproven

`store-selector-complex-surface` is cited in "Current State" as byte-matching
`full-template-surface`. Measured output of App's synthesis:

```
declarations: ["products[]","status","summary","title","visible"]   // bare list, no item fields
unsupported:  products[].name, .price, .url, .badges, .available, .featured, .mode, .status, .tone  // 9 warnings
```

All 9 per-item fields render **only** because `ProductCard.templateVars` is still
explicit and ProductCard inherits list context. The selector path does ~half the
work. So:

- No regression fixture exercises list-item tracing at all. A Phase C bug cannot
  be caught by current fixtures.
- The plan's Phase C risk note ("touches the same behavior as the parity
  fixture") is backwards — the fixture *avoids* that behavior.

> Recommendation: the real Phase C gate is a **new fixture with NO explicit child
> `templateVars`**, byte-matching `full-template-surface`. Until that exists,
> "parity" overstates selector maturity in the Current State section.

### S4 — Traced-field vs child's own `templateVars` collision is undefined

Once C traces `products[].name` into `ProductCard`, ProductCard may *also* declare
`name` (as complex-surface does today). Two sources for the same child path. The
plan raises this as review Q2 but does not decide. Options: traced replaces
explicit / merge / error on conflict. Undecided = silent double-declaration or
registry conflict at implementation time.

> Recommendation: decide before C. Suggest: explicit child `templateVars` wins and
> suppresses tracing for that prop (least surprising, keeps escape hatch), with a
> debug note when tracing is shadowed.

### S5 — `warnOnUnsupported: false` silently drops selector data, contradicting the plan's own "Never" clause

Diagnostics policy says *never silently drop selector-derived data without debug
metadata*. But `diagnostics.unsupported` returns silently when
`warnOnUnsupported === false` (`diagnostics.js:24`), debug is off by default, and
the test at `store-selector-template-vars.test.js:551` confirms `<h1></h1>` with
no warning. Also, "fail closed when output would be broken" conflates two cases:
neutralization turns dropped selectors into `{}`/`[]` (`:730`), so output is
*valid but semantically empty* — not "broken" (no dangling id), yet wrong.

> Recommendation: (a) always record machine-readable unsupported metadata even
> when warnings are suppressed; (b) separate "broken" (dangling/ref-after-removal,
> already guarded by `assertNoUnprocessedStoreSelectorReferences` `:154`) from
> "lossy" (empty output) in the policy and in tests.

### S6 — Safety lives in boundary enumeration, not the transfer metaphor

"Metadata transfer, not React simulation" is the right model, but its safety
depends entirely on detecting *every* shape that leaves the static-transfer
subset and failing closed. Missing from the plan's per-phase risks: multi-source
props `x={ a && b }`, conditional props `x={ cond ? p : q }`, template-literal
props, the same prop passed to two children, and the same child rendered both
inside and outside a list (context-depth ambiguity). One missed shape →
mis-synthesis, not a clean warning.

> Recommendation: add a "boundary catalog" — explicit list of unsupported JSX/expr
> prop shapes, each with a fail-closed test — as a precondition for B.

---

## Answers to the seven questions

| # | Question | Answer |
| --- | --- | --- |
| 1 | Agree with | Metadata-transfer model; registry/controller reuse; fail-closed + strict-for-CI; non-goals list; defer F/G; cycle guard for E; debug-metadata growth direction. |
| 2 | Disagree with | "C = B + depth" (S2); Current-State "parity" implying tracing maturity (S3); B as a clean prerequisite that generalizes to C (S1/S2); transfer-metaphor as the safety story (S6). |
| 3 | Risks/bad assumptions | S1–S6. Core bad assumption: phase order = complexity order. B is *simpler surface* but its mechanism doesn't subsume C; C is the *common, valuable* case and drives the harder constraints. |
| 4 | Phase boundaries | Mostly right. **B and C should be designed together** (shared seedable discovery; C drives the seed shape). **D is partly already done** — `findObjectPatternBindingPath` (`:132`) + `registerPatternAliases` (`:603`) handle `{item: product}` rename and nested destructure for the *alias* step; D's remaining work is gated on B's child discovery, so D can fold into B/C rather than be its own phase. E correctly later; reuse `getTopLevelComponentPaths` (`visitor.js:292`) for the component map. F/G correctly deferred. |
| 5 | Missing tests/fixtures | See per-phase list below. Biggest gap: a tracing parity fixture with **no explicit child `templateVars`** (S3). |
| 6 | Architecture preserved | **Controllers: yes, clean** — sole touchpoint is `registerExternalPathAliases(config.storeSelectorAliases)` (`controller.js:122`); controllers never see selectors. **Registry: yes** — reused via synthesized flat strings. **Collector: no** — it is hard-seeded from selector calls and is where the strain lands (S1). The refactor is collector-local, so the clean boundaries survive. |
| 7 | Next phase + gates | Do a **refactor slice first** (seedable discovery + boundary catalog + collision policy), then **Phase B**, designed C-ready. Gates below. |

### Missing fixtures/tests per phase

- **Refactor slice:** seedable-discovery unit tests (seed = prop alias) producing
  the same declarations the selector path would; boundary catalog negatives
  (spread, conditional, multi-source, template-literal props) all fail-closed.
- **Phase B:** object root → child member (`hero.title`); child alias
  `const heading = hero.title`; child destructure `const { title } = hero`;
  control `hero.status === 'published'` in child; dead prop (passed, never used)
  → no synthesis, no dangling; computed child read `hero[key]` → warn/throw.
- **Phase C:** the no-explicit-child-`templateVars` parity fixture (S3);
  double-wrap regression (child must NOT emit its own `{{#products}}`);
  `$data_1`/`$data_2` depth e2e (plan has this); nested `product.badges.map` depth
  composition (incoming depth 1 + child map → 2); collision with child's own
  `templateVars` (S4); same item prop to two child components.
- **Phase D:** prop rename, child destructure rename, nested static destructure,
  default value, **rest destructure rejected**.
- **Phase E:** 2-hop, 3-hop, sibling components same path, cycle, dynamic
  component variable rejected; two same-named components.
- **Phase F:** named import, unresolved-import diagnostic, barrel/re-export
  unsupported, no `node_modules` traversal.

---

## Special-attention items

- **Metadata transfer vs React simulation:** right model, wrong safety story.
  Reframe as "static transfer with exhaustive fail-closed boundary detection"
  (S6) and acknowledge child-body discovery (S1).
- **B before C:** defensible for de-risking *only if* B is built on the shared
  seedable engine designed against C's constraints (S1/S2). If object-root→child
  has no real use case (plan's own review Q1), treat B as an internal stepping
  stone, not a shippable feature, and make C the acceptance target.
- **C safeguards (aliases/nested maps/child boundaries):** test list is right but
  misses the central hazards — relative-vs-canonical synthesis/double-wrap (S2),
  field/`templateVars` collision (S4), and nested-map depth composition.
- **Diagnostics strict enough:** no — silent-drop path (S5). Fail-closed
  *reference* guard is good; lossy-but-valid output is the hole.
- **Debug metadata sufficient:** close, but add **per-synthesized-path
  provenance** (which prop/param/component chain produced each path), keyed by the
  declaration. Hop count + source/target (already proposed) are not enough to
  debug a missing path in multi-hop E.
- **Phase needing broad cross-component analysis early:** yes — **Phase B already
  reads the child component body** (S1). It is bounded (1 hop, same file, seeded),
  not "broad," but the plan's framing implies B stays single-component. State the
  bound explicitly.

---

## Recommended next step (concrete)

1. **Refactor slice (no new user-facing tracing):** extract seedable usage
   discovery from `StoreSelectorCollector`; add the boundary catalog with
   fail-closed tests; decide the traced-vs-`templateVars` collision policy (S4);
   make unsupported metadata always-recorded (S5).
   - Pass/fail: all 118 existing tests green; seedable discovery reproduces
     selector-path declarations from a prop-alias seed in unit tests; every
     boundary-catalog negative warns/throws (never mis-synthesizes).
2. **Phase B**, built on that engine, C-ready seed shape.
   - Pass: B fixtures above green; **strict mode throws** on every unsupported B
     boundary; no `useStoreSelector`/dangling refs survive
     (`assertNoUnprocessedStoreSelectorReferences`); debug shows per-path
     provenance.
   - Fail/stop: if B needs the parent collector to reach into the child body
     directly (instead of seeded child-side discovery), stop — that is the
     cross-component creep the plan means to avoid.
3. Only then **Phase C**, gated on the no-explicit-child-`templateVars` parity
   fixture byte-matching `full-template-surface` and the double-wrap regression.
