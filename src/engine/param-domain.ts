// param-domain.ts — derives, for a parameterized entity, the one fact the dedupe
// model needs: can the same parameter value repeat across ranks (param is payload),
// or must each rank pick a distinct one (param is identity)?
//
//   reusable = (paramKind === 'pool') ? (cap > |pool|) : false
//
// Two parameter KINDS, DERIVED from the entity's description prose:
//   - 'pool'     — pick from a small fixed set you can double up in (Sphere, Craft,
//                  Weapon type, Element). Needs a size. reusable = cap > size.
//   - 'distinct' — pick a *thing you don't already have* (a Lore area, a cantrip
//                  from your list, a power, a profession). Can't repeat by nature →
//                  always per-param. Size irrelevant (so dynamic/character-dependent
//                  domains are fine — we never count them).
//
// ── DESIGN: derive first, fall back narrowly, guard the gap ──────────────────
// Parameter kind/size is DERIVED from prose wherever the prose is regular (inline
// lists, "from a/your … list" phrasing). A small DECLARED fallback handles the
// irregular residual (named sets like Sphere/Element, external "lists below").
// `unresolvedParamDomains()` flags anything that hits NEITHER, so a new ability
// that the derivation misses fails LOUDLY instead of silently defaulting.
//
// ⚠️ TECH DEBT — every declared/hardcoded entry below is a liability that grows
// with the rulebook. New abilities WILL add more irregular params. The goal is to
// shrink KNOWN_POOLS / DECLARED toward zero by making the parser/source emit the
// pool inline. Each hardcoded entry is marked `TODO(derive)`.

import { getMaxRanks } from "./validate/core.js";
import accentsJson from "../data/accents.json";
import { Entity } from "./types.js";

export type ParamKind = "pool" | "distinct";
export interface ParamInfo {
  type: string; // the parameter's name/type ("Craft", "Sphere", …)
  kind: ParamKind;
  size: number; // pool size; Infinity for distinct/open-ended
  source: "inline" | "known-pool" | "dynamic" | "open" | "declared";
}

// ── Declared fallbacks (TECH DEBT — shrink toward zero) ──────────────────────

// Named pools whose values live OUTSIDE the entity description (referenced by a
// type name, not listed inline). TODO(derive): Element already derives from
// accents.json; Sphere should come from a spheres list in source rather than here.
const KNOWN_POOLS: Record<string, number> = {
  // TODO(derive): no spheres list in data yet — Arcane + Divine is a fixed pair.
  Sphere: 2,
  // Derived from accents.json (elemental:true) — this is the lookup key only.
  Element: (accentsJson as Array<{ elemental?: boolean }>).filter((a) => a.elemental).length,
};

// Entities whose param is named only in prose with NO inline list and NO regular
// "from a list" phrasing — the derivation can't classify them from text alone.
// TODO(derive): make the source list these inline (or tag them) so these vanish.
const DECLARED: Record<string, { type: string; kind: ParamKind; size: number }> = {
  // "choose from the substitution list below" — an external table, distinct picks.
  "Accent Substantiation": { type: "Accent Substitution", kind: "distinct", size: Infinity },
  // "choose any element they desire … one at a time" — a pool, phrased loosely.
  "Elemental Affinity": { type: "Element", kind: "pool", size: 0 /* set below */ },
};
DECLARED["Elemental Affinity"].size = KNOWN_POOLS.Element;

// ── Derivation from prose ────────────────────────────────────────────────────

// "… Craft: Alchemy, Enchanting, or Tinkering." → inline pool, size = list length.
const INLINE_LIST =
  /:\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)?(?:\s*,\s*[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)*(?:\s*,?\s+or\s+[A-Z][a-z]+(?:\s[A-Z][a-z]+)?))/;
// "… from their/your/a … list / class / spell-list …" → distinct pick from a set
// you assemble; never the same thing twice → per-param, size irrelevant.
const FROM_A_LIST = /from (?:their|your|a|an)\b[^.]*\b(?:list|class|spell-list|deck)\b/i;
// A [Placeholder]-style open param (Lore area, profession) → distinct, open-ended.
const OPEN_PARAM_TYPES = new Set(["Area of Lore", "Specific Profession"]);

/** Derive full parameter info for an entity, or null if it takes no resolvable
 *  parameter. Order: declared override → inline list → known pool → from-a-list
 *  → open type. */
export function paramInfo(entity: Entity | null | undefined): ParamInfo | null {
  if (!entity) return null;
  const name = entity.baseName || entity.name;
  const desc = String(entity.description ?? "");

  const declared = DECLARED[name];
  if (declared) return { ...declared, source: "declared" };

  const inline = desc.match(INLINE_LIST);
  if (inline) {
    const size = inline[1]
      .split(/,|\bor\b/)
      .map((s) => s.trim())
      .filter(Boolean).length;
    return { type: entity.parameter || name, kind: "pool", size, source: "inline" };
  }

  if (entity.parameter && entity.parameter in KNOWN_POOLS) {
    return { type: entity.parameter, kind: "pool", size: KNOWN_POOLS[entity.parameter], source: "known-pool" };
  }

  if (FROM_A_LIST.test(desc)) {
    return { type: entity.parameter || name, kind: "distinct", size: Infinity, source: "dynamic" };
  }

  if (entity.parameter && OPEN_PARAM_TYPES.has(entity.parameter)) {
    return { type: entity.parameter, kind: "distinct", size: Infinity, source: "open" };
  }

  return null; // no parameter the derivation can resolve
}

/** Can the same parameter value repeat across this entity's ranks?
 *  pool → cap > poolSize; distinct → never. */
export function paramReusable(entity: Entity | null | undefined, entityId: string): boolean {
  const info = paramInfo(entity);
  if (!info || info.kind !== "pool") return false;
  return getMaxRanks(entityId) > info.size;
}

/** The parameter participates in IDENTITY (distinct per value)? Inverse of
 *  reusable, for entities that take a resolvable parameter. */
export function paramIsIdentity(entity: Entity | null | undefined, entityId: string): boolean {
  const info = paramInfo(entity);
  return info != null && !paramReusable(entity, entityId);
}

const capOf = (e: Entity | null | undefined): number => {
  const r = e?.ranks;
  if (r === "unlimited") return Infinity;
  if (typeof r === "number") return r;
  return 1;
};

// Prose implying the entity asks the player to choose a parameter — used to catch
// multi-rank entities whose param the derivation FAILED to resolve, so they
// surface instead of silently defaulting.
const CHOOSE_PARAM_PROSE = /\bchoose (one|a|an|from)\b|\bone of the following\b/i;

/** Build guard: every multi-rank entity that looks parameterized must resolve to
 *  a ParamInfo — otherwise the dedupe rule would silently mis-classify it. Returns
 *  offenders (empty = clean). We proved by repeated undercounting (5→7→13→57) that
 *  the candidate set can't be hand-enumerated; the guard makes completeness the
 *  build's job. Feed RAW entities (with `parameter`/`ranks`/`description`). */
export function unresolvedParamDomains(
  entities: Entity[],
): Array<{ name: string; cap: number; reason: "has-param-field" | "prose-param" }> {
  const out: Array<{ name: string; cap: number; reason: "has-param-field" | "prose-param" }> = [];
  for (const e of entities) {
    const cap = capOf(e);
    if (cap <= 1) continue; // cap 1 → param can't repeat; moot
    if (paramInfo(e)) continue; // resolved — fine
    if (e.parameter) out.push({ name: e.name, cap, reason: "has-param-field" });
    else if (CHOOSE_PARAM_PROSE.test(String(e.description ?? "")))
      out.push({ name: e.name, cap, reason: "prose-param" });
  }
  return out;
}
