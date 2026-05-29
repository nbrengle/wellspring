// Alias dictionary for the reference linker.
//
// Two layers:
//   1. inflect(name) — algorithmic regular inflections (plural / -ed / -ing / -d).
//      Covers the bulk of real references (Cure/Cures/Cured, Heal/Healing, …)
//      with zero hand-maintenance.
//   2. CURATED — a hand-kept map for irregulars and special forms the algorithm
//      can't derive (Sleep→Slept, Spike→spike damage, plural-named glossary
//      entries that appear singular, multi-word abbreviations, etc.).
//
// STOP_WORDS are entity names too generic to link safely on their own; they only
// link via an explicit curated alias, never by bare-name match.

// Regular English inflections of a single-word (or trailing-word) keyword.
export function inflect(name) {
  const forms = new Set([name]);
  // Only inflect the last word so multi-word names still get a sensible plural.
  const m = name.match(/^(.*?)(\w+)$/);
  if (!m) return [...forms];
  const [, head, last] = m;
  const add = (suffixForm) => forms.add(head + suffixForm);

  // Forward inflections (singular -> plural / verb forms).
  add(last + "s");
  add(last + "ed");
  add(last + "ing");
  if (/e$/.test(last)) {
    add(last + "d");                 // Cure -> Cured
    add(last.slice(0, -1) + "ing");  // Cure -> Curing
  }
  if (/[^aeiou]y$/.test(last)) {
    add(last.slice(0, -1) + "ies");  // -y -> -ies
  }

  // Reverse inflections (plural -> singular), so a plural-named entity ("Great
  // Weapons", "Effects") matches its singular use in body text. This is what
  // lets us avoid hand-listing those as aliases.
  if (/ies$/.test(last)) add(last.slice(0, -3) + "y");      // Abilities -> Ability
  else if (/sses$/.test(last)) add(last.slice(0, -2));       // Classes -> Class
  else if (/s$/.test(last) && !/ss$/.test(last)) add(last.slice(0, -1)); // Weapons -> Weapon

  return [...forms];
}

// Per-entity match policy. Default is case-insensitive matching. Words that
// overlap with common English need a tighter rule, chosen per-word from the
// case-audit data (see `npm run link:audit`):
//
//   "case-sensitive" — capitalization is the signal. "Cure" links; "cure" doesn't.
//                      Used for words whose capitalized form is reliably the
//                      game-term (≥70% caps in real bodies).
//   "stop"           — neither case nor context can disambiguate; suppress the
//                      bare-name match entirely. Compound forms still link if
//                      they exist as their own entities ("Defense Call" works
//                      even though "Call" is stopped).
export const MATCH_POLICY = {
  // case-sensitive: caps reliably mean the game-term (audit ratios in comments).
  "Power":      "case-sensitive", // 61% caps — "the Power" vs "their power source"
  "Armor":      "case-sensitive", // 54% — flag for doc cleanup; same skill mixes both
  "Conditions": "case-sensitive", // 79% — "non-Inherent Conditions"
  "Cure":       "case-sensitive", // 90%
  "Heal":       "case-sensitive", // 73% — "Heal effect" vs "heal" verb
  "Mend":       "case-sensitive", // 89%
  "Marshal":    "case-sensitive", // 100%
  "Sphere":     "case-sensitive", // 100%
  "Focus":      "case-sensitive", // 80%
  "Death":      "case-sensitive", // 65% — "Death Effect" vs "distribute death"
  "Grant":      "case-sensitive", // 78% — Grant effect family
  "Count":      "case-sensitive", // 74% — "Slow Count" vs "count toward"
  "Perk":       "case-sensitive", // 100%
  "Flaw":       "case-sensitive", // 100%
  "Lineage":    "case-sensitive", // 100%

  // stop: capitalization doesn't disambiguate; the lowercase form ALSO means
  // the game-term (e.g. "they should call 'Counter…'" is mechanical use). The
  // compound entities exist as their own links.
  "Call":     "stop", // 37% — verb usage of the game concept is common
  "Effects":  "stop", // 44% — "effects of that Trap" is the game-term, lowercased
  "Skills":   "stop", // 56% — "Lore skills" is meant
  "Spells":   "stop", // 67% — "cast spells" is the game concept
  "Hold":     "stop", // 0% caps — exclusively prose
  "Dead":     "stop", // 54% but low volume, "the dead" is heavy in lore
  "Materia":  "stop", // 30% low volume
  "Paces":    "stop", // 0% effectively absent
  // Tier: bare "Tier" rarely meaningful; the compound IS the entity (Tier Power,
  // Basic Tier). Stop the bare match so compounds win cleanly.
  "Tier":     "stop", // 67% but the compound is the real concept

  // Accents whose names overlap common English (case audit data per word):
  "Force":   "case-sensitive", // 62% caps — Physical Force vs "force them"
  "Mind":    "case-sensitive", // 85% caps
  "Life":    "case-sensitive", // 84% caps — "Life Accent" vs "save your life"
  "Shadow":  "case-sensitive", // 47% but the cap form is the accent
  "Fear":    "case-sensitive", // 77%
  "Divine":  "case-sensitive", // 80%
  "Disease": "case-sensitive", // 89%
  "Poison":  "case-sensitive", // 78%
  // Defense calls and modifiers with English-word overlap:
  "Counter":  "case-sensitive", // 97% — already very clean, but be explicit
  "Protect":  "case-sensitive", // 77%
  "Final":    "case-sensitive", // 73% — modifier vs "final exam"
  "Self":     "case-sensitive", // 93% — modifier
  "Subtle":   "case-sensitive", // 63% — modifier
  "Inherent": "case-sensitive", // 100%
  // Low-volume defense calls / modifiers — keep stopped (rare clean uses).
  "Altered":       "stop", // 13% caps
  "Reduced":       "stop", // 0% caps
  "Immune":        "stop", // 44% caps low volume
  "Obvious":       "stop", // 0% caps
  "Environmental": "stop", // 0% caps low volume

  // Duration-value entities (rules-concepts:Short/Long/Permanent/Instantaneous)
  // are real concepts but their names are common English words. We stop the bare
  // match here, and link-refs adds CONTEXTUAL matchers that fire only when the
  // word is followed by a known Effect or Defense Call name — i.e. when it's
  // actually being used as a Duration in a Call shape.
  "Short":         "stop",
  "Long":          "stop",
  "Permanent":     "stop",
  "Instantaneous": "stop",
};

// Backwards-compat: legacy code paths that only care about "is this stopped?"
export const STOP_WORDS = new Set(
  Object.entries(MATCH_POLICY).filter(([, p]) => p === "stop").map(([n]) => n)
);

// Curated aliases keyed by canonical entity name — ONLY for surface forms with
// no signal in the documentation itself (abbreviations, plural-named glossary
// entries, spelling variants). Relationships the doc *states* — e.g. an effect
// causing a condition (Sleep→Slept) — are NOT here; the parser derives those
// (effects.json `causesCondition`) and the linker turns them into aliases, so
// they rebuild automatically when the doc changes.
export const CURATED = {
  // Abbreviations — no textual rule derives these; they are real human knowledge.
  // (Plurals/singulars and verb forms are handled algorithmically by inflect();
  // doc-stated relationships like effect→condition are derived by the parser.
  // Only genuinely underivable forms belong here.)
  "Build Points": ["BP"],
  "Life Points": ["LP"],
  "Spike Damage": ["spike damage"],
  "Spell-slots": ["Spell Slot", "Spell Slots", "spell slot", "spell slots"],
  // Documentation spelling inconsistency, surfaced by `npm run link:audit`:
  // the skill is "Daggercraft" but a prereq writes it "Dagger Craft".
  "Daggercraft": ["Dagger Craft"],
  // The doc has no entity literally named "Devotion" — the individual deities
  // are entities of their own. "Devotions & Divine Beings" is the H1 section
  // that introduces the concept. Alias "Devotion"/"Devotions" so prose
  // references ("the character may choose a Devotion") link to that intro.
  "Devotions & Divine Beings": ["Devotion", "Devotions"],
  // Tiered skill families have entries "Forage I/II/III", "Scavenge I/II/III".
  // Prose references the family by the bare verb ("Foraging skill", "Scavenge
  // unless ...") — route those to the tier-I entry, the canonical entry point.
  "Forage I":   ["Forage", "Foraging"],
  "Scavenge I": ["Scavenge", "Scavenging"],
  // Tinkering crafting skill ladder. Bare "Tinker"/"Tinkering" → Apprentice tier.
  "Apprentice Tinkering": ["Tinker", "Tinkering"],
  // Irregular inflections that `inflect()` can't derive algorithmically.
  "Rebuild": ["Rebuilt"],
  // Latin plural.
  "Formula Types": ["Formula", "Formulae"],
  // Magic spheres: bare "Arcane" / "Divine" / "Druidic" referenced everywhere
  // as the sphere of magic. Route to the canonical entry-level skill.
  "Basic Arcane": ["Arcane"],
  // The Enchanting Forge has five inline sub-components (Reality Tear, Circle
  // of Sacrifice, Circle of Assignment, Circle of Empowerment, Rune Circle).
  // They're defined in one paragraph inside the Forge's description, not as
  // their own headings. Route the compounds to the parent concept.
  "The Enchanting Forge": [
    "Reality Tear", "Circle of Sacrifice", "Circle of Assignment",
    "Circle of Empowerment", "Rune Circle",
  ],
  // Tinker's Workshop — entity name has the possessive "Tinker's" but body
  // text often just says "Workshop" in context.
  "The Tinker's Workshop": ["Workshop"],
  // Lore skills use the bracketed-area form "Lore [Area of Lore] (Unlimited)"
  // as the canonical name. Prose just says "Lore" or "Lore skill".
  "Lore [Area of Lore] (Unlimited)": ["Lore"],
};
