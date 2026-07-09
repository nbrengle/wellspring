// validation-coverage.test.mjs — split from scripts/test.mjs (hotspot split). Owns its own
// imports so concurrent features don't collide on one shared import block.
import { test, eq, ok, pSkills, Source } from './harness.mjs';
import { makeChar } from './make-char.mjs';
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

// ─── Weapon Specialization & Advanced Classes validation ───────────────────────
test('validation: take-once cap on purchases (generic OVER_CAP, e.g. Weapon Spec)', () => {
  const clean = makeChar('Fighter 4', { archetypeName: 'x', add: ['Weapon Specialization (Swords)'] });
  const rClean = validate(clean);
  eq(rClean.prereqs.issues.length, 0, 'One specialization is legal');

  // Buying a SECOND cap-1 (rank "-") skill is an illegal build — flagged generically
  // as over-cap, NOT silently refunded to free BP (refund is for grants only).
  const multiple = makeChar('Fighter 4', { archetypeName: 'x', add: ['Weapon Specialization (Swords)', 'Weapon Specialization (Daggers)'] });
  const rMultiple = validate(multiple);
  ok(rMultiple.prereqs.issues.some(i => /Weapon Specialization/.test(i.item) && /taken once/i.test(i.text)),
     'A second cap-1 purchase is blocked as over-cap');
  ok(!rMultiple.valid, 'build with an over-cap purchase is invalid');
});

test('validation: Advanced Classes limits and rules', () => {
  const legalAdv = { archetypeName: 'x', classes: [{ name: 'Fighter', level: 10 }, { name: 'Shadowblade', level: 5 }] };
  const rLegal = validate(legalAdv);
  const shadowbladeIssues = rLegal.prereqs.issues.filter(i => i.item === 'Shadowblade' || i.item === 'Advanced Classes');
  eq(shadowbladeIssues.length, 0, 'Level 10 base + Level 5 Advanced is legal under advanced class rules');

  const lowBase = { archetypeName: 'x', classes: [{ name: 'Fighter', level: 4 }, { name: 'Shadowblade', level: 1 }] };
  const rLowBase = validate(lowBase);
  ok(rLowBase.prereqs.issues.some(i => i.item === 'Advanced Classes' && i.text.includes('until total level 10 has been reached')), 'Advanced class blocked if base classes level < 10');

  const tooHighLevel = { archetypeName: 'x', classes: [{ name: 'Fighter', level: 10 }, { name: 'Shadowblade', level: 6 }] };
  const rTooHighLevel = validate(tooHighLevel);
  ok(rTooHighLevel.prereqs.issues.some(i => i.item === 'Shadowblade' && i.text.includes('maximum of 5 levels')), 'Advanced class capped at 5 levels');

  const tooManyAdv = { archetypeName: 'x', classes: [{ name: 'Fighter', level: 10 }, { name: 'Shadowblade', level: 1 }, { name: 'Spellbinder', level: 1 }, { name: 'Archmage', level: 1 }] };
  const rTooManyAdv = validate(tooManyAdv);
  ok(rTooManyAdv.prereqs.issues.some(i => i.item === 'Advanced Classes' && i.text.includes('maximum of two')), 'Max of two Advanced Classes');
});

test('validation: Fighter Level 2 and Healthy power increase Life Points', () => {
  // A Fighter 2 / Mage 2 character has total level 4 (base 3 LP from level table).
  // Fighter 2 progression adds "+1 Base Maximum Life Points".
  const fighter2 = { archetypeName: 'x', classes: [{ name: 'Fighter', level: 2 }, { name: 'Mage', level: 2 }], lifePoints: NaN };
  const rF2 = validate(fighter2);
  eq(rF2.stats.lifePoints, 3 + 1, 'Fighter 2 grants +1 LP');

  // Fighter 6 character taking Healthy power gets +1 LP.
  const fighter6Healthy = makeChar('Fighter 6', { archetypeName: 'x', add: ['Healthy'], lifePoints: NaN });
  const rHealthy = validate(fighter6Healthy);
  // Fighter level 6 base from level table is 4 LP.
  // Fighter level 2 bonus gives +1 LP.
  // Healthy power gives +1 LP.
  // Total: 4 + 1 + 1 = 6 LP.
  eq(rHealthy.stats.lifePoints, 6, 'Fighter 6 with Healthy grants +2 LP total (+1 from lvl 2, +1 from Healthy)');
});

test('validation: Draconic Heritage character creation note', () => {
  const c = makeChar('Fighter 4', { archetypeName: 'x', add: ['Draconic Heritage (Flame)'] });
  const r = validate(c);
  ok(r.prereqs.notes.some(n => n.item === 'Draconic Heritage' && n.text.includes('Must be taken at Character Creation')), 'Heritage note is registered');
});

test('parameterized skills satisfy prerequisites and undergo prerequisite checking', () => {
  // 1. Lore (Historical) satisfies Research prerequisite (Lore)
  let c = {
    classes: [{ name: 'Mage', level: 4 }],
    ...pSkills(['Lore (Historical)', 'Research'])
  };
  eq(validate(c).prereqs.issues.length, 0, 'Lore (Historical) satisfies Research');

  // 2. Profession - Journeyman (Smith) requires Profession - Apprentice
  c = {
    classes: [{ name: 'Mage', level: 4 }],
    ...pSkills(['Profession - Journeyman (Smith)'])
  };
  const issues = validate(c).prereqs.issues;
  eq(issues.length, 1, 'fails missing apprentice prerequisite');
  eq(issues[0].id, 'skills:Profession - Journeyman (Smith)', 'identifies correct failing skill');
  eq(issues[0].missing[0].id, 'skills:Profession - Apprentice', 'identifies missing base prerequisite');

  // 3. Adding Apprentice (Smith) satisfies the prerequisite
  c.skills.push({ entityId: 'Profession - Apprentice (Smith)', source: Source.purchased(), ranks: 1 });
  eq(validate(c).prereqs.issues.length, 0, 'Apprentice satisfies Journeyman');
});

// ─── Effect Coverage G1-G4 Tests ─────────────────────────────────────────────
test('effect coverage G1: spikes progression bonuses', () => {
  // Fighter Level 9 gets +1 Base Maximum Spikes (baseline Fighter starts with 3 spikes)
  const f8 = { classes: [{ name: 'Fighter', level: 8 }] };
  const f9 = { classes: [{ name: 'Fighter', level: 9 }] };
  eq(validate(f8).stats.spikes, 3, 'Fighter L8 has 3 spikes');
  eq(validate(f9).stats.spikes, 4, 'Fighter L9 has 4 spikes (from progression)');

  // Rogue Level 3 gets +1 Spikes, Level 9 gets another +1
  const r2 = { classes: [{ name: 'Rogue', level: 2 }] };
  const r3 = { classes: [{ name: 'Rogue', level: 3 }] };
  const r9 = { classes: [{ name: 'Rogue', level: 9 }] };
  eq(validate(r2).stats.spikes, 2, 'Rogue L2 has 2 spikes');
  eq(validate(r3).stats.spikes, 3, 'Rogue L3 has 3 spikes');
  eq(validate(r9).stats.spikes, 5, 'Rogue L9 has 5 spikes');
});

test('effect coverage G2: Warrior Spirit innate at level 10', () => {
  // Fighter L9 with Warrior Spirit innate: not active since level < 10
  const f9 = { classes: [{ name: 'Fighter', level: 9 }] };
  const r9 = validate(f9);
  eq(r9.stats.lifePoints, 5, 'Fighter L9 has 5 LP (4 base + 1 Fighter L2 bonus)');
  eq(r9.stats.armor, 1, 'Fighter L9 has 1 armor (Fighter L4 bonus)');
  eq(r9.stats.naturalArmor, 0, 'Fighter L9 has 0 natural armor');

  // Fighter L10 with Warrior Spirit innate active: LP +1, armor +1, naturalArmor +1.
  // Armor = 1 (Fighter L4 bonus) + 1 (Warrior Spirit innate). The L4 bonus carries a
  // "*" footnote ("+1 Armor point as long as the Fighter is wearing at least 1 point
  // of Physical Armor") that only makes the L4 point conditional — it is NOT a second,
  // L10 armor bonus. (The old text-flattening parser swept the footnote into the L10
  // row and double-counted it; the cell-aware parser keeps them separate.)
  const f10 = { classes: [{ name: 'Fighter', level: 10 }] };
  const r10 = validate(f10);
  eq(r10.stats.lifePoints, 6, 'Fighter L10 has 6 LP (4 base + 1 Fighter L2 bonus + 1 Warrior Spirit)');
  eq(r10.stats.armor, 2, 'Fighter L10 has 2 armor (1 Fighter L4 bonus + 1 Warrior Spirit)');
  eq(r10.stats.naturalArmor, 1, 'Fighter L10 has 1 natural armor (Warrior Spirit)');
});

test('effect coverage G3: Extensive Combat Training slot grants', () => {
  // Fighter level 4 has 2 basic, 0 advanced, 0 veteran power slots
  const baseF = { classes: [{ name: 'Fighter', level: 4 }] };
  const rBase = validate(baseF);
  const getSlot = (r, cat) => r.slots.find(s => s.category === cat)?.allowed || 0;
  eq(getSlot(rBase, 'basic'), 2, 'Fighter L4 base has 2 basic slots');
  eq(getSlot(rBase, 'advanced'), 0, 'Fighter L4 base has 0 advanced slots');

  // Fighter L4 with Extensive Combat Training - Basic x1 -> basic +1
  const basicECT = {
    classes: [{ name: 'Fighter', level: 4 }],
    ...pSkills(['Extensive Combat Training - Basic'])
  };
  eq(getSlot(validate(basicECT), 'basic'), 3, 'ECT Basic grants +1 basic slot');

  // Fighter L4 with Extensive Combat Training - Advanced x1 -> advanced +1 (since Adept tier maps to advanced)
  const advECT = {
    classes: [{ name: 'Fighter', level: 4 }],
    ...pSkills(['Extensive Combat Training - Advanced'])
  };
  eq(getSlot(validate(advECT), 'advanced'), 1, 'ECT Advanced grants +1 advanced slot');
});

test('effect coverage G4: Aewen Deep Reserves spell slot grant', () => {
  // Caster class (Mage L1 has 1 Novice, 0 Adept, 0 Greater spell slots)
  const mageBase = { classes: [{ name: 'Mage', level: 1 }] };
  const rMage = validate(mageBase);
  eq(rMage.spellSlots.Arcane.novice, 1, 'Mage L1 has 1 novice spell slot');

  // Caster Aewen + Deep Reserves -> +1 at highest tier (Novice in this case)
  const aewenCaster = {
    classes: [{ name: 'Mage', level: 1 }],
    lineage: 'Aewen',
    lineageAdvantages: ['Deep Reserves']
  };
  const rAewenCaster = validate(aewenCaster);
  eq(rAewenCaster.spellSlots.Arcane.novice, 2, 'Deep Reserves increases novice slots to 2');

  // Non-caster Aewen -> spellSlots is null, unaffected
  const aewenNonCaster = {
    classes: [{ name: 'Fighter', level: 1 }],
    lineage: 'Aewen',
    lineageAdvantages: ['Deep Reserves']
  };
  eq(validate(aewenNonCaster).spellSlots, null, 'Non-caster Aewen has null spellSlots');
});

// ─── referential integrity of the rules network ────────────────────────────────
// The data files form a NAME-KEYED cross-reference network: refs.json relations
// (prereqs / grants / discounts / unlocks) connect entities by `type:name` string,
// resolved at runtime via lookupEntity across skills / perks / powers / classes /
// advantages. If an entity is referenced by a rule but never registered in the
// entity index, the reference silently dangles — a dropped prereq, an inert grant,
// an empty inspector. (This is exactly how lineage advantages were once invisible:
// referenced by grants but never indexed.) Assert every id a rule points at resolves.
test('every entity referenced by a rules relation resolves (no dangling refs)', () => {
  const referenced = new Set();
  const add = (id) => { if (typeof id === 'string' && id.includes(':')) referenced.add(id); };

  for (const [id, pr] of Object.entries(REFS.prereqs || {})) {
    add(id);
    for (const dep of pr.skills || []) add(dep);
    for (const group of pr.anyOf || []) for (const dep of group) add(dep);
  }
  for (const [id, targets] of Object.entries(REFS.grants || {})) {
    add(id);
    for (const t of targets || []) add(t);
  }
  for (const [id, d] of Object.entries(REFS.discounts || {})) {
    add(id);
    for (const ex of d.exclusions || []) add(ex);
  }
  for (const [id, targets] of Object.entries(REFS.unlocks || {})) {
    add(id);
    for (const t of targets || []) add(t);
  }

  const dangling = [...referenced].filter((id) => !lookupEntity(id));
  ok(dangling.length === 0,
    `${dangling.length} dangling rule reference(s) — referenced by a rule but not in the entity index:\n        ${dangling.join('\n        ')}`);
});

// ─── perks and powers bug fixes ───────────────────────────────────────────────
test('Execute power makes Hard to Kill free even if sheet has positive authored cost', () => {
  const char = makeChar('Fighter 4', {
    archetypeName: 'Custom Fighter',
    add: ['Execute', { name: 'Hard to Kill', cost: 1 }],
  });
  const r = validate(char);
  const costInfo = r.spend.byItem['purchasedPerks:Hard to Kill'];
  ok(costInfo, 'costInfo for Hard to Kill exists');
  eq(costInfo.cost, 0, 'Hard to Kill is free');
  eq(costInfo.grant?.source, 'Execute', 'Granted by Execute');
});

test('Othersleep has base cost of 1', () => {
  const ent = lookupEntity('perks:Othersleep');
  ok(ent, 'Othersleep exists');
  eq(ent.cost, 1, 'Othersleep cost is 1');
});

