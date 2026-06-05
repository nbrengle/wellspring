# Implementation plan — effect-coverage fixes (G1–G4) for antigravity

Hand-off plan to fix the dropped-effect gaps found in `EFFECT_COVERAGE_AUDIT.md`.

Context: antigravity already has `feature/antigravity-rule-gaps` (PR #14, adds
Weapon-Spec / Advanced-Class / Draconic-Heritage validations). These effect fixes
are a separate concern (derived-stat correctness, not legality) — keep them on a
new branch, not folded into #14. Related open PRs: #15 (Life Points, the
dependency for G1/G2), #13 (Bookcaster), #14 (antigravity rule gaps).
All edits are in `src/data/validate.js` unless noted. Re-run the auditor after each
gap to confirm it clears: `node --import ./scripts/register-json.mjs
scripts/audit/effect-coverage.mjs`.

## Dependency / sequencing

1. **Depends on PR #15 (`feature/lifepoint-mods`)** — it adds the progression-bonus
   and `classSkills/purchasedSkills/startingSkills` scanning to `statMods`, plus the
   `Form`-tag exclusion. G1 and G2 build directly on that machinery. **Branch G1/G2
   off #15 (or off main once #15 lands).** Line numbers below are post-#15.
2. G3 (`scanSlotGrant`) and G4 (`spellSlots`) are independent of #15 — can branch
   off main.
3. Recommended: one branch `feature/effect-coverage-fixes` for all four (they share
   the theme and the test file), OR G1+G2 together (statMods) and G3+G4 together
   (slot scanners). Avoid four trivial PRs.

---

## G1 — progression "+1 Base Maximum Spikes" dropped

Sources: Fighter L9, Rogue L3, Rogue L9, Sourcerer L9 ("+1 Base Maximum Spikes").
Cause: the spikes pattern requires "…Maximum Spikes" with nothing between the
number and "Maximum"; "Base" breaks it. statMods already scans progression bonuses
(post-#15), so ONLY the regex needs widening.

Edit `STAT_PATTERNS`, the spikes entry (post-#15 ~line 1343):
```js
// before
{ stat: 'spikes', re: /(?:\+?(\d+)|\bone)\s+(?:Bonus\s+)?Maximum\s+Spikes?\b/gi },
// after — allow "Base"/"Bonus" qualifier and the "increased by" phrasing
{ stat: 'spikes', re: /(?:\+?(\d+)|\bone)\s+(?:(?:Base|Bonus)\s+)?Maximum\s+Spikes?\b/gi },
{ stat: 'spikes', re: /(?:Base\s+)?Maximum\s+Spikes?\s+(?:is|are)\s+increased\s+by\s+(?:\+?(\d+)|\bone)/gi },
```
Verify: Fighter L9 spikes → 4 (was 3); Rogue L9 → 4; Sourcerer L9 → reflects +1.
Guard: do NOT match "Spike Damage" (different stat) — the patterns above don't.

## G2 — Warrior Spirit innate (+1 Max LP / Armor / Natural Armor) dropped

Text tail (always-on): *"the Fighter gains +1 Maximum Health, physical Armor Point,
and Natural Armor Point."* Two reasons it's missed:
(a) says "Maximum **Health**", not "Life Points";
(b) the shared-"+1 … Point" comma list isn't parsed (Armor + Natural Armor share one
"+1").

Fixes:
- Add an LP alias pattern (near the other lifePoints patterns, ~1330):
  ```js
  { stat: 'lifePoints', re: /(?:\+?(\d+)|\bone)\s+Maximum\s+Health\b/gi },
  ```
- Make the comma-list grant both Armor and Natural Armor. Simplest: add explicit
  patterns so the single "+1 … physical Armor Point … Natural Armor Point" yields
  both:
  ```js
  { stat: 'armor',        re: /\+?(\d+)\s+(?:Maximum\s+Health,?\s+)?physical\s+Armor\s+Points?/gi },
  { stat: 'naturalArmor', re: /(?:and\s+)?(?:\+?(\d+)\s+)?Natural\s+Armor\s+Points?/gi },
  ```
  Careful: `statMods` takes the FIRST match per stat per entity, so one Warrior
  Spirit description → +1 lifePoints, +1 armor, +1 naturalArmor. Verify it does NOT
  double-count against the existing Natural-Armor patterns (it shares the `seen`
  set, so only the first naturalArmor pattern fires).
- Warrior Spirit is `requirement: "Fighter Level 10"`, tier Innate. statMods scans
  `CLASS_POWERS[cls].innate` already — BUT it does NOT level-gate innate scans.
  Confirm: at Fighter <10 the bonus must NOT apply. If the innate scan isn't gated,
  add `requiredLevel(p) <= clsLevel` to the innate loop in statMods (mirror the
  slotGrants innate gating). **This gating check applies to all innate stat grants,
  not just Warrior Spirit — verify nothing else regresses.**
Verify: Fighter L10 → LP +1, armor +1, naturalArmor +1, sources list Warrior
Spirit; Fighter L9 → none of them.

## G3 — Extensive Combat Training extra Tiered-power slot dropped

Text: *"may choose an additional Basic/Adept/Veteran Tier Power from a non-casting
class…"*. `scanSlotGrant` (~line 1016) matches "additional <Tier> spell-slot/slot/
power" but not "additional <Tier> **Tier** Power".

Edit the slot regex in `scanSlotGrant`:
```js
// before
const m = text.match(/\badditional\s+(Novice|Adept|Greater|Utility|Basic|Advanced|Veteran)\s+(?:spell-?\s*slot|slot|power)/i);
// after — allow an optional "Tier" between the tier word and "Power"
const m = text.match(/\badditional\s+(Novice|Adept|Greater|Utility|Basic|Advanced|Veteran)\s+(?:Tier\s+)?(?:spell-?\s*slot|slot|power)/i);
```
Note the tier→category map: "Adept" → spellsKnown, but Extensive Combat Training -
Advanced says "**Adept** Tier Power from a non-casting class" — that's a MARTIAL
Advanced power, so "Adept" here should map to the martial `advanced` slot, NOT
spellsKnown. **This is a real subtlety:** the word "Adept" in martial context ≠
caster Adept. Recommend keying off the skill (Extensive Combat Training - Advanced
→ advanced) rather than the tier word, or special-casing. Confirm against the three
ECT skills' actual intent before shipping. Verify the martial slot cap rises by 1
per ECT skill owned and casters are unaffected.

## G4 — Aewen "Deep Reserves" spell-slot dropped (caster analog)

Text: *"gains an additional spell-slot of their highest level spell-slot."*
`spellSlots()` (~line 1202) only scans `startingSkills`/`purchasedSkills`, so the
lineage advantage is invisible; and "highest level" isn't a Novice/Adept/Greater
keyword.

Fixes:
- Broaden the source walk in `spellSlots` to include lineage advantages, perks, and
  innate powers (mirror what statMods now scans). Cleanest: factor the
  per-day-slot scan to consume the same owned-source set (see consolidation below).
- Add a "highest-level spell-slot" handler: it grants +1 to the character's highest
  tier that currently has ≥1 slot (greater > adept > novice). Compute after the
  base/skill slots are summed:
  ```js
  // after summing base + skill slots, before return:
  for (const adv of ownedLineageAdvantageDescriptions(character)) {
    if (/additional\s+spell-?slot\s+of\s+their\s+highest[- ]level/i.test(adv)) {
      const tier = total.greater > 0 ? 'greater' : total.adept > 0 ? 'adept' : 'novice';
      total[tier] += 1;
    }
  }
  ```
Verify: a caster Aewen with Deep Reserves shows +1 at its highest occupied tier; a
non-caster Aewen is unaffected (no slots → no highest tier).

---

## Root-cause fix (recommended, supersedes the per-pass field walks)

Every gap above is "this pass didn't scan that field". Define ONE enumerator:
```js
// yields every effect-bearing ability the character OWNS, once.
function* ownedEffectSources(character) {
  // startingSkills, purchasedSkills, classSkills, perks, flaws, lineageAdvantages,
  // all POWER_SOURCE_FIELDS, level-gated class innate, level-gated progression bonuses
  // → { name, description, tags, sourceField, classLevelOK }
}
```
Then `statMods`, `slotGrants`, and `spellSlots` each iterate `ownedEffectSources`
and own ONLY their regex — never their own field list. Adding a new owned-source
field (or a new ability location) is then a one-line change visible to every effect
type, and G1/G2/G4 (all field-walk misses) cannot recur. Land the targeted fixes
first if speed matters, but this refactor is the durable fix.

## Tests to add (scripts/test.mjs)
- G1: Fighter L9 spikes === 4; Rogue L9 === 4; below-gate L8 === 3.
- G2: Fighter L10 lifePoints/armor/naturalArmor each +1 with Warrior Spirit source;
  L9 none.
- G3: owning Extensive Combat Training - Basic raises the Basic martial slot cap by
  1; casters unaffected; "Adept" ECT maps to martial advanced, not spellsKnown.
- G4: caster Aewen + Deep Reserves → +1 at highest tier; non-caster unaffected.
- Invariant: all 14 archetypes still validate clean and reproduce authored LP/Spikes.
