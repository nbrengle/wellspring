// parameter-suggestions.js — the data describing what a parameterizable item's
// pick options are (PARAMETER_SUGGESTIONS) and which params are open-ended typed
// values (TYPEABLE_PARAMS).
//
// Lives in its own module so adding/adjusting a pickable parameter touches THIS
// file instead of DetailPane.jsx — historically the single worst merge hotspot,
// because nearly every pickable-mechanic feature edited this literal and its
// import line. DetailPane just consumes these.
//
// Most lists are DERIVED from parsed data (Lore areas, Professions, devotions,
// Lost-Life reps, allergens) so they track the rules; a few fixed enumerations
// (Weapon Specialization, elements) are listed inline.

import { DEVOTIONS, ALL_SKILLS, LINEAGES, allergenOptions } from "../engine/data.js";

const DEVOTION_NAMES = DEVOTIONS.map((d) => d.name);
const skillDesc = (name) => (ALL_SKILLS.find((s) => s.name === name)?.desc) || "";
const LORE_AREAS = [...new Set([...skillDesc("Lore").matchAll(/([A-Z][a-z]+)\s+Lore:/g)].map((m) => m[1]))];
const PROFESSIONS = (() => {
  const desc = ["Profession - Master", "Profession - Journeyman", "Profession - Apprentice"].map(skillDesc).join(" ");
  const m = desc.match(/Suggested Professions?:\s*([^.]+)/i);
  return m ? m[1].split(/,|\band\b/).map((s) => s.replace(/\s+with Staff approval.*/i, "").trim()).filter(Boolean) : [];
})();

const LOST_LIFE_SUGGESTIONS = (() => {
  const suggestions = [];
  for (const [linName, lin] of Object.entries(LINEAGES || {})) {
    if (linName === "Lost") continue;
    for (const c of lin.challenges || []) {
      if (c.repped) {
        suggestions.push(`${c.baseName || c.name} (${c.lbp} LBP)`);
      }
    }
  }
  return [...new Set(suggestions)].sort();
})();

export const PARAMETER_SUGGESTIONS = {
  "Lore": LORE_AREAS,
  "Worship": DEVOTION_NAMES,
  "Patron": DEVOTION_NAMES,
  "Profession - Apprentice": PROFESSIONS,
  "Profession - Journeyman": PROFESSIONS,
  "Profession - Master": PROFESSIONS,
  "Chronic Hobbyist": ["Cooking", "Brewing", "Gardening", ...PROFESSIONS],
  "Favored Form": ["Hunting Panther", "Hulking Bear", "Striking Serpent"],
  "Weapon Specialization": ["Daggers", "Swords", "Maces", "Axes", "Projectile Weapons", "Thrown Weapons", "Staves", "Polearms"],
  "Extended Capacity - Novice": ["Arcane", "Divine"],
  "Extended Capacity - Adept": ["Arcane", "Divine"],
  "Extended Capacity - Greater": ["Arcane", "Divine"],
  // Extensive Combat Training / Extensive Training / Spell-Scholar are class-choice
  // grants — their options are computed dynamically (report.classChoices) from the
  // classes the character actually has, so they're NOT listed statically here.
  // (Two Weapon Style / Advanced styles / Advanced Recharge were removed in #106 —
  // their rules have no sub-selection.)
  "Additional Cantrip": ["Arcane", "Divine"],
  "Elemental Affinity": ["Flame", "Ice", "Lightning", "Acid"],
  "Draconic Heritage": ["Acid", "Flame", "Ice", "Lightning"],
  "Honor Debt": [],
  "Contact": [],
  "Ancestral Relic": [],
  "Ancestral Weapon": [],
  "Boon Bonds": [],
  "Heartbond": [],
  "Famous": [],
  "Minor Fame": [],
  "Manse": [],
  // Allergen substances come from the parsed allergen table (see data.js), not a
  // hardcoded list — the picker options and the BP award stay in sync by construction.
  "Mild Allergy": allergenOptions("Mild Allergy"),
  "Severe Allergy": allergenOptions("Severe Allergy"),
  "Lost Life": LOST_LIFE_SUGGESTIONS,
  "Additional Lost Life": LOST_LIFE_SUGGESTIONS,
};

// Params whose value is open-ended — the player types their own (a Lore area, a
// profession, a relic's name). These get the "type your own" custom chip; everything
// else is a fixed pick from its options.
export const TYPEABLE_PARAMS = new Set([
  "Lore", "Chronic Hobbyist",
  "Profession - Apprentice", "Profession - Journeyman", "Profession - Master",
  "Honor Debt", "Contact", "Ancestral Relic", "Ancestral Weapon", "Boon Bonds",
  "Heartbond", "Famous", "Minor Fame", "Manse",
]);
