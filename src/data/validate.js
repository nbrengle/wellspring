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

import { LEVEL_TABLE, lookupEntity, REFS, CLASS_POWER_SLOTS, CLASS_POWERS, CLASS_PROGRESSION, SPELLCASTERS, DEVOTIONS, DOMAINS, CLASSES, LINEAGES } from './index.js';

// Max Lineage Build Points a character can be awarded from challenges (MegaDoc:
// "up to 10 awarded LBP").
export const MAX_LBP = 10;

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

  const rawAwarded = challenges.reduce((s, c) => s + (c.lbp || 0), 0);
  const awarded = Math.min(rawAwarded, MAX_LBP);
  const spent = advantages.reduce((s, a) => s + (a.lbp || 0), 0);

  // Sublineage scoping: all chosen non-"General" items must share ONE sublineage
  // (normalized, since the data tags it inconsistently), and — when the character
  // has picked a sublineage — must match that one.
  const subs = new Set([...challenges, ...advantages]
    .map((x) => subKey(x.sublineage)).filter((s) => s && s !== 'general'));
  const pickedSub = character.sublineage ? subKey(character.sublineage) : null;
  const mixedSublineage = subs.size > 1
    || (pickedSub && [...subs].some((s) => s !== pickedSub));

  // Required challenges the character hasn't taken (some lineages mandate them).
  const missingRequired = lin.challenges
    .filter((c) => c.required && !challenges.some((x) => x.baseName === c.baseName));

  return {
    lineage: character.lineage,
    sublineage: character.sublineage || null,
    sublineages: lin.sublineages || [],
    challenges: lin.challenges,
    advantages: lin.advantages,
    chosenChallenges: challenges,
    chosenAdvantages: advantages,
    awarded, rawAwarded, capped: rawAwarded > MAX_LBP,
    spent, remaining: awarded - spent,
    overspent: spent > awarded,
    mixedSublineage,
    missingRequired,
    valid: spent <= awarded && !mixedSublineage && !missingRequired.length,
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
  for (const { name: cls } of getClasses(character)) {
    for (const p of (CLASS_POWERS[cls]?.innate || [])) {
      sources.push({ id: `powers:${p.name}`, name: p.name, kind: 'feature' });
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
  return { list, bySource };
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
const bareSkill = (s) => String(s).replace(/\s*\([^)]*\)\s*$/, '').trim();

// DERIVED multi-class grants — a pure function of the character's classes, so the
// same rule drives both the forward path (materialize grants when a class is
// added) and the reflective path (validate). Each class AFTER the first grants
// its Multi-Class Skills; a granted skill the character already has instead
// yields free BP equal to its cost ("Redundant Skills and Discounts" rule).
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

// Total Character Level = sum of all class levels (per the rules, BP and stats
// scale with total level even when multiclassing). Defaults to 4 (starter level)
// when no class info is present.
export function characterLevel(character) {
  const classes = getClasses(character);
  if (!classes.length) return 4;
  return classes.reduce((sum, c) => sum + (c.level || 0), 0);
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
export function budgetFor(level) {
  const row = LEVEL_TABLE.find((l) => l.level === level);
  if (row) return row.bp;
  const floor = LEVEL_TABLE.find((l) => l.level === LEGAL_MIN_LEVEL);
  if (floor && level < LEGAL_MIN_LEVEL) return Math.max(0, floor.bp - 2 * (LEGAL_MIN_LEVEL - level));
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
// Rank (purchase count) of an item, default 1. "Foo x2" → 2.
function rankOf(character, field, idx) {
  return character.ranks?.[field]?.[idx] || 1;
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
  // rank (the "x2" suffix was on the same authored line).
  if (typeof authored === 'number') return { cost: authored, base, grant, rank };

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
  if (src.scope.kind === 'prereq') {
    // Item lists the source's named perk as a prerequisite (e.g. Patron Gifts).
    const pr = REFS.prereqs?.[ent?.id];
    const target = `perks:${src.scope.value}`;
    return !!pr && (pr.skills?.includes(target) || pr.other?.some((o) => new RegExp(src.scope.value, 'i').test(o)));
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
    const sep = key.indexOf(':');
    const field = key.slice(0, sep);
    const item = key.slice(sep + 1);
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
        // Item already at/below min (e.g. free-granted) → refund as free BP.
        if (eff.cost <= min && src.refundIfFree) {
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
  // BP-bought powers: count only those the author marked with an effectiveBP
  // (a slot-filled power has no authored cost and is validated against slots).
  // effectiveCost trusts that authored value, so just use it.
  for (const field of BP_POWER_FIELDS) {
    (character[field] || []).forEach((item, idx) => {
      if (character.effectiveBP?.[field]?.[idx] == null) return;
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

  // Discount sources (Patron, Technarchist, etc.) reduce matching item costs in
  // place; a discount on an already-free item becomes free BP instead. Recompute
  // `spent` from the adjusted costs so totals reflect the discounts.
  const { freeBP: discountFreeBP, applied: discountsApplied } = applyDiscounts(character, byItem);
  spent = 0;
  for (const field of [...BP_FIELDS, ...BP_POWER_FIELDS]) {
    (character[field] || []).forEach((item) => {
      const eff = byItem[`${field}:${item}`];
      if (eff && eff.cost > 0) spent += eff.cost;
    });
  }

  return {
    spent, awarded, refunded, discountFreeBP, discountsApplied,
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
  //   - Per-level progression `bonus` prose ("Innate Bonus Cantrip" → +1 cantrip).
  for (const { name: cls, level: clsLevel } of classes) {
    for (const p of (CLASS_POWERS[cls]?.innate || [])) {
      if (requiredLevel(p) <= clsLevel) scanSlotGrant(p.desc || p.description, (cat, n) => addTo(cls, cat, n));
    }
    const progression = CLASS_PROGRESSION[cls] || {};
    for (let lvl = 1; lvl <= clsLevel; lvl++) {
      const bonus = progression[lvl]?.bonus;
      if (bonus && /bonus\s+cantrip/i.test(bonus)) addTo(cls, 'cantrips', 1);
    }
  }

  return grants;
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
      rows.push(mkRow('cantrips', 'Cantrips', countPicksForClass(character, 'cantrips', cls), prog.cantrips ?? 0));
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

  // Prefer explicit archetype counts when present (single-class starter sheets).
  const fromArchetype = {
    novice: character.noviceSpellSlots,
    adept: character.adeptSpellSlots,
    greater: character.greaterSpellSlots,
  };
  if (casters.length === 1
      && [fromArchetype.novice, fromArchetype.adept, fromArchetype.greater].some((v) => v != null)) {
    const num = (v) => (v == null ? 0 : parseInt(v, 10) || 0);
    return { novice: num(fromArchetype.novice), adept: num(fromArchetype.adept), greater: num(fromArchetype.greater) };
  }

  // Otherwise sum each caster class's progression "N/N/N" slots at its own level.
  const total = { novice: 0, adept: 0, greater: 0 };
  for (const { name, level } of casters) {
    const str = progressionRow(name, level)?.slots;
    if (typeof str === 'string') {
      const [n = 0, a = 0, g = 0] = str.split('/').map((x) => parseInt(x, 10) || 0);
      total.novice += n; total.adept += a; total.greater += g;
    }
  }
  return total;
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
  // Base budget plus DERIVED "free BP" (redundant multiclass grants award free BP
  // equal to the skill's cost). Derived from the classes, not a cached field, so
  // it's correct for any character (built, imported, or hand-edited).
  const mcGrants = multiclassGrants(character);
  const freeBP = mcGrants.freeBP;
  const budget = budgetFor(level) + freeBP;
  const bonusBudget = bonusBudgetFor(level);
  const maxBudget = budget + bonusBudget;
  const spend = computeSpend(character);
  const slots = computeSlots(character);
  const spellSlotCounts = spellSlots(character);
  const stats = levelStats(character);
  const devotion = devotionState(character);
  const lbp = lbpState(character);
  const granted = grantedAbilities(character);
  const prereqs = checkPrereqs(character);
  const slotsOver = slots.some((s) => s.over);
  // BP used beyond the base allowance, drawn from the bonus pool (clamped ≥0).
  const bonusUsed = Math.max(0, spend.net - budget);
  const overBudget = spend.net > maxBudget;          // exceeds even base+bonus
  // Characters below the campaign's documented floor (level 4) are buildable but
  // not legal play — flagged so the UI can mark them invalid with a reason.
  const belowFloor = level < LEGAL_MIN_LEVEL;
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
    stats,
    devotion,
    lbp,
    grantedAbilities: granted,
    prereqs,
    belowFloor,
    aboveCap,
    beyondProgression,
    legalMinLevel: LEGAL_MIN_LEVEL,
    levelCap: LEVEL_CAP,
    valid: !prereqs.issues.length && !overBudget && !slotsOver && !belowFloor
      && (!lbp || lbp.valid),
  };
}
