# Effect-Coverage Audit — abilities whose stated effects the builder drops

Date: 2026-06-04. Motivated by the Life Points bug (PR #15): an ability's MegaDoc
text states a permanent mechanical effect, but the builder's text-scanners don't
recognize the phrasing or don't look in that field, so the effect is silently
dropped from the character sheet.

Method: `scripts/audit/effect-coverage.mjs` scans **all 723 abilities** (skills,
perks, flaws, every class power/innate, every progression bonus) for
effect-signal phrases (max LP/Spikes/Armor, extra slots, recurring Wealth,
structural grants), and for each hit checks whether the builder's own extraction
logic would catch it. It's a heuristic lint — over-reports (in-play mentions) and
under-reports (novel phrasings) — so the raw output is triaged by hand below.

Run: `node --import ./scripts/register-json.mjs scripts/audit/effect-coverage.mjs`

---

## Confirmed gaps (real dropped effects) — fix these

### G1. Per-class progression "+1 Base Maximum Spikes" — DROPPED ❌
Same bug family as the LP fix, for Spikes. The Spikes regex requires
"…Maximum Spikes" but the prose says "Base Maximum Spikes", and "Base" sits
between the number and "Maximum", so it never matches.
- Fighter L9, Rogue L3, Rogue L9, Sourcerer L9 — all "+1 Base Maximum Spikes".
- Verified: Fighter L9 shows **3 Spikes** (should be 4); `mods.spikes = 0`.
Fix: broaden the Spikes regex exactly like the LP one (allow "Base", "increased
by"). Trivial; same site as PR #15.

### G2. "Warrior Spirit" (Fighter innate, L10) — +1 Max LP / Armor / Natural Armor DROPPED ❌
The always-on tail: *"the Fighter gains +1 Maximum Health, physical Armor Point,
and Natural Armor Point."* The builder applies **none** of it. Two reasons:
- it says "Maximum **Health**", not "Life Points" — no pattern matches;
- the comma-list "+1 X, Y, and Z Point" isn't parsed (only the first noun, if any).
Verified: Fighter L10 shows LP/Armor/NaturalArmor with no Warrior Spirit source.
Fix: add a "Maximum Health" alias for LP and parse the shared-"+1 … Point" list.

### G3. "Extensive Combat Training" (Basic/Advanced/Veteran) — extra power slot DROPPED ❌
*"The character may choose an additional Basic/Adept/Veteran Tier Power from a
non-casting class…"* This grants an extra Tiered-power slot, but `scanSlotGrant`
only matches "additional <Tier> spell-slot/slot/power" — here the noun order is
"additional Basic **Tier** Power", which the regex misses. Result: buying these
skills doesn't raise the martial slot cap.
Fix: extend `scanSlotGrant` to handle "additional <Tier> Tier Power".

### G4. Aewen "Deep Reserves" — caster spell-slot DROPPED ❌ (the caster analog)
*"The Aewen gains an additional spell-slot of their highest level spell-slot."*
This is the per-day **spell-slot** path, handled by `spellSlots()` — which has the
SAME blind spot the LP bug had: it only scans `startingSkills`/`purchasedSkills`,
NOT lineage advantages (nor perks/innate). So a caster Aewen is silently missing a
spell-slot. Two problems compound: the source field isn't scanned, AND the phrasing
("highest level spell-slot") wouldn't match the regex even if it were.
Fix: have `spellSlots()` scan the same source set as the other passes (the
consolidation below), and add a "highest-level spell-slot" handler. This is the
direct caster sibling of G1/G2 — and the reason the FIRST effect audit missed it
is that it mirrored `scanSlotGrant` (power-slot cap) but not `spellSlots`
(per-day spell-slots). Now both are mirrored.

### Caster completeness check
Beyond G4, the caster side is clean: a dedicated sweep for spells-known / extra-
cantrip / spell-slot grants across skills, perks, powers, and lineage advantages
found no other dropped grants. The "Innate Bonus Cantrip: Cancel" structural grant
is materialized (PR #12). So the only caster-specific gap is G4.

## Borderline / conditional (decide intent)

- **Daggercraft** — "+1 Base Maximum Spikes **for attacks with daggers**." A
  conditional, weapon-scoped bonus, not a flat max-Spikes increase. Probably
  should NOT raise the displayed Spikes total; maybe surface as a note.
- **Druid spells Barkskin / Hide of the Rhino** — grant Natural Armor while cast
  (a temporary buff, like Form spells). Correctly excluded from permanent stats;
  confirm they stay excluded (they're not Form-tagged, so only the "spell ⇒
  conditional" intuition keeps them out — the builder currently drops them, which
  is the right outcome here but for the wrong reason).
- **Studded Leather Armor (Rogue)** — "+1 Base Maximum Armor Point" but only
  *"when using 4 or fewer Armor Points of physical armor."* Conditional.
- **Gift of Unbreakable Flesh** — variable Natural Armor "from Patron"; already
  surfaced as a display NOTE (no fixed number). Working as intended.

## False positives (no action — the lint over-fired)
"equal to their Maximum Life Points" (Elemental Survival, Concealed Dart,
Elemental Affinity), Discern/Call references (Basic Medicine, Lessons from
Scars), ally-only buffs (Nature's Blessing, Blessing), refresh-not-max (Refocus),
and the Binding Oath flaws (oath prose, no stat). These mention a stat without
granting the character a permanent one.

## Structural grants — VERIFIED covered ✅
"Innate Bonus Cantrip: Cancel" (the "Mage has Cancel" rule) is materialized for
every caster by `innateBonusCantrips` (PR #12). The auditor flags zero
innate-cantrip gaps — the structural grant is enforced.

---

## Root-cause recommendation: one effect-extraction site

The reason this bug class keeps recurring is that effect extraction is **scattered
across five independent passes**, each re-walking a different (and inconsistent)
set of owned fields with its own regexes:

| Pass | Lives in | Walks |
|---|---|---|
| stat mods (LP/Spikes/Armor) | `statMods` / `STAT_PATTERNS` | perks, lineage, innate, power fields, progression, class/purchased/starting skills |
| slot grants | `slotGrants` / `scanSlotGrant` | starting+purchased skills, innate, progression |
| spell-slot grants | `spellSlots` | starting+purchased skills |
| wealth income | `wealthState` / `scanWealthIncome` | owned skills/perks, innate, power fields |
| granted abilities | `grantedAbilities` | reference graph (REFS.grants) |

Each pass decides for itself which fields count — which is exactly how "Healthy"
(a Class skill) got LP but not the others, how progression bonuses reached slots
before stats, and how G4 (Aewen Deep Reserves, a lineage advantage) is invisible
to `spellSlots` because that pass only walks two skill fields. Every gap in this
audit is a "which fields does THIS pass scan" mismatch. Recommendation:

> Define ONE `ownedEffectSources(character)` that yields every effect-bearing
> ability the character owns — `{ name, description, tags, sourceField,
> classLevelGate }` — derived once. Each effect pass (stats, slots, wealth) then
> consumes that single stream and only owns its *regex*, not its own field walk.
> A new source location is added in one place and every effect type sees it.

This wouldn't change behavior today, but it collapses the "did we remember to
scan field X here too?" question to a single answer, and makes the auditor's
"builder coverage" mirror trivial (it could call the same enumerator).

## Files
- `scripts/audit/effect-coverage.mjs` — the auditor (re-runnable).
- `scripts/audit/class-progression-smoketest.mjs` — the self-consistency smoke
  test (NOT an audit; see its header).
- `RULES_AUDIT.md` — the structural build-rules gap analysis (Advanced Classes,
  Weapon Spec, retraining, etc.).
