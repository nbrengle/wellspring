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

import { LEVEL_TABLE, lookupEntity, REFS, CLASS_POWER_SLOTS, CLASS_POWERS, CLASS_PROGRESSION, SPELLCASTERS, DEVOTIONS, DOMAINS, CLASSES, LINEAGES, CRAFTING, RITUALS, EVENTS_TABLE, UNLIMITED_SKILLS } from './index.js';
import { startingSkillGrants } from './starting-choices.js';

// Max Lineage Build Points a character can be awarded from challenges (MegaDoc:
// "up to 10 awarded LBP").
export const MAX_LBP = 10;

// Max BP a character can be awarded from flaws (MegaDoc: "up to 5 awarded BP").
export const MAX_FLAW_BP = 5;

// BP granted for a plot-team-approved backstory (MegaDoc: "Approved backstories
// provide the character with 2 additional BP").
export const BACKSTORY_BP = 2;

// Normalize a sublineage label to its base name. The data is inconsistent: a
// sublineage may appear as "Accented (Any Accent…)" on a challenge but just
// "Accented" on an advantage. Compare on the part before " (" so the same
// sublineage matches across challenges, advantages, and the sublineage list.
export const subKey = (s) => String(s || '').split(' (')[0].trim().toLowerCase();

// Lineage Build Point economy — a separate currency from BP. Challenges AWARD LBP
// (capped at MAX_LBP); advantages SPEND it. Challenges/advantages are scoped to
// "General" or a single sublineage (you can't mix sublineages). Returns null when
// no lineage is set, else the full state for the UI + validity.
export function lbpState(character) {
  const lin = character?.lineage && LINEAGES[character.lineage];
  if (!lin) return null;
  const chosenC = character.lineageChallenges || [];
  const chosenA = character.lineageAdvantages || [];
  // Match a chosen item-name back to its lineage entry (names may carry [Repped]
  // / sublineage tags; compare on the display name the data exposes).
  const findIn = (list, name) => list.find((x) => x.name === name || x.baseName === name);

  const challenges = chosenC.map((n) => findIn(lin.challenges, n)).filter(Boolean);
  const advantages = chosenA.map((n) => findIn(lin.advantages, n)).filter(Boolean);

  // Perks that modify the LBP economy (Strong Bloodline: +3 LBP, cap 10→13). Sum
  // any the character owns; the highest stated newMax raises the challenge cap.
  const lbpB = REFS.lbpBonuses || {};
  let bonusLbp = 0, cap = MAX_LBP;
  for (const name of (character.purchasedPerks || [])) {
    const b = lbpB[`perks:${cleanItemName(name)}`];
    if (b) { bonusLbp += b.extra || 0; if (b.newMax) cap = Math.max(cap, b.newMax); }
  }

  const rawAwarded = challenges.reduce((s, c) => s + (c.lbp || 0), 0);
  // Challenge LBP is capped; the perk bonus is granted on top of the cap.
  const awarded = Math.min(rawAwarded, cap) + bonusLbp;
  const spent = advantages.reduce((s, a) => s + (a.lbp || 0), 0);

  // Sublineage scoping: all chosen non-"General" items must share ONE sublineage
  // (normalized, since the data tags it inconsistently), and — when the character
  // has picked a sublineage — must match that one. REQUIRED challenges are
  // mandatory baseline costume regardless of sublineage choice, so they're
  // excluded from the commitment check below (some lineages tag a required
  // challenge to a default presentation).
  const subs = new Set([...challenges, ...advantages]
    .map((x) => subKey(x.sublineage)).filter((s) => s && s !== 'general'));
  const optionalSubs = new Set([...challenges, ...advantages]
    .filter((x) => !x.required)
    .map((x) => subKey(x.sublineage)).filter((s) => s && s !== 'general'));
  const pickedSub = character.sublineage ? subKey(character.sublineage) : null;
  const mixedSublineage = subs.size > 1
    || (pickedSub && [...subs].some((s) => s !== pickedSub));

  // A sublineage is a COMMITMENT: any OPTIONAL chosen item tagged to a sublineage
  // (e.g. a Psionic challenge, which represents being psionic) requires that the
  // character has actually SELECTED that sublineage. Without this, a Human could
  // take Psionic challenges (their downside) for LBP without committing to Psionic
  // at all (#2). Flags sublineages owned-but-not-selected.
  const needsSublineage = !pickedSub && optionalSubs.size > 0;
  const requiredSublineages = needsSublineage ? [...optionalSubs] : [];

  // Required challenges the character hasn't taken (some lineages mandate them).
  // A required challenge belonging to a specific sublineage is only required if
  // that sublineage is selected.
  const missingRequired = lin.challenges
    .filter((c) => {
      if (!c.required) return false;
      const cSub = subKey(c.sublineage);
      if (cSub && cSub !== 'general' && cSub !== pickedSub) return false;
      return !challenges.some((x) => x.baseName === c.baseName);
    });

  return {
    lineage: character.lineage,
    sublineage: character.sublineage || null,
    sublineages: lin.sublineages || [],
    challenges: lin.challenges,
    advantages: lin.advantages,
    chosenChallenges: challenges,
    chosenAdvantages: advantages,
    awarded, rawAwarded, cap, bonusLbp, capped: rawAwarded > cap,
    spent, remaining: awarded - spent,
    overspent: spent > awarded,
    mixedSublineage,
    needsSublineage,
    requiredSublineages,
    missingRequired,
    valid: spent <= awarded && !mixedSublineage && !needsSublineage && !missingRequired.length,
  };
}

// Wellspring has three distinct "consequence" kinds, kept separate by design:
//   1. GRANT-OF-ENTITY — a source gives you a named Perk/Power/Skill for free
//      ("gains the Magical Resilience Perk"). Edge: REFS.grants/grantedBy. ↓ here.
//   2. GRANT-OF-SLOT    — a source gives you an extra slot/pool ("+1 Novice
//      spell-slot"). Handled by scanSlotGrant/slotGrants, not here.
//   3. DISCOUNT         — a source makes other purchases cheaper (Patron, etc.).
//      Edge: REFS.discounts. Handled by discountSources/applyDiscounts.
// (We use one word — "grant" — for #1; an earlier draft called it "bestowal".)

// Grant/discount SOURCES the character owns: lineage advantages, purchased perks,
// and class innate powers held at level. Shared by the grant (#1) and discount
// (#3) paths so "what does the character own that can grant/discount" has one
// definition. Returns [{ id, name, kind }].
export function ownedGrantSources(character) {
  const sources = [];
  // Lineage advantages: registry id is "advantages:<Lineage> - <baseName>".
  if (character?.lineage) {
    for (const name of (character.lineageAdvantages || [])) {
      const base = cleanItemName(name);
      sources.push({ id: `advantages:${character.lineage} - ${base}`, name: base, kind: 'advantage' });
    }
  }
  // Owned perks (purchased or class-granted).
  for (const name of (character?.purchasedPerks || [])) {
    const base = cleanItemName(name);
    sources.push({ id: `perks:${base}`, name: base, kind: 'perk' });
  }
  // Class innate powers the character has at level (automatic features).
  for (const { name: cls, level } of getClasses(character)) {
    for (const p of (CLASS_POWERS[cls]?.innate || [])) {
      if (level >= requiredLevel(p)) {
        sources.push({ id: `powers:${p.name}`, name: p.name, kind: 'feature' });
      }
    }
  }
  // Powers the character has actually selected into slots (any tier) — a chosen
  // power can itself grant an ability (e.g. Implicit Truths → Insight).
  const seen = new Set(sources.map((s) => s.id));
  for (const field of POWER_SOURCE_FIELDS) {
    for (const item of (character[field] || [])) {
      const id = `powers:${cleanItemName(item)}`;
      if (!seen.has(id)) { seen.add(id); sources.push({ id, name: cleanItemName(item), kind: 'power' }); }
    }
  }
  return sources;
}
// Power fields a character fills by choice — any of these can be a grant source.
const POWER_SOURCE_FIELDS = [
  'innatePowers', 'utilityPowers', 'basicPowers', 'advancedPowers',
  'veteranPowers', 'classPowers', 'rightHandPowers', 'domainPowers', 'formPowers',
  'cantrips', 'noviceSpells', 'adeptSpells', 'greaterSpells', 'bookSpells',
];

// Named abilities the character GAINS FOR FREE from a source they own — a lineage
// advantage, perk, or selected power whose text says "gains the X Perk/Power/Skill"
// (grant-of-entity, kind #1). The source→target edges are computed at build time
// (REFS.grants); this walks the owned grant-sources and collects what each gives.
// A granted ability is FREE (part of the source already paid for), so never adds
// BP. Returns { list, bySource }; list is [{ ability, abilityName, abilityType,
// source, sourceId, sourceKind }], bySource groups list by sourceId.
export function grantedAbilities(character) {
  const grants = REFS.grants || {};
  // Only sources that actually grant something (have a grants edge).
  const sources = ownedGrantSources(character).filter((s) => grants[s.id]);

  const list = [];
  const bySource = {};
  for (const src of sources) {
    const ent = lookupEntity(src.id);
    if (ent?.chooseOne?.kind === 'build') continue;
    const targets = grants[src.id];
    if (!targets) continue;
    for (const ability of targets) {
      const ent = lookupEntity(ability);
      const row = {
        ability,
        abilityName: ent?.name || idName(ability),
        abilityType: ability.slice(0, ability.indexOf(':')),
        source: src.name,
        sourceId: src.id,
        sourceKind: src.kind,
      };
      list.push(row);
      (bySource[src.id] = bySource[src.id] || { source: src.name, sourceKind: src.kind, abilities: [] })
        .abilities.push(row);
    }
  }

  // Choice-driven grants: a build-time choose-one power (Expert Craft) grants the
  // skill the player SELECTED for free. The choice is recorded on the character;
  // resolve it to the same grant shape so it zeroes the skill's cost like any grant.
  const push = (ability, src) => {
    const ent = lookupEntity(ability);
    const row = { ability, abilityName: ent?.name || idName(ability),
      abilityType: ability.slice(0, ability.indexOf(':')), source: src, sourceId: `powers:${src}`, sourceKind: 'choice' };
    list.push(row);
    (bySource[row.sourceId] = bySource[row.sourceId] || { source: src, sourceKind: 'choice', abilities: [] }).abilities.push(row);
  };
  for (const field of POWER_SOURCE_FIELDS) {
    for (const item of (character[field] || [])) {
      const ent = lookupEntity(`powers:${cleanItemName(item)}`);
      if (ent?.chooseOne?.kind !== 'build') continue;
      const chosen = character.choices?.[`powers:${ent.name}`];
      const opt = ent.chooseOne.options.find((o) => o.grantsSkill === chosen || o.text === chosen);
      if (opt?.grantsSkill) push(`skills:${opt.grantsSkill}`, ent.name);
    }
  }
  return { list, bySource };
}

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

// Max divine domains a worshipper may access (per the Worship skill: "up to two").
export const MAX_DOMAINS = 2;

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

// Character fields whose items cost BP. Starting skills are class-granted and
// free; only purchased skills/perks spend BP.
const BP_FIELDS = ['purchasedSkills', 'purchasedPerks'];

// Power fields that hold BP-bought powers (domain powers, class-skill powers, and
// form powers). Powers listed in these fields are evaluated for BP cost.
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

// Character sheet item names carry a display suffix like " - 5 BP" that isn't part of
// the canonical entity name. Strip it so name-based lookups resolve.
export function cleanItemName(item) {
  return item.replace(/\s*-\s*\d+\s*BP$/i, '').trim();
}

// Resolve a character item to its canonical entity id (type:cleanName).
function resolveId(item, field, character) {
  return `${entityType(field)}:${cleanItemName(item)}`;
}

export const idName = (id) => id.slice(id.indexOf(':') + 1);

// Normalize a character's class/level info into [{ name, level }], the canonical
// multi-class form. Accepts either the new `classes` array or the legacy
// `classLevels` string ("Fighter 4", or "Fighter 2 / Rogue 2"). This is the one
// place that understands both shapes; everything else reads through it.
export function getClasses(character) {
  if (Array.isArray(character?.classes) && character.classes.length) {
    return character.classes
      .filter((c) => c && c.name)
      .map((c) => ({ name: c.name, level: c.level || 0 }));
  }
  const str = character?.classLevels;
  if (typeof str === 'string' && str.trim()) {
    return str.split('/').map((part) => {
      const m = part.trim().match(/^(.+?)\s+(\d+)$/);
      return m ? { name: m[1].trim(), level: parseInt(m[2], 10) } : null;
    }).filter(Boolean);
  }
  return [];
}

// The character's PRIMARY (first) class — used for spell-slot tier shape and as
// the default context where a single class is assumed.
export function primaryClass(character) {
  return getClasses(character)[0]?.name || null;
}

// Strip a trailing "(parameter)" from a skill name for ownership comparison.
export const bareSkill = (s) => String(s).replace(/\s*\([^)]*\)\s*$/, '').trim();

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

// ─── OWNED-ITEM CLASSIFICATION ─────────────────────────────────────────────
// The sheet's lists conflate kinds: an archetype's `startingSkills` may contain a
// PERK (Socialite's Contact), and `purchasedSkills` may contain CLASS POWERS
// (Socialite's "The Right Hand", a classSkills-tier power). Rendering by the list
// an item sits in then mis-shows it (a perk as a skill) and double-counts it (a
// class power that's also buyable in Class Powers). This resolves each item to
// its TRUE entity type and routes it to the right bucket, so the UI renders by
// kind, not by storage field. Provenance ("granted by class" vs "purchased") is
// tracked for badges. Returns:
//   { skills:[{name,field,index,source}], perks:[…], classPowers:[…],
//     misfiled:{ field → Set(index) } }   // indices to suppress from raw rendering
//
// `source`: 'class' for first-class startingSkills + multiclass grants (free),
// 'purchased' otherwise. classPowers carry their owning class in `cls`.
const CLASS_POWER_TIERS = new Set(['Class', 'classSkills']);

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
  (character.innatePowers || []).forEach((item, index) => {
    const ent = lookupEntity(`powers:${cleanItemName(item)}`);
    innatePowers.push({ name: item, field: 'innatePowers', index, source: 'class', cls: ent?.parentClass || null });
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

// Total Character Level = sum of all class levels (per the rules, BP and stats
// scale with total level even when multiclassing). Defaults to 4 (starter level)
// when no class info is present.
export function characterLevel(character) {
  const classes = getClasses(character);
  if (!classes.length) return 4;
  return classes.reduce((sum, c) => sum + (c.level || 0), 0);
}

export { EVENTS_TABLE };

export function getLegalMinLevel(character) {
  const evtNum = character?.currentEvent || 1;
  const evt = EVENTS_TABLE.find(e => e.event === evtNum);
  return evt ? evt.level : 4;
}

// The lowest level the level table documents — the legal campaign floor (4).
export const LEGAL_MIN_LEVEL = LEVEL_TABLE.length
  ? Math.min(...LEVEL_TABLE.map((l) => l.level)) : 4;

// Current total-level cap (10). The only path past 10 is Advanced Classes, which
// aren't published yet. Not enforced by the builder — only flagged.
export const LEVEL_CAP = 10;

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
const ROMAN_MAP = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15
};
function parseTrailingRank(name) {
  if (!name) return 1;
  const clean = String(name).trim();
  const xMatch = clean.match(/\s+x\s*(\d+)$/i);
  if (xMatch) return parseInt(xMatch[1], 10);
  const digitMatch = clean.match(/\s+(\d+)$/);
  if (digitMatch) return parseInt(digitMatch[1], 10);
  const romanMatch = clean.match(/\s+([IVXLCDM]+)$/i);
  if (romanMatch) {
    const val = ROMAN_MAP[romanMatch[1].toLowerCase()];
    if (val) return val;
  }
  return 1;
}

// Rank (purchase count) of an item, default 1. "Foo x2" → 2.
function rankOf(character, field, idx) {
  const item = character[field]?.[idx];
  if (!item) return 1;
  const baseRank = character.ranks?.[field]?.[idx];
  if (baseRank > 1) return baseRank;

  const parsed = parseTrailingRank(item);
  if (parsed > 1) {
    const ent = lookupEntity(resolveId(item, field, character))
      || lookupEntity(`${entityType(field)}:${bareSkill(cleanItemName(item))}`);
    if (ent && ent.name) {
      const canonicalParsed = parseTrailingRank(ent.name);
      if (canonicalParsed === parsed) {
        return 1;
      }
    }
    return parsed;
  }
  return baseRank !== undefined ? baseRank : 1;
}

// Get the maximum ranks of an entity dynamically by querying the database/entity index.
export function getMaxRanks(name, field, character) {
  const type = entityType(field);
  const cleanName = cleanItemName(name);
  const ent = lookupEntity(resolveId(name, field, character))
    || lookupEntity(`${type}:${cleanName}`)
    || lookupEntity(`${type}:${bareSkill(cleanName)}`);
  if (!ent) return 1;
  const maxR = ent.maxRanks ?? ent.ranks;
  if (maxR === 'unlimited') return Infinity;
  if (typeof maxR === 'number') return maxR;
  if (typeof maxR === 'string') {
    const val = parseInt(maxR, 10);
    if (!isNaN(val)) return val;
  }
  return 1;
}

// Index the character's granted abilities by target entity id → granting source
// name. This is the SAME computation as grantedAbilities() (the single source of
// truth for "what does this character gain free"); cost-zeroing consumes this
// index rather than re-joining the grant graph, so the two can't drift.
function grantIndex(character) {
  const idx = {};
  for (const g of grantedAbilities(character).list) {
    if (!(g.ability in idx)) idx[g.ability] = g.source;
  }
  return idx;
}

// Is this item granted-free by a source the character owns? Looks the item up in
// the precomputed grant index (derived once from grantedAbilities). Returns a
// grant note {kind,source} for the badge, or null. `ent` may be undefined.
function derivedGrant(item, field, ent, granted) {
  const itemId = ent?.id || `${entityType(field)}:${bareSkill(cleanItemName(item))}`;
  const source = granted?.[itemId];
  return source ? { kind: 'grant', amount: null, source, derived: true } : null;
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
  // No authored sidecar grant — derive it from the grant index (the single
  // computation shared with grantedAbilities). An item the character gains free
  // from an owned source (e.g. Medium Armor from the Linked Armor power) zeroes
  // its cost without a hand-tagged sidecar.
  const derived = derivedGrant(item, field, ent, granted);
  if (derived) return { cost: 0, base, grant: derived, rank };
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

// Bonus slots, keyed PER CLASS as "class:category" → count. Class features
// attribute to their own class; skill grants attribute to a relevant class (the
// caster class for cantrip/spell grants, the martial class for power grants), so
// the bonus lands on the correct per-class slot row.
function slotGrants(character) {
  const grants = {};
  const addTo = (cls, cat, n) => {
    if (!cls) return;
    const k = `${cls}:${cat}`;
    grants[k] = (grants[k] || 0) + n;
  };
  const classes = getClasses(character);
  const casterClass = classes.find((c) => SPELLCASTERS.has(c.name))?.name;
  const martialClass = classes.find((c) => !SPELLCASTERS.has(c.name))?.name;
  // Route a category to the class whose slot it belongs to.
  const classFor = (cat) => (cat === 'cantrips' || cat === 'spellsKnown') ? casterClass : martialClass;

  // 1. Purchased / starting skills that grant slots (Additional Cantrip,
  //    Extended Capacity, Spell-Scholar). Attribute to the relevant class, and
  //    multiply by the item's rank ("Extended Capacity - Novice x2" → +2).
  for (const field of ['startingSkills', 'purchasedSkills']) {
    (character[field] || []).forEach((item, idx) => {
      const ent = lookupEntity(resolveId(item, field, character))
        || lookupEntity(`skills:${cleanItemName(item)}`);
      const rank = rankOf(character, field, idx);
      scanSlotGrant(ent?.description, (cat, n) => addTo(classFor(cat), cat, n * rank));
    });
  }

  // 2 + 3. Per-class automatic grants, gated by that class's own level:
  //   - INNATE powers granting slots (Artisan "Brilliant Thinker" → +1 Basic).
  // NOTE: the progression "Innate Bonus Cantrip: Cancel" prose is intentionally
  // NOT handled here. It grants the SPECIFIC Cancel cantrip as a free, locked
  // innate — not a choosable cantrip slot — so it must not bump the cantrip cap
  // (which is the table's Cantrips column). See innateBonusCantrips().
  for (const { name: cls, level: clsLevel } of classes) {
    for (const p of (CLASS_POWERS[cls]?.innate || [])) {
      if (requiredLevel(p) <= clsLevel) scanSlotGrant(p.desc || p.description, (cat, n) => addTo(cls, cat, n));
    }
  }

  return grants;
}

// Cantrips a caster is GRANTED for free (locked, not choosable) by the
// progression "Innate Bonus Cantrip: <name>" prose. The MegaDoc tables list the
// choosable Cantrips count in its own column; the Class-Bonuses column's "Innate
// Bonus Cantrip: Cancel" is a separate fixed grant on top. The prose reads e.g.
// "Innate Bonus Cantrip: Cancel, Healing Touch" — only the items that are
// actually cantrips of the class count (Cancel); the rest are unrelated bonuses
// (Healing Touch is a pool). Returns [{ cls, name }], deduped per class+name.
export function innateBonusCantrips(character) {
  const out = [];
  const seen = new Set();
  for (const { name: cls, level: clsLevel } of getClasses(character)) {
    const classCantrips = new Set((CLASS_POWERS[cls]?.cantrips || []).map((c) => c.name));
    const progression = CLASS_PROGRESSION[cls] || {};
    for (let lvl = 1; lvl <= clsLevel; lvl++) {
      const bonus = progression[lvl]?.bonus;
      const m = bonus && bonus.match(/innate\s+bonus\s+cantrip:\s*([^]*)/i);
      if (!m) continue;
      // Split the trailing list on commas/newlines; keep only real cantrips.
      for (const raw of m[1].split(/[,\n]/)) {
        const nm = raw.trim();
        if (!classCantrips.has(nm)) continue;
        const key = `${cls}:${nm}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ cls, name: nm });
      }
    }
  }
  return out;
}

// Which class a power pick belongs to. Slots are per-class, so each pick is
// attributed: prefer the explicit `powerClass` sidecar (set when picked into a
// class's slot); else infer from the entity's parentClass; else, if the character
// has only one class, that class. Returns null when ambiguous/unknown.
export function pickClass(character, field, index, name) {
  const tag = character.powerClass?.[field]?.[index];
  if (tag) return tag;
  const classNames = getClasses(character).map((c) => c.name);
  if (classNames.length === 1) return classNames[0];
  const ent = lookupEntity(`powers:${name}`);
  if (ent?.parentClass && classNames.includes(ent.parentClass)) return ent.parentClass;
  return null;
}

// Count a field's picks belonging to `cls`.
function countPicksForClass(character, field, cls) {
  return (character[field] || []).reduce(
    (n, name, i) => n + (pickClass(character, field, i, name) === cls ? 1 : 0), 0);
}

// The highest level a class's progression documents (base classes cap at 10; the
// source tables stop there, with levels 11+ being Advanced Classes — not yet
// published). Used to clamp slot/stat lookups for levels beyond the table.
function maxProgressionLevel(cls) {
  const levels = Object.keys(CLASS_PROGRESSION[cls] || {}).map(Number).filter((n) => n > 0);
  return levels.length ? Math.max(...levels) : 4;
}

// The progression row for a class at `level`, clamped to the highest documented
// level so an undocumented L11+ falls back to the top (L10) row rather than
// undefined / the level-4 default.
function progressionRow(cls, level) {
  const prog = CLASS_PROGRESSION[cls] || {};
  return prog[level] || prog[Math.min(level, maxProgressionLevel(cls))] || CLASS_POWER_SLOTS[cls];
}

// Power-slot usage vs. allotment, PER CLASS. Slots are class-specific (a Fighter's
// Utility slot can't hold a Rogue power, and a Cleric's cantrips differ from a
// Mage's), so we emit one row per class × category, each counting only that
// class's attributed picks and capped by that class's progression at its level.
// Each row carries `cls` so the picker can filter candidates to that class.
export function computeSlots(character) {
  const classes = getClasses(character).filter((c) => CLASS_POWER_SLOTS[c.name]);
  if (!classes.length) return [];
  const multi = classes.length > 1;
  const bonus = slotGrants(character);
  // Free, locked cantrips granted by progression ("Innate Bonus Cantrip: Cancel").
  // Surfaced on the cantrip row as `granted` so the UI shows them as fixed rows
  // (not choosable), without counting against the choosable cantrip cap.
  const grantedCantrips = innateBonusCantrips(character);

  const rows = [];
  for (const { name: cls, level } of classes) {
    // Clamp to the highest documented progression level (base classes cap at 10).
    const prog = progressionRow(cls, level);
    const isCaster = SPELLCASTERS.has(cls);
    const mkRow = (category, label, used, baseVal) => {
      const b = bonus[`${cls}:${category}`] || 0;
      return {
        cls, category, label: multi ? `${cls} ${label}` : label,
        used, base: baseVal, bonus: b, allowed: baseVal + b,
      };
    };
    if (isCaster) {
      const granted = grantedCantrips.filter((g) => g.cls === cls).map((g) => g.name);
      // A granted (innate) cantrip never consumes a choosable slot, even if it
      // appears in the character's cantrip pick list (older archetypes ship
      // "Cancel" as a pick — it's really the free innate). Exclude it from `used`.
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
// cantrips/spells-known). Source priority: the archetype's stated counts
// (noviceSpellSlots/…), else the class progression's "N/N/N" slots string for
// the character's level. Returns null for non-casters, else
// { novice, adept, greater }.
export function spellSlots(character) {
  const casters = getClasses(character).filter((c) => SPELLCASTERS.has(c.name));
  if (!casters.length) return null; // not a caster

  // Sum each caster class's progression "N/N/N" slots at its own level.
  const total = { novice: 0, adept: 0, greater: 0 };
  for (const { name, level } of casters) {
    const str = progressionRow(name, level)?.slots;
    if (typeof str === 'string') {
      const [n = 0, a = 0, g = 0] = str.split('/').map((x) => parseInt(x, 10) || 0);
      total.novice += n; total.adept += a; total.greater += g;
    }
  }

  // Scan starting and purchased skills for permanent spell slot grants.
  for (const field of ['startingSkills', 'purchasedSkills']) {
    (character[field] || []).forEach((item, idx) => {
      const ent = lookupEntity(resolveId(item, field, character))
        || lookupEntity(`skills:${cleanItemName(item)}`);
      const rank = rankOf(character, field, idx);
      if (ent?.description) {
        const m = ent.description.match(/\badditional\s+(Novice|Adept|Greater)\s+spell-?slot/i);
        if (m) {
          total[m[1].toLowerCase()] += rank;
        }
      }
    });
  }

  return total;
}

// Spells a Bookcaster can select, split into two groups for the picker:
//   known — spells the character already KNOWS (their spells-known picks). The
//           easy/default path: bookcasting a spell you know needs no friction.
//   other — every OTHER spell the rules let a Bookcaster pick: any spell on the
//           caster classes' lists, of a Tier the character can access (has a
//           slot for). Per the rules "one spell from any spell list they have
//           access to … of a Tier they would normally be able to access" — this
//           is the higher-friction path (a spell you don't yet know).
// Both groups are de-duped and sorted; `other` excludes anything in `known`.
// Returns { known, other }; both empty for non-casters.
const BOOKCASTER_TIER_FIELD = { novice: 'noviceSpells', adept: 'adeptSpells', greater: 'greaterSpells' };
const KNOWN_SPELL_FIELDS = ['noviceSpells', 'adeptSpells', 'greaterSpells'];
export function bookcasterSpellOptions(character) {
  const casters = getClasses(character).filter((c) => SPELLCASTERS.has(c.name));
  if (!casters.length) return { known: [], other: [] };
  const slots = spellSlots(character) || { novice: 0, adept: 0, greater: 0 };
  const accessibleTiers = Object.keys(BOOKCASTER_TIER_FIELD).filter((t) => (slots[t] || 0) > 0);

  // Every accessible spell from the caster classes' lists.
  const accessible = new Set();
  for (const { name: cls } of casters) {
    const byTier = CLASS_POWERS[cls];
    if (!byTier) continue;
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

// Default starting Wealth (MegaDoc: "all characters start with 8 Wealth").
export const DEFAULT_WEALTH = 8;

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
function scanWealthIncome(name, text) {
  if (!text) return null;
  // "<N> Wealth at the beginning of each/every game" or "<N> Wealth per Event".
  const recurring = text.match(/(\d+)\s*Wealth\s+(?:at the beginning of (?:each|every)\s+(?:game|event)|per\s+Event)/i);
  if (recurring) return { n: parseInt(recurring[1], 10) };
  // Manse: the cash alternative to resources ("Alternatively, N Wealth").
  if (/\bManse\b/i.test(name)) {
    const alt = text.match(/Alternatively,?\s*(\d+)\s*Wealth/i);
    if (alt) return { n: parseInt(alt[1], 10), note: 'or resources' };
  }
  // One-time starting grants that land AT THE FIRST EVENT count toward the
  // point-in-time total (Inheritance: "adds 100 Wealth at the beginning of their
  // first Event" / "one-time sum of money: N Wealth"). Recurring patterns above
  // win first, so this only catches genuine one-time first-event sums.
  const firstEvent = text.match(/(\d+)\s*Wealth\s+at the beginning of (?:their\s+)?first\s+Event/i)
    || text.match(/one-time\s+sum[^.]*?(\d+)\s*Wealth/i);
  if (firstEvent) return { n: parseInt(firstEvent[1], 10), note: 'one-time, first event' };
  return null;
}

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
    const w = scanWealthIncome(ent?.name || r.name, ent?.description);
    if (w) add(ent?.name || r.name, w.n, w.note);
  }
  // Owned/selected powers (Pit Master, etc.) + innate at level.
  const ownedPowerNames = new Set();
  for (const { name: cls } of getClasses(character)) {
    for (const p of (CLASS_POWERS[cls]?.innate || [])) {
      ownedPowerNames.add(p.name);
      const w = scanWealthIncome(p.name, p.description); if (w) add(p.name, w.n, w.note);
    }
  }
  for (const field of POWER_SOURCE_FIELDS) {
    for (const item of (character[field] || [])) {
      const ent = lookupEntity(`powers:${cleanItemName(item)}`);
      if (!ent) continue;
      ownedPowerNames.add(ent.name);
      const w = scanWealthIncome(ent.name, ent.description); if (w) add(ent.name, w.n, w.note);
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
export // Numeric character-creation stat modifiers from owned powers/perks/lineage
// advantages. ONLY permanent max-stat boosts count — anchored on "max/maximum"
// for Life Points and the "Natural Armor" noun — so in-play effects ("heal 1 LP",
// "Refresh 3 Spikes", a 6-second count) are NOT mistaken for build stats. Returns
// { lifePoints, spikes, naturalArmor, armor, sources: [{name, stat, n}] }.
const NUM = (w) => /^\d+$/.test(w) ? parseInt(w, 10) : (w.toLowerCase() === 'one' ? 1 : 0);
const STAT_PATTERNS = [
  // "+1 Life Point to max" / "adds 1 Life Point to their maximum" / "1 maximum Life Point"
  { stat: 'lifePoints', re: /(?:\+?(\d+)|\bone)\s+(?:maximum\s+)?Life\s+Points?\s+to\s+(?:their\s+)?max(?:imum)?/gi },
  { stat: 'lifePoints', re: /(?:additional\s+)?(?:\+?(\d+)|\bone)\s+(?:Base\s+)?maximum\s+Life\s+Points?/gi },
  { stat: 'lifePoints', re: /(?:adds?|gains?)\s+(?:\+?(\d+)|\bone)\s+Life\s+Points?\s+to\s+(?:their\s+)?max(?:imum)?/gi },
  // "+1 Base Maximum Life Points" — class progression-bonus phrasing.
  { stat: 'lifePoints', re: /\+\s*(\d+)\s+(?:Base\s+)?Maximum\s+Life\s+Points?/gi },
  // "Base Maximum Life Points is increased by one/N" (Healthy and similar skills).
  { stat: 'lifePoints', re: /(?:Base\s+)?Maximum\s+Life\s+Points?\s+(?:is|are)\s+increased\s+by\s+(?:\+?(\d+)|\bone|two|three)\b/gi },
  // "gain N Natural Armor" / "N points of Natural Armor" / "increases to N" (Natural Armor)
  { stat: 'naturalArmor', re: /(?:gains?|grant(?:ing|s)?)\s+(?:\+?(\d+)|\bone|three|two)\s+(?:points?\s+of\s+)?Natural\s+Armor/gi },
  { stat: 'naturalArmor', re: /(\d+)\s+points?\s+of\s+Natural\s+Armor/gi },
  // "+1 physical Armor Point" (Warrior Spirit) — explicit max armor boost.
  { stat: 'armor', re: /\+?(\d+)\s+(?:physical\s+)?Armor\s+Points?\b/gi },
  // "+N Maximum Spike(s)" — permanent spike boost (not "Refresh N Spikes").
  { stat: 'spikes', re: /(?:\+?(\d+)|\bone)\s+(?:Bonus\s+)?Maximum\s+Spikes?\b/gi },
];
const WORD_N = { one: 1, two: 2, three: 3 };
function statMods(character) {
  const mods = { lifePoints: 0, spikes: 0, naturalArmor: 0, armor: 0 };
  const sources = [];
  const notes = [];   // contextual/variable boosts with no fixed number (display only)
  // Per entity, take the FIRST match per stat. The patterns are alternate
  // phrasings of the same boost (Toughness says it two ways), so summing every
  // pattern hit would multi-count one boost. One entity → at most one boost per
  // stat (none in the source grant two of the same stat).
  const scan = (name, text, tags) => {
    if (!text) return;
    // Druid Form spells (tagged "Form") grant LP/armor only WHILE transformed
    // ("+1 Maximum Life Points while in the Lesser Form…") — a temporary state,
    // not a permanent build-stat. Skip their stat boosts so they don't inflate
    // the rail's Life Points / Armor.
    if (tags && tags.includes('Form')) return;
    const seen = new Set();
    for (const { stat, re } of STAT_PATTERNS) {
      if (seen.has(stat)) continue;
      re.lastIndex = 0;
      const m = re.exec(text);
      if (!m) continue;
      const w = m[1] || (m[0].match(/\b(one|two|three)\b/i) || [])[1] || '0';
      const n = NUM(w) || WORD_N[String(w).toLowerCase()] || 0;
      if (n > 0) { mods[stat] += n; sources.push({ name, stat, n }); seen.add(stat); }
    }
    // Variable/contextual Natural Armor with NO fixed number (Gift of Unbreakable
    // Flesh: "Gains Natural Armor from Patron"). Record as a display note so the
    // rail can show it even though the amount is variable.
    if (!seen.has('naturalArmor') && /\bgains?\b[^.]*\bNatural Armor\b/i.test(text)) {
      notes.push({ name, stat: 'naturalArmor', text: 'variable' });
    }
  };
  // Owned perks.
  for (const item of (character.purchasedPerks || [])) {
    const e = lookupEntity(`perks:${cleanItemName(item)}`); scan(e?.name || item, e?.description);
  }
  // Chosen lineage advantages (their stored desc carries the boost text).
  if (character.lineage) {
    const lin = LINEAGES[character.lineage];
    for (const name of (character.lineageAdvantages || [])) {
      const a = (lin?.advantages || []).find((x) => x.name === name || x.baseName === name);
      if (a) scan(a.baseName || a.name, a.desc || a.description);
    }
  }
  // Owned/selected powers (innate-at-level + slotted).
  for (const { name: cls, level: clsLevel } of getClasses(character)) {
    for (const p of (CLASS_POWERS[cls]?.innate || [])) {
      if (requiredLevel(p) <= clsLevel) scan(p.name, p.description, p.tags);
    }
  }
  for (const field of POWER_SOURCE_FIELDS) {
    for (const item of (character[field] || [])) {
      const e = lookupEntity(`powers:${cleanItemName(item)}`); scan(e?.name || item, e?.description, e?.tags);
    }
  }
  // Per-class progression bonuses, level-gated. The "Class Bonuses" column carries
  // stat boosts as prose ("+1 Base Maximum Life Points" at Fighter L2 / Cleric L7).
  // These are automatic at the gating level, so apply each row up to the class's
  // current level. (The base level-table LP is the CLASSLESS baseline — these
  // class bonuses stack on top; see levelStats.)
  for (const { name: cls, level: clsLevel } of getClasses(character)) {
    const prog = CLASS_PROGRESSION[cls] || {};
    for (let lvl = 1; lvl <= clsLevel; lvl++) {
      const bonus = prog[lvl]?.bonus;
      if (bonus) scan(`${cls} L${lvl}`, bonus);
    }
  }
  // Owned Class skills and other purchased skills (Healthy: "Base Maximum Life
  // Points is increased by one"). These aren't in POWER_SOURCE_FIELDS, so scan
  // them via their resolved skill/power entity description.
  for (const field of ['classSkills', 'purchasedSkills', 'startingSkills']) {
    for (const item of (character[field] || [])) {
      const e = lookupEntity(`skills:${cleanItemName(item)}`)
        || lookupEntity(`powers:${cleanItemName(item)}`)
        || lookupEntity(resolveId(item, field, character));
      if (e) scan(e.name, e.description);
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

// All entity ids the character owns, for satisfying skill-prereqs.
function ownedIds(character) {
  const owned = new Set();
  for (const field of ENTITY_FIELDS) {
    for (const item of character[field] || []) {
      const id = resolveId(item, field, character);
      owned.add(id);

      const clean = cleanItemName(item);
      const bare = bareSkill(clean);
      const candidates = [
        id,
        `${entityType(field)}:${bare}`,
        `powers:${clean}`,
        `perks:${clean}`,
        `skills:${clean}`,
        `powers:${bare}`,
        `perks:${bare}`,
        `skills:${bare}`
      ];
      for (const cand of candidates) {
        const ent = lookupEntity(cand);
        if (ent) {
          owned.add(ent.id);
          owned.add(`${ent.type}:${bareSkill(ent.name)}`);
        }
      }
    }
  }
  // Also add granted abilities so they satisfy prerequisites
  for (const g of grantedAbilities(character).list) {
    owned.add(g.ability);
    const ent = lookupEntity(g.ability);
    if (ent) {
      owned.add(`${ent.type}:${bareSkill(ent.name)}`);
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
  const ent = lookupEntity(entityId) || lookupEntity(entityId.split(':')[0] + ':' + bareSkill(idName(entityId)));
  const pr = REFS.prereqs[ent?.id || entityId];
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
  const charLevel = characterLevel(character);

  for (const field of ENTITY_FIELDS) {
    (character[field] || []).forEach((item, idx) => {
      const id = resolveId(item, field, character);
      // Tiered perks (Draconic Heritage): each purchased tier requires a minimum
      // CHARACTER level (tier 2 → lvl 5, …). Hard-enforced — buying tier N below
      // its level is an issue. Checked per-occurrence (uses the item's rank), so
      // it runs before the `seen` de-dupe below.
      const tEnt = lookupEntity(id) || lookupEntity(`${entityType(field)}:${bareSkill(cleanItemName(item))}`);
      if (Array.isArray(tEnt?.tiers) && tEnt.tiers.length) {
        const rank = Math.min(rankOf(character, field, idx), tEnt.tiers.length);
        const need = tEnt.tiers[rank - 1]?.level || 0;
        if (need > charLevel) {
          issues.push({ id, item, field, tierLevel: need, tier: rank,
            text: `tier ${rank} requires character level ${need}` });
        }
      }
    });
    for (const item of character[field] || []) {
      const id = resolveId(item, field, character);
      if (seen.has(id)) continue;
      seen.add(id);
      const ent = lookupEntity(id) || lookupEntity(`${entityType(field)}:${bareSkill(cleanItemName(item))}`);
      if (ent && ent.tier === 'SubPower') {
        issues.push({
          id, item, field,
          text: `${ent.name} is a sub-power and cannot be selected directly.`,
        });
      }
      const pr = REFS.prereqs[ent?.id || id];
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

  // ─── Weapon Specialization limit ───
  const weaponSpecs = [];
  for (const field of ['startingSkills', 'purchasedSkills']) {
    (character[field] || []).forEach((item) => {
      const clean = cleanItemName(item);
      if (bareSkill(clean) === 'Weapon Specialization') {
        weaponSpecs.push({ item, field });
      }
    });
  }
  for (const g of grantedAbilities(character).list) {
    if (g.abilityType === 'skills' && bareSkill(cleanItemName(g.abilityName)) === 'Weapon Specialization') {
      weaponSpecs.push({ item: g.abilityName, field: 'granted' });
    }
  }
  // Filter out unparameterized 'Weapon Specialization' if a parameterized one is present
  const hasParameterized = weaponSpecs.some(ws => ws.item.includes('('));
  const filteredWeaponSpecs = hasParameterized
    ? weaponSpecs.filter(ws => ws.item.includes('('))
    : weaponSpecs;

  if (filteredWeaponSpecs.length > 1) {
    const types = filteredWeaponSpecs.map(ws => {
      const m = ws.item.match(/\(([^)]+)\)/);
      return m ? m[1].trim() : 'unspecified';
    });
    issues.push({
      id: 'skills:Weapon Specialization',
      item: 'Weapon Specialization',
      text: `A character may only have Weapon Specialization with one weapon type (found: ${types.join(', ')}).`,
    });
  }

  // ─── Advanced Classes limit ───
  const BASE_CLASSES = new Set(['Artisan', 'Cleric', 'Druid', 'Fighter', 'Mage', 'Rogue', 'Socialite', 'Sourcerer']);
  const charClasses = getClasses(character);
  const advancedClasses = charClasses.filter(c => !BASE_CLASSES.has(c.name));
  const baseLevel = charClasses
    .filter(c => BASE_CLASSES.has(c.name))
    .reduce((sum, c) => sum + c.level, 0);

  if (advancedClasses.length > 2) {
    issues.push({
      id: 'classes:Advanced Classes',
      item: 'Advanced Classes',
      text: 'One character can have a maximum of two Advanced Classes.',
    });
  }
  if (advancedClasses.length > 0 && baseLevel < 10) {
    issues.push({
      id: 'classes:Advanced Classes',
      item: 'Advanced Classes',
      text: `Cannot take levels in Advanced Classes until total level 10 has been reached in base classes (current base level: ${baseLevel}).`,
    });
  }
  for (const c of advancedClasses) {
    if (c.level > 5) {
      issues.push({
        id: `classes:${c.name}`,
        item: c.name,
        text: `${c.name} has a maximum of 5 levels.`,
      });
    }
  }

  // ─── Draconic Heritage character creation note ───
  const hasDraconicHeritage = [...(character.purchasedPerks || [])]
    .some(p => bareSkill(cleanItemName(p)) === 'Draconic Heritage');
  if (hasDraconicHeritage) {
    notes.push({
      id: 'perks:Draconic Heritage',
      item: 'Draconic Heritage',
      field: 'purchasedPerks',
      kind: 'other',
      text: 'Must be taken at Character Creation.',
    });
  }

  return { issues, notes };
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
