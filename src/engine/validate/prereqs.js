// validate/prereqs.js — prerequisite & build-rule checking.
//
// Extracted from validate.js (hotspot split). Verifies skill/entity prereqs,
// free-text level/class/armor/spell-slot constraints, and the structural build
// rules (Weapon Specialization limit, Advanced Classes limits, power level/entity
// requirements). Depends on core primitives + slots (for spell-slot constraints).
// Re-exported by the validate.js barrel.

import { lookupEntity, REFS, CLASS_POWERS, SPELLCASTERS, BASE_CLASSES } from '../data.js';
import { cleanItemName, bareSkill, resolveId, idName, entityType, getClasses } from '../resolver.js';
import {
  characterLevel, rankOf, grantedAbilities, ENTITY_FIELDS,
} from './core.js';
import { spellSlots } from './slots.js';
import { ARMOR_SKILLS } from '../config.js';

// All entity ids the character owns, for satisfying skill-prereqs.
function ownedIds(character) {
  const owned = new Set();
  for (const field of ENTITY_FIELDS) {
    for (const item of character[field] || []) {
      const id = resolveId(item, field, character);
      owned.add(id);

      const clean = cleanItemName(item);
      const bare = bareSkill(clean);
      const candidates = [
        id,
        `${entityType(field)}:${bare}`,
        `powers:${clean}`,
        `perks:${clean}`,
        `skills:${clean}`,
        `powers:${bare}`,
        `perks:${bare}`,
        `skills:${bare}`
      ];
      for (const cand of candidates) {
        const ent = lookupEntity(cand);
        if (ent) {
          owned.add(ent.id);
          owned.add(`${ent.type}:${bareSkill(ent.name)}`);
        }
      }
    }
  }
  // Also add granted abilities so they satisfy prerequisites
  for (const g of grantedAbilities(character).list) {
    owned.add(g.ability);
    const ent = lookupEntity(g.ability);
    if (ent) {
      owned.add(`${ent.type}:${bareSkill(ent.name)}`);
    }
  }
  return owned;
}

// Whether a character meets the prereqs for a single entity id — used by the
// power picker to flag locked candidates. Returns { met, missing, anyOf, notes }
// where `met` is true only when all hard skill-prereqs (incl. disjunctions) are
// satisfied. Free-text level/other prereqs can't be auto-verified, so they don't
// block `met` but are surfaced as notes.
export function prereqStatus(character, entityId) {
  const ent = lookupEntity(entityId) || lookupEntity(entityId.split(':')[0] + ':' + bareSkill(idName(entityId)));
  const pr = REFS.prereqs[ent?.id || entityId];
  if (!pr) return { met: true, missing: [], anyOf: [], notes: [] };
  const owned = ownedIds(character);
  const missing = (pr.skills || []).filter((dep) => !owned.has(dep));
  const unmetGroups = (pr.anyOf || []).filter((g) => !g.some((dep) => owned.has(dep)));
  const notes = [...(pr.levels || []), ...(pr.other || [])];
  return {
    met: missing.length === 0 && unmetGroups.length === 0,
    missing: missing.map((m) => ({ id: m, name: idName(m) })),
    anyOf: unmetGroups.map((g) => g.map((m) => ({ id: m, name: idName(m) }))),
    notes,
  };
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
    const martialLevels = charClasses
      .filter(c => !SPELLCASTERS.has(c.name))
      .reduce((sum, c) => sum + c.level, 0);
    return martialLevels >= required;
  }

  // 2. "One level in a non-casting class"
  m = constraintStr.match(/^(one|1)\s+level\s+in\s+a\s+non-casting\s+class/i);
  if (m) {
    return charClasses.some(c => !SPELLCASTERS.has(c.name) && c.level >= 1);
  }

  // 3. "class-levels in at least two Base Classes"
  m = constraintStr.match(/class-levels\s+in\s+at\s+least\s+(two|2)\s+Base\s+Classes/i);
  if (m) {
    const activeBaseClasses = charClasses.filter(c => BASE_CLASSES.has(c.name) && c.level > 0);
    return activeBaseClasses.length >= 2;
  }

  // 4. "N levels in any one spell-casting class."
  m = constraintStr.match(/^(\d+)\s+levels?\s+in\s+any\s+one\s+spell-casting\s+class/i);
  if (m) {
    const required = parseInt(m[1], 10);
    return charClasses.some(c => SPELLCASTERS.has(c.name) && c.level >= required);
  }

  // 5. "N levels in a single casting class."
  m = constraintStr.match(/^(\d+)\s+levels?\s+in\s+a\s+single\s+casting\s+class/i);
  if (m) {
    const required = parseInt(m[1], 10);
    return charClasses.some(c => SPELLCASTERS.has(c.name) && c.level >= required);
  }

  // 6. "Character Level N", "Requires Level N", "character-level N", "Nth character-level", "Nth level character"
  m = constraintStr.match(/(?:\b(\d+)(?:st|nd|rd|th)?\s+(?:character-level|level\s+character)|(?:Character[- ]Level|Requires[- ]Level|character[- ]level)\s*(\d+))/i);
  if (m) {
    const num = m[1] || m[2];
    const required = parseInt(num, 10);
    return charLevel >= required;
  }

  // 7. "At least one Armor Proficiency"
  if (/At\s+least\s+one\s+Armor\s+Proficiency/i.test(constraintStr)) {
    return ARMOR_SKILLS.some(name => owned.has(`skills:${name}`));
  }

  // 8. "One Novice-level spell-slot", "One Adept spell-slot", "One Greater spell-slot", etc.
  m = constraintStr.match(/(?:one|1)\s+(Novice|Adept|Greater)(?:-level)?\s+spell-?slot/i);
  if (m) {
    const tier = m[1].toLowerCase();
    const slotsObj = spellSlots(character) || { novice: 0, adept: 0, greater: 0 };
    return (slotsObj[tier] || 0) >= 1;
  }

  // 9. "Profession - [Any]"
  if (/Profession\s+-\s+\[?Any\]?/i.test(constraintStr)) {
    return [...owned].some(id => id.startsWith('skills:Profession'));
  }

  return null;
}

// Prereq check across every owned item. Skill-prereqs (entity ids) are verified
// against ownership and become hard `issues` when unmet. Level/other prereqs are
// free-text. Level constraints are parsed and hard-enforced as issues, while
// unrecognized/other constraints surface as `notes` (manual verification).
export function checkPrereqs(character) {
  const owned = ownedIds(character);
  const issues = [];
  const notes = [];
  const seen = new Set();
  const charLevel = characterLevel(character);

  for (const field of ENTITY_FIELDS) {
    (character[field] || []).forEach((item, idx) => {
      const id = resolveId(item, field, character);
      // Tiered perks (Draconic Heritage): each purchased tier requires a minimum
      // CHARACTER level (tier 2 → lvl 5, …). Hard-enforced — buying tier N below
      // its level is an issue. Checked per-occurrence (uses the item's rank), so
      // it runs before the `seen` de-dupe below.
      const tEnt = lookupEntity(id) || lookupEntity(`${entityType(field)}:${bareSkill(cleanItemName(item))}`);
      if (Array.isArray(tEnt?.tiers) && tEnt.tiers.length) {
        const rank = Math.min(rankOf(character, field, idx), tEnt.tiers.length);
        const need = tEnt.tiers[rank - 1]?.level || 0;
        if (need > charLevel) {
          issues.push({ id, item, field, tierLevel: need, tier: rank,
            text: `tier ${rank} requires character level ${need}` });
        }
      }
    });
    for (const item of character[field] || []) {
      const id = resolveId(item, field, character);
      if (seen.has(id)) continue;
      seen.add(id);
      const ent = lookupEntity(id) || lookupEntity(`${entityType(field)}:${bareSkill(cleanItemName(item))}`);
      if (ent && ent.tier === 'SubPower') {
        issues.push({
          id, item, field,
          text: `${ent.name} is a sub-power and cannot be selected directly.`,
        });
      }
      const pr = REFS.prereqs[ent?.id || id];
      if (!pr) continue;

      const missing = (pr.skills || []).filter((dep) => !owned.has(dep));
      // Disjunction groups ("Basic Arcane or Basic Faith") are satisfied when the
      // character holds ANY alternative; unmet groups become their own issue so
      // the UI can show "needs one of: A, B".
      const unmetGroups = (pr.anyOf || []).filter((group) => !group.some((dep) => owned.has(dep)));
      if (missing.length || unmetGroups.length) {
        issues.push({
          id, item, field,
          missing: missing.map((m) => ({ id: m, name: idName(m) })),
          anyOf: unmetGroups.map((group) => group.map((m) => ({ id: m, name: idName(m) }))),
        });
      }
      for (const lvl of pr.levels || []) {
        const met = checkLevelConstraint(character, lvl, owned);
        if (met === false) {
          issues.push({
            id, item, field,
            text: `Requires ${lvl}`
          });
        } else if (met === null) {
          notes.push({ id, item, field, kind: 'level', text: lvl });
        }
      }
      for (const o of pr.other || []) {
        const met = checkLevelConstraint(character, o, owned);
        if (met === false) {
          issues.push({
            id, item, field,
            text: `Requires ${o}`
          });
        } else if (met === null) {
          notes.push({ id, item, field, kind: 'other', text: o });
        }
      }
    }
  }

  // ─── Weapon Specialization limit ───
  const weaponSpecs = [];
  for (const field of ['startingSkills', 'purchasedSkills']) {
    (character[field] || []).forEach((item) => {
      const clean = cleanItemName(item);
      if (bareSkill(clean) === 'Weapon Specialization') {
        weaponSpecs.push({ item, field });
      }
    });
  }
  for (const g of grantedAbilities(character).list) {
    if (g.abilityType === 'skills' && bareSkill(cleanItemName(g.abilityName)) === 'Weapon Specialization') {
      weaponSpecs.push({ item: g.abilityName, field: 'granted' });
    }
  }
  // Filter out unparameterized 'Weapon Specialization' if a parameterized one is present
  const hasParameterized = weaponSpecs.some(ws => ws.item.includes('('));
  const filteredWeaponSpecs = hasParameterized
    ? weaponSpecs.filter(ws => ws.item.includes('('))
    : weaponSpecs;

  if (filteredWeaponSpecs.length > 1) {
    const types = filteredWeaponSpecs.map(ws => {
      const m = ws.item.match(/\(([^)]+)\)/);
      return m ? m[1].trim() : 'unspecified';
    });
    issues.push({
      id: 'skills:Weapon Specialization',
      item: 'Weapon Specialization',
      text: `A character may only have Weapon Specialization with one weapon type (found: ${types.join(', ')}).`,
    });
  }

  // ─── Advanced Classes limit ───
  const charClasses = getClasses(character);
  const advancedClasses = charClasses.filter(c => !BASE_CLASSES.has(c.name));
  const baseLevel = charClasses
    .filter(c => BASE_CLASSES.has(c.name))
    .reduce((sum, c) => sum + c.level, 0);

  if (advancedClasses.length > 2) {
    issues.push({
      id: 'classes:Advanced Classes',
      item: 'Advanced Classes',
      text: 'One character can have a maximum of two Advanced Classes.',
    });
  }
  if (advancedClasses.length > 0 && baseLevel < 10) {
    issues.push({
      id: 'classes:Advanced Classes',
      item: 'Advanced Classes',
      text: `Cannot take levels in Advanced Classes until total level 10 has been reached in base classes (current base level: ${baseLevel}).`,
    });
  }
  for (const c of advancedClasses) {
    if (c.level > 5) {
      issues.push({
        id: `classes:${c.name}`,
        item: c.name,
        text: `${c.name} has a maximum of 5 levels.`,
      });
    }
  }

  // ─── Draconic Heritage character creation note ───
  const hasDraconicHeritage = [...(character.purchasedPerks || [])]
    .some(p => bareSkill(cleanItemName(p)) === 'Draconic Heritage');
  if (hasDraconicHeritage) {
    notes.push({
      id: 'perks:Draconic Heritage',
      item: 'Draconic Heritage',
      field: 'purchasedPerks',
      kind: 'other',
      text: 'Must be taken at Character Creation.',
    });
  }

  // ─── Power requirements (parser-extracted: requiredLevel + requiresEntity) ───
  // A selected power may require a minimum class level and/or another owned entity
  // (e.g. Expert Parry → Parry Blow). Resolve each owned power IN THE CONTEXT OF
  // THE CHARACTER'S OWN CLASSES — power names are shared across classes with
  // different requirements (a Cleric's "Ritual Affinity" requires Cleric L3, the
  // Mage's requires Mage L3), so the flat lookup would pick the wrong one.
  const charClassLevels = new Map(charClasses.map((c) => [c.name, c.level]));
  // Find a power entity by name from one of the character's classes (the version
  // whose requirements actually apply); fall back to the global entity.
  const powerInContext = (name) => {
    for (const { name: cls } of charClasses) {
      const tiers = CLASS_POWERS[cls];
      if (!tiers) continue;
      for (const list of Object.values(tiers)) {
        if (!Array.isArray(list)) continue;
        const hit = list.find((p) => p.name === name);
        if (hit) return hit;
      }
    }
    return lookupEntity(`powers:${name}`);
  };
  const POWER_REQ_FIELDS = [
    'innatePowers', 'utilityPowers', 'basicPowers', 'advancedPowers', 'veteranPowers',
    'classPowers', 'rightHandPowers', 'cantrips', 'noviceSpells', 'adeptSpells',
    'greaterSpells', 'bookSpells', 'domainPowers', 'formPowers',
  ];
  const reqSeen = new Set();
  for (const field of POWER_REQ_FIELDS) {
    for (const item of character[field] || []) {
      const name = cleanItemName(item);
      if (reqSeen.has(name)) continue;
      reqSeen.add(name);
      const ent = powerInContext(name);
      if (!ent) continue;
      // Level requirement: against the owning class's level (or character level
      // when the requirement names no class).
      if (ent.requiredLevel > 0) {
        const have = ent.requiredClass ? (charClassLevels.get(ent.requiredClass) || 0) : charLevel;
        if (have < ent.requiredLevel) {
          issues.push({ id: `powers:${name}`, item: name, field,
            text: `Requires ${ent.requiredClass ? `${ent.requiredClass} ` : ''}Level ${ent.requiredLevel}` });
        }
      }
      // Entity requirement: each named prerequisite power/skill must be owned.
      for (const reqName of (ent.requiresEntity || [])) {
        const ok = owned.has(`powers:${reqName}`) || owned.has(`skills:${reqName}`)
          || owned.has(`perks:${reqName}`) || owned.has(`powers:${bareSkill(reqName)}`);
        if (!ok) {
          issues.push({ id: `powers:${name}`, item: name, field,
            requiresEntity: reqName, text: `Requires ${reqName}` });
        }
      }
    }
  }

  return { issues, notes };
}
