// The shared FACET registry — "what dimensions can you slice the entities by?".
// A facet narrows a list (filter), distinct from a browse AXIS which reorders it
// (group). Both the Rules Explorer's faceted sidebar and the picker's Filters popover
// read facets from here, so a new dimension is defined ONCE and works in both.
//
// A facet is { id, label, values(entity) -> string[] }. Multi-valued facets (an
// entity with two damage types) return several; single-valued return one or none.
// `gameEffectFacets` supplies the in-play effect/damage/condition facets (the same
// source the browse game-effect axes use), so grouping and filtering never diverge.
import { gameEffectFacets } from "../../engine/game-effects.js";
import { POOLS, poolsReferenced } from "../../engine/pool-registry.js";

const POOL_NAME = Object.fromEntries(POOLS.map((p) => [p.id, p.name]));

const SPELL_TIERS = new Set(["Novice", "Adept", "Greater", "Cantrip"]);

// Power vs Spell: spells are the Novice/Adept/Greater/Cantrip tiers; everything else
// in `powers` is a non-spell power. Only meaningful for the powers type.
export function kindOf(e) {
  if (e.type !== "powers") return null;
  return SPELL_TIERS.has(e.tier) ? "Spell" : "Power";
}
export function classOf(e) {
  return e.requiredClass || e.parentClass || null;
}

// Most lineage items are "General"; that's not a useful sublineage facet value.
const realSublineage = (s) => {
  if (!s || s === "General") return null;
  return s.replace(/\s*\(.*\)$/, "").trim() || null; // drop "(Civilization: …)" noise
};

const one = (v) => (v == null || v === "" ? [] : [v]);

// The full registry. Order here is the order facets appear in the sidebar.
// `type` uses the entity's display label when available (set by the Explorer), else
// the raw type. It's a no-op in single-type surfaces (the picker), where it has one
// value and so is auto-hidden by the 2+ rule.
export const FACETS = [
  { id: "type", label: "Type", values: (e) => one(e.typeLabel || e.type) },
  { id: "kind", label: "Kind", values: (e) => one(kindOf(e)) },
  { id: "cls", label: "Class", values: (e) => one(classOf(e)) },
  { id: "lineage", label: "Lineage", values: (e) => one(e.lineage) },
  { id: "sublineage", label: "Sublineage", values: (e) => one(realSublineage(e.sublineage)) },
  { id: "repped", label: "Repped", values: (e) => (e.repped ? ["Repped"] : []) },
  { id: "required", label: "Required", values: (e) => (e.required ? ["Required"] : []) },
  { id: "tier", label: "Tier", values: (e) => one(e.tier) },
  { id: "refresh", label: "Refresh", values: (e) => (e.refresh && e.refresh !== "None" ? [e.refresh] : []) },
  { id: "tags", label: "Tags", values: (e) => e.tags || [] },
  { id: "damage", label: "Damage", values: (e) => gameEffectFacets(e.type, facetName(e)).damage },
  { id: "effect", label: "Effect", values: (e) => gameEffectFacets(e.type, facetName(e)).effect },
  { id: "condition", label: "Condition", values: (e) => gameEffectFacets(e.type, facetName(e)).condition },
  // Class Pool: which pool(s) this entity defines / augments / spends from / refills.
  // Lets you browse every power that touches e.g. the Healing Touch Pool. Derived
  // from the entity's prose (pool-registry), tolerant of source spelling variants.
  { id: "pool", label: "Pool", values: (e) => poolsReferenced(e).map((id) => POOL_NAME[id] || id) },
];
export const FACET_BY_ID = Object.fromEntries(FACETS.map((f) => [f.id, f]));

// Lineage items resolve their game-effect facets under "<Lineage> - <name>"
// (e.g. "challenges:Aewen - Mana Lines"); everything else under its bare name.
function facetName(e) {
  if ((e.type === "advantages" || e.type === "challenges") && e.lineage) {
    return `${e.lineage} - ${e.baseName || e.name}`;
  }
  return e.name;
}

// Distinct values for a facet across a pool, sorted by frequency then label.
export function facetValues(pool, facet) {
  const m = new Map();
  for (const e of pool) for (const v of facet.values(e)) m.set(v, (m.get(v) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

// Facets worth offering for a pool: those with 2+ distinct values (a facet with one
// value can't narrow anything). Returns [{ ...facet, options: [[value, count], …] }].
export function availableFacets(pool, ids = FACETS.map((f) => f.id)) {
  return ids
    .map((id) => FACET_BY_ID[id])
    .filter(Boolean)
    .map((f) => ({ ...f, options: facetValues(pool, f) }))
    .filter((f) => f.options.length >= 2);
}

// AND across facets, OR within (a facet's Set of selected values). `sel` is
// { facetId: Set<value> }. An empty/absent set means "no constraint".
export function passesFacets(e, sel) {
  return Object.entries(sel).every(([id, set]) => {
    if (!set || !set.size) return true;
    const f = FACET_BY_ID[id];
    return f && f.values(e).some((v) => set.has(v));
  });
}

// Count an entity against every active facet EXCEPT one — so a facet's per-value
// counts reflect the other filters without the facet cancelling itself.
export function passesFacetsExcept(e, sel, exceptId) {
  return Object.entries(sel).every(([id, set]) => {
    if (id === exceptId || !set || !set.size) return true;
    const f = FACET_BY_ID[id];
    return f && f.values(e).some((v) => set.has(v));
  });
}

export const activeFacetCount = (sel) => Object.values(sel).reduce((n, s) => n + (s?.size || 0), 0);

// Toggle one value of a facet in a selection map (immutably).
export function toggleFacetValue(sel, id, v) {
  const set = new Set(sel[id] || []);
  set.has(v) ? set.delete(v) : set.add(v);
  const next = { ...sel, [id]: set };
  if (!set.size) delete next[id];
  return next;
}
