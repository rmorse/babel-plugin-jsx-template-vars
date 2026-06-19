# Review: store selector callsite specialization research

## Status

Superseded historical review.

This review was written against an earlier specialization-first version of
[store-selector-callsite-specialization-research.md](./store-selector-callsite-specialization-research.md).
The active source of truth is now
[store-selector-multi-source-path-plan.md](./store-selector-multi-source-path-plan.md).

The specialization-first verdict below has been overridden by later review and
planning. Current direction is:

1. make unsafe multi-source ambiguity hard-fail
2. validate template-render-time root descriptor composition
3. prove relative object-root path-polymorphism without component cloning
4. keep callsite-specific specialization as a conditional fallback

This file is retained only as audit history for the review process.

---

Critical review of
[`store-selector-callsite-specialization-research.md`](./store-selector-callsite-specialization-research.md)
against the shipped store-selector implementation on
`experiment/store-selector-data-contract` (collector, cross-file manifest,
registry, controllers, and existing tests).

**Verdict:** The problem diagnosis is accurate, the path-vs-shape split is the
right framing, and callsite-specific specialization is the best fit for the
existing seed/context architecture. Keep fail-closed behavior until
specialization lands. Start with same-file path specialization only. Defer shape
polymorphism. The document is ready to guide implementation after a few
clarifications below — especially that ambiguity is not cross-file-only, that
specialization keys must cover multi-hop and list-context inputs, and that
partial parent-side scalar materialization already exists today.

---

## Executive summary

| Area | Assessment | Recommendation |
| --- | --- | --- |
| Problem framing | Strong | Accept as the motivating limitation |
| Path vs shape distinction | Strong | Keep as separate research/implementation gates |
| Callsite specialization architecture | Best fit | Investigate first; avoid binding maps |
| Fail-closed interim policy | Correct | Keep until specialization is proven |
| Same-file first slice | Correct sequencing | Implement before cross-file manifest rewrites |
| Cross-file manifest sketch | Directionally sound | Needs concrete variant-emission and import-rewrite design |
| Specialization key design | Mostly right | Extend for multi-hop, list depth, and stable IDs |
| Shape polymorphism deferral | Correct | Do not combine with first path-specialization proof |
| Debug metadata requirements | Strong | Treat as mandatory for the first slice |
| Acceptance gates | Comprehensive | Add conditional-source and explicit-templateVars cases |

---

## What works well

### Problem diagnosis matches the implementation

The document correctly identifies why the current single-seed model cannot
represent reusable child components fed from multiple canonical roots. Cross-file
manifest behavior is exactly as described: conflicting sources for the same
child binding mark the seed ambiguous and suppress it entirely
(`addManifestSeedAlias`, `store-selector-cross-file.js:405-439`). The Header /
HomePage / ArticlePage example is the canonical motivating case.

### Path polymorphism vs shape polymorphism is the key insight

Separating "same local contract, different canonical path" from "same prop name,
different output shape" is the most valuable part of the document. The
shape-polymorphism section correctly explains why `{ value }` alone cannot prove
scalar replacement vs primitive-list wrapping, and why that requires different
Handlebars/PHP output forms. Deferring shape specialization until path
specialization is proven is the right call.

### Callsite specialization fits the existing architecture

The "metadata transfer, not React simulation" model from hierarchy tracing
extends naturally to specialization:

```txt
one authored component + N incoming trace contexts -> N seeded child transforms
```

This preserves:

- normal React authoring and reusable child components
- selector-agnostic registry/controllers
- the existing seed-alias discovery core
- explicit debug provenance per compiled variant

Alternative 2 (runtime/template binding maps) would leak selector semantics into
output generation and complicate static PHP/Handlebars. Alternative 3
(parent-side materialization) is correctly scoped as a fallback, not the main
architecture. Alternative 1 (fail closed) is correctly treated as interim, not
final.

### Phased implementation plan is sensible

The recommended first slice — same file, one child, two object-root callsites,
Handlebars + PHP, debug metadata, no cross-file rewriting — is the smallest proof
that validates the core compiler model before taking on manifest coordination,
import rewriting, and bundler-facing export questions.

### Acceptance gates and debug requirements are strong

The path-specialization acceptance list covers deduplication, multi-hop relay,
list-item contexts, no last-wins, orphaned declarations, and parity with
existing non-specialized fixtures. Requiring callsite -> specialization ->
compiled-path debug metadata is essential; without it, specialization will be
effectively unreviewable.

---

## Issues and gaps

### S1 — Ambiguity is not only a cross-file problem

The document frames the limitation primarily through cross-file reuse
(HomePage vs ArticlePage), but the same conservative rule already applies
same-file. When a child prop receives multiple canonical sources, prop/seed
tracing is disabled if `sourcePaths.size > 1`
(`createStoreSelectorPropAliases`, `store-selector-template-vars.js:117-122`).

Existing tests confirm this:

- relay through `Shell` with `primaryHero` and `secondaryHero` fails closed on
  child-body tracing
- `Card` receiving `featured.name` and `secondary.name` warns on ambiguous child
  sources even in one parent file

The research doc should state explicitly that specialization solves a **global
per-component-binding** limitation, not a cross-file-only one. Cross-file is the
most visible authoring pattern, but same-file multi-callsite reuse has the same
root cause.

### S2 — Parent-side scalar materialization already partially works

The "Parent-Side Materialization" section describes this as a future fallback, but
the codebase already materializes some ambiguous scalar cases at the parent:

```txt
<Card name={ featured.name } />  ->  {{featured.name}}
<Card name={ secondary.name } />  ->  {{secondary.name}}
```

Output is correct for bare replacement, while child tracing still warns and
fails closed for controls (`store-selector-template-vars.test.js:1563-1618`).
That nuance matters for prioritization:

- path specialization is **required** for object-root child usage such as
  `hero.title`
- path specialization is **less urgent** for scalar member props already
  materialized at the parent, though child controls still need specialization or
  another strategy

Call this out so implementers do not over-engineer the first slice around cases
parent materialization already covers.

### S3 — Specialization keys are underspecified for multi-hop and list context

The proposed key includes file, component, prop name, canonical path,
declaration path, shape, and list depth — good for direct parent -> child edges.
It is not yet sufficient for:

- **Multi-hop relay chains** such as `App -> Shell -> Header`, where the
  specialization identity depends on the full incoming alias set at the child
  boundary, not only the immediate parent's prop expression
- **List-context variants**, where two callsites may share the same canonical
  path but differ in inherited list depth or declaration relativity
- **Dedup safety**, where gate #3 ("same canonical source deduped to one
  specialization") must not collapse contexts that share a path but differ in
  list depth or declaration segments

Recommendation: define the specialization key as a normalized **incoming trace
context** (full prop alias bundle + inherited list context), not as a single
prop/path pair. Stable IDs should derive from hashed canonical context, not from
local binding names like `homeHero` in the sketch — local names are
authoring-dependent and can collide across files.

### S4 — Open questions on variant emission need a provisional lean

The cross-file sketch raises where specialized variants live, whether they are
exported, and how imports are rewritten — but does not recommend a default.
Without a lean, implementers will stall.

For this codebase, the most consistent default is:

1. emit internal specialized variants in the **child file** during transform
2. treat them as **non-exported** compiler artifacts unless a test harness needs
   explicit names
3. rewrite **parent callsite tags and imports** via manifest metadata during
   per-file transform
4. keep authored source unchanged; only transformed output references variants

Production bundler concerns remain real, but they are downstream of proving the
model in the test harness — the doc should say that explicitly rather than leave
all four questions fully open.

### S5 — Missing edge cases in acceptance gates

The acceptance lists are strong but omit a few cases that will appear quickly in
real code:

| Case | Risk if omitted |
| --- | --- |
| Conditional prop source (`cond ? a : b`) at one callsite | Ambiguous trace within a single callsite |
| Same child inside and outside a `.map()` in one parent | Mixed list-context and object-root specialization |
| Explicit child `templateVars` on a specialized base component | Collision with traced declarations (see hierarchy-tracing review S4) |
| Specialized child used as control/list, not just replacement | Role-specific output must vary per specialization |

Add at least conditional-source and explicit-`templateVars` cases to the
path-specialization gate list before implementation starts.

### S6 — Shape section slightly overstates current path-specialization scope

Gate items 5–6 (list-item props, nested list object-field props) belong in path
specialization, but they already depend on shape/context metadata in the
specialization key. The doc correctly lists shape in the key, but the "same-file
first slice" recommendation narrows to object-root props only. Clarify that the
**first proof** is object-root only, while the **path-specialization program**
still includes list-relative variants as a fast follow — otherwise readers may
think list-item multi-source reuse is out of scope entirely.

### S7 — Question 12 can be answered now

"Would supporting multiple canonical sources hide real user/component architecture
errors?" — largely no, if diagnostics remain fail-closed for true contract
mismatches:

- wrong prop name (`user={ hero }` vs reading `hero.title`) still fails because
  no seed connects `user` to `hero`
- wrong local usage (`props.hero` with destructured `{ hero }`) remains an
  unsupported boundary
- multiple valid paths to the same child do not rescue invalid wiring; they only
  remove the false conflict between valid callsites

Document this answer so reviewers do not treat multi-source support as a
semantic loosening.

---

## Architecture recommendations

### 1. Adopt callsite-specific specialization as the primary direction

Yes — it is the architecture most consistent with the seedable discovery model
already shipped. It avoids new runtime/template binding concepts and keeps
registry/controllers unchanged.

### 2. No simpler model without specialization

The doc's three alternatives cover the realistic design space. The only
meaningfully simpler option is continued fail-closed behavior plus
parent-side scalar materialization for one-hop replacements. That does not solve
object-root child usage, list-item children, controls, or multi-hop relay. There
is no simpler full solution.

### 3. Specialization key = normalized incoming trace context

Prefer:

```json
{
  "baseComponent": "Header",
  "file": "Header.jsx",
  "incomingContextKey": "sha256(normalized aliases + list depth + declaration relativity)",
  "incomingAliases": [ ... ]
}
```

Do not key primarily on local binding names (`Header__homeHero`). Use those only
as human-readable debug labels.

### 4. Dedup aggressively but only on full context equality

Two callsites should share one specialization when their **full incoming trace
contexts** are identical — same canonical segments, declaration segments, list
depth, and prop shape role. Same canonical path with different list depth must
remain distinct.

### 5. Keep shape polymorphism deferred

Do not combine shape-polymorphic specialization with the first path proof unless
a zero-ambiguity evidence source is identified (explicit `templateVars[]` hint,
visible `.map()` at callsite, or future schema metadata). Bare `{ value }` should
stay scalar/default or fail closed per the doc's policy.

### 6. Treat debug metadata as part of the first slice, not a follow-up

The proposed debug payload (`specializations`, skip reasons, hop-by-hop
provenance) should be implemented alongside the first same-file proof. Specialization
without skip-reason telemetry will recreate the ambiguity confusion in a more
complex form.

### 7. Reuse existing bounded fixed-point and cycle machinery

Same-file auto-seeding already uses a bounded pass keyed by component count
(`store-selector-cross-file.js:26-83`, same-file analog in template-vars flow).
Specialization generation should hook into that pass rather than invent a second
graph walk. Document the integration point when implementation starts.

---

## Answers to the document's open reviewer questions

| # | Question | Review answer |
| --- | --- | --- |
| 1 | Is callsite-specific specialization the right architecture? | **Yes** — best fit for current seed/context model |
| 2 | Is there a simpler model without cloning? | **Not for the general case** — materialization covers scalar one-hop only |
| 3 | Variants in child file, parent file, or manifest-only? | **Child-file internal variants + manifest-driven parent rewrites** for first implementation |
| 4 | Cross-file import/callsite rewriting? | Manifest emits `callsiteRewritesByFile`; per-file transform applies rewrites before seeding |
| 5 | Stable specialization key? | Hash of normalized incoming trace context, not component name or local binding |
| 6 | Dedup aggressiveness? | Dedup only on full context equality; never by component name alone |
| 7 | Acceptable generated code growth? | Acceptable for template compilation; gate with dedup and internal non-exported variants |
| 8 | Registry/controller boundary preserved? | **Yes**, if specialization only changes seed inputs per variant |
| 9 | Additional PHP context-depth risks? | Test nested list object-field props and multi-hop relay under specialization |
| 10 | Shape polymorphism now or later? | **Later** — after path specialization is proven |
| 11 | Evidence for bare `{ value }` as primitive list? | Require explicit evidence; default scalar/fail-closed |
| 12 | Hide user architecture errors? | **No**, if prop-contract mismatches remain fail-closed |
| 13 | Keep ambiguous cross-file seeds fail-closed until specialization lands? | **Yes** |
| 14 | Smallest safe first slice? | Same-file, one child, two object-root callsites, replacement output, HBS+PHP, full debug metadata |

---

## Recommended edits to the research doc (optional)

These are small clarifications, not blockers:

1. Add a note that same-file multi-callsite ambiguity has the same root cause as
   cross-file ambiguity.
2. Document the existing partial parent-side scalar materialization behavior and
   its limits (replacement yes, child controls no).
3. Refine specialization ID examples to prefer context-derived IDs over local
   binding names.
4. Add a provisional lean for cross-file variant emission (internal child-file
   variants + manifest rewrites).
5. Answer open question 12 inline.
6. Add conditional-source and explicit-`templateVars` cases to acceptance gates.

---

## Bottom line

Proceed with callsite-specific path specialization as the next architecture
investigation. The research document is sound, appropriately cautious, and aligned
with the codebase. Keep fail-closed ambiguity suppression in place, implement the
same-file object-root proof first, and treat shape polymorphism as a separate
gate with stricter evidence requirements. The main improvements are clarifying
scope (same-file + cross-file), specialization key design for multi-hop/list
context, and acknowledging partial mitigations that already exist today.
