# Rules Audit — per-class L1→L10 validation sweep

Date: 2026-06-04. Method: built a default level-1 character for each of the 9
base classes (first option of every starting-choice block, mirroring the UI
dropdown default), then leveled 1→10. At each level, open power/spell/cantrip
slots were filled with the first **unlocked** eligible candidate (mimicking a
player using the picker with hide-locked on), and `validate()` was run. See
`scratch/sweep.mjs`.

## Headline result

With default choices, **every class validates cleanly at L4–L10**: no
over-budget, no prereq failures, no slot overages, no unfillable slots. Levels
1–3 are flagged `belowFloor` by the builder's own `LEGAL_MIN_LEVEL=4` rule —
that is the campaign play-floor, not a per-rules character-legality failure, so
the L1–3 builds are themselves rules-legal.

The starting BP spend is 0 in this sweep because starting skills are
class-granted (free) and slot-filled powers sit within their free allowance — a
default build with no extra purchases legitimately spends 0 BP. (The 14 shipped
archetypes spend exactly 9; those exercise the BP economy.)

## Confirmed bug surfaced by the sweep — innate bonus cantrip is mis-modeled

The MegaDoc Class Progression Tables list a **Cantrips** column (the number a
caster *chooses*) separately from the **Class Bonuses** column, which for early
caster levels reads "Innate Bonus Cantrip: Cancel". These are additive but
distinct: the Cancel is a *fixed, free innate* cantrip, not a choosable slot.

Source (MegaDoc, verified):
- Mage L1: Cantrips = **0**; Bonus = "Arcane Study, Innate Bonus Cantrip: Cancel"
- Cleric L2: Cantrips = **1**; Bonus = "Innate Bonus Cantrip: Cancel, Healing Touch"
- Druid L2: Cantrips = **1**; Bonus = "Innate Bonus Cantrip: Cancel, Nature's Understanding"
- Sourcerer L2: Cantrips = **1**; Bonus = "Innate Bonus Cantrip: Cancel, Astride the Other"

What the builder does today (`validate.js` `slotGrants`, ~line 1067): it regexes
`/bonus\s+cantrip/i` on the bonus prose and adds **+1 to the choosable cantrip
cap**. So:
- Mage **L1 shows Cantrips 1/1** (a free *choice*) when it should be **0 choices
  + Cancel granted as a locked innate**.
- Cleric/Druid/Sourcerer **L2 show Cantrips 2/2** (table 1 + bonus 1) where the
  intended model is **1 choice + Cancel innate**. The total cantrip *count* (2)
  happens to be right, but one of those should be the fixed Cancel, not a second
  free pick — so a player is currently allowed to pick TWO arbitrary cantrips at
  L2 instead of one + Cancel.

This is exactly issue #3 ("Level 1 Mage shows 2 cantrip slots… one should be
hardcoded to Cancel"), and the audit shows it is **not Mage-specific** — it
affects every innate-cantrip caster at every level the bonus applies.

### Recommended fix (implemented on `feature/mage-cantrip-fix`)
Stop treating "Innate Bonus Cantrip: Cancel" as +1 choosable cantrip. Instead
grant the named cantrip (Cancel) as a free innate power (locked, pre-filled),
leaving the choosable cantrip cap equal to the table's Cantrips column. Result:
Mage L1 = 0 choices + Cancel; Cleric/Druid/Sourcerer L2 = 1 choice + Cancel.

## Other observations (not bugs, noted for completeness)

- **Spell-slot vs spells-known**: the sweep fills "Spells Known" greedily from
  novice-tier candidates only (the UI routes spells-known picks to their own tier
  field). At higher levels a real caster would spread across tiers; the cap math
  is correct either way.
- **No prereq deadlocks**: every progression tier had at least one unlocked
  candidate at every level, so a player following defaults never hits a slot they
  cannot legally fill.
- **Starting builds match the MegaDoc** for all 9 classes (spot-checked Mage,
  Cleric, Fighter, Sourcerer against the class starting-skill blocks).

## Cross-reference

- Issue #1 (Lore write-in) — fixed on `feature/lore-writein` (PR #11).
- Issue #2 (Bookcaster parameterization) — `feature/bookcaster-spell`.
- Issue #3 (Mage/innate cantrip) — `feature/mage-cantrip-fix`; this audit
  widened its scope to all innate-cantrip casters.
- "antigravity agent" gap-exploration branch: not found on origin under an
  obvious name as of this audit; reconcile with the user.
