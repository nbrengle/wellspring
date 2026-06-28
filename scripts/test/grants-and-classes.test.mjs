// grants-and-classes.test.mjs — split from scripts/test.mjs (hotspot split). Owns its own
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
import { loadArchetype } from '../../src/engine/character-state.js';
import ARCHETYPES from '../../src/data/archetypes.json' with { type: 'json' };
import CLASSES_JSON from '../../src/data/classes.json' with { type: 'json' };

// Regression: every archetype must load — via the REAL loadArchetype path, not a
// hand-built mirror — with its class applied. (Archetypes store classes as an
// object map { Cleric: 4 }; loadArchetype's copy loop used to drop it because
// `classes` isn't a key on EMPTY_CHARACTER, leaving CLASS "not set" wholesale.)
test('loadArchetype: every archetype loads with its class set', () => {
  for (const a of ARCHETYPES) {
    const c = loadArchetype(a);
    const classes = getClasses(c);
    ok(classes.length > 0, `${a.archetypeName || a.name}: class applied`);
    ok(classes.every((x) => x.name && x.level > 0), `${a.archetypeName || a.name}: class has name + level`);
    eq(validate(c).level > 0, true, `${a.archetypeName || a.name}: report has a level`);
  }
});


// A character built straight from an archetype mirrors what loadArchetype keeps.
const fromArchetype = (a) => ({ ...a, archetypeName: a.name });

// ─── innate powers: one dedicated handler, no double-count ────────────────────
test('a stored innate power is materialized once, not double-counted', () => {
  // activeInnatePowers() is the dedicated handler for innatePowers (it merges
  // class-granted + stored, deduped). The generic power-field loop must NOT also
  // iterate innatePowers, or every stored innate power lands in the graph twice.
  const items = resolveCharacterGraph({ classLevels: 'Socialite 4', innatePowers: ['Practiced Manner'] })
    .items.filter((i) => /^Practiced Manner$/.test(i.name));
  eq(items.length, 1, 'Practiced Manner appears exactly once');
  eq(items[0].sourceType, 'innate', 'and via the innate handler, not the generic loop');
});

// ─── cross-class / pick-a-class grants ────────────────────────────────────────
test('Extensive Training routes its bonus slot to the CHOSEN class, attributed', () => {
  const c = { archetypeName: 'x', classes: [{ name: 'Fighter', level: 3 }, { name: 'Rogue', level: 3 }],
    skills: [{ entityId: 'Extensive Training (Rogue)', source: 'Purchased', ranks: 1 }] };
  const rows = computeSlots(c);
  const fu = rows.find((s) => s.cls === 'Fighter' && s.category === 'utility');
  const ru = rows.find((s) => s.cls === 'Rogue' && s.category === 'utility');
  eq(fu.allowed, 1, 'Fighter utility unchanged');
  eq(ru.allowed, 2, 'Rogue utility +1 from Extensive Training');
  ok(ru.bonusFrom.includes('Extensive Training'), 'the bonus slot is attributed to the skill');
});

test('class-choice skills offer only the eligible classes you have', () => {
  const c = { classes: [{ name: 'Fighter', level: 3 }, { name: 'Rogue', level: 2 }, { name: 'Cleric', level: 2 }] };
  eq(eligibleClassChoices(c, 'Extensive Training').sort().join(','), 'Fighter,Rogue', 'non-casting classes only');
  eq(eligibleClassChoices(c, 'Spell-Scholar').join(','), 'Cleric', 'spell-casting classes only');
  const f = { classes: [{ name: 'Fighter', level: 4 }] };
  eq(eligibleClassChoices(f, 'Spell-Scholar').length, 0, 'no caster class → no Spell-Scholar options');
});

test('Agile Learner trades require owning the skill and are capped by its rank', () => {
  const base = (skills, ranks, trades) => computeSlots({ classes: [{ name: 'Fighter', level: 4 }],
    skills: skills.map((s, i) => ({ entityId: s, source: 'Purchased', ranks: ranks[i] || 1 })), agileLearnerTrades: trades });
  const basic = (rows) => rows.find((s) => s.category === 'basic').allowed;
  const advanced = (rows) => rows.find((s) => s.category === 'advanced').allowed;
  // Owns it: trade applies (basic 2→1, advanced 0→1).
  let r = base(['Agile Learner'], [1], { Fighter: 1 });
  eq(basic(r), 1, 'owned: basic -1'); eq(advanced(r), 1, 'owned: advanced +1');
  // Doesn't own it: no trade.
  r = base([], [], { Fighter: 1 });
  eq(basic(r), 2, 'unowned: basic unchanged'); eq(advanced(r), 0, 'unowned: advanced unchanged');
  // Owns 1, requests 3: clamped to capacity 1.
  eq(agileLearnerCapacity({ skills: [{ entityId: 'Agile Learner', source: 'Purchased', ranks: 1 }] }), 1, 'capacity = owned ranks');
  r = base(['Agile Learner'], [1], { Fighter: 3 });
  eq(basic(r), 1, 'over-request clamped: basic -1 only');
});

// ─── multiclass skills ────────────────────────────────────────────────────────
test('every class has parsed multiclassGrants that resolve to entities', () => {
  const cleanName = (n) => n.replace(/\s*\([^)]*\)\s*$/, '').trim();
  for (const name of Object.keys(CLASSES)) {
    const grants = CLASSES[name].multiclassGrants;
    ok(grants.length >= 1, `${name} has multiclass grants`);
    for (const g of grants) {
      ok(lookupEntity(`skills:${cleanName(g.name)}`) || lookupEntity(`perks:${cleanName(g.name)}`),
        `${name} grant "${g.name}" resolves`);
    }
  }
});

test('multiclass grants are derived (new skills free, redundant → free BP)', () => {
  // Rogue (2nd class) grants Basic Martial Weapons (1) + Thrown Weapons (3).
  // The character (a Fighter) already has BMW → that becomes free BP; Thrown is
  // a new free skill. Derived purely from the class list — nothing cached.
  const c = {
    archetypeName: 'x', classes: [{ name: 'Fighter', level: 2 }, { name: 'Rogue', level: 2 }],
    startingSkills: ['Basic Martial Weapons', 'Basic Armor'],
  };
  const r = validate(c);
  const granted = r.multiclassGrants.skills.map((g) => g.name);
  ok(granted.includes('Thrown Weapons'), 'Thrown Weapons granted as new free skill');
  ok(!granted.includes('Basic Martial Weapons'), 'redundant BMW not re-granted');
  eq(r.freeBP, 1, 'redundant BMW → 1 free BP');
  eq(r.budget, budgetFor(4) + 1, 'budget includes free BP');
});

// ─── spell-slots + tiers ──────────────────────────────────────────────────────
test('Cleric spell-slots grow with level (L4 4/0/0 → L6 6/2/0)', () => {
  const ss = (lvl) => spellSlots({ classes: [{ name: 'Cleric', level: lvl }] })?.Divine;
  eq(ss(4).novice, 4, 'L4 novice'); eq(ss(4).adept, 0, 'L4 adept');
  eq(ss(6).novice, 6, 'L6 novice'); eq(ss(6).adept, 2, 'L6 adept');
});
test('spells-known picker offers novice + adept (all learnable tiers)', () => {
  const tiers = new Set(eligiblePowers('Cleric', 'spellsKnown').map((p) => p.tierList));
  ok(tiers.has('noviceSpells'), 'novice offered'); ok(tiers.has('adeptSpells'), 'adept offered');
});

// ─── xN ranks ─────────────────────────────────────────────────────────────────
test('xN rank multiplies a slot-granting skill (Utility Mage Extended Capacity x2)', () => {
  const mage = ARCHETYPES.find((a) => a.name === 'Utility Mage');
  try {
    const r = validate(fromArchetype(mage));
    ok(r.spellSlots.Arcane.novice >= 5, `novice bonus from x2 grants (got ${r.spellSlots.Arcane.novice})`);
  } catch (e) {
    console.error(e.stack);
    throw e;
  }
});

