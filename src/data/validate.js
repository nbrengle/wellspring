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

import { LEVEL_TABLE, lookupEntity, REFS, CLASS_POWER_SLOTS, CLASS_POWERS, CLASS_PROGRESSION, SPELLCASTERS, DEVOTIONS, DOMAINS, CLASSES, LINEAGES, CRAFTING, RITUALS, EVENTS_TABLE, UNLIMITED_SKILLS, BASE_CLASSES } from './index.js';
import { startingSkillGrants } from './starting-choices.js';
import { cleanItemName, bareSkill, resolveId, idName, entityType } from './resolver.js';

// Shared primitives now live in validate/core.js (hotspot split). Import the ones
// this module still uses internally, and re-export the public surface from the
// barrel so existing imports (`from './data/validate.js'`) keep working unchanged.
import {
  MAX_LBP, MAX_FLAW_BP, BACKSTORY_BP, MAX_DOMAINS, DEFAULT_WEALTH,
  LEGAL_MIN_LEVEL, LEVEL_CAP, subKey,
  BP_FIELDS, BP_POWER_FIELDS, MARTIAL_SLOT_FIELDS, CASTER_SLOT_FIELDS,
  ENTITY_FIELDS, CLASS_POWER_TIERS, POWER_SOURCE_FIELDS,
  getClasses, primaryClass, characterLevel, getLegalMinLevel,
  parseTrailingRank, rankOf, getMaxRanks, requiredLevel,
  pickClass, countPicksForClass, maxProgressionLevel, progressionRow,
  activeInnatePowers, ownedGrantSources, grantedAbilities, grantIndex, derivedGrant,
} from './validate/core.js';
export {
  MAX_LBP, MAX_FLAW_BP, BACKSTORY_BP, MAX_DOMAINS, DEFAULT_WEALTH,
  LEGAL_MIN_LEVEL, LEVEL_CAP, subKey,
  getClasses, primaryClass, characterLevel, getLegalMinLevel,
  getMaxRanks, pickClass,
  activeInnatePowers, ownedGrantSources, grantedAbilities,
};
export { EVENTS_TABLE } from './validate/core.js';
import { lbpState } from './validate/lbp.js';
export { lbpState };

// Slot/spell-slot accounting (validate/slots.js) and prerequisite checking
// (validate/prereqs.js) — extracted leaves. Import the ones the orchestrator calls
// internally; re-export the public surface so the barrel keeps its API.
import { computeSlots, spellSlots, bookcasterSpellOptions } from './validate/slots.js';
export { computeSlots, spellSlots, bookcasterSpellOptions, innateBonusCantrips } from './validate/slots.js';
import { checkPrereqs } from './validate/prereqs.js';
export { checkPrereqs, prereqStatus, checkLevelConstraint } from './validate/prereqs.js';

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





// Normalization functions cleanItemName, resolveId, idName, and entityType are now imported from ./resolver.js





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






function effectiveCost(item, field, character, idx, granted) {
  // Parameterized skills carry a "(value)" the entity index doesn't ("Lore
  // (History)" → skills:Lore), so fall back to the bare name for the cost.
  const ent = lookupEntity(resolveId(item, field, character))
    || lookupEntity(`${entityType(field)}:${bareSkill(cleanItemName(item))}`);
  const base = typeof ent?.cost === 'number' ? ent.cost : 0;
  const grant = character.grants?.[field]?.[idx] || null;
  const authored = character.effectiveBP?.[field]?.[idx];
  const rank = rankOf(character, field, idx);

  // No authored sidecar grant — derive it from the grant index (the single
  // computation shared with grantedAbilities). An item the character gains free
  // from an owned source (e.g. Medium Armor from the Linked Armor power) zeroes
  // its cost without a hand-tagged sidecar.
  const derived = derivedGrant(item, field, ent, granted);
  if (derived && (typeof authored !== 'number' || authored > 0)) return { cost: 0, base, grant: derived, rank };

  // Trust the author's stated cost when present — it already reflects the full
  // rank. (Discounts are applied uniformly by applyDiscounts; authored costs that
  // pre-bake a discount are no longer special-cased — unlimited-ranks skills are
  // expanded into per-instance rows whose costs derive cleanly, so derived and
  // authored agree without a guard.)
  if (typeof authored === 'number') return { cost: authored, base, grant, rank, authored: true };

  // Tiered perks (Draconic Heritage) have NON-uniform per-tier costs — rank N is
  // the cumulative sum of the first N tiers, not base×N.
  if (Array.isArray(ent?.tiers) && ent.tiers.length) {
    const n = Math.min(rank, ent.tiers.length);
    const full = ent.tiers.slice(0, n).reduce((s, t) => s + (t.cost || 0), 0);
    if (grant?.kind === 'grant') return { cost: 0, base, grant, rank };
    return { cost: full, base, grant: grant || null, rank };
  }

  // Otherwise derive: entity cost × rank, then apply grant/discount.
  const full = base * rank;
  if (grant) {
    if (grant.kind === 'grant') return { cost: 0, base, grant, rank };
    if (grant.amount == null) return { cost: full, base, grant, rank };
    return { cost: Math.max(0, full - grant.amount), base, grant, rank };
  }
  return { cost: full, base, grant: null, rank };
}

// Active discount SOURCES the character owns (lineage advantages, perks). Each is
// a build-time REFS.discounts edge: { amount, scope, cap, min, refundIfFree,
// exclusions }. Returns the list with the owning source's name attached.
export function discountSources(character) {
  const D = REFS.discounts || {};
  const out = [];
  if (character?.lineage) {
    for (const name of (character.lineageAdvantages || [])) {
      const id = `advantages:${character.lineage} - ${cleanItemName(name)}`;
      if (D[id]) out.push({ id, name: cleanItemName(name), ...D[id] });
    }
  }
  for (const name of (character?.purchasedPerks || [])) {
    const id = `perks:${cleanItemName(name)}`;
    if (D[id]) out.push({ id, name: cleanItemName(name), ...D[id] });
  }
  for (const name of (character?.purchasedSkills || [])) {
    const id = `skills:${cleanItemName(name)}`;
    if (D[id]) out.push({ id, name: cleanItemName(name), ...D[id] });
  }
  for (const name of (character?.startingSkills || [])) {
    const id = `skills:${cleanItemName(name)}`;
    if (D[id]) out.push({ id, name: cleanItemName(name), ...D[id] });
  }
  // Level-gated discounts from innate class powers (Ritual Affinity: Journeyman
  // Ritual Magic −1 BP at class L7, Greater −1 BP at L12). The gate is the GRANTING
  // class's own level, so emit one source per (class the character has × that
  // power's levelDiscount whose atLevel is met) — like slotGrants/statMods. The id
  // is suffixed with the class so applyDiscounts' per-source cap keeps multiclass
  // tracks (Cleric vs Mage) independent.
  for (const ip of activeInnatePowers(character)) {
    if (ip.cls && ip.entity?.levelDiscounts) {
      const clsLevel = getClasses(character).find((c) => c.name === ip.cls)?.level || 0;
      for (const ld of (ip.entity.levelDiscounts || [])) {
        if (clsLevel >= ld.atLevel) {
          out.push({
            id: `powers:${ip.name}@${ip.cls}`, name: ip.name,
            amount: ld.amount, cap: null, min: 0, refundIfFree: true, exclusions: [],
            scope: { kind: 'namedSkill', value: ld.skill },
          });
        }
      }
    }
  }
  return out;
}

// Does a discount source's scope apply to this purchased item? `pos` is the
// item's 0-based index among items of its category (for firstN scopes).
function discountApplies(src, item, ent, pos) {
  if (src.exclusions?.includes(`${ent ? ent.id : ''}`) || src.exclusions?.includes(`perks:${cleanItemName(item)}`)) return false;
  const cat = ent?.category;
  if (src.scope.kind === 'category') {
    return Array.isArray(src.scope.value)
      && src.scope.value.some((c) => c.toLowerCase() === String(cat).toLowerCase());
  }
  if (src.scope.kind === 'firstN') {
    // Target named by skill prefix ("Lore"), limited to the first N purchased.
    return new RegExp(`^${src.scope.value}\\b`, 'i').test(cleanItemName(item))
      && (src.scope.n == null || pos < src.scope.n);
  }
  if (src.scope.kind === 'skillRanks') {
    // Every rank of one named skill is discounted (Sharp Mind → Lore). No limit.
    return new RegExp(`^${src.scope.value}\\b`, 'i').test(cleanItemName(item));
  }
  if (src.scope.kind === 'namedSkill') {
    // Exactly one specific skill (Ritual Affinity → "Journeyman Ritual Magic").
    // EXACT name match, not a prefix — a prefix on "Greater"/"Journeyman" would
    // leak to Greater Alchemy / other Journeyman skills.
    return bareSkill(cleanItemName(item)) === src.scope.value;
  }
  if (src.scope.kind === 'prereq') {
    // Item lists the source's named perk as a prerequisite (e.g. Patron Gifts).
    const pr = REFS.prereqs?.[ent?.id];
    const target = `perks:${src.scope.value}`;
    return !!pr && (pr.skills?.includes(target) || pr.other?.some((o) => new RegExp(src.scope.value, 'i').test(o)));
  }
  if (src.scope.kind === 'giftEligible') {
    // Patron: any PERK the player designates as a gift — i.e. any owned perk that
    // does NOT already carry the source's prerequisite (the actual Gifts list
    // Patron as a prereq and are EXCLUDED) and is not excluded. Greedy up to the
    // cap (handled by applyDiscounts). Only perks qualify, never skills.
    if (!ent || ent.id?.startsWith('skills:')) return false;
    if (ent.id === `perks:${src.scope.value}`) return false; // not the Patron perk itself
    // Perk prereqs live on the entity's own `prereq` field (REFS.prereqs is skills
    // only) — a perk that requires Patron IS a Gift, so it's not gift-ELIGIBLE.
    const prereqText = String(ent.prereq || ent.prerequisites || '');
    if (new RegExp(`\\b${src.scope.value}\\b`, 'i').test(prereqText)) return false;
    return true;
  }
  return false;
}

// Apply owned discount sources to the per-item costs in `byItem`. Mutates the
// cost down by `amount` (to `min`, default 0), tracks a per-source running cap,
// and — per the general rule — converts a discount on an already-free item into
// free BP rather than a negative cost. Returns { freeBP, applied } where applied
// is a list of { key, source, amount } for UI annotation.
function applyDiscounts(character, byItem) {
  const sources = discountSources(character);
  if (!sources.length) return { freeBP: 0, applied: [] };
  const used = new Map();        // sourceId → BP discounted so far (for caps)
  const catCount = new Map();    // category key → count seen (for firstN ordering)
  let freeBP = 0;
  const applied = [];
  for (const [key, eff] of Object.entries(byItem)) {
    if (eff.authored) continue;
    const parts = key.split(':');
    const field = parts[0];
    const item = parts.length === 3 ? parts[2] : parts[1];
    if (field !== 'purchasedSkills' && field !== 'purchasedPerks' && field !== 'startingSkills') continue;
    const ent = lookupEntity(resolveId(item, field, character)) || lookupEntity(`skills:${cleanItemName(item)}`);
    const catKey = ent?.category || cleanItemName(item).split(' ')[0];
    const pos = catCount.get(catKey) || 0;
    catCount.set(catKey, pos + 1);
    for (const src of sources) {
      if (!discountApplies(src, item, ent, pos)) continue;
      const min = src.min ?? 0;
      const room = src.cap == null ? Infinity : src.cap - (used.get(src.id) || 0);
      if (room <= 0) continue;
      const reducible = Math.max(0, eff.cost - min);
      const cut = Math.min(src.amount, reducible, room);
      if (cut <= 0) {
        // The "discount on something you already have → free BP" rule applies only
        // when the item is free because it was GRANTED (a redundant grant), not
        // when a normal purchase merely sits at the min cost. Requiring an actual
        // grant avoids refunding a paid-but-cheap skill twice (which broke the
        // export→import round-trip: a "- 1 BP" Lore re-read as cost-at-min).
        if (eff.cost === 0 && eff.grant?.kind === 'grant' && src.refundIfFree) {
          const refund = Math.min(src.amount, room);
          freeBP += refund;
          used.set(src.id, (used.get(src.id) || 0) + refund);
          applied.push({ key, source: src.name, amount: refund, asFreeBP: true });
        }
        continue;
      }
      eff.cost -= cut;
      eff.discount = { source: src.name, amount: cut };
      used.set(src.id, (used.get(src.id) || 0) + cut);
      applied.push({ key, source: src.name, amount: cut });
      break; // one discount source per item
    }
  }
  return { freeBP, applied };
}

// BP spent on purchased skills + perks, minus BP refunded by flaws. Honors the
// archetype grant model so power/class-granted items cost 0. byItem maps
// "field:item" → { cost, base, grant } so the UI can annotate each chip.
export function computeSpend(character) {
  let spent = 0;
  const byItem = {};
  // Grant index computed once, shared by every per-item cost lookup so the
  // free-grant zeroing and grantedAbilities() never diverge.
  const granted = grantIndex(character);
  for (const field of BP_FIELDS) {
    (character[field] || []).forEach((item, idx) => {
      const eff = effectiveCost(item, field, character, idx, granted);
      byItem[`${field}:${item}`] = eff;
      spent += eff.cost;
    });
  }
  // BP-bought powers. Class Powers, Domain Powers, and Form Powers are always
  // evaluated for cost via effectiveCost.
  for (const field of BP_POWER_FIELDS) {
    (character[field] || []).forEach((item, idx) => {
      const eff = effectiveCost(item, field, character, idx, granted);
      byItem[`${field}:${item}`] = eff;
      spent += eff.cost;
    });
  }
  // Refunds attached to STARTING (free) skills. A starting skill costs no BP
  // itself, but its grant may refund BP into the pool — e.g. Artificer's
  // "Apprentice Tinkering (-3 BP refunded from Forgesource Specialist)". The
  // skill stays free; the refund reduces total spend. (Discounts on starting
  // skills are refunds; grants on them are just "free" and add nothing.)
  // Free granted rank floor per starting-skill index — DERIVED from the class
  // config + chosen options, so it survives import / round-trip (not a persisted
  // sidecar). A finite multi-rank starting skill (e.g. the Mage specialty's
  // "Extended Capacity - Novice x2", max 4) is free up to its floor; ranks bought
  // ABOVE the floor cost BP at the entity's per-rank price. Keyed by index here so
  // two same-named rows can't collide (the byItem map is keyed by name, so we sum
  // excess into `spent` directly rather than re-reading byItem by name later).
  const startFloors = startingSkillGrants(character).floor;
  let refunded = 0;
  let startingExcess = 0;
  (character.startingSkills || []).forEach((item, idx) => {
    const grant = character.grants?.startingSkills?.[idx];
    if (grant?.kind === 'discount' && grant.amount) {
      byItem[`startingSkills:${idx}:${item}`] = { cost: -grant.amount, base: 0, grant };
      refunded += grant.amount;
      return;
    }
    const floor = startFloors[idx];
    const total = rankOf(character, 'startingSkills', idx);
    const ent = lookupEntity(resolveId(item, 'startingSkills', character))
      || lookupEntity(`skills:${bareSkill(cleanItemName(item))}`);
    const base = typeof ent?.cost === 'number' ? ent.cost : 0;
    if (floor && total > floor) {
      const extra = total - floor;
      const cost = base * extra;
      byItem[`startingSkills:${idx}:${item}`] = {
        cost, base, grant: null, rank: total, freeRanks: floor, paidRanks: extra,
      };
      startingExcess += cost;
    } else {
      byItem[`startingSkills:${idx}:${item}`] = {
        cost: 0, base, grant: null, rank: total, freeRanks: floor || 1, paidRanks: 0,
      };
    }
  });

  // Flaws award BP, but the rules cap the total awarded at MAX_FLAW_BP ("up to 5
  // awarded BP"). Sum each flaw's value for the per-item chips, then clamp the
  // total that actually offsets spend (extra flaws give roleplay, not more BP).
  let rawAwarded = 0;
  for (const item of character.flaws || []) {
    const ent = lookupEntity(`flaws:${item}`);
    let bp = 0;
    if (ent) {
      if (ent.baseName === "Mild Allergy" || ent.baseName === "Severe Allergy") {
        const common = ["cloth", "iron", "leather", "materia", "other common allergen"];
        const isCommon = common.includes(String(ent.parameter || "").toLowerCase().trim());
        bp = ent.baseName === "Mild Allergy" ? (isCommon ? 2 : 1) : (isCommon ? 3 : 2);
      } else {
        bp = typeof ent.bp === 'number' ? ent.bp : parseInt(String(ent.bp), 10) || 0;
      }
    }
    byItem[`flaws:${item}`] = { cost: -bp, base: -bp, grant: null };
    rawAwarded += bp;
  }
  const awarded = Math.min(rawAwarded, MAX_FLAW_BP);

  // Discount sources (Patron, Technarchist, etc.) reduce matching item costs in
  // place; a discount on an already-free item becomes free BP instead. Recompute
  // `spent` from the adjusted costs so totals reflect the discounts.
  const { freeBP: discountFreeBP, applied: discountsApplied } = applyDiscounts(character, byItem);
  spent = startingExcess;  // paid ranks above a starting skill's free floor (see above)
  for (const field of [...BP_FIELDS, ...BP_POWER_FIELDS]) {
    (character[field] || []).forEach((item) => {
      const eff = byItem[`${field}:${item}`];
      if (eff && eff.cost > 0) spent += eff.cost;
    });
  }

  return {
    spent, awarded, rawAwarded, flawCapped: rawAwarded > MAX_FLAW_BP,
    refunded, discountFreeBP, discountsApplied,
    net: spent - awarded - refunded - discountFreeBP, byItem,
  };
}

// Bonus slots granted by purchased skills (e.g. "Additional Cantrip",
// "Extended Capacity - Novice"). Derived data-driven from each owned skill's
// description rather than a hardcoded list: a phrase like "one additional
// Cantrip" or "additional Novice spell-slot" adds to the matching category cap.




// Per-game/per-event Wealth income from owned perks/skills/powers, on top of the
// starting Wealth. Several Socialite features and the Income/Manse/Profession
// perks grant recurring Wealth; the Wealth strip otherwise ignored them (#7).
// Recurring-income phrasings are scanned data-driven:
//   "<N> Wealth at the beginning of (every|each) game"   (Income, Profession)
//   "gains <N> Wealth per Event"                          (Pit Master)
//   Manse: "Alternatively, <N> Wealth"                    (the cash option)
//   Tax Evasion: "+3 Wealth per rank of Profession, +2 each for Manse & Income"
// One-time / spend amounts (Inheritance's lump sum, bounty costs) are NOT income
// and are skipped. Returns { base, income, total, sources:[{name,n,note}] }.
// The display note for a parser-extracted wealthIncome { n, kind }. Income amounts
// and their classification are extracted in the parser (entity.wealthIncome); this
// just maps the kind to the UI label the wealth panel already shows.
const WEALTH_NOTE = { manse: 'or resources', firstEvent: 'one-time, first event', recurring: undefined };
const wealthFrom = (ent) => {
  const w = ent?.wealthIncome;
  return w ? { n: w.n, note: WEALTH_NOTE[w.kind] } : null;
};

export function wealthState(character) {
  const base = character.wealth != null && character.wealth !== ''
    ? (parseInt(String(character.wealth), 10) || DEFAULT_WEALTH)
    : DEFAULT_WEALTH;
  const sources = [];
  let income = 0;
  const add = (name, n, note) => { if (n > 0) { income += n; sources.push({ name, n, note }); } };

  // Owned skills (Profession ranks) + perks (Income, Manse).
  const owned = classifyOwnedItems(character);
  const ownedPerkNames = new Set();
  for (const r of [...owned.skills, ...owned.perks]) {
    const ent = lookupEntity(`${entityType(r.field) === 'perks' ? 'perks' : 'skills'}:${bareSkill(cleanItemName(r.name))}`)
      || lookupEntity(`perks:${cleanItemName(r.name)}`) || lookupEntity(`skills:${cleanItemName(r.name)}`);
    if (ent?.type === 'perks') ownedPerkNames.add(ent.name);
    const w = wealthFrom(ent);
    if (w) add(ent?.name || r.name, w.n, w.note);
  }
  // Owned/selected powers (Pit Master, etc.) + innate at level.
  const ownedPowerNames = new Set();
  for (const ip of activeInnatePowers(character)) {
    ownedPowerNames.add(ip.name);
    const w = wealthFrom(ip.entity); if (w) add(ip.name, w.n, w.note);
  }
  for (const field of POWER_SOURCE_FIELDS) {
    for (const item of (character[field] || [])) {
      const ent = lookupEntity(`powers:${cleanItemName(item)}`);
      if (!ent) continue;
      ownedPowerNames.add(ent.name);
      const w = wealthFrom(ent); if (w) add(ent.name, w.n, w.note);
    }
  }

  // Tax Evasion (Socialite): "+3 Wealth for every rank of Profession, +2 each for
  // Manse and Income". Computed from what the character actually owns.
  if (ownedPowerNames.has('Tax Evasion')) {
    const profRanks = [...owned.skills, ...owned.perks]
      .filter((r) => /^Profession\b/i.test(cleanItemName(r.name))).length;
    let bonus = profRanks * 3;
    if (ownedPerkNames.has('Manse')) bonus += 2;
    if (ownedPerkNames.has('Income')) bonus += 2;
    if (bonus > 0) add('Tax Evasion', bonus, 'from Profession/Manse/Income');
  }

  return { base, income, total: base + income, sources };
}

// Level-scaled stats. Archetype LP/spikes are authored at the starter level (4)
// and already include class/lineage bonuses, so we keep that base and apply the
// LEVEL-TABLE DELTA between level 4 and the character's current level. Returns
// { lifePoints, spikes } as display strings/numbers, falling back to the stored
// values when no numeric base is available.
const BASE_LEVEL = 4;
// Numeric character-creation stat modifiers from owned powers / perks / lineage
// advantages / class-progression bonuses. The prose interpretation is done ONCE,
// in the parser (extractStatMods), which emits entity.statMods = [{stat, n}] and
// progression[lvl].statMods. This function only WALKS what the character owns and
// SUMS those structured fields — no description parsing. Returns
// { lifePoints, spikes, naturalArmor, armor, sources: [{name, stat, n}], notes }.
export function statMods(character) {
  const mods = { lifePoints: 0, spikes: 0, naturalArmor: 0, armor: 0 };
  const sources = [];
  const notes = [];   // contextual/variable boosts with no fixed number (display only)

  // Apply an entity's parsed statMods (and variable-amount notes) to the rail.
  const apply = (name, ent) => {
    if (!ent) return;
    for (const { stat, n } of (ent.statMods || [])) {
      if (n > 0) { mods[stat] += n; sources.push({ name, stat, n }); }
    }
    for (const note of (ent.statModNotes || [])) notes.push({ name, ...note });
  };

  // Owned perks.
  for (const item of (character.purchasedPerks || [])) {
    const e = lookupEntity(`perks:${cleanItemName(item)}`); apply(e?.name || item, e);
  }
  // Chosen lineage advantages (indexed as advantages:<Lineage> - <name>).
  if (character.lineage) {
    const lin = LINEAGES[character.lineage];
    for (const name of (character.lineageAdvantages || [])) {
      const a = (lin?.advantages || []).find((x) => x.name === name || x.baseName === name);
      apply(a?.baseName || a?.name || name, a);
    }
  }
  // Innate class powers held at level, then selected/slotted powers.
  for (const ip of activeInnatePowers(character)) {
    if (ip.entity) apply(ip.name, ip.entity);
  }
  for (const field of POWER_SOURCE_FIELDS) {
    for (const item of (character[field] || [])) {
      apply(cleanItemName(item), lookupEntity(`powers:${cleanItemName(item)}`));
    }
  }
  // Per-class progression bonuses, level-gated: apply each row's parsed statMods up
  // to the class's current level. (The level-table LP is the CLASSLESS baseline;
  // these class bonuses stack on top — see levelStats.)
  for (const { name: cls, level: clsLevel } of getClasses(character)) {
    const prog = CLASS_PROGRESSION[cls] || {};
    for (let lvl = 1; lvl <= clsLevel; lvl++) {
      apply(`${cls} L${lvl}`, prog[lvl]);
    }
  }
  // Owned class skills + purchased/starting skills (Healthy, Daggercraft, …).
  for (const field of ['classSkills', 'purchasedSkills', 'startingSkills']) {
    for (const item of (character[field] || [])) {
      const e = lookupEntity(`skills:${cleanItemName(item)}`)
        || lookupEntity(`powers:${cleanItemName(item)}`)
        || lookupEntity(resolveId(item, field, character));
      apply(e?.name || cleanItemName(item), e);
    }
  }
  return { ...mods, sources, notes };
}

// Base character stats. Life Points and Spikes come from the level table for the
// character's total level — the CLASSLESS rules baseline ("starting level 4
// characters will have 3 LP"). Per-class progression bonuses (Fighter L2 / Cleric
// L7 "+1 Base Maximum Life Points") and skill/perk/lineage boosts are layered on
// top via statMods, NOT baked into the base — so the displayed total updates as
// the character levels and buys those abilities. (Authored archetype sheets store
// a final LP that already equals base+bonuses; we recompute from the rules rather
// than trust the stored number, which keeps blank builds and archetypes
// consistent. The 14 shipped archetypes all reproduce their authored LP this way.)
// Returns { lifePoints, spikes, baseLifePoints, baseSpikes, mods } so the UI can
// show the total and explain it.
function levelStats(character) {
  const level = characterLevel(character);
  const minRow = LEVEL_TABLE[0];
  const maxRow = LEVEL_TABLE[LEVEL_TABLE.length - 1];
  // Clamp to the documented range: below L4 use the L4 baseline (LP barely scales
  // and the table starts at 4); above the table, hold the top row.
  const row = LEVEL_TABLE.find((r) => r.level === level)
    || (level < minRow.level ? minRow : maxRow);

  const baseLp = row.lp ?? 0;
  const baseSp = row.spikes ?? 0;

  const mods = statMods(character);
  return {
    baseLifePoints: baseLp, baseSpikes: baseSp,
    lifePoints: baseLp + (mods.lifePoints || 0),
    spikes: baseSp + (mods.spikes || 0),
    armor: mods.armor || 0,
    naturalArmor: mods.naturalArmor || 0,
    mods,
  };
}


// One-shot report combining both currencies + prereqs. BP has two thresholds:
// the base budget (9 at lvl 4) and base+bonus (bonus cap = character level).
// Spending past base but within base+bonus is legal-with-bonus (not over); past
// base+bonus is a hard overage.
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
  const budget = budgetFor(level, legalMinLevel) + freeBP + backstoryBP + extraMaxBP;
  const bonusBudget = bonusBudgetFor(level);
  const maxBudget = budget + bonusBudget;
  const spend = computeSpend(character);
  const slots = computeSlots(character);
  const spellSlotCounts = spellSlots(character);
  const bookcasterOptions = bookcasterSpellOptions(character);
  const stats = levelStats(character);
  const wealth = wealthState(character);
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
