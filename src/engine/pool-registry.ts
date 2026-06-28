// pool-registry.ts — derives the class "pools" (per-character points reserves a
// power establishes: Healing Touch Pool, Life Tap Pool, Living Iron Pool, Balance
// Pool, Maintenance Pool) and the powers that interact with each, for surfacing
// pools in the UI (identity rail + a Pool facet).
//
// A pool is, structurally, a derived stat: a defining power sets a base size
// formula; other powers spend from / add to it. So this mirrors how Life/Armor
// already work (base + contributors), and reuses the same derive-first approach
// as param-domain.ts.
//
// ── Tolerant of CURRENT (un-fixed) source text ──────────────────────────────
// The MegaDoc spells pools inconsistently ("Healing Touch Pool" vs "healing
// pool", Pool vs pool, "Maintenance Points"). Source fixes are pending approval,
// so matching here is CASE-INSENSITIVE and includes known variant aliases — pools
// resolve whether or not the source is cleaned up. `scripts/audit/pool-audit.mjs`
// tracks the source inconsistencies.
//
// ⚠ TECH DEBT — POOLS, ALIASES and the formula parser are declared/hardcoded.
// Each is marked TODO(derive); the goal is to shrink them as the source/parser
// emits pool definitions cleanly. New pools must be added here AND will surface
// via unresolvedPoolMentions() if a reference can't be matched.

import { lookupEntity } from './data.js';

export interface PoolDef {
  id: string;
  name: string;            // canonical display name
  definedBy: string;       // the power/entity that establishes the pool
  aliases: RegExp;         // case-insensitive match incl. known variant spellings
}

// TODO(derive): catalog parsed from defining powers rather than declared here.
export const POOLS: PoolDef[] = [
  { id: 'healing-touch', name: 'Healing Touch Pool', definedBy: 'Healing Touch',
    aliases: /healing touch pool|healing pool/i },                         // "healing pool" = Greater Healing Touch variant
  { id: 'life-tap', name: 'Life Tap Pool', definedBy: 'Life Tap',
    aliases: /life tap pool/i },
  { id: 'living-iron', name: 'Living Iron Pool', definedBy: 'Living Iron',
    aliases: /living iron pool/i },
  { id: 'balance', name: 'Balance Pool', definedBy: 'The Balance of Life',
    aliases: /balance pool/i },
  { id: 'maintenance', name: 'Maintenance Pool', definedBy: 'Field Maintenance',
    aliases: /maintenance pool|pool of maintenance points|maintenance points/i },
];

const poolById = new Map(POOLS.map((p) => [p.id, p]));
export const getPool = (id: string): PoolDef | undefined => poolById.get(id);

const textOf = (e: any): string =>
  [e?.description, e?.effect, e?.call].filter(Boolean).join('  ');

/** Which pool(s) does this entity's text reference? Returns pool ids. */
export function poolsReferenced(entity: any): string[] {
  const text = textOf(entity);
  if (!/pool|maintenance points/i.test(text)) return [];
  return POOLS.filter((p) => p.aliases.test(text)).map((p) => p.id);
}

export type PoolRelation = 'defines' | 'augments-max' | 'refills' | 'spends' | 'mentions';

// A PERMANENT max-increase (augments-max) is a passive boost to the pool's size —
// cued by "additional point(s) per … level" / "increase … maximum" and the ABSENCE
// of an activation trigger. A TEMPORARY add (refills) puts points into the current
// pool when an action fires — cued by "casting/cast/whenever/each time/for each".
const PERMANENT_AUGMENT = /(additional|extra)\s+points?\s+(to|in)[^.]*\bper\b[^.]*level|increase[^.]*\b(maximum|max)\b[^.]*pool|\bper\b[^.]*level[^.]*pool/i;
const ACTIVATION_TRIGGER = /\b(casting|cast|whenever|each time|when they|for each|upon)\b/i;

/** How does this entity relate to a given pool? Derived from verb cues in prose.
 *  Precedence: `defines` (canonical definer) → `spends` (checked before adds, since
 *  spend powers often also say "grant"/"add") → `augments-max` (PERMANENT size
 *  boost) → `refills` (TEMPORARY add during play) → `mentions`.
 *  ⚠ TODO(derive): verb-cue classification is fuzzy; a structured pool-effect from
 *  the parser should replace it. */
export function poolRelation(entity: any, poolId: string): PoolRelation | null {
  const pool = poolById.get(poolId);
  const text = textOf(entity);
  if (!pool || !pool.aliases.test(text)) return null;
  if (entity.name === pool.definedBy) return 'defines';
  // spend cues first — spend powers frequently also say "grant"/"add".
  if (/\b(expend|subtract|spend(s|ing)?|lose|draw|use|point[s]? from)\b[^.]*pool|from (the|their|its)[^.]*pool/i.test(text)) {
    return 'spends';
  }
  const adds = /\b(add(s|ing)?|additional point|grant)\b[^.]*pool|adds?\s+\d+\s+points?\s+to[^.]*pool/i.test(text);
  if (adds) {
    // permanent if it raises the MAX (per-level / maximum) and isn't an activated action.
    if (PERMANENT_AUGMENT.test(text) && !ACTIVATION_TRIGGER.test(text)) return 'augments-max';
    return 'refills';
  }
  return 'mentions';
}

// ── Pool size formula (TECH DEBT — TODO(derive) regular forms; declare residual) ─
const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10 };

/** Parse a defining power's size formula into { mult, add } so size = mult*level + add.
 *  Handles "three times … class-level" / "3 x … level" / "10 plus … level" / flat
 *  "maximum points of N". Returns null if the prose isn't recognized (→ guard). */
export function poolSizeFormula(entity: any): { mult: number; add: number } | null {
  const t = textOf(entity).replace(/\s+/g, ' ');
  const num = (s: string): number | null => {
    const w = WORD_NUM[s.toLowerCase()];
    if (w != null) return w;
    const n = parseInt(s, 10);
    return isNaN(n) ? null : n;
  };
  // "<N> (times|x) … class-level"  → mult*level
  let m = t.match(/(\w+)\s*(?:times|x)\s+[^.]*?class.?level/i);
  if (m && num(m[1]) != null) return { mult: num(m[1])!, add: 0 };
  // "<N> plus … class-level"  → level + N
  m = t.match(/(\w+)\s+plus\s+[^.]*?class.?level/i);
  if (m && num(m[1]) != null) return { mult: 1, add: num(m[1])! };
  // "<N> (additional) point(s) … per … (class-)level"  → N per level (augment form)
  m = t.match(/(\w+)\s+(?:additional\s+)?points?\b[^.]*?\bper\b[^.]*?level/i);
  if (m && num(m[1]) != null) return { mult: num(m[1])!, add: 0 };
  // flat "maximum points of <N>" / "maximum of <N>"  → constant
  m = t.match(/maximum\s+(?:points\s+)?of\s+(\d+)/i);
  if (m) return { mult: 0, add: parseInt(m[1], 10) };
  return null;
}

/** Resolve a pool's BASE size (definer's formula only) at a class level. null if
 *  the formula isn't derivable. */
export function poolSize(poolId: string, classLevel: number): number | null {
  const pool = poolById.get(poolId);
  if (!pool) return null;
  const def = lookupEntity(`classes:${pool.definedBy}`) || lookupEntity(`domains:${pool.definedBy}`);
  const f = def ? poolSizeFormula(def) : null;
  return f ? f.mult * classLevel + f.add : null;
}

export interface PoolMaxBreakdown {
  base: number | null;                                   // definer formula
  sources: Array<{ name: string; amount: number }>;      // permanent (augments-max) contributors
  total: number | null;
}

/** A pool's MAXIMUM size for a character: base formula + every owned PERMANENT
 *  (`augments-max`) contributor, each evaluated at the class level. Temporary
 *  `refills` are NOT included — they add to the current pool during play, not the
 *  max. Returns a breakdown so the UI can show "9 (3×L) + Greater Healing Touch (+3)".
 *  `owned` = entities the character actually has (so unowned augments don't count). */
export function poolMax(poolId: string, classLevel: number, owned: any[]): PoolMaxBreakdown {
  const base = poolSize(poolId, classLevel);
  const sources: Array<{ name: string; amount: number }> = [];
  for (const e of owned) {
    if (poolRelation(e, poolId) !== 'augments-max') continue;
    const f = poolSizeFormula(e);           // e.g. "+1 per level" → {mult:1, add:0}
    const amount = f ? f.mult * classLevel + f.add : 0;
    sources.push({ name: e.name, amount });
  }
  const total = base == null ? null : base + sources.reduce((s, x) => s + x.amount, 0);
  return { base, sources, total };
}

// ── Character-level resolution (read-layer shape) ────────────────────────────
// `characterPools(character)` is the integration: given a character, produce the
// pools they actually HAVE and everything that touches each, as a pre-sorted,
// source-stamped record — the same shape the post-refactor bucketed read layer
// will emit, so this slots in without rework. The UI reads this directly:
// identity-rail tile from `max`, a "Pool" facet / breakdown from the grouped
// powers. A character HAS a pool iff they own its defining power.

export interface PoolPower { name: string; source: string; cls: string | null; relation: PoolRelation; }
export interface CharacterPool {
  id: string;
  name: string;
  classLevel: number;
  max: PoolMaxBreakdown;                 // base + permanent (augments-max) sources
  refills: PoolPower[];                   // temporary replenishers (not in max)
  spends: PoolPower[];                    // powers that draw from the pool
  augmentsMax: PoolPower[];               // the permanent contributors (mirror max.sources)
}

// Minimal shape we read off the resolved owned-set; matches classifyOwnedItems
// entries and is forward-compatible with the read-layer Entry.
interface OwnedLike { name: string; source?: string; cls?: string | null; }

/** Resolve the character's pools from their OWNED entities + class levels.
 *  `owned` is the flat list of owned items (today: concat of classifyOwnedItems
 *  buckets; post-refactor: the read layer's entries). `classLevelOf(name)` returns
 *  the level of a class the character has (for the pool's size formula). */
export function characterPools(
  owned: OwnedLike[],
  classLevelOf: (className: string) => number,
): CharacterPool[] {
  // index owned entities to full entity defs once
  const resolved = owned.map((o) => ({ owned: o, ent: lookupEntity(`classes:${o.name}`) || lookupEntity(`domains:${o.name}`) || lookupEntity(`skills:${o.name}`) || lookupEntity(`powers:${o.name}`) || { name: o.name } }));

  const out: CharacterPool[] = [];
  for (const pool of POOLS) {
    // HAS the pool? owns the defining power.
    const definer = resolved.find((r) => r.owned.name === pool.definedBy);
    if (!definer) continue;

    const classLevel = classLevelOf((definer.ent as any)?.parentClass || (definer.owned.cls || '')) || 1;
    const toPower = (r: typeof resolved[number], relation: PoolRelation): PoolPower =>
      ({ name: r.owned.name, source: r.owned.source ?? 'purchased', cls: r.owned.cls ?? null, relation });

    const augmentsMax: PoolPower[] = [];
    const refills: PoolPower[] = [];
    const spends: PoolPower[] = [];
    for (const r of resolved) {
      const rel = poolRelation(r.ent, pool.id);
      if (rel === 'augments-max') augmentsMax.push(toPower(r, rel));
      else if (rel === 'refills') refills.push(toPower(r, rel));
      else if (rel === 'spends') spends.push(toPower(r, rel));
    }
    const max = poolMax(pool.id, classLevel, resolved.map((r) => r.ent));
    out.push({ id: pool.id, name: pool.name, classLevel, max, refills, spends, augmentsMax });
  }
  return out;
}

/** Build guard: every defining power must yield a parseable size formula, and the
 *  audit's unresolved mentions must be empty. Feed RAW entities. Returns offenders. */
export function unresolvedPoolMentions(
  entities: any[],
): Array<{ pool: string; reason: 'no-formula' | 'missing-definer' }> {
  const out: Array<{ pool: string; reason: 'no-formula' | 'missing-definer' }> = [];
  for (const p of POOLS) {
    const def = entities.find((e) => e.name === p.definedBy);
    if (!def) { out.push({ pool: p.id, reason: 'missing-definer' }); continue; }
    if (!poolSizeFormula(def)) out.push({ pool: p.id, reason: 'no-formula' });
  }
  return out;
}
