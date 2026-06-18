// validate/slots.js — power-slot and spell-slot accounting.
//
// Extracted from validate.js (hotspot split). Self-contained: depends only on the
// shared core primitives + the class/lineage data. Holds slot-cap usage
// (computeSlots), bonus-slot grants (slotGrants), innate bonus cantrips, caster
// spell-slot capacity (spellSlots), and the Bookcaster spell options. Re-exported
// by the validate.js barrel.

import { lookupEntity, CLASS_POWERS, CLASS_PROGRESSION, CLASS_POWER_SLOTS, CLASSES, LINEAGES, lineageCantripChoices } from '../data.js';
import { cleanItemName, resolveId, getClasses } from '../resolver.js';
import { SPELL_TIERS, SLOT_CATS, BOOKCASTER_TIER_FIELD, KNOWN_SPELL_FIELDS } from '../config.js';
import {
  rankOf, pickClass, countPicksForClass, progressionRow,
  activeInnatePowers, CASTER_SLOT_FIELDS, MARTIAL_SLOT_FIELDS, POWER_SOURCE_FIELDS
} from './core.js';

// Bonus slots, keyed PER CLASS as "class:category" → count. Class features
// attribute to their own class; skill grants attribute to a relevant class (the
// caster class for cantrip/spell grants, the martial class for power grants), so
// the bonus lands on the correct per-class slot row.
export function slotGrants(character) {
  const grants = {};
  // computeSlots categories only. Raw spell-tier grants (novice/adept/greater) are
  // the province of spellSlots(), not the slot-cap budget here — skip them.
  const cats = new Set(SLOT_CATS);
  const addTo = (cls, cat, n) => {
    if (!cls || !cats.has(cat)) return;
    const k = `${cls}:${cat}`;
    grants[k] = (grants[k] || 0) + n;
  };
  const classes = getClasses(character);
  const casterClass = classes.find((c) => CLASSES[c.name]?.spellcaster)?.name;
  const martialClass = classes.find((c) => !CLASSES[c.name]?.spellcaster)?.name;
  // Route a category to the class whose slot it belongs to.
  const classFor = (cat) => (cat === 'cantrips' || cat === 'spellsKnown') ? casterClass : martialClass;

  // 1. Purchased / starting skills that grant slots (Additional Cantrip,
  //    Extended Capacity, Spell-Scholar). The grants are parser-extracted
  //    (ent.slotGrants); attribute each to the relevant class and multiply by the
  //    item's rank ("Extended Capacity - Novice x2" → +2).
  for (const field of ['startingSkills', 'purchasedSkills', ...POWER_SOURCE_FIELDS]) {
    (character[field] || []).forEach((item, idx) => {
      const ent = lookupEntity(resolveId(item, field, character))
        || lookupEntity(`skills:${cleanItemName(item)}`)
        || lookupEntity(`powers:${cleanItemName(item)}`);
      const rank = rankOf(character, field, idx);
      for (const { cat, n } of (ent?.slotGrants || [])) addTo(classFor(cat), cat, n * rank);
    });
  }

  // 2 + 3. Per-class automatic grants, gated by that class's own level: INNATE
  // powers granting slots (Artisan "Brilliant Thinker" → +1 Basic). The
  // progression "Innate Bonus Cantrip" is NOT a slot — it grants the specific
  // locked cantrip, handled by innateBonusCantrips(), so it never bumps the cap.
  for (const ip of activeInnatePowers(character)) {
    if (ip.cls && ip.entity?.slotGrants) {
      for (const { cat, n } of (ip.entity.slotGrants || [])) addTo(ip.cls, cat, n);
    }
  }

  return grants;
}

// Cantrips a caster is GRANTED for free (locked, not choosable) by the
// progression "Innate Bonus Cantrip: <name>" prose. Returns [{ cls, name }],
// deduped per class+name.
export function innateBonusCantrips(character) {
  const out = [];
  const seen = new Set();
  for (const { name: cls, level: clsLevel } of getClasses(character)) {
    const classCantrips = new Set((CLASS_POWERS[cls]?.cantrips || []).map((c) => c.name));
    const progression = CLASS_PROGRESSION[cls] || {};
    for (let lvl = 1; lvl <= clsLevel; lvl++) {
      // Parser-extracted innate-cantrip names from the progression bonus column;
      // keep only those that are real cantrips of this class.
      for (const nm of (progression[lvl]?.innateCantrips || [])) {
        if (!classCantrips.has(nm)) continue;
        const key = `${cls}:${nm}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ cls, name: nm });
      }
    }
  }

  // Cantrips granted by a lineage cantrip-choice (Divine Magic, Psionic Cantrip, …)
  // are known/castable. Data-driven — no per-name special case.
  for (const { cantrip } of lineageCantripChoices(character)) {
    out.push({ cls: "ALL", name: cantrip });
  }

  return out;
}

// Power-slot usage vs. allotment, PER CLASS. Slots are class-specific, so we emit
// one row per class × category, each counting only that class's attributed picks
// and capped by that class's progression at its level. Each row carries `cls` so
// the picker can filter candidates to that class.
export function computeSlots(character) {
  const classes = getClasses(character).filter((c) => CLASS_POWER_SLOTS[c.name]);
  if (!classes.length) return [];
  const multi = classes.length > 1;
  const bonus = slotGrants(character);
  // Free, locked cantrips granted by progression ("Innate Bonus Cantrip: Cancel").
  const grantedCantrips = innateBonusCantrips(character);

  const agileTrades = character.agileLearnerTrades || {};

  const rows = [];
  for (const { name: cls, level } of classes) {
    // Clamp to the highest documented progression level (base classes cap at 10).
    const prog = progressionRow(cls, level);
    const isCaster = CLASSES[cls]?.spellcaster;
    const mkRow = (category, label, used, baseVal) => {
      let b = bonus[`${cls}:${category}`] || 0;
      if (!isCaster) {
        if (category === 'basic') b -= (agileTrades[cls] || 0);
        if (category === 'advanced') b += (agileTrades[cls] || 0);
      }
      return {
        cls, category, label: multi ? `${cls} ${label}` : label,
        used, base: baseVal, bonus: b, allowed: baseVal + b,
      };
    };
    if (isCaster) {
      const granted = grantedCantrips.filter((g) => g.cls === cls || g.cls === 'ALL').map((g) => g.name);
      // A granted (innate) cantrip never consumes a choosable slot, even if it
      // appears in the character's cantrip pick list. Exclude it from `used`.
      const used = (character.cantrips || []).reduce((n, name, i) =>
        n + (pickClass(character, 'cantrips', i, name) === cls && !granted.includes(name) ? 1 : 0), 0);
      const cantripRow = mkRow('cantrips', 'Cantrips', used, prog.cantrips ?? 0);
      cantripRow.granted = granted;
      rows.push(cantripRow);
      const known = CASTER_SLOT_FIELDS.spellsKnown
        .reduce((n, f) => n + countPicksForClass(character, f, cls), 0);
      rows.push(mkRow('spellsKnown', 'Spells Known', known, prog.spellsKnown ?? 0));
    } else {
      for (const [cat, field] of Object.entries(MARTIAL_SLOT_FIELDS)) {
        rows.push(mkRow(cat, cat[0].toUpperCase() + cat.slice(1), countPicksForClass(character, field, cls), prog[cat] ?? 0));
      }
    }
  }
  return rows.map((r) => ({ ...r, over: r.used > r.allowed }));
}

// Spell-slots — a caster's per-day casting capacity per tier (distinct from
// cantrips/spells-known). Returns null for non-casters, else
// { novice, adept, greater }.
export function spellSlots(character) {
  const casters = getClasses(character).filter((c) => CLASSES[c.name]?.spellcaster);
  if (!casters.length) return null; // not a caster

  const pools = {};
  const agileTrades = character.agileLearnerTrades || {};

  // Sum each caster class's progression "N/N/N" slots at its own level.
  for (const { name, level } of casters) {
    const magicType = CLASSES[name]?.magicType || 'Unknown';
    if (!pools[magicType]) pools[magicType] = { novice: 0, adept: 0, greater: 0 };

    const str = progressionRow(name, level)?.slots;
    if (typeof str === 'string') {
      const [n = 0, a = 0, g = 0] = str.split('/').map((x) => parseInt(x, 10) || 0);
      pools[magicType].novice += n - (agileTrades[name] || 0);
      pools[magicType].adept += a + (agileTrades[name] || 0);
      pools[magicType].greater += g;
    }
  }

  // Additional spell-slot grants from owned skills/perks/advantages are
  // parser-extracted (ent.slotGrants for novice/adept/greater; ent.highestSlot for
  // a floating "highest-level" slot).
  // We apply these general grants to the primary caster's magic type pool.
  const primaryType = CLASSES[casters[0].name]?.magicType || 'Unknown';
  if (!pools[primaryType]) pools[primaryType] = { novice: 0, adept: 0, greater: 0 };

  const spellTiers = new Set(SPELL_TIERS);
  let highestSlots = 0;
  const applySpellGrants = (ent, rank = 1) => {
    if (!ent) return;
    for (const { cat, n } of (ent.slotGrants || [])) {
      if (SPELL_TIERS.has(cat)) pools[primaryType][cat] += n * rank;
    }
    if (ent.highestSlot) highestSlots += 1;
  };

  for (const field of ['startingSkills', 'purchasedSkills', 'classSkills']) {
    (character[field] || []).forEach((item, idx) => {
      const ent = lookupEntity(resolveId(item, field, character))
        || lookupEntity(`skills:${cleanItemName(item)}`);
      applySpellGrants(ent, rankOf(character, field, idx));
    });
  }
  for (const item of (character.purchasedPerks || [])) {
    applySpellGrants(lookupEntity(`perks:${cleanItemName(item)}`));
  }
  if (character.lineage) {
    const lin = LINEAGES[character.lineage];
    for (const name of (character.lineageAdvantages || [])) {
      applySpellGrants((lin?.advantages || []).find((x) => x.name === name || x.baseName === name));
    }
  }

  // A "highest-level spell-slot" grant adds one slot at the character's highest
  // accessible tier in their primary pool.
  for (let i = 0; i < highestSlots; i++) {
    if (pools[primaryType].greater > 0) pools[primaryType].greater += 1;
    else if (pools[primaryType].adept > 0) pools[primaryType].adept += 1;
    else if (pools[primaryType].novice > 0) pools[primaryType].novice += 1;
  }

  // Prune any empty pools
  for (const t of Object.keys(pools)) {
    if (pools[t].novice === 0 && pools[t].adept === 0 && pools[t].greater === 0) {
      delete pools[t];
    }
  }

  if (Object.keys(pools).length === 0) return null;
  return pools;
}

// Spells a Bookcaster can select, split into { known, other } for the picker.

export function bookcasterSpellOptions(character) {
  const casters = getClasses(character).filter((c) => CLASSES[c.name]?.spellcaster);
  if (!casters.length) return { known: [], other: [] };
  const pools = spellSlots(character) || {};

  // Every accessible spell from the caster classes' lists, filtered by whether
  // they have spell slots in that class's magic type.
  const accessible = new Set();
  for (const { name: cls } of casters) {
    const byTier = CLASS_POWERS[cls];
    if (!byTier) continue;
    const magicType = CLASSES[cls]?.magicType || 'Unknown';
    const slots = pools[magicType] || { novice: 0, adept: 0, greater: 0 };
    const accessibleTiers = Object.keys(BOOKCASTER_TIER_FIELD).filter((t) => (slots[t] || 0) > 0);

    for (const tier of accessibleTiers) {
      for (const sp of (byTier[BOOKCASTER_TIER_FIELD[tier]] || [])) {
        // Skip placeholder rows the parser emits for undocumented tiers.
        if (sp?.name && !/^(Adept|Greater)\s+\w+\s+Power$/i.test(sp.name)) accessible.add(sp.name);
      }
    }
  }
  // Spells the character actually knows (their spells-known picks). A known spell
  // is offered even if its tier later falls out of `accessible` — you still know it.
  const knownSet = new Set();
  for (const f of KNOWN_SPELL_FIELDS) for (const name of (character[f] || [])) knownSet.add(cleanItemName(name));

  const sort = (arr) => [...arr].sort((a, b) => a.localeCompare(b));
  const known = sort(knownSet);
  const other = sort([...accessible].filter((n) => !knownSet.has(n)));
  return { known, other };
}
