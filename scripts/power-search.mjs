// power-search.mjs — stress-tests the data + validator by searching for
// "obnoxiously powerful" but LEGAL characters. It's a probe, not part of the app:
// it leans on the same validate()/REFS the builder uses, so anything it finds is a
// real property of the model (and any illegal-but-accepted build it surfaces is a
// validator hole worth knowing about).
//
// Run: node --import ./scripts/register-json.mjs scripts/power-search.mjs
//
// Strategy — maximize value extracted per BP while staying valid:true:
//   1. Flaw BP farming        — flaws award BP (validator currently uncapped).
//   2. Free-ability grants     — lineage advantages / powers that bestow perks.
//   3. Discount stacking       — Patron / Sharp Mind / lineage discounts.
//   4. LBP economy             — challenges fund advantages (Strong Bloodline +3).
//   5. Free-BP redundancies    — a grant for something already owned → free BP.

import {
  validate, budgetFor, bonusBudgetFor, computeSpend, grantedAbilities, discountSources,
} from '../src/data/validate.js';
import {
  ALL_SKILLS, ALL_PERKS, ALL_FLAWS, REFS, LINEAGES, CLASS_POWERS, lookupEntity,
} from '../src/data/index.js';
import { classPowers, freqMult } from './effect-score.mjs';

// Effect-power scoring lives in scripts/effect-score.mjs (shared with the build
// generator so they can't drift). See that module for the model.

// ── synergy from co-mention ───────────────────────────────────────────────────
// "Effects that trigger others" — inferred (per user) from co-occurrence: effects
// that show up together in the same power's text are treated as a combo. Builds
// that can produce BOTH halves get a synergy bonus.
function comentionPairs() {
  const pair = new Map();
  for (const tgts of Object.values(REFS.mentions)) {
    const eff = tgts.filter((t) => /^(effects|conditions):/.test(t));
    for (let i = 0; i < eff.length; i++) for (let j = i + 1; j < eff.length; j++) {
      const k = [eff[i], eff[j]].sort().join('|');
      pair.set(k, (pair.get(k) || 0) + 1);
    }
  }
  return pair;
}

// Score a loadout: total frequency-weighted power + a CONCENTRATION bonus (being
// great at one effect and refreshing it — the user's archetype) + a synergy bonus
// for co-mentioned effect pairs the loadout can produce.
function scoreLoadout(powers, pairs) {
  const total = powers.reduce((s, p) => s + p.score, 0);
  // Concentration: the single effect this loadout invokes most (weighted by freq).
  const byEffect = {};
  for (const p of powers) for (const h of p.hits) byEffect[h.name] = (byEffect[h.name] || 0) + h.w * freqMult(p.refresh);
  const topEffect = Object.entries(byEffect).sort((a, b) => b[1] - a[1])[0] || ['—', 0];
  const concentration = topEffect[1];                    // how hard it spams its best effect
  // Synergy: distinct co-mentioned effect pairs the loadout can field both ends of.
  const have = new Set(powers.flatMap((p) => p.hits.map((h) => h.id)));
  let synergy = 0;
  for (const [k, n] of pairs) { const [a, b] = k.split('|'); if (have.has(a) && have.has(b)) synergy += Math.min(n, 5); }
  return { total: Math.round(total), concentration: Math.round(concentration), topEffect: topEffect[0], synergy };
}

// Build the strongest legal slot loadout for a class list, by filling each slot
// category with that class's highest frequency-weighted powers.
function bestLoadout(classLevels) {
  const c = { classLevels, name: 'probe' };
  const r = validate(c);
  if (!r.slots) return null;
  const classes = classLevels.split('/').map((s) => s.trim().split(/\s+/)[0]);
  const pool = classes.flatMap(classPowers).sort((a, b) => b.score - a.score);
  const picked = [];
  // Fill each non-spell slot category up to `allowed` with the top-scoring powers
  // available for it; for casters, fill spellsKnown from the spell tiers.
  for (const slot of r.slots) {
    let n = slot.allowed;
    for (const p of pool) {
      if (n <= 0) break;
      if (picked.includes(p)) continue;
      // crude tier match: a slot like "utility"/"basic" matches the power's tier;
      // spellsKnown/cantrips match spell/cantrip tiers.
      const t = p.tier.toLowerCase();
      const cat = slot.category;
      const ok = cat === 'spellsKnown' ? /spell/.test(t)
        : cat === 'cantrips' ? /cantrip/.test(t)
        : t.includes(cat);
      if (!ok) continue;
      picked.push(p); n--;
    }
  }
  return { classLevels, slots: r.slots, picked, ...scoreLoadout(picked, PAIRS) };
}

const PAIRS = comentionPairs();
const BASE_CLASSES = Object.keys(CLASS_POWERS).filter((c) => (CLASS_POWERS[c].innate || CLASS_POWERS[c].utility || CLASS_POWERS[c].basic || CLASS_POWERS[c].cantrips));

// ── report ────────────────────────────────────────────────────────────────────
console.log('═══ Power-search probe — strongest legal loadouts by EFFECT power ═══\n');
console.log('Scoring: Σ(effect-weight × frequency) + concentration (spam-one-effect) + co-mention synergy.');
console.log(`Frequency: at-will/immediate ×3, Short Rest ×2, Spell ×1.5, Long Rest ×1, Event ×0.5.\n`);

// 1. Single-class loadouts, ranked.
const singles = BASE_CLASSES.map((cls) => bestLoadout(`${cls} 10`)).filter(Boolean)
  .sort((a, b) => (b.total + b.concentration + b.synergy) - (a.total + a.concentration + a.synergy));
console.log('Single-class (level 10), strongest first:');
for (const s of singles.slice(0, 6)) {
  console.log(`  ${s.classLevels.padEnd(14)} power ${String(s.total).padStart(3)} | spams "${s.topEffect}" (${s.concentration}) | synergy ${s.synergy}`);
}
console.log('');

// 2. Multi-class pairs (5/5), looking for cross-pool effect stacking.
const pairBuilds = [];
for (let i = 0; i < BASE_CLASSES.length; i++) for (let j = i + 1; j < BASE_CLASSES.length; j++) {
  const b = bestLoadout(`${BASE_CLASSES[i]} 5 / ${BASE_CLASSES[j]} 5`);
  if (b) pairBuilds.push(b);
}
pairBuilds.sort((a, b) => (b.total + b.concentration + b.synergy) - (a.total + a.concentration + a.synergy));
console.log('Multi-class pairs (5/5), strongest first:');
for (const s of pairBuilds.slice(0, 6)) {
  console.log(`  ${s.classLevels.padEnd(22)} power ${String(s.total).padStart(3)} | spams "${s.topEffect}" (${s.concentration}) | synergy ${s.synergy}`);
}
console.log('');

// 3. The single strongest build, detailed.
const champ = [...singles, ...pairBuilds].sort((a, b) => (b.total + b.concentration + b.synergy) - (a.total + a.concentration + a.synergy))[0];
console.log(`★ Strongest overall: ${champ.classLevels}  (total ${champ.total}, concentration ${champ.concentration} on "${champ.topEffect}", synergy ${champ.synergy})`);
console.log('  loadout:');
for (const p of champ.picked.sort((a, b) => b.score - a.score).slice(0, 10)) {
  console.log(`    ${p.name.padEnd(26)} [${p.tier}/${p.refresh}]  effects: ${p.topEffects.join(', ')}  (score ${Math.round(p.score)})`);
}
