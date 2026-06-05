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
const TYPE_PRIORITY = ["effects", "conditions", "creature-types", "resources", "accents", "defenses", "modifiers", "crafting-concepts", "ritual-concepts", "skills", "perks", "flaws", "classes", "domains", "devotions", "powers", "recipes", "rituals", "advantages", "challenges", "archetypes", "rules-concepts", "terms"];

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
  // Lineage advantages/challenges are linkable entities in their own right: their
  // descriptions bestow named abilities ("gains the Magical Resilience Perk") and
  // carry grant/discount consequences, so they must be in the registry to be a
  // source of those edges. Typed as advantages/challenges, scoped per lineage so
  // same-named items in different lineages stay distinct.
  read("lineages.json").forEach((lin) => {
    (lin.advantages || []).forEach((a) => add("advantages", `${lin.name} - ${a.name}`, a.description, { lineage: lin.name, baseName: a.name }));
    (lin.challenges || []).forEach((c) => add("challenges", `${lin.name} - ${c.name}`, c.description, { lineage: lin.name, baseName: c.name }));
  });
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
    // Lineage advantages/challenges are link SOURCES (their bodies bestow/grant),
    // never surface-form link targets — you reach them through the lineage UI, not
    // by a prose mention of "Deep Reserves". Skip generating matchers for them so
    // their names don't pollute the mention graph.
    if (e.type === "advantages" || e.type === "challenges") continue;
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
    // Level requirement: "N levels in X", "Nth character-level", "Character Level N", or non-casting/class levels.
    const lvl = part.match(/(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)(?:st|nd|rd|th)?\s*(?:levels?|character-level|character level)/i)
      || part.match(/(?:level|character[- ]level)\s*(\d+)/i)
      || part.match(/class-levels/i)
      || part.match(/level\s+in\s+a\s+non-casting\s+class/i);

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

// ─── BESTOWAL GRANTS ──────────────────────────────────────────────────────────
// Some entities BESTOW a named ability: "the character gains the Magical
// Resilience Perk", "gains the Regenerate Power", "adds the Poisoner Skill". This
// is distinct from a body MENTION — it means "now possess this entity, for free".
// Parse the explicit "gains/adds the <Name> <Perk|Power|Skill>" form and resolve
// <Name> against the matching type's lookup. Conservative: only the explicit
// noun-tagged form, so prose like "gains 3 points of Natural Armor" stays prose.
const GRANT_RE = /\b(?:gains?|adds?|learns?|receives?|granted)\s+(?:the\s+|one\s+|a\s+|all\s+the\s+)?([A-Z][\w’'-]+(?:\s+[A-Z][\w’'-]+){0,3})\s+(Perk|Power|Skill)\b/gi;
// "Grant Power: X" (a power's Call that bestows the sub-power X) — X is a power.
const GRANT_POWER_CALL = /\bGrant Power:\s*([A-Z][\w’'-]+(?:\s+[A-Z][\w’'-]+){0,3})/g;
// "the X Power below" — the unambiguous sub-power marker (any surrounding verb).
// The name may contain lowercase connectors (Save *the* Day), so allow them mid-name.
const GRANT_BELOW = /\bthe\s+([A-Z][\w’'-]+(?:\s+(?:[A-Z][\w’'-]+|the|of|and|to|a))*)\s+Power\s+below\b/g;
function parseGrants(text, grantLookups) {
  if (!text) return [];
  const out = new Set();
  let m;
  for (const RE of [GRANT_POWER_CALL, GRANT_BELOW]) {
    RE.lastIndex = 0;
    while ((m = RE.exec(text))) {
      const { entity } = resolve(m[1].trim(), grantLookups.power);
      if (entity) out.add(entity.id);
    }
  }
  GRANT_RE.lastIndex = 0;
  while ((m = GRANT_RE.exec(text))) {
    const name = m[1].trim();
    const noun = m[2].toLowerCase(); // perk | power | skill
    const lookup = grantLookups[noun];
    if (!lookup) continue;
    const { entity } = resolve(name, lookup);
    if (entity) out.add(entity.id);
  }

  // Dynamic check for name followed by parenthesized number in description containing gains/free/choose
  if (/\b(gains?|adds?|learns?|receives?|granted|free|choose)\b/i.test(text)) {
    const PAREN_NUM_RE = /\b([A-Z][\w’'-]+(?:\s+(?:[A-Z][\w’'-]+|of|the|and|to|a|in)){0,4})\s*\((\d+)\)/g;
    PAREN_NUM_RE.lastIndex = 0;
    while ((m = PAREN_NUM_RE.exec(text))) {
      const name = m[1].trim();
      for (const type of ["perk", "skill", "power"]) {
        const { entity } = resolve(name, grantLookups[type]);
        if (entity) {
          out.add(entity.id);
          break;
        }
      }
    }
  }
  return [...out];
}

// ─── DISCOUNT SOURCES ─────────────────────────────────────────────────────────
// A discount SOURCE makes a whole category of other purchases cheaper, e.g.
// Patron ("any Gift perk … costs 1 BP less … maximum of 10 BP in discounts"),
// Technarchist ("learn any Martial, Medical or Crafting skill for one less BP, to
// a minimum cost of 1"), Human Environmental Mastery ("1 BP discount on Gathering
// skills"), Lost ("first three Lore skills … discounted by 1 BP"). The general
// rule: a discount on something already free becomes free BP (refundIfFree).
//
// Returns { amount, scope, cap, min, refundIfFree, exclusions } or null. Scope is
// the structured target: { kind: 'giftEligible'|'prereq'|'category'|'firstN', value, n? }.
function parseDiscounts(text, exclusionLookup, grantLookups, selfName) {
  if (!text) return null;
  // Must actually be a discount source (not just mention the word in flavor). The
  // doc phrases BP discounts as "BP less", "less BP", or — for skills — "point(s)
  // less" (e.g. Sharp Mind: "Lore ranks cost 1 point less") or "reduced by".
  if (!/\bdiscount(?:ed|s)?\b|\bBP\s+less\b|\bless\s+BP\b|\bpoints?\s+less\b|\breduced\s+by\b/i.test(text)) return null;

  // Amount: "1 BP/point less" / "N BP discount" / "discounted by N BP" / "reduced by [word/number]" → default 1.
  const amtM = text.match(/(\d+)\s*(?:BP|points?)\s+less/i)
    || text.match(/(\d+)\s*BP\s+discount/i)
    || text.match(/discount(?:ed)?\s+(?:by\s+)?(\d+)\s*BP/i)
    || text.match(/reduced\s+by\s+(\d+|one|two|three|four|five)/i)
    || (/\bone\s+less\s+(?:BP|point)\b/i.test(text) ? [null, "1"] : null);
  if (!amtM) return null;

  let amount;
  if (/one/i.test(amtM[1])) amount = 1;
  else if (/two/i.test(amtM[1])) amount = 2;
  else if (/three/i.test(amtM[1])) amount = 3;
  else if (/four/i.test(amtM[1])) amount = 4;
  else if (/five/i.test(amtM[1])) amount = 5;
  else amount = parseInt(amtM[1], 10);

  const cap = (text.match(/maximum\s+of\s+(\d+)\s*BP\s+in\s+discounts/i) || [])[1];
  const min = (text.match(/minimum\s+(?:cost\s+)?of\s+(\d+)/i) || [])[1];
  const refundIfFree = !/does not apply to|granted for free|unless the source states/i.test(text)
    ? true : true; // general rule: refund unless explicitly stated otherwise (rare)

  // Scope detection, most specific first.
  let scope = null;
  // Patron-style opt-in: "Any Perk that doesn't have the <X> prerequisite that is
  // going to be considered a gift from the <X>" — the player DESIGNATES which
  // eligible perks become discounted gifts (not the Gifts themselves, which carry
  // the prerequisite). Distinct from a fixed-category discount.
  const giftM = text.match(/considered\s+a\s+gift\s+from\s+the\s+([A-Z][\w’'-]+)/i)
    || text.match(/doesn[’']?t\s+have\s+the\s+([A-Z][\w’'-]+)\s+prerequisite/i);
  const prereqM = text.match(/with\s+the\s+([A-Z][\w’'-]+(?:\s+[A-Z][\w’'-]+){0,3})\s+prerequisite/i);
  const firstNM = text.match(/first\s+(\w+)\s+([A-Z][\w’'-]+)\s+skills?/i);
  // "<Skill> ranks cost N less" — every rank of one named skill is discounted
  // (Sharp Mind: "Lore ranks cost 1 point less"). Distinct from firstN (no limit).
  const ranksM = text.match(/\b([A-Z][\w’'-]+)\s+ranks?\s+cost\s+\d+\s+(?:point|BP)s?\s+less/i);
  const catM = text.match(/(?:on|any)\s+((?:[A-Z][\w’'-]+(?:,?\s+(?:and\s+|or\s+)?)?){1,4})\s+skills?/i);
  const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  if (giftM) {
    // value = the source perk whose gifts are eligible (Patron); target = any perk
    // the player marks, except those carrying that prereq or listed as exclusions.
    scope = { kind: "giftEligible", value: giftM[1].trim() };
  } else if (ranksM) {
    scope = { kind: "skillRanks", value: ranksM[1].trim() };
  } else if (prereqM) {
    scope = { kind: "prereq", value: prereqM[1].trim() };
  } else if (firstNM) {
    const n = WORD_NUM[firstNM[1].toLowerCase()] || parseInt(firstNM[1], 10) || null;
    scope = { kind: "firstN", value: firstNM[2].trim(), n };
  } else if (catM) {
    const cats = catM[1].split(/,|\band\b|\bor\b/i).map((s) => s.trim()).filter(Boolean);
    scope = { kind: "category", value: cats };
  }

  // Fallback: check if the text mentions a specific known skill name (e.g. Poisoner → Apprentice Alchemy)
  if (!scope && grantLookups) {
    const skills = registry.filter((e) => e.type === "skills");
    for (const sk of skills) {
      if (sk.name === selfName) continue;
      const escaped = sk.name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const re = new RegExp(`\\b${escaped}\\b`, 'i');
      if (re.test(text)) {
        scope = { kind: "skillRanks", value: sk.name };
        break;
      }
    }
  }

  if (!scope) return null;

  // Exclusions: "(The) X and Y (Perks) cannot be discounted".
  const exclusions = [];
  const exM = text.match(/\b((?:The\s+)?[A-Z][\w’'-]+(?:\s+[A-Z][\w’'-]+){0,3}(?:\s+and\s+[A-Z][\w’'-]+(?:\s+[A-Z][\w’'-]+){0,3})?)\s+(?:Perks?\s+)?cannot\s+be\s+discounted/i);
  if (exM) {
    for (let nm of exM[1].split(/\band\b/i).map((s) => s.trim()).filter(Boolean)) {
      nm = nm.replace(/^The\s+/i, '').replace(/\s+Perks?$/i, '').trim();
      const { entity } = resolve(nm, exclusionLookup);
      if (entity) exclusions.push(entity.id);
    }
  }
  return { amount, scope, cap: cap ? parseInt(cap, 10) : null, min: min ? parseInt(min, 10) : null, refundIfFree, exclusions };
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

// Structured prereqs from skills and perks, and their inverse (unlocks).
const eligibleForms = matchers.filter((m) => m.type === "skills" || m.type === "perks");

const skills = read("skills.json");
for (const s of skills) {
  const id = `skills:${s.name}`;
  prereqs[id] = parsePrereq(s.prereq, eligibleForms);
  // Required skills and every disjunction alternative both unlock this skill.
  const depIds = [...prereqs[id].skills, ...prereqs[id].anyOf.flat()];
  for (const dep of depIds) {
    (unlocks[dep] = unlocks[dep] || []).push(id);
  }
}

const perks = read("perks.json");
for (const p of perks) {
  const id = `perks:${p.name}`;
  prereqs[id] = parsePrereq(p.prereq, eligibleForms);
  // Required skills/perks and every disjunction alternative both unlock this perk.
  const depIds = [...prereqs[id].skills, ...prereqs[id].anyOf.flat()];
  for (const dep of depIds) {
    (unlocks[dep] = unlocks[dep] || []).push(id);
  }
}

for (const id of Object.keys(mentionedBy)) mentionedBy[id] = [...new Set(mentionedBy[id])];
for (const id of Object.keys(unlocks)) unlocks[id] = [...new Set(unlocks[id])];

// ─── BESTOWAL + DISCOUNT EDGES ────────────────────────────────────────────────
// Scan every entity body for "gains the X Perk/Power/Skill" (bestowal) and for a
// discount-source clause. Sources are mainly perks, class features (powers), and
// lineage advantages. Resolution lookups are type-scoped so "Magical Resilience
// Perk" resolves against perks, not a same-named power.
const grantTargetLookups = {
  perk: buildLookup(registry.filter((e) => e.type === "perks")),
  power: buildLookup(registry.filter((e) => e.type === "powers")),
  skill: buildLookup(registry.filter((e) => e.type === "skills")),
};
// Exclusions ("Strong Bloodline and Inheritance cannot be discounted") name perks.
const exclusionLookup = grantTargetLookups.perk;

// A few perks modify the Lineage Build Point economy directly: "gain N additional
// Lineage Build Points … increases the maximum to M" (Strong Bloodline). Capture
// the extra LBP and the new cap so the validator's lbpState can honor it.
function parseLbpBonus(text) {
  if (!text) return null;
  const extraM = text.match(/gain\s+(\d+)\s+additional\s+Lineage Build Points/i);
  if (!extraM) return null;
  const maxM = text.match(/(?:increases?|raises?)\s+the\s+maximum\s+to\s+(\d+)/i);
  return { extra: parseInt(extraM[1], 10), newMax: maxM ? parseInt(maxM[1], 10) : null };
}

const grants = {};
const grantedBy = {};
const discounts = {};
const lbpBonuses = {};
for (const e of registry) {
  const g = parseGrants(e.body, grantTargetLookups).filter((id) => id !== e.id);
  if (g.length) {
    grants[e.id] = g;
    for (const t of g) (grantedBy[t] = grantedBy[t] || []).push(e.id);
  }
  const d = parseDiscounts(e.body, exclusionLookup, grantTargetLookups, e.name);
  if (d) discounts[e.id] = d;
  const lb = parseLbpBonus(e.body);
  if (lb) lbpBonuses[e.id] = lb;
}
for (const id of Object.keys(grantedBy)) grantedBy[id] = [...new Set(grantedBy[id])];

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
  grants,
  grantedBy,
  discounts,
  lbpBonuses,
};

writeFileSync(join(DATA, "refs.json"), JSON.stringify(result, null, 2));

const totalRefs = Object.values(mentions).reduce((a, r) => a + r.length, 0);
const totalPrereqEdges = Object.values(prereqs).reduce((a, p) => a + p.skills.length, 0);
const totalGrants = Object.values(grants).reduce((a, g) => a + g.length, 0);
console.log(`  ${registry.length} entities, ${totalRefs} body references, ${totalPrereqEdges} prereq edges`);
console.log(`  ${totalGrants} bestowal edges, ${Object.keys(discounts).length} discount sources`);
if (archetypeDrift.length) {
  console.log(`  ${archetypeDrift.length} archetype refs resolved via drift fallback (see validate-archetypes for detail).`);
}
console.log("  refs.json written.");
