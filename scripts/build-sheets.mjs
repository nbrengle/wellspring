// build-sheets.mjs — generates IMPORTABLE character sheets for the standout builds
// found by the power-search (POWER_FINDINGS.md) plus the strongest PURE (single-
// class) build per class. Writes plain-text sheets to ./sheets/ that round-trip
// through the builder's Import/Export. NOT archetypes — just sheets to import.
//
// Run: node --import ./scripts/register-json.mjs scripts/build-sheets.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, grantedAbilities } from '../src/data/validate.js';
import { formatCharacterSheet } from '../src/data/sheet.js';
import { CLASS_POWERS, REFS, ALL_PERKS, LINEAGES, lookupEntity } from '../src/data/index.js';
import { classPowers, rawPower } from './effect-score.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'sheets');
mkdirSync(OUT, { recursive: true });

// Effect-power scoring (incl. cantrip/accent weighting) is shared with
// power-search via scripts/effect-score.mjs — using it here means the generated
// builds rank powers exactly like the search does.

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

// Value of an entity to a build: effect-power of what it GRANTS (free abilities)
// plus a flat credit for stat boosts / grant edges, so perks/advantages that give
// real stuff outrank flavor ones.
function entityValue(id) {
  const grants = REFS.grants?.[id] || [];
  const grantVal = grants.reduce((s, g) => s + rawPower(g) + 2, 0);   // +2 per granted entity
  const ent = lookupEntity(id);
  const statVal = /(\bmax|Natural Armor|Life Point|Maximum)/i.test(ent?.description || '') ? 2 : 0;
  return grantVal + statVal;
}

// Layer a LINEAGE (challenges fund advantages; advantages grant free abilities +
// stats) and high-value PERKS (bought from the BP budget) onto a built character —
// the big value the power-only generator was missing (user feedback #65).
const subKey = (s) => String(s || '').split(' (')[0].trim().toLowerCase();
function layerPerksAndLineage(character) {
  // 1. Lineage: pick the one whose grant-bearing advantages deliver the most value
  //    WITHIN ONE sublineage (mixing sublineages is illegal). Score each
  //    lineage×sublineage combo by the value of its General + that-sublineage advs.
  let best = null;
  for (const [name, lin] of Object.entries(LINEAGES)) {
    const subs = new Set(['general', ...(lin.advantages || []).map((a) => subKey(a.sublineage))]);
    for (const sub of subs) {
      const inScope = (a) => { const k = subKey(a.sublineage); return k === 'general' || k === sub; };
      const advs = (lin.advantages || []).filter(inScope);
      const val = advs.reduce((s, a) => s + entityValue(`advantages:${name} - ${a.baseName || a.name}`), 0);
      if (!best || val > best.val) best = { name, lin, sub, val };
    }
  }
  if (best && best.val > 0) {
    const inScope = (x) => { const k = subKey(x.sublineage); return k === 'general' || k === best.sub; };
    character.lineage = best.name;
    // Challenges in scope = LBP income (capped at 10).
    character.lineageChallenges = (best.lin.challenges || []).filter(inScope).map((c) => c.name);
    // Advantages in scope, richest first, as far as LBP + validity allow.
    const advs = (best.lin.advantages || []).filter(inScope)
      .map((a) => ({ a, v: entityValue(`advantages:${best.name} - ${a.baseName || a.name}`) }))
      .filter((x) => x.v > 0).sort((x, y) => y.v - x.v);
    character.lineageAdvantages = [];
    for (const { a } of advs) {
      character.lineageAdvantages.push(a.name);
      const r = validate(character);
      if (!r.lbp || r.lbp.overspent || r.lbp.mixedSublineage || r.lbp.missingRequired?.length) character.lineageAdvantages.pop();
    }
  }

  // 2. Perks: spend the BP budget on the highest-value legal perks.
  character.purchasedPerks = character.purchasedPerks || [];
  const perkPool = ALL_PERKS
    .map((p) => ({ name: p.name, cost: p.cost || 0, v: entityValue(`perks:${p.name}`) }))
    .filter((p) => p.v > 0).sort((a, b) => b.v - a.v);
  for (const p of perkPool) {
    if (character.purchasedPerks.includes(p.name)) continue;
    character.purchasedPerks.push(p.name);
    const r = validate(character);
    if (!r.valid || r.overBudget) character.purchasedPerks.pop();
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
  const c = layerPerksAndLineage(buildStrongest(name, cl));
  const r = validate(c);
  const text = formatCharacterSheet(c, r);
  writeFileSync(join(OUT, `${slug(name)}.txt`), text);
  const picks = ['innatePowers', 'utilityPowers', 'basicPowers', 'advancedPowers', 'veteranPowers', 'cantrips', 'noviceSpells', 'adeptSpells']
    .reduce((s, f) => s + (c[f]?.length || 0), 0);
  const freebies = grantedAbilities(c).list.length;
  console.log(`  ${name.padEnd(34)} ${cl.padEnd(22)} ${picks}pw ${c.purchasedPerks?.length || 0}perk ${(c.lineageAdvantages?.length || 0)}adv(${c.lineage || '-'}) ${freebies}free  valid:${r.valid} BP:${r.spend.net}/${r.maxBudget}`);
  wrote++;
}
console.log(`\n${wrote} sheets → ${OUT}/`);
