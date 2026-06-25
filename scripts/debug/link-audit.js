#!/usr/bin/env node
// link-audit.js — surfaces likely-missed references in the reference graph.
// Runs alongside the linker to make curation gaps visible rather than silent:
// - prereq fragments that almost-but-don't match a known skill (doc typos)
// - capitalized title-case phrases in bodies that go unlinked (potential aliases)
// - stop-word suppression report (so we know what we're intentionally not linking)
//
// Run: node scripts/link-audit.js   (npm run link:audit)

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { STOP_WORDS, CURATED, inflect } from "./aliases.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "src", "data");
const read = (f) => JSON.parse(readFileSync(join(DATA, f), "utf8"));

const refs = read("refs.json");
const skills = read("skills.json");

// Build entity name registry (same set the linker sees).
const POWER_TIERS = ["innate", "utility", "basic", "advanced", "veteran", "classSkills", "rightHandPowers", "cantrips", "noviceSpells", "adeptSpells", "greaterSpells"];
const entityNames = [
  ...skills.map((s) => s.name),
  ...read("perks.json").map((p) => p.name),
  ...read("flaws.json").map((f) => f.name),
  ...read("glossary.json").map((g) => g.term),
  ...read("effects.json").map((e) => e.name),
  ...read("conditions.json").map((c) => c.name),
  ...read("types.json").map((t) => t.name),
  ...read("resources.json").map((r) => r.name),
  ...read("accents.json").map((a) => a.name),
  ...read("defense-calls.json").map((d) => d.name),
  ...read("modifiers.json").map((m) => m.name),
  ...read("domains.json").map((d) => d.name),
  ...read("devotions.json").map((d) => d.name),
  ...read("classes.json").flatMap((c) => POWER_TIERS.flatMap((t) => (c[t] || []).map((p) => p.name))),
  ...read("crafting-concepts.json").map((c) => c.name),
  ...read("ritual-concepts.json").map((c) => c.name),
];
const uniqueNames = [...new Set(entityNames)];

const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, "");

// ─── (1) Unparsed prereq fragments that fuzzy-match a skill ───────────────────
// These are doc spelling drifts — humans should know about them.
const fuzzyPrereqMisses = [];
for (const [skillId, p] of Object.entries(refs.prereqs)) {
  for (const frag of p.other) {
    const fragN = norm(frag);
    const matches = uniqueNames
      .map((n) => ({ n, similarity: norm(n) === fragN ? 1 : (fragN.includes(norm(n)) && norm(n).length > 6 ? 0.8 : 0) }))
      .filter((m) => m.similarity > 0);
    if (matches.length) {
      fuzzyPrereqMisses.push({ skill: skillId.replace("skill:", ""), fragment: frag, fuzzyMatch: matches.map((m) => m.n) });
    }
  }
}

// ─── (2) Capitalized title-case phrases in bodies that go unlinked ────────────
// Candidate entity-like references the linker missed. Limited to 2-4 word phrases
// to keep noise down. We compare against the existing match set per entity.
function gatherBodies() {
  return [
    ...skills.map((s) => ({ id: `skill:${s.name}`, body: s.description })),
    ...read("perks.json").map((p) => ({ id: `perk:${p.name}`, body: p.description })),
    ...read("flaws.json").map((f) => ({ id: `flaw:${f.name}`, body: f.description })),
  ];
}
const TITLE_CASE = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g;
const knownLower = new Set(uniqueNames.flatMap((n) => inflect(n).map((f) => f.toLowerCase())));
[...STOP_WORDS].forEach((w) => knownLower.add(w.toLowerCase()));
Object.values(CURATED).flat().forEach((f) => knownLower.add(f.toLowerCase()));
// Common stop phrases that look title-case but aren't entities.
const PHRASE_IGNORE = new Set([
  "long rest", "short rest", "spell slot", "spell slots", "spike damage",
  "dark territory", "build points", "life points", "armor points",
]);

const unlinkedTitleCase = new Map();
for (const { id, body } of gatherBodies()) {
  if (!body) continue;
  const matches = body.match(TITLE_CASE) || [];
  for (const m of matches) {
    const lc = m.toLowerCase();
    if (knownLower.has(lc) || PHRASE_IGNORE.has(lc)) continue;
    if (!unlinkedTitleCase.has(m)) unlinkedTitleCase.set(m, { count: 0, sources: new Set() });
    const rec = unlinkedTitleCase.get(m);
    rec.count++;
    rec.sources.add(id);
  }
}

// ─── (3) Stop-word suppression report ────────────────────────────────────────
// Count how many "would-be" links each stop-word would have produced, so the
// suppression list is justified by impact.
const stopWordImpact = [];
for (const sw of STOP_WORDS) {
  const re = new RegExp(`(?<![\\w-])${sw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "gi");
  let hits = 0;
  for (const { body } of gatherBodies()) if (body) hits += (body.match(re) || []).length;
  if (hits) stopWordImpact.push({ word: sw, hits });
}
stopWordImpact.sort((a, b) => b.hits - a.hits);

// ─── REPORT ──────────────────────────────────────────────────────────────────

console.log("LINK AUDIT");
console.log("==========\n");

console.log(`(1) Prereq fragments that fuzzy-match a known entity (likely doc typos): ${fuzzyPrereqMisses.length}`);
for (const m of fuzzyPrereqMisses) {
  console.log(`    ${m.skill} <- "${m.fragment}"  ~  ${m.fuzzyMatch.join(", ")}`);
}
if (!fuzzyPrereqMisses.length) console.log("    (none)");

console.log(`\n(2) Title-case phrases (2+ words) appearing in bodies but not linked: ${unlinkedTitleCase.size}`);
const top = [...unlinkedTitleCase.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 20);
for (const [phrase, rec] of top) {
  console.log(`    ${String(rec.count).padStart(3)}x  ${phrase}`);
}
if (unlinkedTitleCase.size > top.length) console.log(`    ... and ${unlinkedTitleCase.size - top.length} more (showing top 20)`);

console.log(`\n(3) Stop-word suppression impact (links we are intentionally NOT making):`);
for (const { word, hits } of stopWordImpact.slice(0, 15)) {
  console.log(`    ${String(hits).padStart(4)}x  ${word}`);
}
if (stopWordImpact.length > 15) console.log(`    ... and ${stopWordImpact.length - 15} more stop-words`);

console.log(`\nDone. Promote fuzzy-misses (1) into CURATED aliases; review (2) for missed entities; (3) is informational.`);
