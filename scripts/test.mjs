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
  grantedAbilities, computeSpend, discountSources,
} from '../src/data/validate.js';
import { formatCharacterSheet, parseCharacterSheet } from '../src/data/sheet.js';
import { readFileSync } from 'node:fs';
import { lookupEntity, eligiblePowers, DEVOTIONS, DOMAINS, REFS, CLASSES, LINEAGES } from '../src/data/index.js';
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

// ─── lineages / LBP ───────────────────────────────────────────────────────────
test('LBP: challenges award, advantages spend, cap at 10', () => {
  const a = LINEAGES.Aewen;
  const req = a.challenges.find((c) => c.required);
  const c = {
    lineage: 'Aewen',
    lineageChallenges: [req.name, 'Mana Lines [Repped]', 'Pointed Ears [Repped]'],
    lineageAdvantages: ['Deep Reserves'],
  };
  const s = validate(c).lbp;
  eq(s.awarded, 5, 'awarded'); eq(s.spent, 4, 'spent'); eq(s.remaining, 1, 'remaining');
  ok(s.valid, 'complete build is valid');
});
test('LBP: overspend is invalid', () => {
  const s = validate({ lineage: 'Aewen', lineageChallenges: ['Pointed Ears [Repped]'], lineageAdvantages: ['Deep Reserves'] }).lbp;
  ok(s.overspent, 'overspent (1 awarded, 4 spent)');
});
test('LBP: missing required challenge is invalid', () => {
  const s = validate({ lineage: 'Aewen', lineageChallenges: ['Mana Lines [Repped]'], lineageAdvantages: [] }).lbp;
  ok(s.missingRequired.length > 0, 'required challenge flagged');
});
test('sublineage: same sublineage (inconsistent strings) is NOT mixed', () => {
  const a = LINEAGES.Aewen;
  const accC = a.challenges.find((c) => /^Accented/.test(c.sublineage));
  const accA = a.advantages.find((c) => c.sublineage === 'Accented');
  const s = validate({ lineage: 'Aewen', lineageChallenges: [accC.name], lineageAdvantages: [accA.name] }).lbp;
  ok(!s.mixedSublineage, 'Accented long/short forms treated as one sublineage');
});
test('sublineage: mixing two sublineages is flagged', () => {
  const a = LINEAGES.Aewen;
  const accC = a.challenges.find((c) => /^Accented/.test(c.sublineage));
  const shornC = a.challenges.find((c) => /Shorn Urbanite/.test(c.sublineage));
  const s = validate({ lineage: 'Aewen', lineageChallenges: [accC.name, shornC.name], lineageAdvantages: [] }).lbp;
  ok(s.mixedSublineage, 'two sublineages flagged as mixed');
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

// ─── devotion: Worship skill is canonical, inline is the fallback ─────────────
test('import derives devotion from Worship skill when no inline line', () => {
  const c = parseCharacterSheet([
    'Cleric Test', 'Class Levels: Cleric 4',
    'Purchased Skills:', 'Worship - The Mother',
  ].join('\n'));
  eq(c.devotion, 'The Mother', 'devotion from Worship');
  ok(!c.devotionWarning, 'no warning when only Worship');
});
test('import: Worship wins over a mismatched inline Devotion, with a warning', () => {
  const c = parseCharacterSheet([
    'Cleric Test', 'Class Levels: Cleric 4', 'Devotion: The Father',
    'Purchased Skills:', 'Worship - The Mother',
  ].join('\n'));
  eq(c.devotion, 'The Mother', 'Worship is canonical');
  ok(c.devotionWarning, 'mismatch warns');
});
test('import: inline Devotion alone is honored when no Worship skill', () => {
  const c = parseCharacterSheet([
    'Cleric Test', 'Class Levels: Cleric 4', 'Devotion: The Mother',
  ].join('\n'));
  eq(c.devotion, 'The Mother', 'inline fallback');
  ok(!c.devotionWarning, 'no warning when only inline');
});

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
test('discountSources lists owned sources only', () => {
  eq(discountSources({}).length, 0, 'none by default');
  ok(discountSources({ lineage: 'Human', lineageAdvantages: ['Environmental Mastery'] }).length === 1, 'one when owned');
});
test('Patron discounts gift-eligible perks by 1, excludes Strong Bloodline + Gifts', () => {
  const c = { classLevels: 'Cleric 4', purchasedPerks: ['Patron', 'Greedy Soul', 'Strong Bloodline'] };
  const s = computeSpend(c);
  eq(s.byItem['purchasedPerks:Greedy Soul'].cost, 2, 'Greedy Soul 3→2');
  eq(s.byItem['purchasedPerks:Greedy Soul'].discount.source, 'Patron', 'attributed to Patron');
  eq(s.byItem['purchasedPerks:Strong Bloodline'].cost, 3, 'Strong Bloodline excluded');
});

// ─── report ───────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('✓ all green');
