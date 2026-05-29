// Validator: turns a character object into a build report. Wellspring has two
// independent "currencies":
//   1. BP (Build Points) — a single pool that buys skills + perks, refunded by
//      flaws. Budget comes from the level table.
//   2. Power slots — per-class, per-tier counts granted at the character's level
//      (e.g. a level-4 Fighter gets 2 utility + 2 basic). Casters instead have
//      cantrip and spells-known counts. These don't draw from BP.
//
// Pure functions, no React, so the UI calls them in a useMemo and they stay
// unit-testable. The character shape is the flat object from Builder.jsx.

import { LEVEL_TABLE, lookupEntity, REFS, CLASS_POWER_SLOTS, CLASS_POWERS, CLASS_PROGRESSION, SPELLCASTERS } from './index.js';

// Character fields whose items cost BP. Starting skills are class-granted and
// free; only purchased skills/perks spend BP.
const BP_FIELDS = ['purchasedSkills', 'purchasedPerks'];

// Power fields that can hold BP-bought powers (domain powers, class-skill powers
// taken with BP rather than a slot). A power here counts toward BP only when the
// archetype's authored effectiveBP marks it as a purchase — slot-filled powers
// carry no effectiveBP and are validated against slots instead.
const BP_POWER_FIELDS = ['domainPowers', 'classPowers', 'formPowers'];

// Power fields grouped by the slot category they consume. Innate/class/right-
// hand/domain/form powers are class features rather than slot purchases, so
// they're tracked for prereqs but not counted against slots.
const MARTIAL_SLOT_FIELDS = {
  utility: 'utilityPowers',
  basic: 'basicPowers',
  advanced: 'advancedPowers',
  veteran: 'veteranPowers',
};
const CASTER_SLOT_FIELDS = {
  cantrips: 'cantrips',
  // spellsKnown is the combined budget across the three learnable spell tiers.
  spellsKnown: ['noviceSpells', 'adeptSpells', 'greaterSpells'],
};

// Every field whose items are resolvable entities, for prereq checking.
const ENTITY_FIELDS = [
  'startingSkills', 'purchasedSkills', 'purchasedPerks',
  'innatePowers', 'utilityPowers', 'basicPowers', 'advancedPowers',
  'veteranPowers', 'classPowers', 'rightHandPowers', 'cantrips',
  'noviceSpells', 'adeptSpells', 'greaterSpells', 'bookSpells',
  'domainPowers', 'formPowers',
];

function entityType(field) {
  if (field.endsWith('Perks')) return 'perks';
  if (field === 'flaws') return 'flaws';
  if (field.endsWith('Skills')) return 'skills';
  return 'powers';
}

// Archetype item names carry a display suffix like " - 5 BP" that isn't part of
// the canonical entity name. Strip it so name-based lookups resolve.
export function cleanItemName(item) {
  return item.replace(/\s*-\s*\d+\s*BP$/i, '').trim();
}

// Resolve a character item to its canonical entity id. When the character came
// from an archetype, the archetypeRefs id list is index-aligned with the source
// item array — so match by position (the names differ because of the BP suffix /
// "(your choice)" parameter text). Otherwise fall back to type:cleanName.
//
// `archetypeName` is set by the UI's loadArchetype; a raw archetype object only
// has `name`. Accept either so validating a raw archetype matches the live app.
function resolveId(item, field, character) {
  const archetypeName = character?.archetypeName || character?.name;
  if (archetypeName) {
    const ids = REFS.archetypeRefs[`archetypes:${archetypeName}`]?.[field];
    const src = character[field];
    if (ids && Array.isArray(src)) {
      const idx = src.indexOf(item);
      if (idx >= 0 && ids[idx]) return ids[idx];
    }
  }
  return `${entityType(field)}:${cleanItemName(item)}`;
}

export const idName = (id) => id.slice(id.indexOf(':') + 1);

// Level the character is built at, parsed from "Cleric 4". Defaults to 4.
export function characterLevel(character) {
  const n = character.classLevels?.match(/\d+/)?.[0];
  return n ? parseInt(n, 10) : 4;
}

// Base Build Points from the level table (9 at level 4).
export function budgetFor(level) {
  return LEVEL_TABLE.find((l) => l.level === level)?.bp ?? 0;
}

// Bonus BP allowance: a character may earn bonus Build Points up to a cap equal
// to their total character level (MegaDoc "Bonus BP" rule). It's optional/earned,
// so it's surfaced as headroom above the base budget rather than free spend — a
// build that exceeds base but stays within base+bonus is "legal with bonus BP".
export function bonusBudgetFor(level) {
  return level;
}

// Effective BP for one purchased item. The authoritative per-build cost is the
// archetype author's stated `effectiveBP` when present — they account for context
// the flat entity cost can't (upgrade pricing, partial discounts, build-specific
// adjustments). We fall back to the entity's generic cost, then apply grant
// provenance:
//   author wrote effectiveBP → use it verbatim (already net of grants/discounts)
//   grant (no effectiveBP)   → 0 BP (granted free by a power/class feature)
//   discount with amount     → entity cost minus the refunded amount
//   discount without amount  → entity cost (the discount amount is unknown; the
//                              author's effectiveBP, if any, already reflects it)
// Returns { cost, base, grant } so the UI can show "was N, now M (from X)".
function effectiveCost(item, field, character, idx) {
  const ent = lookupEntity(resolveId(item, field, character));
  const base = typeof ent?.cost === 'number' ? ent.cost : 0;
  const grant = character.grants?.[field]?.[idx] || null;
  const authored = character.effectiveBP?.[field]?.[idx];

  // Trust the author's stated cost when they wrote one — it's the build's truth.
  if (typeof authored === 'number') return { cost: authored, base, grant };

  if (!grant) return { cost: base, base, grant: null };
  if (grant.kind === 'grant') return { cost: 0, base, grant };
  // discount: refund a specific amount; without an amount we can't know the
  // reduction, so keep the base cost rather than wrongly zeroing it.
  if (grant.amount == null) return { cost: base, base, grant };
  return { cost: Math.max(0, base - grant.amount), base, grant };
}

// BP spent on purchased skills + perks, minus BP refunded by flaws. Honors the
// archetype grant model so power/class-granted items cost 0. byItem maps
// "field:item" → { cost, base, grant } so the UI can annotate each chip.
export function computeSpend(character) {
  let spent = 0;
  const byItem = {};
  for (const field of BP_FIELDS) {
    (character[field] || []).forEach((item, idx) => {
      const eff = effectiveCost(item, field, character, idx);
      byItem[`${field}:${item}`] = eff;
      spent += eff.cost;
    });
  }
  // BP-bought powers: count only those the author marked with an effectiveBP
  // (a slot-filled power has no authored cost and is validated against slots).
  // effectiveCost trusts that authored value, so just use it.
  for (const field of BP_POWER_FIELDS) {
    (character[field] || []).forEach((item, idx) => {
      if (character.effectiveBP?.[field]?.[idx] == null) return;
      const eff = effectiveCost(item, field, character, idx);
      byItem[`${field}:${item}`] = eff;
      spent += eff.cost;
    });
  }
  // Refunds attached to STARTING (free) skills. A starting skill costs no BP
  // itself, but its grant may refund BP into the pool — e.g. Artificer's
  // "Apprentice Tinkering (-3 BP refunded from Forgesource Specialist)". The
  // skill stays free; the refund reduces total spend. (Discounts on starting
  // skills are refunds; grants on them are just "free" and add nothing.)
  let refunded = 0;
  (character.startingSkills || []).forEach((item, idx) => {
    const grant = character.grants?.startingSkills?.[idx];
    if (grant?.kind === 'discount' && grant.amount) {
      byItem[`startingSkills:${item}`] = { cost: -grant.amount, base: 0, grant };
      refunded += grant.amount;
    }
  });

  let awarded = 0;
  for (const item of character.flaws || []) {
    const ent = lookupEntity(`flaws:${item}`);
    const bp = typeof ent?.bp === 'number' ? ent.bp : parseInt(String(ent?.bp), 10) || 0;
    byItem[`flaws:${item}`] = { cost: -bp, base: -bp, grant: null };
    awarded += bp;
  }
  return { spent, awarded, refunded, net: spent - awarded - refunded, byItem };
}

// Bonus slots granted by purchased skills (e.g. "Additional Cantrip",
// "Extended Capacity - Novice"). Derived data-driven from each owned skill's
// description rather than a hardcoded list: a phrase like "one additional
// Cantrip" or "additional Novice spell-slot" adds to the matching category cap.
// Novice/Adept/Greater spell-slots all feed the single spellsKnown budget.
// Returns { cantrips, spellsKnown, utility, basic, advanced, veteran } deltas.
const TIER_TO_CATEGORY = {
  novice: 'spellsKnown', adept: 'spellsKnown', greater: 'spellsKnown',
  cantrip: 'cantrips',
  utility: 'utility', basic: 'basic', advanced: 'advanced', veteran: 'veteran',
};
// Scan one entity's text for a slot-granting phrase, adding to `grants`.
//   "additional Cantrip"                 → +1 cantrips
//   "additional <Tier> [spell-]slot/power" → +1 to that tier's category
function scanSlotGrant(text, add) {
  if (!text) return;
  if (/\badditional\s+cantrip\b/i.test(text)) add('cantrips', 1);
  // "additional <Tier> spell-slot/slot/power" → +1 to that tier's category.
  const m = text.match(/\badditional\s+(Novice|Adept|Greater|Utility|Basic|Advanced|Veteran)\s+(?:spell-?\s*slot|slot|power)/i);
  if (m) {
    const cat = TIER_TO_CATEGORY[m[1].toLowerCase()];
    if (cat) add(cat, 1);
  }
  // "adds N to the number of Known Spells" (e.g. Spell-Scholar) → +N spellsKnown.
  const known = text.match(/\badds?\s+(\d+)\s+to\s+the\s+number\s+of\s+Known\s+Spells/i);
  if (known) add('spellsKnown', parseInt(known[1], 10));
}

// Minimum class level a power requires, parsed from "<Class> Level N" / "Level N"
// in its requirement text. 0 when none stated.
function requiredLevel(power) {
  const m = String(power?.requirement || '').match(/level\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : 0;
}

function slotGrants(character) {
  const grants = {};
  const add = (cat, n) => { grants[cat] = (grants[cat] || 0) + n; };

  // 1. Purchased / starting skills that grant slots (Additional Cantrip,
  //    Extended Capacity, …).
  const skills = [...(character.startingSkills || []), ...(character.purchasedSkills || [])];
  for (const item of skills) {
    const ent = lookupEntity(resolveId(item, 'purchasedSkills', character))
      || lookupEntity(`skills:${cleanItemName(item)}`);
    scanSlotGrant(ent?.description, add);
  }

  // 2. Automatic class INNATE powers that grant slots and whose level requirement
  //    the character meets — e.g. Artisan "Brilliant Thinker" (lvl 3 → +1 Basic),
  //    Socialite "Practiced Manner" (+1 Basic). (Class-skill grants like
  //    "Cantrip Scholar" are PURCHASED, higher-level skills — not automatic — so
  //    they're handled via the purchased-skills scan above, not here.)
  const cls = character.classLevels?.split(' ')[0];
  const level = characterLevel(character);
  for (const p of (CLASS_POWERS[cls]?.innate || [])) {
    if (requiredLevel(p) <= level) scanSlotGrant(p.desc || p.description, add);
  }

  // 3. Per-level progression bonuses up to the character's level — casters gain
  //    an "Innate Bonus Cantrip" this way (a granted starting cantrip not counted
  //    in the progression's `cantrips` column).
  const progression = CLASS_PROGRESSION[cls] || {};
  for (let lvl = 1; lvl <= level; lvl++) {
    const bonus = progression[lvl]?.bonus;
    if (bonus && /bonus\s+cantrip/i.test(bonus)) add('cantrips', 1);
  }

  return grants;
}

// Power-slot usage vs. the class's allotment at this level. Returns an array of
// { category, used, base, bonus, allowed, over } rows — one per relevant slot
// category for the character's class. `allowed` includes skill-granted bonus
// slots. Empty when the class is unknown.
export function computeSlots(character) {
  const cls = character.classLevels?.split(' ')[0];
  if (!cls || !CLASS_POWER_SLOTS[cls]) return [];
  // Read the progression row for the character's actual level (not the fixed
  // level-4 CLASS_POWER_SLOTS), so slot caps grow as the character levels.
  const level = characterLevel(character);
  const slots = CLASS_PROGRESSION[cls]?.[level] || CLASS_POWER_SLOTS[cls];
  const isCaster = SPELLCASTERS.has(cls);

  const bonus = slotGrants(character);
  const row = (category, label, used, base) => ({
    category, label, used,
    base,
    bonus: bonus[category] || 0,
    allowed: base + (bonus[category] || 0),
  });

  const rows = [];
  if (isCaster) {
    rows.push(row('cantrips', 'Cantrips', (character.cantrips || []).length, slots.cantrips ?? 0));
    const known = CASTER_SLOT_FIELDS.spellsKnown
      .reduce((n, f) => n + (character[f] || []).length, 0);
    rows.push(row('spellsKnown', 'Spells Known', known, slots.spellsKnown ?? 0));
  } else {
    for (const [cat, field] of Object.entries(MARTIAL_SLOT_FIELDS)) {
      rows.push(row(cat, cat[0].toUpperCase() + cat.slice(1), (character[field] || []).length, slots[cat] ?? 0));
    }
  }
  return rows.map((r) => ({ ...r, over: r.used > r.allowed }));
}

// Spell-slots — a caster's per-day casting capacity per tier (distinct from
// cantrips/spells-known). Source priority: the archetype's stated counts
// (noviceSpellSlots/…), else the class progression's "N/N/N" slots string for
// the character's level. Returns null for non-casters, else
// { novice, adept, greater }.
export function spellSlots(character) {
  const cls = character.classLevels?.split(' ')[0];
  const slots = cls && CLASS_POWER_SLOTS[cls];
  if (!slots || !('cantrips' in slots)) return null; // not a caster

  // Prefer explicit archetype counts when present.
  const fromArchetype = {
    novice: character.noviceSpellSlots,
    adept: character.adeptSpellSlots,
    greater: character.greaterSpellSlots,
  };
  if ([fromArchetype.novice, fromArchetype.adept, fromArchetype.greater].some((v) => v != null)) {
    const num = (v) => (v == null ? 0 : parseInt(v, 10) || 0);
    return {
      novice: num(fromArchetype.novice),
      adept: num(fromArchetype.adept),
      greater: num(fromArchetype.greater),
    };
  }

  // Fallback: the progression "N/N/N" slots string for this level.
  const level = characterLevel(character);
  const str = CLASS_PROGRESSION[cls]?.[level]?.slots;
  if (typeof str === 'string') {
    const [novice = 0, adept = 0, greater = 0] = str.split('/').map((n) => parseInt(n, 10) || 0);
    return { novice, adept, greater };
  }
  return { novice: 0, adept: 0, greater: 0 };
}

// Level-scaled stats. Archetype LP/spikes are authored at the starter level (4)
// and already include class/lineage bonuses, so we keep that base and apply the
// LEVEL-TABLE DELTA between level 4 and the character's current level. Returns
// { lifePoints, spikes } as display strings/numbers, falling back to the stored
// values when no numeric base is available.
const BASE_LEVEL = 4;
export function levelStats(character) {
  const level = characterLevel(character);
  const rowFor = (l) => LEVEL_TABLE.find((r) => r.level === l);
  const base = rowFor(BASE_LEVEL);
  const cur = rowFor(level);

  const scale = (storedVal, key) => {
    const stored = parseInt(String(storedVal), 10);
    if (Number.isNaN(stored) || !base || !cur) return storedVal ?? '—';
    return stored + ((cur[key] ?? 0) - (base[key] ?? 0));
  };
  return {
    lifePoints: scale(character.lifePoints, 'lp'),
    spikes: scale(character.spikes, 'spikes'),
  };
}

// All entity ids the character owns, for satisfying skill-prereqs.
function ownedIds(character) {
  const owned = new Set();
  for (const field of ENTITY_FIELDS) {
    for (const item of character[field] || []) {
      owned.add(resolveId(item, field, character));
    }
  }
  return owned;
}

// Whether a character meets the prereqs for a single entity id — used by the
// power picker to flag locked candidates. Returns { met, missing, anyOf, notes }
// where `met` is true only when all hard skill-prereqs (incl. disjunctions) are
// satisfied. Free-text level/other prereqs can't be auto-verified, so they don't
// block `met` but are surfaced as notes.
export function prereqStatus(character, entityId) {
  const pr = REFS.prereqs[entityId];
  if (!pr) return { met: true, missing: [], anyOf: [], notes: [] };
  const owned = ownedIds(character);
  const missing = (pr.skills || []).filter((dep) => !owned.has(dep));
  const unmetGroups = (pr.anyOf || []).filter((g) => !g.some((dep) => owned.has(dep)));
  const notes = [...(pr.levels || []), ...(pr.other || [])];
  return {
    met: missing.length === 0 && unmetGroups.length === 0,
    missing: missing.map((m) => ({ id: m, name: idName(m) })),
    anyOf: unmetGroups.map((g) => g.map((m) => ({ id: m, name: idName(m) }))),
    notes,
  };
}

// Prereq check across every owned item. Skill-prereqs (entity ids) are verified
// against ownership and become hard `issues` when unmet. Level/other prereqs are
// free-text and surface as `notes` (manual verification) rather than failures.
export function checkPrereqs(character) {
  const owned = ownedIds(character);
  const issues = [];
  const notes = [];
  const seen = new Set();

  for (const field of ENTITY_FIELDS) {
    for (const item of character[field] || []) {
      const id = resolveId(item, field, character);
      if (seen.has(id)) continue;
      seen.add(id);
      const pr = REFS.prereqs[id];
      if (!pr) continue;

      const missing = (pr.skills || []).filter((dep) => !owned.has(dep));
      // Disjunction groups ("Basic Arcane or Basic Faith") are satisfied when the
      // character holds ANY alternative; unmet groups become their own issue so
      // the UI can show "needs one of: A, B".
      const unmetGroups = (pr.anyOf || []).filter((group) => !group.some((dep) => owned.has(dep)));
      if (missing.length || unmetGroups.length) {
        issues.push({
          id, item, field,
          missing: missing.map((m) => ({ id: m, name: idName(m) })),
          anyOf: unmetGroups.map((group) => group.map((m) => ({ id: m, name: idName(m) }))),
        });
      }
      for (const lvl of pr.levels || []) notes.push({ id, item, field, kind: 'level', text: lvl });
      for (const o of pr.other || []) notes.push({ id, item, field, kind: 'other', text: o });
    }
  }
  return { issues, notes };
}

// One-shot report combining both currencies + prereqs. BP has two thresholds:
// the base budget (9 at lvl 4) and base+bonus (bonus cap = character level).
// Spending past base but within base+bonus is legal-with-bonus (not over); past
// base+bonus is a hard overage.
export function validate(character) {
  const level = characterLevel(character);
  const budget = budgetFor(level);
  const bonusBudget = bonusBudgetFor(level);
  const maxBudget = budget + bonusBudget;
  const spend = computeSpend(character);
  const slots = computeSlots(character);
  const spellSlotCounts = spellSlots(character);
  const stats = levelStats(character);
  const prereqs = checkPrereqs(character);
  const slotsOver = slots.some((s) => s.over);
  // BP used beyond the base allowance, drawn from the bonus pool (clamped ≥0).
  const bonusUsed = Math.max(0, spend.net - budget);
  const overBudget = spend.net > maxBudget;          // exceeds even base+bonus
  return {
    level,
    budget,
    bonusBudget,
    maxBudget,
    spend,
    remaining: budget - spend.net,                   // vs. base (may be negative)
    bonusUsed,
    overBudget,
    usesBonus: bonusUsed > 0 && !overBudget,         // legal, but dips into bonus
    slots,
    slotsOver,
    spellSlots: spellSlotCounts,
    stats,
    prereqs,
    valid: !prereqs.issues.length && !overBudget && !slotsOver,
  };
}
