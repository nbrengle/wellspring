// validate/prereqs.js — prerequisite & build-rule checking.
//
// Extracted from validate.js (hotspot split). Verifies skill/entity prereqs,
// free-text level/class/armor/spell-slot constraints, and the structural build
// rules (Weapon Specialization limit, Advanced Classes limits, power level/entity
// requirements). Depends on core primitives + slots (for spell-slot constraints).
// Re-exported by the validate.js barrel.

import { lookupEntity, REFS, CLASS_POWERS, CLASSES, BASE_CLASSES } from '../data.js';
import { cleanItemName, bareSkill, resolveId, idName, entityType, getClasses } from '../resolver.js';
import {
  characterLevel, rankOf, ENTITY_FIELDS,
} from './core.js';
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
  const addAliases = (rawString, field, nodeId, ent) => {
    if (nodeId) {
      owned.add(nodeId);
      if (nodeId.includes('|')) owned.add(nodeId.split('|')[0] + '|any');
    }
    const fieldId = resolveId(rawString, field, character);
    if (fieldId) {
      owned.add(fieldId);
      if (fieldId.includes('|')) owned.add(fieldId.split('|')[0] + '|any');
    }
    const clean = cleanItemName(rawString);
    const bare = bareSkill(clean);
    const candidates = [
      `${entityType(field)}:${bare}`,
      `powers:${clean}`, `perks:${clean}`, `skills:${clean}`,
      `powers:${bare}`, `perks:${bare}`, `skills:${bare}`,
    ];
    for (const cand of candidates) {
      const e = lookupEntity(cand);
      if (e) { owned.add(e.id); owned.add(`${e.type}:${bareSkill(e.name)}`); }
    }
    if (ent) { owned.add(ent.id); owned.add(`${ent.type}:${bareSkill(ent.name)}`); }
  };

  const graph = resolveCharacterGraph(character);
  for (const node of graph.items) {
    if (node.field === 'flaws' || node.field === 'synthetic') continue;
    addAliases(node.rawString, node.field, node.id, node.entity);
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
      .filter(c => !CLASSES[c.name]?.spellcaster)
      .reduce((sum, c) => sum + c.level, 0);
    return martialLevels >= required;
  }

  // 2. "One level in a non-casting class"
  m = constraintStr.match(/^(one|1)\s+level\s+in\s+a\s+non-casting\s+class/i);
  if (m) {
    return charClasses.some(c => !CLASSES[c.name]?.spellcaster && c.level >= 1);
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
    return charClasses.some(c => CLASSES[c.name]?.spellcaster && c.level >= required);
  }

  // 5. "N levels in a single casting class."
  m = constraintStr.match(/^(\d+)\s+levels?\s+in\s+a\s+single\s+casting\s+class/i);
  if (m) {
    const required = parseInt(m[1], 10);
    return charClasses.some(c => CLASSES[c.name]?.spellcaster && c.level >= required);
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
    const pools = spellSlots(character) || {};
    return Object.values(pools).some(p => (p[tier] || 0) >= 1);
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

  // ─── Mutual exclusions (perks/flaws that "cannot be taken along with" each other) ───
  // REFS.excludes is a symmetric map of entity-id → [excluded ids]. The relationship
  // crosses categories (a perk can exclude a flaw), and flaws are excluded from the
  // prereq-satisfaction `owned` set, so derive owned perk+flaw ids straight from the
  // graph. A character holding BOTH halves of an exclusion is illegal; report it once
  // per unordered pair.
  const excludes = REFS.excludes || {};
  if (Object.keys(excludes).length) {
    const ownedExcl = new Set();
    for (const node of resolveCharacterGraph(character).items) {
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
        if (hit) return { ...hit, __contextClass: cls };
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
        const reqClass = ent.requiredClass || ent.__contextClass;
        const have = reqClass ? (charClassLevels.get(reqClass) || 0) : charLevel;
        if (have < ent.requiredLevel) {
          issues.push({ id: `powers:${name}`, item: name, field,
            text: `Requires ${reqClass ? `${reqClass} ` : ''}Level ${ent.requiredLevel}` });
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

  // ─── No duplicate powers ───
  // A power may not be selected more than once across all power fields. This is the
  // general rule behind "the Power cannot be one the character already has" — e.g.
  // Extensive Combat Training's bonus tier-power slot can't re-pick a power you own.
  // (Class-granted powers live outside these selection fields, so multiclass grants
  // don't false-positive.)
  const powerCounts = new Map();
  for (const field of POWER_REQ_FIELDS) {
    for (const item of character[field] || []) {
      const name = cleanItemName(item);
      if (!name) continue;
      powerCounts.set(name, (powerCounts.get(name) || 0) + 1);
    }
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
  // "This Perk can be taken up to twice, and each time the character may choose any
  // element they desire, although they may not attune to more than one element at a
  // time." → at most 2 instances, each a DISTINCT element. Enforce both.
  const elemAffinities = (character.purchasedPerks || [])
    .filter((p) => bareSkill(cleanItemName(p)) === 'Elemental Affinity');
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

  // ─── Lineage-specific constraints ───
  const sublineages = character.sublineages || {};
  
  // "Hot Blooded" cannot be purchased along with the "Pliant" flaw.
  if (sublineages["Hot Blooded"] && (character.flaws || []).includes("Pliant")) {
    issues.push({
      id: 'flaws:Pliant', item: 'Pliant', field: 'flaws',
      text: `cannot be taken along with the Hot Blooded lineage challenge`,
    });
  }

  // "Anti-magic" restricts spellcasting classes and Ritual Magic.
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

  // "The Fractured" reduces max LP by 1, cannot be taken if character has 1 max LP.
  // We'll enforce that maxLifePoints >= 1, or that taking it didn't push it below 1.
  // Wait, Wellspring base LP is 3 for Humans, etc. The builder engine computes maxLifePoints.
  if (sublineages["The Fractured"]) {
    const stats = character.stats || {};
    if (stats.maxLifePoints < 1) {
      issues.push({
        id: 'lineage:The Fractured', item: 'The Fractured', field: 'lineage',
        text: `cannot be taken if the character already has 1 maximum Life Point (would reduce below 1)`,
      });
    }
  }

  // "Divinity's Scourge" cannot take Divine Vulnerability flaw.
  if (sublineages["Divinity's Scourge"] && (character.flaws || []).includes("Divine Vulnerability")) {
    issues.push({
      id: 'flaws:Divine Vulnerability', item: 'Divine Vulnerability', field: 'flaws',
      text: `cannot be taken along with the Divinity's Scourge lineage challenge`,
    });
  }

  return { issues, notes };
}
