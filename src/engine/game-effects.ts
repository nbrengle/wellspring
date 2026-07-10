// Player-facing "what does this do in play?" facets for an entity, read off the
// refs mention graph. The build sheet only understands BUILD-time mechanics (stat
// mods, grants); players care about the IN-GAME effects — the verb (Heal, Drain,
// Root), the damage/energy type (Flame, Lightning, Mind), and the condition it
// inflicts (Slept, Weakened). Those live in refs.mentions as effects:/defenses:/
// accents:/conditions: targets; we surface them as discrete, groupable facets.
//
// One source of truth for both the picker's "Group by" axes and the per-row
// "also: …" badges, so grouping and labelling never drift apart.
import { REFS } from "./data.js";

const stripType = (t) => t.slice(t.indexOf(":") + 1);

// The mention keys for an item, in resolution order. A lineage challenge keys under
// `challenges:`/`advantages:` but also overlaps `perks:`/`flaws:`; a power under
// `powers:`. Try the caller's type first, then the lineage variants, then powers —
// the first key that exists in the graph wins, so the same item resolves the same
// way regardless of which surface asked.
function mentionRefs(entityType, name) {
  const order = [];
  if (entityType) order.push(`${entityType}:${name}`);
  for (const t of ["powers", "perks", "flaws", "skills", "challenges", "advantages"]) {
    const k = `${t}:${name}`;
    if (!order.includes(k)) order.push(k);
  }
  for (const k of order) {
    if (REFS.mentions?.[k]) return REFS.mentions[k];
  }
  return [];
}

// All mention targets of a given type-prefix for an item.
function mentionsOfType(entityType, name, prefixes) {
  const refs = mentionRefs(entityType, name);
  const out = [];
  for (const t of refs) {
    for (const p of prefixes) {
      if (t.startsWith(`${p}:`)) {
        out.push(stripType(t));
        break;
      }
    }
  }
  return out;
}

// The three player-facing axes. `defenses` (Counter/Protect/Resist) are a flavor of
// effect, so they fold into the Effect verb. Order within each is mention order
// (roughly importance); we de-dup but keep first-seen order.
const dedup = (arr) => [...new Set(arr)];

export function effectVerbs(entityType, name) {
  return dedup(mentionsOfType(entityType, name, ["effects", "defenses"]));
}
export function damageTypes(entityType, name) {
  return dedup(mentionsOfType(entityType, name, ["accents"]));
}
export function conditionsInflicted(entityType, name) {
  return dedup(mentionsOfType(entityType, name, ["conditions"]));
}

// Bundle of all facets for a candidate, used by the picker. `keys(axis)` returns the
// buckets this item belongs to under that axis (possibly several → multi-bucket), or
// [] when the item has no facet on that axis (callers drop those from facet axes).
export function gameEffectFacets(entityType, name) {
  return {
    effect: effectVerbs(entityType, name),
    damage: damageTypes(entityType, name),
    condition: conditionsInflicted(entityType, name),
  };
}
