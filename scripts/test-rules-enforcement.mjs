// scripts/test-rules-enforcement.mjs
import { validate } from '../src/data/validate.js';
import { REFS } from '../src/data/index.js';
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
    const char = {
      lineage: 'Human',
      classLevels: 'Fighter 4',
      purchasedSkills: [item]
    };
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
    const char = {
      lineage: 'Human',
      classLevels: 'Fighter 4',
      purchasedPerks: [p.name]
    };
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
    const char = {
      lineage: 'Human',
      classLevels: 'Fighter 4', // below lvl 10, below base classes requirement etc.
      purchasedSkills: [item]
    };
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
    const char = {
      lineage: 'Human',
      classLevels: 'Fighter 4',
      purchasedPerks: [p.name]
    };
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

  const char = {
    lineage: 'Human',
    classLevels: 'Fighter 4',
    purchasedSkills: [item],
    startingSkills: ['Basic Martial Weapons', 'Basic Shields', 'Basic Armor', 'Light Armor', 'Great Weapons']
  };
  // Add prerequisites to character sheet so they don't block.
  const pr = REFS.prereqs[`skills:${s.name}`];
  if (pr) {
    for (const dep of pr.skills) {
      const depName = idName(dep);
      char.purchasedSkills.push(depName);
    }
    for (const group of pr.anyOf) {
      if (group.length > 0) {
        const depName = idName(group[0]);
        char.purchasedSkills.push(depName);
      }
    }
  }

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
  const char = {
    lineage: 'Human',
    classLevels: 'Fighter 4',
    purchasedPerks: [p.name]
  };
  const pr = REFS.prereqs[`perks:${p.name}`];
  if (pr) {
    char.purchasedSkills = [];
    for (const dep of pr.skills) {
      const depName = idName(dep);
      if (dep.startsWith('skills:')) char.purchasedSkills.push(depName);
    }
  }
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
  const char = {
    lineage: 'Human',
    classLevels: 'Fighter 4',
    flaws: [f.name]
  };
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

console.log(`\n═══ Audit Complete. Found ${gapsCount} gaps. ═══`);
