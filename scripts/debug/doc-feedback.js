#!/usr/bin/env node
// doc-feedback.js — generates DOC_FEEDBACK.md, a report of doc-side issues the
// linker has surfaced. Where link-audit.js helps us tune the linker, this
// report is for the people who write the MegaDoc: things they could clean up
// in the source to make the rules more navigable and self-consistent.
//
// Run: node scripts/doc-feedback.js   (npm run doc:feedback)

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { MATCH_POLICY, inflect } from "./aliases.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA = join(ROOT, "src", "data");
const read = (f) => JSON.parse(readFileSync(join(DATA, f), "utf8"));

const POWER_TIERS = ["innate", "utility", "basic", "advanced", "veteran", "classSkills", "rightHandPowers", "cantrips", "noviceSpells", "adeptSpells", "greaterSpells"];

// ─── BUILD CORPUS (entity-id, body) ──────────────────────────────────────────
const corpus = [];
read("skills.json").forEach((s) => corpus.push({ id: `skills:${s.name}`, body: s.description || "" }));
read("perks.json").forEach((p) => corpus.push({ id: `perks:${p.name}`, body: p.description || "" }));
read("flaws.json").forEach((f) => corpus.push({ id: `flaws:${f.name}`, body: f.description || "" }));
read("classes.json").forEach((c) => POWER_TIERS.forEach((t) => (c[t] || []).forEach((p) => corpus.push({ id: `powers:${p.name}`, body: p.description || "" }))));
read("domains.json").forEach((d) => (d.powers || []).forEach((p) => corpus.push({ id: `powers:${p.name}`, body: p.description || "" })));
read("crafting-recipes.json").forEach((r) => corpus.push({ id: `recipes:${r.name}`, body: [r.materials, r.process, r.description, r.effect].filter(Boolean).join(" ") }));
read("ritual-recipes.json").forEach((r) => corpus.push({ id: `rituals:${r.name}`, body: [r.summary, r.components, r.process, r.effect].filter(Boolean).join(" ") }));

const allBodies = corpus.map((c) => c.body).join(" \n ");

// All entity names by type (for fuzzy & cap audits). Type keys match the
// linker's identifiers (plural collection names; "creature-types" because the
// bare "type" collides with the entity record's `type` field).
const entitiesByType = {
  skills: read("skills.json").map((s) => s.name),
  perks: read("perks.json").map((p) => p.name),
  flaws: read("flaws.json").map((f) => f.name),
  terms: read("glossary.json").map((g) => g.term),
  effects: read("effects.json").map((e) => e.name),
  conditions: read("conditions.json").map((c) => c.name),
  "creature-types": read("types.json").map((t) => t.name),
  resources: read("resources.json").map((r) => r.name),
  accents: read("accents.json").map((a) => a.name),
  defenses: read("defense-calls.json").map((d) => d.name),
  modifiers: read("modifiers.json").map((m) => m.name),
  powers: [
    ...read("classes.json").flatMap((c) => POWER_TIERS.flatMap((t) => (c[t] || []).map((p) => p.name))),
    ...read("domains.json").flatMap((d) => (d.powers || []).map((p) => p.name)),
  ],
  recipes: read("crafting-recipes.json").map((r) => r.name),
  rituals: read("ritual-recipes.json").map((r) => r.name),
  "crafting-concepts": read("crafting-concepts.json").map((c) => c.name),
  "ritual-concepts": read("ritual-concepts.json").map((c) => c.name),
};
const allEntities = [];
for (const [type, names] of Object.entries(entitiesByType)) for (const name of names) allEntities.push({ type, name });

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Get up to N body-text snippets containing `form` (case-aware), each with its
// source entity id and a tight ±30-char window. When asCase==="lower", only
// snippets that look like *game-term* references are returned — meaning the
// surrounding context contains nearby capitalized game terms or mechanical
// keywords. This filters out pure English-word uses ("force of will", "make
// life harder", "their power source") that would mislead the report.
const MECHANICAL_NEAR = /\b(Counter|Effect|Power|Spike|Damage|Accent|Cure|Heal|Grant|Quick|Short|Long|Slow|Resist|Protect|Counter|Wounding|Piercing|Refresh|Spell|Cantrip|by|vs|Rest|Counter)\b/;
function examples(form, asCase, n = 2) {
  const esc = escapeRe(form);
  const re = new RegExp(`(?<![\\w-])${esc}(?![\\w-])`, "gi");
  const out = [];
  for (const { id, body } of corpus) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(body)) && out.length < n) {
      const got = body.substr(m.index, form.length);
      if (asCase === "caps" && got !== form) continue;
      if (asCase === "lower" && got === form) continue;
      const start = Math.max(0, m.index - 30);
      const end = Math.min(body.length, m.index + form.length + 35);
      const snip = body.slice(start, end).replace(/\s+/g, " ").trim();
      // For lowercase, require mechanical context within ±40 chars; otherwise
      // it's likely a plain-English use the writer never intended as a term.
      if (asCase === "lower") {
        const window = body.slice(Math.max(0, m.index - 40), Math.min(body.length, m.index + form.length + 40));
        if (!MECHANICAL_NEAR.test(window)) continue;
      }
      out.push(`[${id.split(":")[1]}] …${snip}…`);
    }
    if (out.length >= n) break;
  }
  return out;
}

// ─── (1) CASE INCONSISTENCIES ────────────────────────────────────────────────
// Entities whose name appears in bodies in both capitalized and lowercase form
// (below 95% caps). Each finding shows: caps count, lowercase count, examples
// of both. The recommendation: pick one canonical casing and apply it
// consistently in the source.
function caseStats(name) {
  const esc = escapeRe(name);
  const upper = (allBodies.match(new RegExp(`(?<![\\w-])${esc}(?![\\w-])`, "g")) || []).length;
  const total = (allBodies.match(new RegExp(`(?<![\\w-])${esc}(?![\\w-])`, "gi")) || []).length;
  return { upper, lower: total - upper, total };
}

const caseFindings = [];
const seenName = new Set();
for (const { type, name } of allEntities) {
  if (/[^A-Za-z]/.test(name)) continue;
  // A name shared across types (e.g. Refresh as both term and effect) only
  // needs one entry — the source text isn't multi-typed.
  if (seenName.has(name)) continue;
  const s = caseStats(name);
  if (s.total < 5) continue;
  const pct = s.upper / s.total;
  if (pct >= 0.95) continue;
  const lowerExamples = examples(name, "lower", 2);
  if (lowerExamples.length === 0) continue;
  seenName.add(name);
  caseFindings.push({
    type, name,
    caps: s.upper, lower: s.lower, total: s.total, pct,
    capsExamples: examples(name, "caps", 2),
    lowerExamples,
    policy: MATCH_POLICY[name] || "default",
  });
}
caseFindings.sort((a, b) => b.lower - a.lower);

// ─── (2) SPELLING INCONSISTENCIES ────────────────────────────────────────────
// Prereq fragments and body text that fuzzy-match a known entity but spell it
// differently (e.g. "Dagger Craft" vs the entity "Daggercraft"). These create
// silent dead-ends — the writer wrote a real game term, but spelled it in a
// way the cross-reference graph can't resolve.
const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, "");
const skillNorms = read("skills.json").map((s) => ({ name: s.name, n: norm(s.name) }));

const spellingFindings = [];
// Look in prereq text first (highest-impact: prereqs drive the skill tree).
for (const s of read("skills.json")) {
  if (!s.prereq || s.prereq === "None") continue;
  // Tokenize on commas, dropping known phrasings.
  const parts = s.prereq.split(/,(?![^(]*\))/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const partN = norm(part);
    if (!partN) continue;
    const matches = skillNorms.filter((sn) => sn.n === partN && sn.name !== part.replace(/\s*\([^)]*\)\s*/g, "").trim());
    for (const m of matches) {
      spellingFindings.push({ in: `skill:${s.name} prereq`, wrote: part, shouldBe: m.name });
    }
  }
}

// ─── (3) AMBIGUOUS GAME TERMS (stopped because they're used as both proper and common nouns) ───
// These have a higher cost: each is a class of game-term the writers use as a
// regular noun too, so the linker can't safely link any instance. Total
// suppressed links = (caps + lower) of the stopped name.
const ambiguous = [];
for (const [name, policy] of Object.entries(MATCH_POLICY)) {
  if (policy !== "stop") continue;
  const s = caseStats(name);
  if (s.total === 0) continue;
  ambiguous.push({
    name, caps: s.upper, lower: s.lower, total: s.total,
    capsExamples: examples(name, "caps", 1),
    lowerExamples: examples(name, "lower", 1),
  });
}
ambiguous.sort((a, b) => b.total - a.total);

// ─── (5) UNDEFINED COMPOUND CONCEPTS ─────────────────────────────────────────
// Title-case 2+ word phrases that appear repeatedly in bodies but aren't an
// entity. These are concepts the doc references as if they're defined, but
// don't have their own definition — either define them, or rewrite to use the
// existing terms consistently.
// Knownness includes algorithmic inflections so a singular form of a plural
// entity (e.g. "Night Prize" of "Night Prizes") doesn't get flagged. Also
// strip the leading article "The " so "Enchanting Forge" matches the entity
// "The Enchanting Forge".
const knownLower = new Set();
for (const { name } of allEntities) {
  for (const f of inflect(name)) knownLower.add(f.toLowerCase());
  if (/^The /.test(name)) knownLower.add(name.replace(/^The /, "").toLowerCase());
}
// Also ignore "The <Class>" patterns — class names exist as entities; "The
// Artisan" prefixed by an article isn't an undefined concept.
const classNames = new Set(read("classes.json").map((c) => c.name));
const IGNORE = new Set([
  "long rest", "short rest", "spell slot", "spell slots", "spike damage",
  "dark territory", "build points", "life points", "armor points",
  "the power", "the call", "the accent", "this power", "for example",
  "natural armor", "physical armor", "summoned armor",
  // Cross-references to doc sections (class-sheet fields, core-rules pointers).
  "starting skills", "multiclass skills", "level progression table",
  "wellspring core rules", "core rules", "key features",
  // Derived stats and power-tier compounds that aren't standalone entities.
  "maximum life points", "maximum spikes", "base maximum spikes",
  "innate power", "innate powers", "utility power", "utility powers",
  "tier power", "tier powers", "basic power", "basic powers",
  "advanced power", "advanced powers", "class power", "class powers",
]);
const isClassWithArticle = (phrase) => {
  const m = phrase.match(/^(The|A|An)\s+(.+)$/);
  return m && classNames.has(m[2]);
};
const TITLE_CASE = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g;
const phraseCounts = new Map();
for (const { body } of corpus) {
  const matches = body.match(TITLE_CASE) || [];
  for (const phrase of matches) {
    const lc = phrase.toLowerCase();
    if (knownLower.has(lc) || IGNORE.has(lc) || isClassWithArticle(phrase)) continue;
    phraseCounts.set(phrase, (phraseCounts.get(phrase) || 0) + 1);
  }
}
// A compound is just noise if every word in it is already a known entity (or
// a power-tier label or quantity word) — that's just a normal English sentence
// using game terms ("Cure Insubstantial", "Novice Spell"). Real findings are
// concepts the doc references as if defined but actually aren't.
const PROSE_LEADS = new Set(["The", "A", "An", "This", "That", "These", "Those", "Their", "Your", "His", "Her", "Its", "None", "No"]);
const COMPOUND_PARTS = new Set([
  ...knownLower,
  "novice", "adept", "greater", "basic", "utility", "advanced", "veteran", "cantrip",
  "maximum", "minimum", "quick", "slow", "long", "short", "focus",
]);
const isCompoundOfKnowns = (phrase) => {
  const words = phrase.split(/\s+/);
  return words.every((w) => COMPOUND_PARTS.has(w.toLowerCase()));
};
// Drop further noise from the parsed stat-block format: phrases containing
// excessive whitespace are columnar-table artifacts (e.g. "Self    Duration"),
// and "<ClassName> Level" patterns are skill-requirement boilerplate.
const classNamesPlural = new Set([...classNames].map((c) => `${c} Level`));
const compoundFindings = [...phraseCounts.entries()]
  .filter(([phrase, n]) => {
    if (n < 3) return false;
    const words = phrase.split(/\s+/);
    if (PROSE_LEADS.has(words[0])) return false;
    if (isCompoundOfKnowns(phrase)) return false;
    if (/\s{2,}/.test(phrase)) return false;       // columnar stat-block leak
    if (classNamesPlural.has(phrase)) return false; // "Sourcerer Level" requirement
    return true;
  })
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .map(([phrase, count]) => ({ phrase, count, examples: examples(phrase, "caps", 1) }));

// ─── RENDER MARKDOWN ─────────────────────────────────────────────────────────
const md = [];
md.push("# Wellspring MegaDoc — Writer Feedback Report");
md.push("");
md.push("Auto-generated by `npm run doc:feedback`. Each finding is something our");
md.push("cross-reference graph noticed that suggests a doc-side cleanup: ways the");
md.push("text uses the same concept inconsistently, references things by names");
md.push("that don't resolve, or uses game terms in both proper-noun and");
md.push("common-noun senses, costing us links.");
md.push("");
md.push("**How to read this.** Each section explains the issue, then lists");
md.push("specific findings with examples and a suggested fix. The findings most");
md.push("worth addressing first are at the top of each section (sorted by impact).");
md.push("");

// SECTION 1
md.push("## 1. Capitalization inconsistencies");
md.push("");
md.push(`Game terms with their own definition that appear in body text in both`);
md.push(`capitalized and lowercase forms. We can only reliably link the capitalized`);
md.push(`form (or we suppress the link entirely when the lowercase usage is too`);
md.push(`common). Each lowercase mention listed below is a place a reader can't`);
md.push(`click through to the definition.`);
md.push("");
md.push(`Found **${caseFindings.length} entities** below the 95% capitalized threshold.`);
md.push("");
for (const f of caseFindings) {
  md.push(`### \`${f.name}\` (${f.type})`);
  md.push("");
  md.push(`- **Caps:** ${f.caps} · **lowercase:** ${f.lower} · ${Math.round(f.pct * 100)}% caps · linker policy: \`${f.policy}\``);
  if (f.policy === "stop") md.push(`- _Currently stopped: we don't link this name at all because lowercase use is too common._`);
  if (f.policy === "case-sensitive") md.push(`- _Currently case-sensitive: we link only the capitalized form, so each lowercase mention is a lost link._`);
  md.push("");
  if (f.capsExamples.length) {
    md.push(`- Capitalized examples:`);
    f.capsExamples.forEach((e) => md.push(`  - ${e}`));
  }
  if (f.lowerExamples.length) {
    md.push(`- Lowercase examples (these are the cleanup targets):`);
    f.lowerExamples.forEach((e) => md.push(`  - ${e}`));
  }
  md.push("");
}

// SECTION 2
md.push("## 2. Spelling inconsistencies");
md.push("");
md.push(`Places where a known entity is referenced under a different spelling`);
md.push(`(usually a space/hyphen difference). These are silent dead-ends: the`);
md.push(`writer wrote a real game term, but the cross-reference graph can't`);
md.push(`recognize it.`);
md.push("");
md.push(`Found **${spellingFindings.length} cases.**`);
md.push("");
for (const f of spellingFindings) {
  md.push(`- In ${f.in}: text says \`${f.wrote}\`, entity is \`${f.shouldBe}\`. Fix: use \`${f.shouldBe}\`.`);
}
md.push("");

// SECTION 3 (was 4)
md.push("## 3. Game terms used as common nouns (linker-suppressed)");
md.push("");
md.push(`These are entities the doc treats as both a proper game-term (\"the`);
md.push(`Counter\") and a common-noun verb/concept (\"call 'Counter'\"). Because`);
md.push(`even the lowercase form usually means the game term in context, we`);
md.push(`can't case-disambiguate — we suppress the link entirely. **If the doc`);
md.push(`consistently capitalized these when meaning the game-term, ~80 currently-`);
md.push(`lost links would resolve.**`);
md.push("");
for (const f of ambiguous) {
  md.push(`- **\`${f.name}\`** — ${f.caps} caps / ${f.lower} lower (${f.total} total)`);
  if (f.capsExamples[0]) md.push(`  - Caps: ${f.capsExamples[0]}`);
  if (f.lowerExamples[0]) md.push(`  - lower: ${f.lowerExamples[0]}`);
}
md.push("");

// SECTION 4 (was 5)
md.push("## 4. Undefined compound concepts");
md.push("");
md.push(`Title-case 2+ word phrases that appear repeatedly in bodies but aren't`);
md.push(`defined as entities. These read like terms but have no definition the`);
md.push(`reader can click through to. Recommendation: either add a definition for`);
md.push(`each, or rewrite to use the existing defined terms.`);
md.push("");
md.push("| Phrase | Times used | Example |");
md.push("|---|---|---|");
for (const f of compoundFindings) {
  md.push(`| \`${f.phrase}\` | ${f.count} | ${f.examples[0] || ""} |`);
}
md.push("");

md.push("---");
md.push("");
md.push("_Generated from a snapshot of the MegaDoc. As the doc changes, re-run_");
md.push("_`npm run doc:feedback` to refresh._");

writeFileSync(join(ROOT, "DOC_FEEDBACK.md"), md.join("\n"));
console.log(`Wrote DOC_FEEDBACK.md`);
console.log(`  ${caseFindings.length} case inconsistencies, ${spellingFindings.length} spelling, ${ambiguous.length} stop-worded, ${compoundFindings.length} undefined compounds`);
