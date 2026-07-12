// validate/prereqs.ts — prerequisite & build-rule checking.
//
// The heavy lifting (ownedIds, checkPrereqs) has been absorbed into
// CharacterGraphModel (graph.ts). This module retains only the thin wrappers
// that external callers (UI pickers, validate barrel re-exports) still import:
//   - prereqStatus(character, entityId) — delegates to graph.prereqStatusFor()
//   - checkLevelConstraint(character, constraintStr, owned) — standalone parser
//
// Re-exported by the validate.js barrel.

import { CLASSES } from "../data.js";
import { getClasses, parseWordNumber } from "../resolver.js";
import type { CharacterState } from "../types.js";
import { isCaster } from "../types.js";
import { characterLevel } from "./core.js";
import { spellSlots, type SpellPool } from "./slots.js";
import { resolveCharacterGraph } from "../graph.js";

// Whether a character meets the prereqs for a single entity id — used by the
// power picker to flag locked candidates. Returns { met, missing, anyOf, notes }
// where `met` is true only when all hard skill-prereqs (incl. disjunctions) are
// satisfied. Free-text level/other prereqs can't be auto-verified, so they don't
// block `met` but are surfaced as notes.
export function prereqStatus(character: CharacterState, entityId: string) {
  const graph = resolveCharacterGraph(character);
  return graph.prereqStatusFor(entityId);
}

// Parse and check free-text level/class/armor/spell-slot/profession constraints.
// Returns:
//   true  if the constraint is parsed and met.
//   false if the constraint is parsed and failed.
//   null  if the constraint format is unrecognized.
export function checkLevelConstraint(
  character: CharacterState,
  constraintStr: string,
  owned: Set<string>,
): boolean | null {
  const charLevel = characterLevel(character);
  const charClasses = getClasses(character);

  if (constraintStr.includes(";")) {
    const parts = constraintStr.split(";").map((s) => s.trim());
    let allMet = true;
    for (const part of parts) {
      const met = checkLevelConstraint(character, part, owned);
      if (met === false) return false;
      if (met === null) allMet = false;
    }
    return allMet ? true : null;
  }

  // 1. "N levels in Martial Classes" or "N levels in a Martial Classes" or "N class-levels in martial classes"
  let m = constraintStr.match(/^(\d+)\s+(?:levels?|class-levels)\s+in\s+(?:a\s+)?Martial\s+Classes/i);
  if (m) {
    const required = parseInt(m[1], 10);
    const martial = charClasses
      .filter((c) => CLASSES[c.name]?.tags?.includes("Martial"))
      .reduce((sum, c) => sum + c.level, 0);
    return martial >= required;
  }

  // 2. "Level N [Class]" (e.g., "Level 2 Spellcaster", "Level 3 Mage")
  m = constraintStr.match(/^Level\s+(\d+)\s+([A-Za-z\s]+)$/i);
  if (m) {
    const requiredLevel = parseInt(m[1], 10);
    const classStr = m[2].trim().toLowerCase();

    // Spellcaster meta-class
    if (classStr === "spellcaster" || classStr === "spellcaster class") {
      const highestSpellcasterLevel = charClasses
        .filter((c) => isCaster(CLASSES[c.name]))
        .reduce((max, c) => Math.max(max, c.level), 0);
      return highestSpellcasterLevel >= requiredLevel;
    }

    // Specific class
    const matchClass = charClasses.find((c) => c.name.toLowerCase() === classStr);
    return matchClass ? matchClass.level >= requiredLevel : false;
  }

  // 3. "Level N" (general character level) or "Nth character-level"
  m = constraintStr.match(/^(?:Level\s+(\d+)|(\d+)(?:st|nd|rd|th)\s+character-level)$/i);
  if (m) {
    return charLevel >= parseInt(m[1] || m[2], 10);
  }

  // 4. "Light Armor", "Medium Armor", "Heavy Armor" (must be owned)
  if (/^Light Armor|Medium Armor|Heavy Armor$/i.test(constraintStr)) {
    return owned.has(`skills:${constraintStr}`);
  }

  // 5. "N Apprentice spell-slot(s)"
  m = constraintStr.match(
    /^(One|Two|Three|\d+)\s+(Apprentice|Novice-level|Novice|Journeyman|Adept|Greater|Master)\s+spell-slots?/i,
  );
  if (m) {
    const count = parseWordNumber(m[1]);
    if (count === null) return null;

    const POOL_KEY: Record<string, keyof SpellPool> = {
      apprentice: "novice",
      novice: "novice",
      "novice-level": "novice",
      journeyman: "adept",
      adept: "adept",
      greater: "greater",
      master: "greater",
    };
    const key = POOL_KEY[m[2].toLowerCase()];
    const slots = spellSlots(character);
    const have = key && slots ? Object.values(slots).reduce((s, c) => s + (c[key] || 0), 0) : 0;
    return have >= count;
  }

  // 6. "N Ranks of Profession"
  m = constraintStr.match(/^(\d+)\s+Ranks\s+of\s+Profession/i);
  if (m) {
    const count = parseInt(m[1], 10);
    const profs = [...owned].filter((id) => /^skills:Profession/i.test(id));
    return profs.length >= count;
  }

  // 7. "Profession - [Any]"
  if (/Profession\s*-\s*\[Any\]/i.test(constraintStr)) {
    return [...owned].some((id) => /^skills:Profession/i.test(id));
  }

  // 8. "At least one Armor Proficiency"
  if (/At least one Armor Proficiency/i.test(constraintStr)) {
    return (
      owned.has("skills:Light Armor") ||
      owned.has("skills:Medium Armor") ||
      owned.has("skills:Heavy Armor") ||
      owned.has("skills:Ironclad Armor")
    );
  }

  // 9. "One level in a non-casting class"
  if (/One level in a non-casting class/i.test(constraintStr)) {
    return charClasses.some((c) => !isCaster(CLASSES[c.name]) && c.level >= 1);
  }

  // 10. "class-levels in at least two Base Classes"
  if (/class-levels in at least two Base Classes/i.test(constraintStr)) {
    return charClasses.filter((c) => c.level > 0).length >= 2;
  }

  return null;
}
