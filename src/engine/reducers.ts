// Pure character-state reducers extracted from the React handler hooks
// (src/hooks/handlers/*). Each is a behavior-preserving `(char, ...args) => char`
// lift of a `setCharacter(c => …)` body, so the write path — previously only
// reachable through React — is directly unit-testable.
//
// These currently operate on the V1-flat shape (parallel `c[field]` /
// `ranks[field]` / `effectiveBP[field]` arrays, remove-by-index). The V2 flip
// (push CharacterChoice into character.skills/…, cost/rank on the object, remove
// by id) happens in a later migration step; until then these mirror the legacy
// behavior exactly.

import type { V1CharacterInput, CharacterChoice } from "./types.js";
import { UNLIMITED_SKILLS, DEVOTIONS, DOMAINS } from "./data.js";

type Char = V1CharacterInput;

// ─── V2 bucket helpers (skills slice) ───────────────────────────────────────
// Purchased skills are V2-native: they live as CharacterChoice[] in
// `character.skills` (source 'Purchased'), NOT in the flat `purchasedSkills`
// array. These helpers own that bucket. The UI addresses a purchased skill by
// its position among the PURCHASED entries (the row index the bucketed view
// emits), so removal/rank are positional within that filtered sub-list — no id
// (see the CharacterChoice shape: id was dropped as a non-load-bearing conceit).

// Field names that address the purchased-skills bucket. The picker adds via
// 'purchasedSkills'; a resolved row carries 'skills'. Both mean "the purchased
// skills bucket".
const PURCHASED_SKILL_FIELDS = new Set(["purchasedSkills", "skills"]);
const isPurchasedSkillField = (field: string) => PURCHASED_SKILL_FIELDS.has(field);

const purchasedSkills = (c: Char): CharacterChoice[] =>
  (c.skills || []).filter((s) => s.source === "Purchased");

// Replace the character's purchased-skill entries with `next`, preserving any
// non-purchased entries (granted/starting skills the boundary may add) in order.
function withPurchasedSkills(c: Char, next: CharacterChoice[]): Char {
  const others = (c.skills || []).filter((s) => s.source !== "Purchased");
  return { ...c, skills: [...others, ...next] };
}

/** Set or clear a per-power choice option. Clears when option is null or already set. */
export function setChoice(c: Char, powerId: string, option: string | null): Char {
  const choices = { ...(c.choices || {}) };
  if (option == null || choices[powerId] === option) delete choices[powerId];
  else choices[powerId] = option;
  return { ...c, choices };
}

/** Parse a display name into its base name and parameter, handling both
 *  `Base (param)` and `Base - param` forms. */
export function splitParameterizedName(name: string): { baseName: string; paramVal: string } {
  const paramMatch = name.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (paramMatch) {
    return { baseName: paramMatch[1].trim(), paramVal: paramMatch[2].trim() };
  }
  const dashIdx = name.indexOf(" - ");
  if (dashIdx > 0) {
    return { baseName: name.slice(0, dashIdx).trim(), paramVal: name.slice(dashIdx + 3).trim() };
  }
  return { baseName: name.trim(), paramVal: "" };
}

/** Rename a parameterized item in-place at `field[index]` (or by matching
 *  `oldName`), reconciling devotion/domain state when the item is "Worship". */
export function updateParameter(
  c: Char,
  field: string,
  oldName: string,
  newName: string,
  index: number | null = null,
): Char {
  // Purchased skills live in the V2 bucket; patch the entry's entityId in place,
  // then fall through to the shared Worship reconciliation (a Worship skill can be
  // a purchased entry).
  let nextChar: Char;
  if (isPurchasedSkillField(field)) {
    const cur = purchasedSkills(c);
    const idx = index !== null && index >= 0 ? index : cur.findIndex((s) => s.entityId === oldName);
    if (idx < 0 || idx >= cur.length) return c;
    nextChar = withPurchasedSkills(c, cur.map((s, i) => (i === idx ? { ...s, entityId: newName } : s)));
  } else {
    const list = (c[field] as string[] | undefined) || [];
    const idx = index !== null && index >= 0 ? index : list.indexOf(oldName);
    if (idx < 0) return c;
    const next = [...list];
    next[idx] = newName;
    nextChar = { ...c, [field]: next };
  }

  const { baseName, paramVal } = splitParameterizedName(newName);

  if (baseName === "Worship") {
    if (!paramVal) {
      // null (not undefined) to match handleClearDevotion and preserve the
      // present-but-empty devotion key the legacy handler wrote.
      nextChar.devotion = null as unknown as undefined;
      nextChar.divineDomains = [];
      nextChar.domainPowers = [];
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
        nextChar.domainPowers = (c.domainPowers || []).filter((p) => {
          const basePower = p.replace(/\s*\(.+\)$/, "");
          return remainingDomains.some((dn) => {
            const dom = DOMAINS.find((x) => x.name === dn);
            return dom?.powers.some((x) => x.name === basePower || x.name === p);
          });
        });
      }
    }
  }

  return nextChar;
}

/** Place a picked power in a slot at `field[at]`, recording the granting class in
 *  the parallel `powerClass[field]` array. Appends when flatIndex < 0. */
export function setSlotPick(c: Char, field: string, flatIndex: number, powerName: string, cls: string): Char {
  const next = [...((c[field] as string[] | undefined) || [])];
  const pc: Record<string, string[]> = { ...(c.powerClass || {}) };
  pc[field] = [...(pc[field] || [])];
  const at = flatIndex >= 0 ? flatIndex : next.length;
  next[at] = powerName;
  pc[field][at] = cls;
  return { ...c, [field]: next, powerClass: pc };
}

/** Clear a slot pick at `field[flatIndex]`, splicing the parallel powerClass and
 *  effectiveBP arrays to keep them index-aligned. */
export function clearSlot(c: Char, field: string, flatIndex: number): Char {
  const next = [...((c[field] as string[] | undefined) || [])];
  next.splice(flatIndex, 1);
  const pc: Record<string, string[]> = { ...(c.powerClass || {}) };
  if (pc[field]) {
    pc[field] = [...pc[field]];
    pc[field].splice(flatIndex, 1);
  }
  const nextEffectiveBP = { ...(c.effectiveBP || {}) };
  if (nextEffectiveBP[field]) {
    const bpList = [...nextEffectiveBP[field]];
    bpList.splice(flatIndex, 1);
    nextEffectiveBP[field] = bpList;
  }
  return { ...c, [field]: next, powerClass: pc, effectiveBP: nextEffectiveBP };
}

/** Add a named entity to `field`, appending a rank of 1. No-op if the name is
 *  already present and not in UNLIMITED_SKILLS. Purchased skills route to the V2
 *  `skills` bucket; other fields stay on the flat parallel-array path. */
export function addEntity(c: Char, field: string, name: string): Char {
  if (isPurchasedSkillField(field)) {
    const cur = purchasedSkills(c);
    if (cur.some((s) => s.entityId === name) && !UNLIMITED_SKILLS.has(name)) return c;
    return withPurchasedSkills(c, [...cur, { entityId: name, source: "Purchased", ranks: 1 }]);
  }
  const list = (c[field] as string[] | undefined) || [];
  if (list.includes(name) && !UNLIMITED_SKILLS.has(name)) return c;
  const next = [...list, name];
  const nextRanks = { ...(c.ranks || {}) };
  const rList = [...(nextRanks[field] || [])];
  while (rList.length < list.length) rList.push(1);
  rList.push(1);
  nextRanks[field] = rList;
  return { ...c, [field]: next, ranks: nextRanks };
}

/** Remove the entity at position `index`. For purchased skills the index is into
 *  the purchased-skills bucket; for flat fields it splices the parallel arrays. */
export function removeEntity(c: Char, field: string, index: number): Char {
  if (isPurchasedSkillField(field)) {
    const cur = purchasedSkills(c);
    if (index < 0 || index >= cur.length) return c;
    return withPurchasedSkills(c, cur.filter((_, i) => i !== index));
  }
  const next = [...((c[field] as string[] | undefined) || [])];
  next.splice(index, 1);
  const nextRanks = { ...(c.ranks || {}) };
  if (nextRanks[field]) {
    const rList = [...nextRanks[field]];
    rList.splice(index, 1);
    nextRanks[field] = rList;
  }
  const nextEffectiveBP = { ...(c.effectiveBP || {}) };
  if (nextEffectiveBP[field]) {
    const bpList = [...nextEffectiveBP[field]];
    bpList.splice(index, 1);
    nextEffectiveBP[field] = bpList;
  }
  return { ...c, [field]: next, ranks: nextRanks, effectiveBP: nextEffectiveBP };
}

/** Set the rank of the entity at position `index`. Purchased skills carry rank on
 *  the CharacterChoice; flat fields keep it in the parallel ranks array. */
export function setRank(c: Char, field: string, index: number, nextRank: number): Char {
  if (isPurchasedSkillField(field)) {
    const cur = purchasedSkills(c);
    if (index < 0 || index >= cur.length) return c;
    return withPurchasedSkills(c, cur.map((s, i) => (i === index ? { ...s, ranks: nextRank } : s)));
  }
  const nextRanks = { ...(c.ranks || {}) };
  const rList = [...(nextRanks[field] || [])];
  const listLen = (c[field] as string[] | undefined)?.length || 0;
  while (rList.length < listLen) rList.push(1);
  rList[index] = nextRank;
  nextRanks[field] = rList;
  return { ...c, ranks: nextRanks };
}

/** Record a granted-power selection under `grantedSelections[selectionId]`. */
export function setGrantedSelection(c: Char, selectionId: string, value: unknown): Char {
  return {
    ...c,
    grantedSelections: { ...(c.grantedSelections || {}), [selectionId]: value },
  };
}

/** Adjust an Agile Learner trade count for a class by `delta`, clamped at 0. */
export function setAgileLearnerTrade(c: Char, cls: string, delta: number): Char {
  const trades = c.agileLearnerTrades || {};
  const current = trades[cls] || 0;
  const next = Math.max(0, current + delta);
  return { ...c, agileLearnerTrades: { ...trades, [cls]: next } };
}
