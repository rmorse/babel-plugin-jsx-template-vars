# Review: flat template vars and autodetection plan

Pressure-test of
[`flat-template-vars-and-autodetection.md`](./flat-template-vars-and-autodetection.md)
against the current plugin implementation (visitor bucketing, three controllers,
language presets, `__context__` depth, and existing tests/fixtures).

**Verdict:** The direction is sound — flat paths plus a normalized registry with
multi-role usage is the right long-term model. The phased rollout is sensible as
an internal build sequence. **Assumption:** nothing ships until all phases are
complete; intermediate stages exist to lock foundations, not to expose partial
APIs.

That release strategy **does not remove** the technical gaps below — they must
still be resolved before the single release. It **does** change how several
findings should be read: interim replace-only behavior, partial inference, and
legacy shims are acceptable *during development* but must not survive as the
shipped architecture or documented public contract.

The biggest **ship-blocking** risks remain: (1) compiling flat paths into legacy
list config and never replacing it, (2) treating declaration shape (`products[]`)
as equivalent to usage role (list wrapping), (3) assuming dotted paths are
mostly a language-output problem when they also require AST matching and
controller changes throughout, and (4) nested list examples in the plan that
exceed today's one-level context machinery unless a later phase explicitly builds
that machinery.

---

## Release strategy: what changes in this review

| Finding | Partial-release reading | Full-release-only reading |
| --- | --- | --- |
| Flat strings are replace-only until Phase 3 | User-facing gap; document interim limitations | Internal sequencing only; fine until Phase 3 lands, not a public concern |
| Opt-in inference / phased major version | Needed to protect users mid-rollout | One migration at release; document breaking changes once, not per phase |
| Phase 1 → legacy list compile | Risky if users adopt early | Acceptable **temporary** shim if removed before release |
| Narrow v1 grammar / defer deep paths | Scope cut for first public API | Scope cut for **the release** unless a phase explicitly delivers deep lists |
| Interim docs saying "replace-only for now" | Required | Unnecessary; docs can describe the finished API only |
| Duplicate UIDs across phases | User-visible bug if any phase ships | Internal test debt; still fix before release, less urgency mid-sequence |
| Semantic change when inference lands | Breaks existing apps incrementally | Breaks existing apps **once** at release — still worth cataloguing |

**Bottom line:** phasing lowers **external migration** risk but not **internal
architecture** risk. The review's structural recommendations (registry-first,
path ↔ AST resolution, single UID per path, language arg extensions) still
apply; several "document the interim gap" and "opt-in flag" items become
release-note items instead.

---

## Executive summary

| Area | Ship-blocking? | Recommendation |
| --- | --- | --- |
| Flat `products[].badges[].label` | Yes, if in release grammar | Either add explicit deep-list phase before release or cut from release grammar |
| Phase 1 → legacy list compile | Yes, if it becomes final | Fine as interim shim; registry must be the architecture that ships |
| Multi-role (`status` replace + control) | Yes | Single UID per path before release; Phase 4 remains required, not optional polish |
| Object paths (`hero.title`) | Yes | Path-aware AST matching + language arg shape change, not just PHP/Handlebars presets |
| Role inference (Phase 3) | Yes | Must be complete and tested before release; no opt-in needed for internal phases |
| `__context__` depth | Yes, for nested flat paths | Redesign required if `products[].badges[].label` is in the release API |
| Custom languages | Yes | Add structured path args; one-time custom-language migration note at release |
| Aliases (`renderedProducts`) | Yes, if flat API replaces legacy | Resolve via map-assignment inference or keep legacy escape hatch in release docs |

---

## Holes in the model

### 1. Declared path ≠ JSX identifier

The flat API declares **data paths** (`products[].title`, `hero.media.url`). The
transform operates on **identifiers and member expressions in component scope**
(`title`, `hero.title`, destructured bindings).

Today:

- `ReplaceController` explicitly skips `MemberExpression` parents — only bare
  identifiers are rewritten.
- `ControlController.getExpressionStatement` uses `getExpressionArgs`, which
  flattens member access to a single `"object.property"` string and does not
  walk nested chains (`hero.media.url`).
- Control matching checks `this.vars.names.includes(arg.value)` against **root
  names only**, not normalized paths.

So Phase 2 is not “emit `$data['hero']['title']` instead of `$data['hero.title']`”.
It requires a **path resolution layer**: given a declared path and an AST node,
decide whether they refer to the same template binding — including destructuring,
renames (`{ title: headline }`), and intermediate locals
(`const h = hero; h.title`).

**Gap in plan:** No phase covers path ↔ AST binding. Without it, flat declarations
parse correctly but never attach to usage sites except for root identifiers.

### 2. Multi-role registry vs mutually exclusive buckets (ordering)

The plan’s target registry allows multiple roles per path. The current pipeline
still partitions at parse time in `visitor.js`:

```js
if (varConfig.type === 'replace' || !varConfig.type) {
  templateVars.replace.push(normalisedProp);
} else if (varConfig.type === 'control') { ... }
```

Until Phase 3–4 land, a flat string like `'visible'` defaults to **replace only**
internally. That is acceptable while phases are incomplete, but it must not be
what ships: at release, `{ visible && ... }` must infer or assign control without
requiring duplicate declarations.

**Gap in plan:** No explicit checkpoint that Phase 4 is release-blocking. Add a
“release gate” test suite covering multi-role paths before any public cut.

### 3. List role from `[]` in declaration vs from `.map()` usage

The plan assigns list role when:

- the root path has `[]` in its flat declaration, **or**
- the root path is the receiver of `.map()`.

These disagree in common cases:

| Declaration | JSX usage | Desired behavior | Plan behavior |
| --- | --- | --- | --- |
| `products[]` | `{ products.join(', ') }` | replace only | list wrapping (incorrect) |
| `products` (no `[]`) | `{ products.map(...) }` | list | list (OK via inference) |
| `products[].title` only | `{ products.map(...) }` | list on `products` | unclear — inferred from map, not declared as `products[]` |

**Recommendation:** Treat **list wrapping** as tied to usage (`.map()` or
alias identifier in JSX), not to `[]` in the declaration. Use `[]` only to
declare **shape** (primitive vs object list, child props). Primitive
`products[]` declares a scalar/primitive list item shape; object children
(`products[].title`) upgrade the parent list to object shape.

Resolve the open question (“`products[]` plus `products[].title` — invalid or
upgrade?”) **before Phase 1** as: **child paths upgrade parent to object list;
`products[]` alone means primitive list** (consistent with legacy default).

### 4. Context depth vs nested list paths

The plan introduces `context depth: root, list item, nested list item`. The
implementation uses a single numeric `__context__` incremented by **one** when
a component appears inside *any* `.map()` (`parentPathHasMap` → `context + 1`).

Problems:

- Double-nested maps (`products.map → badges.map`) still produce `+ 1`, not `+ 2`.
- Nested list child props in `ListController.getPropsArray` render as **empty
  arrays** (`children: []`) — tested and documented as intentional for now.
- Flat path `products[].badges[].label` implies two list scopes; PHP preset uses
  `$data_1` / `$data_2` via context index, but list open tags only wrap one level.

**Gap in plan:** Example grammar includes `products[].badges[].label` but
README and code both state **one level of nested list depth**. The plan should
either remove deep paths from first-pass grammar or add an explicit “Phase 6:
deep list contexts” with non-trivial scope work.

### 5. List item paths used as control inside child components

The plan example:

```jsx
{ products && <section>{ products.map(...) }</section> }
```

`products[].available` may be control **inside an item component**.

In the item component, the identifier is `available`, not `products[].available`.
Control inference must combine:

- declared path `products[].available`
- component’s list context depth (from `__context__`)
- local binding `available`

None of this exists today. Child components already require their own
`templateVars` (correct), but the plan implies path declarations at the parent
somehow cover nested semantics. They do not — each component declares **local**
names; the flat path is documentation of the **data contract**, not a cross-file
AST link.

**Clarify in plan:** Flat paths are per-component declarations of which logical
data fields this component exposes, mapped to local identifiers by convention
(same leaf name) or legacy config — not automatic parent→child path propagation.

### 6. Aliases and pre-rendered list output

The e2e fixture `full-template-surface` relies heavily on list **aliases**
(`renderedProducts`, `renderedBadges`) for `{ renderedProducts }` wrapping. Flat
paths have no alias syntax. Usage inference might detect `{ renderedProducts }`
as an identifier output, but cannot tie it to `products` without either:

- data-flow analysis (`const renderedProducts = products.map(...)`), or
- retaining alias config in legacy form.

**Gap in plan:** Add alias handling to non-goals for v1 flat API, or specify
that list role inference must include “identifier assigned from `.map()` on
declared list root” (partially implemented in `ListController.updateIdentifierNames`).

### 7. Replace fallback role vs conservative inference

Plan: replace is fallback when no stronger usage detected.

Risk: identifiers used **only** in unsupported control patterns (e.g.
`switch (status)`, `Array.includes(status)`, optional chaining) would silently
become replace — no template output for the condition at all (condition stripped
only when control matches).

**Recommendation:** Unmatched control-like usage should warn or require explicit
`{ type: 'control' }` / legacy config. “Conservative” should mean **do not infer
control**, not **default to replace in a conditional context**.

---

## Internal phase sequencing risks (not partial-release migration)

With a single release at the end, these are **implementation discipline** risks,
not user migration risks.

### Phase 1: flat → legacy list config as a shim

Compiling:

```js
[ 'products[].title', 'products[].price' ]
```

into legacy `{ type: 'list', child: { type: 'object', props: [...] } }` is a
reasonable way to keep controllers working while the registry is built. It
**inherits all legacy limits** until later phases replace it (one-level nesting,
empty nested list placeholders, no multi-role on `products` when also used as
control).

**Risk:** the shim becomes the de facto shipped architecture because tests pass
against it. **Mitigation:** mark shim code paths with explicit removal criteria;
add release-gate tests that fail if nested paths or multi-role behavior still
route through legacy list config.

### Phase 2 before Phase 4 (object paths without unified UIDs)

If object paths emit `getLanguageReplace('format', { value: 'hero.title' })`
before multi-role unification, the same logical field could still get separate
replace and control UIDs when also used in `{ hero.title && ... }` — the plan
already flags duplicated UIDs as a likely bug source.

**Recommendation unchanged:** introduce `{ type: 'path', segments: [...] }`
language args and **one generated binding per declared path** in Phase 1 registry
work. Mid-sequence duplicate UIDs are tolerable in failing or incomplete tests;
they are not tolerable in the release gate suite.

### Inference changing behavior for existing users (at release only)

Projects that already use implicit replace (`'name'`) plus control patterns
without declaring control will **change behavior** when the full work ships.
This is not a breaking API syntax change but a **semantic** one — and it happens
once, not phase-by-phase.

**Revised recommendation:** no opt-in flag needed for internal phases. At
release, ship a migration guide listing patterns that gain control/list
wrapping, and treat it as a major-version behavioral change. Regression tests on
existing fixtures (e.g. `full-template-surface`) should prove equivalent or
improved output under flat declarations.

---

## Edge cases: nested lists and components

| Case | Current behavior | Flat API expectation | Gap |
| --- | --- | --- | --- |
| Nested list prop `{ name: 'children', type: 'list' }` | Empty array placeholder | `items[].children[].id` | No output tags for inner list |
| Component inside map | `__context__ + 1` | nested list item context | No +2 for nested maps |
| `{ renderedItems }` alias | Wrapped via `toTag` | no alias in flat syntax | Needs map-assignment inference |
| `{ items.map(...) }` in JSX | Wrapped | `items[]` declaration | OK |
| List in control `{ visible && renderedProducts }` | control outside, list inside | multi-role `products` | Works today with explicit types |
| Spread `{...product}` | unsupported | unmentioned | stays legacy/manual |
| Optional chaining `product?.title` | not matched | unmentioned | exclude from inference v1 |
| Destructure rename `{ title: t }` + `'hero.title'` | no match | path declaration | needs binding map |
| `.flatMap()`, `.filter().map()` | only `.map` callee | list inference | document limitation |
| Member control `product.available` in parent map callback | not control unless `available` declared | `products[].available` at parent | parent declaration ≠ callback identifier |

**Nested component pattern (today’s recommended approach):**

Parent: list of `products` with child props declared on parent list config.  
Child (`ProductCard`): local `'available'`, `'name'` with explicit control/replace types.

Flat API should encode the same split:

```js
// App
[ 'products[].name', 'products[].available', ... ]  // list shape only at parent

// ProductCard
[ 'name', 'available' ]  // roles inferred or explicit per component
```

Do not imply `App.templateVars = ['products[].available']` transforms control
inside `ProductCard` without declarations there.

---

## Custom language compatibility

The plan says: preserve the existing language preset contract unless a separate
language change is required. **Nested and dotted paths do require a language
contract extension**, even if presets stay backward compatible.

### Current contract

- Args are `{ type: 'identifier' | 'value', value: string }`.
- `createLanguageString` substitutes `[%_variable_]` with the raw identifier string.
- PHP: `$data['title']` — single segment.
- Handlebars: `{{title}}` — flat name; `{{hero.title}}` works if the whole dotted
  string is passed, but PHP `$data['hero.title']` is wrong.

### Minimum extension (recommended)

Add optional path metadata without breaking custom presets:

```js
{ type: 'path', segments: ['hero', 'title'], depth: 0 }
// depth = list context for which segment prefix uses subcontext
```

- Default PHP/Handlebars presets implement segment-aware expansion.
- Custom languages that ignore unknown arg types keep working for flat identifiers.
- Document that `variable` with a dotted `value` is **deprecated** for new code.

### Context tags

Only `_context_` and `_subcontext_` exist. Nested lists need either:

- dynamic `data_${n}` generation from a numeric depth on the arg, or
- explicit stack of subcontexts in list open/close generation.

Changing this affects **every** custom language that copied the PHP preset.

**Plan amendment:** Add “Phase 2b: language arg path segments + depth” with
preset updates and a custom-language migration note (not a silent change).

---

## Simpler or more robust implementation approaches

### A. Registry-first, inference-last (strongly recommended)

```
templateVars → parse → registry → derive legacy buckets (temporary)
                              → single UID per path
                              → usage tagging pass (Phase 3+)
```

Avoid making “compile flat → legacy list config” the canonical internal representation.
Use it only as a shim behind a feature flag while controllers are refactored.

### B. Usage-site tagging instead of upfront bucketing

Rather than classifying vars into replace/control/list queues before traversal,
walk the component AST once with the registry:

- At each identifier/member node, resolve to a declared path (if any).
- Attach `{ path, roleAtSite }` based on parent JSX/logical/map context.
- Emit language strings from tags.

This aligns directly with multi-role semantics and avoids duplicate UIDs by construction.

### C. Keep roles explicit during development only (not at release)

If inference slips, an internal fallback is explicit roles in flat declarations:

```js
Component.templateVars = [
  'hero.title',
  'products[].title',
  [ 'visible', { roles: ['control'] } ],
];
```

With a single release, this is a **schedule/contingency** pattern, not the
target UX. The shipped API should still be "declare paths, infer roles" as the
plan describes.

### D. Scope nested flat paths for the release, not for "v1"

If deep lists are in the release grammar, a phase must deliver context depth and
nested placeholders — not documentation workarounds alone. If that work is too
large, cut `products[].badges[].label` from **release** examples and grammar,
not merely from an interim phase. The child-component pattern remains valid
either way.

### E. Validation layer upfront

Centralize contradictions with clear errors at parse time:

- Same path declared as primitive list (`foo[]`) and object child (`foo[].bar`) → upgrade (not error).
- Same leaf declared with conflicting shapes → error.
- Path segment contains `[]` in the middle of a property name → error.
- Duplicate declarations → merge roles/shapes.

---

## Decisions to lock before Phase 1

1. **`products[]` + `products[].title`:** Upgrade to object list (recommended).
2. **Deep nested list paths:** In or out of **release** scope — if in, assign a phase with context-depth work; if out, remove from release grammar and examples.
3. **Interim replace-only flat strings:** Acceptable internally until Phase 3; not acceptable in release docs or behavior.
4. **Alias support:** Resolve before release via map-assignment inference, or document legacy `aliases` as a supported escape hatch in the finished API.
5. **Language arg shape:** Add structured `path` type in Phase 2 alongside presets.
6. **Single UID per path:** Start in registry phase, not Phase 4 — still avoids rework even without partial release.
7. **Release migration:** One major-version note for inference semantics; no opt-in flag required for internal phasing.

---

## Recommended plan amendments

1. Add **Phase 1.5: path ↔ AST resolution** (destructuring, member chains, rename limits).
2. Replace “convert flat list paths to legacy list config” as the end state with **registry → controllers**.
3. Move `products[].badges[].label` to a deferred section; align examples with one-level depth.
4. Split Phase 2 into **language arg extensions** and **controller/path emission**.
5. Document **alias** and **pre-rendered list** patterns explicitly in migration/limitations.
6. Add test cases called out in the plan plus:
   - flat declare + legacy explicit type precedence
   - same var replace + control (multi-role) with single UID
   - `hero.title` member expression in JSX and conditions
   - map-assignment alias without legacy `aliases` config
   - invalid nested flat path rejected at parse time
7. Add a **release gate** checklist: multi-role, object paths, alias/map patterns,
   nested lists (if in scope), custom language path args, and e2e fixture parity
   under flat declarations.
8. Note **semantic major version** once at release, not per phase.

---

## Conclusion

The plan correctly identifies the core problem (implementation-leaky config,
mutually exclusive roles) and the right destination (flat paths, registry,
multi-role). **Shipping only when complete does not relax the technical bar** —
it reframes several earlier findings from "protect users during rollout" to
"keep internal shims from becoming the final design."

Unchanged priorities before release:

- **Syntax, registry, AST matching, context depth, and language emission are
  separate problems** — the registry must be what ships, not a permanent compile
  step into legacy list config.
- **Path ↔ AST resolution** remains a missing phase and is release-blocking for
  object paths and list-item paths.
- **Deep nested flat paths** remain incompatible with current context machinery
  unless explicitly built; that is a release scope decision, not just phasing.

What the release strategy simplifies:

- Interim replace-only behavior and legacy shims are fine **between** phases.
- No need for opt-in inference or interim public docs describing partial behavior.
- Migration guidance is written once, against the finished flat API.

Proceed with the test-first sequence and path parser. Treat the normalized
registry and single-UID-per-path as early deliverables because they reduce rework,
not because users will see them early. Add an explicit release gate so Phase 1
machinery cannot accidentally ship as the final architecture.
