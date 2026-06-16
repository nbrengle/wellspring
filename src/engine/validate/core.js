// validate/core.js — shared primitives for the build validator.
//
// Extracted from validate.js as part of the hotspot split (Builder.jsx/validate.js
// were the two highest-churn, highest-coupling files; everything used to land here
// and collide). This module holds the low-level pieces the concern modules
// (lbp, prereqs, …) and the validate.js orchestrator all depend on:
//   - economy/level constants and field-list constants
//   - class/level primitives (getClasses, characterLevel, …)
//   - rank/progression helpers (rankOf, getMaxRanks, progressionRow, …)
//   - the grant cluster (activeInnatePowers, ownedGrantSources, grantedAbilities,
//     grantIndex, derivedGrant) — the single source of truth for "what does the
//     character own / gain free", which prereqs + cost + stats all consume.
//
// Pure functions, no React. Re-exported by the validate.js barrel.

import { LEVEL_TABLE, lookupEntity, REFS, CLASS_POWERS, CLASS_PROGRESSION, CLASS_POWER_SLOTS, EVENTS_TABLE } from '../data.js';
import { cleanItemName, bareSkill, resolveId, entityType, idName, getClasses, primaryClass } from '../resolver.js';

import {
  MAX_LBP, MAX_FLAW_BP, BACKSTORY_BP, MAX_DOMAINS, DEFAULT_WEALTH, LEVEL_CAP
} from '../config.js';

export { MAX_LBP, MAX_FLAW_BP, BACKSTORY_BP, MAX_DOMAINS, DEFAULT_WEALTH, LEVEL_CAP };

// The lowest level the level table documents — the legal campaign floor (4).
export const LEGAL_MIN_LEVEL = LEVEL_TABLE.length
  ? Math.min(...LEVEL_TABLE.map((l) => l.level)) : 4;

export { EVENTS_TABLE };

// Normalize a sublineage label to its base name. The data is inconsistent: a
// sublineage may appear as "Accented (Any Accent…)" on a challenge but just
// "Accented" on an advantage. Compare on the part before " (" so the same
// sublineage matches across challenges, advantages, and the sublineage list.
export const subKey = (s) => String(s || '').split(' (')[0].trim().toLowerCase();

import {
  BP_FIELDS, BP_POWER_FIELDS, MARTIAL_SLOT_FIELDS, CASTER_SLOT_FIELDS,
  ENTITY_FIELDS, CLASS_POWER_TIERS, POWER_SOURCE_FIELDS
} from '../config.js';

export {
  BP_FIELDS, BP_POWER_FIELDS, MARTIAL_SLOT_FIELDS, CASTER_SLOT_FIELDS,
  ENTITY_FIELDS, CLASS_POWER_TIERS, POWER_SOURCE_FIELDS
};

// ─── Class / level primitives ───────────────────────────────────────────────

// Normalization functions getClasses and primaryClass are now imported from ../resolver.js

export function characterLevel(character) {
  const classes = getClasses(character);
  if (!classes.length) return 4;
  return classes.reduce((sum, c) => sum + (c.level || 0), 0);
}

export function getLegalMinLevel(character) {
  const evtNum = character?.currentEvent || 1;
  const evt = EVENTS_TABLE.find(e => e.event === evtNum);
  return evt ? evt.level : 4;
}

// ─── Rank / progression helpers ─────────────────────────────────────────────

const ROMAN_MAP = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15
};
export function parseTrailingRank(name) {
  if (!name) return 1;
  const clean = String(name).trim();
  const xMatch = clean.match(/\s+x\s*(\d+)$/i);
  if (xMatch) return parseInt(xMatch[1], 10);
  const digitMatch = clean.match(/\s+(\d+)$/);
  if (digitMatch) return parseInt(digitMatch[1], 10);
  const romanMatch = clean.match(/\s+([IVXLCDM]+)$/i);
  if (romanMatch) {
    const val = ROMAN_MAP[romanMatch[1].toLowerCase()];
    if (val) return val;
  }
  return 1;
}

// Rank (purchase count) of an item, default 1. "Foo x2" → 2.
export function rankOf(character, field, idx) {
  const item = character[field]?.[idx];
  if (!item) return 1;
  const baseRank = character.ranks?.[field]?.[idx];
  if (baseRank > 1) return baseRank;

  const parsed = parseTrailingRank(item);
  if (parsed > 1) {
    const ent = lookupEntity(resolveId(item, field, character))
      || lookupEntity(`${entityType(field)}:${bareSkill(cleanItemName(item))}`);
    if (ent && ent.name) {
      const canonicalParsed = parseTrailingRank(ent.name);
      if (canonicalParsed === parsed) {
        return 1;
      }
    }
    return parsed;
  }
  return baseRank !== undefined ? baseRank : 1;
}

// Get the maximum ranks of an entity dynamically by querying the database/entity index.
export function getMaxRanks(name, field, character) {
  const type = entityType(field);
  const cleanName = cleanItemName(name);
  const ent = lookupEntity(resolveId(name, field, character))
    || lookupEntity(`${type}:${cleanName}`)
    || lookupEntity(`${type}:${bareSkill(cleanName)}`);
  if (!ent) return 1;
  const maxR = ent.maxRanks ?? ent.ranks;
  if (maxR === 'unlimited') return Infinity;
  if (typeof maxR === 'number') return maxR;
  if (typeof maxR === 'string') {
    const val = parseInt(maxR, 10);
    if (!isNaN(val)) return val;
  }
  return 1;
}

export function requiredLevel(power) {
  return power?.requiredLevel ?? 0;
}

// Which class a power pick belongs to (explicit tag, else the sole class, else the
// power's parentClass when the character has that class).
export function pickClass(character, field, index, name) {
  const tag = character.powerClass?.[field]?.[index];
  if (tag) return tag;
  const classNames = getClasses(character).map((c) => c.name);
  if (classNames.length === 1) return classNames[0];
  const ent = lookupEntity(`powers:${name}`);
  if (ent?.parentClass && classNames.includes(ent.parentClass)) return ent.parentClass;
  return null;
}

// Count a field's picks belonging to `cls`.
export function countPicksForClass(character, field, cls) {
  return (character[field] || []).reduce(
    (n, name, i) => n + (pickClass(character, field, i, name) === cls ? 1 : 0), 0);
}

// The highest level a class's progression documents (base classes cap at 10; the
// source tables stop there, with levels 11+ being Advanced Classes — not yet
// published). Used to clamp slot/stat lookups for levels beyond the table.
export function maxProgressionLevel(cls) {
  const levels = Object.keys(CLASS_PROGRESSION[cls] || {}).map(Number).filter((n) => n > 0);
  return levels.length ? Math.max(...levels) : 4;
}

// The progression row for a class at `level`, clamped to the highest documented
// level so an undocumented L11+ falls back to the top (L10) row rather than
// undefined / the level-4 default.
export function progressionRow(cls, level) {
  const prog = CLASS_PROGRESSION[cls] || {};
  return prog[level] || prog[Math.min(level, maxProgressionLevel(cls))] || CLASS_POWER_SLOTS[cls];
}

// ─── Grant cluster ──────────────────────────────────────────────────────────
// "What does the character own / gain free" — the single source of truth consumed
// by prereqs (satisfy prereqs), cost (zero granted items), and stats.

// Active innate powers for the character: class-innate powers whose level
// requirements are met, merged with any stored non-class innate powers.
export function activeInnatePowers(character) {
  const list = [];
  const seen = new Set();

  // 1. Class-innate powers that are active at their respective class levels.
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

  // 2. Stored user-added innate powers (which are not class-innate or not active).
  (character?.innatePowers || []).forEach((item, index) => {
    const cleanName = cleanItemName(item);
    if (!seen.has(cleanName)) {
      seen.add(cleanName);
      const ent = lookupEntity(`powers:${cleanName}`);
      const cls = pickClass(character, 'innatePowers', index, item);
      list.push({ name: item, entity: ent || null, cls: cls || ent?.parentClass || null, source: 'class', index });
    }
  });

  return list;
}

// Grant/discount SOURCES the character owns: lineage advantages, purchased perks,
// and class innate powers held at level. Returns [{ id, name, kind }].
export function ownedGrantSources(character) {
  const sources = [];
  // Lineage advantages: registry id is "advantages:<Lineage> - <baseName>".
  if (character?.lineage) {
    for (const name of (character.lineageAdvantages || [])) {
      const base = cleanItemName(name);
      sources.push({ id: `advantages:${character.lineage} - ${base}`, name: base, kind: 'advantage' });
    }
  }
  // Owned perks (purchased or class-granted).
  for (const name of (character?.purchasedPerks || [])) {
    const base = cleanItemName(name);
    sources.push({ id: `perks:${base}`, name: base, kind: 'perk' });
  }
  // Class innate powers the character has at level (automatic features).
  for (const ip of activeInnatePowers(character)) {
    sources.push({ id: `powers:${ip.name}`, name: ip.name, kind: 'feature' });
  }
  // Powers the character has actually selected into slots (any tier) — a chosen
  // power can itself grant an ability (e.g. Implicit Truths → Insight).
  const seen = new Set(sources.map((s) => s.id));
  for (const field of POWER_SOURCE_FIELDS) {
    for (const item of (character[field] || [])) {
      const id = `powers:${cleanItemName(item)}`;
      if (!seen.has(id)) { seen.add(id); sources.push({ id, name: cleanItemName(item), kind: 'power' }); }
    }
  }
  return sources;
}

// Named abilities the character GAINS FOR FREE from a source they own. Returns
// { list, bySource }; list is [{ ability, abilityName, abilityType, source,
// sourceId, sourceKind }], bySource groups list by sourceId.
export function grantedAbilities(character) {
  const grants = REFS.grants || {};
  // Only sources that actually grant something (have a grants edge).
  const sources = ownedGrantSources(character).filter((s) => grants[s.id]);

  const list = [];
  const bySource = {};
  const CHOICE_RE = /\b(?:choose\s+one|gains?\s+one\s+of|one\s+of\s+the\s+following|gains?\s+one\s+skill)\b/i;
  for (const src of sources) {
    const ent = lookupEntity(src.id);
    const isChoice = ent?.chooseOne?.kind === 'build' ||
      CHOICE_RE.test(ent?.requirement || '') ||
      CHOICE_RE.test(ent?.description || '') ||
      CHOICE_RE.test(ent?.skillsAndOptions || '');
    if (isChoice) continue;
    const targets = grants[src.id];
    if (!targets) continue;
    for (const ability of targets) {
      const ent = lookupEntity(ability);
      const row = {
        ability,
        abilityName: ent?.name || idName(ability),
        abilityType: ability.slice(0, ability.indexOf(':')),
        source: src.name,
        sourceId: src.id,
        sourceKind: src.kind,
      };
      list.push(row);
      (bySource[src.id] = bySource[src.id] || { source: src.name, sourceKind: src.kind, abilities: [] })
        .abilities.push(row);
    }
  }

  // Choice-driven grants: a build-time choose-one power (Expert Craft) grants the
  // skill the player SELECTED for free. The choice is recorded on the character;
  // resolve it to the same grant shape so it zeroes the skill's cost like any grant.
  const push = (ability, src) => {
    const ent = lookupEntity(ability);
    const row = { ability, abilityName: ent?.name || idName(ability),
      abilityType: ability.slice(0, ability.indexOf(':')), source: src, sourceId: `powers:${src}`, sourceKind: 'choice' };
    list.push(row);
    (bySource[row.sourceId] = bySource[row.sourceId] || { source: src, sourceKind: 'choice', abilities: [] }).abilities.push(row);
  };
  for (const field of POWER_SOURCE_FIELDS) {
    for (const item of (character[field] || [])) {
      const ent = lookupEntity(`powers:${cleanItemName(item)}`);
      if (ent?.chooseOne?.kind !== 'build') continue;
      const chosen = character.choices?.[`powers:${ent.name}`];
      const opt = ent.chooseOne.options.find((o) => o.grantsSkill === chosen || o.text === chosen);
      if (opt?.grantsSkill) push(`skills:${opt.grantsSkill}`, ent.name);
    }
  }
  return { list, bySource };
}

// Index the character's granted abilities by target entity id → granting source
// name. SAME computation as grantedAbilities() (the single source of truth);
// cost-zeroing consumes this index rather than re-joining the grant graph.
export function grantIndex(character) {
  const idx = {};
  for (const g of grantedAbilities(character).list) {
    if (!(g.ability in idx)) idx[g.ability] = g.source;
  }
  return idx;
}

// Is this item granted-free by a source the character owns? Looks the item up in
// the precomputed grant index. Returns a grant note {kind,source} for the badge,
// or null. `ent` may be undefined.
export function derivedGrant(item, field, ent, granted) {
  const itemId = ent?.id || `${entityType(field)}:${bareSkill(cleanItemName(item))}`;
  const source = granted?.[itemId];
  return source ? { kind: 'grant', amount: null, source, derived: true } : null;
}
