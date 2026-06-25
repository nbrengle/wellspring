#!/usr/bin/env node
// link-coverage-audit.js — find capitalized phrases in entity bodies that did
// NOT get linked by the matcher. Surfaces candidate game-terms we may be
// missing in the registry, in CURATED aliases, or via doc inconsistencies.
//
// Run: node scripts/link-coverage-audit.js

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { inflect, CURATED, MATCH_POLICY } from "./aliases.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "src", "data");
const read = (f) => JSON.parse(readFileSync(join(DATA, f), "utf8"));

// ─── REPLICATE the linker's entity building so we know what IS linkable ───────

const TYPE_PRIORITY = ["effects", "conditions", "creature-types", "resources", "accents", "defenses", "modifiers", "crafting-concepts", "ritual-concepts", "skills", "perks", "flaws", "classes", "domains", "devotions", "powers", "recipes", "rituals", "rules-concepts", "terms"];
const POWER_TIERS = ["innate", "utility", "basic", "advanced", "veteran", "classSkills", "rightHandPowers", "cantrips", "noviceSpells", "adeptSpells", "greaterSpells"];

const powerBody = (p) => [
  p.call, p.target, p.duration, p.delivery, p.refresh, p.accent, p.effect,
  p.requirement, p.prerequisites, p.skillsAndOptions, p.description,
].filter(Boolean).join(" ");

// Each entity carries `segments`: an array of independently-scannable text
// fragments. We scan one segment at a time so the phrase regex can't span field
// boundaries (e.g. delivery "Verbal" + refresh "Spell" used to glue into a
// phantom "Verbal Spell"). For the linker's body purposes we still join with
// spaces, but the audit only uses segments.
const registry = [];
const addE = (type, name, segments, extra) => {
  if (!name) return;
  const segs = (Array.isArray(segments) ? segments : [segments]).filter(Boolean);
  registry.push({ type, name, id: `${type}:${name}`, body: segs.join(" "), segments: segs, ...extra });
};
const powerSegments = (p) => [
  p.call, p.target, p.duration, p.delivery, p.refresh, p.accent, p.effect,
  p.requirement, p.prerequisites, p.skillsAndOptions, p.description,
];

read("skills.json").forEach((s) => addE("skills", s.name, [s.description]));
read("perks.json").forEach((p) => addE("perks", p.name, [p.description]));
read("flaws.json").forEach((f) => addE("flaws", f.name, [f.description]));
read("glossary.json").forEach((g) => addE("terms", g.term, [g.definition]));
read("effects.json").forEach((e) => addE("effects", e.name, [e.description]));
read("conditions.json").forEach((c) => addE("conditions", c.name, [c.description]));
read("types.json").forEach((t) => addE("creature-types", t.name, [t.description]));
read("resources.json").forEach((r) => addE("resources", r.name, [r.description]));
read("accents.json").forEach((a) => addE("accents", a.name, [a.description]));
read("defense-calls.json").forEach((d) => addE("defenses", d.name, [d.description]));
read("modifiers.json").forEach((m) => addE("modifiers", m.name, [m.description]));
read("crafting-concepts.json").forEach((c) => addE("crafting-concepts", c.name, [c.description]));
read("ritual-concepts.json").forEach((c) => addE("ritual-concepts", c.name, [c.description]));
read("domains.json").forEach((d) => {
  addE("domains", d.name, [""]);
  (d.powers || []).forEach((p) => addE("powers", p.name, powerSegments(p)));
});
read("devotions.json").forEach((d) => addE("devotions", d.name, [d.lore, ...(d.tenets || [])]));
read("classes.json").forEach((c) => {
  addE("classes", c.name, [c.description, (c.startingSkills || []).join(" "), (c.multiclassSkills || []).join(" ")]);
  POWER_TIERS.forEach((tier) => (c[tier] || []).forEach((p) => addE("powers", p.name, powerSegments(p))));
});
read("crafting-recipes.json").forEach((r) => addE("recipes", r.name, [r.materials, r.usesPerBatch, r.expiration, r.application, r.process, r.description, r.effect]));
read("ritual-recipes.json").forEach((r) => addE("rituals", r.name, [r.summary, r.components, r.targets, r.tools, r.effect, r.process]));

// Sub-concept files (glob, dedupe by name vs higher-priority types).
const KNOWN_FILES = new Set([
  "skills.json","perks.json","flaws.json","glossary.json","effects.json",
  "conditions.json","types.json","resources.json","accents.json",
  "defense-calls.json","modifiers.json","crafting-concepts.json",
  "ritual-concepts.json","domains.json","devotions.json","classes.json",
  "crafting-recipes.json","ritual-recipes.json","lineages.json",
  "level-table.json","core-rules.json","refs.json",
]);
const claimed = new Set(registry.map((e) => e.name.toLowerCase()));
const singular = (s) => s.endsWith("s") ? s.slice(0, -1) : s;
const isClaimed = (name) => {
  const ln = name.toLowerCase();
  return claimed.has(ln) || claimed.has(singular(ln));
};
const addSubConcept = (entry) => {
  if (!entry || !entry.name) return;
  if (!isClaimed(entry.name)) addE("rules-concepts", entry.name, [entry.description], { section: entry.section });
  (entry.subConcepts || []).forEach(addSubConcept);
};
for (const file of readdirSync(DATA)) {
  if (!file.endsWith(".json") || KNOWN_FILES.has(file)) continue;
  const data = read(file);
  if (!Array.isArray(data)) continue;
  if (data.length > 0 && data.every((e) => e && typeof e === "object" && "name" in e && "section" in e && "description" in e)) {
    data.forEach(addSubConcept);
  }
}

// Dedupe — merge segments so a duplicate power's stat-block fields stay
// separately scannable.
const byId = new Map();
for (const e of registry) {
  if (!byId.has(e.id)) byId.set(e.id, e);
  else {
    const existing = byId.get(e.id);
    existing.body += " " + e.body;
    existing.segments = [...existing.segments, ...e.segments];
  }
}
const REG = [...byId.values()];

// ─── BUILD MATCHERS (same logic as linker) ────────────────────────────────────

function buildMatchers(registry) {
  const matchers = [];
  const priority = (t) => TYPE_PRIORITY.indexOf(t);
  for (const e of registry) {
    const policy = MATCH_POLICY[e.name];
    if (policy === "stop") {
      (CURATED[e.name] || []).forEach((f) => {
        const key = f.toLowerCase();
        if (!matchers.some((m) => m.key === key)) {
          matchers.push({ form: f, key, id: e.id, type: e.type, caseSensitive: false });
        }
      });
      continue;
    }
    const caseSensitive = policy === "case-sensitive";
    const forms = new Set();
    inflect(e.name).forEach((f) => forms.add(f));
    (CURATED[e.name] || []).forEach((f) => forms.add(f));
    for (const form of forms) {
      if (form.length < 3) continue;
      const key = caseSensitive ? form : form.toLowerCase();
      const existing = matchers.find((m) => m.key === key);
      if (existing) {
        if (priority(e.type) < priority(existing.type)) { existing.id = e.id; existing.type = e.type; }
        continue;
      }
      matchers.push({ form, key, id: e.id, type: e.type, caseSensitive });
    }
  }
  return matchers;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const matchers = buildMatchers(REG);

// Duration contextual matchers
const DURATION_VALUES = ["Short", "Long", "Permanent", "Instantaneous"];
const effectNames = REG.filter((e) => e.type === "effects").map((e) => e.name);
const defenseNames = REG.filter((e) => e.type === "defenses").map((e) => e.name);
const callKeywordRe = [...effectNames, ...defenseNames].sort((a, b) => b.length - a.length).map(escapeRe).join("|");
for (const dur of DURATION_VALUES) {
  const id = `rules-concepts:${dur}`;
  if (!REG.some((e) => e.id === id)) continue;
  matchers.push({ form: dur, key: dur.toLowerCase(), id, type: "rules-concepts", caseSensitive: false, lookahead: `\\s+(?:${callKeywordRe})\\b` });
}
// Quick/Slow count durations (lookahead on number or "Count").
const COUNT_DURATIONS = [
  { word: "Quick", entityName: "“Quick X” Count" },
  { word: "Slow",  entityName: "“Slow X” Count" },
];
for (const { word, entityName } of COUNT_DURATIONS) {
  const id = `rules-concepts:${entityName}`;
  if (!REG.some((e) => e.id === id)) continue;
  matchers.push({ form: word, key: word.toLowerCase(), id, type: "rules-concepts", caseSensitive: false, lookahead: `\\s+(?:\\d+|Count\\b|(?:${callKeywordRe})\\b)` });
}
matchers.sort((a, b) => {
  if (!!a.lookahead !== !!b.lookahead) return a.lookahead ? -1 : 1;
  return b.form.length - a.form.length;
});

// findRefs: returns the SET of consumed character ranges so we can find what's left
function consumeAndCollect(text) {
  let masked = text;
  for (const m of matchers) {
    const flags = m.caseSensitive ? "g" : "gi";
    const tail = m.lookahead ? `(?=${m.lookahead})` : "";
    const re = new RegExp(`(?<![\\w-])${escapeRe(m.form)}(?![\\w-])${tail}`, flags);
    if (re.test(masked)) masked = masked.replace(re, (s) => "\x00".repeat(s.length));
  }
  return masked;
}

// ─── AUDIT: find capitalized phrases in residual (unmatched) text ─────────────
// After consuming all matched terms, what capitalized phrases remain?
// Filter to plausible game-term shapes (mid-sentence Capitalized words, not
// sentence starts, not common English).

const COMMON_WORDS = new Set([
  "The","A","An","If","When","Then","While","For","To","In","Of","On","At","By","With","From","Or","And","But","Not","This","That","These","Those","You","Your","They","Their","Them","He","She","His","Her","It","Its","We","Our","Us","Will","Would","Can","May","Could","Should","Must","Has","Have","Had","Do","Does","Did","Is","Are","Was","Were","Be","Been","Being","I","Me","My","All","Each","Every","Any","Some","Most","More","Less","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Once","Twice","Round","Hour","Minute","Day","Days","Hours","Minutes","Per","Up","Down","Out","Over","Under","Off","Again","Now","Just","Only","Also","Even","Still","Yet","After","Before","Until","Since","During","Within","Without","Through","Between","Among","Each","Other","Another","Such","Same","Different","Once","Twice","No","Yes","Note","Notes","Example","Examples","See","Section","Chapter","Page","Use","Used","Using","Make","Made","Making","Take","Took","Taking","Get","Got","Getting","Put","Set","Give","Gave","Going","Comes","Come","Came","Becomes","Become","Became","Find","Found","Finding","Choose","Chooses","Chose","Chosen","Choosing","Decide","Decides","Decided","Player","Players","Character","Characters","PC","NPC","Marshal","Marshals","Staff","Game","Wellspring","LARP","System","Rules","Rule","Optional","Required","Default","Type","Types","Description","Name","Names","Cost","Award","Ranks","Rank","Prerequisite","Prerequisites","Level","Levels","Class","Classes","Sub","Combat","Out","Of","Game","Stage","First","Second","Third","Last","Final","Begin","Begins","Began","End","Ends","Ended","Start","Starts","Started","Stop","Stops","Stopped","Continue","Continues","Continued","Total","Plus","Minus","Equal","Equals","Greater","Lesser","Higher","Lower","Above","Below","Max","Maximum","Min","Minimum","About","Roughly","Around","Approximately","Both","Either","Neither","None","Allowed","Allow","Allows","Allowed","Allowing","Banned","Forbidden","Must","Cannot","Wear","Wears","Wearing","Worn","Hold","Holds","Holding","Held","Carry","Carries","Carried","Carrying","Wield","Wields","Wielding","Wielded","Apply","Applies","Applied","Applying","Cast","Casts","Casting","Throw","Throws","Threw","Thrown","Throwing","Speak","Speaks","Spoke","Spoken","Speaking","Say","Says","Said","Saying","Tell","Tells","Told","Telling","Read","Reads","Reading","Write","Writes","Wrote","Written","Writing","Walk","Walks","Walked","Walking","Run","Runs","Ran","Running","Move","Moves","Moved","Moving","Stand","Stands","Stood","Standing","Sit","Sits","Sat","Sitting","Hit","Hits","Hitting","Miss","Misses","Missed","Missing","Reach","Reaches","Reached","Reaching","Touch","Touches","Touched","Touching","Stay","Stays","Stayed","Staying","Remain","Remains","Remained","Remaining","Leave","Leaves","Left","Leaving","Enter","Enters","Entered","Entering","Exit","Exits","Exited","Exiting","Open","Opens","Opened","Opening","Close","Closes","Closed","Closing","Lock","Locks","Locked","Locking","Unlock","Unlocks","Unlocked","Unlocking","Break","Breaks","Broke","Broken","Breaking","Fix","Fixes","Fixed","Fixing","Build","Builds","Built","Building","Destroy","Destroys","Destroyed","Destroying","Create","Creates","Created","Creating","Cause","Causes","Caused","Causing","Believe","Believes","Believed","Believing","Know","Knows","Knew","Known","Knowing","Think","Thinks","Thought","Thinking","Feel","Feels","Felt","Feeling","Hear","Hears","Heard","Hearing","Listen","Listens","Listened","Listening","Watch","Watches","Watched","Watching","Look","Looks","Looked","Looking","Search","Searches","Searched","Searching","Hide","Hides","Hid","Hidden","Hiding","Seek","Seeks","Sought","Seeking","Try","Tries","Tried","Trying","Attempt","Attempts","Attempted","Attempting","Succeed","Succeeds","Succeeded","Succeeding","Fail","Fails","Failed","Failing","Win","Wins","Won","Winning","Lose","Loses","Lost","Losing","Trust","Trusts","Trusted","Trusting","Promise","Promises","Promised","Promising","Lie","Lies","Lied","Lying","Pay","Pays","Paid","Paying","Owe","Owes","Owed","Owing","Spend","Spends","Spent","Spending","Save","Saves","Saved","Saving","Buy","Buys","Bought","Buying","Sell","Sells","Sold","Selling","Trade","Trades","Traded","Trading","Give","Gives","Gave","Given","Giving","Receive","Receives","Received","Receiving","Allow","Allows","Allowed","Allowing","Permit","Permits","Permitted","Permitting","Refresh","Refreshes","Refreshed","Refreshing","Reset","Resets","Resetting","Restore","Restores","Restored","Restoring","Repair","Repairs","Repaired","Repairing","Heal","Heals","Healed","Healing","Hurt","Hurts","Hurting","Damage","Damages","Damaged","Damaging","Cure","Cures","Cured","Curing","Mend","Mends","Mended","Mending","Anything","Everything","Something","Nothing","Anyone","Everyone","Someone","Noone","Anywhere","Everywhere","Somewhere","Nowhere","While","Yet","Anytime","Always","Sometimes","Never","Often","Rarely","Usually","Normally","Typically","Generally","Specifically","Currently","Recently","Soon","Later","Earlier","Before","After","Or",
]);

const candidates = new Map(); // phrase -> { count, contexts: [{ entity, excerpt }] }

const PHRASE = /\b([A-Z][a-zA-Z][a-zA-Z'’\-]*(?:\s+[A-Z][a-zA-Z][a-zA-Z'’\-]*){0,3})\b/g;

// Stat-block fields commonly hold comma-separated value lists ("Spell-Packet,
// Verbal", "Mind, Divine"). Splitting on commas as well as field boundaries
// prevents the phrase regex from gluing "Verbal" and "Mind" into "Verbal Mind".
// Don't split prose: only split short segments that look like value lists.
const splitSegment = (s) => {
  if (!s) return [];
  // Heuristic: a comma list looks like short, capitalized fragments.
  // Long prose with commas (full sentences) is left intact.
  if (s.length < 80 && /,/.test(s) && !/\./.test(s)) {
    return s.split(/,\s*/).filter(Boolean);
  }
  return [s];
};

for (const e of REG) {
  // Per-segment scan — phrase regex can't cross field boundaries or comma-list
  // value boundaries inside stat-block fields.
  const subSegments = e.segments.flatMap(splitSegment);
  for (const segment of subSegments) {
    if (!segment) continue;
    const masked = consumeAndCollect(segment);
    let m;
    PHRASE.lastIndex = 0;
    while ((m = PHRASE.exec(masked)) !== null) {
      const phrase = m[1];
      if (phrase.includes("\x00")) continue; // partial consume
      const head = phrase.split(/\s+/)[0];
      if (COMMON_WORDS.has(head)) continue;
      if (!phrase.includes(" ") && COMMON_WORDS.has(phrase)) continue;
      const idxInText = m.index;
      const prev = masked.slice(Math.max(0, idxInText - 2), idxInText);
      const isSentStart = /(^|[.!?]\s*|^\s*|"|“|‘|\()$/.test(prev) || idxInText === 0;
      if (isSentStart && !phrase.includes(" ")) continue;
      if (/\d/.test(phrase)) continue;
      if (phrase.length < 4) continue;

      const ctxStart = Math.max(0, idxInText - 40);
      const ctxEnd = Math.min(segment.length, idxInText + phrase.length + 40);
      const excerpt = segment.slice(ctxStart, ctxEnd).replace(/\s+/g, " ").trim();
      if (!candidates.has(phrase)) candidates.set(phrase, { count: 0, contexts: [] });
      const c = candidates.get(phrase);
      c.count++;
      if (c.contexts.length < 3) c.contexts.push({ entity: e.id, excerpt });
    }
  }
}

// Sort by count desc and print
const sorted = [...candidates.entries()].sort((a, b) => b[1].count - a[1].count);

console.log(`\n=== Capitalized phrases that did NOT match any entity (${sorted.length} distinct) ===\n`);
console.log("Top 80 by count:\n");
for (const [phrase, info] of sorted.slice(0, 80)) {
  console.log(`\n[${info.count}x] ${phrase}`);
  info.contexts.slice(0, 2).forEach((c) => {
    console.log(`  ${c.entity}: …${c.excerpt}…`);
  });
}

console.log("\n\n=== Summary ===");
console.log(`Distinct unmatched capitalized phrases: ${sorted.length}`);
console.log(`Total unmatched occurrences: ${sorted.reduce((a, [, b]) => a + b.count, 0)}`);
console.log(`Phrases appearing 5+ times: ${sorted.filter(([, b]) => b.count >= 5).length}`);
console.log(`Phrases appearing 10+ times: ${sorted.filter(([, b]) => b.count >= 10).length}`);
