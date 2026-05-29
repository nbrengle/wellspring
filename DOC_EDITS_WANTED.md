# MegaDoc Edits Wanted — Parser Wishlist

Hand-curated list of structural quirks in `WellspringMegaDoc.html` that the
parser has to work around. Each item is a request to fix something in the
**source doc**, not in the parser. If the doc were edited, the corresponding
parser hack could go away.

Format per item:

- **What:** the irregularity
- **Where:** section / class / lineage / etc. where it shows up
- **Parser workaround:** what we currently do
- **Wanted edit:** what to change in the doc

---

## 1. Class progression tables — variable-width "Class Bonuses" cell

- **What:** The right-most column of each class progression table ("Class Bonuses")
  exports as a variable number of text nodes — sometimes one (`"Living Iron"`),
  sometimes two (`"Innate Bonus Cantrip: Cancel,"` + `"Nature's Understanding"`),
  sometimes a dash (`"-"`). The split appears to be on `<br>` or comma boundaries
  inside the cell.
- **Where:** Every class. Druid level 2 is the canonical bad example
  ("Innate Bonus Cantrip: Cancel, Nature's Understanding" splits into two nodes).
- **Parser workaround:** Anchor each row on the level number (1, 2, 3…) instead
  of fixed column count. Collapse all text nodes between the last numeric col
  and the next level start into the bonus.
- **Wanted edit:** Either (a) put each row's bonus on a single line with no
  hard line breaks, or (b) leave one bonus per cell — never multi-line cells.

## 2. Class progression tables — trailing "Note:" paragraph

- **What:** Each class table ends with `"Note: Life Points and Maximum Spikes
  can be found in the Level Progression Table in the Wellspring Core Rules."`
  This is a body paragraph immediately after the last row, with no heading
  separator, so the parser can't distinguish it from level 10's bonus.
- **Where:** Every class progression table.
- **Parser workaround:** Heuristic — any text after the table that starts with
  `^(Note|Notes|Footnote):` ends the bonus collection.
- **Wanted edit:** Promote the note to its own H3 ("Note") or move it above
  the table — anything that gives it a structural boundary.

## 3. Class progression tables — "Class" column header is empty data

- **What:** The header row has a "Class" column that has no data underneath
  it. For caster classes (Druid, Mage, Cleric, Sourcerer) the "Class" column
  header is dropped entirely. Some classes have 6 columns total, some have 5.
- **Where:** Compare Artisan (6 cols including "Class") vs Druid (5 cols).
- **Parser workaround:** Filter all header tokens, then auto-detect martial
  vs caster from whether "cantrip"/"spell" appears anywhere.
- **Wanted edit:** Drop the empty "Class" column header from martial tables —
  every table should have the same shape (Level, 4 stat cols, Bonus).

## 4. Class progression tables — "BasicPowers" missing space

- **What:** Header cells `"BasicPowers"`, `"AdvancedPowers"`, `"VeteranPowers"`
  are missing the space between "Basic"/"Advanced"/"Veteran" and "Powers".
- **Where:** All martial class tables.
- **Parser workaround:** Header regex allows optional space:
  `Basic ?Powers|Advanced ?Powers|Veteran ?Powers`.
- **Wanted edit:** Add the missing space (`"Basic Powers"`, not `"BasicPowers"`).

## 5. Lineage challenges/advantages — entries are text nodes, not headings

- **What:** Unlike Skills (H4), Perks (H3), or Powers (H4), lineage Challenges
  and Advantages export as a single text node per entry in the format
  `"Name [Tags] (Cost): Description"`. Sublineage groups ARE H3 headings, but
  the entries themselves are inline.
- **Where:** Every lineage's Challenges and Advantages sections.
- **Parser workaround:** Regex match each text node:
  `^(.+?)((?:\s*\[[^\]]+\])*)\s*\((\d+|Variable)\)\s*[:\-]\s*(.+)$`
- **Wanted edit:** Make each entry an H4 heading (just the Name + tags), then
  follow with a single text body. Matches the Skill/Power pattern and eliminates
  the inline-line regex entirely.

## 6. Perks and Flaws — flat 5-column text rows, not <td> cells

- **What:** The Perks List and Flaws List are conceptually tables (Name, Cost/Award,
  Ranks, Prerequisites, Description) but export as 5 consecutive flat text nodes
  per row with no cell/row markers.
- **Where:** "Perks List" and "Flaws List" H2 sections under Character Options.
- **Parser workaround:** Accumulator that buffers 5 text nodes, then flushes a
  row. Header rows ("Name", "Cost"…) are filtered by regex.
- **Wanted edit:** Either (a) use the same H3 + text body shape as Skills, or
  (b) format as a real `<table>` so cells export as `<td>`.

## 7. Resources — concatenated name + tier + description in one node

- **What:** Resource entries export as a single text node like
  `"Bloom (Basic)Usually a small bundle of dried herbs and flowers..."` with
  no space between the tier paren and the description.
- **Where:** Resources section.
- **Parser workaround:** Regex split on `(Basic|Uncommon|Advanced)` boundary.
- **Wanted edit:** Put the name + tier on its own line/heading and the
  description as a separate paragraph.

## 8. Defense Calls and Modifiers — structured (H2+H3), unlike sibling glossaries

- **What:** Effects, Conditions, Creature Types, and Accents are all flat
  keyword lists. But Defense Calls and Modifiers use H2 (section) + H3 (entry)
  structure even though they're conceptually sibling glossaries.
- **Where:** Core Rules → Defense Calls; Core Rules → Modifiers.
- **Parser workaround:** Separate `parseH3Concepts()` function alongside the
  generic `parseKeywordSection()` for the flat lists.
- **Wanted edit:** Pick one shape and apply it to all five (Effects, Conditions,
  Types, Defense Calls, Modifiers). Probably the H3 shape is better — gives
  each entry its own anchor.

## 9. Level Progression Table — also text nodes, not <td>

- **What:** Same as Class Progression tables — flat text nodes, not cells.
- **Where:** Advancement → Level Progression Table.
- **Parser workaround:** Same as classes — text-node filter with header regex.
- **Wanted edit:** See #6/#9 — convert to real `<table>` markup.

## 10. Forgesource — referenced 33× but never defined

- **What:** `Forgesource` is an Artisan-class resource: spent to fuel powers,
  placed in an Ashbin when discarded, made by "Forgesource Specialists", etc.
  It's referenced ~33 times across powers but has no defining H1/H2/H3 anywhere
  in the doc — readers are expected to pick it up contextually.
- **Where:** Throughout Artisan class powers, several recipes.
- **Parser workaround:** None possible — there's nothing to extract.
- **Wanted edit:** Add a Forgesource definition section, either under the Artisan
  class as a class-specific resource, or in the Resources section. Once it's a
  named heading in the doc the parser registers it and the 33 references all
  become live links.

## 11a. Nested H1 inside Crafting (all) — Google Docs export quirk

- **What:** The "Crafting (all)" H1 section starts at one H1 and is immediately
  followed by ANOTHER H1 named "Introduction" inside it, before the real H2
  content begins. So the doc has H1 → H1 → H2 nesting.
- **Where:** "Crafting (all)" at the start of the crafting section.
- **Parser workaround:** Range bounds for the Crafting Intro block use
  "Crafting (all)" → "Alchemy" (first crafting discipline H1), which spans the
  nested "Introduction" H1 transparently.
- **Wanted edit:** Demote the nested "Introduction" H1 to H2 (or remove it).
  H1 should be reserved for top-level section breaks; nesting is what H2+ exist
  for. Likely a Google Docs heading-style misapplication.

## 11b. Ashbin / Turn of the Hourglass — H5 under H3 with no H4

- **What:** Crafting Process H3 contains H5 children (Ashbin, Turn of the
  Hourglass, Item Cards) with no intervening H4. The level jump (3 → 5) is
  invalid HTML heading semantics.
- **Where:** Crafting (all) → Recipes/Formulae/Schematics → Crafting Process.
- **Parser workaround:** Recursive walker uses "next existing deeper level"
  rather than strict `level+1`, so the H3 → H5 jump is traversed cleanly.
- **Wanted edit:** Promote those H5s to H4. Heading levels should never skip.

## 11c. Wealth — H1 with no real H2 children, despite having H2 headings

- **What:** Wealth H1 contains two H2s ("Auros Starting Wealth", "Typical
  Merchant Prices") but neither is a navigable game concept — they're presentation
  containers for currency examples and price lists. The actually meaningful
  content (what Wealth IS, what coins exist) lives in the H1's own body prose.
- **Where:** Wellspring Economy Overview → Wealth section.
- **Parser workaround:** When all child headings are stat-block-label-shaped or
  noise, emit the H1 itself as a single entry holding its body prose.
- **Wanted edit:** Restructure Wealth so the meaningful content has H2 anchors
  (e.g. H2 "Currency", H2 "Coin Denominations"). Then the parser extracts those
  as real sub-concepts instead of swallowing the whole H1 body as one blob.

## 11d. Stat-block field labels colliding with concept names

- **What:** Within crafting recipes, "Description" and "Effect" are used as
  H3 headings to label the recipe's description/effect FIELDS — not as standalone
  game concepts. But they're the same headings the parser would otherwise treat
  as named sub-concepts, producing entities `rules-concepts:Description` and
  `rules-concepts:Effect` that collide with very common words.
- **Where:** Crafting (all) Recipes/Formulae/Schematics section, every recipe
  template.
- **Parser workaround:** A `STATBLOCK_LABEL_NAMES` skip list excludes these
  specific names from sub-concept extraction (but still descends into their
  sub-trees to surface deeper concepts).
- **Wanted edit:** Either remove these label H3s entirely (they're redundant —
  recipes already have explicit `Description:` and `Effect:` prefixes in text),
  or rename them to clearly-not-a-concept forms like "Description (Field)".

## 11e. Barrier — defined inline, not as a heading

- **What:** `Barrier` is a real game term referenced 65× — "a type of temporary
  Armor Points that can be granted by Powers or Effects." But it's defined in
  body text inside the "Armor Points" H2 paragraph, not as its own H3.
- **Where:** Core Rules → Combat Rules → Armor Points.
- **Parser workaround:** None — there's no heading to extract.
- **Wanted edit:** Promote Barrier to an H3 sub-heading under Armor Points
  (same as "Calculating Physical Armor Points" already is). The parser will
  then auto-emit a `rules-concepts:Barrier` entity and the 65 references
  become live links.

## 11f. Enchanting Forge components — defined inline, not as sub-headings

- **What:** The Enchanting Forge has five named sub-components: Reality Tear,
  Circle of Sacrifice, Circle of Assignment, Circle of Empowerment, Rune
  Circle. Each is referenced extensively (Reality Tear: 17×; Circle of
  Empowerment: 49×; Circle of Assignment: 37×). All five are defined in one
  paragraph inside `crafting-concepts:The Enchanting Forge`, not as their own
  H3s.
- **Where:** Crafting (all) → The Enchanting Forge.
- **Parser workaround:** CURATED aliases route compound references to the
  parent Enchanting Forge entity. Imprecise — a click on "Reality Tear"
  takes the reader to the Forge section rather than a dedicated anchor.
- **Wanted edit:** Each Forge sub-component should be its own H3 inside the
  Enchanting Forge H2 (mirroring how "Calculating Physical Armor Points" is an
  H3 under "Armor Points"). The parser will then emit separate entities and
  links land directly.

## 11. Target / Individual / Mass / Self — used as keyword values but not defined

- **What:** Power stat blocks have a `Target` field whose value is `Individual`,
  `Mass`, or `Self`. These appear 84× (`Individual`), 20+× (`Mass`), 50+× (`Self`),
  but unlike `Delivery` and `Duration` they have no H2 keyword section listing
  their possible values.
- **Where:** Every power's `Target:` field.
- **Parser workaround:** None — there's no doc structure to derive entities from.
- **Wanted edit:** Add a `Target` H2 in the Calls section paralleling Delivery
  and Duration, with `Individual`, `Mass`, `Self` as H3 sub-concepts. The parser
  auto-registers them.

---

## Meta-question: Google Docs export quirks vs author choices

Many of these (flat text vs `<td>`, BasicPowers vs Basic Powers) seem to be
Google Docs **export artifacts** rather than author choices in the source doc.
If we exported a different way (Markdown export, or DOCX-then-pandoc) some of
these would resolve without any author edits.

Possibly worth investigating before asking for any of the above to be changed.
