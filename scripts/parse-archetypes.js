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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DOC = join(ROOT, 'StarterCharacterSheets.html');
const OUT = join(ROOT, 'src', 'data', 'archetypes.json');

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

// ─── ARCHETYPE EXTRACTION ─────────────────────────────────────────────────────
// Each archetype is an H1 whose text nodes alternate between labeled fields
// ("Lineage: Human", "Life Points: 4") and section headers ("Starting Skills
// (free):", "Innate Powers:") that introduce a list of items running until the
// next labeled or header line.
//
// Section header → field name on the output object:
const SECTION_FIELDS = {
  'Starting Skills (free)':       'startingSkills',
  'Purchased Skills':             'purchasedSkills',
  'Purchased Perks':              'purchasedPerks',
  'Innate Powers':                'innatePowers',
  'Utility Powers':               'utilityPowers',
  'Basic Powers':                 'basicPowers',
  'Advanced Powers':              'advancedPowers',
  'Veteran Powers':               'veteranPowers',
  'Class Powers':                 'classPowers',
  'Right Hand Powers':            'rightHandPowers',
  'Domain Powers':                'domainPowers',
  'Cantrips':                     'cantrips',
  'Novice Spells known':          'noviceSpells',
  'Novice Spells Known':          'noviceSpells',
  'Adept Spells known':           'adeptSpells',
  'Adept Spells Known':           'adeptSpells',
  'Greater Spells known':         'greaterSpells',
  'Greater Spells Known':         'greaterSpells',
  'Book Spells':                  'bookSpells',
  'Form Powers':                  'formPowers',
};

// Inline label → field name on the output object. Some are list-shaped
// ("Divine Domains: Life, Protection"), some are scalar ("Life Points: 4").
const INLINE_FIELDS = {
  'Lineage':                     'lineage',
  'Lineage Challenges':          'lineageChallenges',
  'Lineage Advantages':          'lineageAdvantages',
  'Life Points':                 'lifePoints',
  'Armor Points':                'armorPoints',
  'Spikes':                      'spikes',
  'Class Levels':                'classLevels',
  'Flaws':                       'flaws',
  'Divine Domains':              'divineDomains',
  'Available Devotion Accents':  'devotionAccents',
  'Novice Spell-slots':          'noviceSpellSlots',
  'Adept Spell-slots':           'adeptSpellSlots',
  'Greater Spell-slots':         'greaterSpellSlots',
};

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
// → inline field.
const HEADER_RE = /^([^:]+):\s*$/;
const INLINE_RE = /^([^:]+):\s+(.+)$/;

function parseArchetype(start, end) {
  const archetype = { name: nodes[start].text };
  // The first non-header text line is the tagline (e.g. "Guard your allies,
  // block hits, and take a beating…").
  let i = start + 1;
  if (i < end && nodes[i].type === 'text' && !INLINE_RE.test(nodes[i].text) && !HEADER_RE.test(nodes[i].text)) {
    archetype.tagline = nodes[i].text;
    i++;
  }

  let currentList = null; // when truthy, subsequent unlabeled text lines append here
  while (i < end) {
    const n = nodes[i];
    if (n.type !== 'text') { i++; continue; }
    const text = n.text;

    const inlineMatch = text.match(INLINE_RE);
    const headerMatch = text.match(HEADER_RE);

    if (inlineMatch) {
      const [, rawLabel, value] = inlineMatch;
      const label = rawLabel.trim();
      const field = INLINE_FIELDS[label];
      if (field) {
        archetype[field] = LIST_FIELDS.has(field) ? normalizeListValue(value) : value.trim();
      }
      currentList = null;
    } else if (headerMatch) {
      const label = headerMatch[1].trim();
      const field = SECTION_FIELDS[label];
      if (field) {
        archetype[field] = [];
        currentList = archetype[field];
      } else {
        // Unknown header — close any open list so its items don't accidentally
        // get appended to it.
        currentList = null;
      }
    } else if (currentList) {
      currentList.push(text);
    }
    i++;
  }
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
