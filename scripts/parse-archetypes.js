#!/usr/bin/env node
// parse-archetypes.js — reads StarterCharacterSheets.html (Google Docs export),
// extracts one archetype per H1, writes src/data/archetypes.json.
//
// Each archetype is a pre-built level-4 character template — class, lineage,
// stats, skills (free + purchased with BP costs), perks, powers (innate, utility,
// basic, cantrips, spells). Used by the character builder for newbie defaults
// and as a regression suite (every archetype should be a legal build).
//
// Run: node scripts/parse-archetypes.js

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { LABEL_FIELD, CHOICE_DEFAULTS } from '../src/data/sheet-schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DOC = join(ROOT, 'StarterCharacterSheets.html');
const OUT = join(ROOT, 'src', 'data', 'archetypes.json');
const CLASSES_JSON = join(ROOT, 'src', 'data', 'classes.json');

// Map of class name → array of specialization names, e.g. Artisan → [Artificer,
// Crafter, Mystic]. Used to extract the implied specialization from archetype
// names like "Artificer Artisan" (where "Artificer" is the spec, "Artisan" is
// the base class). Optional dependency — if classes.json doesn't exist yet
// (running parse-archetypes before parse-megadoc), skip specialization extraction.
let CLASS_SPECS = {};
if (existsSync(CLASSES_JSON)) {
  const classes = JSON.parse(readFileSync(CLASSES_JSON, 'utf8'));
  for (const c of classes) {
    CLASS_SPECS[c.name] = (c.specializations || []).map((s) => s.name);
  }
}

// Skills with `ranks: "unlimited"` (Lore, Bookcaster, Divine Favor) are NOT
// leveled — "Skill xN" means N SEPARATE skill instances (each a distinct subject /
// spell), not rank N of one skill. We expand those into N rows; everything else
// keeps `xN` = rank N. Sourced from skills.json so the rule is data-driven.
const SKILLS_JSON = join(ROOT, 'src', 'data', 'skills.json');
const UNLIMITED_SKILLS = new Set();
if (existsSync(SKILLS_JSON)) {
  for (const s of JSON.parse(readFileSync(SKILLS_JSON, 'utf8'))) {
    if (String(s.ranks).toLowerCase() === 'unlimited') UNLIMITED_SKILLS.add(s.name);
  }
}

if (!existsSync(DOC)) {
  console.error(`Missing ${DOC} — drop the export at the project root and rerun.`);
  process.exit(1);
}

const raw = readFileSync(DOC, 'utf8');

// ─── HTML PARSER ──────────────────────────────────────────────────────────────
// Mirrors the walker in parse-megadoc.js. Kept separate so this script stays
// standalone and one HTML schema change can't break both.

function decode(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘')
    .replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”')
    .replace(/&hellip;/g, '…').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&[a-z]+;/gi, '');
}
const stripTags = (s) => decode(s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();

function parseHTML() {
  const nodes = [];
  const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
  const BLOCK = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
  let pos = 0, inTag = null, buf = '';
  let m;
  while ((m = TAG.exec(raw)) !== null) {
    if (inTag) buf += raw.slice(pos, m.index);
    pos = m.index + m[0].length;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (!closing && BLOCK.has(tag)) { buf = ''; inTag = tag; }
    else if (closing && inTag === tag) {
      const text = stripTags(buf).trim();
      buf = ''; inTag = null;
      if (!text) continue;
      if (/^h[1-6]$/.test(tag)) nodes.push({ type: 'heading', level: +tag[1], text });
      else nodes.push({ type: 'text', text });
    }
  }
  return nodes;
}

const nodes = parseHTML();

// Strip author-side bookkeeping notes from a list item before it lands in the
// archetype JSON. These are courtesy reminders explaining how a player got the
// item for free or at a discount — they have no mechanical structure beyond the
// BP cost (already written outside the parens) and clutter the canonical name.
//
// Stripped patterns (anywhere in the line):
//   (from X)
//   (free from X)
//   (discounted from X)
//   (refunded from X)
//   (N BP refunded from X)
//   (-N BP refunded from X)
//   (starting <something>)
// Kept patterns:
//   (your choice)         — instruction to the player
//   (Daggers), (Religious) — parameter values for parameterized entities
const BOOKKEEPING_NOTE = /\s*\((?:-?\d+\s*BP\s+)?(?:free\s+from|discounted\s+from|refunded\s+from|from|starting)[^()]*\)/gi;

// Trailing effective-cost suffix the doc author writes on purchased items, e.g.
// "Shield Expertise - 5 BP". This is the *effective* per-build cost (after class
// grants / upgrade discounts), which can differ from the entity's generic cost.
// We strip it from the canonical name but capture the number so the validator
// can cross-check its computed cost against the author's intent.
const BP_SUFFIX = /\s*-\s*(-?\d+)\s*BP\s*$/i;
const parseBPSuffix = (s) => {
  // The "- N BP" cost may be followed by a trailing bookkeeping note, e.g.
  // "Lore x2 (your choice) - 2 BP (discounted from Sharp Mind)". Strip the note
  // first so the cost suffix lands at end-of-string for the match.
  const m = s.replace(BOOKKEEPING_NOTE, '').match(BP_SUFFIX);
  return m ? parseInt(m[1], 10) : null;
};

// The bookkeeping notes aren't just clutter — they're the hand-authored grant
// model. "(from Linked Armor Utility Power)" means the item is granted by that
// power and so costs no BP; "(1 BP refunded from Poisoner)" is a discount.
// Parse the first such note on a line into structured provenance so the
// validator can model grants/discounts instead of guessing from prose.
//   kind: 'grant'   — fully free, granted by source (free from / from / starting)
//         'discount'— partial refund (N BP refunded / discounted from)
//   amount: BP refunded for discounts (null for full grants)
//   source: the granting entity text ("Linked Armor", "Poisoner"), best-effort
const NOTE_DETAIL = /\((?:(-?\d+)\s*BP\s+)?(free\s+from|discounted\s+from|refunded\s+from|from|starting)\s*([^()]*)\)/i;
function parseProvenance(s) {
  const m = s.match(NOTE_DETAIL);
  if (!m) return null;
  const [, amt, verb, rest] = m;
  const v = verb.toLowerCase();
  const kind = (v === 'refunded from' || v === 'discounted from' || amt) ? 'discount' : 'grant';
  // The note may name the source's ROLE ("Utility Power", "innate Power", "Perk").
  // Capture it (when stated) so the UI can say what kind of thing granted this,
  // then strip it from `source` so that's just the entity name. Role isn't always
  // present ("from The Learned One") — the UI can fall back to entity lookup.
  const roleMatch = rest.match(/\b((?:utility|innate|basic|class|advanced|veteran)?\s*power|perk|skill|class\s+feature)\b/i);
  const sourceRole = roleMatch ? roleMatch[1].replace(/\s+/g, ' ').trim().toLowerCase() : null;
  const source = rest.replace(/\b(utility|innate|basic|class|advanced|veteran)?\s*power\b/i, '')
                     .replace(/\bperk\b/i, '').replace(/\bskill\b/i, '').replace(/\bclass\s+feature\b/i, '')
                     .replace(/\s+/g, ' ').trim() || null;
  return { kind, amount: amt ? Math.abs(parseInt(amt, 10)) : null, source, sourceRole };
}

// Rank multiplier: "Foo x2" / "Foo x2 (your choice)" means take Foo twice. We
// keep ONE row and record the count in a `ranks` sidecar; the name is stripped of
// the multiplier. Returns the rank (default 1) and the cleaned string.
const RANK_RE = /\s*x\s*(\d+)\b/i;
function parseRank(s) {
  const m = s.match(RANK_RE);
  return m ? parseInt(m[1], 10) : 1;
}

// "(your choice)" is a parameter placeholder the author leaves for the player. For
// a complete starter we pick a reasonable concrete value (CHOICE_DEFAULTS, shared
// from sheet-schema.js) and keep the PARAMETERIZED form (e.g. "Lore (your choice)"
// → "Lore (Historical)"), which still resolves to the base entity (skills:Lore).
// Instance i takes the i-th value so an expanded "Lore x2" becomes two DIFFERENT
// Lores (collisions would otherwise overwrite each other in the by-item map).
// The base skill name of an item line (leading words before " - ", " x", " (").
function baseSkillName(s) {
  return s.replace(RANK_RE, '').split(/\s*-\s*|\s*\(/)[0].trim();
}
// Replace a "(your choice)" parameter with the `instance`-th concrete default for
// the base skill (default 0). If no mapped default, drop the placeholder.
function concretizeChoice(s, instance = 0) {
  if (!/\(your choice\)/i.test(s)) return s;
  const defaults = CHOICE_DEFAULTS[baseSkillName(s)];
  const choice = defaults ? defaults[instance % defaults.length] : null;
  return s.replace(/\s*\(your choice\)/i, choice ? ` (${choice})` : '');
}

const stripNotes = (s, instance = 0) =>
  concretizeChoice(s, instance)
    .replace(BOOKKEEPING_NOTE, '')
    .replace(BP_SUFFIX, '')
    .replace(RANK_RE, '')
    .replace(/\s+/g, ' ')
    .trim();

// ─── ARCHETYPE EXTRACTION ─────────────────────────────────────────────────────
// Each archetype is an H1 whose text nodes alternate between labeled fields
// ("Lineage: Human", "Life Points: 4") and section headers ("Starting Skills
// (free):", "Innate Powers:") that introduce a list of items running until the
// next labeled or header line.
//
// The label→field map is shared with the runtime importer (sheet-schema.js) so
// the two parsers can't drift on spelling/casing variants. The HTML walker still
// needs to know which labels are *section headers* (gather the item-nodes that
// follow) vs *inline labels* (take the value on the same line) — that split is
// structural to this parser, so we partition the shared map here by field name.
//
// Fields whose label appears as an inline "Label: value" line:
const INLINE_FIELD_NAMES = new Set([
  'lineage', 'lineageChallenges', 'lineageAdvantages', 'lifePoints', 'armorPoints',
  'spikes', 'classLevels', 'specialization', 'devotion', 'flaws', 'divineDomains',
  'devotionAccents', 'noviceSpellSlots', 'adeptSpellSlots', 'greaterSpellSlots',
]);
const SECTION_FIELDS = Object.fromEntries(
  Object.entries(LABEL_FIELD).filter(([, f]) => !INLINE_FIELD_NAMES.has(f)),
);
const INLINE_FIELDS = Object.fromEntries(
  Object.entries(LABEL_FIELD).filter(([, f]) => INLINE_FIELD_NAMES.has(f)),
);

// Inline-list fields are stored as arrays (split on ", "). Comma-less values
// pass through as single-element arrays.
const LIST_FIELDS = new Set([
  'lineageChallenges', 'lineageAdvantages', 'flaws',
  'divineDomains', 'devotionAccents',
]);

// "None" → empty array (for list fields) or null (for scalar fields).
const normalizeListValue = (v) => v.trim() === 'None' ? [] : v.split(/,\s*/).map((s) => s.trim()).filter(Boolean);

// Parse a section-header line: text ending with a colon, optionally followed
// by an inline value. "Starting Skills (free):" → header; "Lineage: Human"
// → inline field. Also catches the no-space-after-colon defect where the
// doc author wrote "Purchased Perks:Deathgrip..." as one line — when the
// label is a known section header, the rest of the line is the first item.
const HEADER_RE = /^([^:]+):\s*$/;
const INLINE_RE = /^([^:]+):\s+(.+)$/;
const HEADER_PLUS_ITEM_RE = /^([^:]+):(\S.+)$/;

function parseArchetype(start, end) {
  const archetype = { name: nodes[start].text };
  // The first non-header text line is the tagline (e.g. "Guard your allies,
  // block hits, and take a beating…").
  let i = start + 1;
  if (i < end && nodes[i].type === 'text' && !INLINE_RE.test(nodes[i].text) && !HEADER_RE.test(nodes[i].text)) {
    archetype.tagline = nodes[i].text;
    i++;
  }

  let currentList = null;   // when truthy, subsequent unlabeled text lines append here
  let currentField = null;  // field name backing currentList, for the BP sidecar
  // effectiveBP[field] and grants[field] are index-aligned with archetype[field]:
  // the author's stated per-build cost and grant provenance for each item (null
  // when none was written).
  archetype.effectiveBP = {};
  archetype.grants = {};
  archetype.ranks = {};

  // Append a raw item line to the current section list, splitting off the
  // trailing "- N BP" cost, the "(from X)" provenance note, and the "xN" rank
  // multiplier into index-aligned sidecars before storing the cleaned name.
  //
  // For UNLIMITED-ranks skills (Lore, Bookcaster, …), "xN" means N SEPARATE
  // instances, not rank N — so expand into N distinct rows, each with its own
  // concrete subject. Per-instance cost is left to the validator to DERIVE (base
  // minus any discount source the character owns), so we store effectiveBP: null
  // and drop the authored discount note (the engine applies it once per instance —
  // keeping the note too would double-count). Genuine ranked skills keep one row
  // with ranks: N and their authored cost.
  const pushOne = (name, bp, grant, rank) => {
    currentList.push(name);
    (archetype.effectiveBP[currentField] ||= []).push(bp);
    (archetype.grants[currentField] ||= []).push(grant);
    (archetype.ranks[currentField] ||= []).push(rank);
  };
  const pushItem = (rawLine) => {
    if (!currentList) return;
    const count = parseRank(rawLine);
    const base = baseSkillName(stripNotes(rawLine));
    if (count > 1 && UNLIMITED_SKILLS.has(base)) {
      for (let k = 0; k < count; k++) {
        let name = stripNotes(rawLine, k);
        // Give each instance a distinct concrete subject so they don't collide in
        // the validator's by-item map. "(your choice)" was already concretized by
        // stripNotes; for skills without that token (e.g. Bookcaster picks a
        // spell), append the k-th default here.
        if (!/\(/.test(name) && CHOICE_DEFAULTS[base]) {
          const d = CHOICE_DEFAULTS[base];
          name = `${name} (${d[k % d.length]})`;
        }
        pushOne(name, null, null, 1);  // derive cost per instance
      }
      return;
    }
    pushOne(stripNotes(rawLine), parseBPSuffix(rawLine), parseProvenance(rawLine), count);
  };

  while (i < end) {
    const n = nodes[i];
    if (n.type !== 'text') { i++; continue; }
    const text = n.text;

    const inlineMatch = text.match(INLINE_RE);
    const headerMatch = text.match(HEADER_RE);
    const headerPlusItemMatch = !inlineMatch && !headerMatch && text.match(HEADER_PLUS_ITEM_RE);
    // "Purchased Perks:Deathgrip..." → label "Purchased Perks", first item
    // "Deathgrip...". Only honour this shape when the label is a known section
    // header (otherwise things like "URL:https://..." would false-trigger).
    const headerPlusItem = headerPlusItemMatch && SECTION_FIELDS[headerPlusItemMatch[1].trim()]
      ? headerPlusItemMatch : null;

    if (inlineMatch) {
      const [, rawLabel, value] = inlineMatch;
      const label = rawLabel.trim();
      const inlineField = INLINE_FIELDS[label];
      const sectionField = SECTION_FIELDS[label];
      if (inlineField) {
        archetype[inlineField] = LIST_FIELDS.has(inlineField) ? normalizeListValue(value) : value.trim();
      } else if (sectionField) {
        // Section-list field written inline ("Purchased Perks: None" — common
        // shorthand). "None" closes the list as empty; any other value would
        // be unexpected here, so treat it as a single-item list.
        if (value.trim() === 'None') {
          archetype[sectionField] = [];
        } else {
          archetype[sectionField] = [stripNotes(value)];
          archetype.effectiveBP[sectionField] = [parseBPSuffix(value)];
          archetype.grants[sectionField] = [parseProvenance(value)];
        }
      }
      currentList = null;
      currentField = null;
    } else if (headerMatch) {
      const label = headerMatch[1].trim();
      const inlineField = INLINE_FIELDS[label];
      const sectionField = SECTION_FIELDS[label];
      if (sectionField) {
        archetype[sectionField] = [];
        currentList = archetype[sectionField];
        currentField = sectionField;
      } else if (inlineField) {
        // Scalar field with no value after the colon ("Armor Points:" with
        // empty value). Record explicit null instead of silently dropping.
        archetype[inlineField] = LIST_FIELDS.has(inlineField) ? [] : null;
        currentList = null;
        currentField = null;
      } else {
        // Unknown header — close any open list so its items don't accidentally
        // get appended to it.
        currentList = null;
        currentField = null;
      }
    } else if (headerPlusItem) {
      const [, rawLabel, firstItem] = headerPlusItem;
      const field = SECTION_FIELDS[rawLabel.trim()];
      archetype[field] = [];
      currentList = archetype[field];
      currentField = field;
      pushItem(firstItem);
    } else if (currentList) {
      pushItem(text);
    }
    i++;
  }

  // Infer specialization from the archetype's H1 name. The convention is
  // "<Specialization> <BaseClass>" — e.g. "Artificer Artisan", "Mystic
  // Artisan". When the first word of the archetype name matches a known
  // specialization for the base class implied by `classLevels`, record it.
  //
  // Side effect: the starter sheets occasionally have a doc-author error where
  // `Class Levels: Artificer 4` was written instead of `Class Levels: Artisan 4`.
  // When we detect the spec, we correct classLevels too.
  if (archetype.classLevels) {
    const classMatch = archetype.classLevels.match(/^([A-Z][a-zA-Z]+)\s+(\d+)/);
    if (classMatch) {
      const [, declaredClass, level] = classMatch;
      // Find which base class has this declaredClass as a specialization
      const baseClass = Object.entries(CLASS_SPECS).find(([, specs]) => specs.includes(declaredClass))?.[0];
      if (baseClass) {
        archetype.specialization = declaredClass;
        archetype.classLevels = `${baseClass} ${level}`;
      } else if (CLASS_SPECS[declaredClass]) {
        // declaredClass IS a known base class. Look for spec in archetype name.
        const firstWord = archetype.name.split(/\s+/)[0];
        if (CLASS_SPECS[declaredClass].includes(firstWord)) {
          archetype.specialization = firstWord;
        }
      }
    }
  }

  // Drop each sidecar entirely when no item carried that kind of annotation, so
  // archetypes without authored costs / grants stay clean.
  const anyBP = Object.values(archetype.effectiveBP).some((arr) => arr.some((v) => v !== null));
  if (!anyBP) delete archetype.effectiveBP;
  const anyGrant = Object.values(archetype.grants).some((arr) => arr.some((v) => v !== null));
  if (!anyGrant) delete archetype.grants;
  const anyRank = Object.values(archetype.ranks).some((arr) => arr.some((v) => v > 1));
  if (!anyRank) delete archetype.ranks;

  // Devotion can come from an inline "Devotion: <X>" label or be encoded in the
  // Worship skill as "Worship - <X>". The Worship skill is the canonical source
  // (it's what costs BP and gates the domains); the inline label is a convenience
  // fallback when no Worship skill is listed. When BOTH are present they must name
  // the same devotion — a mismatch is a data error, so warn rather than silently
  // trusting one over the other.
  const worshipMatch = [...(archetype.startingSkills || []), ...(archetype.purchasedSkills || [])]
    .map((s) => s.match(/^Worship\s*[-–—:]\s*(.+)$/i))
    .find(Boolean);
  const worshipDevotion = worshipMatch ? worshipMatch[1].trim() : null;
  if (worshipDevotion && archetype.devotion && archetype.devotion !== worshipDevotion) {
    console.warn(`  ⚠ ${archetype.name}: devotion mismatch — inline "${archetype.devotion}" vs Worship "${worshipDevotion}"; using Worship.`);
  }
  if (worshipDevotion) archetype.devotion = worshipDevotion;

  return archetype;
}

const archetypes = [];
for (let i = 0; i < nodes.length; i++) {
  const n = nodes[i];
  if (n.type !== 'heading' || n.level !== 1) continue;
  // Skip the "Table of Contents" wrapper H1 — it has no archetype data under it.
  if (n.text === 'Table of Contents') continue;
  const nextH1 = nodes.findIndex((m, j) => j > i && m.type === 'heading' && m.level === 1);
  const end = nextH1 === -1 ? nodes.length : nextH1;
  archetypes.push(parseArchetype(i, end));
}

writeFileSync(OUT, JSON.stringify(archetypes, null, 2));
console.log(`archetypes.json  ${archetypes.length} entries`);
