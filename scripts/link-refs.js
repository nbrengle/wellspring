#!/usr/bin/env node
// link-refs.js — builds a cross-reference graph over the parsed data.
// Reads src/data/*.json, finds references to known entities inside every body of
// text (matched against a curated alias dictionary, word-bounded, longest-first),
// and writes src/data/refs.json: per-entity outbound refs + inverse backlinks,
// plus structured skill prerequisites.
//
// Run: node scripts/link-refs.js   (npm run link)

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { inflect, CURATED, MATCH_POLICY } from "./aliases.js";
import { buildLookup, resolve } from "./entity-lookup.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "src", "data");
const read = (f) => JSON.parse(readFileSync(join(DATA, f), "utf8"));

// ─── ENTITY REGISTRY ──────────────────────────────────────────────────────────
// Every linkable entity, typed. `id` is "type:name" for stable, collision-proof
// addressing (6 names collide across types). Type priority breaks ambiguous
// surface-form matches (earlier = wins).

// Type priority for surface-form collisions. Specific mechanical types win
// over the generic glossary term — e.g. "Counter" links to the defenses entity
// (which has the full mechanics) rather than the terms entity (which is just a
// short glossary definition). All identifiers are plural to match the JSON
// collection files they correspond to; the one exception is `creature-types`,
// because `types` would collide with the `type` field on every entity record.
const TYPE_PRIORITY = ["effects", "conditions", "creature-types", "resources", "accents", "defenses", "modifiers", "crafting-concepts", "ritual-concepts", "skills", "perks", "flaws", "classes", "domains", "devotions", "powers", "recipes", "rituals", "archetypes", "rules-concepts", "terms"];

const POWER_TIERS = ["innate", "utility", "basic", "advanced", "veteran", "classSkills", "rightHandPowers", "cantrips", "noviceSpells", "adeptSpells", "greaterSpells"];

function buildRegistry() {
  const reg = [];
  const add = (type, name, body, extra) => { if (name) reg.push({ type, name, id: `${type}:${name}`, body: body || "", ...extra }); };

  read("skills.json").forEach((s) => add("skills", s.name, s.description, s.parameter ? { parameter: s.parameter } : {}));
  read("perks.json").forEach((p) => add("perks", p.name, p.description));
  read("flaws.json").forEach((f) => add("flaws", f.name, f.description));
  read("glossary.json").forEach((g) => add("terms", g.term, g.definition));
  // Effects carry the doc-derived condition they cause (effects.json), kept as a
  // typed relationship rather than re-encoded by hand.
  read("effects.json").forEach((e) => add("effects", e.name, e.description, { causesCondition: e.causesCondition || null }));
  read("conditions.json").forEach((c) => add("conditions", c.name, c.description));
  // "creature-types", not "types" — the latter would collide with the `type`
  // field on every entity record.
  read("types.json").forEach((t) => add("creature-types", t.name, t.description));
  read("resources.json").forEach((r) => add("resources", r.name, r.description));
  read("accents.json").forEach((a) => add("accents", a.name, a.description, { elemental: a.elemental }));
  read("defense-calls.json").forEach((d) => add("defenses", d.name, d.description));
  read("modifiers.json").forEach((m) => add("modifiers", m.name, m.description));
  // Crafting/ritual concepts may carry nested subConcepts (e.g. ritual concept
  // "Ritualists" → "Primary Ritualist", "Secondary Ritualist", "Participant"
  // as H4 children). Walk them so the children become their own entities.
  const walkConcept = (type, c, extra) => {
    add(type, c.name, c.description, extra);
    (c.subConcepts || []).forEach((s) => walkConcept(type, s, extra));
  };
  read("crafting-concepts.json").forEach((c) => walkConcept("crafting-concepts", c, { discipline: c.discipline }));
  read("ritual-concepts.json").forEach((c) => walkConcept("ritual-concepts", c));
  // A power's mechanical references (e.g. "Short Grant", "Counter, Augmentation",
  // "Long Rest" refresh) live in the stat-block fields, NOT the description prose.
  // Concatenate them all so the graph sees them.
  const powerBody = (p) => [
    p.call, p.target, p.duration, p.delivery, p.refresh, p.accent, p.effect,
    p.requirement, p.prerequisites, p.skillsAndOptions, p.description,
  ].filter(Boolean).join(" ");

  read("domains.json").forEach((d) => {
    add("domains", d.name, "");
    (d.powers || []).forEach((p) => add("powers", p.name, powerBody(p)));
  });
  read("devotions.json").forEach((d) => add("devotions", d.name, [d.lore, (d.tenets || []).join(" ")].join(" ")));
  read("classes.json").forEach((c) => {
    add("classes", c.name, [c.description, (c.startingSkills || []).join(" "), (c.multiclassSkills || []).join(" ")].filter(Boolean).join(" "));
    // Class specializations (e.g. Artisan → Mystic, Crafter, Artificer).
    (c.specializations || []).forEach((s) => add("classes", s.name, s.description, { parentClass: c.name }));
    POWER_TIERS.forEach((tier) => (c[tier] || []).forEach((p) => add("powers", p.name, powerBody(p))));
  });
  // Crafting recipes and rituals have dense bodies (materials, process, effect)
  // that reference Resources, Effects, Conditions, etc. Index them as entities
  // so they participate in the graph (and so Bloom in a recipe's materials
  // creates a backlink to Bloom).
  read("crafting-recipes.json").forEach((r) => add("recipes", r.name, [r.materials, r.usesPerBatch, r.expiration, r.application, r.process, r.description, r.effect].filter(Boolean).join(" ")));
  read("ritual-recipes.json").forEach((r) => add("rituals", r.name, [r.summary, r.components, r.targets, r.tools, r.effect, r.process].filter(Boolean).join(" ")));
  // Archetype templates from the Starter Sheets. The body is the tagline +
  // joined references so the body-text scanner picks up the same skills/perks/
  // powers the archetype lists. Structured refs are resolved separately below.
  read("archetypes.json").forEach((a) => {
    const body = [
      a.tagline,
      ...(a.startingSkills || []),
      ...(a.purchasedSkills || []),
      ...(a.purchasedPerks || []),
      ...(a.flaws || []),
      ...(a.innatePowers || []), ...(a.utilityPowers || []),
      ...(a.basicPowers || []), ...(a.advancedPowers || []),
      ...(a.veteranPowers || []), ...(a.cantrips || []),
      ...(a.noviceSpells || []), ...(a.adeptSpells || []),
      ...(a.greaterSpells || []), ...(a.bookSpells || []),
      ...(a.domainPowers || []), ...(a.rightHandPowers || []),
    ].filter(Boolean).join(" ");
    add("archetypes", a.name, body, { specialization: a.specialization || null });
  });

  // Sub-concept files (combat-rules.json, death-and-dying.json, etc.) are
  // structure-derived from the core-rules H1 sections by parse-megadoc. They all
  // share the shape `[{ name, section, description, subConcepts? }]`. We don't
  // hardcode the filenames — instead we glob src/data and detect the shape so
  // that newly emitted buckets are picked up automatically.
  const KNOWN_FILES = new Set([
    "skills.json","perks.json","flaws.json","glossary.json","effects.json",
    "conditions.json","types.json","resources.json","accents.json",
    "defense-calls.json","modifiers.json","crafting-concepts.json",
    "ritual-concepts.json","domains.json","devotions.json","classes.json",
    "crafting-recipes.json","ritual-recipes.json","lineages.json",
    "level-table.json","core-rules.json","refs.json","archetypes.json",
  ]);
  // Names already claimed by a more specific entity type (terms, defenses,
  // crafting-concepts, etc.). When a rules-concept H2 collides — e.g. "Short
  // Rests" duplicates the glossary's "Short Rest", or "Protect" duplicates the
  // defense call — we skip the rules-concept so the authoritative entry wins.
  const claimed = new Set(reg.map((e) => e.name.toLowerCase()));
  // Strip a trailing plural "s" for comparison so that "Short Rests" matches
  // "Short Rest" (and "Tests" matches "Test").
  const singular = (s) => s.endsWith("s") ? s.slice(0, -1) : s;
  const isClaimed = (name) => {
    const ln = name.toLowerCase();
    return claimed.has(ln) || claimed.has(singular(ln));
  };
  const addSubConcept = (entry) => {
    if (!entry || !entry.name) return;
    if (!isClaimed(entry.name)) {
      add("rules-concepts", entry.name, entry.description, { section: entry.section });
    }
    (entry.subConcepts || []).forEach(addSubConcept);
  };
  for (const file of readdirSync(DATA)) {
    if (!file.endsWith(".json") || KNOWN_FILES.has(file)) continue;
    const data = read(file);
    if (!Array.isArray(data)) continue;
    const looksLikeSubConcepts = data.length > 0 && data.every(
      (e) => e && typeof e === "object" && "name" in e && "section" in e && "description" in e
    );
    if (looksLikeSubConcepts) data.forEach(addSubConcept);
  }

  // De-dupe identical ids (a power name can repeat across classes); merge bodies.
  const byId = new Map();
  for (const e of reg) {
    if (!byId.has(e.id)) byId.set(e.id, e);
    else byId.get(e.id).body += " " + e.body;
  }
  return [...byId.values()];
}

// ─── MATCHERS ─────────────────────────────────────────────────────────────────
// A matcher maps a surface form -> entity id. Longest form first so "Weapon
// Specialization" wins over "Weapon". STOP_WORDS only match via a curated alias.

function buildMatchers(registry) {
  const matchers = []; // { form, key, id, type, caseSensitive }
  const priority = (t) => TYPE_PRIORITY.indexOf(t);

  for (const e of registry) {
    const policy = MATCH_POLICY[e.name];
    if (policy === "stop") {
      // Skip the algorithmic inflections — only explicit CURATED aliases link.
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
      // Collision detection: case-sensitive forms key by exact form; others
      // key by lowercase so e.g. "Slept" and "slept" don't both register.
      const key = caseSensitive ? form : form.toLowerCase();
      const existing = matchers.find((m) => m.key === key);
      if (existing) {
        if (priority(e.type) < priority(existing.type)) { existing.id = e.id; existing.type = e.type; }
        continue;
      }
      matchers.push({ form, key, id: e.id, type: e.type, caseSensitive });
    }
    // Parameterized entity: prose instantiates the placeholder with a parenthe-
    // sized value, e.g. "Lore (Religious)" → skills:Lore. Register one matcher
    // per inflection that catches the `<form> (anything)` shape and consumes
    // the whole span (so the parenthesized value isn't re-matched).
    if (e.parameter) {
      for (const form of forms) {
        if (form.length < 3) continue;
        const paramForm = `${form} (...)`;
        const key = paramForm.toLowerCase();
        if (matchers.some((m) => m.key === key)) continue;
        matchers.push({
          form,
          key,
          id: e.id,
          type: e.type,
          caseSensitive,
          paramSuffix: true, // consume " (<value>)" after the form
        });
      }
    }
  }
  // No need to sort here — the caller appends contextual matchers and sorts the
  // combined list.
  return matchers;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Find all entity ids referenced in `text`, excluding `selfId`. Word-bounded,
// longest-match-first; consumed spans aren't re-matched by shorter forms.
function findRefs(text, selfId, matchers) {
  if (!text) return [];
  const found = new Set();
  // Mask consumed character ranges so a shorter form can't match inside a longer
  // one already matched (e.g. "Weapon" inside "Weapon Specialization").
  let masked = text;
  for (const m of matchers) {
    const flags = m.caseSensitive ? "g" : "gi";
    // A contextual matcher carries an optional `lookahead` regex fragment that
    // must follow the form (consuming only the form itself). Used for duration
    // values like "Short" that should only link in "Short <Effect|Defense>"
    // shape, never as a bare word.
    //
    // A parameterized matcher (paramSuffix) instead REQUIRES and consumes a
    // " (value)" suffix. Used so "Lore (Religious)" links to skills:Lore and
    // the parenthesized value is masked away (no follow-up matcher tries to
    // match "Religious" as a separate entity).
    const tail = m.lookahead ? `(?=${m.lookahead})`
      : m.paramSuffix ? "\\s+\\([^)]+\\)"
      : "";
    const re = new RegExp(`(?<![\\w-])${escapeRe(m.form)}(?![\\w-])${tail}`, flags);
    if (re.test(masked)) {
      if (m.id !== selfId) found.add(m.id);
      masked = masked.replace(re, (s) => " ".repeat(s.length)); // consume
    }
  }
  return [...found];
}

// ─── STRUCTURED PREREQS ───────────────────────────────────────────────────────
// Parse a skill's free-text prereq into linked skill ids, level requirements, and
// leftover conditions. Skill names are matched against the skill registry.

// All skill ids named in a fragment, longest-form-first so "Basic Arcane" wins
// over "Arcane" but every distinct skill in the fragment is captured.
function skillsIn(fragment, skillForms) {
  const hits = skillForms
    .filter((sf) => new RegExp(`(?<![\\w-])${escapeRe(sf.form)}(?![\\w-])`).test(fragment))
    .sort((a, b) => b.form.length - a.form.length);
  // De-dupe by id, preferring the longest form (already sorted), and drop a
  // shorter form whose match is a substring of a longer one already taken.
  const taken = [];
  const ids = new Set();
  for (const h of hits) {
    if (ids.has(h.id)) continue;
    if (taken.some((t) => t.form.includes(h.form))) continue;
    taken.push(h); ids.add(h.id);
  }
  return [...ids];
}

function parsePrereq(prereqText, skillForms) {
  if (!prereqText || prereqText === "None") {
    return { skills: [], anyOf: [], levels: [], other: [] };
  }
  const skills = new Set();
  const anyOf = [];   // groups of alternative skill ids — satisfied if ANY is held
  const levels = [];
  const other = [];

  // Split on commas, but keep "(...)" groups intact.
  const parts = prereqText.split(/,(?![^(]*\))/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    // Level requirement: "N levels in X", "Nth character-level", "Character Level N".
    const lvl = part.match(/(\d+)\s*(?:levels?|character-level|character level)/i) || part.match(/(?:level|character[- ]level)\s*(\d+)/i);

    // Disjunction: "Basic Arcane or Basic Faith" — record every alternative as
    // an anyOf group rather than collapsing to one required skill. Only treat it
    // as a disjunction when more than one alternative actually names a skill.
    if (!lvl && /\bor\b/i.test(part)) {
      const alts = part.split(/\bor\b/i).map((s) => s.trim()).filter(Boolean);
      const altIds = alts.flatMap((a) => skillsIn(a, skillForms));
      const uniq = [...new Set(altIds)];
      if (uniq.length > 1) { anyOf.push(uniq); continue; }
      if (uniq.length === 1) { skills.add(uniq[0]); continue; }
      other.push(part);
      continue;
    }

    const hits = skillsIn(part, skillForms);
    if (hits.length) hits.forEach((id) => skills.add(id));
    if (lvl) levels.push(part);
    if (!hits.length && !lvl) other.push(part);
  }
  return { skills: [...skills], anyOf, levels, other };
}

// ─── BUILD ────────────────────────────────────────────────────────────────────

console.log("Linking references…");

const registry = buildRegistry();
const matchers = buildMatchers(registry);

// ─── DURATION CONTEXTUAL MATCHERS ─────────────────────────────────────────────
// A Call has the shape `<Duration> <Effect | DefenseCall> [Qualifier...]`. So
// when the body says "Short Grant Plus One Dark Territory" or "Long Repel by
// Force", we want THREE separate links: the duration value, the effect, and any
// further concepts — not one greedy "Short Grant" match that swallows "Grant".
//
// We achieve that by registering `Short`/`Long`/`Permanent`/`Instantaneous` with
// a lookahead that requires the next word to be a known effect or defense name.
// The matcher consumes only the duration word, leaving the effect/defense for
// its own matcher to find on a later pass.
//
// The effect and defense name lists come from the registry — no hardcoding.
const DURATION_VALUES = ["Short", "Long", "Permanent", "Instantaneous"];
const effectNames = registry.filter((e) => e.type === "effects").map((e) => e.name);
const defenseNames = registry.filter((e) => e.type === "defenses").map((e) => e.name);
const callKeywordRe = [...effectNames, ...defenseNames]
  .sort((a, b) => b.length - a.length)
  .map(escapeRe).join("|");

for (const dur of DURATION_VALUES) {
  const id = `rules-concepts:${dur}`;
  // Only register if the entity actually exists in the registry — some durations
  // may not be present if the parser changes.
  if (!registry.some((e) => e.id === id)) continue;
  matchers.push({
    form: dur,
    key: dur.toLowerCase(),
    id,
    type: "rules-concepts",
    caseSensitive: false,
    lookahead: `\\s+(?:${callKeywordRe})\\b`,
  });
}

// "Quick X" / "Slow X" are count durations — the entity name literally contains
// the placeholder X. They appear in body text as "Quick 10", "Quick 100",
// "Quick Count of 30", "Slow 5", but also as call shapes like "Quick Repel by
// Agony" or "Quick Slow" where the next word is an effect/defense rather than
// a number. Lookahead matches any of those three shapes.
const COUNT_DURATIONS = [
  { word: "Quick", entityName: "“Quick X” Count" },
  { word: "Slow",  entityName: "“Slow X” Count" },
];
for (const { word, entityName } of COUNT_DURATIONS) {
  const id = `rules-concepts:${entityName}`;
  if (!registry.some((e) => e.id === id)) continue;
  matchers.push({
    form: word,
    key: word.toLowerCase(),
    id,
    type: "rules-concepts",
    caseSensitive: false,
    lookahead: `\\s+(?:\\d+|Count\\b|(?:${callKeywordRe})\\b)`,
  });
}
// Re-sort: contextual matchers (lookahead and paramSuffix) run FIRST so the
// trailing word/value they require — e.g. "Grant" after "Short", or "(Religious)"
// after "Lore" — is still on the page and hasn't been consumed by an earlier
// same-length match. paramSuffix matchers also need to fire before their own
// bare-form sibling so "Lore (Religious)" links to skills:Lore via the param-
// suffix matcher (consuming both words) before the bare "Lore" matcher fires.
// Within each group, longest form first as before.
const contextual = (m) => m.lookahead || m.paramSuffix;
matchers.sort((a, b) => {
  if (contextual(a) !== contextual(b)) return contextual(a) ? -1 : 1;
  return b.form.length - a.form.length;
});

const skillForms = matchers.filter((m) => m.type === "skills");

// Three distinct relationship kinds, kept separate:
//   mentions / mentionedBy — body-text references (the reading-aid graph)
//   prereqs                — a skill's structured requirements
//   unlocks                — inverse of prereqs (what a skill is required for)
const mentions = {};
const mentionedBy = {};
const prereqs = {};
const unlocks = {};

for (const e of registry) {
  mentions[e.id] = [];
  mentionedBy[e.id] = mentionedBy[e.id] || [];
}

// Body-text reference graph (mentions only — never prereqs).
for (const e of registry) {
  const refs = findRefs(e.body, e.id, matchers);
  mentions[e.id] = refs;
  for (const r of refs) (mentionedBy[r] = mentionedBy[r] || []).push(e.id);
}

// Structured prereqs from skills, and their inverse (unlocks).
const skills = read("skills.json");
for (const s of skills) {
  const id = `skills:${s.name}`;
  prereqs[id] = parsePrereq(s.prereq, skillForms);
  // Required skills and every disjunction alternative both unlock this skill.
  const depIds = [...prereqs[id].skills, ...prereqs[id].anyOf.flat()];
  for (const dep of depIds) {
    (unlocks[dep] = unlocks[dep] || []).push(id);
  }
}

for (const id of Object.keys(mentionedBy)) mentionedBy[id] = [...new Set(mentionedBy[id])];
for (const id of Object.keys(unlocks)) unlocks[id] = [...new Set(unlocks[id])];

// ─── ARCHETYPE STRUCTURED REFS ───────────────────────────────────────────────
// Resolve every skill/perk/power listed in each archetype to an entity id,
// keyed by which field it came from. This is the typed, drift-tolerant
// complement to the body-text mentions pass — useful for the future UI to
// jump from an archetype directly to the entities it picks. Each non-literal
// resolution is logged so authoring drift between docs stays visible.

// Type-scoped lookup tables. The archetype fields each map to one of these
// scopes (a starting "skill" might actually be a perk granted free by class,
// a "purchased skill" might be a [Class] H4 power bought with BP).
const allPowers = registry.filter((e) => e.type === "powers");
const allSkills = registry.filter((e) => e.type === "skills");
const allClassPowers = registry.filter((e) => e.type === "powers"); // class skills are powers in our registry
const allPerks = registry.filter((e) => e.type === "perks");
const allFlaws = registry.filter((e) => e.type === "flaws");
const startingLookup = buildLookup([...allSkills, ...allClassPowers, ...allPerks]);
const purchasedSkillLookup = buildLookup([...allSkills, ...allClassPowers, ...allPowers]);
const perkLookup = buildLookup(allPerks);
const flawLookup = buildLookup(allFlaws);
const powerLookup = buildLookup(allPowers);

const archetypeRefs = {};
const archetypeDrift = [];

// Each archetype field → which lookup table to resolve against.
const ARCHETYPE_FIELD_LOOKUPS = {
  startingSkills: startingLookup,
  purchasedSkills: purchasedSkillLookup,
  purchasedPerks: perkLookup,
  flaws: flawLookup,
  innatePowers: powerLookup, utilityPowers: powerLookup,
  basicPowers: powerLookup, advancedPowers: powerLookup,
  veteranPowers: powerLookup, cantrips: powerLookup,
  noviceSpells: powerLookup, adeptSpells: powerLookup,
  greaterSpells: powerLookup, bookSpells: powerLookup,
  domainPowers: powerLookup, rightHandPowers: powerLookup,
  classPowers: powerLookup, formPowers: powerLookup,
};

for (const a of read("archetypes.json")) {
  const archetypeId = `archetypes:${a.name}`;
  archetypeRefs[archetypeId] = {};
  for (const [field, lookup] of Object.entries(ARCHETYPE_FIELD_LOOKUPS)) {
    const items = a[field];
    if (!Array.isArray(items) || items.length === 0) continue;
    const ids = [];
    for (const raw of items) {
      const { entity, drift } = resolve(raw, lookup);
      if (entity) {
        ids.push(entity.id);
        // Backlink: each referenced entity gets a mentionedBy edge from the
        // archetype, so the graph supports "which archetypes pick this power?".
        if (entity.id !== archetypeId) {
          (mentionedBy[entity.id] = mentionedBy[entity.id] || []).push(archetypeId);
        }
        if (drift) archetypeDrift.push({ archetype: a.name, field, raw, drift });
      }
    }
    archetypeRefs[archetypeId][field] = [...new Set(ids)];
  }
}
// Re-dedupe mentionedBy after archetype backlinks were appended.
for (const id of Object.keys(mentionedBy)) mentionedBy[id] = [...new Set(mentionedBy[id])];

// Doc-derived effect→condition relationships (and the inverse).
const causesCondition = {};
const causedBy = {};
for (const e of registry) {
  if (e.type === "effects" && e.causesCondition) {
    const condId = `conditions:${e.causesCondition}`;
    causesCondition[e.id] = condId;
    (causedBy[condId] = causedBy[condId] || []).push(e.id);
  }
}

const result = {
  generatedFrom: "src/data/*.json",
  entities: registry.length,
  mentions,
  mentionedBy,
  causesCondition,
  causedBy,
  prereqs,
  unlocks,
  archetypeRefs,
};

writeFileSync(join(DATA, "refs.json"), JSON.stringify(result, null, 2));

const totalRefs = Object.values(mentions).reduce((a, r) => a + r.length, 0);
const totalPrereqEdges = Object.values(prereqs).reduce((a, p) => a + p.skills.length, 0);
const totalArchetypeRefs = Object.values(archetypeRefs).reduce(
  (a, fields) => a + Object.values(fields).reduce((b, ids) => b + ids.length, 0), 0);
console.log(`  ${registry.length} entities, ${totalRefs} body references, ${totalPrereqEdges} prereq edges, ${totalArchetypeRefs} archetype refs`);
if (archetypeDrift.length) {
  console.log(`  ${archetypeDrift.length} archetype refs resolved via drift fallback (see validate-archetypes for detail).`);
}
console.log("  refs.json written.");
