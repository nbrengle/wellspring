// costs-and-powers.test.mjs — split from scripts/test.mjs (hotspot split). Owns its own
// imports so concurrent features don't collide on one shared import block.
import { test, eq, ok } from './harness.mjs';
import {
  validate, characterLevel
} from "../../src/engine/validate.js";
import {
  budgetFor, computeSlots, spellSlots, devotionState, prereqStatus,
  LEVEL_CAP, LEGAL_MIN_LEVEL, grantedAbilities, computeSpend,
  getMaxRanks, bookcasterSpellOptions, arcaneSecretsSpellOptions, eligibleClassChoices, agileLearnerCapacity, basicSpellOptions
} from "../../src/engine/testing.js";
import { bareSkill, cleanItemName, getClasses, formatParameterizedName } from "../../src/engine/resolver.js";
import { formatCharacterSheet, parseCharacterSheet } from '../../src/engine/sheet.js';
import { solveCrafting, RECIPES, resolveRecipe, classifyIngredient, buildCraftTree } from '../../src/engine/recipe-solver.js';
import { readFileSync } from 'node:fs';
import { lookupEntity, eligiblePowers, DEVOTIONS, DOMAINS, REFS, CLASSES, LINEAGES, lineageChoiceSpec, lineageItemImpact, ALLERGEN_AWARDS, allergenOptions, allergenAward, powerSpellChoiceSpec } from '../../src/engine/data.js';
import { resolveCharacterGraph } from '../../src/engine/graph.js';
import {
  hasStartingChoices, reconcileStartingChoices, rebuildStartingSkills,
  STARTING_CHOICES_CONFIG, optionSkills, resolveSkill,
  configSkillKeys, sourceStartingSkillKeys,
} from '../../src/engine/starting-choices.js';
import ARCHETYPES from '../../src/data/archetypes.json' with { type: 'json' };
import CLASSES_JSON from '../../src/data/classes.json' with { type: 'json' };


// A character built straight from an archetype mirrors what loadArchetype keeps.
const fromArchetype = (a) => ({ ...a, archetypeName: a.name });

// ─── grants: a source grants a named ability, for free (kind #1) ──────────────
test('lineage advantage grants the named perk (Aewen → Magical Resilience)', () => {
  const c = { lineage: 'Aewen', lineageAdvantages: ['Mystic Resilience'] };
  const g = grantedAbilities(c);
  ok(g.list.some((x) => x.ability === 'perks:Magical Resilience'), 'Magical Resilience granted');
  eq(g.list.find((x) => x.ability === 'perks:Magical Resilience').source, 'Mystic Resilience', 'source name');
});
test('a slot-grant advantage is NOT a named entity grant (Aewen Deep Reserves)', () => {
  const c = { lineage: 'Aewen', lineageAdvantages: ['Deep Reserves'] };
  eq(grantedAbilities(c).list.length, 0, 'no named-entity grant');
});
test('grants from a granting power bought into purchasedSkills are seen (graph-derived)', () => {
  // Regression: the old per-field grant walk skipped purchasedSkills, so a Right
  // Hand power like "Holding Out for a Hero" (bought as a skill) didn't surface the
  // "Save the Day" it grants. The graph-derived grantedAbilities catches it.
  const c = { classLevels: 'Socialite 10', purchasedSkills: ['The Right Hand', 'Holding Out for a Hero'] };
  const g = grantedAbilities(c);
  // source is the canonical entity name ("...For a Hero"), resolved from the raw
  // input ("...for a Hero") — the graph normalizes via lookupEntity.
  ok(g.list.some((x) => x.ability === 'powers:Save the Day' && /^Holding Out [Ff]or a Hero$/.test(x.source)),
     'Save the Day is granted by the purchased Holding Out for a Hero');
});
test('a GRANT_SOURCE grant materializes as a free, non-removable owned item (Way of the Blade → Weapon Spec)', () => {
  // Uniform engine-driven grants: a power that grants a named entity surfaces that
  // entity as an owned item (one render path, regardless of grant source) so the UI
  // shows + can parameterize it — instead of the grant living only as a hidden effect.
  // The materialized row carries source:'class' + index:-1 so the build sheet's
  // canRemove (!fromClass && index>=0) is false: a granted ability isn't deletable.
  const c = { classLevels: 'Rogue 4', utilityPowers: ['Way of the Blade'],
    choices: { 'powers:Way of the Blade': 'Daggers' } };
  const r = validate(c);
  const granted = (r.owned?.skills || []).filter((x) => x.grantedBy === 'Way of the Blade');
  eq(granted.length, 2, 'both granted skills surface (Weapon Spec - Daggers + Two Weapon Style)');
  const spec = granted.find((x) => /^Weapon Spec/.test(x.name));
  ok(spec, 'the parameterized Weapon Specialization grant is present');
  eq(/Daggers/.test(spec.name), true, 'parameterized with the Way-of-the-Blade choice (Daggers)');
  eq(spec.field, 'skillsGrant', 'lands in a *Grant field (engine-materialized, not a purchase)');
  eq(spec.source, 'class', 'sourced as class so the UI treats it as non-removable');
  eq(spec.index, -1, 'index -1 → canRemove false');
  eq(spec.cost?.cost ?? 0, 0, 'granted ability is free');
});
test('a grant refunds a matching parameterized purchase, by parameter (Way of the Blade → Weapon Spec)', () => {
  // Way of the Blade (choosing Daggers) grants "Weapon Specialization - Daggers".
  // A previously-PURCHASED "Weapon Specialization (Daggers)" must go free + attributed
  // — the dash vs parens form must not block the match. A different weapon must NOT.
  const daggers = computeSpend({ classLevels: 'Rogue 4',
    purchasedSkills: ['Weapon Specialization (Daggers)'],
    utilityPowers: ['Way of the Blade'], choices: { 'powers:Way of the Blade': 'Daggers' } });
  const dk = daggers.byItem['purchasedSkills:Weapon Specialization (Daggers)'];
  eq(dk.cost, 0, 'matching weapon → refunded to free');
  eq(dk.grant?.source, 'Way of the Blade', 'attributed to the granting power');

  const swords = computeSpend({ classLevels: 'Rogue 4',
    purchasedSkills: ['Weapon Specialization (Swords)'],
    utilityPowers: ['Way of the Blade'], choices: { 'powers:Way of the Blade': 'Daggers' } });
  eq(swords.byItem['purchasedSkills:Weapon Specialization (Swords)'].cost, 4,
     'different weapon → NOT refunded (parameter precision)');
});
test('a selected power that grants a perk zeroes that perk (Implicit Truths → Insight)', () => {
  const c = { classLevels: 'Socialite 4', utilityPowers: ['Implicit Truths'], purchasedPerks: ['Insight'] };
  const eff = computeSpend(c).byItem['purchasedPerks:Insight'];
  eq(eff.cost, 0, 'Insight free');
  eq(eff.grant.source, 'Implicit Truths', 'grant source attributed');
  ok(eff.grant.derived, 'derived from the graph, not a sidecar');
});

// ─── discount sources: category, firstN, refund-if-free, cap ──────────────────
test('Human Environmental Mastery discounts a Gathering skill by 1', () => {
  const c = { lineage: 'Human', lineageAdvantages: ['Environmental Mastery'], purchasedSkills: ['Forage I'] };
  const s = computeSpend(c);
  eq(s.byItem['purchasedSkills:Forage I'].cost, 2, 'Forage 3→2');
  eq(s.byItem['purchasedSkills:Forage I'].discount.source, 'Environmental Mastery', 'source on chip');
});
test('Lost Wisdom of Many discounts only the first three Lore skills', () => {
  const c = { lineage: 'Lost', lineageAdvantages: ['Wisdom of Many'],
    purchasedSkills: ['Lore (History)', 'Lore (Religion)', 'Lore (Arcana)', 'Lore (Nature)'] };
  const s = computeSpend(c);
  eq(s.byItem['purchasedSkills:Lore (History)'].cost, 1, '1st discounted');
  eq(s.byItem['purchasedSkills:Lore (Arcana)'].cost, 1, '3rd discounted');
  eq(s.byItem['purchasedSkills:Lore (Nature)'].cost, 2, '4th full');
});

test('Patron discounts gift-eligible perks by 1, excludes Strong Bloodline + Gifts', () => {
  const c = { classLevels: 'Cleric 4', purchasedPerks: ['Patron', 'Greedy Soul', 'Strong Bloodline'] };
  const s = computeSpend(c);
  eq(s.byItem['purchasedPerks:Greedy Soul'].cost, 2, 'Greedy Soul 3→2');
  eq(s.byItem['purchasedPerks:Greedy Soul'].discount.source, 'Patron', 'attributed to Patron');
  eq(s.byItem['purchasedPerks:Strong Bloodline'].cost, 3, 'Strong Bloodline excluded');
});

// ─── Ritual Affinity: per-class level-gated BP discount ──────────────────────────
// The innate power (Cleric+Mage) makes Journeyman Ritual Magic cost 1 less at the
// GRANTING class's L7, and Greater at L12, refunding retroactively (auto via
// recompute). Gate is per granting class, so a multiclass discounts each track
// independently. Parser emits levelDiscounts; validate applies them per class.
test('Ritual Affinity discounts Ritual Magic at the granting class level', () => {
  const cost = (c, skill) => {
    const s = computeSpend(c);
    const k = Object.keys(s.byItem).find((x) => x.endsWith(`:${skill}`));
    return s.byItem[k]?.cost;
  };
  eq(cost({ classLevels: 'Cleric 4', purchasedSkills: ['Journeyman Ritual Magic'] }, 'Journeyman Ritual Magic'), 2, 'L4: gate not met, full 2');
  eq(cost({ classLevels: 'Cleric 7', purchasedSkills: ['Journeyman Ritual Magic'] }, 'Journeyman Ritual Magic'), 1, 'L7: Journeyman 2→1');
  eq(cost({ classLevels: 'Cleric 7', purchasedSkills: ['Greater Ritual Magic'] }, 'Greater Ritual Magic'), 3, 'L7: Greater gate (L12) not met, full 3');
  eq(cost({ classLevels: 'Cleric 12', purchasedSkills: ['Greater Ritual Magic'] }, 'Greater Ritual Magic'), 2, 'L12: Greater 3→2');
  // Multiclass: Cleric track at 12 gates Greater; the discount fires once.
  eq(cost({ classes: [{ name: 'Cleric', level: 12 }, { name: 'Mage', level: 4 }], purchasedSkills: ['Greater Ritual Magic'] }, 'Greater Ritual Magic'), 2, 'Cleric12 track discounts Greater');
  // No Ritual Affinity → no discount; no leak to similarly-named skills.
  eq(cost({ classLevels: 'Fighter 7', purchasedSkills: ['Journeyman Ritual Magic'] }, 'Journeyman Ritual Magic'), 2, 'no RA → full');
  eq(cost({ classLevels: 'Cleric 12', purchasedSkills: ['Greater Alchemy'] }, 'Greater Alchemy'), 5, 'no leak to Greater Alchemy');
});

// ─── shared powers: same-named cross-class powers stay mechanically equivalent ───
// A/B distinction is in the parser: `sharedWith` lists every offering class; a
// per-class level-scaled discount is `levelDiscounts`. Shared powers must be
// mechanically equivalent (cost/refresh) EXCEPT where they carry levelDiscounts
// (Ritual Affinity) — so a future edit that makes a shared copy diverge fails loud.
test('shared powers are mechanically equivalent unless level-scaled', () => {
  const TIERS = ['innate','utility','basic','advanced','veteran','classSkills','rightHandPowers','cantrips','noviceSpells','adeptSpells','greaterSpells'];
  const copies = {}; // name -> [{cost, refresh, hasLD}]
  for (const c of CLASSES_JSON) for (const t of TIERS) for (const p of (c[t] || [])) {
    (copies[p.name] = copies[p.name] || []).push({ cost: p.cost ?? null, refresh: p.refresh ?? null, hasLD: !!p.levelDiscounts, sharedWith: p.sharedWith });
  }
  for (const [name, cs] of Object.entries(copies)) {
    if (cs.length < 2) continue;            // shared only
    ok(cs.every((x) => Array.isArray(x.sharedWith) && x.sharedWith.length >= 2), `${name} copies tagged sharedWith`);
    if (cs.some((x) => x.hasLD)) continue;   // level-scaled (Ritual Affinity) may differ per class
    eq(new Set(cs.map((x) => JSON.stringify(x.cost))).size, 1, `${name} copies share one cost`);
    eq(new Set(cs.map((x) => JSON.stringify(x.refresh))).size, 1, `${name} copies share one refresh`);
  }
});

// ─── xN on unlimited-ranks skills → distinct instances, not rank N ────────────
test('import expands "Lore x2" into two distinct Lore instances', () => {
  const c = parseCharacterSheet('M\nClass Levels: Mage 4\nPurchased Skills: Lore x2');
  eq(c.purchasedSkills.length, 2, 'two rows');
  ok(c.purchasedSkills[0] !== c.purchasedSkills[1], 'distinct subjects');
  ok(c.purchasedSkills.every((n) => /^Lore \(/.test(n)), 'both parameterized Lore');
});
test('import expands "Bookcaster x3" into three distinct instances', () => {
  const c = parseCharacterSheet('M\nClass Levels: Mage 4\nPurchased Skills: Bookcaster x3');
  eq(c.purchasedSkills.length, 3, 'three rows');
  eq(new Set(c.purchasedSkills).size, 3, 'all distinct');
});
test('two Lores under Sharp Mind cost 1 each (per-instance discount), net 2', () => {
  const c = parseCharacterSheet('M\nClass Levels: Mage 4\nPurchased Perks: Sharp Mind\nPurchased Skills: Lore x2');
  const s = computeSpend(c);
  const lores = Object.keys(s.byItem).filter((k) => /purchasedSkills:Lore/.test(k));
  eq(lores.length, 2, 'two distinct byItem keys');
  lores.forEach((k) => eq(s.byItem[k].cost, 1, `${k} discounted to 1`));
});
test('finite-ranks "Extended Capacity - Novice x2" stays one rank-2 row (not expanded)', () => {
  const c = parseCharacterSheet('M\nClass Levels: Mage 4\nPurchased Skills: Extended Capacity - Novice x2');
  eq(c.purchasedSkills.length, 1, 'single row');
});

// ─── tiered perks: cumulative cost + hard-enforced per-tier level gate ────────
test('Draconic Heritage rank 2 costs cumulative tier sum (2+3=5)', () => {
  const c = { classLevels: 'Mage 5', purchasedPerks: ['Draconic Heritage'], ranks: { purchasedPerks: [2] } };
  eq(computeSpend(c).byItem['purchasedPerks:Draconic Heritage'].cost, 5, 'tiers 1+2');
});
test('Draconic Heritage rank 4 costs 2+3+4+5 = 14 (not base×4)', () => {
  const c = { classLevels: 'Mage 15', purchasedPerks: ['Draconic Heritage'], ranks: { purchasedPerks: [4] } };
  eq(computeSpend(c).byItem['purchasedPerks:Draconic Heritage'].cost, 14, 'all four tiers');
});
test('tier level gate is hard-enforced (rank 2 below char level 5 is an issue)', () => {
  const below = validate({ classLevels: 'Mage 4', purchasedPerks: ['Draconic Heritage'], ranks: { purchasedPerks: [2] } });
  ok(below.prereqs.issues.some((i) => /tier 2 requires character level 5/.test(i.text || '')), 'gated');
  ok(!below.valid, 'invalid below the gate');
  const at = validate({ classLevels: 'Mage 5', purchasedPerks: ['Draconic Heritage'], ranks: { purchasedPerks: [2] } });
  ok(!at.prereqs.issues.some((i) => i.tier), 'clears at the required level');
});

// ─── power requirements (parser-extracted requiredLevel + requiresEntity) ─────
// A selected power's requirement is enforced: a minimum class level and/or another
// owned entity. Requirements resolve in the OWNING class's context (power names are
// shared across classes with different requirements).
test('power level requirement is enforced', () => {
  // Warrior Spirit requires Fighter Level 10.
  const below = validate({ classLevels: 'Fighter 4', innatePowers: ['Warrior Spirit'] });
  ok(below.prereqs.issues.some((i) => i.item === 'Warrior Spirit' && /Fighter Level 10/.test(i.text)), 'flagged below level');
  const at = validate({ classLevels: 'Fighter 10', innatePowers: ['Warrior Spirit'] });
  ok(!at.prereqs.issues.some((i) => i.item === 'Warrior Spirit'), 'clears at level');
});
test('power entity requirement is enforced (Expert Parry needs Parry Blow)', () => {
  // Parry Blow is a Fighter innate at L3. A Fighter 2 doesn't have it yet, so
  // Expert Parry's requiresEntity is unmet → flagged.
  const missing = validate({ classLevels: 'Fighter 2', advancedPowers: ['Expert Parry'] });
  ok(missing.prereqs.issues.some((i) => i.item === 'Expert Parry' && i.requiresEntity === 'Parry Blow'), 'flagged without prerequisite');
  // A Fighter 6 AUTO-gets Parry Blow (innate), which satisfies the requirement —
  // the prereq check now sees auto-granted innates (graph-derived ownedIds), so it
  // clears without needing to separately select Parry Blow.
  const auto = validate({ classLevels: 'Fighter 6', advancedPowers: ['Expert Parry'] });
  ok(!auto.prereqs.issues.some((i) => i.item === 'Expert Parry'), 'clears when the prerequisite is auto-granted as an innate');
});
test('shared power name resolves requirement per owning class (no false positive)', () => {
  // "Ritual Affinity" exists for both Cleric (Cleric L3) and Mage (Mage L3). A
  // Cleric who owns it at Cleric L3 must NOT be flagged with the Mage requirement.
  const cleric = validate({ classLevels: 'Cleric 4', innatePowers: ['Ritual Affinity'] });
  ok(!cleric.prereqs.issues.some((i) => i.item === 'Ritual Affinity'), 'cleric version satisfied, not the mage one');
});

// ─── per-level power benefits (Adept Ritualist) ──────────────────────────────
test('Adept Ritualist level-benefits activate by Artisan class level', () => {
  const at1 = validate({ classLevels: 'Artisan 1', utilityPowers: ['Adept Ritualist'] });
  const pb1 = at1.powerBenefits.find((b) => b.power === 'Adept Ritualist');
  ok(pb1, 'powerBenefits present');
  eq(pb1.gateClass, 'Artisan', 'gates on Artisan level');
  eq(pb1.benefits.find((b) => b.level === 1).active, true, 'L1 active at Artisan 1');
  eq(pb1.benefits.find((b) => b.level === 3).active, false, 'L3 locked at Artisan 1');
  const at7 = validate({ classLevels: 'Artisan 7', utilityPowers: ['Adept Ritualist'] });
  const pb7 = at7.powerBenefits.find((b) => b.power === 'Adept Ritualist');
  ok(pb7.benefits.every((b) => b.active), 'all active at Artisan 7');
});

// ─── choose-one: build-time selection grants the chosen skill free ────────────
test('Expert Craft build-time choice grants the selected skill at 0 BP', () => {
  const base = { classLevels: 'Artisan 10', innatePowers: ['Expert Craft'], purchasedSkills: ['Greater Alchemy'] };
  eq(computeSpend(base).byItem['purchasedSkills:Greater Alchemy'].cost, 5, 'full cost without a choice');
  const chosen = { ...base, choices: { 'powers:Expert Craft': 'Greater Alchemy' } };
  const eff = computeSpend(chosen).byItem['purchasedSkills:Greater Alchemy'];
  eq(eff.cost, 0, 'free once chosen');
  eq(eff.grant.source, 'Expert Craft', 'attributed to Expert Craft');
});

// ─── flaw BP award capped at 5 (rules limit) ─────────────────────────────────
test('flaw BP award is capped at 5 (extra flaws give no more BP)', () => {
  const manyFlaws = ['Binding Oath of Charity', 'Binding Oath of Peace', 'Torn Soul']; // 5+5+4 = 14 raw
  const s = computeSpend({ classLevels: 'Fighter 10', flaws: manyFlaws });
  eq(s.awarded, 5, 'awarded clamped to 5');
  ok(s.rawAwarded > 5, 'rawAwarded reflects the uncapped sum');
  ok(s.flawCapped, 'flawCapped flagged');
});

test('flaws RAISE the budget rather than lowering spend', () => {
  // Flaw BP is awarded BP: it should lift the displayed cap (spent of base+flaws),
  // not net out of spend (which would make the build look like it spent less).
  const base = { classLevels: 'Fighter 4', purchasedSkills: [], purchasedPerks: [] };
  const none = validate({ ...base, flaws: [] });
  const five = validate({ ...base, flaws: ['Nightmares', 'Pliant'] }); // 3 + 2 = 5
  eq(five.budget, none.budget + 5, 'budget lifts by the 5 awarded flaw BP');
  eq(five.spend.net, none.spend.net, 'spend is unchanged by flaws (not netted down)');
  eq(five.remaining, none.remaining + 5, 'remaining grows by the flaw award');
  ok(!five.overBudget, 'awarding budget headroom does not flag over-budget');
  // The lift is capped at MAX_FLAW_BP just like the award.
  const eight = validate({ ...base, flaws: ['Nightmares', 'Pliant', 'Outdoor Discomfort'] }); // 3+2+3=8
  eq(eight.budget, none.budget + 5, 'budget lift is capped at 5 even with more flaw BP');
});

test('allergy flaws calculate awards dynamically based on parameter', () => {
  const s1 = computeSpend({ classLevels: 'Fighter 10', flaws: ['Mild Allergy (Iron)'] });
  eq(s1.rawAwarded, 2, 'common mild allergy awards 2 BP');

  const s2 = computeSpend({ classLevels: 'Fighter 10', flaws: ['Mild Allergy (Gold)'] });
  eq(s2.rawAwarded, 1, 'uncommon mild allergy awards 1 BP');

  const s3 = computeSpend({ classLevels: 'Fighter 10', flaws: ['Severe Allergy (Iron)'] });
  eq(s3.rawAwarded, 3, 'common severe allergy awards 3 BP');

  const s4 = computeSpend({ classLevels: 'Fighter 10', flaws: ['Severe Allergy (Gold)'] });
  eq(s4.rawAwarded, 2, 'uncommon severe allergy awards 2 BP');
});

test('allergy awards are derived from the parsed rulebook table, not hardcoded', () => {
  // Source of truth: the parser scrapes "Standard Allergens and Awards" into a
  // structured `allergens` field; ALLERGEN_AWARDS / allergenAward read that field.
  ok(ALLERGEN_AWARDS['Mild Allergy'] && ALLERGEN_AWARDS['Severe Allergy'], 'both allergy tables present');
  eq(allergenOptions('Mild Allergy').length, 15, 'all 15 standard allergens offered');
  // Every substance in the table prices exactly as the table says, for both flaws.
  for (const flaw of ['Mild Allergy', 'Severe Allergy']) {
    for (const [sub, bp] of Object.entries(ALLERGEN_AWARDS[flaw])) {
      eq(allergenAward(flaw, sub), bp, `${flaw} (${sub}) → ${bp}`);
      // case/whitespace-insensitive
      eq(allergenAward(flaw, ` ${sub.toUpperCase()} `), bp, `${flaw} (${sub}) normalizes`);
    }
  }
  // No substance, or one off the table → undetermined (null), not a wrong number.
  eq(allergenAward('Mild Allergy', ''), null, 'no substance → undetermined');
  eq(allergenAward('Mild Allergy', 'butter'), null, 'off-table substance → undetermined');
  // The engine still books a conservative minimum for a bare allergy.
  eq(computeSpend({ classLevels: 'Fighter 10', flaws: ['Mild Allergy'] }).rawAwarded, 1,
     'bare Mild Allergy defaults to the table minimum (1)');
});

// ─── sub-power extraction + grant (Strange Token → Curious Balm) ──────────────
test('inline sub-powers are extracted as entities', () => {
  ok(lookupEntity('powers:Curious Balm'), 'Curious Balm exists');
  ok(lookupEntity('powers:Holy Rest'), 'Holy Rest exists');
  ok(lookupEntity('powers:Curious Balm').effect, 'sub-power carries its stat block (effect)');
});
test('a power that grants a sub-power surfaces it as a free granted ability', () => {
  const g = grantedAbilities({ classLevels: 'Artisan 10', advancedPowers: ['Strange Token'] });
  ok(g.list.some((x) => x.ability === 'powers:Curious Balm' && x.source === 'Strange Token'), 'Curious Balm granted by Strange Token');
});

