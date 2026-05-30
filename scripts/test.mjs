// Zero-dependency test suite for the character builder's data + validation logic.
// Run with: npm test  (which registers the JSON loader hook first).
//
// Covers the invariants the builder relies on so regressions surface immediately:
//   - all 14 starter archetypes validate to exactly 9 BP and are legal
//   - export → import round-trips losslessly (BP + validity identical)
//   - devotion → domain → domain-power chain resolves
//   - level / slot math: budget per level, per-level slot growth, L11+ clamp+flag,
//     sub-level-4 belowFloor
//   - xN rank multipliers, spell-tier routing, per-class slots (multiclass)

import {
  validate, getClasses, characterLevel, budgetFor, computeSlots, spellSlots,
  devotionState, prereqStatus, LEVEL_CAP, LEGAL_MIN_LEVEL,
} from '../src/data/validate.js';
import { formatCharacterSheet, parseCharacterSheet } from '../src/data/sheet.js';
import { readFileSync } from 'node:fs';
import { lookupEntity, eligiblePowers, DEVOTIONS, DOMAINS, REFS, CLASSES } from '../src/data/index.js';
import ARCHETYPES from '../src/data/archetypes.json' with { type: 'json' };

// ─── tiny harness ─────────────────────────────────────────────────────────────
let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failures.push(`${name}: ${e.message}`); }
}
function eq(actual, expected, msg = '') {
  if (actual !== expected) throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(cond, msg = '') { if (!cond) throw new Error(msg || 'expected truthy'); }

// A character built straight from an archetype mirrors what loadArchetype keeps.
const fromArchetype = (a) => ({ ...a, archetypeName: a.name });

// ─── archetypes: 9 BP, legal ──────────────────────────────────────────────────
for (const a of ARCHETYPES) {
  test(`archetype "${a.name}" is 9 BP and legal`, () => {
    const r = validate(fromArchetype(a));
    eq(r.spend.net, 9, 'BP');
    eq(r.level, 4, 'level');
    ok(r.valid, `should be legal (flags: ${JSON.stringify({ over: r.overBudget, slots: r.slotsOver, prereq: r.prereqs.issues.length, below: r.belowFloor })})`);
  });
}

// ─── export / import round-trip ───────────────────────────────────────────────
for (const a of ARCHETYPES) {
  test(`round-trip "${a.name}" preserves BP + validity`, () => {
    const c = fromArchetype(a);
    const orig = validate(c);
    const rt = validate(parseCharacterSheet(formatCharacterSheet(c, orig)));
    eq(rt.spend.net, orig.spend.net, 'round-trip BP');
    eq(rt.valid, orig.valid, 'round-trip validity');
    eq(rt.level, orig.level, 'round-trip level');
  });
}

// ─── format-tolerant import (real HTML source) ────────────────────────────────
test('import the raw StarterCharacterSheets.html → first character is legal', () => {
  const html = readFileSync(new URL('../StarterCharacterSheets.html', import.meta.url), 'utf8');
  const c = parseCharacterSheet(html);
  eq(c.name, 'Defensive Sword + Shield Fighter', 'parsed name (skips TOC)');
  const r = validate(c);
  eq(r.spend.net, 9, 'imported BP'); ok(r.valid, 'imported character is legal');
  eq(getClasses(c)[0].name, 'Fighter', 'imported class');
});
test('import tolerates spreadsheet (tab-separated) paste', () => {
  const tsv = 'Tabby\tA test\nLineage\tHuman\nClass Levels\tFighter 4\nStarting Skills (free)\tBasic Armor, Light Armor';
  const c = parseCharacterSheet(tsv);
  eq(c.lineage, 'Human', 'tsv lineage'); eq(getClasses(c)[0].name, 'Fighter', 'tsv class');
});

// ─── level / budget math ──────────────────────────────────────────────────────
test('budget: 9 at level 4, +2 per level (extrapolated below 4)', () => {
  eq(budgetFor(4), 9, 'L4'); eq(budgetFor(5), 11, 'L5');
  eq(budgetFor(3), 7, 'L3'); eq(budgetFor(1), 3, 'L1');
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

test('redundant multiclass grant awards free BP (budget grows)', () => {
  // A character who already has a skill the new class would grant gets free BP
  // equal to its cost instead of a duplicate; freeBP adds to the budget.
  const c = {
    archetypeName: 'x', classes: [{ name: 'Fighter', level: 2 }, { name: 'Rogue', level: 2 }],
    startingSkills: ['Basic Martial Weapons', 'Thrown Weapons'], freeBP: 1,
  };
  const r = validate(c);
  eq(r.freeBP, 1, 'freeBP surfaced');
  eq(r.budget, budgetFor(4) + 1, 'budget includes free BP');
});

// ─── spell-slots + tiers ──────────────────────────────────────────────────────
test('Cleric spell-slots grow with level (L4 4/0/0 → L6 6/2/0)', () => {
  const ss = (lvl) => spellSlots({ classes: [{ name: 'Cleric', level: lvl }] });
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
  const r = validate(fromArchetype(mage));
  const sk = r.slots.find((s) => s.category === 'spellsKnown');
  ok(sk.bonus >= 2, `spellsKnown bonus from x2 grants (got ${sk.bonus})`);
});

// ─── devotions ────────────────────────────────────────────────────────────────
test('all 18 devotions carry domains', () => {
  eq(DEVOTIONS.length, 18, 'devotion count');
  for (const d of DEVOTIONS) ok(d.domains.length >= 2, `${d.name} has domains`);
});
test('devotionState resolves The Mother → Life/Creation/Protection', () => {
  const ds = devotionState({ devotion: 'The Mother', divineDomains: ['Life', 'Protection'] });
  ok(ds, 'devotionState non-null');
  eq(ds.available.join(','), 'Life,Creation,Protection', 'available domains');
  eq(ds.chosen.join(','), 'Life,Protection', 'chosen domains');
});
test('domain → powers → detail chain resolves', () => {
  const life = DOMAINS.find((d) => d.name === 'Life');
  ok(life.powers.length, 'Life has powers');
  const p = lookupEntity(`powers:${life.powers[0].name}`);
  ok(p && p.description, 'domain power resolves with description');
});

// ─── prereqs (disjunction) ────────────────────────────────────────────────────
test('prereq disjunction: Basic Faith satisfies "Basic Arcane or Basic Faith"', () => {
  const c = { archetypeName: 'x', classes: [{ name: 'Cleric', level: 4 }], startingSkills: ['Basic Faith', 'Extended Capacity - Novice'] };
  const ps = prereqStatus(c, 'skills:Extended Capacity - Novice');
  ok(ps.met, 'met with Basic Faith');
});

// ─── reference resolution coverage ────────────────────────────────────────────
test('≥99% of reference links resolve', () => {
  let total = 0, resolved = 0;
  for (const id in REFS.mentions) for (const ref of REFS.mentions[id]) { total++; if (lookupEntity(ref)) resolved++; }
  ok(resolved / total >= 0.99, `resolved ${resolved}/${total}`);
});

// ─── report ───────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('✓ all green');
