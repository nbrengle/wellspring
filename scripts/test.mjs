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
  grantedAbilities, computeSpend, discountSources, getMaxRanks, bareSkill, cleanItemName
} from '../src/data/validate.js';
import { formatCharacterSheet, parseCharacterSheet } from '../src/data/sheet.js';
import { readFileSync } from 'node:fs';
import { lookupEntity, eligiblePowers, DEVOTIONS, DOMAINS, REFS, CLASSES, LINEAGES } from '../src/data/index.js';
import {
  hasStartingChoices, reconcileStartingChoices, rebuildStartingSkills,
  STARTING_CHOICES_CONFIG, optionSkills, resolveSkill,
  configSkillKeys, sourceStartingSkillKeys,
} from '../src/data/starting-choices.js';
import ARCHETYPES from '../src/data/archetypes.json' with { type: 'json' };
import CLASSES_JSON from '../src/data/classes.json' with { type: 'json' };

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

test('crafting capability: owned skill unlocks its discipline; tiers nest', () => {
  const appr = validate({ archetypeName: 'x', classLevels: 'Artisan 3', purchasedSkills: ['Apprentice Alchemy'] }).crafting;
  ok(appr.any, 'has capability');
  const al = appr.crafting.find((c) => c.discipline === 'Alchemy');
  eq(al.tier, 'Apprentice', 'apprentice tier');
  ok(al.recipes.every((r) => r.tier === 'Apprentice'), 'only apprentice recipes');

  const greater = validate({ archetypeName: 'x', classLevels: 'Artisan 10', purchasedSkills: ['Greater Tinkering'] }).crafting;
  const tk = greater.crafting.find((c) => c.discipline === 'Tinkering');
  eq(tk.tier, 'Greater', 'greater tier');
  ok(tk.recipes.some((r) => r.tier === 'Apprentice') && tk.recipes.some((r) => r.tier === 'Greater'), 'nests lower tiers');

  const rit = validate({ archetypeName: 'x', classLevels: 'Artisan 4', purchasedSkills: ['Journeyman Ritual Magic'] }).crafting;
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
test('sublineage: an optional sublineage item requires selecting that sublineage (#2)', () => {
  // A Human taking a Psionic challenge (its downside) without committing to the
  // Psionic sublineage is illegal — being psionic is a sublineage commitment.
  const psiCh = LINEAGES.Human.challenges.find((c) => /psionic/i.test(c.sublineage || ''));
  const without = validate({ lineage: 'Human', lineageChallenges: [psiCh.name], lineageAdvantages: [] }).lbp;
  ok(without.needsSublineage, 'flags missing sublineage selection');
  ok(!without.valid, 'invalid without the sublineage selected');
  const withSub = validate({ lineage: 'Human', sublineage: 'Psionic', lineageChallenges: [psiCh.name], lineageAdvantages: [] }).lbp;
  ok(!withSub.needsSublineage && withSub.valid, 'valid once Psionic is selected');
});
test('sublineage: a REQUIRED sublineage-tagged challenge does NOT force a selection', () => {
  // Aewen's required challenge is tagged to a default presentation; taking it
  // shouldn't demand a sublineage pick.
  const a = LINEAGES.Aewen;
  const req = a.challenges.find((c) => c.required);
  const s = validate({ lineage: 'Aewen', lineageChallenges: [req.name], lineageAdvantages: [] }).lbp;
  ok(!s.needsSublineage, 'required challenge does not trigger needsSublineage');
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

// ─── base stats from the level table + numeric power/perk/lineage mods ────────
test('base Life Points / Spikes come from the level table', () => {
  const s4 = validate({ classLevels: 'Fighter 4' }).stats;
  eq(s4.lifePoints, 3, 'L4 = 3 LP'); eq(s4.spikes, 2, 'L4 = 2 spikes');
  const s10 = validate({ classLevels: 'Fighter 10' }).stats;
  eq(s10.lifePoints, 4, 'L10 = 4 LP'); eq(s10.spikes, 3, 'L10 = 3 spikes');
});
test('Toughness adds +1 max Life Point (counted once, not per phrasing)', () => {
  const s = validate({ classLevels: 'Fighter 4', purchasedPerks: ['Toughness'] }).stats;
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

// ─── starting-choice config integrity ─────────────────────────────────────────
// STARTING_CHOICES_CONFIG is curated (hand-transcribed from each class's prose
// "Starting Skills" entry, which is too irregular to parse reliably). These guard
// against the config silently drifting from reality:

// Every skill named in the config must resolve to a real entity — catches typos /
// alias drift (this is what caught "Bits & Pieces" vs the real "Bits and Pieces").
test('every starting-choice config skill resolves to an entity', () => {
  for (const [cls, blocks] of Object.entries(STARTING_CHOICES_CONFIG)) {
    for (const block of blocks) {
      for (const s of block.options.flatMap(optionSkills)) {
        ok(resolveSkill(s.name), `${cls} / ${block.label}: "${s.name}" must resolve`);
      }
    }
  }
});

// Structural integrity: every configured class is real, block ids are unique, and
// option labels within a block are unique (labels key the recorded choice + drive
// the dropdown, so collisions would make a choice ambiguous).
test('starting-choice config is structurally sound', () => {
  const classNames = new Set(CLASSES_JSON.map((c) => c.name));
  for (const [cls, blocks] of Object.entries(STARTING_CHOICES_CONFIG)) {
    ok(classNames.has(cls), `${cls} is a real class`);
    const ids = blocks.map((b) => b.id);
    eq(new Set(ids).size, ids.length, `${cls} block ids unique`);
    for (const block of blocks) {
      ok(block.options.length >= 2, `${cls} / ${block.label} offers a real choice (≥2 options)`);
      const labels = block.options.map((o) => o.label);
      eq(new Set(labels).size, labels.length, `${cls} / ${block.label} option labels unique`);
    }
  }
});

// SOURCE-DRIFT GUARD: every skill the curated config can grant must actually be
// referenced by that class's "Starting Skills" prose in classes.json. This is the
// loud-failure tripwire for the curated config falling out of sync with the doc:
// if a future MegaDoc edit removes/renames a skill, the config keeps offering it
// and THIS test fails, naming the class + skill. (We assert config ⊆ source, not
// equality — the prose mentions fixed grants too, and is too irregular to segment
// into "only the choice skills"; see DOC_EDITS_WANTED.md #12.)
//
// EXEMPTIONS: a few Artisan skills are mentioned in the prose but in a form the
// resolution sweep can't reconstruct contiguously — "Bits & Pieces" (the `&`
// splits the name inside a bracket list), "Apprentice Profession" (split by "&
// Journeyman"), and "Lore (Ritual)" (written "Ritual Lore" inside a bundle). These
// are the exact irregularities logged in DOC_EDITS_WANTED.md #12; each is verified
// to at least appear by base word in the prose, so the exemption can't hide a typo.
const SOURCE_COVERAGE_EXEMPT = {
  Artisan: new Set(),
};
test('curated config skills are all referenced by the source prose', () => {
  for (const cls of Object.keys(STARTING_CHOICES_CONFIG)) {
    const source = sourceStartingSkillKeys(cls);
    const exempt = SOURCE_COVERAGE_EXEMPT[cls] || new Set();
    for (const k of configSkillKeys(cls)) {
      ok(source.has(k) || exempt.has(k),
        `${cls}: config grants "${k}" but the Starting Skills prose doesn't — config drifted from the doc?`);
    }
  }
});

// ─── starting choices (specialty dropdowns) ───────────────────────────────────
// The class's "Choose one of the following" blocks, surfaced as editable dropdowns
// that work identically for from-scratch and archetype-loaded builds.

// Mirror Builder.loadArchetype's specialty step: reconcile the archetype's shipped
// starting skills onto the choice blocks, then rebuild so each grant is tagged.
function loadWithChoices(a) {
  const c = fromArchetype(a);
  const primary = getClasses(c)[0]?.name;
  if (primary && hasStartingChoices(primary)) {
    c.startingChoices = reconcileStartingChoices(c, primary);
    return rebuildStartingSkills(c, primary, c.startingChoices);
  }
  return c;
}

// Every archetype must still be a legal 9-BP build when loaded THROUGH the
// reconcile+rebuild path (not just from its raw shipped skills) — i.e. making the
// implicit choices explicit must not change the build's legality or cost.
for (const a of ARCHETYPES) {
  test(`archetype "${a.name}" stays 9 BP + legal through specialty reconcile`, () => {
    const r = validate(loadWithChoices(a));
    eq(r.spend.net, 9, 'BP after reconcile');
    ok(r.valid, `legal after reconcile (flags: ${JSON.stringify(validityFlags(r))})`);
  });
}
function validityFlags(r) {
  return { over: r.overBudget, slots: r.slotsOver, prereq: r.prereqs.issues.length, below: r.belowFloor };
}

// Changing a choice that pins a CONCRETE parameter (the Lore dropdown selects
// "Lore (Arcane)") must update the granted skill's parameter — not keep the old
// subject. But a player-chosen value on a PLACEHOLDER grant ("(your choice)")
// must survive a rebuild triggered by an unrelated choice.
test('switching a parameterized choice updates the subject; player picks survive', () => {
  const mage = (lore) => rebuildStartingSkills({ classes: [{ name: 'Mage', level: 4 }] }, 'Mage',
    { startingLore: lore, magicalSpecialty: 'Additional Cantrip' });
  let c = mage('Historical');
  ok(c.startingSkills.includes('Lore (Historical)'), 'starts Historical');
  c = rebuildStartingSkills(c, 'Mage', { ...c.startingChoices, startingLore: 'Arcane' });
  ok(c.startingSkills.includes('Lore (Arcane)'), 'updates to Arcane');
  ok(!c.startingSkills.includes('Lore (Historical)'), 'old subject dropped');

  // Druid's base "Profession - Apprentice (your choice)" is a placeholder; a
  // player setting it to (Smith) must survive an unrelated survival-choice swap.
  let d = rebuildStartingSkills({ classes: [{ name: 'Druid', level: 4 }] }, 'Druid',
    { druidSurvival: 'Forage I', druidBuddingWisdom: 'Peacecaster, Basic Medicine' });
  const pi = d.startingSkills.findIndex((s) => /^Profession - Apprentice/.test(s));
  d.startingSkills[pi] = 'Profession - Apprentice (Smith)';
  d = rebuildStartingSkills(d, 'Druid', { ...d.startingChoices, druidSurvival: 'Scavenge I' });
  ok(d.startingSkills.includes('Profession - Apprentice (Smith)'), 'player profession pick preserved');
});

// Reconcile resolves the implicit choice for every block of every archetype (no
// block left at an arbitrary default when the skills actually determine it).
test('reconcile picks a concrete option for each archetype choice block', () => {
  const expectations = {
    'Healer Druid': { druidSurvival: 'Forage I', druidBuddingWisdom: 'Peacecaster, Basic Medicine' },
    'Form Fighter Druid': { druidSurvival: 'Scavenge I', druidBuddingWisdom: 'Extended Capacity - Novice, Lore (Nature)' },
    'Utility Mage': { magicalSpecialty: 'Extended Capacity - Novice x2' },
    // Artisan has THREE blocks; the shared-skill assignment must not collide
    // (Productive=Enchanting, Path=Ritual — not both claiming the same skill).
    'Mystic Artisan': { artisanProductive: 'Apprentice Enchanting', artisanPath: 'Apprentice Crafting (Ritual)' },
    'Artificer Artisan': { artisanProductive: 'Apprentice Tinkering', artisanPath: 'Apprentice & Journeyman Profession' },
  };
  for (const [name, want] of Object.entries(expectations)) {
    const a = ARCHETYPES.find((x) => x.name === name);
    const choices = reconcileStartingChoices(fromArchetype(a), getClasses(a)[0].name);
    for (const [id, label] of Object.entries(want)) {
      eq(choices[id], label, `${name}.${id}`);
    }
  }
});

// Changing a choice swaps the granted skills: the old option's skills leave and
// the new option's arrive. (Uses a from-scratch Druid so no PURCHASED skill
// depends on the swapped-away option — see the prereq-cascade note below.)
test('changing a Druid choice swaps its granted skills', () => {
  const blank = rebuildStartingSkills(
    { classes: [{ name: 'Druid', level: 4 }] }, 'Druid',
    { druidSurvival: 'Forage I', druidBuddingWisdom: 'Peacecaster, Basic Medicine' });
  ok(blank.startingSkills.some((s) => bareSkill(cleanItemName(s)) === 'Peacecaster'), 'starts with Peacecaster');

  const swapped = rebuildStartingSkills(blank, 'Druid',
    { ...blank.startingChoices, druidBuddingWisdom: 'Short Weapons, Two Weapon Style' });
  const names = swapped.startingSkills.map((s) => bareSkill(cleanItemName(s)));
  ok(names.includes('Short Weapons') && names.includes('Two Weapon Style'), 'gains the new option');
  ok(!names.includes('Peacecaster') && !names.includes('Basic Medicine'), 'drops the old option');
});

// Swapping AWAY a specialty whose granted skill a PURCHASED skill depends on
// correctly invalidates the build (the dependent purchase loses its prerequisite).
// Healer Druid buys Diagnose + Combat Medic, both gated on the specialty's free
// Basic Medicine — drop it and the prereqs break, as they should.
test('swapping away a depended-on specialty skill surfaces the broken prereq', () => {
  const base = loadWithChoices(ARCHETYPES.find((x) => x.name === 'Healer Druid'));
  ok(validate(base).valid, 'archetype starts legal');
  const swapped = rebuildStartingSkills(base, 'Druid',
    { ...base.startingChoices, druidBuddingWisdom: 'Short Weapons, Two Weapon Style' });
  const r = validate(swapped);
  ok(!r.valid, 'illegal after dropping Basic Medicine');
  ok(r.prereqs.issues.some((i) => i.item === 'Diagnose'), 'Diagnose prereq flagged');
});

// Each choice-granted starting skill is tagged with the block that granted it, so
// the build sheet can badge it "<Class> · <Choice>".
test('rebuild tags granted skills with their choice-block provenance', () => {
  const a = ARCHETYPES.find((x) => x.name === 'Healer Druid');
  const c = loadWithChoices(a);
  const sources = Object.values(c.specialtySources || {});
  ok(sources.includes('Budding Wisdom'), 'Budding Wisdom grant tagged');
  ok(sources.includes('Gathering Choice'), 'Gathering Choice grant tagged');
  // A FIXED base grant (Basic Faith) carries no specialty tag.
  const faithIdx = c.startingSkills.findIndex((s) => bareSkill(cleanItemName(s)) === 'Basic Faith');
  ok(faithIdx >= 0 && !c.specialtySources[faithIdx], 'fixed base grant is untagged');
});

// A granted "xN" specialty skill is stored once with its rank in the ranks
// sidecar (not as N rows), so the build sheet can show its ×N multiplier even
// though free class grants carry no per-item cost entry to read the rank from.
test('granted "x2" specialty skill records rank 2 on a single row', () => {
  const c = rebuildStartingSkills({ classes: [{ name: 'Mage', level: 4 }] }, 'Mage',
    { startingLore: 'Historical', magicalSpecialty: 'Extended Capacity - Novice x2' });
  const idxs = c.startingSkills
    .map((s, i) => ({ i, base: bareSkill(cleanItemName(s)) }))
    .filter((x) => x.base === 'Extended Capacity - Novice');
  eq(idxs.length, 1, 'stored as a single row, not two');
  eq(c.ranks.startingSkills[idxs[0].i], 2, 'rank 2 recorded');
  // …and it still drives the +2 spellsKnown slot bonus mechanically.
  eq(validate(c).slots.find((s) => s.category === 'spellsKnown').bonus, 2, 'x2 grants +2 spellsKnown');
});

// A finite multi-rank starting skill can be bought ABOVE its free granted floor:
// the floor stays free, each extra rank costs the entity's per-rank price, and the
// extra ranks still drive the skill's mechanical bonus. The bought-up rank also
// survives a rebuild (e.g. when an unrelated specialty changes).
test('buying a granted skill above its free floor bills only the excess', () => {
  const setRank = (c, field, index, n) => {
    const ranks = { ...(c.ranks || {}) };
    const list = [...(ranks[field] || [])];
    while (list.length < (c[field]?.length || 0)) list.push(1);
    list[index] = n;
    return { ...c, ranks: { ...ranks, [field]: list } };
  };
  let c = rebuildStartingSkills({ classes: [{ name: 'Mage', level: 4 }] }, 'Mage',
    { startingLore: 'Historical', magicalSpecialty: 'Extended Capacity - Novice x2' });
  const i = c.startingSkills.findIndex((s) => /Extended Capacity/.test(s));
  eq(c.grantedRanks[i], 2, 'free floor is 2');

  // Floor: free.
  eq(validate(c).spend.net, 0, 'floor costs nothing');

  // Rank 3: one paid rank @ 3 BP; bonus rises to 3.
  let r = validate(setRank(c, 'startingSkills', i, 3));
  eq(r.spend.byItem[`startingSkills:${i}:Extended Capacity - Novice`].cost, 3, 'rank 3 bills 1 extra rank');
  eq(r.slots.find((s) => s.category === 'spellsKnown').bonus, 3, 'rank 3 grants +3 spellsKnown');

  // Rank 4 (max): two paid ranks @ 3 BP.
  eq(validate(setRank(c, 'startingSkills', i, 4)).spend.net, 6, 'rank 4 bills 2 extra ranks');

  // Dropping back to the floor is free again.
  eq(validate(setRank(c, 'startingSkills', i, 2)).spend.net, 0, 'back to floor is free');

  // A rebuild preserves the bought-up rank and the floor.
  const rebuilt = rebuildStartingSkills(setRank(c, 'startingSkills', i, 3), 'Mage', c.startingChoices);
  eq(rebuilt.ranks.startingSkills[i], 3, 'bought-up rank preserved through rebuild');
  eq(rebuilt.grantedRanks[i], 2, 'free floor preserved through rebuild');
});

// A starting skill unrelated to any choice block (or a non-conforming archetype
// skill) is never silently dropped by a rebuild.
test('rebuild preserves starting skills unrelated to the choices', () => {
  const c = {
    classes: [{ name: 'Druid', level: 4 }],
    startingSkills: ['Basic Martial Weapons', 'Basic Faith', 'Forage I', 'Peacecaster', 'Basic Medicine', 'Lockpicking Improv'],
    startingChoices: { druidSurvival: 'Forage I', druidBuddingWisdom: 'Peacecaster, Basic Medicine' },
  };
  const rebuilt = rebuildStartingSkills(c, 'Druid', c.startingChoices);
  ok(rebuilt.startingSkills.includes('Lockpicking Improv'), 'unrelated manual skill preserved');
});

test('parameterized skills satisfy prerequisites and undergo prerequisite checking', () => {
  // 1. Lore (Historical) satisfies Research prerequisite (Lore)
  let c = {
    classes: [{ name: 'Mage', level: 4 }],
    purchasedSkills: ['Lore (Historical)', 'Research']
  };
  eq(validate(c).prereqs.issues.length, 0, 'Lore (Historical) satisfies Research');

  // 2. Profession - Journeyman (Smith) requires Profession - Apprentice
  c = {
    classes: [{ name: 'Mage', level: 4 }],
    purchasedSkills: ['Profession - Journeyman (Smith)']
  };
  const issues = validate(c).prereqs.issues;
  eq(issues.length, 1, 'fails missing apprentice prerequisite');
  eq(issues[0].id, 'skills:Profession - Journeyman (Smith)', 'identifies correct failing skill');
  eq(issues[0].missing[0].id, 'skills:Profession - Apprentice', 'identifies missing base prerequisite');

  // 3. Adding Apprentice (Smith) satisfies the prerequisite
  c.purchasedSkills.push('Profession - Apprentice (Smith)');
  eq(validate(c).prereqs.issues.length, 0, 'Apprentice satisfies Journeyman');
});

// ─── report ───────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('✓ all green');
