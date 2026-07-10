import { BASE_CLASSES, CLASSES, CLASS_POWERS, REFS, lookupEntity } from "../../engine/data.js";
import { bareSkill, cleanItemName, getClasses, parseWordNumber } from "../resolver.js";
import type { BaseEntity, CharacterState } from "../types.js";
import { PrereqIssue, PrereqNote, PrereqReport } from "../types.js";
import { characterLevel } from "../validate/core.js";
import { spellSlots, type SpellPool } from "../validate/slots.js";
import type { CharacterGraphModel } from "./model.js";
import { idName, idPrefix } from "./model.js";

export function prereqStatusFor(
  graph: CharacterGraphModel,
  entityId: string,
): {
  met: boolean;
  missing: { id: string; name: string }[];
  anyOf: { id: string; name: string }[][];
  notes: string[];
} {
  const ent = lookupEntity(entityId) || lookupEntity(entityId.split(":")[0] + ":" + bareSkill(entityId.split(":")[1]));
  const pr = REFS.prereqs[ent?.id || entityId];
  if (!pr) return { met: true, missing: [], anyOf: [], notes: [] };
  const owned = graph._ownedIds;
  const missing = (pr.skills || []).filter((dep: string) => !owned.has(dep));
  const unmetGroups = (pr.anyOf || []).filter((g: string[]) => !g.some((dep: string) => owned.has(dep)));
  const notes = [...(pr.levels || []), ...(pr.other || [])];
  return {
    met: missing.length === 0 && unmetGroups.length === 0,
    missing: missing.map((m: string) => ({ id: m, name: m.split(":")[1] || m })),
    anyOf: unmetGroups.map((g: string[]) => g.map((m: string) => ({ id: m, name: m.split(":")[1] || m }))),
    notes,
  };
}

export function computePrereqs(graph: CharacterGraphModel): PrereqReport {
  const owned = graph._ownedIds;
  const issues: PrereqIssue[] = [];
  const notes: PrereqNote[] = [];
  const seen = new Set<string>();
  const charLevel = graph.characterLevel;
  const charClasses = graph.classes;
  const character = graph.character;

  for (const node of graph.items) {
    if (node.field === "flaws" || node.field === "synthetic") continue;
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
        issues.push({
          id,
          item: node.name,
          field: node.field,
          tierLevel: need,
          tier: rank,
          text: `tier ${rank} requires character level ${need}`,
        });
      }
    }

    // A sub-power can't be SELECTED directly — but it's legitimate when a grant
    // confers it (e.g. Holding Out for a Hero grants the sub-power Save the Day).
    // Flag a player-CHOSEN one (purchased, or a class-slot pick), NOT a granted or
    // innate one. (Slot picks are sourceType 'class' — still a direct selection.)
    if (ent && ent.tier === "SubPower" && (node.sourceType === "purchased" || node.sourceType === "class")) {
      issues.push({
        id,
        item: node.name,
        field: node.field,
        text: `${ent.name} is a sub-power and cannot be selected directly.`,
      });
    }

    const pr = REFS.prereqs[ent?.id || id];
    if (!pr) continue;

    const missing = (pr.skills || []).filter((dep: string) => !owned.has(dep));
    const unmetGroups = (pr.anyOf || []).filter((group: string[]) => !group.some((dep: string) => owned.has(dep)));
    if (missing.length || unmetGroups.length) {
      const eId = node.entity ? id.replace(/^[^:]+:/, `${idPrefix(node.entity)}:`) : id;
      issues.push({
        id: eId,
        item: node.name,
        field: node.field,
        missing: missing.map((m: string) => ({ id: m, name: idName(m) })),
        anyOf: unmetGroups.map((group: string[]) => group.map((m: string) => ({ id: m, name: idName(m) }))),
      });
    }
    for (const lvl of pr.levels || []) {
      const p = node.entity;
      if (p && p.parentClass && charClasses.every((c) => c.name !== p.parentClass)) {
        issues.push({
          id: p.id || id,
          item: node.name,
          field: node.field,
          text: `Requires a level in ${p.parentClass}`,
        });
      }
      const met = checkLevelConstraint(character, lvl, owned);
      if (met === false) {
        issues.push({
          id,
          item: node.name,
          field: node.field,
          text: `Requires ${lvl}`,
        });
      } else if (met === null) {
        notes.push({ id, item: node.name, field: node.field, kind: "level", text: lvl });
      }
    }
    for (const o of pr.other || []) {
      const met = checkLevelConstraint(character, o, owned);
      if (met === false) {
        issues.push({
          id,
          item: node.name,
          field: node.field,
          text: `Requires ${o}`,
        });
      } else if (met === null) {
        notes.push({ id, item: node.name, field: node.field, kind: "other", text: o });
      }
    }
  }

  // Over-cap PURCHASES (flagged generically by the dedupe pass via OVER_CAP) —
  // buying more of a thing than its cap allows is an illegal build. This is the
  // generic replacement for the old Weapon-Spec-specific check: it covers Weapon
  // Specialization (cap 1, two weapon types), a duplicate same-area Lore, a 5th
  // Extended Capacity, etc., from one rule.
  for (const node of graph.items) {
    const overCap = node.effects?.find((e) => e.type === "OVER_CAP");
    if (!overCap) continue;
    issues.push({
      id: node.id,
      item: node.name,
      field: node.field,
      text:
        overCap.cap === 1
          ? `${node.name} can only be taken once.`
          : `${node.name} can be taken at most ${overCap.cap} time(s).`,
    });
  }

  // Independent rule families, each a single-concern check the model composes.
  for (const sub of [
    checkAdvancedClasses(graph),
    checkCreationOnlyPerks(graph),
    checkMutualExclusions(graph),
    checkPowerRequirements(graph),
    checkRepeatableCaps(graph),
    checkLineageConstraints(graph),
  ]) {
    issues.push(...sub.issues);
    notes.push(...sub.notes);
  }

  return { issues, notes };
}

export function checkAdvancedClasses(graph: CharacterGraphModel): {
  issues: PrereqIssue[];
  notes: PrereqNote[];
} {
  const issues: PrereqIssue[] = [];
  const charClasses = graph.classes;
  const advancedClasses = charClasses.filter((c) => !BASE_CLASSES.has(c.name));
  const baseLevel = charClasses.filter((c) => BASE_CLASSES.has(c.name)).reduce((sum, c) => sum + c.level, 0);

  if (advancedClasses.length > 0 && baseLevel < 10) {
    issues.push({
      id: "classes",
      item: "Advanced Classes",
      field: "classes",
      text: `Advanced classes cannot be taken until total level 10 has been reached. (Current base level: ${baseLevel})`,
    });
  }
  if (advancedClasses.length > 2) {
    issues.push({
      id: "classes",
      item: "Advanced Classes",
      field: "classes",
      text: `Character has ${advancedClasses.length} Advanced classes but is limited to a maximum of two.`,
    });
  }
  for (const ac of advancedClasses) {
    if (ac.level > 5) {
      issues.push({
        id: "classes",
        item: ac.name,
        field: "classes",
        text: `Advanced class ${ac.name} cannot exceed a maximum of 5 levels.`,
      });
    }
  }
  return { issues, notes: [] };
}

export function checkCreationOnlyPerks(graph: CharacterGraphModel): {
  issues: PrereqIssue[];
  notes: PrereqNote[];
} {
  const notes: PrereqNote[] = [];
  if ([...graph._ownedIds].some((id) => id.startsWith("perks:Draconic Heritage"))) {
    notes.push({
      id: "perks:Draconic Heritage",
      item: "Draconic Heritage",
      field: "purchasedPerks",
      kind: "other",
      text: "Must be taken at Character Creation.",
    });
  }
  return { issues: [], notes };
}

export function checkMutualExclusions(graph: CharacterGraphModel): {
  issues: PrereqIssue[];
  notes: PrereqNote[];
} {
  const issues: PrereqIssue[] = [];
  const excludes = REFS.excludes || {};
  if (Object.keys(excludes).length) {
    const ownedExcl = new Set<string>();
    const entityToNode = new Map<string, string>();
    for (const node of graph.items) {
      if (
        node.field === "perks" ||
        node.field === "flaws" ||
        node.field === "innatePerks" ||
        node.field === "purchasedPerks"
      ) {
        if (node.id) {
          const eId = node.entity?.id || node.id.replace(/^(purchasedPerks|innatePerks):/, "perks:");
          ownedExcl.add(eId);
          entityToNode.set(eId, node.id);
        }
      }
    }
    for (const g of graph._grantedAbilitiesList) {
      if (/^(perks|flaws):/.test(g.ability)) {
        ownedExcl.add(g.ability);
        if (!entityToNode.has(g.ability)) entityToNode.set(g.ability, g.ability);
      }
    }
    const reportedPairs = new Set<string>();
    for (const id of ownedExcl) {
      for (const other of excludes[id] || []) {
        if (!ownedExcl.has(other)) continue;
        const pairKey = [id, other].sort().join("|");
        if (reportedPairs.has(pairKey)) continue;
        reportedPairs.add(pairKey);
        const nodeId = entityToNode.get(id) || id;
        issues.push({
          id: nodeId,
          item: idName(id),
          field: nodeId.split(":")[0],
          excludes: other,
          text: `cannot be taken along with ${idName(other)}`,
        });
      }
    }
  }
  return { issues, notes: [] };
}

export function checkPowerRequirements(graph: CharacterGraphModel): {
  issues: PrereqIssue[];
  notes: PrereqNote[];
} {
  const issues: PrereqIssue[] = [];
  const owned = graph._ownedIds;
  const charClasses = graph.classes;
  const charLevel = graph.characterLevel;
  const charClassLevels = new Map(charClasses.map((c) => [c.name, c.level]));
  // A power's parser-extracted requirements — the only fields this check reads,
  // whether the power came from the class-power tables or the entity index.
  type PowerReq = Pick<BaseEntity, "requiredLevel" | "requiredClass" | "requiresEntity"> & {
    __contextClass?: string;
  };
  const powerInContext = (name: string): PowerReq | null => {
    for (const { name: cls } of charClasses) {
      const tiers = CLASS_POWERS[cls];
      if (!tiers) continue;
      for (const list of Object.values(tiers)) {
        if (!Array.isArray(list)) continue;
        const hit = list.find((p) => p.name === name);
        if (hit) return { ...(hit as PowerReq), __contextClass: cls };
      }
    }
    return lookupEntity(`powers:${name}`);
  };

  for (const node of graph.items) {
    if (node.entity?.type !== "power") continue;
    const name = cleanItemName(node.name);
    const field = node.field;
    const ent = powerInContext(name);
    if (!ent) continue;

    const requiredLevel = ent.requiredLevel ?? 0;
    if (requiredLevel > 0) {
      const reqClass = ent.requiredClass || ent.__contextClass;
      const have = reqClass ? charClassLevels.get(reqClass) || 0 : charLevel;
      if (have < requiredLevel) {
        issues.push({
          id: `powers:${name}`,
          item: name,
          field,
          text: `Requires ${reqClass ? `${reqClass} ` : ""}Level ${requiredLevel}`,
        });
      }
    }
    for (const reqName of ent.requiresEntity || []) {
      const ok =
        owned.has(`powers:${reqName}`) ||
        owned.has(`skills:${reqName}`) ||
        owned.has(`perks:${reqName}`) ||
        owned.has(`powers:${bareSkill(reqName)}`);
      if (!ok) {
        issues.push({
          id: `powers:${name}`,
          item: name,
          field,
          requiresEntity: reqName,
          text: `Requires ${reqName}`,
        });
      }
    }
  }

  const powerCounts = new Map<string, number>();
  for (const node of graph.items) {
    if (node.entity?.type !== "power" || node.sourceType === "granted") continue;
    const name = cleanItemName(node.name);
    if (!name) continue;
    powerCounts.set(name, (powerCounts.get(name) || 0) + 1);
  }
  for (const [name, count] of powerCounts) {
    if (count > 1) {
      issues.push({
        id: `powers:${name}`,
        item: name,
        field: "powers",
        duplicate: count,
        text: `selected ${count} times — a power may only be taken once`,
      });
    }
  }
  return { issues, notes: [] };
}

export function checkRepeatableCaps(graph: CharacterGraphModel): {
  issues: PrereqIssue[];
  notes: PrereqNote[];
} {
  const issues: PrereqIssue[] = [];
  const elemAffinities: string[] = [];
  for (const node of graph.items) {
    if (bareSkill(cleanItemName(node.name)) === "Elemental Affinity") {
      elemAffinities.push(node.rawString || node.name);
    }
  }
  if (elemAffinities.length) {
    if (elemAffinities.length > 2) {
      issues.push({
        id: "perks:Elemental Affinity",
        item: "Elemental Affinity",
        field: "purchasedPerks",
        text: `taken ${elemAffinities.length} times — may be taken at most twice`,
      });
    }
    const elements = elemAffinities.map((p) => (p.match(/\(([^)]+)\)/) || [])[1]?.trim()).filter(Boolean);
    const dupElement = elements.find((e, i) => elements.findIndex((x) => x.toLowerCase() === e!.toLowerCase()) !== i);
    if (dupElement) {
      issues.push({
        id: "perks:Elemental Affinity",
        item: "Elemental Affinity",
        field: "purchasedPerks",
        text: `cannot attune to ${dupElement} twice — each Elemental Affinity must be a different element`,
      });
    }
  }

  const bloodlines: string[] = [];
  for (const node of graph.items) {
    if (node.entity?.category === "Bloodline") bloodlines.push(node.rawString || node.name);
  }
  if (bloodlines.length > 1) {
    issues.push({
      id: "perks",
      item: "Bloodline Perks",
      field: "purchasedPerks",
      text: `has ${bloodlines.length} Bloodline Perks (${bloodlines.join(", ")}) — character may only have one`,
    });
  }
  return { issues, notes: [] };
}

export function checkLineageConstraints(graph: CharacterGraphModel): {
  issues: PrereqIssue[];
  notes: PrereqNote[];
} {
  const issues: PrereqIssue[] = [];
  const character = graph.character;
  const sublineages = character.sublineages || {};
  const hasFlaw = (name: string) => (character.flaws || []).some((f) => f.entityId === name);
  const hasSkill = (name: string) => (character.skills || []).some((s) => s.entityId === name);

  if (sublineages["Hot Blooded"] && hasFlaw("Pliant")) {
    issues.push({
      id: "flaws:Pliant",
      item: "Pliant",
      field: "flaws",
      text: `cannot be taken along with the Hot Blooded lineage challenge`,
    });
  }

  if (sublineages["Anti-magic"]) {
    const spellcastingLevels = character.classes.filter((c) => CLASSES[c.name]?.spellcaster && c.level > 0);
    if (spellcastingLevels.length > 0) {
      issues.push({
        id: "classes:" + spellcastingLevels[0].name,
        item: spellcastingLevels[0].name,
        field: "classes",
        text: `cannot take class levels in spellcasting classes due to Anti-magic lineage challenge`,
      });
    }
    if (hasSkill("Ritual Magic")) {
      issues.push({
        id: "skills:Ritual Magic",
        item: "Ritual Magic",
        field: "skills",
        text: `cannot purchase Ritual Magic due to Anti-magic lineage challenge`,
      });
    }
  }

  if (sublineages["The Fractured"]) {
    const stats = character.stats || {};
    if ((stats.maxLifePoints ?? 0) < 1) {
      issues.push({
        id: "lineage:The Fractured",
        item: "The Fractured",
        field: "lineage",
        text: `cannot be taken if the character already has 1 maximum Life Point (would reduce below 1)`,
      });
    }
  }

  if (sublineages["Divinity's Scourge"] && hasFlaw("Divine Vulnerability")) {
    issues.push({
      id: "flaws:Divine Vulnerability",
      item: "Divine Vulnerability",
      field: "flaws",
      text: `cannot be taken along with the Divinity's Scourge lineage challenge`,
    });
  }
  return { issues, notes: [] };
}

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

  let m = constraintStr.match(/^(\d+)\s+(?:levels?|class-levels)\s+in\s+(?:a\s+)?Martial\s+Classes/i);
  if (m) {
    const required = parseInt(m[1], 10);
    const martial = charClasses
      .filter((c) => CLASSES[c.name]?.tags?.includes("Martial"))
      .reduce((sum, c) => sum + c.level, 0);
    return martial >= required;
  }

  m = constraintStr.match(/^Level\s+(\d+)\s+([A-Za-z\s]+)$/i);
  if (m) {
    const requiredLevel = parseInt(m[1], 10);
    const classStr = m[2].trim().toLowerCase();

    // Spellcaster meta-class
    if (classStr === "spellcaster" || classStr === "spellcaster class") {
      const highestSpellcasterLevel = charClasses
        .filter((c) => CLASSES[c.name]?.spellcaster)
        .reduce((max, c) => Math.max(max, c.level), 0);
      return highestSpellcasterLevel >= requiredLevel;
    }

    // Specific class
    const matchClass = charClasses.find((c) => c.name.toLowerCase() === classStr);
    return matchClass ? matchClass.level >= requiredLevel : false;
  }

  m = constraintStr.match(/^(?:Level\s+(\d+)|(\d+)(?:st|nd|rd|th)\s+character-level)$/i);
  if (m) {
    return charLevel >= parseInt(m[1] || m[2], 10);
  }

  if (/^Light Armor|Medium Armor|Heavy Armor$/i.test(constraintStr)) {
    return owned.has(`skills:${constraintStr}`);
  }

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

  m = constraintStr.match(/^(\d+)\s+Ranks\s+of\s+Profession/i);
  if (m) {
    const count = parseInt(m[1], 10);
    const profs = [...owned].filter((id) => /^skills:Profession/i.test(id));
    return profs.length >= count;
  }

  if (/Profession\s*-\s*\[Any\]/i.test(constraintStr)) {
    return [...owned].some((id) => /^skills:Profession/i.test(id));
  }

  if (/At least one Armor Proficiency/i.test(constraintStr)) {
    return (
      owned.has("skills:Light Armor") ||
      owned.has("skills:Medium Armor") ||
      owned.has("skills:Heavy Armor") ||
      owned.has("skills:Ironclad Armor")
    );
  }

  if (/One level in a non-casting class/i.test(constraintStr)) {
    return charClasses.some((c) => !CLASSES[c.name]?.spellcaster && c.level >= 1);
  }

  if (/class-levels in at least two Base Classes/i.test(constraintStr)) {
    return charClasses.filter((c) => c.level > 0).length >= 2;
  }

  return null;
}
