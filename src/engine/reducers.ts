// Pure character-state reducers extracted from the React handler hooks
// (src/hooks/handlers/*). Each is a behavior-preserving `(char, ...args) => char`
// lift of a `setCharacter(c => …)` body, so the write path — previously only
// reachable through React — is directly unit-testable.
//
// These operate on CharacterState: every add/remove/rename patches an ontological
// CharacterChoice[] bucket (skills/perks/powers/spells/flaws), addressed positionally
// among the relevant sub-list. There is no flat shape — a pick's provenance is its
// source and its BP key is its costField, both on the CharacterChoice.

import type { CharacterState, CharacterChoice } from "./types.js";
import { Source, isPurchased } from "./types.js";
import { addToCharacter } from "./character-add.js";
import { UNLIMITED_SKILLS, DEVOTIONS, DOMAINS } from "./data.js";

type Char = CharacterState;

// ─── purchased-bucket helpers ────────────────────────────────────────────
// Purchased skills and perks are: CharacterChoice[] entries (source
// 'Purchased') in `character.skills` / `character.perks`, NOT flat name arrays.
// The UI addresses a purchased entry by its position among the PURCHASED entries
// of its bucket (the row index the bucketed view emits), so removal/rank are
// positional within that filtered sub-list — no id (CharacterChoice has none;
// removal is positional). One abstraction drives both buckets.

// A field name maps to the bucket key it addresses. The picker adds via the flat
// field name ('purchasedSkills'/'purchasedPerks'); a resolved row carries the
// bucket name ('skills'/'perks'). Both point at the same bucket.
const PURCHASED_BUCKET_OF: Record<string, "skills" | "perks"> = {
  purchasedSkills: "skills",
  skills: "skills",
  purchasedPerks: "perks",
  perks: "perks",
};
const purchasedBucketKey = (field: string) => PURCHASED_BUCKET_OF[field];

const purchasedEntries = (c: Char, bucket: "skills" | "perks"): CharacterChoice[] =>
  (c[bucket] || []).filter((s) => isPurchased(s.source));

// Replace the character's purchased entries in `bucket` with `next`, preserving
// any non-purchased entries (granted/starting) in order.
function withPurchased(c: Char, bucket: "skills" | "perks", next: CharacterChoice[]): Char {
  const others = (c[bucket] || []).filter((s) => !isPurchased(s.source));
  return { ...c, [bucket]: [...others, ...next] };
}

/** Set or clear a per-power choice option. Clears when option is null or already set. */
export function setChoice(c: Char, powerId: string, option: string | null): Char {
  const choices = { ...(c.choices || {}) };
  if (option == null || choices[powerId] === option) delete choices[powerId];
  else choices[powerId] = option;
  return { ...c, choices };
}

/** Set the `parameter` field of the item at `field`'s row `index` to `value` (clear
 *  when empty), reconciling devotion/domain state when that row is "Worship".
 *  Parametrization is a FIELD — changing it is a one-field patch at a known row, not
 *  a find-by-old-name / rebuild-the-id-string dance. The UI passes the raw chosen
 *  value; nothing concatenates or re-parses a "Base (Param)" string. */
export function setParameter(c: Char, field: string, index: number, value: string): Char {
  const paramVal = (value || "").trim();
  const patch = (s: CharacterChoice): CharacterChoice => {
    const next = { ...s };
    if (paramVal) next.parameter = paramVal;
    else delete next.parameter;
    return next;
  };

  let nextChar: Char;
  let baseEntity: string | undefined;
  const bucket = purchasedBucketKey(field);
  if (bucket) {
    const cur = purchasedEntries(c, bucket);
    if (index < 0 || index >= cur.length) return c;
    baseEntity = cur[index].entityId;
    nextChar = withPurchased(
      c,
      bucket,
      cur.map((s, i) => (i === index ? patch(s) : s)),
    );
  } else {
    const cur = fieldEntries(c, field);
    if (index < 0 || index >= cur.length) return c;
    baseEntity = cur[index].entityId;
    nextChar = withField(
      c,
      field,
      cur.map((s, i) => (i === index ? patch(s) : s)),
    );
  }

  // Domain powers live in their own `domainPowers` bucket. Keep the entries whose
  // domain is still available; drop the rest.
  const keepDomainPowers = (keep: (basePower: string, full: string) => boolean): CharacterChoice[] =>
    (nextChar.domainPowers || []).filter((p) => {
      // entityId is stored bare; the param (if any) lives in the field. `full`
      // reconstructs the display form for callers that match either.
      const basePower = p.entityId;
      const full = p.parameter ? `${p.entityId} (${p.parameter})` : p.entityId;
      return keep(basePower, full);
    });

  if (baseEntity === "Worship") {
    if (!paramVal) {
      // null (not undefined) to match handleClearDevotion — a present-but-empty
      // devotion key, distinct from "never set". `devotion` is typed `string | null`,
      // so null assigns directly (no cast).
      nextChar.devotion = null;
      nextChar.divineDomains = [];
      nextChar.domainPowers = keepDomainPowers(() => false);
    } else {
      const dev = DEVOTIONS.find(
        (d) =>
          d.name.toLowerCase() === paramVal.toLowerCase() ||
          d.name.toLowerCase().startsWith(paramVal.toLowerCase()) ||
          paramVal.toLowerCase().startsWith(d.name.toLowerCase()),
      );
      const canonicalDevName = dev ? dev.name : paramVal;
      nextChar.devotion = canonicalDevName;
      if (dev) {
        const remainingDomains = (c.divineDomains || []).filter((dn) => dev.domains.includes(dn));
        nextChar.divineDomains = remainingDomains;
        nextChar.domainPowers = keepDomainPowers((basePower, full) =>
          remainingDomains.some((dn) => {
            const dom = DOMAINS.find((x) => x.name === dn);
            return dom?.powers.some((x) => x.name === basePower || x.name === full);
          }),
        );
      }
    }
  }

  return nextChar;
}

// ─── slot-pick helpers (powers + spells) ─────────────────────────────────
// Slot picks (martial powers basic/advanced/veteran/utility AND caster spells
// cantrips/spells-known/book) are: CharacterChoice[] entries in the
// `powers` / `spells` bucket, sourced `Source.class(<bestowingClass>)` (a slot pick
// is FREE and belongs to the class whose slot it fills — the granting class lives
// IN the source, replacing the old parallel `powerClass[field]` map). Each entry
// keeps `costField` = the flat field it came from (e.g. 'basicPowers' /
// 'noviceSpells') so the BP ledger keys it under that prefix. Addressing is
// positional among the entries sharing that costField (the row index the view emits).

// The bucket a slot field lives in — spell fields route to `spells`, all others to
// `powers`. (Devotion/domain aside, every slot field is one or the other.)
const SPELL_FIELDS = new Set(["cantrips", "spellsKnown", "noviceSpells", "adeptSpells", "greaterSpells", "bookSpells"]);
// Domain powers live in their OWN bucket, not the shared `powers` array.
const bucketOfField = (field: string): "spells" | "powers" | "domainPowers" =>
  field === "domainPowers" ? "domainPowers" : SPELL_FIELDS.has(field) ? "spells" : "powers";

// Power fields added via the plain "Add a …" picker (handleAddEntity) rather than
// a class slot: these COST BP and route to the powers bucket with a purchased
// source, addressed positionally among their costField like purchased skills.
const PURCHASED_POWER_FIELDS = new Set(["classPowers", "domainPowers"]);

const fieldEntries = (c: Char, field: string): CharacterChoice[] =>
  (c[bucketOfField(field)] || []).filter((p) => p.costField === field);

// Replace the bucket entries with costField `field` by `next`, preserving every
// other entry (other fields, innate, granted) in order.
function withField(c: Char, field: string, next: CharacterChoice[]): Char {
  const bucket = bucketOfField(field);
  const others = (c[bucket] || []).filter((p) => p.costField !== field);
  return { ...c, [bucket]: [...others, ...next] };
}

/** Place a picked power/spell in a slot, sourced to the granting class. `flatIndex`
 *  is the position among the field's slot entries; < 0 (or past the end) appends. */
export function setSlotPick(c: Char, field: string, flatIndex: number, name: string, cls: string): Char {
  const cur = fieldEntries(c, field);
  const entry: CharacterChoice = { entityId: name, source: Source.class(cls), ranks: 1, costField: field };
  const next = [...cur];
  if (flatIndex >= 0 && flatIndex < next.length) next[flatIndex] = entry;
  else next.push(entry);
  return withField(c, field, next);
}

/** Clear the slot pick at `flatIndex` among the field's slot entries. */
export function clearSlot(c: Char, field: string, flatIndex: number): Char {
  const cur = fieldEntries(c, field);
  if (flatIndex < 0 || flatIndex >= cur.length) return c;
  return withField(
    c,
    field,
    cur.filter((_, i) => i !== flatIndex),
  );
}

/** Add a named entity to `field`, appending a rank of 1. No-op if the name is
 *  already present and not in UNLIMITED_SKILLS. Purchased skills route to the
 *  `skills` bucket; other fields stay on the flat parallel-array path. */
export function addEntity(c: Char, field: string, name: string): Char {
  const bucket = purchasedBucketKey(field);
  if (bucket) {
    const cur = purchasedEntries(c, bucket);
    if (cur.some((s) => s.entityId === name) && !UNLIMITED_SKILLS.has(name)) return c;
    return withPurchased(c, bucket, [...cur, { entityId: name, source: Source.purchased(), ranks: 1 }]);
  }
  if (PURCHASED_POWER_FIELDS.has(field)) {
    const cur = fieldEntries(c, field);
    if (cur.some((p) => p.entityId === name)) return c;
    return withField(c, field, [...cur, { entityId: name, source: Source.purchased(), ranks: 1, costField: field }]);
  }
  if (field === "flaws") {
    if ((c.flaws || []).some((f) => f.entityId === name)) return c;
    return addToCharacter(c as CharacterState, name) as Char;
  }
  return c;
}

/** Remove the entity at position `index`. For purchased skills the index is into
 *  the purchased-skills bucket; for flat fields it splices the parallel arrays. */
export function removeEntity(c: Char, field: string, index: number): Char {
  const bucket = purchasedBucketKey(field);
  if (bucket) {
    const cur = purchasedEntries(c, bucket);
    if (index < 0 || index >= cur.length) return c;
    return withPurchased(
      c,
      bucket,
      cur.filter((_, i) => i !== index),
    );
  }
  if (PURCHASED_POWER_FIELDS.has(field)) {
    const cur = fieldEntries(c, field);
    if (index < 0 || index >= cur.length) return c;
    return withField(
      c,
      field,
      cur.filter((_, i) => i !== index),
    );
  }
  if (field === "flaws") {
    const cur = c.flaws || [];
    if (index < 0 || index >= cur.length) return c;
    return { ...c, flaws: cur.filter((_, i) => i !== index) };
  }
  return c;
}

/** Set the rank of the purchased entity at position `index` (rank lives on the
 *  CharacterChoice). */
export function setRank(c: Char, field: string, index: number, nextRank: number): Char {
  const bucket = purchasedBucketKey(field);
  if (bucket) {
    const cur = purchasedEntries(c, bucket);
    if (index < 0 || index >= cur.length) return c;
    return withPurchased(
      c,
      bucket,
      cur.map((s, i) => (i === index ? { ...s, ranks: nextRank } : s)),
    );
  }
  return c;
}

/** Record a bestowed-power selection under `bestowedSelections[selectionId]`. */
export function setBestowedSelection(c: Char, selectionId: string, value: string): Char {
  return {
    ...c,
    bestowedSelections: { ...(c.bestowedSelections || {}), [selectionId]: value },
  };
}

/** Adjust an Agile Learner trade count for a class by `delta`, clamped at 0. */
export function setAgileLearnerTrade(c: Char, cls: string, delta: number): Char {
  const trades = c.agileLearnerTrades || {};
  const current = trades[cls] || 0;
  const next = Math.max(0, current + delta);
  return { ...c, agileLearnerTrades: { ...trades, [cls]: next } };
}
