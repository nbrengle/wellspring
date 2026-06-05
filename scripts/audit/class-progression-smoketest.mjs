// Per-class level 1->10 progression SMOKE TEST.
//
// NOTE: this is a self-consistency check, NOT the rules audit. It builds a
// default character for each base class and levels it 1->10, filling slots and
// running validate() at each step, to catch the builder CONTRADICTING ITSELF
// (a slot that can't be filled, a default build that goes over budget, a prereq
// deadlock). It does NOT tell you whether the builder matches the MegaDoc — for
// that, see RULES_AUDIT.md, which reads the rules text directly. Keep this as a
// regression guard; don't mistake a clean run here for "rules-correct".
//
// For each base class: build a blank level-1 character (as "Start blank" does),
// apply starting abilities, fill each starting-choice block with its FIRST
// option (the UI default), then for levels 1..10 fill open power/spell/cantrip
// slots with the first eligible candidate and run validate().
// `belowFloor` (level < 4) is reported SEPARATELY since it's the builder's
// campaign-floor flag, not a per-rules legality failure for L1-3.

import {
  validate, computeSlots, getClasses, prereqStatus,
} from '../../src/data/validate.js';
import {
  STARTING_CHOICES_CONFIG, hasStartingChoices,
  reconcileStartingChoices, rebuildStartingSkills,
} from '../../src/data/starting-choices.js';
import { eligiblePowers, CLASS_POWERS } from '../../src/data/index.js';

const SLOT_FIELD = {
  cantrips: 'cantrips', spellsKnown: 'noviceSpells',
  utility: 'utilityPowers', basic: 'basicPowers', advanced: 'advancedPowers',
  veteran: 'veteranPowers', classPower: 'classPowers', rightHand: 'rightHandPowers',
};

const EMPTY = {
  classes: [], skills: [], startingSkills: [], purchasedSkills: [],
  perks: [], flaws: [], innatePowers: [], utilityPowers: [], basicPowers: [],
  advancedPowers: [], veteranPowers: [], classPowers: [], rightHandPowers: [],
  cantrips: [], noviceSpells: [], adeptSpells: [], greaterSpells: [], bookSpells: [],
  choices: {}, startingChoices: {}, ranks: {},
};

const CLASSES = Object.keys(CLASS_POWERS); // every class with a power table

// Build a fresh level-1 character for `cls`, choosing the first option of every
// starting-choice block (mirrors the dropdown default the UI picks).
function buildL1(cls) {
  let c = { ...structuredClone(EMPTY), archetypeName: 'Sweep Build', classes: [{ name: cls, level: 1 }] };
  if (hasStartingChoices(cls)) {
    const choices = {};
    for (const conf of STARTING_CHOICES_CONFIG[cls]) choices[conf.id] = conf.options[0].label;
    c.startingChoices = choices;
    c = rebuildStartingSkills(c, cls, choices);
  } else {
    // No choice blocks: reconcile gives the fixed base grants.
    c.startingChoices = reconcileStartingChoices(c, cls);
    c = rebuildStartingSkills(c, cls, c.startingChoices);
  }
  return c;
}

// Fill every open power/spell/cantrip slot for the character's classes with the
// first UNLOCKED eligible candidate, as a player using the picker (hide-locked)
// would. Returns { character, unfilled: [{slot, short}] } where `short` is how
// many slots could not be filled from unlocked candidates — a real finding.
function fillOpenSlots(character) {
  let c = structuredClone(character);
  for (let pass = 0; pass < 8; pass++) {
    const slots = computeSlots(c);
    let changed = false;
    for (const slot of slots) {
      const need = slot.allowed - slot.used;
      if (need <= 0) continue;
      const cands = eligiblePowers(slot.cls, slot.category);
      if (!cands.length) continue;
      const field = SLOT_FIELD[slot.category];
      const owned = new Set(c[field] || []);
      let added = 0;
      for (const cand of cands) {
        if (added >= need) break;
        if (owned.has(cand.name)) continue;
        // Only pick candidates whose prereqs are currently met (UI hide-locked).
        if (!prereqStatus(c, `powers:${cand.name}`).met) continue;
        c[field] = [...(c[field] || []), cand.name];
        c.powerClass = c.powerClass || {};
        c.powerClass[field] = c.powerClass[field] || {};
        c.powerClass[field][c[field].length - 1] = slot.cls;
        owned.add(cand.name);
        added++; changed = true;
      }
    }
    if (!changed) break;
  }
  // After filling, report any category still short.
  const unfilled = [];
  for (const slot of computeSlots(c)) {
    if (slot.used < slot.allowed) unfilled.push({ label: slot.label, used: slot.used, allowed: slot.allowed });
  }
  return { character: c, unfilled };
}

function summarize(rep) {
  const s = [];
  if (rep.overBudget) s.push(`OVER BUDGET (spend ${rep.spend.net} > ${rep.budget})`);
  if (rep.slotsOver) {
    const over = rep.slots.filter((x) => x.over).map((x) => `${x.label} ${x.used}/${x.allowed}`);
    s.push(`SLOTS OVER: ${over.join(', ')}`);
  }
  if (rep.prereqs?.issues?.length) s.push(`PREREQ: ${rep.prereqs.issues.map((i) => i.text || i.entity || JSON.stringify(i)).join('; ')}`);
  if (rep.lbp && !rep.lbp.valid) s.push(`LBP invalid`);
  return s;
}

const report = {};
for (const cls of CLASSES) {
  const rows = [];
  let c = buildL1(cls);
  for (let lvl = 1; lvl <= 10; lvl++) {
    c.classes = [{ name: cls, level: lvl }];
    const filled = fillOpenSlots(c);
    c = filled.character;
    const rep = validate(c);
    const issues = summarize(rep);
    if (filled.unfilled.length) {
      issues.push(`UNFILLED SLOTS: ${filled.unfilled.map((u) => `${u.label} ${u.used}/${u.allowed}`).join(', ')}`);
    }
    rows.push({
      lvl,
      valid: rep.valid,
      belowFloor: rep.belowFloor,
      spend: `${rep.spend.net}/${rep.budget}`,
      slots: rep.slots.map((s) => `${s.label} ${s.used}/${s.allowed}`).join('  '),
      issues,
    });
  }
  report[cls] = rows;
}

// Print a compact table per class.
for (const cls of CLASSES) {
  console.log(`\n=== ${cls} ===`);
  const l1 = buildL1(cls);
  console.log(`  L1 starting skills: ${(l1.startingSkills || []).join(', ')}`);
  for (const r of report[cls]) {
    const flag = r.issues.length ? '✗' : (r.belowFloor ? '·' : '✓');
    const note = r.issues.length ? '  ' + r.issues.join(' | ') : (r.belowFloor ? '(below L4 floor)' : '');
    console.log(`  L${String(r.lvl).padStart(2)} ${flag} BP ${r.spend.padEnd(7)} | ${r.slots}${note}`);
  }
}

// Aggregate: which classes have rule issues at levels >= 4 (real legality)?
console.log(`\n=== SUMMARY (real rule issues at L4+) ===`);
for (const cls of CLASSES) {
  const bad = report[cls].filter((r) => r.lvl >= 4 && r.issues.length);
  if (bad.length) console.log(`  ${cls}: levels ${bad.map((b) => b.lvl).join(',')}`);
}
const clean = CLASSES.filter((cls) => !report[cls].some((r) => r.lvl >= 4 && r.issues.length));
console.log(`  clean at L4+: ${clean.join(', ') || '(none)'}`);
