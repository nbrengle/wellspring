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

export type PoolRelation = 'defines' | 'augments' | 'spends' | 'mentions';

/** How does this entity relate to a given pool? Derived from verb cues in prose.
 *  Precedence matters: `defines` only for the canonical definer (the loose "gains
 *  a pool" heuristic cross-matched other pools), and `spends` is checked BEFORE
 *  `augments` because spend powers ("expend N points to grant …") often also
 *  contain grant/add words. ⚠ TODO(derive): verb-cue classification is fuzzy; a
 *  cleaner signal (structured effect on the pool) should replace it. */
export function poolRelation(entity: any, poolId: string): PoolRelation | null {
  const pool = poolById.get(poolId);
  const text = textOf(entity);
  if (!pool || !pool.aliases.test(text)) return null;
  if (entity.name === pool.definedBy) return 'defines';
  // spend cues first — spend powers frequently also say "grant"/"add".
  if (/\b(expend|subtract|spend(s|ing)?|lose|draw|use|point[s]? from)\b[^.]*pool|from (the|their|its)[^.]*pool/i.test(text)) {
    return 'spends';
  }
  // augment cues: explicitly raises the pool's size/points.
  if (/\b(add(s|ing)?|additional point|increase)\b[^.]*pool|adds?\s+\d+\s+points?\s+to[^.]*pool/i.test(text)) {
    return 'augments';
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
  // flat "maximum points of <N>" / "maximum of <N>"  → constant
  m = t.match(/maximum\s+(?:points\s+)?of\s+(\d+)/i);
  if (m) return { mult: 0, add: parseInt(m[1], 10) };
  return null;
}

/** Resolve a pool's numeric size for a given class level (null if formula unknown). */
export function poolSize(poolId: string, classLevel: number): number | null {
  const pool = poolById.get(poolId);
  if (!pool) return null;
  const def = lookupEntity(`classes:${pool.definedBy}`) || lookupEntity(`domains:${pool.definedBy}`);
  const f = def ? poolSizeFormula(def) : null;
  return f ? f.mult * classLevel + f.add : null;
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
