// scripts/extract-mechanics.mjs
//
// PROSE → MECHANICS extraction. The parser (parse-megadoc.js) projects the doc
// into refs.json, but refs only captures a few rule families (causesCondition,
// prereqs, grants, discounts, lbpBonuses). Most MECHANICAL rules — stat mods,
// resource pools, per-Event/per-Rest economies, Wealth income, durations, granted
// Calls — live only in the free-text descriptions and are never extracted, so they
// can't be audited or diffed.
//
// This script does an INDEPENDENT second extraction straight from every entity's
// description (skills, perks, flaws, class powers across all tiers, devotions,
// domains, lineage advantages) into a structured derived-mechanics view. Each hit
// records { type, name, category, snippet } so the whole mechanical surface is
// visible and a reviewer can see exactly what phrasing matched.
//
// USE: `node --import ./scripts/register-json.mjs scripts/linker/extract-mechanics.mjs`
//   --json   emit the full structured records as JSON (for diffing / a consumer)
//   --cat=X  only show category X
//
// This is EXTRACTION, not enforcement: it surfaces what the doc states. Whether the
// builder honors each is a separate audit (see compliance-coverage / the stat-mod
// cross-check). The value here is making the parser's blind spots visible.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeChar } from "../test/make-char.mjs";
import { Source } from "../../src/engine/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(readFileSync(join(__dirname, "..", "..", "src", "data", f), "utf8"));

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const auditStats = argv.includes("--audit-stats");
const onlyCat = (argv.find((a) => a.startsWith("--cat=")) || "").slice(6) || null;

// ── Collect every entity that carries a rules description, tagged by type. ──────
const entities = [];
const add = (type, name, desc) => {
  if (name && desc) entities.push({ type, name, desc: String(desc) });
};

for (const s of read("skills.json")) add("skill", s.name, s.description);
for (const p of read("perks.json")) add("perk", p.name, p.description);
for (const f of read("flaws.json")) add("flaw", f.name, f.description);

// Class powers live under tier arrays in classes.json.
for (const c of read("classes.json")) {
  for (const tier of ["innate", "utility", "basic", "advanced", "veteran", "classSkills"]) {
    for (const p of c[tier] || []) add(`power:${tier}`, p.name, p.description || p.desc);
  }
}
// Devotions, domains, lineage advantages.
for (const d of read("devotions.json")) {
  add("devotion", d.name, d.description);
  for (const p of d.powers || d.benefits || []) add("devotion-power", p.name, p.description || p.desc);
}
const domains = read("domains.json");
for (const d of Array.isArray(domains) ? domains : Object.values(domains)) {
  for (const p of d.powers || []) add("domain-power", p.name, p.description || p.desc);
}
for (const lin of read("lineages.json")) {
  for (const a of lin.advantages || []) add("advantage", a.name || a.baseName, a.description || a.desc);
}

// ── Mechanical categories. Each: a matcher and a short human label. The matcher
// returns the matched snippet (for auditability) or null. Patterns are deliberately
// a bit broad — this is a SURFACING tool; over-capture is reviewable, silent
// under-capture is the failure we're guarding against. ────────────────────────
const CATS = [
  [
    "stat_mod",
    "permanent stat mod (LP / Armor / Spike / Health / Natural Armor)",
    /(?:\+?\d+|\bone|\btwo|\bthree)\s+(?:additional\s+)?(?:(?:Base\s+)?Maximum\s+)?(?:Life Points?|Armor Points?|Spikes?|Health)\b|(?:Base\s+)?Maximum\s+(?:Life Points?|Armor Points?|Spikes?|Health)\s+(?:is|are)\s+increased|\bpoints?\s+of\s+Natural\s+Armor\b/i,
  ],
  [
    "resource_pool",
    "a points/charges pool",
    /\bpool of\b[^.]*|\b\d+\s+(?:points?|charges?|uses?)\b[^.]*\b(?:per|each|that\s+refresh)/i,
  ],
  [
    "per_event",
    "usable N times per Event/Game/Day",
    /\b(?:once|twice|three times|\d+\s+times?)\s+per\s+(?:event|game|day)\b/i,
  ],
  [
    "per_rest",
    "refreshes on / tied to a Rest",
    /\b(?:after|upon|per)\s+(?:completing\s+)?(?:a\s+|each\s+)?(?:Short|Long)\s+Rest\b|\brefreshes?\b[^.]*\bRest\b/i,
  ],
  ["wealth_income", "grants Wealth income", /\b\d+\s+Wealth\b/i],
  [
    "duration",
    "a timed/conditional duration",
    /\blasts?\s+(?:until|for|\d)|\buntil\s+(?:the\s+next|they|you|completing|their)\b/i,
  ],
  [
    "call_grant",
    "grants a defensive Call (Counter/Prevent/Protect/Resist)",
    /\bgains?\s+(?:a\s+|an\s+)?(?:Counter|Prevent|Protect|Resist|Reduce)\b[^.]*/i,
  ],
  ["choose_param", "requires a player choice/parameter", /\bchoose\s+(?:one|a|an|from)\b[^.]*/i],
];

// ── Match. ─────────────────────────────────────────────────────────────────────
const records = [];
for (const e of entities) {
  for (const [cat, , re] of CATS) {
    const m = e.desc.match(re);
    if (m) records.push({ type: e.type, name: e.name, category: cat, snippet: m[0].trim().slice(0, 120) });
  }
}

// Build a character that OWNS an entity of a given type so its effects materialize
// through validate(). Shared by the cross-check audits. Class powers are forced via
// innatePowers (a power not on the owning class may compute nothing → reported as a
// non-hit, i.e. "needs context"); advantages need a specific lineage so are skipped.
function charForEntity(type, name) {
  if (type === "advantage") return null;
  // Powers are forced as an innate grant (a power off the owning class may compute
  // nothing otherwise). Skills/perks/flaws auto-route by entity type.
  const forceInnate = type.startsWith("power:") || type.startsWith("domain") || type.startsWith("devotion");
  const item = forceInnate ? { name, source: Source.innate() } : name;
  return makeChar("Fighter 4", { lineage: "Human", add: [item] });
}

// ── --audit-stats: cross-check the HIGH-CONFIDENCE permanent stat mods against
// the builder's consumer (validate → stats.mods.sources). For each entity whose
// prose unambiguously states a permanent max-stat bump, build a character that
// owns it and assert the bump registers. Reports the ones the builder IGNORES —
// real candidate bugs (a rule the doc states but the rail doesn't apply). ───────
if (auditStats) {
  const { validate } = await import("../../src/engine/validate.js");
  // Phrasings that denote a PERMANENT max-stat bump. Three shapes the doc uses:
  //   "+N (Base) Maximum <stat>" / "N additional ... Maximum <stat>"
  //   "(Base) Maximum <stat> is/are increased"
  //   "N additional point(s) to ... (Base) Maximum <stat>" (Armor Expertise)
  //   "adds N <stat> to their maximum"
  // Excludes in-play healing/costs/thresholds ("heal 1 Life Point", "0 Life Points").
  const STAT_WORD = "(?:Life Points?|Armor Points?|Spikes?|Health)";
  const STRONG = new RegExp(
    `(?:\\+\\s*\\d+|\\b(?:one|two|three)\\b)\\s+(?:additional\\s+)?(?:points?\\s+)?(?:of\\s+|to\\s+(?:her|their|his|the)\\s+)?(?:\\w+\\s+){0,2}(?:Base\\s+)?Maximum\\s+${STAT_WORD}` +
      `|(?:Base\\s+)?Maximum\\s+${STAT_WORD}\\s+(?:is|are)\\s+increased` +
      `|(?:\\+?\\d+|\\bone|\\btwo|\\bthree)\\s+(?:maximum\\s+)?${STAT_WORD}\\s+to\\s+(?:their\\s+)?max`,
    "i",
  );
  const STAT_OF = (snip) =>
    /armor/i.test(snip)
      ? "armor"
      : /spike/i.test(snip)
        ? "spikes"
        : /natural/i.test(snip)
          ? "naturalArmor"
          : "lifePoints";

  const strong = entities.map((e) => ({ ...e, m: e.desc.match(STRONG) })).filter((e) => e.m);

  console.log("═══ STAT-MOD CROSS-CHECK (prose states a max-stat mod → does the rail apply it?) ═══\n");
  const applied = [],
    missed = [],
    unchecked = [];
  for (const e of strong) {
    const snip = e.m[0];
    const expectStat = STAT_OF(snip);
    const char = charForEntity(e.type, e.name);
    if (!char) {
      unchecked.push({ ...e, snip });
      continue;
    }
    const sources = validate(char).stats.mods.sources || [];
    const hit = sources.some((s) => s.name === e.name || (s.name || "").includes(e.name));
    (hit ? applied : missed).push({ ...e, snip, expectStat });
  }
  console.log(
    `Strong stat-mod statements: ${strong.length}  (applied ${applied.length}, missed ${missed.length}, unchecked ${unchecked.length})\n`,
  );
  if (missed.length) {
    console.log("⚠ STATED IN PROSE BUT NOT APPLIED BY THE RAIL — candidate bugs:");
    for (const e of missed)
      console.log(`   [${e.type}] ${e.name}  (expect ${e.expectStat})\n        “${e.snip.trim()}”`);
  }
  if (unchecked.length) {
    console.log("\n· Unchecked (need a specific lineage/context to own):");
    for (const e of unchecked) console.log(`   [${e.type}] ${e.name} — “${e.snip.trim()}”`);
  }
  console.log('\nNote: "missed" means the entity name did not appear in stats.mods.sources for a');
  console.log("character owning it. Some may be conditional/in-play (correctly excluded from the");
  console.log("build rail) — each needs a rules read; this list is the triage set, not a verdict.");
} else if (asJson) {
  console.log(JSON.stringify(records, null, 2));
} else {
  console.log("═══ PROSE → MECHANICS EXTRACTION ═══");
  console.log(`Entities with descriptions: ${entities.length}`);
  console.log(`Mechanical statements found: ${records.length}\n`);
  console.log("category          count   what it is");
  console.log("────────────────  ─────   ─────────────────────────────────────────────");
  for (const [cat, label] of CATS) {
    if (onlyCat && cat !== onlyCat) continue;
    const hits = records.filter((r) => r.category === cat);
    console.log(`${cat.padEnd(16)}  ${String(hits.length).padStart(5)}   ${label}`);
  }

  // Detail for a chosen category (or all when --cat is set).
  const show = onlyCat ? [onlyCat] : CATS.map(([c]) => c);
  for (const cat of show) {
    const hits = records.filter((r) => r.category === cat);
    if (!hits.length) continue;
    console.log(`\n─── ${cat} (${hits.length}) ───`);
    for (const h of onlyCat ? hits : hits.slice(0, 6)) {
      console.log(`   [${h.type}] ${h.name}\n        “${h.snippet}”`);
    }
    if (!onlyCat && hits.length > 6) console.log(`   … ${hits.length - 6} more (use --cat=${cat})`);
  }

  console.log("\n─── WHAT THIS IS ───────────────────────────────────────────────────────────");
  console.log("Independent extraction of mechanical phrasing the parser does NOT put in");
  console.log("refs.json. Surfaces the rule surface for auditing; does not itself enforce.");
  console.log("Next: cross-check a category against its builder consumer (e.g. stat_mod vs");
  console.log("validate.js statMods) to find rules the doc states but the builder ignores.");
}
