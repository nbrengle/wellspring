// scripts/test-rules-enforcement.mjs
import { validate } from "../src/engine/validate.js";
import { REFS } from '../src/engine/data.js';
import { makeChar } from './test/make-char.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(readFileSync(join(__dirname, '..', 'src', 'data', f), 'utf8'));

const skills = read('skills.json');
const perks = read('perks.json');
const flaws = read('flaws.json');

console.log("═══ Running Automated Rules Enforcement Mutation Audit ═══\n");

let gapsCount = 0;

function reportGap(category, name, description) {
  gapsCount++;
  console.log(`  ⚠ [${category}] ${name}: ${description}`);
}

// Helper to extract clean name without path prefix
const idName = (id) => id.slice(id.indexOf(':') + 1);

// 1. Verify Prerequisites enforcement
console.log("Checking prerequisite enforcement...");
for (const s of skills) {
  const id = `skills:${s.name}`;
  const pr = REFS.prereqs[id];
  if (pr && (pr.skills.length > 0 || pr.anyOf.length > 0)) {
    // Construct character sheet with this skill parameter if needed, but without prereqs.
    const item = s.parameter ? `${s.name} (Test Parameter)` : s.name;
    const char = makeChar('Fighter 4', { lineage: 'Human', add: [item] });
    const res = validate(char);
    const hasIssue = res.prereqs.issues.some(issue => {
      const issueClean = issue.item.replace(/\s*-\s*\d+\s*BP$/i, '').trim();
      return issueClean === item;
    });
    if (!hasIssue) {
      reportGap('Prerequisite', s.name, 'Missing prerequisites are not flagged as validation issues.');
    }
  }
}

for (const p of perks) {
  const id = `perks:${p.name}`;
  const pr = REFS.prereqs[id];
  if (pr && (pr.skills.length > 0 || pr.anyOf.length > 0)) {
    const char = makeChar('Fighter 4', { lineage: 'Human', add: [p.name] });
    const res = validate(char);
    const hasIssue = res.prereqs.issues.some(issue => {
      const issueClean = issue.item.replace(/\s*-\s*\d+\s*BP$/i, '').trim();
      return issueClean === p.name;
    });
    if (!hasIssue) {
      reportGap('Prerequisite', p.name, 'Missing prerequisites are not flagged as validation issues.');
    }
  }
}

// 2. Verify Level/Other requirements (which are soft notes in validate.js)
console.log("\nChecking Level/Special requirements (soft vs hard)...");
for (const s of skills) {
  const id = `skills:${s.name}`;
  const pr = REFS.prereqs[id];
  if (pr && (pr.levels.length > 0 || pr.other.length > 0)) {
    const item = s.parameter ? `${s.name} (Test Parameter)` : s.name;
    const isCasterRequirement = [...pr.levels, ...pr.other].some(r => r.includes('non-casting') || r.includes('Armor'));
    // below lvl 10, below base classes requirement etc.
    const char = makeChar(isCasterRequirement ? 'Mage 4' : 'Fighter 4', { lineage: 'Human', add: [item] });
    const res = validate(char);
    if (res.valid) {
      reportGap('Soft-Requirement', s.name, `Level/Other requirement (${[...pr.levels, ...pr.other].join('; ')}) is NOT enforced as a hard validation failure.`);
    }
  }
}

for (const p of perks) {
  const id = `perks:${p.name}`;
  const pr = REFS.prereqs[id];
  if (pr && (pr.levels.length > 0 || pr.other.length > 0)) {
    const isCasterRequirement = [...pr.levels, ...pr.other].some(r => r.includes('non-casting') || r.includes('Armor'));
    const char = makeChar(isCasterRequirement ? 'Mage 4' : 'Fighter 4', { lineage: 'Human', add: [p.name] });
    const res = validate(char);
    if (res.valid) {
      reportGap('Soft-Requirement', p.name, `Level/Other requirement (${[...pr.levels, ...pr.other].join('; ')}) is NOT enforced as a hard validation failure.`);
    }
  }
}

// 3. Verify Cost enforcement
console.log("\nChecking cost calculation consistency...");
for (const s of skills) {
  const item = s.parameter ? `${s.name} (Test Parameter)` : s.name;
  // Fighter starting skills: Basic Martial Weapons, Basic Shields, Basic Armor, Light Armor, Great Weapons.
  const fighterStarting = new Set(['Basic Martial Weapons', 'Basic Shields', 'Basic Armor', 'Light Armor', 'Great Weapons']);
  if (fighterStarting.has(s.name)) continue;

  const purchased = [item];
  // Add prerequisites to character sheet so they don't block.
  const pr = REFS.prereqs[`skills:${s.name}`];
  if (pr) {
    for (const dep of pr.skills) purchased.push(idName(dep));
    for (const group of pr.anyOf) {
      if (group.length > 0) purchased.push(idName(group[0]));
    }
  }
  const char = makeChar('Fighter 4', { lineage: 'Human', add: purchased });
  const res = validate(char);
  const itemCostObj = res.spend.byItem[`purchasedSkills:${item}`];
  if (itemCostObj) {
    const expected = s.cost;
    const actual = itemCostObj.cost;
    if (actual !== expected) {
      reportGap('Cost-Mismatch', s.name, `Charged ${actual} BP, database says ${expected} BP.`);
    }
  } else {
    reportGap('Cost-Missing', s.name, 'No spend breakdown returned for this skill.');
  }
}

for (const p of perks) {
  const add = [p.name];
  const pr = REFS.prereqs[`perks:${p.name}`];
  if (pr) {
    for (const dep of pr.skills) {
      if (dep.startsWith('skills:')) add.push(idName(dep));
    }
  }
  const char = makeChar('Fighter 4', { lineage: 'Human', add });
  const res = validate(char);
  const itemCostObj = res.spend.byItem[`purchasedPerks:${p.name}`];
  if (itemCostObj) {
    const expected = p.cost;
    const actual = itemCostObj.cost;
    if (actual !== expected) {
      reportGap('Cost-Mismatch', p.name, `Charged ${actual} BP, database says ${expected} BP.`);
    }
  } else {
    reportGap('Cost-Missing', p.name, 'No spend breakdown returned for this perk.');
  }
}

for (const f of flaws) {
  const char = makeChar('Fighter 4', { lineage: 'Human', add: [f.name] });
  const res = validate(char);
  const itemCostObj = res.spend.byItem[`flaws:${f.name}`];
  if (itemCostObj) {
    const expected = -parseInt(f.bp, 10);
    const actual = itemCostObj.cost;
    if (actual !== expected) {
      reportGap('Cost-Mismatch', f.name, `Charged ${actual} BP, database says ${expected} BP.`);
    }
  } else {
    reportGap('Cost-Missing', f.name, 'No spend breakdown returned for this flaw.');
  }
}

// 5. Verify mutual-exclusion enforcement (perks/flaws that "cannot be taken with"
//    each other). For each unordered exclusion pair, a character holding BOTH halves
//    must produce a validation issue; and holding just one must NOT.
console.log("\nChecking mutual-exclusion enforcement...");
const seenPairs = new Set();
for (const [id, others] of Object.entries(REFS.excludes || {})) {
  for (const other of others) {
    const key = [id, other].sort().join('|');
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    const a = idName(id), b = idName(other);
    // Both halves → must be flagged. (add[] auto-routes perks/flaws by entity type.)
    const both = makeChar('Fighter 4', { lineage: 'Human', add: [a, b] });
    const flagged = validate(both).prereqs.issues.some((i) => i.excludes === id || i.excludes === other);
    if (!flagged) reportGap('Mutual-Exclusion', `${a} ⊗ ${b}`, 'Holding both halves is not flagged.');
    // One half → must NOT be flagged.
    const oneChar = makeChar('Fighter 4', { lineage: 'Human', add: [a] });
    const falsePos = validate(oneChar).prereqs.issues.some((i) => i.excludes);
    if (falsePos) reportGap('Mutual-Exclusion', a, 'Flagged an exclusion while holding only one half.');
  }
}

// 6. Verify no-duplicate-power enforcement (the general rule behind ECT's "the
//    Power cannot be one the character already has"). Selecting a power twice must
//    be flagged; selecting it once must not.
console.log("\nChecking no-duplicate-power enforcement...");
{
  const dup = validate(makeChar('Fighter 4', { lineage: 'Human', add: ['Parry Blow', 'Parry Blow'] }));
  const dupFlagged = dup.prereqs.issues.some((i) => i.duplicate && i.item === 'Parry Blow');
  if (!dupFlagged) reportGap('Duplicate-Power', 'Parry Blow', 'Selecting the same power twice is not flagged.');
  const single = validate(makeChar('Fighter 4', { lineage: 'Human', add: ['Parry Blow'] }));
  if (single.prereqs.issues.some((i) => i.duplicate)) {
    reportGap('Duplicate-Power', 'Parry Blow', 'Flagged a duplicate while the power was selected only once.');
  }
}

// 7. Verify Elemental Affinity cap (≤2 instances, each a distinct element).
console.log("\nChecking Elemental Affinity cap enforcement...");
{
  const issuesFor = (perks) => validate(makeChar('Fighter 4', { lineage: 'Human', add: perks })).prereqs.issues
    .filter((i) => i.id === 'perks:Elemental Affinity');
  // legal: two distinct elements
  if (issuesFor(['Elemental Affinity (Flame)', 'Elemental Affinity (Ice)']).length) {
    reportGap('Elemental-Affinity', 'two distinct', 'Flagged a legal pair of distinct elements.');
  }
  // illegal: three instances
  if (!issuesFor(['Elemental Affinity (Flame)', 'Elemental Affinity (Ice)', 'Elemental Affinity (Acid)']).some((i) => /at most twice/.test(i.text))) {
    reportGap('Elemental-Affinity', 'three instances', 'Taking it >2 times is not flagged.');
  }
  // illegal: same element twice
  if (!issuesFor(['Elemental Affinity (Flame)', 'Elemental Affinity (Flame)']).some((i) => /different element/.test(i.text))) {
    reportGap('Elemental-Affinity', 'duplicate element', 'Attuning to the same element twice is not flagged.');
  }
}

console.log(`\n═══ Audit Complete. Found ${gapsCount} gaps. ═══`);
