# Parser ↔ Source Formatting Feedback (Jun 26 MegaDoc)

Concrete places where the **source document's formatting** still forces the parser
to be more complex than it should be. Each item says exactly **where** in the doc,
**what** the doc does now, **why** it's painful, and the **fix** that would let me
delete parser code.

The Jun 26 reformatting already helped a lot (see "Wins" at the bottom). These are
the remaining pain points, highest-leverage first.

---

## 1. "Choose one of the following:" options are FLAT siblings, not NESTED — HIGH

**Where:** Every class's Starting Skills / Multiclass Skills / Specialization
benefit lists. 19 occurrences of "Choose one of the following:". First example:
Artisan → Starting Skills → "Productive Equipment - Choose one of the following:".

**What the doc does now:** the choice header and its options are all `<li>` at the
**same** bullet level (`li-bullet-0`), as flat siblings:

```
• Productive Equipment - Choose one of the following:
• Apprentice Alchemy (3)
• Apprentice Ritual Magic (1), Ritual Lore (2)
• Apprentice Enchanting (3)
• Apprentice Tinkering (3)
• The Land Provides - Choose one of the following:   ← next group, same indent
```

**Why it's painful:** there is no structural signal for where one group's options
END and the next thing begins. The parser must infer grouping by string-matching
"Choose one of the following:" and then consuming following siblings until it
guesses the next header — fragile heuristics that break on any wording variation.
Verified: 0 of 19 blocks use nesting; all 19 are flat.

**Fix (source):** INDENT the options as a nested sub-list under the "Choose one of
the following:" line (Tab / "increase indent" in Google Docs so they become a
nested `<ul>`). Then grouping is purely structural — the parser reads the nested
`<ul>` as the option set and stops at the `</ul>`. This deletes the grouping
heuristics entirely.

---

## 2. NESTED sub-choices are flattened into the same bullet level — HIGH (same fix as #1)

**Where:** Artisan → Starting Skills → "A Path Unfolds - Choose one of the
following:". Its OPTIONS include lines that are THEMSELVES sub-choice headers:

```
• A Path Unfolds - Choose one of the following:
•   Apprentice & Journeyman Profession: [Your Choice] (3)
•   Apprentice Crafting: Choose one of the following:   ← an option that opens a SUB-choice
•   Apprentice Alchemy (3)            ← sub-option of "Apprentice Crafting"
•   Apprentice Ritual Magic (1), Ritual Lore (2)
•   Apprentice Enchanting (3)
•   Apprentice Tinkering] (3)
•   Note: This must be different from the choice made in Productive Equipment.
•   Basic Medicine (2), Choose one of the following:   ← another option opening a sub-choice
•   Bits & Pieces (1)
•   Hearth (1)
•   Soothing Touch (1)
```

**Why it's painful:** every one of these is `li-bullet-0` — the doc gives NO signal
for where "Apprentice Crafting"'s sub-options stop and "A Path Unfolds"'s next
option begins. This is literally un-parseable from structure; the engine has to
guess with brittle heuristics (and currently gets it wrong — 8 tests fail on
Artisan after the re-parse).

**Fix (source):** indent each level. The sub-options of "Apprentice Crafting"
should be a nested list one level deeper than "Apprentice Crafting", which is
itself one level deeper than "A Path Unfolds". With real indentation the whole
nested-choice tree parses structurally and a large amount of heuristic engine code
(`expandOptionLine`, `expandInlineChoice`, `extractEmbeddedChoice` in
src/engine/starting-choices.js) can be deleted.

---

## 3. Two orphaned `]` typos from the reformatting — TRIVIAL but breaks parsing

**Where (exact):**

- Artisan → Starting Skills → "A Path Unfolds" → **"Apprentice Tinkering] (3)"**
  (stray `]` after Tinkering)
- Artisan → Starting Skills → "Materials, Everywhere" (Multiclass) → **"Scavenge] (3)"**

**Why:** these were `[Alchemy, …, Tinkering]` / `[Forage, …, Scavenge]` brackets
that got partially removed when reformatting to the bullet list — the closing `]`
was left behind. The parser then emits skills named "Apprentice Tinkering]" and
"Scavenge]" which don't resolve to real entities.

**Fix (source):** delete the two stray `]` characters. (These are the ONLY two
orphaned brackets in the whole doc — verified.)

---

## Wins — the Jun 26 reformat already simplified these (no action needed)

- The inline "Choose a X: [Opt1, Opt2, or Opt3]" syntax is gone from class skill
  lists, replaced by "Choose one of the following:" + explicit option lines. Once
  #1/#2 are nested, the parser's `parseMulticlassSkills` bracket-splitting regex
  (`/,(?![^[]*\])/`) and its hardcoded default map (`{ Lore: 'Lore (Historical)',
Gathering: 'Forage I' }`) can be deleted.

---

## (more items added as the re-parse surfaces them)
