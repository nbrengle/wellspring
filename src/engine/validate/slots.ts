// validate/slots.js — power-slot and spell-slot accounting.
//
// Extracted from validate.js (hotspot split). Self-contained: depends only on the
// shared core primitives + the class/lineage data. Holds slot-cap usage
// (computeSlots), bonus-slot grants (slotGrants), innate bonus cantrips, caster
// spell-slot capacity (spellSlots), and the Bookcaster spell options. Re-exported
// by the validate.js barrel.

import { lookupEntity, CLASS_POWERS, CLASS_PROGRESSION, CLASS_POWER_SLOTS, CLASSES, BASE_CLASSES, LINEAGES, lineageCantripChoices } from '../data.js';
import { cleanItemName, getClasses } from '../resolver.js';
import { SPELL_TIERS, SLOT_CATS, BOOKCASTER_TIER_FIELD, KNOWN_SPELL_FIELDS } from '../config.js';
import {
  countPicksForClass, progressionRow, sourceClass,
  activeInnatePowers
} from './core.js';

// Skills whose grant is scoped to a CLASS the player must choose — and the choice
// is gated by the classes they actually have levels in (the rules: "from a
// non-casting class that they have levels in", "a spell-casting class in which they
// have a Known Spell"). The chosen class is stored as the skill's parameter
// ("Extensive Training (Fighter)"), which slotGrants() already routes the bonus slot
// to. `kind` filters which of the character's classes are eligible.
//   nonCasting  — Extensive Combat Training / Extensive Training: pick a non-casting
//                 class you have levels in → +1 power slot of that tier there.
//   spellCasting — Spell-Scholar: pick a spell-casting class you have a Known Spell
//                 in → +1 spells-known there.
export const CLASS_CHOICE_SKILLS = {
  'Extensive Combat Training - Basic':    { kind: 'nonCasting' },
  'Extensive Combat Training - Advanced': { kind: 'nonCasting' },
  'Extensive Combat Training - Veteran':  { kind: 'nonCasting' },
  'Extensive Training':                   { kind: 'nonCasting' },
  'Spell-Scholar':                        { kind: 'spellCasting' },
};

// The classes a character may choose for a given class-choice skill: their own
// classes, filtered to the skill's required kind (and for Spell-Scholar, only ones
// they actually have a Known Spell in — i.e. a caster class they've leveled).
export function eligibleClassChoices(character, baseName) {
  const spec = CLASS_CHOICE_SKILLS[baseName];
  if (!spec) return null;
  return getClasses(character)
    .map((c) => c.name)
    .filter((name) => {
      const isCaster = !!CLASSES[name]?.spellcaster;
      return spec.kind === 'spellCasting' ? isCaster : !isCaster;
    });
}

// Bonus slots, keyed PER CLASS as "class:category" → count. Class features
// attribute to their own class; skill grants attribute to a relevant class (the
// caster class for cantrip/spell grants, the martial class for power grants), so
// the bonus lands on the correct per-class slot row.
// `sources` (optional) is filled with { "cls:cat": [grantingItemName, …] } so the
// slot UI can show WHICH skill granted a bonus slot (the "auditable" attribution).
export function slotGrants(character, sources = null) {
  const grants = {};
  // computeSlots categories only. Raw spell-tier grants (novice/adept/greater) are
  // the province of spellSlots(), not the slot-cap budget here — skip them.
  const cats = new Set(SLOT_CATS);
  const addTo = (cls, cat, n, source) => {
    if (!cls || !cats.has(cat)) return;
    const k = `${cls}:${cat}`;
    grants[k] = (grants[k] || 0) + n;
    if (sources && source) (sources[k] = sources[k] || []).push(source);
  };
  const classes = getClasses(character);
  const casterClass = classes.find((c) => CLASSES[c.name]?.spellcaster)?.name;
  const martialClass = classes.find((c) => !CLASSES[c.name]?.spellcaster)?.name;
  // Route a category to the class whose slot it belongs to.
  const classFor = (cat) => (cat === 'cantrips' || cat === 'spellsKnown') ? casterClass : martialClass;

  // 1. Purchased / starting skills that grant slots (Additional Cantrip,
  //    Extended Capacity, Spell-Scholar). The grants are parser-extracted
  //    (ent.slotGrants); attribute each to the relevant class and multiply by the
  //    item's rank ("Extended Capacity - Novice x2" → +2). innatePowers is excluded
  //    (GENERIC_POWER_FIELDS) — innate slot grants are handled by the
  //    activeInnatePowers() loop below; iterating them here too would double-count.
  for (const field of ['skills', 'powers']) {
    (character[field] || []).forEach((item: any) => {
      const clean = cleanItemName(item.entityId.replace(/^(skills|powers):/, ''));
      const ent = lookupEntity(item.entityId) as any;
      const rank = item.ranks || 1;

      let targetCls = sourceClass(item.source);
      if (!targetCls) {
        const paramMatch = clean.match(/\((.*?)\)/);
        if (paramMatch && CLASSES[paramMatch[1].trim()]) {
          targetCls = paramMatch[1].trim();
        }
      }

      if (!targetCls && ent && ent.id && ent.id.startsWith('powers:')) {
         // Find which class has this power
         for (const c of classes) {
           const byTier = CLASS_POWERS[c.name];
           if (byTier) {
             for (const t of Object.values(byTier)) {
               if (t.some(p => p.name === ent.name)) {
                 targetCls = c.name;
                 break;
               }
             }
           }
           if (targetCls) break;
         }
      }

      for (const { cat, n } of (ent?.slotGrants || [])) {
         addTo(targetCls || classFor(cat), cat, n * rank, ent?.baseName || ent?.name || cleanItemName(item));
      }
    });
  }

  // 2 + 3. Per-class automatic grants, gated by that class's own level: INNATE
  // powers granting slots (Artisan "Brilliant Thinker" → +1 Basic). The
  // progression "Innate Bonus Cantrip" is NOT a slot — it grants the specific
  // locked cantrip, handled by innateBonusCantrips(), so it never bumps the cap.
  for (const ip of activeInnatePowers(character)) {
    if (ip.cls && ip.entity?.slotGrants) {
      for (const { cat, n } of (ip.entity.slotGrants || [])) addTo(ip.cls, cat, n, ip.entity.name || ip.name);
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
// How many Agile Learner trades the character is entitled to — the total rank of
// every Agile Learner skill they own (it has no maxRanks, so each purchase = one
// more trade). 0 when the skill isn't owned.
export function agileLearnerCapacity(character: any): number {
  return (character.skills || []).reduce((n: number, s: any) => {
    if (cleanItemName(s.entityId.replace('skills:', '')) === 'Agile Learner') return n + (s.ranks || 1);
    return n;
  }, 0);
}

// The per-class trades actually allowed: the recorded trades, clamped so the total
// never exceeds capacity (owned Agile Learner ranks) and a class never trades away
// a basic slot it doesn't have. Drops trades on classes not owned.
function clampAgileTrades(character, classes) {
  const recorded = character.agileLearnerTrades || {};
  const capacity = agileLearnerCapacity(character);
  const out = {};
  let used = 0;
  for (const { name: cls, level } of classes) {
    if (CLASSES[cls]?.spellcaster) continue; // power trades are non-caster only
    const want = recorded[cls] || 0;
    if (want <= 0) continue;
    const basics = progressionRow(cls, level).basic ?? 0;
    const allowed = Math.min(want, basics, capacity - used);
    if (allowed > 0) { out[cls] = allowed; used += allowed; }
  }
  return out;
}

export function computeSlots(character) {
  const classes = getClasses(character).filter((c) => CLASS_POWER_SLOTS[c.name]);
  if (!classes.length) return [];
  const multi = classes.length > 1;
  const bonusSources = {};
  const bonus = slotGrants(character, bonusSources);
  // Free, locked cantrips granted by progression ("Innate Bonus Cantrip: Cancel").
  const grantedCantrips = innateBonusCantrips(character);

  // Agile Learner trades a tier-1 slot for a tier-2 (same class). You can only make
  // as many trades as you own Agile Learner ranks — so clamp the recorded trades to
  // that capacity. Without this, a stale `agileLearnerTrades` (or one set on a
  // character that doesn't own the skill) would silently shift slots for free.
  const agileTrades = clampAgileTrades(character, classes);

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
        // Which skill(s) granted the bonus slot(s) on this row — for the UI to show
        // "+1 from Extensive Training" so a granted slot is auditable.
        bonusFrom: bonusSources[`${cls}:${category}`] || [],
      };
    };
    if (isCaster) {
      const granted = grantedCantrips.filter((g) => g.cls === cls || g.cls === 'ALL').map((g) => g.name);
      // A granted (innate) cantrip never consumes a choosable slot, even if it
      // appears in the character's cantrip pick list. Exclude it from `used`.
      const used = (character.spells || []).reduce((n: number, choice: any) => {
        if (sourceClass(choice.source) !== cls) return n;
        const ent = lookupEntity(choice.entityId) as any;
        if (ent?.tier?.toLowerCase() !== 'cantrip') return n;
        if (granted.includes(cleanItemName(choice.entityId.replace('spells:', '')))) return n;
        return n + (choice.ranks || 1);
      }, 0);
      const cantripRow = mkRow('cantrips', 'Cantrips', used, prog.cantrips ?? 0);
      cantripRow.granted = granted;
      rows.push(cantripRow);
      const known = countPicksForClass(character, 'spells', cls, ['novice', 'adept', 'greater']);
      rows.push(mkRow('spellsKnown', 'Spells Known', known, prog.spellsKnown ?? 0));
    } else {
      const cats = ['utility', 'basic', 'advanced', 'veteran'];
      for (const cat of cats) {
        rows.push(mkRow(cat, cat[0].toUpperCase() + cat.slice(1), countPicksForClass(character, 'powers', cls, cat), prog[cat] ?? 0));
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

  const highestSlots = []; // array of target pool strings
  const applySpellGrants = (ent, rank = 1, itemName = null) => {
    if (!ent) return;
    
    let targetPool = primaryType;
    const paramMatch = itemName?.match(/\((.*?)\)/);
    if (paramMatch) {
      const p = paramMatch[1].trim();
      if (p === 'Arcane' || p === 'Divine') {
        targetPool = p;
      } else if (CLASSES[p]?.magicType) {
        targetPool = CLASSES[p].magicType;
      }
    }

    if (!pools[targetPool]) pools[targetPool] = { novice: 0, adept: 0, greater: 0 };

    for (const { cat, n } of (ent.slotGrants || [])) {
      if (SPELL_TIERS.has(cat)) pools[targetPool][cat] += n * rank;
    }
    if (ent.highestSlot) {
      for (let i = 0; i < rank; i++) highestSlots.push(targetPool);
    }
  };

  for (const item of (character.skills || [])) {
    applySpellGrants(lookupEntity(item.entityId), item.ranks || 1, item.entityId);
  }
  for (const item of (character.perks || [])) {
    applySpellGrants(lookupEntity(item.entityId), item.ranks || 1, item.entityId);
  }
  if (character.lineage) {
    const lin = LINEAGES[character.lineage];
    for (const name of (character.lineageAdvantages || [])) {
      applySpellGrants((lin?.advantages || []).find((x) => x.name === name || x.baseName === name), 1, name);
    }
  }

  // A "highest-level spell-slot" grant adds one slot at the character's highest
  // accessible tier in the granted pool.
  for (const p of highestSlots) {
    if (pools[p]?.greater > 0) pools[p].greater += 1;
    else if (pools[p]?.adept > 0) pools[p].adept += 1;
    else if (pools[p]?.novice > 0) pools[p].novice += 1;
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

// Basic Arcane / Basic Faith let ANY character (including a non-caster) learn a
// spell. The spell SOURCE is conditional (per the rules):
//   • if you have a caster class of the matching magic type → only that class's list
//   • if you have no caster class → any Base Class's spell list of that type
// The skill confers no spell-slots — only the Known Spell — so this just supplies the
// pickable pool; the chosen spell is recorded as the skill's parameter (like
// Bookcaster). Returns a sorted, de-duped list of spell names. `magicType` is
// 'Arcane' (Basic Arcane) or 'Divine' (Basic Faith).
export function basicSpellOptions(character, magicType) {
  const myCasterClasses = getClasses(character)
    .filter((c) => CLASSES[c.name]?.spellcaster && CLASSES[c.name]?.magicType === magicType)
    .map((c) => c.name);
  // Source classes: your matching caster class(es) if any, else every base class of
  // this magic type.
  const sourceClasses = myCasterClasses.length
    ? myCasterClasses
    : Object.keys(CLASSES).filter((n) => CLASSES[n]?.spellcaster && CLASSES[n]?.magicType === magicType);

  const spells = new Set();
  for (const cls of sourceClasses) {
    const byTier = CLASS_POWERS[cls];
    if (!byTier) continue;
    for (const field of KNOWN_SPELL_FIELDS) {
      for (const sp of (byTier[field] || [])) {
        if (sp?.name && !/^(Adept|Greater)\s+\w+\s+Power$/i.test(sp.name)) spells.add(sp.name);
      }
    }
  }
  return [...spells].sort((a, b) => a.localeCompare(b));
}

// The magic type each Basic-spell skill draws from.
export const BASIC_SPELL_SKILLS = { 'Basic Arcane': 'Arcane', 'Basic Faith': 'Divine' };

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
  // Spells-known are V2 CharacterChoice[] in `spells`, keyed by their tier costField.
  const knownSet = new Set();
  const knownFields = new Set(KNOWN_SPELL_FIELDS);
  for (const choice of (character.spells || [])) {
    if (knownFields.has(choice.costField)) knownSet.add(cleanItemName(choice.entityId));
  }

  const sort = (arr) => [...arr].sort((a, b) => a.localeCompare(b));
  const known = sort(knownSet);
  const other = sort([...accessible].filter((n) => !knownSet.has(n)));
  return { known, other };
}

// Spells choosable for Arcane Secrets (Knowledge domain power). The rules have TWO
// branches, both drawing from ANY base arcane class ("does not need to be from an
// arcane spellcasting class they already have access to"):
//   • Caster with Known Spells → "one arcane spell at a rank they are capable of
//     casting": cantrips + every tier they hold an Arcane spell-slot for.
//   • No Known Spells (e.g. a non-caster Cleric) → "a spell an equivalent level
//     caster could cast based on total level, UP TO ADEPT": cantrip/novice/adept.
// (The "cast once per long rest without a slot" part is in-play, not a build pick.)
// Returns a sorted, de-duped list of arcane spell names — the pickable pool.
const ARCANE_TIER_FIELD = { cantrip: 'cantrips', novice: 'noviceSpells', adept: 'adeptSpells', greater: 'greaterSpells' };
export function arcaneSecretsSpellOptions(character) {
  const arcaneClasses = Object.keys(CLASSES).filter(
    (n) => CLASSES[n]?.spellcaster && CLASSES[n]?.magicType === 'Arcane',
  );
  const hasKnownSpells = (character.spells?.length || 0) > 0;

  let tiers;
  if (hasKnownSpells) {
    // Cantrips are always castable; higher tiers gated by Arcane spell-slots held.
    const arcaneSlots = (spellSlots(character) || {}).Arcane || { novice: 0, adept: 0, greater: 0 };
    tiers = ['cantrip', ...['novice', 'adept', 'greater'].filter((t) => (arcaneSlots[t] || 0) > 0)];
  } else {
    // No Known Spells → capped at Adept regardless of slots.
    tiers = ['cantrip', 'novice', 'adept'];
  }

  const spells = new Set();
  for (const cls of arcaneClasses) {
    const byTier = CLASS_POWERS[cls];
    if (!byTier) continue;
    for (const tier of tiers) {
      for (const sp of (byTier[ARCANE_TIER_FIELD[tier]] || [])) {
        if (sp?.name && !/^(Adept|Greater)\s+\w+\s+Power$/i.test(sp.name)) spells.add(sp.name);
      }
    }
  }
  return [...spells].sort((a, b) => a.localeCompare(b));
}

// Weird Wanderings (Artisan Basic power): "choose one Basic-Tier Power from any
// other non-Artisan Base Class" — and it "cannot have a Refresh of Spell". The pool
// is every Basic-tier power of a base class other than Artisan, minus Spell-refresh
// ones. (Only martial base classes have a "Basic" tier; casters use Novice/Adept/
// Greater, so they contribute nothing here — consistent with the rule's intent.)
export function weirdWanderingsOptions() {
  const out = new Set();
  for (const cls of BASE_CLASSES) {
    if (cls === 'Artisan') continue;
    for (const p of (CLASS_POWERS[cls]?.basic || [])) {
      if (p?.name && !/^spell$/i.test(p.refresh || '')) out.add(p.name);
    }
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

// The Specialty Tags an Artisan Basic power can carry (Artificer / Crafter / Mystic).
export const ARTISAN_SPECIALTY_TAGS = [...new Set(
  (CLASS_POWERS.Artisan?.basic || []).flatMap((p) => p.tags || []),
)].sort();

// Studied Focus (Artisan Advanced power): "instead of an Advanced Power, choose TWO
// Basic Artisan Powers with the SAME Specialty Tag." Returns the Basic Artisan
// powers carrying `tag` — the pool for BOTH of its two picks. (Tag-less call returns
// all Basic Artisan powers, used to validate a recorded pair shares a tag.)
export function studiedFocusOptions(tag) {
  return (CLASS_POWERS.Artisan?.basic || [])
    .filter((p) => p?.name && (!tag || (p.tags || []).includes(tag)))
    .map((p) => p.name)
    .sort((a, b) => a.localeCompare(b));
}
