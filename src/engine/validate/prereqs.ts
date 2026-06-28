// validate/prereqs.ts — prerequisite & build-rule checking.
//
// The heavy lifting (ownedIds, checkPrereqs) has been absorbed into
// CharacterGraphModel (graph.ts). This module retains only the thin wrappers
// that external callers (UI pickers, validate barrel re-exports) still import:
//   - prereqStatus(character, entityId) — delegates to graph.prereqStatusFor()
//   - checkLevelConstraint(character, constraintStr, owned) — standalone parser
//
// Re-exported by the validate.js barrel.

import { lookupEntity, CLASSES } from '../data.js';
import { bareSkill, getClasses } from '../resolver.js';
import { characterLevel } from './core.js';
import { spellSlots } from './slots.js';
import { resolveCharacterGraph } from '../graph.js';

// Whether a character meets the prereqs for a single entity id — used by the
// power picker to flag locked candidates. Returns { met, missing, anyOf, notes }
// where `met` is true only when all hard skill-prereqs (incl. disjunctions) are
// satisfied. Free-text level/other prereqs can't be auto-verified, so they don't
// block `met` but are surfaced as notes.
export function prereqStatus(character, entityId) {
  const graph = resolveCharacterGraph(character);
  return graph.prereqStatusFor(entityId);
}

// Parse and check free-text level/class/armor/spell-slot/profession constraints.
// Returns:
//   true  if the constraint is parsed and met.
//   false if the constraint is parsed and failed.
//   null  if the constraint format is unrecognized.
export function checkLevelConstraint(character, constraintStr, owned) {
  const charLevel = characterLevel(character);
  const charClasses = getClasses(character);

  // 1. "N levels in Martial Classes" or "N levels in a Martial Classes" or "N class-levels in martial classes"
  let m = constraintStr.match(/^(\d+)\s+(?:levels?|class-levels)\s+in\s+(?:a\s+)?Martial\s+Classes/i);
  if (m) {
    const required = parseInt(m[1], 10);
    const martial = charClasses.filter((c) => CLASSES[c.name]?.tags?.includes('Martial'))
      .reduce((sum, c) => sum + c.level, 0);
    return martial >= required;
  }
  // 2. "Level N [Class]" (e.g., "Level 2 Spellcaster", "Level 3 Mage")
  m = constraintStr.match(/^Level\s+(\d+)\s+([A-Za-z\s]+)$/i);
  if (m) {
    const requiredLevel = parseInt(m[1], 10);
    const classStr = m[2].trim().toLowerCase();
    
    // Spellcaster meta-class
    if (classStr === 'spellcaster' || classStr === 'spellcaster class') {
      const highestSpellcasterLevel = charClasses
        .filter((c) => CLASSES[c.name]?.spellcaster)
        .reduce((max, c) => Math.max(max, c.level), 0);
      return highestSpellcasterLevel >= requiredLevel;
    }
    
    // Specific class
    const matchClass = charClasses.find((c) => c.name.toLowerCase() === classStr);
    return matchClass ? matchClass.level >= requiredLevel : false;
  }
  // 3. "Level N" (general character level)
  m = constraintStr.match(/^Level\s+(\d+)$/i);
  if (m) {
    return charLevel >= parseInt(m[1], 10);
  }
  // 4. "Light Armor", "Medium Armor", "Heavy Armor" (must be owned)
  if (/^Light Armor|Medium Armor|Heavy Armor$/i.test(constraintStr)) {
    return owned.has(`skills:${constraintStr}`);
  }
  // 5. "N Apprentice spell-slot(s)"
  m = constraintStr.match(/^(\d+)\s+(Apprentice|Journeyman|Greater|Master)\s+spell-slots?/i);
  if (m) {
    const count = parseInt(m[1], 10);
    const tier = m[2];
    const slots = spellSlots(character);
    const have = Object.values(slots).reduce((s, c) => s + (c[tier] || 0), 0);
    return have >= count;
  }
  // 6. "N Ranks of Profession"
  m = constraintStr.match(/^(\d+)\s+Ranks\s+of\s+Profession/i);
  if (m) {
    const count = parseInt(m[1], 10);
    const profs = [...owned].filter(id => /^skills:Profession/i.test(id));
    return profs.length >= count;
  }

  return null;
}
