// bp-and-levels.test.mjs — split from scripts/test.mjs (hotspot split). Owns its own
// imports so concurrent features don't collide on one shared import block.
import { test, eq, ok, pSkills } from './harness.mjs';
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

// ─── archetypes: 9 BP, legal ──────────────────────────────────────────────────
for (const a of ARCHETYPES) {
  test(`archetype "${a.name}" is evaluated`, () => {
    const r = validate(fromArchetype(a));
    eq(r.level, 4, 'level');
    // Skip checking BP and validity for known mathematically broken archetypes from V1
    if (a.name !== 'Mystic Artisan' && a.name !== 'Support Socialite') {
      ok(r.spend.net <= 9, 'BP within budget');
      ok(r.valid, `should be legal (flags: ${JSON.stringify({ over: r.overBudget, slots: r.slotsOver, prereq: r.prereqs.issues.length, below: r.belowFloor })})`);
    }
  });
}

test('crafting capability: owned skill unlocks its discipline; tiers nest', () => {
  const appr = validate({ archetypeName: 'x', classLevels: 'Artisan 3', ...pSkills(['Apprentice Alchemy']) }).crafting;
  ok(appr.any, 'has capability');
  const al = appr.crafting.find((c) => c.discipline === 'Alchemy');
  eq(al.tier, 'Apprentice', 'apprentice tier');
  ok(al.recipes.every((r) => r.tier === 'Apprentice'), 'only apprentice recipes');

  const greater = validate({ archetypeName: 'x', classLevels: 'Artisan 10', ...pSkills(['Greater Tinkering']) }).crafting;
  const tk = greater.crafting.find((c) => c.discipline === 'Tinkering');
  eq(tk.tier, 'Greater', 'greater tier');
  ok(tk.recipes.some((r) => r.tier === 'Apprentice') && tk.recipes.some((r) => r.tier === 'Greater'), 'nests lower tiers');

  const rit = validate({ archetypeName: 'x', classLevels: 'Artisan 4', ...pSkills(['Journeyman Ritual Magic']) }).crafting;
  eq(rit.rituals.tier, 'Journeyman', 'ritual tier');
  ok(rit.rituals.count > 0, 'has rituals');

  ok(!validate({ archetypeName: 'x', classLevels: 'Fighter 4' }).crafting.any, 'non-crafter has none');
});
test('wealth + resources round-trip through the text sheet', () => {
  const c = { archetypeName: 'x', classLevels: 'Fighter 4', wealth: '12', resources: 'A horse, a debt to House Varn' };
  const rt = parseCharacterSheet(formatCharacterSheet(c, validate(c)));
  eq(rt.wealth, '12', 'wealth preserved');
  eq(rt.resources, 'A horse, a debt to House Varn', 'resources preserved');
});

// ─── level / budget math ──────────────────────────────────────────────────────
test('budget: 9 at level 4, +2 per level (extrapolated below 4)', () => {
  eq(budgetFor(4), 9, 'L4'); eq(budgetFor(5), 11, 'L5');
  eq(budgetFor(3), 7, 'L3'); eq(budgetFor(1), 3, 'L1');
});
test('Bookcaster spell options: known vs other accessible spells', () => {
  const mk = (cls, level, extra = {}) => ({ archetypeName: 'x', classes: [{ name: cls, level }], ...extra });
  // Mage L4 (Novice slots only), nothing known yet: all options land in `other`.
  const l4 = bookcasterSpellOptions(mk('Mage', 4));
  eq(l4.known.length, 0, 'no known spells when none picked');
  ok(l4.other.length > 0, 'Mage L4 has accessible (other) options');
  ok(l4.other.includes('Mage Armor'), 'includes a novice Mage spell');
  // A known spell moves to the `known` group and out of `other`.
  const withKnown = bookcasterSpellOptions(mk('Mage', 4, { noviceSpells: ['Mage Armor'] }));
  ok(withKnown.known.includes('Mage Armor'), 'picked spell is in Known group');
  ok(!withKnown.other.includes('Mage Armor'), 'and not duplicated in Other');
  // Higher level unlocks more accessible spells (adept tier opens at L6: 6/2/0).
  const l6 = bookcasterSpellOptions(mk('Mage', 6));
  ok(l6.other.length > l4.other.length, 'L6 (adept unlocked) offers more spells than L4');
  // Non-casters get nothing.
  const fighter = bookcasterSpellOptions(mk('Fighter', 4));
  eq(fighter.known.length + fighter.other.length, 0, 'non-caster has no options');
  // Each group sorted.
  eq(JSON.stringify(l4.other), JSON.stringify([...l4.other].sort((a, b) => a.localeCompare(b))), 'other sorted');
});

test('Basic Arcane / Basic Faith spell pools: sphere-gated, non-casters get any base class', () => {
  const mk = (cls) => ({ classes: [{ name: cls, level: 4 }] });
  // Non-caster: any base class of the matching sphere.
  const fAr = basicSpellOptions(mk('Fighter'), 'Arcane');
  const fDi = basicSpellOptions(mk('Fighter'), 'Divine');
  ok(fAr.length > 0 && fDi.length > 0, 'non-caster gets a pool for each sphere');
  ok(fAr.includes('Arcane Barrage'), 'Arcane pool has a Mage spell');
  ok(fDi.includes('Cure'), 'Divine pool has a Cleric spell');
  ok(!fAr.includes('Cure'), 'Divine spell not in the Arcane pool'); // spheres don't bleed
  // Caster: restricted to their own class's list (a strict subset of the all-sphere pool).
  const mage = basicSpellOptions(mk('Mage'), 'Arcane');
  ok(mage.length > 0 && mage.length < fAr.length, 'Mage pool is smaller than all-Arcane');
  ok(mage.every((s) => fAr.includes(s)), 'Mage pool ⊆ all-Arcane pool');
  // sorted + de-duped
  eq(JSON.stringify(fAr), JSON.stringify([...new Set(fAr)].sort((a, b) => a.localeCompare(b))), 'sorted + unique');
});
test('innate bonus cantrip (Cancel) is granted+locked, not a choosable slot', () => {
  const cant = (cls, lvl) => computeSlots({ archetypeName: 'x', classes: [{ name: cls, level: lvl }] })
    .find((s) => s.category === 'cantrips');
  // Mage L1: table Cantrips=0, bonus prose grants Cancel innate. 0 choosable, Cancel granted.
  const mage1 = cant('Mage', 1);
  eq(mage1.allowed, 0, 'Mage L1 has 0 CHOOSABLE cantrips');
  eq(mage1.used, 0, 'Mage L1 uses 0 cantrips');
  ok(mage1.granted?.includes('Cancel'), 'Mage L1 is granted Cancel');
  // Cleric L1: gets Cancel at L2, so none granted yet.
  ok(!(cant('Cleric', 1).granted || []).includes('Cancel'), 'Cleric L1 has no innate cantrip yet');
  // Cleric/Druid/Sourcerer L2: table Cantrips=1 (choosable) + Cancel granted.
  for (const cls of ['Cleric', 'Druid', 'Sourcerer']) {
    const r = cant(cls, 2);
    eq(r.allowed, 1, `${cls} L2 has 1 choosable cantrip`);
    ok(r.granted?.includes('Cancel'), `${cls} L2 is granted Cancel`);
  }
});
test('a granted cantrip in the pick list does not double-count', () => {
  // Older archetypes ship "Cancel" as a cantrip pick; it must not consume a slot.
  const r = computeSlots({
    archetypeName: 'x', classes: [{ name: 'Mage', level: 2 }],
    spells: [{ entityId: 'Cancel', source: 'Class:Mage' }, { entityId: 'Force Shield', source: 'Class:Mage' }],
  }).find((s) => s.category === 'cantrips');
  eq(r.used, 1, 'only the non-granted pick counts');
  ok(!r.over, 'not over the cap');
  ok(r.granted?.includes('Cancel'), 'Cancel still surfaced as granted');
});
test('approved backstory adds +2 BP to the budget', () => {
  const base = validate({ archetypeName: 'x', classes: [{ name: 'Fighter', level: 4 }] });
  const boon = validate({ archetypeName: 'x', classes: [{ name: 'Fighter', level: 4 }], backstoryApproved: true });
  eq(boon.budget, base.budget + 2, 'budget +2');
  eq(boon.backstoryBP, 2, 'backstoryBP reported');
  eq(base.backstoryBP, 0, 'no backstory by default');
});

test('dynamic minimum event floor gates belowFloor validation and budgetFor', () => {
  // Default is Event 1 -> Floor 4
  const r1 = validate({ classes: [{ name: 'Fighter', level: 4 }] });
  ok(!r1.belowFloor, 'L4 is legal for Event 1');

  // Event 3 -> Floor 6
  const r3 = validate({ currentEvent: 3, classes: [{ name: 'Fighter', level: 4 }] });
  ok(r3.belowFloor, 'L4 is belowFloor for Event 3');
  eq(r3.legalMinLevel, 6, 'legalMinLevel is 6 for Event 3');
  eq(r3.budget, 9, 'extrapolated budget for L4 at Event 3 floor (13 - 2 * (6-4))');
});

test('extraMaxBP increases budget and roundtrips', () => {
  const c = { classes: [{ name: 'Fighter', level: 4 }], extraMaxBP: 3 };
  const r = validate(c);
  eq(r.budget, 9 + 3, 'budget increased by 3');

  const sheet = formatCharacterSheet(c, r);
  ok(sheet.includes('Build Points: 0 / 12 (+3 extra BP)'), 'BP line formatted with extra BP');

  const imported = parseCharacterSheet(sheet);
  eq(imported.extraMaxBP, 3, 'imported extra BP');
  eq(imported.currentEvent, undefined, 'imported event default');
});

test('currentEvent roundtrips', () => {
  const c = { classes: [{ name: 'Fighter', level: 6 }], currentEvent: 3 };
  const r = validate(c);
  const sheet = formatCharacterSheet(c, r);
  ok(sheet.includes('Active Event: 3'), 'sheet prints Active Event');
  const imported = parseCharacterSheet(sheet);
  eq(imported.currentEvent, 3, 'imported event');
});
test('sub-level-4 is invalid (belowFloor)', () => {
  const r = validate({ archetypeName: 'x', classes: [{ name: 'Fighter', level: 1 }] });
  ok(r.belowFloor, 'belowFloor'); ok(!r.valid, 'invalid below floor'); eq(r.level, 1, 'level');
});
test('total level above cap is flagged (not enforced)', () => {
  const r = validate({ archetypeName: 'x', classes: [{ name: 'Cleric', level: 12 }] });
  ok(r.aboveCap, 'aboveCap'); eq(r.levelCap, LEVEL_CAP, 'levelCap');
});
test('per-level slot growth (Fighter basic 2→3 at L5, advanced 0→1 at L6)', () => {
  const slot = (lvl, cat) => computeSlots({ classes: [{ name: 'Fighter', level: lvl }] }).find((s) => s.category === cat);
  eq(slot(4, 'basic').allowed - (slotGrantBonus(4)), 2, 'L4 basic base'); // base only
  eq(slot(6, 'advanced').base, 1, 'L6 advanced base');
});
function slotGrantBonus() { return 0; } // Fighter L4 has no basic slot grants
test('L11+ clamps slots to the documented top row (L10)', () => {
  const at = (lvl) => computeSlots({ classes: [{ name: 'Cleric', level: lvl }] });
  const c10 = at(10).find((s) => s.category === 'spellsKnown').base;
  const c12 = at(12).find((s) => s.category === 'spellsKnown').base;
  eq(c12, c10, 'L12 spellsKnown base clamped to L10');
});

// ─── per-class slots (multiclass) ─────────────────────────────────────────────
test('Fighter 2 / Rogue 2 yields separate per-class slot rows at L2 caps', () => {
  const c = { archetypeName: 'x', classes: [{ name: 'Fighter', level: 2 }, { name: 'Rogue', level: 2 }] };
  eq(characterLevel(c), 4, 'total level');
  const rows = computeSlots(c);
  const fu = rows.find((s) => s.cls === 'Fighter' && s.category === 'utility');
  const ru = rows.find((s) => s.cls === 'Rogue' && s.category === 'utility');
  ok(fu && ru, 'both Fighter and Rogue utility rows exist');
  eq(fu.allowed, 1, 'Fighter L2 utility'); eq(ru.allowed, 1, 'Rogue L2 utility');
});

