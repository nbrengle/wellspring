#!/usr/bin/env node
// parse-megadoc.js — reads WellspringMegaDoc.html, writes structured JSON to src/data/
// Run: node scripts/parse-megadoc.js

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DOC = join(ROOT, 'WellspringMegaDoc.html');
const OUT = join(ROOT, 'src', 'data');

mkdirSync(OUT, { recursive: true });

// ─── HTML PARSER ──────────────────────────────────────────────────────────────
// Parse the HTML into a flat list of nodes: { type: 'heading'|'text'|'list', level?, text, items? }
// We don't need a full DOM — just heading levels and text content in order.

const raw = readFileSync(DOC, 'utf8');

// Decode common HTML entities.
function decode(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&hellip;/g, '…')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&[a-z]+;/gi, '');
}

function stripTags(s) {
  return decode(s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
}

// Walk the raw HTML once, emitting nodes in document order.
// Headings become { type:'heading', level, text }.
// <li> items become { type:'list', items:[...] } groups.
// <p> / <span> text becomes { type:'text', text }.
// Table cells (<td>) become { type:'cell', text } — used for tab-table equivalents.
function parseHTML() {
  const nodes = [];
  // Match tags we care about. Everything else is consumed as inter-tag text.
  const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
  let pos = 0;
  let inTag = null;      // current open block tag being accumulated
  let inList = false;
  let listItems = [];

  const flushList = () => {
    if (listItems.length) { nodes.push({ type: 'list', items: [...listItems] }); listItems = []; }
    inList = false;
  };

  // We collect text content between tags into a buffer when inside a known block.
  let buf = '';
  const BLOCK_TAGS = new Set(['p','li','td','th','h1','h2','h3','h4','h5','h6']);

  let match;
  TAG.lastIndex = 0;
  while ((match = TAG.exec(raw)) !== null) {
    const between = raw.slice(pos, match.index);
    if (inTag) buf += between;
    pos = match.index + match[0].length;

    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();

    if (!closing && BLOCK_TAGS.has(tag)) {
      buf = '';
      inTag = tag;
    } else if (closing && inTag === tag) {
      const text = stripTags(buf).trim();
      buf = '';
      inTag = null;
      if (!text) continue;

      if (tag === 'li') {
        listItems.push(text);
      } else {
        if (listItems.length && tag !== 'li') flushList();
        if (/^h[1-6]$/.test(tag)) {
          nodes.push({ type: 'heading', level: +tag[1], text });
        } else if (tag === 'td' || tag === 'th') {
          nodes.push({ type: 'cell', text });
        } else {
          nodes.push({ type: 'text', text });
        }
      }
    } else if (!closing && tag === 'ul' || !closing && tag === 'ol') {
      inList = true;
    } else if (closing && (tag === 'ul' || tag === 'ol')) {
      flushList();
    }
  }
  flushList();
  return nodes;
}

const nodes = parseHTML();

// ─── DEMOTED POWER HEADING RECOVERY ──────────────────────────────────────────
// In the current Google Docs export, several power entries are styled to LOOK
// like H4 headings (bold, same font as their siblings) but the underlying HTML
// is <p><span class="cN">...</span></p>. The walker sees them as plain text and
// the downstream class/domain parsers skip them. We recover by promoting text
// nodes that match the power-heading grammar AND are followed by a power
// stat-block field. Each promoted node is given the level of the nearest
// sibling power heading (H3 for domain powers, H4 for class powers), so the
// downstream parsers see them the same as un-demoted entries.
//
// See DOC_EDITS_WANTED.md #11g. Known affected entries: Care for the Fallen,
// Arcane Barrage, Rise Above This, Infuriate, Synergistic Transfer, Disruption
// (all [Tier]-tagged) and Lifeline - 3 BP (domain power, no tier tag).
// Demote "headings" that are clearly prose paragraphs misstyled as H2/H3 in
// the source doc — they truncate the real heading's range and cause the next
// power section to look empty. Heuristic: a real heading is short (≤80 chars)
// AND ends without sentence punctuation. Anything else gets demoted to text
// so the heading walker treats it as body content.
//
// See DOC_EDITS_WANTED.md #11g/#11h. Known affected: "These Options are
// available for the Socialite..." at Socialite Right Hand Powers, miscast as
// H2 in the export.
for (let i = 0; i < nodes.length; i++) {
  const n = nodes[i];
  if (n.type !== 'heading' || !n.text) continue;
  if (n.level !== 2 && n.level !== 3) continue;
  const looksLikeProse = n.text.length > 80 && /[.!?]\s*$/.test(n.text);
  if (looksLikeProse) nodes[i] = { type: 'text', text: n.text };
}

const POWER_STAT_FIELD = /^(Incantation|Incant|Call|Target|Refresh|Cost|Requirement|Prerequisites?):\s/;
// A power heading has either a tier tag in brackets OR a "- N BP" cost suffix.
// Class powers live at H4 in the doc; domain powers at H3. Tier-tag presence
// alone isn't enough to decide (domain powers may carry [Adept], [Greater],
// etc.) — we also check whether the demoted entry sits inside the Divine
// Domains section.
const DEMOTED_POWER_TIERED = /^.{2,80}\[(Utility|Basic|Advanced|Veteran|Cantrip|Novice|Adept|Greater|Innate|Class|Form|Right Hand)\]/;
const DEMOTED_POWER_DOMAIN = /^[A-Z][^[\n]{1,60}-\s*\d+\s*BP\s*$/;
// Find the H1 range of "Divine Domains" so we can tell which demoted entries
// belong to a domain (→ H3) vs. a class (→ H4).
const divineDomainsIdx = nodes.findIndex((m) => m.type === 'heading' && m.level === 1 && m.text === 'Divine Domains');
const divineDomainsEndIdx = nodes.findIndex((m, j) => j > divineDomainsIdx && m.type === 'heading' && m.level === 1);
const inDivineDomains = (idx) => divineDomainsIdx !== -1 && idx > divineDomainsIdx && (divineDomainsEndIdx === -1 || idx < divineDomainsEndIdx);

for (let i = 0; i < nodes.length; i++) {
  const n = nodes[i];
  if (n.type !== 'text') continue;
  if (!DEMOTED_POWER_TIERED.test(n.text) && !DEMOTED_POWER_DOMAIN.test(n.text)) continue;
  // Confirm the next text node is a power stat-block field.
  let next = null;
  for (let j = i + 1; j < Math.min(nodes.length, i + 4); j++) {
    if (nodes[j].type === 'text') { next = nodes[j]; break; }
  }
  if (!next || !POWER_STAT_FIELD.test(next.text)) continue;
  // Domain powers (H3) when inside Divine Domains; class powers (H4) otherwise.
  const level = inDivineDomains(i) ? 3 : 4;
  nodes[i] = { type: 'heading', level, text: n.text };
}

function write(filename, data) {
  const path = join(OUT, filename);
  writeFileSync(path, JSON.stringify(data, null, 2));
  const count = Array.isArray(data) ? data.length : Object.keys(data).length;
  console.log(`  ${filename.padEnd(26)} ${count} entries`);
}

// ─── NODE HELPERS ─────────────────────────────────────────────────────────────

// Find the index of the first heading matching text (exact) at a given level,
// optionally starting after `after`.
function findHeading(text, level = null, after = 0) {
  return nodes.findIndex((n, i) =>
    i >= after &&
    n.type === 'heading' &&
    (level === null || n.level === level) &&
    n.text === text
  );
}

// Find first heading whose text matches a regex, optionally at a given level.
function findHeadingRe(re, level = null, after = 0) {
  return nodes.findIndex((n, i) =>
    i >= after &&
    n.type === 'heading' &&
    (level === null || n.level === level) &&
    re.test(n.text)
  );
}

// Return all text content between two node indices as a single joined string.
function textBetween(start, end) {
  return nodes.slice(start, end)
    .filter(n => n.type === 'text')
    .map(n => n.text)
    .join(' ');
}

// Return all text+list content between two node indices.
function bodyBetween(start, end) {
  return nodes.slice(start, end)
    .filter(n => n.type === 'text' || n.type === 'list')
    .map(n => n.type === 'list' ? n.items.join(' ') : n.text)
    .join(' ');
}

// Parse the prose multiclass-skill blobs into a clean granted-skill list.
// Each entry looks like: "<Header>: Skill A (1), Choose a X: [Opt1, Opt2] (3)".
// We drop the leading header, split on commas (keeping "[...]" groups intact),
// and for each part extract { name, cost }. A "Choose a …: [a, b, c]" part picks
// the FIRST option as a sensible default (the builder can change it later).
function parseMulticlassSkills(blobs) {
  const out = [];
  for (const blob of blobs || []) {
    // Strip the leading "<Header>: " (the flavor name before the first colon that
    // is NOT part of a "Choose a …:" clause).
    const body = blob.replace(/^[^:[]+:\s*/, '');
    // Split on commas not inside brackets.
    const parts = body.split(/,(?![^[]*\])/).map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
      const costM = part.match(/\((\d+)\)\s*$/);
      const cost = costM ? parseInt(costM[1], 10) : null;
      const noCost = part.replace(/\s*\(\d+\)\s*$/, '').trim();
      const bracketM = noCost.match(/choose[^[]*\[([^\]]+)\]/i);
      if (bracketM) {
        const first = bracketM[1].split(',')[0].trim();   // default to first listed option
        if (first) out.push({ name: first, cost });
        continue;
      }
      // Unbracketed "Choose a <Skill> Skill" → resolve to a concrete default.
      const chooseM = noCost.match(/choose\s+a\s+(.+?)\s+skill/i);
      if (chooseM) {
        const fam = chooseM[1].trim();
        // e.g. "Lore" → "Lore (Historical)"; fall back to the bare family name.
        const dflt = { Lore: 'Lore (Historical)', Gathering: 'Forage I' }[fam] || fam;
        out.push({ name: dflt, cost });
        continue;
      }
      if (noCost) out.push({ name: noCost, cost });
    }
  }
  return out;
}

// Find the next heading at or above `level` starting after `after`.
// Used to bound a section: "end of this H2 is the next H2 or H1".
function nextHeadingAtOrAbove(level, after) {
  return nodes.findIndex((n, i) => i > after && n.type === 'heading' && n.level <= level);
}

// Collect all direct children of a heading node (nodes between it and the next
// sibling/parent heading). Returns { heading: node, children: node[] }.
function sectionBetween(startIdx, endIdx) {
  return nodes.slice(startIdx + 1, endIdx === -1 ? nodes.length : endIdx);
}

// ─── POWER BLOCK PARSER ───────────────────────────────────────────────────────
// Powers are H4 (occasionally H5 for sub-variants) with the tier tag in the name.
// The stat-block fields follow as text nodes before the description prose.

const TIER_PATTERN = /\[(Utility|Basic|Advanced|Veteran|Cantrip|Novice|Adept|Greater|Innate|Class|Form|Right Hand)\]/;
const POWER_HEADER = new RegExp(
  TIER_PATTERN.source + String.raw`(\s*\[[^\]]+\])*\s*(-\s*\d+\s*BP)?\s*(\(\d+\))?\s*$`
);

// SUB-POWERS: some powers grant a named sub-power ("Grant Power: Curious Balm",
// "the Holy Rest Power below") that has its OWN H4/H5 heading + stat block but NO
// [Tier] tag, so POWER_HEADER rejects it and its block is orphaned. Collect those
// granted names up front so parsePowersInRange can promote the matching heading to
// a real (parseable) power. Built lazily from all nodes on first use.
let _subPowerNames = null;
function subPowerNames() {
  if (_subPowerNames) return _subPowerNames;
  _subPowerNames = new Set();
  const text = nodes.filter((n) => n.type === 'text').map((n) => n.text).join(' ');
  for (const m of text.matchAll(/Grant Power:\s*([A-Z][\w’' ]+?)\s*(?:[”"”,]|$)/g)) _subPowerNames.add(m[1].trim());
  for (const m of text.matchAll(/\bthe\s+([A-Z][\w’' ]+?)\s+Power\s+below\b/g)) _subPowerNames.add(m[1].trim());
  return _subPowerNames;
}

const STAT_FIELD = /^(Incantation|Incant|Call|Target|Duration|Delivery|Refresh|Accent|Effect|Requirement|Prerequisites?|Skills and Options):\s*(.*)$/;
const STAT_TWO = /^(Target|Delivery|Accent):\s*(.+?)\s{2,}(Duration|Refresh|Effect):\s*(.+)$/;
const statKey = l => l.toLowerCase().replace(/^incant$/, 'incantation').replace(/\s+/g, '_').replace(/s$/, '');

function parsePowerNodes(powerNodes) {
  // powerNodes: text + list nodes belonging to one power (after its heading node).
  // A `list` node's items are flattened to bullet lines ("• …") so a power's
  // level/benefit list survives into the description instead of being dropped.
  const lines = powerNodes
    .flatMap(n => n.type === 'list' ? n.items.map(it => `• ${it}`) : [n.text])
    .filter(Boolean);
  const fields = {};
  let descStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const two = lines[i].match(STAT_TWO);
    if (two) {
      fields[statKey(two[1])] = two[2].trim();
      fields[statKey(two[3])] = two[4].trim();
      descStart = i + 1;
      continue;
    }
    const one = lines[i].match(STAT_FIELD);
    if (one) {
      fields[statKey(one[1])] = one[2].trim();
      descStart = i + 1;
      continue;
    }
    descStart = i;
    break;
  }

  return {
    fields,
    description: lines.slice(descStart).join(' '),
  };
}

function parsePowerHeading(text) {
  const name = text.replace(/\s*(\[|-\s*\d+\s*BP).*$/, '').trim();
  const tierMatch = text.match(TIER_PATTERN);
  const tier = tierMatch ? tierMatch[1] : 'Unknown';
  const tags = [...text.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]).filter(t => t !== tier);
  const ranksMatch = text.match(/\((\d+)\)\s*$/);
  const maxRanks = ranksMatch ? parseInt(ranksMatch[1]) : 1;
  const costMatch = text.match(/-\s*(\d+)\s*BP/);
  const cost = costMatch ? parseInt(costMatch[1]) : null;
  return { name, tier, tags, maxRanks, cost };
}

// Collect all H4/H5 power entries under a section bounded by [start, end).
// Each power heading is followed by text nodes until the next heading of any level.
function parsePowersInRange(start, end) {
  const powers = [];
  const subNames = subPowerNames();
  let i = start;
  while (i < end) {
    const n = nodes[i];
    // A power heading is either tier-tagged (POWER_HEADER) OR a granted SUB-POWER
    // whose bare name appears in a "Grant Power: X" / "X Power below" reference.
    const isSub = n.type === 'heading' && (n.level === 4 || n.level === 5)
      && !POWER_HEADER.test(n.text) && subNames.has(n.text.trim());
    if (n.type === 'heading' && (n.level === 4 || n.level === 5) && (POWER_HEADER.test(n.text) || isSub)) {
      // A power's body ends at the next REAL heading. Some source paragraphs are
      // mis-styled as <h4> (a long sentence, no [Tier] tag, not a sub-power) — e.g.
      // Arcane Charge's whole description. Don't let those bound the body; treat
      // them as prose so the description isn't lost.
      const isProseHeading = (m) => m.type === 'heading' && !POWER_HEADER.test(m.text)
        && !subNames.has(m.text.trim()) && m.text.length > 60 && /[.”]$/.test(m.text);
      const bodyEnd = nodes.findIndex((m, j) => j > i && m.type === 'heading' && !isProseHeading(m));
      // Keep `list` nodes alongside `text`: a power's benefits often follow a
      // "…at various Levels:" colon as a <ul> (Adept Ritualist, Druid Forms). They
      // are separate nodes the walker captured; dropping them here is what left
      // those descriptions truncated at the colon. Prose headings → text too.
      const bodyNodes = nodes.slice(i + 1, bodyEnd === -1 ? end : Math.min(bodyEnd, end))
        .filter(m => m.type === 'text' || m.type === 'list' || isProseHeading(m))
        .map(m => isProseHeading(m) ? { type: 'text', text: m.text } : m);
      // Sub-powers have no tier tag; mark them so they're identifiable + parseable.
      const parsed = parsePowerHeading(n.text);
      const { name, tags, maxRanks, cost } = parsed;
      const tier = isSub ? 'SubPower' : parsed.tier;
      const { fields, description } = parsePowerNodes(bodyNodes);
      powers.push({
        name, tier, tags, maxRanks, cost,
        incantation: fields['incantation'] ?? null,
        call: fields['call'] ?? null,
        target: fields['target'] ?? null,
        duration: fields['duration'] ?? null,
        delivery: fields['delivery'] ?? null,
        refresh: fields['refresh'] ?? null,
        accent: fields['accent'] ?? null,
        effect: fields['effect'] ?? null,
        requirement: fields['requirement'] ?? null,
        prerequisites: fields['prerequisite'] ?? fields['prerequisites'] ?? null,
        skillsAndOptions: fields['skills_and_option'] ?? null,
        description,
      });
      i = bodyEnd === -1 ? end : Math.min(bodyEnd, end);
    } else {
      i++;
    }
  }
  return powers;
}

// ─── CLASSES ──────────────────────────────────────────────────────────────────

console.log('\nParsing classes...');

function parseClasses() {
  const classesStart = findHeading('Base Classes (All)');
  const classesEnd = findHeading('Lineages (All)');
  const classes = [];

  // Each class is an H1 "Name: Base Class" between those bounds.
  let i = classesStart + 1;
  while (i < classesEnd) {
    const n = nodes[i];
    if (n.type !== 'heading' || n.level !== 1 || !/^(.+):\s*Base Class$/.test(n.text)) { i++; continue; }

    const clsName = n.text.replace(/:\s*Base Class$/, '').trim();
    const clsStart = i;
    // Class ends at the next H1
    const clsEnd = nodes.findIndex((m, j) => j > clsStart && m.type === 'heading' && m.level === 1);
    const end = clsEnd === -1 ? classesEnd : Math.min(clsEnd, classesEnd);

    // H2 sections within the class
    const h2 = (text) => {
      const idx = nodes.findIndex((m, j) => j > clsStart && j < end && m.type === 'heading' && m.level === 2 && m.text === text);
      if (idx === -1) return -1;
      const next = nodes.findIndex((m, j) => j > idx && m.type === 'heading' && m.level <= 2);
      return { start: idx, end: next === -1 ? end : Math.min(next, end) };
    };

    // Description: text between class H1 and first H2
    const firstH2 = nodes.findIndex((m, j) => j > clsStart && j < end && m.type === 'heading' && m.level === 2);
    const description = textBetween(clsStart + 1, firstH2 === -1 ? end : firstH2);

    // Starting / multiclass skills: list nodes under those H2s
    const skillList = (sectionText) => {
      const sec = h2(sectionText);
      if (!sec) return [];
      return nodes.slice(sec.start + 1, sec.end)
        .filter(m => m.type === 'list')
        .flatMap(m => m.items);
    };

    // Class progression table: cells under "Class Progression Table" H2
    const progression = parseProgressionTable(clsStart, end);

    // Specializations: H3 entries under the "Specializations" H2 (e.g. Artisan
    // → Artificer / Crafter / Mystic). Some classes don't have any.
    const specSec = h2('Specializations');
    const specializations = specSec === -1 ? [] : (() => {
      const out = [];
      let j = specSec.start + 1;
      while (j < specSec.end) {
        const m = nodes[j];
        if (m.type === 'heading' && m.level === 3 && m.text) {
          const specEnd = nodes.findIndex((x, k) => k > j && x.type === 'heading' && x.level <= 3);
          const sEnd = specEnd === -1 ? specSec.end : Math.min(specEnd, specSec.end);
          out.push({ name: m.text, description: textBetween(j + 1, sEnd) });
          j = sEnd;
        } else j++;
      }
      return out;
    })();

    // Power sections: each is an H2 like "Artisan Innate Powers", "Artisan Basic Powers" etc.
    // We collect all H4/H5 power nodes under each matching H2.
    const powers = (h2Pattern) => {
      const results = [];
      let j = clsStart + 1;
      while (j < end) {
        const m = nodes[j];
        if (m.type === 'heading' && m.level === 2 && h2Pattern.test(m.text)) {
          const secEnd = nodes.findIndex((x, k) => k > j && x.type === 'heading' && x.level <= 2);
          results.push(...parsePowersInRange(j + 1, secEnd === -1 ? end : Math.min(secEnd, end)));
        }
        j++;
      }
      return results;
    };

    const isCaster = ['Cleric', 'Druid', 'Mage', 'Sourcerer'].includes(clsName);

    classes.push({
      name: clsName,
      type: isCaster ? 'Spellcaster' : 'Martial',
      description,
      startingSkills:   skillList('Starting Skills'),
      multiclassSkills: skillList('Multiclass Skills'),
      multiclassGrants: parseMulticlassSkills(skillList('Multiclass Skills')),
      progression,
      specializations,
      innate:       powers(new RegExp(`^${clsName} Innate Powers$`)),
      utility:      powers(new RegExp(`^${clsName} Utility Powers$`)),
      basic:        powers(new RegExp(`^(${clsName} Basic Powers|Basic ${clsName} Powers)$`)),
      advanced:     powers(new RegExp(`^${clsName} Advanced Powers$`)),
      veteran:      powers(new RegExp(`^${clsName} Veteran Powers$`)),
      classSkills:  powers(new RegExp(`^${clsName} (Class )?Skills$`)),
      rightHandPowers: powers(new RegExp(`^${clsName} Right Hand Powers$`)),
      cantrips:     powers(new RegExp(`^${clsName} Cantrips?$`)),
      noviceSpells: powers(new RegExp(`^${clsName} (Novice( Form)? Spells?)$`)),
      adeptSpells:  powers(new RegExp(`^${clsName} (Adept( Form)? Spells?)$`)),
      greaterSpells: powers(new RegExp(`^${clsName} (Greater( Form)? Spells?)$`)),
    });

    i = end;
  }
  return classes;
}

// Class progression table: read cell nodes under the "Class Progression Table" H2.
function parseProgressionTable(clsStart, clsEnd) {
  const tableIdx = nodes.findIndex((n, i) =>
    i > clsStart && i < clsEnd && n.type === 'heading' && n.level === 2 && n.text === 'Class Progression Table'
  );
  if (tableIdx === -1) return {};

  const tableEnd = nodes.findIndex((n, i) => i > tableIdx && n.type === 'heading' && n.level <= 2);
  const end = tableEnd === -1 ? clsEnd : Math.min(tableEnd, clsEnd);
  // Table exported as text nodes (not <td>).
  const cells = nodes.slice(tableIdx + 1, end).filter(n => n.type === 'text').map(n => n.text);

  // Drop column headers. "BasicPowers" / "AdvancedPowers" / "VeteranPowers" have no
  // space in the export.
  const HEADER = /^(Class|Level|Utility ?Powers|Basic ?Powers|Advanced ?Powers|Veteran ?Powers|Cantrips?|Spells? Known|Spell Slots|Class Bonuses?)$/i;
  const data = cells.filter(v => !HEADER.test(v));

  const isCaster = cells.some(v => /cantrip|spell/i.test(v));
  // numeric cols per row (excluding bonus): caster = level + cantrips + spellsKnown + slots(string) = 4,
  // martial = level + utility + basic + advanced + veteran = 5.
  // The bonus cell can split across multiple text nodes (commas, dashes), so we
  // anchor on the level number and collapse anything between the last numeric/dash
  // col and the next level marker into the bonus.
  const num = v => parseInt(v) || 0;
  const orNull = v => (!v || v === '-' ? null : v);
  const isLevelStart = (arr, i, expected) => {
    if (arr[i] !== String(expected)) return false;
    // Next N entries must look like numeric / dash / slot-string cells.
    const cols = isCaster ? 3 : 4;
    for (let k = 1; k <= cols; k++) {
      const v = arr[i + k];
      if (v === undefined) return false;
      if (!/^(\d+|-|\d+\/\d+\/\d+)$/.test(v)) return false;
    }
    return true;
  };

  const progression = {};
  let i = 0;
  while (i < data.length && data[i] !== '1') i++;
  let level = 1;
  while (i < data.length && level <= 20) {
    if (!isLevelStart(data, i, level)) break;
    const numericCols = isCaster ? 3 : 4;
    const cols = data.slice(i + 1, i + 1 + numericCols);
    // Bonus runs from after the numeric block to the next level start (or end).
    let j = i + 1 + numericCols;
    const nextLevelIdx = (() => {
      for (let k = j; k < data.length; k++) {
        if (isLevelStart(data, k, level + 1)) return k;
      }
      return data.length;
    })();
    // Stop the bonus span at any meta paragraph like "Note: ..." that follows the table.
    let stopAt = nextLevelIdx;
    for (let k = j; k < nextLevelIdx; k++) {
      if (/^(Note|Notes|Footnote):/i.test(data[k])) { stopAt = k; break; }
    }
    const bonusParts = data.slice(j, stopAt).filter(v => v && v !== '-');
    const bonus = bonusParts.length ? bonusParts.join(' ').replace(/,\s*$/, '').trim() : null;

    if (isCaster) {
      progression[level] = { cantrips: num(cols[0]), spellsKnown: num(cols[1]), slots: orNull(cols[2]), bonus };
    } else {
      progression[level] = { utility: num(cols[0]), basic: num(cols[1]), advanced: num(cols[2]), veteran: num(cols[3]), bonus };
    }
    i = nextLevelIdx;
    level++;
  }
  return progression;
}

// Some powers grant benefits that scale with CLASS LEVEL: their description reads
// "…benefits at various <Class> Levels: • Level 1 - … • Level 3 - …". Parse those
// "• Level N - …" bullets into a structured `levelBenefits` array so the validator
// can mark which are active at the character's level in that class (auto-granted,
// no BP). The gating class is named in the lead-in ("various Artisan Levels").
const LEVEL_BENEFIT = /•?\s*Level\s+(\d+)\s*[-–—]\s*([^•]+)/g;
function extractPowerBenefits(power) {
  const d = power.description || '';
  if (!/Level\s+\d+\s*[-–—]/.test(d)) return;
  const gate = d.match(/at\s+various\s+([A-Z][\w]+)\s+Levels/i);
  const benefits = [];
  let m;
  LEVEL_BENEFIT.lastIndex = 0;
  while ((m = LEVEL_BENEFIT.exec(d))) {
    benefits.push({ level: parseInt(m[1], 10), text: m[2].trim() });
  }
  if (benefits.length) {
    power.levelBenefits = benefits;
    power.levelBenefitClass = gate ? gate[1] : null;   // gate on this class's level
  }
}

// Powers offering "choose one of the following: • … • …". Two flavors:
//   - BUILD-TIME permanent: "gains one of the following FOR FREE" (Expert Craft) —
//     a character-creation pick; each option names a skill granted free. Tagged
//     `chooseOne.kind:'build'` with `options[].grantsSkill`.
//   - IN-PLAY tactical: "may choose one … (each Long Rest / per use / per cast)"
//     (Warrior Spirit, Kick, …) — the player picks at play time, not in the
//     builder. Tagged `kind:'play'`; options are display-only.
// Lead-in: "…one of (the following|three) <benefits|ways|boons|…>…:" then bullets.
const CHOOSE_LEAD = /\bone\s+of\s+(?:the\s+following|three|the)\b[^:]*:\s*(.+)$/i;
function extractChooseOne(power) {
  const d = power.description || '';
  const m = d.match(CHOOSE_LEAD);
  if (!m) return;
  // Options are the "• …" bullets after the lead-in (stop at a trailing prose
  // sentence that isn't a bullet).
  const opts = [...m[1].matchAll(/•\s*([^•]+?)(?=\s*•|$)/g)].map((x) => x[1].trim()).filter(Boolean);
  if (opts.length < 2) return;
  const build = /one of the following for free|gains? one of the following/i.test(d);
  power.chooseOne = {
    kind: build ? 'build' : 'play',
    options: opts.map((text) => {
      // Build-time options name a skill + "(cost)": "Greater Alchemy (5)".
      const sk = build && text.match(/^([A-Z][\w’' ]+?)\s*\(\d+\)/);
      return sk ? { text, grantsSkill: sk[1].trim() } : { text };
    }),
  };
}

const CLASSES_OUT = parseClasses();
for (const c of CLASSES_OUT) {
  for (const arr of Object.values(c)) {
    if (Array.isArray(arr)) for (const p of arr) if (p && p.description) { extractPowerBenefits(p); extractChooseOne(p); }
  }
}
write('classes.json', CLASSES_OUT);

// ─── SKILLS ───────────────────────────────────────────────────────────────────
// H1: "Base Skills, Perks, and Flaws" → H1: "Skills" → H2: "Skill Descriptions"
// Skills are H4 entries; category is the nearest H3 ancestor.

console.log('\nParsing skills...');

function parseSkills() {
  const skillsH1 = findHeading('Skills', 1);
  const descH2 = findHeading('Skill Descriptions', 2, skillsH1);
  const descEnd = nextHeadingAtOrAbove(1, descH2);
  const end = descEnd === -1 ? nodes.length : descEnd;

  const skills = [];
  let currentCat = 'Martial';
  let i = descH2 + 1;

  while (i < end) {
    const n = nodes[i];
    if (n.type === 'heading' && n.level === 3) {
      // H3 = category (e.g. "Martial Skills")
      currentCat = n.text.replace(/\s+Skills$/, '');
      i++; continue;
    }
    if (n.type === 'heading' && n.level === 4) {
      // H4 = skill entry. The heading text may carry annotations that are
      // structural metadata, not part of the canonical name:
      //   "(N)"          — finite max ranks  (parsed as numeric ranks)
      //   "(Unlimited)"  — explicitly no rank cap (parsed as 'unlimited' sentinel)
      //   "[Placeholder]"— parameter slot the player fills in (e.g.
      //                    "Lore [Area of Lore]" → parameter "Area of Lore",
      //                    canonical name "Lore"). The linker uses this so
      //                    "Lore (Religious)" prose matches the entity.
      // All three suffixes are stripped from the name as we parse them.
      const raw = n.text;
      const ranksMatch = raw.match(/\((\d+|Unlimited)\)\s*$/i);
      const paramMatch = raw.match(/\s\[([^\]]+)\]/);
      const name = raw
        .replace(/\s*\((?:\d+|Unlimited)\)\s*$/i, '')
        .replace(/\s\[[^\]]+\]/, '')
        .trim();
      const maxRanks = !ranksMatch ? null
        : /unlimited/i.test(ranksMatch[1]) ? 'unlimited'
        : parseInt(ranksMatch[1]);
      const parameter = paramMatch ? paramMatch[1].trim() : null;

      // Collect text nodes until next H3/H4
      const bodyEnd = nodes.findIndex((m, j) => j > i && m.type === 'heading' && m.level <= 4);
      const bodyNodes = nodes.slice(i + 1, bodyEnd === -1 ? end : Math.min(bodyEnd, end));

      let cost = null, prereq = null, ranks = maxRanks;
      const descParts = [];

      for (const bn of bodyNodes) {
        // Flatten <ul> list nodes into bullet lines so a skill's trailing list
        // (Bowmaster's "additional effects by aiming: • …") isn't dropped.
        if (bn.type === 'list') { for (const it of bn.items) descParts.push(`• ${it}`); continue; }
        if (bn.type !== 'text') continue;
        const t = bn.text;
        const cm = t.match(/^Cost:\s*(\d+)/);
        if (cm) { cost = parseInt(cm[1]); continue; }
        const pm = t.match(/^Prerequisites?:\s*(.+)/);
        if (pm) { prereq = pm[1].trim(); continue; }
        const rm = t.match(/^Ranks?:\s*(\d+)/);
        if (rm) { ranks = parseInt(rm[1]); continue; }
        descParts.push(t);
      }

      if (cost !== null) {
        const entry = { name, cost, prereq, ranks, category: currentCat, description: descParts.join(' ') };
        if (parameter) entry.parameter = parameter;
        skills.push(entry);
      }
      i = bodyEnd === -1 ? end : Math.min(bodyEnd, end);
    } else {
      i++;
    }
  }
  return skills;
}

write('skills.json', parseSkills());

// ─── PERKS & FLAWS ────────────────────────────────────────────────────────────
// Under "Character Options" H1. Perks/Flaws are H3 entries with Cost/Award, Ranks,
// Prerequisites, Description as text nodes. Category is the H2 ancestor.

console.log('\nParsing perks & flaws...');

function parsePerkFlaw(h1Text, valueKey) {
  const h1 = findHeading(h1Text, null);
  if (h1 === -1) return [];
  const h1End = nextHeadingAtOrAbove(nodes[h1].level, h1);
  const end = h1End === -1 ? nodes.length : h1End;

  const results = [];
  let currentCat = '';
  let i = h1 + 1;

  while (i < end) {
    const n = nodes[i];
    if (n.type === 'heading' && n.level === 2) {
      currentCat = n.text.replace(/\s+(Perks|Flaws)$/, '');
      i++; continue;
    }
    if (n.type === 'heading' && n.level === 3) {
      const name = n.text;
      const bodyEnd = nodes.findIndex((m, j) => j > i && m.type === 'heading' && m.level <= 3);
      const bodyNodes = nodes.slice(i + 1, bodyEnd === -1 ? end : Math.min(bodyEnd, end));

      let value = null, ranks = null, prereq = null;
      const descParts = [];

      for (const bn of bodyNodes) {
        if (bn.type !== 'text') continue;
        const t = bn.text;
        const cm = t.match(/^(?:Cost|Award):\s*(.+)/i);
        if (cm) { const v = cm[1].trim(); value = /^\d+$/.test(v) ? parseInt(v) : v; continue; }
        const rm = t.match(/^Ranks?:\s*(\d+)/i);
        if (rm) { ranks = parseInt(rm[1]); continue; }
        const pm = t.match(/^(?:Pre-?requisites?|Prerequisites?):\s*(.+)/i);
        if (pm) { prereq = pm[1].trim(); continue; }
        descParts.push(t);
      }

      if (value !== null) {
        results.push({ name, [valueKey]: value, ranks, prereq, category: currentCat, description: descParts.join(' ') });
      }
      i = bodyEnd === -1 ? end : Math.min(bodyEnd, end);
    } else {
      i++;
    }
  }
  return results;
}

// Perks and Flaws are both under "Character Options" as H2 sections.
const charOptionsH1 = findHeading('Character Options', 1);
const charOptionsEnd = nextHeadingAtOrAbove(1, charOptionsH1);

function parsePerkFlawSection(sectionName, valueKey) {
  const h2 = nodes.findIndex((n, i) =>
    i > charOptionsH1 && i < charOptionsEnd &&
    n.type === 'heading' && n.level === 2 &&
    new RegExp(sectionName, 'i').test(n.text)
  );
  if (h2 === -1) return [];
  const secEnd = nodes.findIndex((n, i) => i > h2 && n.type === 'heading' && n.level <= 2);
  const end = secEnd === -1 ? charOptionsEnd : Math.min(secEnd, charOptionsEnd);

  const results = [];
  let currentCat = '';
  let i = h2 + 1;

  while (i < end) {
    const n = nodes[i];
    if (n.type === 'heading' && n.level === 3) {
      currentCat = n.text.replace(/\s+(Perks|Flaws)$/, '');
      i++; continue;
    }
    if (n.type === 'heading' && n.level === 4) {
      const name = n.text;
      const bodyEnd = nodes.findIndex((m, j) => j > i && m.type === 'heading' && m.level <= 4);
      const bodyNodes = nodes.slice(i + 1, bodyEnd === -1 ? end : Math.min(bodyEnd, end));

      let value = null, ranks = null, prereq = null;
      const descParts = [];

      for (const bn of bodyNodes) {
        if (bn.type !== 'text') continue;
        const t = bn.text;
        const cm = t.match(/^(?:Cost|Award):\s*(.+)/i);
        if (cm) { const v = cm[1].trim(); value = /^\d+$/.test(v) ? parseInt(v) : v; continue; }
        const rm = t.match(/^Ranks?:\s*(\d+)/i);
        if (rm) { ranks = parseInt(rm[1]); continue; }
        const pm = t.match(/^(?:Pre-?requisites?|Prerequisites?):\s*(.+)/i);
        if (pm) { prereq = pm[1].trim(); continue; }
        descParts.push(t);
      }

      if (value !== null) {
        results.push({ name, [valueKey]: value, ranks, prereq, category: currentCat, description: descParts.join(' ') });
      }
      i = bodyEnd === -1 ? end : Math.min(bodyEnd, end);
    } else {
      i++;
    }
  }
  return results;
}

// Perks and Flaws each have a "Perks List" / "Flaws List" H2 under Character Options.
// Entries are H4 under H3 category headings.
// Perks/Flaws export as 5-column flat text (not <td>): Name, Cost/Award, Ranks, Prereq, Desc.
// Each row is 5 consecutive text nodes under an H3 category. Header rows are "Name","Cost",etc.
const PERK_HEADER = /^(Name|Cost|Award|Ranks?|Pre-?requisites?|Prerequisites?|Description)$/i;

function parsePerkFlawList(listH2Text, valueKey) {
  const h2 = nodes.findIndex((n, i) =>
    i > charOptionsH1 && i < charOptionsEnd &&
    n.type === 'heading' && n.level === 2 && n.text === listH2Text
  );
  if (h2 === -1) return [];
  const secEnd = nodes.findIndex((n, i) => i > h2 && n.type === 'heading' && n.level <= 2);
  const end = secEnd === -1 ? charOptionsEnd : Math.min(secEnd, charOptionsEnd);

  const results = [];
  let currentCat = '';
  let i = h2 + 1;
  let cells = [];

  const flushRow = () => {
    if (cells.length >= 2 && !PERK_HEADER.test(cells[0])) {
      const rawVal = cells[1];
      const value = /^\d+$/.test(rawVal) ? parseInt(rawVal) : rawVal;
      results.push({
        name: cells[0],
        [valueKey]: value,
        ranks: cells[2] && cells[2] !== '-' ? parseInt(cells[2]) || null : null,
        prereq: cells[3] && cells[3] !== '-' ? cells[3] : null,
        category: currentCat,
        description: cells[4] || '',
      });
    }
    cells = [];
  };

  while (i < end) {
    const n = nodes[i];
    if (n.type === 'heading' && n.level === 3) {
      flushRow();
      currentCat = n.text.replace(/\s+(Perks|Flaws)$/, '');
      i++; continue;
    }
    if (n.type === 'heading' && n.level <= 2) break;
    if (n.type === 'text') {
      if (PERK_HEADER.test(n.text)) { i++; continue; }
      cells.push(n.text);
      if (cells.length === 5) flushRow();
    }
    i++;
  }
  flushRow();
  return results.filter(r => r.name && !PERK_HEADER.test(r.name));
}

// Some perks carry their authoritative rules in a DETAIL sub-section (an H4 whose
// text matches the perk name) rather than the summary table cell — e.g. "Patron"
// has a thin cell ("Gains a personal divine patron.") but an H4 "Patron" detail
// paragraph states the real discount mechanic ("…costs 1 BP less … maximum of 10
// BP in discounts … Strong Bloodline and Inheritance … cannot be discounted").
// The linker parses consequences (grants/discounts) from the description, so fold
// any such detail prose into the matching perk's description. Scoped to Character
// Options H4s, matched by exact name, appended only when it adds new text.
function enrichWithDetailSections(results) {
  const byName = new Map(results.map(r => [r.name, r]));
  for (let i = charOptionsH1 + 1; i < charOptionsEnd; i++) {
    const n = nodes[i];
    if (!(n.type === 'heading' && n.level === 4)) continue;
    const cleanHeading = n.text.replace(/\s*\(\d+\)\s*$/, '').trim();
    const target = byName.get(cleanHeading);
    if (!target) continue;
    const secEnd = nodes.findIndex((m, j) => j > i && m.type === 'heading' && m.level <= 4);
    // Gather text + table cells + list items: preserve paragraphs by joining with \n\n.
    // Detect list items in disguise (like "Cloth - 2 BP") and format them with bullets.
    const prose = nodes.slice(i + 1, secEnd === -1 ? charOptionsEnd : secEnd)
      .map((m) => {
        if (m.type === 'list') {
          return m.items.map(item => `• ${item}`).join('\n');
        }
        if (m.type === 'text' || m.type === 'cell') {
          const t = m.text.trim();
          // Detect pseudo-lists to render as bullet points
          if (/^.+?\s*-\s*\d+\s*BP$/i.test(t)) {
            return `• ${t}`;
          }
          return t;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n')
      .trim();
    // Append only the parts not already in the (summary) description, so we don't
    // duplicate the cell text the detail section may restate.
    if (prose && !target.description.includes(prose)) {
      target.description = target.description
        ? `${target.description}\n\n${prose}`.trim()
        : prose;
    }
  }
  return results;
}

// A few perks are TIERED: their detail prose carries a "Cost / Character Level /
// Ability" table where each row is one purchasable tier (e.g. Draconic Heritage:
// 2/2, 3/5, 4/10, 5/15). Each tier costs its own (non-uniform) BP, is gated on a
// character level, and requires all previous tiers. Parse that table into a
// structured `tiers: [{ cost, level, ability }]` so the validator can price
// cumulatively and gate per tier, instead of the flat rank×cost model.
function extractTiers(results) {
  // Table tail begins after the "Cost Character Level Ability" header; rows are
  // "<cost> <level> <ability…>" until the next "<num> <num>" row or end.
  const HEADER = /Cost\s+Character\s+Level\s+Ability\s+/i;
  const ROW = /(\d+)\s+(\d+)\s+(.+?)(?=\s+\d+\s+\d+\s|$)/gs;
  for (const r of results) {
    if (r.name === 'Gift of Hateful Retribution') {
      r.tiers = [
        { cost: 2, damage: 10 },
        { cost: 1, damage: 15 },
        { cost: 1, damage: 25 },
        { cost: 1, damage: 50, byMyVoiceDmg: 5 }
      ];
      r.cost = 2;
      continue;
    }
    if (r.name === 'Gift of Unbreakable Flesh') {
      r.tiers = [
        { cost: 2, armorPoints: 1 },
        { cost: 3, armorPoints: 2 },
        { cost: 5, armorPoints: 3 },
        { cost: 5, armorPoints: 4 }
      ];
      r.cost = 2;
      continue;
    }

    const m = r.description && r.description.match(HEADER);
    if (!m) continue;
    const tail = r.description.slice(m.index + m[0].length);
    const tiers = [];
    let row;
    ROW.lastIndex = 0;
    while ((row = ROW.exec(tail))) {
      tiers.push({ cost: +row[1], level: +row[2], ability: row[3].trim() });
    }
    if (tiers.length > 1) {
      r.tiers = tiers;
      // The base `cost` is tier 1's cost (the flat field still reflects entry price).
      r.cost = tiers[0].cost;
    }
  }
  return results;
}

write('perks.json', extractTiers(enrichWithDetailSections(parsePerkFlawList('Perks List', 'cost'))));
write('flaws.json', enrichWithDetailSections(parsePerkFlawList('Flaws List', 'bp')));

// ─── DEVOTIONS ────────────────────────────────────────────────────────────────
// Each devotion is an H1. Content is text nodes with bullet lists for tenets.

console.log('\nParsing devotions...');

// The Divine Domains section opens with a table mapping each Devotion to its
// divine domains: header "God|Devotion | Locality | Domain 1 … Domain 4", then a
// row per devotion. The Google Docs export nests <p> inside each <td>, so cells
// arrive as TEXT nodes and EMPTY cells are dropped — rows are variable length.
// We can't split by a fixed column count, so we split on devotion-name
// boundaries: each known devotion name begins a row, the next token is its
// locality, and the remaining tokens (until the next devotion name) are domains.
// `devNames` is the set of canonical devotion names (base, before any comma).
const normDevName = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
function parseDevotionDomains(devNames) {
  const known = new Set(devNames.map(normDevName));
  // Locate the table header text node ("God" or "Devotion") and the run after it.
  const hdr = nodes.findIndex((n) => n.type === 'text' && /^(God|Devotion)$/i.test(n.text));
  if (hdr === -1) return {};
  // Read forward, collecting tokens until we leave the table (a heading, a long
  // prose paragraph, or the "See the Devotions & Divine Beings" note).
  const tokens = [];
  for (let j = hdr; j < nodes.length; j++) {
    const n = nodes[j];
    if (n.type !== 'text') break;
    if (/^See the Devotions/i.test(n.text) || n.text.length > 60) break;
    tokens.push(n.text.trim());
  }
  // Drop the 6 header labels.
  const body = tokens.slice(6);
  const map = {};
  let cur = null;
  for (const tok of body) {
    if (known.has(normDevName(tok))) {
      cur = { name: tok, locality: null, domains: [] };
      map[normDevName(tok)] = cur;
    } else if (cur) {
      if (cur.locality === null) cur.locality = tok;   // first token after name
      else cur.domains.push(tok);                      // rest are domains
    }
  }
  return map;
}

function parseDevotions() {
  const divDomainsIdx = findHeading('Divine Domains', 1);

  // Collect all H1s between "Devotions & Divine Beings" and "Divine Domains"
  const devotionsStart = findHeading('Devotions & Divine Beings', 1);
  // First pass: gather the devotion names so the domain-table splitter knows the
  // row boundaries.
  const names = [];
  for (let j = devotionsStart + 1; j < divDomainsIdx; j++) {
    const n = nodes[j];
    if (n.type === 'heading' && n.level === 1 && n.text) names.push(n.text.split(',')[0]);
  }
  const domainMap = parseDevotionDomains(names);
  const results = [];

  let i = devotionsStart + 1;
  while (i < divDomainsIdx) {
    const n = nodes[i];
    if (n.type !== 'heading' || n.level !== 1 || !n.text) { i++; continue; }

    const name = n.text;
    const devEnd = nodes.findIndex((m, j) => j > i && m.type === 'heading' && m.level === 1);
    const end = devEnd === -1 ? divDomainsIdx : Math.min(devEnd, divDomainsIdx);

    const bodyNodes = nodes.slice(i + 1, end);
    const tenets = [];
    const loreParts = [];
    let colorScheme = '', iconography = '';

    for (const bn of bodyNodes) {
      if (bn.type === 'list') { tenets.push(...bn.items); continue; }
      if (bn.type !== 'text') continue;
      const t = bn.text;
      const cs = t.match(/^Devotion Color Scheme:\s*(.+)/i);
      if (cs) { colorScheme = cs[1].trim(); continue; }
      const ic = t.match(/^Common Iconography:\s*(.+)/i);
      if (ic) { iconography = ic[1].trim(); continue; }
      if (/^(Example Sigil:|The Truth|Truths|Divine Truths|Divine Demands|Guiding Principles|Guiding Beliefs|Laws|Lessons|Edicts|Codex|Church Principles):/.test(t)) continue;
      loreParts.push(t);
    }

    // Match this devotion to its row in the domain table by base name (the table
    // uses short names like "Senri"; the H1 may be "Senri, Voice of Mercy").
    const base = name.split(',')[0];
    const dm = domainMap[normDevName(base)] || domainMap[normDevName(name)] || {};
    results.push({
      name, epithet: '', lore: loreParts.join(' '), tenets, colorScheme, iconography,
      domains: dm.domains || [], locality: dm.locality || '',
    });
    i = end;
  }
  return results;
}

write('devotions.json', parseDevotions());

// ─── DIVINE DOMAINS ───────────────────────────────────────────────────────────
// H1: "Divine Domains" → H2s for each domain. Powers are H3 entries "Name - N BP".

console.log('\nParsing divine domains...');

function parseDivineDomains() {
  const start = findHeading('Divine Domains', 1);
  const end = findHeading('Wellspring Economy Overview', 1, start);

  // Devotion accents table: H2 "Devotion Accents" → cell pairs
  const accents = {};
  const accH2 = nodes.findIndex((n, i) => i > start && i < end && n.type === 'heading' && n.level === 2 && n.text === 'Devotion Accents');
  if (accH2 !== -1) {
    const accEnd = nodes.findIndex((n, i) => i > accH2 && n.type === 'heading' && n.level <= 2);
    const cells = nodes.slice(accH2 + 1, accEnd === -1 ? end : Math.min(accEnd, end))
      .filter(n => n.type === 'cell').map(n => n.text);
    for (let i = 0; i + 1 < cells.length; i += 2) accents[cells[i]] = cells[i + 1];
  }

  const domains = [];
  let i = start + 1;
  while (i < end) {
    const n = nodes[i];
    if (n.type !== 'heading' || n.level !== 2 || !n.text || n.text === 'Devotion Accents') { i++; continue; }

    const rawName = n.text;
    // "Energy: [Acid, Flame, Ice, or Lightning]" → name "Energy"
    const name = rawName.replace(/^Energy:.*$/, 'Energy').trim();
    const domEnd = nodes.findIndex((m, j) => j > i && m.type === 'heading' && m.level <= 2);
    const dEnd = domEnd === -1 ? end : Math.min(domEnd, end);

    // Powers: H3 "Name - N BP" pattern
    const DOMAIN_PWR = /-\s*\d+\s*BP\s*$/;
    const powers = [];
    let j = i + 1;
    while (j < dEnd) {
      const m = nodes[j];
      if (m.type === 'heading' && m.level === 3 && DOMAIN_PWR.test(m.text)) {
        const pwrEnd = nodes.findIndex((x, k) => k > j && x.type === 'heading' && x.level <= 3);
        const bodyNodes = nodes.slice(j + 1, pwrEnd === -1 ? dEnd : Math.min(pwrEnd, dEnd))
          .filter(x => x.type === 'text');
        const header = m.text;
        const tierMatch = header.match(/\[(\w+)\]/);
        const costMatch = header.match(/-\s*(\d+)\s*BP\s*$/);
        const pwrName = header.replace(/\[\w+\]/, '').replace(/-\s*\d+\s*BP\s*$/, '').trim();
        const { fields, description } = parsePowerNodes(bodyNodes);
        powers.push({
          name: pwrName,
          tier: tierMatch ? tierMatch[1] : null,
          cost: costMatch ? parseInt(costMatch[1]) : null,
          incantation: fields['incantation'] ?? null,
          call: fields['call'] ?? null,
          target: fields['target'] ?? null,
          duration: fields['duration'] ?? null,
          delivery: fields['delivery'] ?? null,
          refresh: fields['refresh'] ?? null,
          accent: fields['accent'] ?? null,
          effect: fields['effect'] ?? null,
          prerequisites: fields['prerequisite'] ?? fields['prerequisites'] ?? null,
          description,
        });
        j = pwrEnd === -1 ? dEnd : Math.min(pwrEnd, dEnd);
      } else {
        j++;
      }
    }

    domains.push({ name, label: rawName, accent: accents[name] ?? accents[rawName] ?? null, powers });
    i = dEnd;
  }
  return domains;
}

write('domains.json', parseDivineDomains());

// ─── LINEAGES ─────────────────────────────────────────────────────────────────
// Each lineage is an H1. Challenges and Advantages are H2s; sub-lineages are H3s;
// individual items are H4s.

console.log('\nParsing lineages...');

function parseLineages() {
  const start = findHeading('Lineages (All)', 1);
  const end = findHeading('Base Skills, Perks, and Flaws', 1, start);

  const lineages = [];
  let i = start + 1;

  while (i < end) {
    const n = nodes[i];
    if (n.type !== 'heading' || n.level !== 1 || !n.text) { i++; continue; }

    const name = n.text;
    const linEnd = nodes.findIndex((m, j) => j > i && m.type === 'heading' && m.level === 1);
    const lEnd = linEnd === -1 ? end : Math.min(linEnd, end);

    // Description: text under H2 "Description" before any H3
    const descH2 = nodes.findIndex((m, j) => j > i && j < lEnd && m.type === 'heading' && m.level === 2 && m.text === 'Description');
    const descEnd = descH2 === -1 ? i : nodes.findIndex((m, j) => j > descH2 && m.type === 'heading' && m.level <= 2);
    const description = descH2 === -1 ? '' : textBetween(descH2 + 1, descEnd === -1 ? lEnd : Math.min(descEnd, lEnd));

    // Parse challenges/advantages from an H2 section.
    // Each entry is a single text node: "Name [Tag] [Tag] (Cost): Description"
    // Sublineage groups are H3 headings under the H2.
    const ITEM_LINE = /^(.+?)((?:\s*\[[^\]]+\])*)\s*\((\d+|Variable)\)\s*[:\-]\s*(.+)$/;
    const parseItems = (sectionName) => {
      const h2 = nodes.findIndex((m, j) => j > i && j < lEnd && m.type === 'heading' && m.level === 2 && m.text === sectionName);
      if (h2 === -1) return [];
      const secEnd = nodes.findIndex((m, j) => j > h2 && m.type === 'heading' && m.level <= 2);
      const sEnd = secEnd === -1 ? lEnd : Math.min(secEnd, lEnd);
      const items = [];
      let currentGroup = 'General';
      for (let j = h2 + 1; j < sEnd; j++) {
        const m = nodes[j];
        if (m.type === 'heading' && m.level === 3) { currentGroup = m.text; continue; }
        if (m.type !== 'text') continue;
        const lm = m.text.match(ITEM_LINE);
        if (!lm) continue;
        const [, rawName, tagsStr, costStr, desc] = lm;
        const tags = [...tagsStr.matchAll(/\[([^\]]+)\]/g)].map(t => t[1]);
        const required = tags.some(t => /^required$/i.test(t));
        const repped = tags.some(t => /^repped$/i.test(t));
        const lbp = costStr === 'Variable' ? null : parseInt(costStr);
        items.push({
          name: rawName.trim(),
          lbp,
          required,
          repped,
          tags: tags.filter(t => !/^(required|repped)$/i.test(t)),
          sublineage: currentGroup,
          description: desc.trim(),
        });
      }
      return items;
    };

    const challenges = parseItems('Challenges');
    const advantages = parseItems('Advantages');

    // Derive sub-lineages from distinct non-General groups
    const byName = new Map();
    for (const it of [...challenges, ...advantages]) {
      if (it.sublineage === 'General') continue;
      const m = it.sublineage.match(/^([^(]+?)(?:\s*\((.+)\))?$/);
      const sub = { name: (m ? m[1] : it.sublineage).trim(), note: m?.[2]?.trim() ?? '' };
      if (!byName.has(sub.name) || (!byName.get(sub.name).note && sub.note)) byName.set(sub.name, sub);
    }

    lineages.push({ name, description, costume: '', sublineages: [...byName.values()], challenges, advantages });
    i = lEnd;
  }
  return lineages;
}

write('lineages.json', parseLineages());

// ─── LEVEL TABLE ──────────────────────────────────────────────────────────────

console.log('\nParsing level table...');

function parseLevelTable() {
  // Under "Advancement" H1 → "Level Progression Table" H2
  const advH1 = findHeading('Advancement', 1);
  const tableH = nodes.findIndex((n, i) =>
    i > advH1 && n.type === 'heading' && n.level === 2 && n.text === 'Level Progression Table'
  );
  if (tableH === -1) return [];
  const tableEnd = nodes.findIndex((n, i) => i > tableH && n.type === 'heading' && n.level <= 2);
  // Table exported as text nodes (not <td>)
  const texts = nodes.slice(tableH + 1, tableEnd === -1 ? nodes.length : tableEnd)
    .filter(n => n.type === 'text').map(n => n.text);

  const HEADER = /^(Character Level|Total XP|Base BP|LP|Spikes|Level|XP|BP)$/i;
  const nums = texts.filter(v => /^\d+$/.test(v) && !HEADER.test(v)).map(Number);
  const rows = [];
  for (let i = 0; i + 4 < nums.length; i += 5) {
    rows.push({ level: nums[i], xp: nums[i+1], bp: nums[i+2], lp: nums[i+3], spikes: nums[i+4] });
  }
  return rows;
}

write('level-table.json', parseLevelTable());

console.log('\nParsing events table...');

function parseEventsTable() {
  // Under "Advancement" H1 → "Level Floor" H2
  const advH1 = findHeading('Advancement', 1);
  const tableH = nodes.findIndex((n, i) =>
    i > advH1 && n.type === 'heading' && n.level === 2 && n.text === 'Level Floor'
  );
  if (tableH === -1) return [];
  const tableEnd = nodes.findIndex((n, i) => i > tableH && n.type === 'heading' && n.level <= 2);
  const texts = nodes.slice(tableH + 1, tableEnd === -1 ? nodes.length : tableEnd)
    .filter(n => n.type === 'text').map(n => n.text);

  const HEADER = /^(Event Number|Level Floor|Starting BP)$/i;
  const nums = texts.filter(v => /^\d+$/.test(v) && !HEADER.test(v)).map(Number);
  const rows = [];
  for (let i = 0; i + 2 < nums.length; i += 3) {
    rows.push({ event: nums[i], level: nums[i+1], bp: nums[i+2] });
  }
  return rows;
}

write('events-table.json', parseEventsTable());


// ─── CRAFTING RECIPES ─────────────────────────────────────────────────────────
// Each recipe is an H3 "Name [Tier Discipline Recipe/Formula/Schematic]".
// Fields are text nodes following the heading.

console.log('\nParsing crafting recipes...');

const RECIPE_HEADER = /^(.+?)\s*\[(Apprentice|Journeyman|Greater)\s+(Alchemy|Enchanting|Tinkering)\s+(Recipe|Formula|Schematic)\]((?:\s*\[[^\]]+\])*)\s*$/;
const RECIPE_FIELD = /^(Crafting Materials(?: Needed)?|Uses per Batch|Expiration|Application|Type|Ritualists|Total Participants|Dark Territory Required|Dark Territory Suit|Reality Tear|Requirements|Crafting Process|Description|Effect|Note|IMPORTANT|Circle of Sacrifice|Circle of Empowerment|Circle of Assignment|Rune Circle):\s*(.*)$/;
const FIELD_KEY = {
  'Crafting Materials Needed': 'materials', 'Crafting Materials': 'materials',
  'Uses per Batch': 'usesPerBatch', 'Expiration': 'expiration',
  'Application': 'application', 'Type': 'type',
  'Crafting Process': 'process', 'Description': 'description', 'Effect': 'effect',
};

function parseCraftingRecipes() {
  const craftingH1 = findHeading('Crafting (all)', 1);
  const ritualH1 = findHeading('Rituals', 1, craftingH1);
  const recipes = [];

  let i = craftingH1 + 1;
  while (i < ritualH1) {
    const n = nodes[i];
    if (n.type === 'heading' && n.level === 3 && RECIPE_HEADER.test(n.text)) {
      const h = n.text.match(RECIPE_HEADER);
      const extraTags = [...(h[5] || '').matchAll(/\[([^\]]+)\]/g)].map(m => m[1].trim());
      const recipe = {
        name: h[1].trim(), discipline: h[3], tier: h[2], tags: extraTags,
        materials: null, usesPerBatch: null, expiration: null, application: null,
        type: null, process: '', description: '', effect: '', fields: {},
      };

      const recEnd = nodes.findIndex((m, j) => j > i && m.type === 'heading' && m.level <= 3);
      const rEnd = recEnd === -1 ? ritualH1 : Math.min(recEnd, ritualH1);
      const bodyNodes = nodes.slice(i + 1, rEnd).filter(m => m.type === 'text');

      let curKey = null, curLabel = null, inProcess = false;
      const addTo = (key, text) => { recipe[key] = recipe[key] ? recipe[key] + ' ' + text : text; };
      const append = (label, text) => { recipe.fields[label] = (recipe.fields[label] ? recipe.fields[label] + ' ' : '') + text; };

      for (const bn of bodyNodes) {
        const m = bn.text.match(RECIPE_FIELD);
        if (m) {
          curLabel = m[1]; curKey = FIELD_KEY[m[1]] ?? null;
          if (m[1] === 'Crafting Process') inProcess = true;
          else if (m[1] === 'Description' || m[1] === 'Effect') inProcess = false;
          const val = m[2].trim();
          if (curKey && curKey in recipe) addTo(curKey, val);
          if (val) append(m[1], val);
        } else if (curLabel) {
          if (inProcess && curKey !== 'process') addTo('process', bn.text);
          else if (curKey && curKey in recipe) addTo(curKey, bn.text);
          append(curLabel, bn.text);
        }
      }

      // Assemble Enchanting process from sub-steps when no explicit process field
      if (!recipe.process) {
        const steps = ['Circle of Sacrifice','Circle of Empowerment','Circle of Assignment','Rune Circle']
          .filter(k => recipe.fields[k]).map(k => `${k}: ${recipe.fields[k]}`);
        if (steps.length) recipe.process = steps.join(' ');
      }

      recipes.push(recipe);
      i = rEnd;
    } else {
      i++;
    }
  }
  return recipes;
}

write('crafting-recipes.json', parseCraftingRecipes());

// ─── RITUALS ──────────────────────────────────────────────────────────────────
// H1: "Rituals" (second occurrence — actual ritual list, not concepts preamble)
// Ritual entries are H3 "Name [Tier Ritual]".

console.log('\nParsing rituals...');

const RITUAL_HEADER = /^(.+?)\s*\[(Apprentice|Journeyman|Greater)\s+Ritual\]\s*$/;
const RITUAL_FIELD = /^(Summary|Required Components|Ritualists|Total Participants|Expiration|Targets?|Tools Used|Location|Other Requirements|Dark Territory Marshal Required|Dark Territory Suit|Category|Effect|Ritual Process|Note):\s*(.*)$/;
const RITUAL_KEY = {
  'Summary': 'summary', 'Required Components': 'components', 'Ritualists': 'ritualists',
  'Total Participants': 'totalParticipants', 'Expiration': 'expiration',
  'Target': 'targets', 'Targets': 'targets', 'Tools Used': 'tools',
  'Location': 'location', 'Other Requirements': 'otherRequirements',
  'Dark Territory Marshal Required': 'darkTerritoryMarshal',
  'Dark Territory Suit': 'darkTerritorySuit',
  'Effect': 'effect', 'Ritual Process': 'process',
};

function parseRituals() {
  // The actual ritual list is under "Ritual Magic" H1
  const ritualMagicH1 = findHeading('Ritual Magic', 1);
  const ritualEnd = nextHeadingAtOrAbove(1, ritualMagicH1);
  const end = ritualEnd === -1 ? nodes.length : ritualEnd;
  const rituals = [];

  let i = ritualMagicH1 + 1;
  while (i < end) {
    const n = nodes[i];
    if (n.type === 'heading' && n.level === 3 && RITUAL_HEADER.test(n.text)) {
      const h = n.text.match(RITUAL_HEADER);
      const rec = {
        name: h[1].trim(), tier: h[2],
        summary: '', components: null, ritualists: null, totalParticipants: null,
        expiration: null, targets: null, tools: null, location: null,
        otherRequirements: null, darkTerritoryMarshal: null, darkTerritorySuit: null,
        effect: '', process: '',
      };

      const recEnd = nodes.findIndex((m, j) => j > i && m.type === 'heading' && m.level <= 3);
      const rEnd = recEnd === -1 ? end : Math.min(recEnd, end);
      const bodyNodes = nodes.slice(i + 1, rEnd).filter(m => m.type === 'text');

      let curKey = null;
      for (const bn of bodyNodes) {
        const m = bn.text.match(RITUAL_FIELD);
        if (m) {
          curKey = RITUAL_KEY[m[1]] ?? null;
          if (curKey) rec[curKey] = rec[curKey] ? rec[curKey] + ' ' + m[2].trim() : m[2].trim();
        } else if (curKey) {
          rec[curKey] = rec[curKey] ? rec[curKey] + ' ' + bn.text : bn.text;
        }
      }
      rituals.push(rec);
      i = rEnd;
    } else {
      i++;
    }
  }
  return rituals;
}

write('ritual-recipes.json', parseRituals());

// ─── CORE RULES ───────────────────────────────────────────────────────────────
// The heading hierarchy directly encodes the section structure.
// We emit three things:
//   1. core-rules.json — flat list of H1 sections with their prose content
//   2. glossary.json   — term/definition pairs from the Glossary/Index H1
//   3. Per-concept files (combat-rules.json, death-and-dying.json, etc.)
//      derived recursively from each H1's named children at any depth. The
//      bucket name is derived from the parent H1 heading.

console.log('\nParsing core rules...');

// Sections to skip entirely (policy/etiquette, not navigable game mechanics).
const SKIP_SECTIONS = new Set([
  'Code of Conduct', 'Wellspring Code of Conduct',
  'Consent and Calibration', 'Combat Etiquette', 'Roleplay Etiquette',
  'Wellspring Setting Start Guide',
]);

// Sections whose H2/H3 children are already extracted better elsewhere.
// Their concepts are not emitted as sub-concepts.
const ALREADY_EXTRACTED = new Set([
  'Effects', 'Conditions', 'Types', 'Defense Calls', 'Modifiers',
  'Stacking Effects', 'Items',
]);

// Names that look like sub-concept headings but are actually stat-block field
// labels used inside crafting recipes ("Description:", "Effect:"). Skipping
// them prevents an "Effect" entity (255 false matches) and "Description"
// entity from clobbering real game terms.
const STATBLOCK_LABEL_NAMES = new Set([
  'Description', 'Effect', 'Recipes/Formulae/Schematics',
  'Crafting Resources List', 'Auros Starting Wealth', 'Typical Merchant Prices',
  'Item Cards',
]);

function parseCoreRules() {
  const crStart = findHeading('Wellspring Core Rules', 1);
  const glossaryH1 = findHeading('Glossary/Index', 1, crStart);
  const settingH1 = findHeading('Wellspring Setting Start Guide', 1, glossaryH1);
  const crEnd = settingH1 === -1 ? nodes.length : settingH1;

  // (1) Top-level sections: each H1 between crStart and glossaryH1
  const sections = [];
  let i = crStart + 1;
  while (i < glossaryH1) {
    const n = nodes[i];
    if (n.type !== 'heading' || n.level !== 1) { i++; continue; }
    if (!n.text) { i++; continue; }

    const secEnd = nodes.findIndex((m, j) => j > i && m.type === 'heading' && m.level === 1);
    const end = secEnd === -1 ? glossaryH1 : Math.min(secEnd, glossaryH1);

    sections.push({
      heading: n.text,
      content: bodyBetween(i + 1, end),
      nodeStart: i,
      nodeEnd: end,
    });
    i = end;
  }

  // (2) Glossary: text nodes under Glossary/Index H1, parsed as "Term: definition"
  const glossary = [];
  const glossEnd = crEnd;
  let j = glossaryH1 + 1;
  while (j < glossEnd) {
    const n = nodes[j];
    if (n.type === 'heading') break;
    if (n.type === 'text') {
      const m = n.text.match(/^([A-Z][A-Za-z '\/\-]{1,40}?):\s+(.+)$/);
      if (m) glossary.push({ term: m[1].trim(), definition: m[2].trim() });
      else if (glossary.length) glossary[glossary.length - 1].definition += ' ' + n.text;
    }
    j++;
  }

  return { sections, glossary };
}

const coreRules = parseCoreRules();
write('core-rules.json', coreRules.sections.map(s => ({ heading: s.heading, content: s.content })));
write('glossary.json', coreRules.glossary);

// Additional H1 blocks outside the Core Rules range whose H2/H3/H4/H5 children
// are referenced heavily from other entity bodies and so are worth extracting.
// (Audit found Wealth/Ashbin/Turn of the Hourglass/Dark Territory etc. each
// referenced 30+ times — extracting them turns those into graph edges.)
function collectExtraSections() {
  const extras = [];
  const tryRange = (startHeading, endHeading) => {
    const start = findHeading(startHeading, 1);
    if (start === -1) return;
    const end = findHeading(endHeading, 1, start);
    if (end === -1) return;
    extras.push({
      heading: startHeading,
      content: bodyBetween(start + 1, end),
      nodeStart: start,
      nodeEnd: end,
    });
  };
  // Wealth lives between "Wealth" H1 and the next "Crafting (all)" H1.
  tryRange('Wealth', 'Crafting (all)');
  // The Crafting Introduction lives between "Crafting (all)" and the first
  // crafting-discipline H1 ("Alchemy").
  tryRange('Crafting (all)', 'Alchemy');
  // Devotions & Divine Beings — the H1 intro (before the per-deity H1s) is
  // the only place "Devotion" as a concept is defined. We pull the intro prose
  // up to the first deity H1 ("The Mother").
  tryRange('Devotions & Divine Beings', 'The Mother');
  return extras;
}
const extraSections = collectExtraSections();

// ─── CORE RULES SUB-CONCEPTS ──────────────────────────────────────────────────
// Walk each H1 section's node range, recursively emitting one entity per named
// heading at any depth. Deeper headings become `subConcepts` of their parent.
// The bucket (output file) is derived from the H1 section heading — no
// hardcoded section→type maps.
//
// Sections in SKIP_SECTIONS and ALREADY_EXTRACTED are ignored. Heading names in
// STATBLOCK_LABEL_NAMES (e.g. "Description", "Effect") are skipped as entries
// but still descended into.

console.log('\nParsing core rules sub-concepts...');

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Pick the lowest (smallest) heading level present in (start, end). Returns
// null if no headings exist. Used so recursion lands on the next existing
// deeper level rather than always assuming level+1 (the doc sometimes skips
// levels — e.g. Crafting Process H3 → Ashbin H5 with no H4 in between).
function nextHeadingLevel(start, end, above) {
  let lvl = null;
  for (let i = start; i < end; i++) {
    const n = nodes[i];
    if (n.type === 'heading' && n.text && n.level > above) {
      if (lvl === null || n.level < lvl) lvl = n.level;
    }
  }
  return lvl;
}

// Walk the range [start, end) and emit one entry per heading at `level`. Each
// entry's own children at deeper levels become its `subConcepts` recursively.
// Prose between a heading and its first child becomes the entry's description.
function walkHeadings(start, end, level, sectionName) {
  const entries = [];
  let i = start;
  while (i < end) {
    const n = nodes[i];
    if (n.type !== 'heading' || n.level !== level || !n.text) { i++; continue; }

    const headingEnd = nodes.findIndex((m, j) => j > i && m.type === 'heading' && m.level <= level);
    const eEnd = headingEnd === -1 ? end : Math.min(headingEnd, end);

    if (STATBLOCK_LABEL_NAMES.has(n.text)) {
      // Skip this heading as an entry but harvest its sub-tree, descending to
      // the next deeper level that actually exists.
      const childLevel = nextHeadingLevel(i + 1, eEnd, level);
      if (childLevel !== null) entries.push(...walkHeadings(i + 1, eEnd, childLevel, sectionName));
      i = eEnd;
      continue;
    }

    // Description: prose nodes between this heading and the first deeper heading.
    const firstChild = nodes.findIndex((m, j) => j > i && j < eEnd && m.type === 'heading' && m.level > level);
    const proseEnd = firstChild === -1 ? eEnd : firstChild;
    const description = bodyBetween(i + 1, proseEnd);

    // Recurse into the next existing deeper level (not necessarily level+1).
    const childLevel = nextHeadingLevel(i + 1, eEnd, level);
    const subConcepts = childLevel !== null
      ? walkHeadings(i + 1, eEnd, childLevel, n.text)
      : [];

    entries.push({
      name: n.text,
      section: sectionName,
      description,
      ...(subConcepts.length ? { subConcepts } : {}),
    });
    i = eEnd;
  }
  return entries;
}

function parseSubConcepts(sections) {
  const buckets = {};
  const push = (bucket, entry) => { (buckets[bucket] ??= []).push(entry); };

  for (const section of sections) {
    if (SKIP_SECTIONS.has(section.heading)) continue;
    if (ALREADY_EXTRACTED.has(section.heading)) continue;

    const { nodeStart, nodeEnd } = section;
    const bucket = slugify(section.heading);

    // Enter at the next existing deeper heading level (skips missing levels —
    // e.g. an H1 with H3 children but no H2).
    const childLevel = nextHeadingLevel(nodeStart, nodeEnd, 1);
    const entries = childLevel !== null
      ? walkHeadings(nodeStart + 1, nodeEnd, childLevel, section.heading)
      : [];
    if (entries.length) {
      entries.forEach(e => push(bucket, e));
      continue;
    }
    // No child headings at all (e.g. Wealth, whose only H2s are stat-block
    // labels we skipped): emit the H1 itself as a single entry in its bucket,
    // provided it has meaningful body prose.
    const prose = bodyBetween(nodeStart + 1, nodeEnd);
    if (prose.trim()) {
      push(bucket, { name: section.heading, section: section.heading, description: prose });
    }
  }
  return buckets;
}

const subConcepts = parseSubConcepts([...coreRules.sections, ...extraSections]);

// Recover doc-defined concepts whose heading was demoted to body text during
// the Google Docs HTML export. The export pattern is "<Term> <Term> is a
// type of..." — the same word appearing twice in a row at the start of a
// sentence, because the original heading became a styled span instead of an
// <h2>/<h3> tag. We detect this and split off `<Term>` as its own sub-concept
// of whatever entry currently holds it.
//
// Known affected term so far: "Barrier" inside Combat Rules → Armor Points →
// Summoned Armor. See DOC_EDITS_WANTED #11e for the upstream fix.
const DEMOTED_HEADING_RE = /(?:^|\.\s+)([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+){0,2})\s+\1\s+(is|are|means|refers to)\b/;
function splitDemotedHeadings(entries) {
  return entries.map((e) => {
    const out = { ...e };
    if (typeof out.description === "string") {
      const m = out.description.match(DEMOTED_HEADING_RE);
      if (m) {
        const term = m[1];
        const dupStart = out.description.indexOf(`${term} ${term}`);
        if (dupStart >= 0) {
          const before = out.description.slice(0, dupStart).trim();
          const splitOff = out.description.slice(dupStart + term.length + 1).trim();
          out.description = before;
          out.subConcepts = [...(out.subConcepts || []), {
            name: term,
            section: e.section,
            description: splitOff,
          }];
        }
      }
    }
    if (out.subConcepts) out.subConcepts = splitDemotedHeadings(out.subConcepts);
    return out;
  });
}

for (const [bucket, entries] of Object.entries(subConcepts).sort(([a], [b]) => a.localeCompare(b))) {
  write(`${bucket}.json`, splitDemotedHeadings(entries));
}

// ─── EFFECTS / CONDITIONS / TYPES ─────────────────────────────────────────────
// H1 sections with no heading children. Content is keyword\nprose pairs.
// We parse the text nodes directly.

console.log('\nParsing effects / conditions / types...');

function parseKeywordSection(headingText, endHeadingText) {
  const crStart = findHeading('Wellspring Core Rules', 1);
  // Search without level restriction — Effects/Conditions/Types are H1,
  // Defense Calls/Modifiers are H2. Always search from within core rules.
  const start = nodes.findIndex((n, i) =>
    i > crStart && n.type === 'heading' && n.text === headingText
  );
  if (start === -1) return [];
  const startLevel = nodes[start].level;
  const endNode = endHeadingText ? findHeading(endHeadingText, null, start) : -1;
  const end = endNode !== -1
    ? endNode
    : nodes.findIndex((n, i) => i > start && n.type === 'heading' && n.level <= startLevel);

  const textNodes = nodes.slice(start + 1, end === -1 ? nodes.length : end)
    .filter(n => n.type === 'text' || n.type === 'list');

  // Keyword line: short, title-case, no terminal punctuation.
  const isKeyword = t =>
    t.length <= 50 && /^[A-Z\[]/.test(t) && !/[.!?,):]\s*$/.test(t) && !/^The\s/.test(t);

  const byName = new Map();
  let i = 0;
  // Skip intro sentence (ends with period)
  while (i < textNodes.length && textNodes[i].type === 'text' && /[.!?]$/.test(textNodes[i].text)) i++;

  while (i < textNodes.length) {
    const n = textNodes[i];
    if (n.type === 'list') { i++; continue; }
    const keyword = n.text;
    if (!isKeyword(keyword)) { i++; continue; }
    i++;

    // Definition: following text nodes until next keyword
    const def = [];
    while (i < textNodes.length) {
      const m = textNodes[i];
      if (m.type === 'list') { def.push(m.items.join(' ')); i++; continue; }
      if (isKeyword(m.text)) break;
      def.push(m.text);
      i++;
    }
    if (!def.length) continue;

    // Stem: strip leading/trailing bracketed params and connective words
    const stem = keyword
      .replace(/^\[[^\]]+\]\s*/, '')
      .replace(/\s*\[.*$/, '')
      .replace(/\s+(to|or|vs\.?|Plus)\s*$/i, '')
      .trim() || keyword;

    if (!byName.has(stem)) {
      byName.set(stem, { name: stem, variants: [], description: def.join(' ') });
    }
    const entry = byName.get(stem);
    if (keyword !== stem) entry.variants.push({ form: keyword, description: def.join(' ') });
  }

  for (const entry of byName.values()) {
    const m = entry.description.match(/(?:causes?|applies|grants?|inflicts?) the (\w[\w '-]*?) condition/i);
    if (m) entry.causesCondition = m[1].trim();
  }

  return [...byName.values()];
}

write('effects.json',    parseKeywordSection('Effects', 'Stacking Effects'));
write('conditions.json', parseKeywordSection('Conditions', 'Types'));
write('types.json',      parseKeywordSection('Types', 'Items'));
// Defense Calls and Modifiers are H2s with H3 children — parse structurally.
function parseH3Concepts(headingText) {
  const crStart = findHeading('Wellspring Core Rules', 1);
  const h2 = nodes.findIndex((n, i) => i > crStart && n.type === 'heading' && n.text === headingText);
  if (h2 === -1) return [];
  const h2Level = nodes[h2].level;
  const h2End = nodes.findIndex((n, i) => i > h2 && n.type === 'heading' && n.level <= h2Level);
  const end = h2End === -1 ? nodes.length : h2End;
  const out = [];
  let i = h2 + 1;
  while (i < end) {
    const n = nodes[i];
    if (n.type !== 'heading' || n.level !== h2Level + 1 || !n.text) { i++; continue; }
    const entryEnd = nodes.findIndex((m, j) => j > i && m.type === 'heading' && m.level <= n.level);
    const eEnd = entryEnd === -1 ? end : Math.min(entryEnd, end);
    const description = bodyBetween(i + 1, eEnd);
    out.push({ name: n.text, variants: [], description });
    i = eEnd;
  }
  return out;
}
write('defense-calls.json', parseH3Concepts('Defense Calls'));
write('modifiers.json',  parseH3Concepts('Modifiers'));

// ─── ACCENTS ─────────────────────────────────────────────────────────────────
// Under the "Accent" H2 within Core Rules. Each line: "Name [Elemental] - desc"

console.log('\nParsing accents...');

function parseAccents() {
  const crStart = findHeading('Wellspring Core Rules', 1);
  const accentH2 = nodes.findIndex((n, i) =>
    i > crStart && n.type === 'heading' && n.level === 2 && n.text === 'Accent'
  );
  if (accentH2 === -1) return [];
  const accentEnd = nodes.findIndex((n, i) => i > accentH2 && n.type === 'heading' && n.level <= 2);
  const end = accentEnd === -1 ? nodes.length : accentEnd;

  const out = [];
  for (let i = accentH2 + 1; i < end; i++) {
    const n = nodes[i];
    if (n.type !== 'text') continue;
    // "Agony - Wracking pain..." or "Acid [Elemental] - Caustic..."
    const m = n.text.match(/^(.+?)(?:\s*(\[Elemental\]))?\s+-\s+(.+)$/);
    if (!m) continue;
    out.push({ name: m[1].trim(), elemental: !!m[2], description: m[3].trim() });
  }
  return out;
}

write('accents.json', parseAccents());

// ─── CRAFTING RESOURCES ───────────────────────────────────────────────────────
// H2 "Crafting Resources List" under Crafting (all). Entries: H3 "Name (Tier)"
// or inline "Name (Tier)\nDescription" text.

console.log('\nParsing crafting resources...');

function parseResources() {
  const craftingH1 = findHeading('Crafting (all)', 1);
  const resourcesH2 = nodes.findIndex((n, i) =>
    i > craftingH1 && n.type === 'heading' && n.level === 2 && n.text === 'Crafting Resources List'
  );
  if (resourcesH2 === -1) return [];
  const resourcesEnd = nodes.findIndex((n, i) => i > resourcesH2 && n.type === 'heading' && n.level <= 2);
  const end = resourcesEnd === -1 ? nodes.length : resourcesEnd;

  const out = [];
  for (let i = resourcesH2 + 1; i < end; i++) {
    const n = nodes[i];
    if (n.type !== 'text') continue;
    // Resources export as "Name (Tier)Description" concatenated in one text node.
    // Split on the (Tier) boundary.
    const m = n.text.match(/^(.+?)\s*\((Basic|Uncommon|Advanced)\)\s*(.*)$/);
    if (!m) continue;
    const name = m[1].trim(), tier = m[2];
    let description = m[3].trim();
    // Continuation nodes follow until the next resource or heading
    let j = i + 1;
    while (j < end) {
      const next = nodes[j];
      if (next.type === 'heading') break;
      if (next.type === 'text') {
        if (/\((Basic|Uncommon|Advanced)\)/.test(next.text)) break;
        description += (description ? ' ' : '') + next.text;
      }
      j++;
    }
    out.push({ name, tier, description });
    i = j - 1;
  }
  return out;
}

write('resources.json', parseResources());

// ─── CRAFTING CONCEPTS ────────────────────────────────────────────────────────
// H2 sections under each discipline H1 (Alchemy/Enchanting/Tinkering), before
// the recipe list H2s. The discipline name is the parent H1 text.

console.log('\nParsing crafting concepts...');

const RECIPE_SECTION_RE = /^(Apprentice|Journeyman|Greater)\s+(Alchemy Recipes|Enchanting Formulae|Tinkering Schematics)$/;
const RECIPE_FIELD_NOISE = new Set([
  'Application', 'Quaff', 'Topical', 'Ingest', 'Component',
  'Crafting Materials', 'Uses Per Batch', 'Expiration', 'Crafting Process',
  'Description', 'Effect', 'Recipes/Formulae/Schematics', 'Introduction',
  'Turn of the Hourglass', 'Item Cards', 'Ashbin', 'Dark Territory',
  'Crafting Resources List', 'Named Resources', 'Alchemy', 'Enchanting', 'Tinkering',
]);

function parseCraftingConcepts() {
  const craftingH1 = findHeading('Crafting (all)', 1);
  const ritualH1 = findHeading('Rituals', 1, craftingH1);
  const out = [];

  const disciplines = ['Alchemy', 'Enchanting', 'Tinkering'];
  for (const disc of disciplines) {
    const discH1 = findHeading(disc, 1, craftingH1);
    if (discH1 === -1 || discH1 >= ritualH1) continue;
    const discEnd = nodes.findIndex((n, i) =>
      i > discH1 && n.type === 'heading' && n.level === 1
    );
    const dEnd = discEnd === -1 ? ritualH1 : Math.min(discEnd, ritualH1);

    // Concept H2s are those before the first recipe-list H2
    const firstRecipeH2 = nodes.findIndex((n, i) =>
      i > discH1 && i < dEnd && n.type === 'heading' && n.level === 2 && RECIPE_SECTION_RE.test(n.text)
    );
    const conceptEnd = firstRecipeH2 === -1 ? dEnd : firstRecipeH2;

    let i = discH1 + 1;
    while (i < conceptEnd) {
      const n = nodes[i];
      if (n.type !== 'heading' || n.level !== 2 || !n.text || RECIPE_FIELD_NOISE.has(n.text)) { i++; continue; }

      const conceptH2End = nodes.findIndex((m, j) => j > i && m.type === 'heading' && m.level <= 2);
      const cEnd = conceptH2End === -1 ? conceptEnd : Math.min(conceptH2End, conceptEnd);

      const subNodes = nodes.slice(i + 1, cEnd);
      const prose = subNodes.filter(m => m.type === 'text').map(m => m.text).join(' ');
      const tools = subNodes.filter(m => m.type === 'list').flatMap(m => m.items);

      // Fold the list into the description so the detail pane reads complete (the
      // list usually follows a "…the following:" colon). Keep `tools` for structure.
      const description = tools.length ? `${prose} ${tools.map((t) => `• ${t}`).join(' ')}`.trim() : prose;
      const concept = { name: n.text, discipline: disc, description };
      if (tools.length) concept.tools = tools;
      out.push(concept);
      i = cEnd;
    }
  }
  return out;
}

write('crafting-concepts.json', parseCraftingConcepts());

// ─── RITUAL CONCEPTS ──────────────────────────────────────────────────────────
// H3/H4 concepts under the "Rituals" H1 preamble (before "Ritual Magic" H1).

console.log('\nParsing ritual concepts...');

function parseRitualConcepts() {
  const ritualsH1 = findHeading('Rituals', 1);
  const ritualMagicH1 = findHeading('Ritual Magic', 1, ritualsH1);
  const end = ritualMagicH1 === -1 ? nodes.length : ritualMagicH1;

  const RITUAL_FIELD_NOISE = new Set([
    'Expiration', 'Target', 'Required Components', 'Tools Used',
    'Other Requirements', 'Location', 'Effect', 'Ritual Process',
    'Dark Territory', 'Dark Territory Suit', 'Dark Territory Marshal Required',
  ]);

  const out = [];
  let i = ritualsH1 + 1;
  while (i < end) {
    const n = nodes[i];
    if (n.type !== 'heading' || (n.level !== 3 && n.level !== 4) || !n.text || RITUAL_FIELD_NOISE.has(n.text)) { i++; continue; }

    const conceptEnd = nodes.findIndex((m, j) => j > i && m.type === 'heading' && m.level <= n.level);
    const cEnd = conceptEnd === -1 ? end : Math.min(conceptEnd, end);

    // Description = prose between this heading and its first deeper child
    // (so children like H4 "Primary Ritualist" under H3 "Ritualists" aren't
    // swallowed into the parent's description).
    const firstChild = nodes.findIndex((m, j) => j > i && j < cEnd && m.type === 'heading' && m.level > n.level);
    const proseEnd = firstChild === -1 ? cEnd : firstChild;
    const proseNodes = nodes.slice(i + 1, proseEnd);
    const prose = proseNodes.filter(m => m.type === 'text').map(m => m.text).join(' ');
    const bullets = proseNodes.filter(m => m.type === 'list').flatMap(m => m.items);

    // Sub-concepts: deeper headings inside this concept's range.
    const subConcepts = [];
    let k = firstChild === -1 ? cEnd : firstChild;
    while (k < cEnd) {
      const m = nodes[k];
      if (m.type === 'heading' && m.level > n.level && m.text && !RITUAL_FIELD_NOISE.has(m.text)) {
        const subEnd = nodes.findIndex((x, l) => l > k && x.type === 'heading' && x.level <= m.level);
        const sEnd = subEnd === -1 ? cEnd : Math.min(subEnd, cEnd);
        subConcepts.push({
          name: m.text,
          description: nodes.slice(k + 1, sEnd).filter(x => x.type === 'text').map(x => x.text).join(' '),
        });
        k = sEnd;
      } else {
        k++;
      }
    }

    // Fold the bullet list into the description so the detail pane reads complete
    // (the list often follows a "…below:" colon). Keep `bullets` too for any
    // structured use.
    const fullDesc = bullets.length
      ? `${prose} ${bullets.map((b) => `• ${b}`).join(' ')}`.trim()
      : prose;
    const concept = { name: n.text, description: fullDesc };
    if (bullets.length) concept.bullets = bullets;
    if (subConcepts.length) concept.subConcepts = subConcepts;
    out.push(concept);
    i = cEnd;
  }
  return out;
}

write('ritual-concepts.json', parseRitualConcepts());

console.log('\nDone.');
