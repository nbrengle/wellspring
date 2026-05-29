// entity-lookup.js — name-to-entity resolution with drift-tolerant fallback.
//
// Given a registry of entities (each `{ id, name, type }`) and an input name,
// return the matching entity. Tries multiple resolution strategies, in order:
//
//   1. Literal match against the entity's stored name.
//   2. Case-insensitive literal match.
//   3. Canonical-key match — case, punctuation, apostrophe placement, slash
//      spacing, and trailing plurals all normalized. Handles the dominant
//      class of authoring drift between the MegaDoc and the Starter Sheets
//      (e.g. "Heretic's Brand" → "Heretics' Brand", "Forged from Steel" →
//      "Forged From Steel"). See `canonicalKey` in aliases.js.
//   4. Tier-suffix fallback — when the input has no tier numeral but the
//      registry only has tiered variants (`Shake It Off I/II`), try the
//      input + " I" first, then "+ II", etc. This is a deliberate "find the
//      base tier" rule, not a generic relaxation.
//
// The caller can scope the registry by passing a filtered list (only skills,
// only powers, etc.) so cross-type collisions don't matter at lookup time.
//
// Each non-literal resolution is logged to a drift report (returned alongside
// the lookup result) so the build can surface authoring inconsistencies that
// the canonicalizer is silently masking.

import { canonicalKey } from "./aliases.js";

const TIER_ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

// Build a lookup index over a registry. Returns an object with `find(name)`,
// where the result is `{ entity, drift }`. `drift` is null on literal match
// and a description string when a fallback strategy was needed.
export function buildLookup(entities) {
  // Three parallel indices. literal: name → entity. ci: lowercased name →
  // entity. canonical: canonicalKey(name) → entity[]. Multi-value because
  // cross-type collisions exist (effects:Heal and powers:Heal share `heal`).
  // Callers scope the registry to avoid that ambiguity at lookup time.
  const literal = new Map();
  const ci = new Map();
  const canonical = new Map();
  for (const e of entities) {
    if (!e || !e.name) continue;
    literal.set(e.name, e);
    ci.set(e.name.toLowerCase(), e);
    const k = canonicalKey(e.name);
    if (!canonical.has(k)) canonical.set(k, []);
    canonical.get(k).push(e);
  }
  return {
    find(input) {
      if (!input) return { entity: null, drift: null };
      // 1. Literal.
      if (literal.has(input)) return { entity: literal.get(input), drift: null };
      // 2. Case-insensitive.
      const ciHit = ci.get(input.toLowerCase());
      if (ciHit) return { entity: ciHit, drift: `case: "${input}" → "${ciHit.name}"` };
      // 3. Canonical key.
      const ckHit = canonical.get(canonicalKey(input));
      if (ckHit && ckHit.length === 1) {
        return { entity: ckHit[0], drift: `canonical: "${input}" → "${ckHit[0].name}"` };
      }
      // 4. Tier-suffix fallback (only if input has no trailing roman numeral
      // and the registry has tiered variants of it).
      const hasTier = /\s+(I+|IV|VI*|IX|XI*|XV*)$/.test(input);
      if (!hasTier) {
        for (const roman of TIER_ROMAN) {
          const tiered = `${input} ${roman}`;
          const tieredCi = ci.get(tiered.toLowerCase());
          if (tieredCi) {
            return { entity: tieredCi, drift: `tier: "${input}" → "${tieredCi.name}"` };
          }
          const tieredCk = canonical.get(canonicalKey(tiered));
          if (tieredCk && tieredCk.length === 1) {
            return { entity: tieredCk[0], drift: `tier+canonical: "${input}" → "${tieredCk[0].name}"` };
          }
        }
      }
      return { entity: null, drift: null };
    },
  };
}

// Strip the decorations archetype/character data carries around an entity
// reference: BP cost suffixes, parenthesized parameters, "xN" rank
// multipliers, trailing roman-numeral instance counters. Idempotent — runs
// the rules to fixpoint so they compose in any input order.
export function stripDecorations(item) {
  let out = item, prev;
  do {
    prev = out;
    out = out
      .replace(/\s*-\s*-?\d+\s*BP\s*$/i, "")           // " - 2 BP" or " - -3 BP"
      .replace(/\s*\([^()]+\)\s*$/, "")                // " (Religious)" / " (your choice)"
      .replace(/\s+x\d+\s*$/i, "")                     // " x2" rank multiplier
      .replace(/\s+(I+|IV|VI*|IX|XI*|XV*)\s*$/, "")    // trailing roman instance counter
      .trim();
  } while (out !== prev);
  return out;
}

// Additional resolution strategies that aren't general enough to live inside
// the lookup itself but are useful for both validators and the linker. Each
// returns { entity, drift } on a hit, null otherwise.

// "Apprentice Foo" ↔ "Foo - Apprentice" word-order swap.
export function trySwapTier(name, lookup) {
  const m = name.match(/^(Apprentice|Journeyman|Greater|Master)\s+(.+)$/);
  if (!m) return null;
  const swapped = `${m[2]} - ${m[1]}`;
  const { entity } = lookup.find(swapped);
  if (!entity) return null;
  return { entity, drift: `swap: "${name}" → "${entity.name}"` };
}

// "Worship - The Mother" → "Worship": the trailing " - X" is a parameter
// value (mirror of the paren-style parameter).
export function tryStripDashSuffix(name, lookup) {
  const idx = name.indexOf(" - ");
  if (idx <= 0) return null;
  const base = name.slice(0, idx).trim();
  const { entity } = lookup.find(base);
  if (!entity) return null;
  return { entity, drift: `dash-suffix: "${name}" → "${entity.name}"` };
}

// Composite: try literal/case/canonical/tier (via lookup), then swap and dash
// fallbacks. Returns { entity, drift } or { entity: null, drift: null }.
export function resolve(input, lookup) {
  const cleaned = stripDecorations(input);
  if (!cleaned) return { entity: null, drift: null };
  let hit = lookup.find(cleaned);
  if (hit.entity) return hit;
  hit = trySwapTier(cleaned, lookup);
  if (hit) return hit;
  hit = tryStripDashSuffix(cleaned, lookup);
  if (hit) return hit;
  return { entity: null, drift: null };
}
