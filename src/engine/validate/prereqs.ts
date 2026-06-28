// validate/prereqs.ts — prerequisite & build-rule checking.
//
// Extracted from validate.js (hotspot split). Verifies skill/entity prereqs,
// free-text level/class/armor/spell-slot constraints, and the structural build
// rules (Weapon Specialization limit, Advanced Classes limits, power level/entity
// requirements). Depends on core primitives + slots (for spell-slot constraints).
// Re-exported by the validate.js barrel.

import { lookupEntity, REFS, CLASS_POWERS, CLASSES, BASE_CLASSES } from '../data.js';
import { cleanItemName, bareSkill, getClasses } from '../resolver.js';
const idName = (id) => id.split(':')[1] || id;
import { characterLevel, ENTITY_FIELDS } from './core.js';
import { spellSlots } from './slots.js';
import { grantedAbilities, resolveCharacterGraph } from '../graph.js';
import { ARMOR_SKILLS } from '../config.js';

// All entity ids the character owns, for satisfying skill-prereqs. DERIVED from
// the character graph (single source of truth — it already walks every owned
// field) plus granted abilities. For each owned item we add its resolved id and a
// spread of name-aliases so a prereq stated against any equivalent id
// (powers:/perks:/skills:, full or bare name) resolves.
function ownedIds(character) {
  const owned = new Set();
  const graph = resolveCharacterGraph(character);
  for (const node of graph.items) {
    if (node.field === 'flaws' || node.field === 'synthetic') continue;
    if (node.id) {
      owned.add(node.id);
      if (node.id.includes('|')) owned.add(node.id.split('|')[0] + '|any');
    }
    const clean = cleanItemName(node.rawString);
    const bare = bareSkill(clean);
    const candidates = [
      `${node.field}:${bare}`,
      `powers:${clean}`, `perks:${clean}`, `skills:${clean}`,
      `powers:${bare}`, `perks:${bare}`, `skills:${bare}`,
    ];
    for (const cand of candidates) {
      const e = lookupEntity(cand);
      if (e) { owned.add(e.id); owned.add(`${e.type}:${bareSkill(e.name)}`); }
    }
    if (node.entity) { owned.add(node.entity.id); owned.add(`${node.entity.type}:${bareSkill(node.entity.name)}`); }
    
    if (node.entity && node.entity.parameter) {
      const p = node.entity.parameter.toLowerCase();
      owned.add(`${node.id}|${p}`);
      owned.add(`${node.id}|any`);
    }
  }
  // Granted abilities also satisfy prerequisites.
  for (const g of grantedAbilities(character).list) {
    owned.add(g.ability);
    const ent = lookupEntity(g.ability);
    if (ent) owned.add(`${ent.type}:${bareSkill(ent.name)}`);
  }
  return owned;
}

// Whether a character meets the prereqs for a single entity id — used by the
// power picker to flag locked candidates. Returns { met, missing, anyOf, notes }
// where `met` is true only when all hard skill-prereqs (incl. disjunctions) are
// satisfied. Free-text level/other prereqs can't be auto-verified, so they don't
// block `met` but are surfaced as notes.
export function prereqStatus(character, entityId) {
  const ent = lookupEntity(entityId) || lookupEntity(entityId.split(':')[0] + ':' + bareSkill(entityId.split(':')[1]));
  const pr = REFS.prereqs[ent?.id || entityId];
  if (!pr) return { met: true, missing: [], anyOf: [], notes: [] };
  const owned = ownedIds(character);
  const missing = (pr.skills || []).filter((dep) => !owned.has(dep));
  const unmetGroups = (pr.anyOf || []).filter((g) => !g.some((dep) => owned.has(dep)));
  const notes = [...(pr.levels || []), ...(pr.other || [])];
  return {
    met: missing.length === 0 && unmetGroups.length === 0,
    missing: missing.map((m) => ({ id: m, name: m.split(':')[1] || m })),
    anyOf: unmetGroups.map((g) => g.map((m) => ({ id: m, name: m.split(':')[1] || m }))),
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
  const charClasses = getClasses(character);

  const graph = resolveCharacterGraph(character);
  for (const node of graph.items) {
    if (node.field === 'flaws' || node.field === 'synthetic') continue;
    const id = node.id;
    if (seen.has(id)) continue;
    seen.add(id);
    const ent = node.entity;
    
    // Tiered perks (Draconic Heritage): each purchased tier requires a minimum
    // CHARACTER level (tier 2 → lvl 5, …).
    if (Array.isArray(ent?.tiers) && ent.tiers.length) {
      const rank = Math.min(node.rank || 1, ent.tiers.length);
      const need = ent.tiers[rank - 1]?.level || 0;
      if (need > charLevel) {
        issues.push({ id, item: node.name, field: node.field, tierLevel: need, tier: rank,
          text: `tier ${rank} requires character level ${need}` });
      }
    }

    if (ent && ent.tier === 'SubPower') {
      issues.push({
        id, item: node.name, field: node.field,
        text: `${ent.name} is a sub-power and cannot be selected directly.`,
      });
    }

    const pr = REFS.prereqs[ent?.id || id];
    if (!pr) continue;

    const missing = (pr.skills || []).filter((dep) => !owned.has(dep));
    const unmetGroups = (pr.anyOf || []).filter((group) => !group.some((dep) => owned.has(dep)));
    if (missing.length || unmetGroups.length) {
      const eId = node.entity ? id.replace(/^[^:]+:/, `${node.entity.type}:`) : id;
      issues.push({
        id: eId, item: node.name, field: node.field,
        missing: missing.map((m) => ({ id: m, name: idName(m) })),
        anyOf: unmetGroups.map((group) => group.map((m) => ({ id: m, name: idName(m) }))),
      });
    }
    for (const lvl of pr.levels || []) {
      const p = node.entity;
      if (p && p.parentClass && charClasses.every((c) => c.name !== p.parentClass)) {
        issues.push({ id: p.id, item: node.name, field: node.field, 
          text: `Requires a level in ${p.parentClass}` });
      }
      const met = checkLevelConstraint(character, lvl, owned);
      if (met === false) {
        issues.push({
          id, item: node.name, field: node.field,
          text: `Requires ${lvl}`
        });
      } else if (met === null) {
        notes.push({ id, item: node.name, field: node.field, kind: 'level', text: lvl });
      }
    }
    for (const o of pr.other || []) {
      const met = checkLevelConstraint(character, o, owned);
      if (met === false) {
        issues.push({
          id, item: node.name, field: node.field,
          text: `Requires ${o}`
        });
      } else if (met === null) {
        notes.push({ id, item: node.name, field: node.field, kind: 'other', text: o });
      }
    }
  }

  const weaponSpecs = [];
  for (const node of graph.items) {
    if (node.field !== 'flaws' && bareSkill(cleanItemName(node.name)) === 'Weapon Specialization') {
      weaponSpecs.push({ item: node.name, field: node.field });
    }
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
  const advancedClasses = charClasses.filter(c => !BASE_CLASSES.has(c.name));
  const baseLevel = charClasses
    .filter(c => BASE_CLASSES.has(c.name))
    .reduce((sum, c) => sum + c.level, 0);

  if (advancedClasses.length > 0 && baseLevel < 10) {
    issues.push({
      id: 'classes', item: 'Advanced Classes', field: 'classes',
      text: `Advanced classes cannot be taken until total level 10 has been reached. (Current base level: ${baseLevel})`,
    });
  }

  if (advancedClasses.length > 2) {
    issues.push({
      id: 'classes', item: 'Advanced Classes', field: 'classes',
      text: `Character has ${advancedClasses.length} Advanced classes but is limited to a maximum of two.`,
    });
  }

  // An advanced class itself cannot exceed 5 levels
  for (const ac of advancedClasses) {
    if (ac.level > 5) {
      issues.push({
        id: 'classes', item: ac.name, field: 'classes',
        text: `Advanced class ${ac.name} cannot exceed a maximum of 5 levels.`,
      });
    }
  }

  // ─── Armor/Shield penalty notes ───
  // Characters need the corresponding skill (or higher) to avoid BP penalties.
  // We collect the heaviest armor/shield they own and check skills.
  const ownedArmor = [];
  for (const node of graph.items) {
    if (node.entity?.type !== 'skills') continue;
    const clean = cleanItemName(node.name);
    if (ARMOR_SKILLS.has(clean) || ARMOR_SKILLS.has(bareSkill(clean))) ownedArmor.push(clean);
  }
  for (const g of grantedAbilities(character).list) {
    if (g.abilityType === 'skills') {
      const clean = cleanItemName(g.abilityName);
      if (ARMOR_SKILLS.has(clean) || ARMOR_SKILLS.has(bareSkill(clean))) {
        ownedArmor.push(clean);
      }
    }
  }
  const hasDraconicHeritage = [...owned].some(id => id.startsWith('perks:Draconic Heritage'));
  if (hasDraconicHeritage) {
    notes.push({
      id: 'perks:Draconic Heritage',
      item: 'Draconic Heritage',
      field: 'purchasedPerks',
      kind: 'other',
      text: 'Must be taken at Character Creation.',
    });
  }

  // ─── Mutual exclusions (perks/flaws that "cannot be taken along with" each other) ───
  const excludes = REFS.excludes || {};
  if (Object.keys(excludes).length) {
    const ownedExcl = new Set();
    for (const node of graph.items) {
      if (node.field === 'purchasedPerks' || node.field === 'flaws' || node.field === 'innatePerks') {
        if (node.id) ownedExcl.add(node.id);
      }
    }
    for (const g of grantedAbilities(character).list) {
      if (/^(perks|flaws):/.test(g.ability)) ownedExcl.add(g.ability);
    }
    const reportedPairs = new Set();
    for (const id of ownedExcl) {
      for (const other of excludes[id] || []) {
        if (!ownedExcl.has(other)) continue;
        const pairKey = [id, other].sort().join('|');
        if (reportedPairs.has(pairKey)) continue;
        reportedPairs.add(pairKey);
        issues.push({
          id, item: idName(id), field: id.split(':')[0],
          excludes: other,
          text: `cannot be taken along with ${idName(other)}`,
        });
      }
    }
  }

  // ─── Power requirements (parser-extracted: requiredLevel + requiresEntity) ───
  const charClassLevels = new Map(charClasses.map((c) => [c.name, c.level]));
  const powerInContext = (name) => {
    for (const { name: cls } of charClasses) {
      const tiers = CLASS_POWERS[cls];
      if (!tiers) continue;
      for (const list of Object.values(tiers)) {
        if (!Array.isArray(list)) continue;
        const hit = list.find((p) => p.name === name);
        if (hit) return { ...hit, __contextClass: cls };
      }
    }
    return lookupEntity(`powers:${name}`);
  };

  for (const node of graph.items) {
    if (node.entity?.type !== 'powers') continue;
    const name = cleanItemName(node.name);
    const field = node.field;
    const ent = powerInContext(name);
    if (!ent) continue;

    if (ent.requiredLevel > 0) {
      const reqClass = ent.requiredClass || ent.__contextClass;
      const have = reqClass ? (charClassLevels.get(reqClass) || 0) : charLevel;
      if (have < ent.requiredLevel) {
        issues.push({ id: `powers:${name}`, item: name, field,
          text: `Requires ${reqClass ? `${reqClass} ` : ''}Level ${ent.requiredLevel}` });
      }
    }

    for (const reqName of (ent.requiresEntity || [])) {
      const ok = owned.has(`powers:${reqName}`) || owned.has(`skills:${reqName}`)
        || owned.has(`perks:${reqName}`) || owned.has(`powers:${bareSkill(reqName)}`);
      if (!ok) {
        issues.push({ id: `powers:${name}`, item: name, field,
          requiresEntity: reqName, text: `Requires ${reqName}` });
      }
    }
  }

  const powerCounts = new Map();
  for (const node of graph.items) {
    if (node.entity?.type !== 'powers' || node.sourceType !== 'purchased') continue;
    const name = cleanItemName(node.name);
    if (!name) continue;
    powerCounts.set(name, (powerCounts.get(name) || 0) + 1);
  }
  for (const [name, count] of powerCounts) {
    if (count > 1) {
      issues.push({
        id: `powers:${name}`, item: name, field: 'powers',
        duplicate: count,
        text: `selected ${count} times — a power may only be taken once`,
      });
    }
  }

  // ─── Elemental Affinity cap ───
  const elemAffinities = [];
  for (const node of graph.items) {
    if (bareSkill(cleanItemName(node.name)) === 'Elemental Affinity') {
      elemAffinities.push(node.rawString);
    }
  }
  if (elemAffinities.length) {
    if (elemAffinities.length > 2) {
      issues.push({
        id: 'perks:Elemental Affinity', item: 'Elemental Affinity', field: 'purchasedPerks',
        text: `taken ${elemAffinities.length} times — may be taken at most twice`,
      });
    }
    const elements = elemAffinities
      .map((p) => (p.match(/\(([^)]+)\)/) || [])[1]?.trim())
      .filter(Boolean);
    const dupElement = elements.find((e, i) => elements.findIndex((x) => x.toLowerCase() === e.toLowerCase()) !== i);
    if (dupElement) {
      issues.push({
        id: 'perks:Elemental Affinity', item: 'Elemental Affinity', field: 'purchasedPerks',
        text: `cannot attune to ${dupElement} twice — each Elemental Affinity must be a different element`,
      });
    }
  }

  const bloodlines = [];
  for (const node of graph.items) {
    if (node.entity?.category === 'Bloodline') bloodlines.push(node.rawString);
  }
  if (bloodlines.length > 1) {
    issues.push({
      id: 'perks', item: 'Bloodline Perks', field: 'purchasedPerks',
      text: `has ${bloodlines.length} Bloodline Perks (${bloodlines.join(', ')}) — character may only have one`,
    });
  }

  // ─── Lineage-specific constraints ───
  const sublineages = character.sublineages || {};
  
  if (sublineages["Hot Blooded"] && (character.flaws || []).includes("Pliant")) {
    issues.push({
      id: 'flaws:Pliant', item: 'Pliant', field: 'flaws',
      text: `cannot be taken along with the Hot Blooded lineage challenge`,
    });
  }

  if (sublineages["Anti-magic"]) {
    const spellcastingLevels = (character.classes || []).filter(c => CLASSES[c.name]?.spellcaster && c.level > 0);
    if (spellcastingLevels.length > 0) {
      issues.push({
        id: 'classes:' + spellcastingLevels[0].name, item: spellcastingLevels[0].name, field: 'classes',
        text: `cannot take class levels in spellcasting classes due to Anti-magic lineage challenge`,
      });
    }
    if ((character.startingSkills || []).includes("Ritual Magic") || (character.purchasedSkills || []).includes("Ritual Magic")) {
      issues.push({
        id: 'skills:Ritual Magic', item: 'Ritual Magic', field: 'skills',
        text: `cannot purchase Ritual Magic due to Anti-magic lineage challenge`,
      });
    }
  }

  if (sublineages["The Fractured"]) {
    const stats = character.stats || {};
    if (stats.maxLifePoints < 1) {
      issues.push({
        id: 'lineage:The Fractured', item: 'The Fractured', field: 'lineage',
        text: `cannot be taken if the character already has 1 maximum Life Point (would reduce below 1)`,
      });
    }
  }

  if (sublineages["Divinity's Scourge"] && (character.flaws || []).includes("Divine Vulnerability")) {
    issues.push({
      id: 'flaws:Divine Vulnerability', item: 'Divine Vulnerability', field: 'flaws',
      text: `cannot be taken along with the Divinity's Scourge lineage challenge`,
    });
  }

  return { issues, notes };
}
