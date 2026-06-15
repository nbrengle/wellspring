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

import { LEVEL_TABLE, lookupEntity, REFS, CLASS_POWER_SLOTS, CLASS_POWERS, CLASS_PROGRESSION, SPELLCASTERS, DEVOTIONS, DOMAINS, CLASSES, LINEAGES, CRAFTING, RITUALS, EVENTS_TABLE, UNLIMITED_SKILLS, BASE_CLASSES } from "../data/index.js";
import { startingSkillGrants } from "../data/starting-choices.js";
import { cleanItemName, bareSkill, resolveId, idName, entityType, getClasses, primaryClass } from './resolver.js';

// Shared primitives now live in validate/core.js (hotspot split). Import the ones
// this module still uses internally, and re-export the public surface from the
// barrel so existing imports (`from './data/validate.js'`) keep working unchanged.
import {
  MAX_LBP, MAX_FLAW_BP, BACKSTORY_BP, MAX_DOMAINS, DEFAULT_WEALTH,
  LEGAL_MIN_LEVEL, LEVEL_CAP, subKey,
  BP_FIELDS, BP_POWER_FIELDS, MARTIAL_SLOT_FIELDS, CASTER_SLOT_FIELDS,
  ENTITY_FIELDS, CLASS_POWER_TIERS, POWER_SOURCE_FIELDS,
  characterLevel, getLegalMinLevel,
  parseTrailingRank, rankOf, getMaxRanks, requiredLevel,
  pickClass, countPicksForClass, maxProgressionLevel, progressionRow,
  activeInnatePowers, ownedGrantSources, grantedAbilities, grantIndex, derivedGrant,
} from './validate/core.js';
export {
  MAX_LBP, MAX_FLAW_BP, BACKSTORY_BP, MAX_DOMAINS, DEFAULT_WEALTH,
  LEGAL_MIN_LEVEL, LEVEL_CAP, subKey,
  getClasses, primaryClass, characterLevel, getLegalMinLevel,
  getMaxRanks, pickClass,
};
export { EVENTS_TABLE } from './validate/core.js';
import { lbpState } from './validate/lbp.js';
export { lbpState };

// Slot/spell-slot accounting (validate/slots.js) and prerequisite checking
// (validate/prereqs.js) — extracted leaves. Import the ones the orchestrator calls
// internally; re-export the public surface so the barrel keeps its API.
import { computeSlots, spellSlots, bookcasterSpellOptions } from './validate/slots.js';
export { innateBonusCantrips } from './validate/slots.js';
import { resolveCharacterGraph } from './graph.js';
import { computeBP } from './validate/bp-accounting.js';
import { statMods as computeStatMods, levelStats as computeLevelStats } from './validate/derived-stats.js';
import { wealthState as computeWealthState } from './validate/wealth-income.js';

import { checkPrereqs } from './validate/prereqs.js';
export { prereqStatus, checkLevelConstraint } from './validate/prereqs.js';

// Wellspring has three distinct "consequence" kinds, kept separate by design:
//   1. GRANT-OF-ENTITY — a source gives you a named Perk/Power/Skill for free
//      ("gains the Magical Resilience Perk"). Edge: REFS.grants/grantedBy. ↓ here.
//   2. GRANT-OF-SLOT    — a source gives you an extra slot/pool ("+1 Novice
//      spell-slot"). Parser-extracted to entity.slotGrants; applied by
//      slotGrants/spellSlots, not here.
//   3. DISCOUNT         — a source makes other purchases cheaper (Patron, etc.).
//      Edge: REFS.discounts. Handled by discountSources/applyDiscounts.
// (We use one word — "grant" — for #1; an earlier draft called it "bestowal".)



// Per-level power benefits (kind: per-level tiers). Some powers gain benefits as a
// CLASS LEVEL rises — "at various Artisan Levels: Level 1 …, Level 3 …" — parsed
// into `levelBenefits` at build time. For each such power the character owns, mark
// which entries are ACTIVE given the character's level in that power's gating class
// (auto-granted, no BP, no error — higher tiers are simply still locked). Returns
// [{ power, gateClass, benefits: [{ level, text, active }] }].
export function activePowerBenefits(character) {
  const levelByClass = Object.fromEntries(getClasses(character).map((c) => [c.name, c.level]));
  const out = [];
  for (const field of POWER_SOURCE_FIELDS) {
    for (const item of (character[field] || [])) {
      const ent = lookupEntity(`powers:${cleanItemName(item)}`);
      if (!ent?.levelBenefits) continue;
      const lvl = levelByClass[ent.levelBenefitClass] ?? characterLevel(character);
      out.push({
        power: ent.name,
        gateClass: ent.levelBenefitClass,
        benefits: ent.levelBenefits.map((b) => ({ ...b, active: lvl >= b.level })),
      });
    }
  }
  return out;
}


// Whether the character has the Worship skill (lets them follow a devotion and
// access its domains). Archetypes encode it as "Worship - <Devotion>", so match
// the prefix. Any class can take it.
export function hasWorship(character) {
  return [...(character?.startingSkills || []), ...(character?.purchasedSkills || [])]
    .some((s) => /^worship\b/i.test(s));
}

// Devotion / domain state for the UI: the chosen devotion, the domains it grants,
// the character's selected domains (≤2, intersected with what the devotion has),
// whether Worship is held, and the domain powers available to purchase from the
// selected domains. Returns null when no devotion is set.
export function devotionState(character) {
  const devName = character?.devotion;
  if (!devName) return null;
  const dev = DEVOTIONS.find((d) => d.name === devName || d.baseName === devName);
  const available = dev?.domains || [];
  const chosen = (character.divineDomains || []).filter((d) => available.includes(d)).slice(0, MAX_DOMAINS);
  // Domain powers purchasable from the chosen domains.
  const powers = chosen.flatMap((dn) => {
    const dom = DOMAINS.find((x) => x.name === dn);
    return (dom?.powers || []).map((p) => ({ ...p, domain: dn }));
  });
  return {
    devotion: dev || { name: devName, domains: [] },
    available, chosen,
    worship: hasWorship(character),
    eligiblePowers: powers,
  };
}





// Normalization functions getClasses and primaryClass are now imported from ./resolver.js



// bareSkill helper is now imported from ./resolver.js

// DERIVED multi-class grants — a pure function of the character's classes, so the
// same rule drives both the forward path (materialize grants when a class is
// added) and the reflective path (validate). Each class AFTER the first grants
// its Multi-Class Skills; a granted skill the character already has instead
// awards "free BP" equal to its cost (the "multiclass discount").
// Returns { skills:[{name,source}], freeBP, freeBPItems:[{skill,source,bp}] }.
// `skills` are the genuinely-new free skills; the caller decides whether to
// display/merge them. Nothing here is cached on the character.
export function multiclassGrants(character) {
  const classes = getClasses(character);
  const skills = [];
  const freeBPItems = [];
  let freeBP = 0;
  // Skills the character already has from elsewhere (starting + purchased + the
  // first class isn't re-granted). Track as we go so two classes granting the
  // same skill only grant it once (second one becomes free BP).
  const owned = new Set([
    ...(character.startingSkills || []),
    ...(character.purchasedSkills || []),
  ].map(bareSkill));

  classes.slice(1).forEach(({ name }) => {
    for (const g of (CLASSES[name]?.multiclassGrants || [])) {
      if (owned.has(bareSkill(g.name))) {
        freeBP += g.cost || 0;
        freeBPItems.push({ skill: g.name, source: name, bp: g.cost || 0 });
      } else {
        skills.push({ name: g.name, source: name });
        owned.add(bareSkill(g.name));
      }
    }
  });
  return { skills, freeBP, freeBPItems };
}


export function classifyOwnedItems(character) {
  const skills = [];
  const perks = [];
  const classPowers = [];
  const innatePowers = [];
  const misfiled = {};
  const classNames = new Set(getClasses(character).map((c) => c.name));
  // Starting skills / class-granted perks come from the PRIMARY (first) class, so
  // a "from class" badge can name it (#16).
  const primary = getClasses(character)[0]?.name || null;
  const flag = (field, index) => { (misfiled[field] = misfiled[field] || new Set()).add(index); };

  // Resolve an item to its real entity (type-prefixed by its storage field first,
  // then by a free lookup across powers/perks/skills so a misfiled item resolves).
  const resolve = (item, field) => {
    const byField = lookupEntity(resolveId(item, field, character))
      || lookupEntity(`${entityType(field)}:${bareSkill(cleanItemName(item))}`);
    if (byField && byField.type === entityType(field)) return byField;
    const clean = cleanItemName(item);
    return lookupEntity(`powers:${clean}`) || lookupEntity(`perks:${clean}`)
      || lookupEntity(`skills:${clean}`) || byField;
  };

  // A starting skill granted by a specialty choice (Druid's "Budding Wisdom", …)
  // carries that block's label as provenance. DERIVED from the class config +
  // chosen options (not a persisted sidecar), so badges work on imported / hash-
  // loaded characters too, not only freshly-rebuilt ones.
  const specialtyByIndex = startingSkillGrants(character).specialty;
  const startFloors = startingSkillGrants(character).floor;
  const specialtyOf = (field, index) =>
    field === 'startingSkills' ? (specialtyByIndex[index] || null) : null;
  const floorOf = (field, index) =>
    field === 'startingSkills' ? (startFloors[index] || 0) : 0;

  const classify = (field, source) => {
    (character[field] || []).forEach((item, index) => {
      const ent = resolve(item, field);
      const t = ent?.type;
      const specialty = specialtyOf(field, index);
      const floor = floorOf(field, index);
      // A class power (classSkills/Class tier) belonging to one of the character's
      // classes → route to classPowers and suppress from the skills list.
      if (t === 'powers' && CLASS_POWER_TIERS.has(ent.tier)
          && (!ent.parentClass || classNames.has(ent.parentClass))) {
        classPowers.push({ name: item, field, index, source, cls: ent.parentClass || null, specialty, floor });
        flag(field, index);
        return;
      }
      if (t === 'perks') {
        perks.push({ name: item, field, index, source, cls: source === 'class' ? primary : null, specialty, floor });
        if (field !== 'purchasedPerks') flag(field, index);
        return;
      }
      // Genuine skill (or unresolved → treat as skill, its storage field).
      skills.push({ name: item, field, index, source, cls: source === 'class' ? primary : null, specialty, floor });
    });
  };

  // First class grants startingSkills for free; purchased ones cost BP.
  classify('startingSkills', 'class');
  classify('purchasedSkills', 'purchased');
  classify('purchasedPerks', 'purchased');
  // Class powers stored in their own field are class powers by definition — add
  // directly (no re-routing) so the Class Powers section is the union of the
  // dedicated field and any class powers misfiled into the skill lists above.
  (character.classPowers || []).forEach((item, index) => {
    const ent = lookupEntity(`powers:${cleanItemName(item)}`);
    classPowers.push({ name: item, field: 'classPowers', index, source: 'purchased', cls: ent?.parentClass || null });
  });

  // Innate powers are free class-granted powers.
  activeInnatePowers(character).forEach((ip) => {
    innatePowers.push({
      name: ip.name,
      field: 'innatePowers',
      index: ip.index !== undefined ? ip.index : -1,
      source: 'class',
      cls: ip.cls
    });
  });

  const mcGrants = multiclassGrants(character);
  // Multiclass-granted skills are free class features.
  for (const g of mcGrants.skills) {
    skills.push({ name: g.name, field: 'multiclassGrant', index: -1, source: 'class', grantedBy: g.source });
  }
  for (const g of mcGrants.freeBPItems) {
    skills.push({ name: g.skill, field: 'multiclassGrant', index: -1, source: 'class', grantedBy: g.source, refundedBP: g.bp });
  }

  // De-dupe by canonical name within each bucket: the same item can be listed in
  // more than one storage field (Socialite's Contact lands in both startingSkills
  // and purchasedPerks). Keep the FIRST occurrence, preferring a class grant over a
  // purchase so it renders free; flag the later copies as misfiled so they don't
  // render (or get bought) twice.
  const dedupe = (rows) => {
    const seen = new Set();
    const out = [];
    // Class-granted first so the free copy wins.
    for (const r of [...rows].sort((a, b) => (a.source === 'class' ? 0 : 1) - (b.source === 'class' ? 0 : 1))) {
      const baseName = bareSkill(cleanItemName(r.name));
      const baseKey = baseName.toLowerCase();
      const cleanName = cleanItemName(r.name).toLowerCase();
      const isInstance = UNLIMITED_SKILLS.has(baseName);

      if (isInstance) {
        const hasParam = cleanName.includes('(');
        if (hasParam) {
          if (seen.has(cleanName)) {
            if (r.index >= 0) flag(r.field, r.index);
            continue;
          }
          seen.add(cleanName);
        }
        out.push(r);
      } else {
        const key = r.refundedBP
          ? `${baseKey}:refund:${r.grantedBy || ''}`
          : baseKey;
        if (seen.has(key)) {
          if (r.index >= 0) flag(r.field, r.index);
          continue;
        }
        seen.add(key);
        out.push(r);
      }
    }
    return out;
  };
  return {
    skills: dedupe(skills), perks: dedupe(perks), classPowers: dedupe(classPowers),
    innatePowers: dedupe(innatePowers),
    misfiled,
  };
}

// ─── CRAFTING / RITUAL CAPABILITY ──────────────────────────────────────────
// What a character can MAKE, derived purely from the crafting/ritual skills they
// own. Crafting tiers nest (Greater requires Journeyman requires Apprentice — see
// REFS.prereqs), so the highest owned tier in a discipline unlocks that tier and
// every tier below it. Ritual Magic gates the ritual recipe list the same way.
const CRAFT_TIER_RANK = { Apprentice: 1, Journeyman: 2, Greater: 3 };
// Discipline name (as it appears on recipes) ⇐ the skill-name stem that grants it.
const CRAFT_DISCIPLINES = { Alchemy: 'Alchemy', Tinkering: 'Tinkering', Enchanting: 'Enchanting' };

// Every skill the character possesses (starting + purchased + granted), bare of
// any "(parameter)" suffix. Shared basis for capability checks.
export function ownedSkillNames(character) {
  const names = new Set([
    ...(character.startingSkills || []),
    ...(character.purchasedSkills || []),
  ].map(bareSkill));
  for (const g of grantedAbilities(character).list) {
    if (g.abilityType === 'skills') names.add(bareSkill(g.abilityName));
  }
  // Multiclass auto-granted skills count too.
  for (const s of multiclassGrants(character).skills) names.add(bareSkill(s.name));
  return names;
}

// Returns { crafting: [{ discipline, tier, count, recipes:[...] }], rituals:
// { tier, recipes:[...] }|null, any: bool }. `tier` is the HIGHEST unlocked
// (subsumes lower); recipes lists every makeable recipe at or below that tier.
export function craftingCapability(character) {
  const owned = ownedSkillNames(character);
  const topTier = (stem) => {
    let best = 0;
    for (const t of ['Apprentice', 'Journeyman', 'Greater']) {
      if (owned.has(`${t} ${stem}`)) best = Math.max(best, CRAFT_TIER_RANK[t]);
    }
    return best; // 0 = none
  };

  const crafting = [];
  for (const [discipline, stem] of Object.entries(CRAFT_DISCIPLINES)) {
    const rank = topTier(stem);
    if (!rank) continue;
    const tier = Object.keys(CRAFT_TIER_RANK).find((t) => CRAFT_TIER_RANK[t] === rank);
    const recipes = CRAFTING.filter((r) => r.discipline === discipline
      && CRAFT_TIER_RANK[r.tier] <= rank)
      .map((r) => ({ name: r.name, tier: r.tier }));
    crafting.push({ discipline, tier, count: recipes.length, recipes });
  }

  const ritualRank = topTier('Ritual Magic');
  let rituals = null;
  if (ritualRank) {
    const tier = Object.keys(CRAFT_TIER_RANK).find((t) => CRAFT_TIER_RANK[t] === ritualRank);
    const recipes = RITUALS.filter((r) => CRAFT_TIER_RANK[r.tier] <= ritualRank)
      .map((r) => ({ name: r.name, tier: r.tier }));
    rituals = { tier, count: recipes.length, recipes };
  }

  return { crafting, rituals, any: crafting.length > 0 || !!rituals };
}






// Base Build Points from the level table (9 at level 4). Below the table's floor
// the rule is "2 BP per level", so we extrapolate down (L3=7, L2=5, L1=3) rather
// than report 0 — even though such a character is flagged below-floor / invalid.
export function budgetFor(level, legalMinLevel = 4) {
  const row = LEVEL_TABLE.find((l) => l.level === level);
  if (row) return row.bp;
  const floor = LEVEL_TABLE.find((l) => l.level === legalMinLevel);
  if (floor && level < legalMinLevel) return Math.max(0, floor.bp - 2 * (legalMinLevel - level));
  return 0;
}

// Bonus BP allowance: a character may earn bonus Build Points up to a cap equal
// to their total character level (MegaDoc "Bonus BP" rule). It's optional/earned,
// so it's surfaced as headroom above the base budget rather than free spend — a
// build that exceeds base but stays within base+bonus is "legal with bonus BP".
export function bonusBudgetFor(level) {
  return level;
}

export function validate(character) {
  const level = characterLevel(character);
  const legalMinLevel = getLegalMinLevel(character);
  // Base budget plus DERIVED "free BP" (redundant multiclass grants award free BP
  // equal to the skill's cost). Derived from the classes, not a cached field, so
  // it's correct for any character (built, imported, or hand-edited).
  const mcGrants = multiclassGrants(character);
  const freeBP = mcGrants.freeBP;
  // "Approved backstories provide the character with 2 additional BP." Opt-in
  // (plot-team approval), so it's a flag on the character that lifts the base
  // budget by a fixed +2 rather than free spend.
  const backstoryBP = character.backstoryApproved ? BACKSTORY_BP : 0;
  const extraMaxBP = character.extraMaxBP || 0;
  const graph = resolveCharacterGraph(character);
  const spend = computeBP(graph, character);
  // Flaws AWARD BP: they raise the build budget rather than offsetting spend, so a
  // character with 5 flaw BP shows "spent of (base + 5)" — more headroom — instead
  // of looking like they spent 5 less. `spend.awarded` is already capped at
  // MAX_FLAW_BP, so the lift is capped too.
  const budget = budgetFor(level, legalMinLevel) + freeBP + backstoryBP + extraMaxBP + spend.awarded;
  const bonusBudget = bonusBudgetFor(level);
  const maxBudget = budget + bonusBudget;
  const slots = computeSlots(character);
  const spellSlotCounts = spellSlots(character);
  const bookcasterOptions = bookcasterSpellOptions(character);
  const stats = computeLevelStats(graph);
  const wealth = computeWealthState(graph, character.wealth);
  const devotion = devotionState(character);
  const lbp = lbpState(character);
  const granted = grantedAbilities(character);
  const crafting = craftingCapability(character);
  const owned = classifyOwnedItems(character);
  const powerBenefits = activePowerBenefits(character);
  const prereqs = checkPrereqs(character);
  const slotsOver = slots.some((s) => s.over);
  // BP used beyond the base allowance, drawn from the bonus pool (clamped ≥0).
  const bonusUsed = Math.max(0, spend.net - budget);
  // A build is over budget when spend exceeds the DISPLAYED cap — i.e. the base
  // budget (incl. free + backstory BP). "Bonus BP" is earned in play and saved,
  // not a creation-time allowance, so spending past the shown 9/9 is illegal even
  // if it's within base+bonus. (The rules say "Spend your BP, or save it for
  // later" — under-spend is fine; over-spend past the cap is not.)
  const overBudget = spend.net > budget;
  // Characters below the campaign's documented floor are buildable but
  // not legal play — flagged so the UI can mark them invalid with a reason.
  const belowFloor = level < legalMinLevel;
  // Total level above the current play cap (10). Not enforced — just flagged —
  // since the only path past 10 is Advanced Classes, which aren't published yet.
  const aboveCap = level > LEVEL_CAP;
  // Any class past its documented progression (base classes cap at 10; 11+ is
  // Advanced Classes, not yet published). Slots/stats are frozen at the top row.
  const beyondProgression = getClasses(character)
    .some((c) => CLASS_POWER_SLOTS[c.name] && c.level > maxProgressionLevel(c.name));
  return {
    level,
    budget,
    freeBP,
    backstoryBP,
    multiclassGrants: mcGrants,
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
    bookcasterOptions,
    stats,
    wealth,
    devotion,
    lbp,
    grantedAbilities: granted,
    crafting,
    owned,
    powerBenefits,
    prereqs,
    belowFloor,
    aboveCap,
    beyondProgression,
    legalMinLevel,
    levelCap: LEVEL_CAP,
    valid: !prereqs.issues.length && !overBudget && !slotsOver && !belowFloor
      && (!lbp || lbp.valid),
  };
}

export function validityReasons(report) {
  if (!report) return [];
  const out = [];
  if (report.belowFloor) out.push(`Below the level-${report.legalMinLevel} minimum`);
  if (report.aboveCap) out.push(`Above the level-${report.levelCap} cap (Advanced Classes pending)`);
  if (report.overBudget) out.push(`Over budget by ${report.spend.net - report.budget} BP`);
  for (const s of report.slots || []) {
    if (s.over) out.push(`${s.label}: ${s.used}/${s.allowed} (over by ${s.used - s.allowed})`);
  }
  for (const iss of report.prereqs?.issues || []) {
    if (iss.text && !iss.missing) { out.push(`${iss.item}: ${iss.text}`); continue; }
    const need = [
      ...(iss.missing || []).map((m) => m.name),
      ...(iss.anyOf || []).map((g) => g.map((m) => m.name).join(" or ")),
    ].join(", ");
    out.push(`${iss.item} needs: ${need}`);
  }
  const lbp = report.lbp;
  if (lbp) {
    if (lbp.overspent) out.push(`Lineage: ${lbp.spent - lbp.awarded} LBP overspent`);
    if (lbp.mixedSublineage) out.push("Lineage: items from more than one sublineage");
    if (lbp.needsSublineage) out.push(`Lineage: select the ${lbp.requiredSublineages.join("/")} sublineage to take its items`);
    if (lbp.missingRequired?.length) out.push(`Lineage: missing required ${lbp.missingRequired.map((c) => c.baseName).join(", ")}`);
  }
  for (const n of report.prereqs?.notes || []) {
    out.push(`Note (${n.item}): ${n.text}`);
  }
  return out;
}
