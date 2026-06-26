// skills-and-stats.test.mjs — split from scripts/test.mjs (hotspot split). Owns its own
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

// ─── base stats from the level table + numeric power/perk/lineage mods ────────
test('base Life Points / Spikes come from the level table (classless baseline)', () => {
  // Base LP is the classless table value; class progression bonuses layer on top.
  const s4 = validate({ classLevels: 'Fighter 4' }).stats;
  eq(s4.baseLifePoints, 3, 'L4 base = 3 LP'); eq(s4.spikes, 2, 'L4 = 2 spikes');
  // Fighter's L2 "+1 Base Maximum Life Points" applies → total 4 at L4.
  eq(s4.lifePoints, 4, 'L4 Fighter total = 3 base + 1 (Fighter L2 bonus)');
  const s10 = validate({ classLevels: 'Fighter 10' }).stats;
  eq(s10.baseLifePoints, 4, 'L10 base = 4 LP'); eq(s10.spikes, 4, 'L10 = 4 spikes (3 base + 1 Fighter L9 bonus)');
  eq(s10.lifePoints, 6, 'L10 Fighter total = 4 base + 1 (L2) + 1 (Warrior Spirit)');
});
test('class progression LP bonus applies and is level-gated', () => {
  // Fighter L2 grants +1 Base Maximum LP; below L2 it should NOT apply.
  eq(validate({ classes: [{ name: 'Fighter', level: 1 }] }).stats.lifePoints, 3, 'L1 = 3 (no bonus yet)');
  eq(validate({ classes: [{ name: 'Fighter', level: 2 }] }).stats.lifePoints, 4, 'L2 = 4 (bonus applies)');
  // Cleric gets its +1 at L7, not before.
  eq(validate({ classes: [{ name: 'Cleric', level: 6 }] }).stats.lifePoints, 4, 'Cleric L6 = 4 (table, no bonus)');
  eq(validate({ classes: [{ name: 'Cleric', level: 7 }] }).stats.lifePoints, 5, 'Cleric L7 = 4 + 1 bonus');
});
test('Healthy class skill adds +1 max Life Point', () => {
  const without = validate({ classes: [{ name: 'Fighter', level: 6 }] }).stats.lifePoints;
  const withH = validate({ classes: [{ name: 'Fighter', level: 6 }], classSkills: ['Healthy'] }).stats;
  eq(withH.lifePoints, without + 1, 'Healthy adds +1 LP');
  ok(withH.mods.sources.some((s) => s.name === 'Healthy' && s.stat === 'lifePoints'), 'Healthy is a recorded LP source');
});
test('Druid Form spells do not inflate permanent Life Points', () => {
  // "Lesser Form of the Hulking Bear" grants +1 LP only WHILE transformed (tag: Form).
  const s = validate({ classes: [{ name: 'Druid', level: 4 }], noviceSpells: ['Lesser Form of the Hulking Bear'] }).stats;
  eq(s.lifePoints, 3, 'Druid L4 stays 3 — form LP is conditional, not a build stat');
});
test('Toughness adds +1 max Life Point (counted once, not per phrasing)', () => {
  // Druid L4 has no class LP bonus, so this isolates the perk's single +1.
  const s = validate({ classLevels: 'Druid 4', purchasedPerks: ['Toughness'] }).stats;
  eq(s.baseLifePoints, 3, 'base 3'); eq(s.lifePoints, 4, '3 + 1');
  eq(s.mods.sources.filter((x) => x.name === 'Toughness').length, 1, 'one source, no double-count');
});
test('Natural Armor lineage advantage adds Natural Armor', () => {
  const s = validate({ classLevels: 'Druid 10', lineage: 'Oaksworn', lineageAdvantages: ['Hardened Flesh (Dryad)'] }).stats;
  eq(s.naturalArmor, 2, '+2 Natural Armor from Hardened Flesh');
});

// ─── Class Powers (classSkills) are buyable + cost BP ─────────────────────────
test('Class Powers are eligible per class and cost their BP', () => {
  const mage = eligiblePowers('Mage', 'classSkills');
  ok(mage.length >= 3, 'Mage has class skills');
  ok(mage.some((p) => p.name === 'Arcane Charge'), 'Arcane Charge is offered');
  const s = computeSpend({ classLevels: 'Mage 10', classPowers: ['Cantrip Scholar'] });
  eq(s.byItem['classPowers:Cantrip Scholar'].cost, 4, 'Cantrip Scholar costs 4 BP');
  eq(s.net, 4, 'counted in spend');
});
test('sub-powers are filtered out of eligiblePowers', () => {
  const clericSpells = eligiblePowers('Cleric', 'spellsKnown');
  ok(!clericSpells.some(p => p.name === 'Holy Rest'), 'Holy Rest (SubPower) is not offered directly');
  ok(clericSpells.some(p => p.name === 'Prayer of Rest'), 'Prayer of Rest (Novice) is offered');
});

test('directly selecting a sub-power fails validation', () => {
  const c = {
    classLevels: 'Cleric 4',
    noviceSpells: ['Holy Rest']
  };
  const r = validate(c);
  ok(!r.valid, 'Character with sub-power directly selected is invalid');
  ok(r.prereqs.issues.some(i => i.item === 'Holy Rest' && i.text.includes('is a sub-power')), 'Validation flags Holy Rest');
});

test('selecting parent power grants sub-powers correctly', () => {
  const c = {
    classLevels: 'Cleric 4',
    noviceSpells: ['Prayer of Rest']
  };
  const r = validate(c);
  ok(r.grantedAbilities.list.some(g => g.abilityName === 'Holy Rest' && g.source === 'Prayer of Rest'), 'Holy Rest is granted by Prayer of Rest');
});


// ─── multi-rank skills, perks, class powers, and instance-based skills ────────
test('getMaxRanks returns correct limits from JSON metadata', () => {
  eq(getMaxRanks('Spell-Scholar', 'purchasedSkills'), 12, 'Spell-Scholar max ranks');
  eq(getMaxRanks('Bookcaster', 'purchasedSkills'), Infinity, 'Bookcaster max ranks');
  eq(getMaxRanks('Agile Learner', 'purchasedSkills'), 3, 'Agile Learner max ranks');
  eq(getMaxRanks('Custom Brew', 'classPowers'), 3, 'Custom Brew class power max ranks');
});

test('ranks: computeSpend calculates correctly for multi-rank skills', () => {
  const c = {
    classLevels: 'Mage 4',
    purchasedSkills: ['Spell-Scholar'],
    ranks: { purchasedSkills: [3] }
  };
  const s = computeSpend(c);
  eq(s.byItem['purchasedSkills:Spell-Scholar'].cost, 12, 'Spell-Scholar rank 3 costs 4 * 3 = 12');
});

test('dedupe: unlimited-ranks (instance-based) skills are not collapsed', () => {
  const c = {
    classLevels: 'Mage 4',
    purchasedSkills: ['Bookcaster (Identify)', 'Bookcaster (Mageskin)'],
    ranks: { purchasedSkills: [1, 1] }
  };
  const r = validate(c);
  eq(r.spend.net, 2, 'Two instances of Bookcaster cost 1 each, net 2 BP');
  // Verify both instances are kept in the owned skills list
  const ownedSkills = r.owned.skills.map(s => s.name);
  ok(ownedSkills.includes('Bookcaster (Identify)'), 'Includes Identify');
  ok(ownedSkills.includes('Bookcaster (Mageskin)'), 'Includes Mageskin');
});

test('dedupe: class starting Bookcaster skills + additional purchased Bookcaster', () => {
  const c = {
    classes: [{ name: 'Mage', level: 4 }], // starts with Bookcaster, Bookcaster
    startingSkills: ['Bookcaster (Magekey)', 'Bookcaster (Mask Aura)'],
    purchasedSkills: ['Bookcaster (Identify)'],
    ranks: { startingSkills: [1, 1], purchasedSkills: [1] }
  };
  const r = validate(c);
  // Mage starting Bookcaster is free. Purchased Bookcaster should cost 1 BP.
  eq(r.spend.byItem['purchasedSkills:Bookcaster (Identify)'].cost, 1, 'Purchased Bookcaster costs 1 BP');
  eq(r.spend.net, 1, 'Total spend net should be 1 BP (purchased Bookcaster)');
});

test('export/import: round-tripping with ranks and instances preserves rank & parameters', () => {
  const c = {
    classLevels: 'Mage 5',
    purchasedSkills: ['Spell-Scholar', 'Bookcaster (Identify)', 'Bookcaster (Mageskin)'],
    ranks: { purchasedSkills: [3, 1, 1] }
  };
  const orig = validate(c);
  const sheet = formatCharacterSheet(c, orig);
  ok(sheet.includes('Spell-Scholar x3 - 12 BP'), 'Prints rank and total BP for Spell-Scholar');
  ok(sheet.includes('Bookcaster (Identify) - 1 BP'), 'Prints Bookcaster (Identify)');
  ok(sheet.includes('Bookcaster (Mageskin) - 1 BP'), 'Prints Bookcaster (Mageskin)');

  const rt = parseCharacterSheet(sheet);
  // Verify parsed array matches
  eq(rt.purchasedSkills.length, 3, 'rt three purchased skills');
  ok(rt.purchasedSkills.includes('Spell-Scholar x3'), 'rt includes Spell-Scholar with rank string suffix');
  
  const rtValidated = validate(rt);
  eq(rtValidated.spend.net, orig.spend.net, 'round-trip spend net');
  eq(rtValidated.spend.byItem['purchasedSkills:Spell-Scholar x3'].rank, 3, 'round-trip Spell-Scholar rank');
  eq(rtValidated.spend.byItem['purchasedSkills:Bookcaster (Identify)'].rank, 1, 'round-trip Bookcaster (Identify) rank');
});

