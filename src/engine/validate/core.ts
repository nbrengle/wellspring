// validate/core.ts — shared primitives for the build validator.

import {
  LEVEL_TABLE,
  lookupEntity,
  CLASS_POWERS,
  CLASS_PROGRESSION,
  CLASS_POWER_SLOTS,
  EVENTS_TABLE,
  CLASSES,
} from "../data.js";
import { cleanItemName, bareSkill, getClasses } from "../resolver.js";
import type { CharacterState, ProgressionRow } from "../types.js";
import { sourceClass, Entity } from "../types.js";

import { MAX_LBP, MAX_FLAW_BP, BACKSTORY_BP, MAX_DOMAINS, DEFAULT_WEALTH, LEVEL_CAP } from "../config.js";

export { MAX_LBP, MAX_FLAW_BP, BACKSTORY_BP, MAX_DOMAINS, DEFAULT_WEALTH, LEVEL_CAP };

export const LEGAL_MIN_LEVEL = LEVEL_TABLE.length ? Math.min(...LEVEL_TABLE.map((l) => l.level)) : 4;

export { EVENTS_TABLE };

export const subKey = (s: string) =>
  String(s || "")
    .split(" (")[0]
    .trim()
    .toLowerCase();

import { MARTIAL_SLOT_FIELDS, CASTER_SLOT_FIELDS, POWER_SOURCE_FIELDS, GENERIC_POWER_FIELDS } from "../config.js";

export { MARTIAL_SLOT_FIELDS, CASTER_SLOT_FIELDS, POWER_SOURCE_FIELDS, GENERIC_POWER_FIELDS };

// ─── Class / level primitives ───────────────────────────────────────────────

export function characterLevel(character: CharacterState) {
  const classes = getClasses(character);
  if (!classes.length) return 4;
  return classes.reduce((sum, c) => sum + (c.level || 0), 0);
}

export function getLegalMinLevel(character: CharacterState) {
  const evtNum = character?.currentEvent || 1;
  const evt = EVENTS_TABLE.find((e) => e.event === evtNum);
  return evt ? evt.level : 4;
}

// ─── Rank / progression helpers ─────────────────────────────────────────────

// Get the maximum ranks of an entity dynamically by querying the database/entity index.
export function getMaxRanks(entityId: string): number {
  const ent = lookupEntity(entityId);
  if (!ent) return 1;
  // One field for "how many times can this be taken": `ranks`, uniform across
  // skills, perks, and powers (powers used to call it `maxRanks`).
  const maxR = ent.ranks;
  if (maxR === "unlimited") return Infinity;
  if (typeof maxR === "number") return maxR;
  if (typeof maxR === "string") {
    const val = parseInt(maxR, 10);
    if (!isNaN(val)) return val;
  }
  return 1;
}

export function requiredLevel(power: Entity | null | undefined) {
  return power?.requiredLevel ?? 0;
}
// (pickClass removed — a slot power's granting class now lives in its structured
//  source (Source.class), read via sourceClass(). No parallel powerClass map.)

// The class a choice's source names (class-slot / starting / innate). Structured
// read — re-exported from types so validators share one definition.
export { sourceClass };

// Count a field's picks belonging to `cls`. A choice belongs to `cls` when its
// source names that class (sourceClass) — so class-slot spells/powers count, but
// GRANTED picks (e.g. Bookcaster's book spells, source {granted, by:'Bookcaster'})
// do not: they're the granting entity's own pool, not the class's slots, even when
// they share the novice/adept/greater tiers.
export function countPicksForClass(
  state: CharacterState,
  category: "powers" | "spells",
  cls: string,
  tierFilter?: string | string[],
): number {
  const arr = state[category] || [];
  return arr.reduce((n, choice) => {
    if (sourceClass(choice.source) !== cls) return n;
    if (tierFilter) {
      const ent = lookupEntity(choice.entityId);
      const tier = ent?.tier?.toLowerCase();
      if (Array.isArray(tierFilter)) {
        if (!tier || !tierFilter.map((t) => t.toLowerCase()).includes(tier)) return n;
      } else {
        if (tier !== tierFilter.toLowerCase()) return n;
      }
    }
    return n + (choice.ranks || 1);
  }, 0);
}

export function maxProgressionLevel(cls: string) {
  const levels = Object.keys(CLASS_PROGRESSION[cls] || {})
    .map(Number)
    .filter((n) => !isNaN(n) && n > 0);
  return levels.length ? Math.max(...levels) : 4;
}

// progressionRow definition moved to types.ts

export function progressionRow(cls: string, level: number): ProgressionRow {
  const prog = CLASS_PROGRESSION[cls] || {};
  return prog[level] || prog[Math.min(level, maxProgressionLevel(cls))] || CLASS_POWER_SLOTS[cls] || {};
}

// ─── Grant cluster ──────────────────────────────────────────────────────────

// Active innate powers for the character: class-innate powers whose level
// requirements are met. (In CharacterState, user-added innates are just in `powers` with source `GrantedBy:Innate`)
export function activeInnatePowers(character: CharacterState) {
  const list: { name: string; entity: Entity | undefined; cls: string; source: string }[] = [];
  const seen = new Set();

  for (const { name: cls, level } of getClasses(character)) {
    for (const p of CLASS_POWERS[cls]?.innate || []) {
      if (level >= (p.requiredLevel ?? 0)) {
        const cleanName = cleanItemName(p.name);
        if (!seen.has(cleanName)) {
          seen.add(cleanName);
          list.push({ name: p.name, entity: lookupEntity(p.name) || undefined, cls, source: "class" });
        }
      }
    }
  }
  return list;
}

// Multiclass grants
export function multiclassGrants(character: CharacterState) {
  const classes = getClasses(character);
  const skills: { name: string; source: string }[] = [];
  const freeBPItems: { skill: string; source: string; bp: number }[] = [];
  let freeBP = 0;

  // What does the character explicitly own in their choices?
  const owned = new Set((character.skills || []).map((s) => bareSkill(s.entityId.replace("skills:", ""))));

  classes.slice(1).forEach(({ name }) => {
    for (const g of CLASSES[name]?.multiclassGrants || []) {
      if (owned.has(bareSkill(g.name))) {
        freeBP += g.cost || 0;
        freeBPItems.push({ skill: g.name, source: name, bp: g.cost || 0 });
      } else {
        skills.push({ name: g.name, source: name });
        owned.add(bareSkill(g.name));
      }
    }
  });
  return { skills, freeBP, freeBPItems };
}
