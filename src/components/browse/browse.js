// The ONE browse engine behind every pick surface (the power/skill/perk/flaw
// PickerOverlay, the lineage challenge/advantage ChoiceList, …). Each of those used
// to hand-roll its own search + group + sort + bucket logic, so a grouping like the
// game-effect axes had to be added in each place and drifted apart. This centralizes
// the transformation; surfaces keep their own LAYOUT but share the brain.
//
// An AXIS is { id, label, key?(item) | multi+keys(item), placeholder?, order?(bucket) }.
//   - single-key axis: `key(item)` → one bucket string.
//   - multi-facet axis: `multi:true` + `keys(item)` → array of buckets; an item lands
//     in EACH (a Flame power that also Roots shows under Flame and Root). When it has
//     none, it falls into `placeholder` (sorted last).
// Surfaces compose `[...surfaceAxes, ...gameEffectAxes(getType)]` so the shared
// game-effect grouping lights up everywhere automatically.
import { gameEffectFacets } from "../../engine/game-effects.js";

// The shared player-facing axes. `getType(item)` yields the entity type used to look
// up the item's refs facets (e.g. "powers", "perks"); `nameOf(item)` its bare name.
export function gameEffectAxes(getType, nameOf = (it) => it.name) {
  const facets = (item, facet) => gameEffectFacets(getType(item), nameOf(item))[facet];
  const axis = (id, label, facet, placeholder) => ({
    id, label, multi: true, facet, placeholder,
    keys: (item) => facets(item, facet),
  });
  return [
    axis("effect", "Effect", "effect", "No targeted effect"),
    axis("damage", "Damage type", "damage", "Untyped"),
    axis("condition", "Condition", "condition", "No condition"),
  ];
}

// Buckets an item belongs to under an axis (always an array). Multi-facet axes that
// match nothing return [placeholder]; single-key axes return [key(item)].
function bucketsFor(axis, item) {
  if (!axis.multi) return [axis.key(item)];
  const keys = axis.keys(item) || [];
  return keys.length ? keys : [axis.placeholder];
}

// Whether ANY item has a facet on a multi axis — used to hide an axis (Damage,
// Condition) from a surface whose items never carry it (a perk/flaw picker).
export function axisApplies(axis, items) {
  if (!axis.multi) return true;
  return items.some((it) => (axis.keys(it) || []).length > 0);
}

// Only the OTHER buckets an item has on a multi axis (for the "also Flame, Root"
// row badge), excluding the one it's shown under.
export function otherBuckets(axis, item, currentBucket) {
  if (!axis.multi) return [];
  return (axis.keys(item) || []).filter((k) => k !== currentBucket);
}

// The browse transform — a PLAIN function (no hook), so each surface wraps it in its
// own useMemo with a literal dep list. Pure: the surface owns query/group/sort state
// and passes it in, so each can wire its own controls/persistence.
//
//   items    : the raw candidate list
//   axes     : composed axis list (surface axes + gameEffectAxes)
//   groupBy  : axis id
//   query, matches(item, q)         : search predicate (surface decides fields)
//   sort, compare(a, b, sortId, ax) : within-group ordering
//   filter(item)                    : optional extra predicate (taken/required/locked)
//   decorate(item)                  : optional per-item enrichment (e.g. {locked})
//
// Returns { axis, groups: [{ key, label, items }] }.
export function browse({
  items,
  axes,
  groupBy,
  query = "",
  matches = (it, q) => it.name.toLowerCase().includes(q),
  sort = "name",
  compare = (a, b) => a.name.localeCompare(b.name),
  filter,
  decorate,
}) {
  const axis = axes.find((a) => a.id === groupBy) || axes[0];
  const q = query.trim().toLowerCase();
  let list = items;
  if (q) list = list.filter((it) => matches(it, q));
  if (filter) list = list.filter(filter);
  if (decorate) list = list.map(decorate);

  const buckets = new Map();
  for (const it of list) {
    for (const k of bucketsFor(axis, it)) {
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(it);
    }
  }
  const entries = [...buckets.entries()].map(([key, group]) => ({ key, label: String(key), items: group }));

  for (const g of entries) g.items.sort((a, b) => compare(a, b, sort, axis));

  // Bucket order: a custom `axis.order(bucketKey)` wins; otherwise alphabetical for
  // multi-facet axes. The placeholder bucket always sinks last.
  const ph = axis.placeholder;
  entries.sort((a, b) => {
    if (a.key === ph) return 1;
    if (b.key === ph) return -1;
    if (axis.order) return axis.order(a.key) - axis.order(b.key) || a.label.localeCompare(b.label);
    return axis.multi ? a.label.localeCompare(b.label) : 0;
  });

  return { axis, groups: entries };
}
