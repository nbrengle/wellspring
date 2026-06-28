// validate/core.ts — shared primitives for the build validator.

import { LEVEL_TABLE, lookupEntity, CLASS_POWERS, CLASS_PROGRESSION, CLASS_POWER_SLOTS, EVENTS_TABLE, CLASSES } from '../data.js';
import { cleanItemName, bareSkill, getClasses } from '../resolver.js';
import type { CharacterStateV2, CharacterChoice } from '../types.js';

import {
  MAX_LBP, MAX_FLAW_BP, BACKSTORY_BP, MAX_DOMAINS, DEFAULT_WEALTH, LEVEL_CAP
} from '../config.js';

export { MAX_LBP, MAX_FLAW_BP, BACKSTORY_BP, MAX_DOMAINS, DEFAULT_WEALTH, LEVEL_CAP };

export const LEGAL_MIN_LEVEL = LEVEL_TABLE.length
  ? Math.min(...LEVEL_TABLE.map((l) => l.level)) : 4;

export { EVENTS_TABLE };

export const subKey = (s: string) => String(s || '').split(' (')[0].trim().toLowerCase();

import {
  BP_FIELDS, BP_POWER_FIELDS, MARTIAL_SLOT_FIELDS, CASTER_SLOT_FIELDS,
  ENTITY_FIELDS, CLASS_POWER_TIERS, POWER_SOURCE_FIELDS, GENERIC_POWER_FIELDS
} from '../config.js';

export {
  BP_FIELDS, BP_POWER_FIELDS, MARTIAL_SLOT_FIELDS, CASTER_SLOT_FIELDS,
  ENTITY_FIELDS, CLASS_POWER_TIERS, POWER_SOURCE_FIELDS, GENERIC_POWER_FIELDS
};

// ─── Class / level primitives ───────────────────────────────────────────────

export function characterLevel(character: CharacterStateV2) {
  const classes = getClasses(character);
  if (!classes.length) return 4;
  return classes.reduce((sum, c) => sum + (c.level || 0), 0);
}

export function getLegalMinLevel(character: CharacterStateV2) {
  const evtNum = character?.currentEvent || 1;
  const evt = EVENTS_TABLE.find(e => e.event === evtNum);
  return evt ? evt.level : 4;
}

// ─── Rank / progression helpers ─────────────────────────────────────────────

// Get the maximum ranks of an entity dynamically by querying the database/entity index.
export function getMaxRanks(entityId: string): number {
  const ent = lookupEntity(entityId) as any;
  if (!ent) return 1;
  // One field for "how many times can this be taken": `ranks`, uniform across
  // skills, perks, and powers (powers used to call it `maxRanks`).
  const maxR = ent.ranks;
  if (maxR === 'unlimited') return Infinity;
  if (typeof maxR === 'number') return maxR;
  if (typeof maxR === 'string') {
    const val = parseInt(maxR, 10);
    if (!isNaN(val)) return val;
  }
  return 1;
}

export function requiredLevel(power: any) {
  return power?.requiredLevel ?? 0;
}

// Extract class from source, e.g. 'Class:Fighter' -> 'Fighter'

// Which class a power pick belongs to (explicit tag, else the sole class, else the
// power's parentClass when the character has that class).
export function pickClass(character: any, field: string, index: number, name: string): string | null {
  const tag = character.powerClass?.[field]?.[index];
  if (tag) return tag;
  const classNames = getClasses(character).map((c: any) => c.name);
  if (classNames.length === 1) return classNames[0];
  const ent = lookupEntity(`powers:${name}`);
  if (ent?.parentClass && classNames.includes(ent.parentClass)) return ent.parentClass;
  return null;
}

export function sourceClass(source: string): string | null {
  if (source?.startsWith('Class:')) return source.substring(6);
  return null;
}

// Count a field's picks belonging to `cls`.
export function countPicksForClass(
  state: CharacterStateV2, 
  category: 'powers' | 'spells', 
  cls: string, 
  tierFilter?: string | string[]
): number {
  const arr = state[category] || [];
  return arr.reduce((n, choice) => {
    if (sourceClass(choice.source) !== cls) return n;
    if (tierFilter) {
      const ent = lookupEntity(choice.entityId) as any;
      const tier = ent?.tier?.toLowerCase();
      if (Array.isArray(tierFilter)) {
        if (!tier || !tierFilter.map(t => t.toLowerCase()).includes(tier)) return n;
      } else {
        if (tier !== tierFilter.toLowerCase()) return n;
      }
    }
    return n + (choice.ranks || 1);
  }, 0);
}

export function maxProgressionLevel(cls: string) {
  const levels = Object.keys(CLASS_PROGRESSION[cls] || {}).map(Number).filter((n) => n > 0);
  return levels.length ? Math.max(...levels) : 4;
}

export function progressionRow(cls: string, level: number) {
  const prog = CLASS_PROGRESSION[cls] || {};
  return prog[level] || prog[Math.min(level, maxProgressionLevel(cls))] || CLASS_POWER_SLOTS[cls];
}

// ─── Grant cluster ──────────────────────────────────────────────────────────

// Active innate powers for the character: class-innate powers whose level
// requirements are met. (In CharacterStateV2, user-added innates are just in `powers` with source `GrantedBy:Innate`)
export function activeInnatePowers(character: CharacterStateV2) {
  const list: any[] = [];
  const seen = new Set();

  for (const { name: cls, level } of getClasses(character)) {
    for (const p of (CLASS_POWERS[cls]?.innate || [])) {
      if (level >= requiredLevel(p)) {
        const cleanName = cleanItemName(p.name);
        if (!seen.has(cleanName)) {
          seen.add(cleanName);
          list.push({ name: p.name, entity: p, cls, source: 'class' });
        }
      }
    }
  }
  return list;
}

// Multiclass grants
export function multiclassGrants(character: CharacterStateV2) {
  const classes = getClasses(character);
  const skills: any[] = [];
  const freeBPItems: any[] = [];
  let freeBP = 0;
  
  // What does the character explicitly own in their choices?
  const owned = new Set((character.skills || []).map(s => bareSkill(s.entityId.replace('skills:', ''))));

  classes.slice(1).forEach(({ name }) => {
    for (const g of (CLASSES[name]?.multiclassGrants || [])) {
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
