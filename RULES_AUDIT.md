# Rules Audit — MegaDoc build rules vs. what the builder enforces

Date: 2026-06-04 (rewritten). Method: read the character-creation, advancement,
multiclass, advanced-class, retraining, and per-skill/per-power constraint text
in `Wellspring MegaDoc.txt`, then compared each concrete, checkable build rule
against what `src/data/validate.js` actually enforces. Line numbers are into the
MegaDoc unless noted.

Legend: ✅ enforced · ⚠️ partial · ❌ not enforced · 🟦 by-design / informational

---

## A. Economy & budgets

| Rule (MegaDoc) | Builder |
|---|---|
| Start at Level 4 with 9 BP; +2 BP per level (Level Progression Table, L626/746) | ✅ `budgetFor` / level table |
| Level Floor by event number raises starting level/BP (L760) | ✅ `getLegalMinLevel` + `belowFloor` |
| Flaws award up to **5 BP** (L637) | ✅ `MAX_FLAW_BP = 5` |
| Lineage Challenges award up to **10 LBP**; Advantages spend it (L633) | ✅ `MAX_LBP = 10`, `lbpState` |
| Approved backstory → **+2 BP** (L660) | ✅ `BACKSTORY_BP`, opt-in flag |
| Bonus BP capped at **= character level** (L3118) | ✅ `bonusBudgetFor` |
| Worship grants access to **up to two** Divine Domains (skills.json) | ✅ `MAX_DOMAINS = 2` |

Economy side is solid.

## B. Class / power-slot structure

| Rule | Builder |
|---|---|
| Per-class progression: Cantrips / Spells-Known / Tiered-power slots by level | ✅ `computeSlots` |
| Multi-class: 2nd+ class grants **Multi-Class Skills**, not Starting Skills (L789) | ✅ `multiclassGrants` |
| Skill/power **prerequisites** (skills, tiers, "A or B") | ✅ `checkPrereqs` / `prereqStatus` |
| Spell-slot counts per tier (N/N/N) | ✅ `spellSlots` |
| **Innate Bonus Cantrip: Cancel** is a free locked cantrip, separate from the choosable Cantrips column (class tables) | ⚠️→✅ was mis-modeled as +1 choosable; fixed on `feature/mage-cantrip-fix` (PR #12) |

## C. Gaps the builder does NOT enforce — these are the real findings

### C1. Advanced Classes (L789, L1727) ❌
The rules: *"Once a character has reached **total level 10**, they may begin taking
levels in Advanced Classes… Each Advanced Class has a maximum of **five levels**.
One character can have a maximum of **two** Advanced Classes."* (ACs also carry
their own prerequisites.)
The builder treats every class generically and caps total level at 10 only as a
"beyond progression" display note — it does **not** know which classes are
Advanced, nor enforce the level-10 gate, the 5-level-per-AC cap, or the 2-AC
limit. (Advanced Classes aren't published yet — L796 — so content is absent, but
the structural rule is unenforced.) → **Implemented by the antigravity branch
`feature/antigravity-rule-gaps`.**

### C2. Weapon Specialization — one weapon type only ❌
Weapon Specialization is always parameterized to a specific weapon type
(L7825, L10826+: "Weapon Specialization (Swords/Daggers/…)"). A character should
not hold it for two different types. The builder lets you add
`Weapon Specialization (Swords)` and `Weapon Specialization (Daggers)` with no
complaint. → **Implemented by `feature/antigravity-rule-gaps`.**

### C3. Retraining limits (L664, L793) ❌
On each level-up you may swap **one** Tiered Power / Known Spell / Cantrip /
Utility Power for one of the same type+tier from the class you're leveling into,
"within the limits set from the Base Class Progression Table." Advanced-class
retraining is broader (may pull from a Base Class). The builder has no concept of
retraining as a constrained, once-per-level action — picks are freely editable.
This is arguably fine for a planning tool, but it means the builder can't model
or validate a legal level-up path. (Decide: enforce, or explicitly out-of-scope.)

### C4. "Only one of X" per-character power limits ❌ (sampling)
Several powers/skills are explicitly unique-per-character and are not enforced:
- **Opus Power** — "The Artisan may only have **one** Opus Power" (L3467).
- **Cleric off-Devotion domain** — may take **a single** domain outside the
  Devotion, and **not** one in direct opposition (L4523). Builder enforces the
  2-domain cap but not the single-off-domain / opposition rule.
- **Socialite "Heart of a group"** — may only be the Heart of a single group;
  members ≤ Socialite level (L8323). (Play-state, likely out of scope.)
- Many "only one active at a time" powers (Town Portal, Circle, Dominate,
  Imbue) are **play-state**, correctly out of scope for a build validator. 🟦

### C5. Character-creation-only timing ❌
Some options must be chosen at creation, e.g. **Draconic Heritage** — "Must be
taken at Character Creation." The builder has no creation-vs-advancement phase,
so it can't flag this. → antigravity adds it as a **note** (not a hard error).

### C6. Bookcaster spell selection ⚠️→ in progress
Bookcaster selects a spell from accessible lists (L11027). The builder now
parameterizes it (PR #13). NOT yet modeled: the chosen spell is a **book spell**
(castable out of combat by expending a slot), distinct from a Known Spell, and
is swappable between events. Tracking book spells as a separate list and the
swap mechanic is open.

## D. Things confirmed CORRECT against the rules (spot-checks)
- Starting-skill blocks for all 9 base classes match the class Starting-Skills
  text (Mage/Cleric/Fighter/Sourcerer read line-by-line).
- Multiclass grants use Multi-Class Skills, and redundant grants award free BP
  ("Redundant Skills and Discounts").
- Flaw/LBP/backstory/bonus-BP caps match the quoted numbers.

## E. Relationship to other branches
- `feature/antigravity-rule-gaps` — implements C1, C2, C5 (Advanced Classes,
  Weapon Specialization, Draconic Heritage timing) + broadens prereq resolution.
  This audit is the rules-side justification for that branch.
- `feature/mage-cantrip-fix` (PR #12) — fixes the innate-cantrip mis-model (B).
- `feature/lore-writein` (PR #11), `feature/bookcaster-spell` (PR #13).

## F. Recommended next steps (priority order)
1. Land the antigravity validations (C1/C2/C5) — concrete, tested, rules-backed.
2. Decide retraining (C3): enforce a legal level-up path, or document as
   out-of-scope for a planning tool.
3. Cleric off-Devotion / opposed-domain rule (C4) — needs the domain-opposition
   data, which isn't parsed yet.
4. Bookcaster book-spell tracking + swap (C6).
