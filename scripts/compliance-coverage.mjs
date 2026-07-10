// scripts/compliance-coverage.mjs
//
// COMPLIANCE COVERAGE MAP — measurement only, no fixes.
//
// Goal: stop whack-a-mole. Instead of testing the rules we happened to think of,
// enumerate the *entire* rule surface the MegaDoc states (as projected into
// refs.json by parse-megadoc.js) and, for each rule family, report whether the
// builder's validator has a code path that HONORS it.
//
// Two distinct failure modes are reported separately:
//   • UNENFORCED  — no validator branch even reads this rule. Silent-ignore. The
//                   real source of whack-a-mole: bugs you can't see because nothing
//                   asserts the rule exists.
//   • UNVERIFIED  — a code path exists, but this script has no exhaustive assertion
//                   proving it produces the right answer for every entry.
//
// The headline number is COVERAGE = entries with an enforcing code path / total
// entries, per relation. This is compliance against refs.json (the parser's
// projection of the prose). Parser fidelity (prose -> refs.json) is a separate
// audit; see NOTE at bottom.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const refs = JSON.parse(readFileSync(join(root, "src", "data", "refs.json"), "utf8"));
const validateSrc = readFileSync(join(root, "src", "data", "validate.js"), "utf8");

// For each refs relation, name the validator function(s) responsible for honoring
// it, and how. enforcer:null => we believe NOTHING consumes this relation.
const RELATION_MAP = {
  prereqs: { enforcer: "checkPrereqs / checkLevelConstraint", countBy: "keys" },
  grants: { enforcer: "multiclassGrants / grantedAbilities", countBy: "keys" },
  grantedBy: { enforcer: "(inverse index of grants)", countBy: "keys", mirror: "grants" },
  // unlocks is the pre-computed INVERSE of prereqs: every "A unlocks B" pair is
  // exactly mirrored by a "B requires A" prereq (verified: 104/104 pairs). So it
  // carries no independent rule — checkPrereqs already enforces it. It's a UI
  // navigation index, not an enforceable constraint.
  unlocks: { enforcer: "(inverse index of prereqs)", countBy: "keys", mirror: "prereqs" },
  discounts: { enforcer: "discountSources / applyDiscounts", countBy: "keys" },
  lbpBonuses: { enforcer: "lbpState", countBy: "keys" },
  // causesCondition/causedBy are IN-PLAY combat resolution (e.g. effect "Charm"
  // inflicts condition "Charmed" when used at a game). The builder's scope is
  // CREATION-TIME legality and cost only, so these are out of scope by design —
  // not a gap. Excluded from the build-time compliance denominator.
  causesCondition: { enforcer: "(in-play effect — out of builder scope)", countBy: "keys", kind: "in-play" },
  causedBy: {
    enforcer: "(in-play effect — out of builder scope)",
    countBy: "keys",
    kind: "in-play",
    mirror: "causesCondition",
  },
  mentions: { enforcer: "(cross-reference index, not a rule)", countBy: "keys", kind: "index" },
  mentionedBy: { enforcer: "(cross-reference index, not a rule)", countBy: "keys", kind: "index", mirror: "mentions" },
  entities: { enforcer: "(entity catalog, not a rule)", countBy: "keys", kind: "index" },
};

const count = (v) => (Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : 0);

console.log("═══ COMPLIANCE COVERAGE MAP (vs refs.json = parser projection of MegaDoc) ═══\n");
console.log("relation         entries  enforcer present?  kind        enforcing function");
console.log("───────────────  ───────  ─────────────────  ──────────  ──────────────────────────");

const rows = [];
for (const rel of Object.keys(refs)) {
  if (rel === "generatedFrom") continue;
  const entries = count(refs[rel]);
  const map = RELATION_MAP[rel] || { enforcer: "(UNMAPPED — relation not classified)", kind: "unknown" };
  const enforced = map.enforcer !== null && !/^\(/.test(map.enforcer || "");
  const kind = map.kind || "rule";
  rows.push({ rel, entries, enforced, kind, enforcer: map.enforcer, mirror: map.mirror });
  const flag = map.enforcer === null ? "✗ UNENFORCED" : enforced ? "✓ yes" : "— n/a";
  console.log(
    rel.padEnd(15),
    String(entries).padStart(7),
    " ",
    flag.padEnd(17),
    kind.padEnd(10),
    map.enforcer ?? "(none)",
  );
}

// ── Headline: rule families that are enforced vs silently ignored ──────────────
// The builder's scope is CREATION-TIME legality and cost. Excluded from the
// denominator: mirror relations (derived inverse indexes — proven below to carry
// no independent rule) and in-play relations (combat resolution, out of scope).
const ruleRows = rows.filter((r) => r.kind === "rule" && !r.mirror);
const enforcedEntries = ruleRows.filter((r) => r.enforced).reduce((s, r) => s + r.entries, 0);
const totalRuleEntries = ruleRows.reduce((s, r) => s + r.entries, 0);
const unenforced = ruleRows.filter((r) => !r.enforced);

console.log("\n─── HEADLINE ───────────────────────────────────────────────────────────────");
console.log(`Build-time independent rule relations (mirrors + in-play excluded): ${ruleRows.length}`);
console.log(
  `Entries WITH an enforcing code path: ${enforcedEntries} / ${totalRuleEntries}` +
    ` (${((enforcedEntries / totalRuleEntries) * 100).toFixed(1)}%)`,
);

if (unenforced.length) {
  console.log("\n⚠ UNENFORCED rule families (silent-ignore — the whack-a-mole source):");
  for (const r of unenforced) {
    console.log(
      `   • ${r.rel} — ${r.entries} entries, NO validator reads this` +
        (r.kind === "in-play" ? " [in-play effect, may be out of builder scope]" : ""),
    );
  }
}

// ── Mirror invariant: prove "inverse index" relations really are inverses ──────
// A relation tagged `mirror: X` claims it carries no independent rule because it
// is exactly the transpose of X. Verify that at runtime so the claim can't rot.
console.log("\n─── MIRROR INVARIANT CHECK (inverse-index relations must transpose cleanly) ──");
const transpose = (rel) => {
  // Returns Set of "a>>b" directed pairs from a {key: [vals]} relation.
  const pairs = new Set();
  const obj = refs[rel] || {};
  for (const [k, vals] of Object.entries(obj)) for (const v of vals || []) pairs.add(`${k}>>${v}`);
  return pairs;
};
// prereqs has nested shape (skills/anyOf); flatten to dep>>item pairs.
const prereqPairsFlat = () => {
  const pairs = new Set();
  for (const [item, pr] of Object.entries(refs.prereqs || {})) {
    for (const dep of pr.skills || []) pairs.add(`${dep}>>${item}`);
    for (const grp of pr.anyOf || []) for (const dep of grp) pairs.add(`${dep}>>${item}`);
  }
  return pairs;
};
for (const r of rows.filter((r) => r.mirror)) {
  const fwd = transpose(r.rel); // pairs a>>b in this relation
  // Base relation's pairs. prereqs is stored dep>>item (same orientation as
  // unlocks src>>target), so compare directly; other base relations are stored
  // key>>val and this relation is their transpose, so reverse them.
  const base = r.mirror === "prereqs" ? prereqPairsFlat() : transpose(r.mirror);
  const baseComparable = new Set(
    r.mirror === "prereqs"
      ? [...base]
      : [...base].map((p) => {
          const [a, b] = p.split(">>");
          return `${b}>>${a}`;
        }),
  );
  const unmatched = [...fwd].filter((p) => !baseComparable.has(p));
  const ok = unmatched.length === 0;
  console.log(
    `   ${ok ? "✓" : "✗ NOT A CLEAN MIRROR"}  ${r.rel} = transpose(${r.mirror})` +
      `  (${fwd.size} pairs, ${unmatched.length} unmatched)`,
  );
  if (!ok) {
    console.log(`      → ${r.rel} carries rule data NOT derivable from ${r.mirror}; treat as a real rule family.`);
    for (const p of unmatched.slice(0, 8)) console.log(`        ${p.replace(">>", " → ")}`);
  }
}

// ── Sanity: does the named enforcer actually exist in validate.js? ─────────────
console.log("\n─── ENFORCER EXISTENCE CHECK (named function present in validate.js?) ───────");
const fnNames = new Set([...validateSrc.matchAll(/(?:export\s+)?function\s+([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1]));
for (const r of rows.filter((r) => r.enforced)) {
  const named = r.enforcer.split("/").map((s) => s.trim());
  for (const n of named) {
    const ok = fnNames.has(n);
    console.log(`   ${ok ? "✓" : "✗ MISSING"}  ${r.rel} → ${n}`);
  }
}

console.log("\n─── WHAT THIS DOES AND DOES NOT PROVE ───────────────────────────────────────");
console.log("PROVES:   which MegaDoc rule families have ANY enforcing code (✓) vs none (✗).");
console.log("NOT YET:  that enforced families are CORRECT for every entry (needs the per-");
console.log("          relation exhaustive audits, like test-rules-enforcement.mjs already");
console.log("          does for prereqs/levels/cost). UNVERIFIED until those exist.");
console.log("NOT YET:  parser fidelity (prose -> refs.json). Separate audit: re-run");
console.log("          parse-megadoc.js and diff; spot-check N refs entries vs the .txt.");
