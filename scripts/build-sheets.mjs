// build-sheets.mjs — generates IMPORTABLE character sheets for the standout builds
// found by the power-search (POWER_FINDINGS.md) plus the strongest PURE (single-
// class) build per class. Writes plain-text sheets to ./sheets/ that round-trip
// through the builder's Import/Export. NOT archetypes — just sheets to import.
//
// Run: node --import ./scripts/register-json.mjs scripts/build-sheets.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../src/data/validate.js';
import { formatCharacterSheet } from '../src/data/sheet.js';
import { CLASS_POWERS, REFS } from '../src/data/index.js';
import EFFECT_WEIGHTS from '../src/data/effect-weights.json' with { type: 'json' };

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'sheets');
mkdirSync(OUT, { recursive: true });

// ── effect-power scoring (mirrors power-search) ───────────────────────────────
const WEIGHT = { effects: EFFECT_WEIGHTS.effects, conditions: EFFECT_WEIGHTS.conditions, defenses: EFFECT_WEIGHTS.defenses };
const freqMult = (r0) => {
  const r = String(r0 || '').toLowerCase();
  if (/at[- ]?will|immediate|instantaneous|quick|focus/.test(r)) return 3;
  if (/short rest/.test(r)) return 2;
  if (/spell/.test(r)) return 1.5;
  if (/long rest/.test(r)) return 1;
  if (/event|special|once/.test(r)) return 0.5;
  return 1;
};
const rawPower = (id) => (REFS.mentions[id] || [])
  .reduce((s, t) => { const [ty, n] = [t.slice(0, t.indexOf(':')), t.slice(t.indexOf(':') + 1)]; return s + ((WEIGHT[ty] && WEIGHT[ty][n]) || 0); }, 0);

// Every power a class can hold, scored by frequency-weighted effect power.
function classPowers(cls) {
  const out = [];
  for (const [tier, arr] of Object.entries(CLASS_POWERS[cls] || {})) {
    if (!Array.isArray(arr)) continue;
    for (const p of arr) {
      const score = rawPower(`powers:${p.name}`) * freqMult(p.refresh);
      if (score > 0) out.push({ name: p.name, tier, score });
    }
  }
  return out;
}

// Which character field a power's tier fills (so the sheet lists it correctly).
const TIER_FIELD = {
  innate: 'innatePowers', utility: 'utilityPowers', basic: 'basicPowers',
  advanced: 'advancedPowers', veteran: 'veteranPowers', classSkills: 'classPowers',
  rightHandPowers: 'rightHandPowers', cantrips: 'cantrips',
  noviceSpells: 'noviceSpells', adeptSpells: 'adeptSpells', greaterSpells: 'greaterSpells',
};

// Build the strongest LEGAL loadout for a class list: fill each slot the validator
// grants with that class's highest-scoring powers of a matching tier.
function buildStrongest(name, classLevels) {
  const character = { name, archetypeName: 'Custom Build', classLevels };
  const r = validate(character);
  // Pool per class — a slot belongs to ONE class (slot.cls), and a power may only
  // fill its own class's slot (a Cleric slot can't hold a Sourcerer spell).
  const poolByClass = {};
  for (const cls of classLevels.split('/').map((s) => s.trim().split(/\s+/)[0])) {
    poolByClass[cls] = classPowers(cls).sort((a, b) => b.score - a.score);
  }
  const used = new Set();
  for (const slot of r.slots) {
    let n = slot.allowed;
    for (const p of (poolByClass[slot.cls] || [])) {
      if (n <= 0) break;
      if (used.has(p.name)) continue;
      const t = p.tier.toLowerCase();
      const ok = slot.category === 'spellsKnown' ? /spell/.test(t)
        : slot.category === 'cantrips' ? /cantrip/.test(t)
        : t.includes(slot.category);
      if (!ok) continue;
      const field = TIER_FIELD[p.tier] || TIER_FIELD[slot.category] || slot.category;
      (character[field] = character[field] || []).push(p.name);
      used.add(p.name); n--;
    }
  }
  return character;
}

// ── the builds to generate (from POWER_FINDINGS + strongest-per-class) ────────
const BASE_CLASSES = Object.keys(CLASS_POWERS).filter((c) => CLASS_POWERS[c].innate || CLASS_POWERS[c].utility || CLASS_POWERS[c].basic || CLASS_POWERS[c].cantrips);

const synergyBuilds = [
  ['Protect Wall (Cleric-Sourcerer)', 'Cleric 5 / Sourcerer 5'],
  ['Grant Engine (Druid-Sourcerer)', 'Druid 5 / Sourcerer 5'],
  ['Cleanse Spammer (Fighter-Socialite)', 'Fighter 5 / Socialite 5'],
  ['Swiss Army (Artisan-Sourcerer)', 'Artisan 5 / Sourcerer 5'],
  ['Grant Power Druid (pure)', 'Druid 10'],
];
const pureBuilds = BASE_CLASSES.map((c) => [`Strongest Pure ${c}`, `${c} 10`]);

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
let wrote = 0;
for (const [name, cl] of [...synergyBuilds, ...pureBuilds]) {
  const c = buildStrongest(name, cl);
  const r = validate(c);
  const text = formatCharacterSheet(c, r);
  writeFileSync(join(OUT, `${slug(name)}.txt`), text);
  const picks = ['innatePowers', 'utilityPowers', 'basicPowers', 'advancedPowers', 'veteranPowers', 'cantrips', 'noviceSpells', 'adeptSpells']
    .reduce((s, f) => s + (c[f]?.length || 0), 0);
  console.log(`  ${name.padEnd(34)} ${cl.padEnd(22)} ${picks} powers, valid:${r.valid}`);
  wrote++;
}
console.log(`\n${wrote} sheets → ${OUT}/`);
