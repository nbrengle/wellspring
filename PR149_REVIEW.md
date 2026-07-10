# Review — PR #149: Finalize dedupe resolver + read layer

## Verdict

**Strong direction — merge after the fixes below.** This is the good version of the
refactor. `CharacterGraphModel` becomes the single resolved-character object: it owns
dedupe, buckets, stats, prereqs, wealth, spend, granted abilities, with a clean query API
(`find`/`filter`/`some`/`hasEntity`/iterator). The gutting of `bp-accounting` (−249),
`prereqs` (−413), `derived-stats` (−70), `wealth-income` (−27) into the model is exactly the
"stop letting ideas spread" consolidation we wanted, and it implements the
`DEDUPE_IDENTITY_PLAN` contract (`getIdentity` uses `paramInfo`/`paramReusable`; cap-aware
grant/purchase reconciliation with `REFUND_GRANT`). The flat-`items[]` + `bareKey` mess from
#145 is gone.

Guiding principle for the notes below: **struct-vs-class is incidental; the win is "one
typed resolved object that is the SOLE site of resolution."** Big is fine — keep it big until
it hurts — _provided_ every computed field is a pure function of the resolved object, so
extraction stays a find-replace.

---

## 1. Seal the remaining leak: `classifyOwnedItems` (REQUIRED)

`validate()` builds the graph (which has `uiBuckets`) **and then** calls
`classifyOwnedItems(characterV2)` (validate.ts:461) — a second, independent bucketing that
re-derives ownership from the raw character. Two sites of truth for "what does the character
own." Also scattered `getClasses(character)` / `characterLevel(character)` in validate.ts
(414, 466, 502) re-derive what the graph already exposes as `.classes` / `.characterLevel`.

**Fix:** `report.owned = graph.uiBuckets` (or make `classifyOwnedItems` a thin adapter over
`graph.uiBuckets`, never over raw `character`); read `graph.classes` / `graph.characterLevel`
in validate.ts. Every raw-character re-derivation in validate.ts is a leak the model was meant
to seal. This is non-negotiable regardless of struct/class — it's the actual principle.

## 2. Make the dependency DAG explicit — lazy memoized getters (the liftability guarantee)

The constructor eagerly fires seven `compute*()` in a fixed order, and later methods read
earlier results: `items → grantedAbilitiesList → ownedIds → prereqs`. The DAG is real and
clean, but the _only_ thing enforcing it is constructor line order (fragile), and everything
computes even when a caller wants one field.

**Fix:** convert to lazy memoized getters:

```ts
get grantedAbilities() { return this.#memo('ga',  () => computeGrantedAbilities(this._items)); }
get ownedIds()         { return this.#memo('oid', () => computeOwnedIds(this._items, this.grantedAbilities)); }
get prereqs()          { return this.#memo('pre', () => computePrereqs(this)); }
```

This (a) encodes the DAG in the data flow so reordering can't break it, (b) **forces the
pure-function discipline** that keeps every method liftable, and (c) makes future extraction a
no-op (the getter body is already `compute*(this.x, this.y)`). This is the single change that
makes "consolidate now, extract when it hotspots" actually cheap rather than aspirational.

## 3. `computePrereqs` isn't leaky — it's under-decomposed, with a band-aid and a stub

The ~200-line `computePrereqs` is not bad logic; it's **eight categorically different
rule-checks wearing one trenchcoat**, each re-walking `this._items` AND
`this._grantedAbilitiesList` independently (6+ separate loops over the same data):

1. tiered-perk level reqs · 2. sub-power-not-selectable · 3. skill/anyOf prereqs ·
2. Weapon Spec uniqueness · 5. Advanced-class limits · 6. armor/shield penalty ·
3. mutual exclusions · 8. power requirements

That grab-bag + repeated traversal is what reads as smeared. **Two of these are not rules to
relocate — they're defects:**

### 3a. Weapon Spec uniqueness (#4) = DUPLICATION papering over a dedupe BUG — VERIFIED

The dedupe resolver already knows Weapon Spec is take-once (`getMaxRanks` = 1). But
`param-domain` classifies it `kind:'pool', size:8` (it parsed the inline weapon list), so
`getIdentity` keys it `base|param` and treats Sword vs Axe as **distinct identities**.

Verified live — purchasing Weapon Specialization (Swords) + (Axes):

- dedupe keeps **BOTH** nodes, neither refunded (`REFUND_GRANT` absent);
- the prereqs block then fires "may only have one weapon type" to compensate.

So the prereqs check is a band-aid hiding a dedupe deviation. Our spec was right: identity
should key by `base` (param ignored) when `cap === 1`. **Fix `getIdentity`: `cap === 1` →
`key = baseName` (drop the `|param`). Then DELETE the 25-line Weapon Spec prereqs block** — the
normal keep/refund path produces the correct result (keep one, refund the rest as redundant).

### 3b. Armor/Shield penalty (#6) = DEAD/UNFINISHED code — VERIFIED

`ownedArmor` is declared (graph.ts:443) and pushed to (447, 453) but **never read** — the
penalty check it was gathering for was never written. The only thing the block emits is a
Draconic Heritage note, unrelated to armor. **Fix:** delete the dead `ownedArmor` gathering;
move the Draconic note to the tier-perk handling (already touched ~line 321). The real
armor-penalty logic, if wanted, belongs in `computeStats` — but it doesn't exist, so there's
nothing to move, only to spec later.

### 3c. Then decompose the rest

What genuinely remains (skill/anyOf prereqs, class-legality, mutual exclusions,
power-requirements) splits into composable pure checks the model COMPOSES:

```ts
get prereqs() {
  return mergeIssues(
    checkSkillPrereqs(this), checkClassLegality(this),
    checkMutualExclusions(this), checkPowerRequirements(this),
  );
}
```

Each `check(graph) -> {issues, notes}` is single-concern and testable. The model stays the
sole site of _resolution_ (it owns `this.prereqs`) without being the sole site of every rule's
_implementation_ — it orchestrates. (Note: consolidating into the model is what made this
smear visible and addressable in the first place — the big object did its job by surfacing it.)

## 4. Grant-at-cap edge: thinking-out-loud comment hides a likely bug

graph.ts ~line 1188 has a left-in musing ("Do not push the grant if we hit cap and already
refunded all purchases? Actually, if we hit cap..."). When a grant exceeds cap and there's no
purchase to refund, the code `continue`s — dropping the grant with **no `FREE_BP` emitted**.
Per the spec, a grant over cap should still yield `FREE_BP = cost`. Decide it, add a test,
delete the comment.

## 5. Logistics: #149 overlaps #151

This PR vendors `pool-registry.ts` (+226), the pool UI, and pool tests — the same work as
#151. Pick one owner so they don't collide on merge.

---

## Priority

- **Required before merge:** #1 (kill `classifyOwnedItems` duplication), #3a (cap-1 dedupe fix
  - delete Weapon Spec band-aid — it's a verified bug), #4 (grant-at-cap edge), #5 (overlap).
- **Strongly recommended:** #2 (lazy getters — the liftability guarantee), #3b (delete dead
  armor code), #3c (decompose prereqs).

Net: the model is the right abstraction and the "more OOP, less smear" instinct produced
something far cleaner than #145. The remaining issues are narrow and nameable — one real
dedupe bug (Weapon Spec), one parallel resolution site (classifyOwnedItems), some dead code,
and an under-decomposed method — not pervasive leak.
