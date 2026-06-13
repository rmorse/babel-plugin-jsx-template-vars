# Review: flat template vars and autodetection plan

Pressure-test of
[`flat-template-vars-and-autodetection.md`](./flat-template-vars-and-autodetection.md)
against the current plugin implementation (visitor bucketing, three controllers,
language presets, `__context__` depth, and existing tests/fixtures).

**Verdict:** The direction is sound — flat paths plus a normalized registry with
multi-role usage is the right long-term model. The phased rollout is sensible,
but several gaps between the proposed API and what the transform can actually do
today are understated. The biggest risks are (1) compiling flat paths into the
legacy list config without fixing its one-level depth limit, (2) treating
declaration shape (`products[]`) as equivalent to usage role (list wrapping),
and (3) assuming dotted paths are mostly a language-output problem when they
also require AST matching and controller changes throughout.

---

## Executive summary

| Area | Risk | Recommendation |
| --- | --- | --- |
| Flat `products[].badges[].label` | High | Mark deep nested lists as out of scope for v1 flat API; keep child-component pattern |
| Phase 1 → legacy list compile | High | Build registry first; treat legacy compile as optional shim, not target architecture |
| Multi-role (`status` replace + control) | Medium | Single UID per path from Phase 1; defer bucket removal to Phase 4 |
| Object paths (`hero.title`) | Medium | Path-aware AST matching + language arg shape change, not just PHP/Handlebars presets |
| Role inference (Phase 3) | Medium | Default to explicit legacy behavior until inference ships; document the gap |
| `__context__` depth | High | Current +1-per-map model cannot support nested list paths without redesign |
| Custom languages | Medium | Add structured path args; preserve flat `variable` arg for backward compatibility |
| Aliases (`renderedProducts`) | Medium | Flat API has no alias story; inference cannot recover alias-based list wrapping |

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

Until Phase 3–4 land, a flat string like `'visible'` defaults to **replace only**.
A component using `{ visible && ... }` without `{ type: 'control' }` will get
replacement UIDs in JSX conditions — wrong output — if users adopt the flat API
early.

**Gap in plan:** Phase 1 should state clearly that flat strings remain
replace-only until Phase 3, *or* Phase 1 should populate the registry and derive
buckets without changing semantics (legacy explicit types still win).

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

## Risky migration paths

### Phase 1: flat → legacy list config

Compiling:

```js
[ 'products[].title', 'products[].price' ]
```

into legacy `{ type: 'list', child: { type: 'object', props: [...] } }` is a
fast win but **inherits all legacy limits** (one-level nesting, empty nested list
placeholders, no multi-role on `products` when also used as control).

Users reading the flat API examples may assume nested paths work because the
**syntax** allows them.

**Safer migration:**

1. Parse flat paths into a **normalized registry** (plan’s conceptual shape).
2. Optionally derive legacy buckets for controllers that are not registry-aware yet.
3. Gate flat nested-list syntax behind validation errors until deep list phase ships.

### Phase 2 before Phase 4 (object paths without unified UIDs)

If object paths emit `getLanguageReplace('format', { value: 'hero.title' })`
before multi-role unification, the same logical field could still get separate
replace and control UIDs when also used in `{ hero.title && ... }` — the plan
already flags duplicated UIDs as a likely bug source.

**Recommendation:** Introduce `{ type: 'path', segments: [...] }` language args
and **one generated binding per declared path** in Phase 1 registry work, even if
controllers still read from derived buckets.

### Inference changing behavior for existing users

Projects that already use implicit replace (`'name'`) plus control patterns
without declaring control will **change behavior** when Phase 3 ships. This is
not a breaking API syntax change but a **semantic** one.

**Recommendation:** Opt-in flag (`inferRoles: true`) or major version bump with
migration guide listing patterns that gain control/list wrapping.

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

### C. Keep roles explicit in flat API v1; infer in v2

Flat paths alone solve the biggest UX pain (nested list config). Defer inference:

```js
Component.templateVars = [
  'hero.title',
  'products[].title',
  [ 'visible', { roles: ['control'] } ],  // optional explicit roles
];
```

Inference becomes an additive optimization, not a behavior change for `'visible'`.

### D. Narrow first-pass grammar to match implementation

Ship v1 flat syntax as:

```txt
title
hero.title
hero.media.url
products[].title
products[].price
products[]          // primitive list only
```

Defer `products[].badges[].label` until context depth and nested list placeholders
are implemented. Validation error with message pointing to child components or
legacy nested list config.

### E. Validation layer upfront

Centralize contradictions with clear errors at parse time:

- Same path declared as primitive list (`foo[]`) and object child (`foo[].bar`) → upgrade (not error).
- Same leaf declared with conflicting shapes → error.
- Path segment contains `[]` in the middle of a property name → error.
- Duplicate declarations → merge roles/shapes.

---

## Decisions to lock before Phase 1

1. **`products[]` + `products[].title`:** Upgrade to object list (recommended).
2. **Deep nested list paths in flat syntax:** Defer with validation error (recommended).
3. **Flat string default type until Phase 3:** Document as replace-only; no inference claims in Phase 1–2 docs.
4. **Alias support in flat API:** Defer; document map-assignment tracking or keep legacy aliases.
5. **Language arg shape:** Add structured `path` type in Phase 2 alongside presets.
6. **Single UID per path:** Start in registry phase, not Phase 4.
7. **Opt-in inference:** Consider plugin option to avoid silent semantic migration.

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
7. Note **semantic major version** when Phase 3 inference ships.

---

## Conclusion

The plan correctly identifies the core problem (implementation-leaky config,
mutually exclusive roles) and the right destination (flat paths, registry,
multi-role). The main pressure-test finding is that **syntax, registry, AST
matching, context depth, and language emission are four separate problems** —
collapsing flat paths into today’s list config in Phase 1 risks shipping a nicer
declaration syntax on top of the same structural ceiling.

Proceed with the test-first sequence and path parser, but treat the normalized
registry and single-UID-per-path as Phase 1 deliverables, not Phase 4. Keep
deep nested lists and role inference out of the first flat API surface until the
underlying context and usage-resolution machinery catches up.
