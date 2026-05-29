#!/usr/bin/env node
// validate-archetypes.js — sanity-checks the 14 starter archetypes against
// the entity registry. Each item listed in an archetype (skills, perks, powers,
// flaws) must resolve to a real entity in src/data. Unmatched items mean
// either a parser bug, a doc-drift bug, or content that genuinely exists in
// the Starter Sheets but not the MegaDoc.
//
// Resolution uses `buildLookup` from entity-lookup.js, which tries literal,
// case-insensitive, canonical-key, and tier-suffix strategies in order. Any
// item that needs a fallback strategy is reported as DRIFT so authoring
// inconsistencies stay visible across the two source docs.
//
// Run: node scripts/validate-archetypes.js

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { buildLookup, resolve } from "./entity-lookup.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "src", "data");
const read = (f) => JSON.parse(readFileSync(join(DATA, f), "utf8"));

// ─── REGISTRIES ───────────────────────────────────────────────────────────────

const skills = read("skills.json").map((s) => ({ id: `skills:${s.name}`, name: s.name, type: "skills" }));
const perks = read("perks.json").map((p) => ({ id: `perks:${p.name}`, name: p.name, type: "perks" }));
const flaws = read("flaws.json").map((f) => ({ id: `flaws:${f.name}`, name: f.name, type: "flaws" }));

const powers = [];
const classSkills = [];
const TIERS = ["innate","utility","basic","advanced","veteran","classSkills","rightHandPowers","cantrips","noviceSpells","adeptSpells","greaterSpells"];
for (const cls of read("classes.json")) {
  for (const tier of TIERS) {
    for (const p of (cls[tier] || [])) {
      const entity = { id: `powers:${p.name}`, name: p.name, type: "powers" };
      powers.push(entity);
      if (tier === "classSkills") classSkills.push(entity);
    }
  }
}
for (const dom of read("domains.json")) {
  for (const p of (dom.powers || [])) {
    powers.push({ id: `powers:${p.name}`, name: p.name, type: "powers" });
  }
}

// Lookup tables scoped by the role each archetype field expects.
//   startingSkills: free items from a class can be skills, class skills, OR
//                   perks (Hearth/Contact/Patron are perks granted as starting
//                   "skills" by class).
//   purchasedSkills: skills, class skills, OR powers (some [Class] H4 powers
//                    are bought with BP like skills).
//   purchasedPerks:  perks only.
//   power fields:    powers only (innate/utility/basic/.../cantrips/spells).
const lookupStarting = buildLookup([...skills, ...classSkills, ...perks]);
const lookupPurchasedSkill = buildLookup([...skills, ...classSkills, ...powers]);
const lookupPerks = buildLookup(perks);
const lookupFlaws = buildLookup(flaws);
const lookupPowers = buildLookup(powers);

// ─── VALIDATE ────────────────────────────────────────────────────────────────

const archetypes = read("archetypes.json");
const missing = [];
const driftEntries = [];

function check(archetypeName, fieldName, items, lookup) {
  for (const raw of items || []) {
    const { entity, drift } = resolve(raw, lookup);
    if (!entity) missing.push({ archetype: archetypeName, field: fieldName, raw });
    else if (drift) driftEntries.push({ archetype: archetypeName, field: fieldName, raw, drift });
  }
}

const POWER_FIELDS = ["innatePowers","utilityPowers","basicPowers","advancedPowers","veteranPowers","classPowers","rightHandPowers","domainPowers","cantrips","noviceSpells","adeptSpells","greaterSpells","bookSpells","formPowers"];

for (const a of archetypes) {
  check(a.name, "startingSkills", a.startingSkills, lookupStarting);
  check(a.name, "purchasedSkills", a.purchasedSkills, lookupPurchasedSkill);
  check(a.name, "purchasedPerks", a.purchasedPerks, lookupPerks);
  check(a.name, "flaws", a.flaws, lookupFlaws);
  for (const f of POWER_FIELDS) check(a.name, f, a[f], lookupPowers);
}

// ─── REPORT ──────────────────────────────────────────────────────────────────

console.log(`Checked ${archetypes.length} archetypes.\n`);

if (driftEntries.length) {
  console.log(`=== DRIFT (${driftEntries.length}) — resolved via fallback ===`);
  console.log("These items don't match the registry literally but resolved via");
  console.log("case-insensitive / canonical-key / tier fallback. Each indicates a");
  console.log("spelling difference between the source docs that should be reconciled.\n");
  // Group by the unique drift text to dedupe identical mismatches
  const dedup = new Map();
  for (const d of driftEntries) {
    const key = d.drift;
    if (!dedup.has(key)) dedup.set(key, { drift: d.drift, archetypes: [] });
    dedup.get(key).archetypes.push(`${d.archetype} (${d.field})`);
  }
  for (const { drift, archetypes } of dedup.values()) {
    console.log(`  ${drift}`);
    archetypes.slice(0, 3).forEach((a) => console.log(`      seen in: ${a}`));
    if (archetypes.length > 3) console.log(`      ... +${archetypes.length - 3} more`);
  }
  console.log();
}

if (missing.length) {
  console.log(`=== MISSING (${missing.length}) — no resolution found ===`);
  for (const m of missing) {
    console.log(`  ${m.archetype} [${m.field}]: ${m.raw}`);
  }
  console.log();
}

const status = missing.length === 0 && driftEntries.length === 0 ? "clean" : "had findings";
console.log(`Result: ${status} — ${missing.length} missing, ${driftEntries.length} drift instances.`);
process.exit(missing.length > 0 ? 1 : 0);
