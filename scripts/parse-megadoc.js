#!/usr/bin/env node
// parse-megadoc.js — reads Wellspring MegaDoc.txt, writes structured JSON to src/data/
// Run: node scripts/parse-megadoc.js

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DOC = join(ROOT, 'Wellspring MegaDoc.txt');
const OUT = join(ROOT, 'src', 'data');

mkdirSync(OUT, { recursive: true });

const raw = readFileSync(DOC, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const lines = raw.split('\n');

function write(filename, data) {
  const path = join(OUT, filename);
  writeFileSync(path, JSON.stringify(data, null, 2));
  const count = Array.isArray(data) ? data.length : Object.keys(data).length;
  console.log(`  ${filename.padEnd(24)} ${count} entries`);
}

function findIdx(pattern, after = 0) {
  return lines.findIndex((l, i) => i >= after && pattern.test(l.trim()));
}

// Two nested TOCs the parser needs to skip past, named for the structural
// intent rather than the specific line numbers they hide. The body sections we
// want all sit past one of these:
//   - PAST_DOC_TOC: past the 140-line doc-summary table at the top of the doc.
//   - PAST_CORE_RULES_TOC: past the Core Rules' own nested TOC (~lines 519-583),
//     where Effects/Conditions/Types/Level Progression Table also appear as
//     bare title-only entries before their real body sections.
const PAST_DOC_TOC = 200;
const PAST_CORE_RULES_TOC = 600;

function findBodyHeader(pattern, after = PAST_DOC_TOC) {
  return lines.findIndex((l, i) => i >= after && pattern.test(l.trim()));
}

// ─── POWER BLOCK PARSER ───────────────────────────────────────────────────────

const TIER_PATTERN = /\[(Utility|Basic|Advanced|Veteran|Cantrip|Novice|Adept|Greater|Innate|Class|Form|Right Hand)\]/;

// A real power header is "Name [Tier]" with the tier tag in the trailing tag
// cluster: optionally more [Tags], an optional "- N BP" cost (Class-tier powers),
// and an optional (N) ranks, then end-of-line. This rejects prose that merely
// mentions a "[Tier]" mid-sentence.
const POWER_HEADER = new RegExp(
  TIER_PATTERN.source + String.raw`(\s*\[[^\]]+\])*\s*(-\s*\d+\s*BP)?\s*(\(\d+\))?\s*$`
);

function isPowerHeader(line) {
  return POWER_HEADER.test(line.trim());
}

// Shared stat-block reader for power-like entries (class powers, spells, domain
// powers). Walks the lines after the header, pulling "Label: value" stat fields
// (two can share a line, e.g. "Target: ...  Duration: ...") until the first
// non-field line, which begins the description. Returns lowercase-keyed fields
// plus the joined description. "Incant" is normalized to "incantation".
const STAT_TWO_FIELD = /^(Target|Delivery|Accent):\s*(.+?)\s{2,}(Duration|Refresh|Effect):\s*(.+)$/;
const STAT_SINGLE_FIELD = /^(Incantation|Incant|Call|Target|Duration|Delivery|Refresh|Accent|Effect|Requirement|Prerequisites?|Skills and Options):\s*(.*)$/;
const statKey = label => label.toLowerCase().replace(/^incant$/, 'incantation').replace(/\s+/g, '_').replace(/s$/, '');

function extractStatBlock(blockLines) {
  const fields = {};
  let descStart = 1;
  for (let i = 1; i < blockLines.length; i++) {
    const line = blockLines[i].trim();
    if (!line) { descStart = i + 1; break; }
    const two = line.match(STAT_TWO_FIELD);
    if (two) {
      fields[statKey(two[1])] = two[2].trim();
      fields[statKey(two[3])] = two[4].trim();
      descStart = i + 1;
      continue;
    }
    const one = line.match(STAT_SINGLE_FIELD);
    if (one) {
      fields[statKey(one[1])] = one[2].trim();
      descStart = i + 1;
      continue;
    }
    descStart = i;
    break;
  }
  const description = blockLines.slice(descStart).map(l => l.trim()).filter(Boolean).join(' ');
  return { fields, description };
}

function parsePowerBlock(blockLines) {
  const header = blockLines[0].trim();
  // Name is everything before the first tag or the "- N BP" cost, whichever comes
  // first (Class-tier headers vary: "Name [Class] - N BP" and "Name - N BP [Class]").
  const name = header.replace(/\s*(\[|-\s*\d+\s*BP).*$/, '').trim();
  const tierMatch = header.match(TIER_PATTERN);
  const tier = tierMatch ? tierMatch[1] : 'Unknown';
  const tags = [...header.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]).filter(t => t !== tier);
  const ranksMatch = header.match(/\((\d+)\)\s*$/);
  const maxRanks = ranksMatch ? parseInt(ranksMatch[1]) : 1;
  // Class-tier powers carry an explicit BP cost in the header ("- N BP").
  const costMatch = header.match(/-\s*(\d+)\s*BP/);
  const cost = costMatch ? parseInt(costMatch[1]) : null;

  const { fields, description } = extractStatBlock(blockLines);

  return {
    name,
    tier,
    tags,
    maxRanks,
    cost,
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
  };
}

function parsePowerSection(sectionLines) {
  const filtered = sectionLines.filter(l => l.trim());
  const blocks = [];
  let current = [];

  for (const line of filtered) {
    if (isPowerHeader(line) && current.length > 0) {
      blocks.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks.filter(b => isPowerHeader(b[0])).map(parsePowerBlock);
}

// ─── CLASS SECTION EXTRACTION ─────────────────────────────────────────────────

const CLASSES = ['Artisan', 'Cleric', 'Druid', 'Fighter', 'Mage', 'Rogue', 'Socialite', 'Sourcerer'];

// Sentinel: any known class power section header OR major doc section.
// Must match the section header but NOT "Mage Cantrip Incantation" or similar subtitle lines.
const MAJOR_SECTION = new RegExp(
  `^(${CLASSES.join('|')})\\s+(Utility|Basic|Advanced|Veteran|Innate|Class) Powers$|` +
  `^(${CLASSES.join('|')})\\s+(Cantrip|Novice|Adept|Greater)( Form)? (Spells|Skills|Powers)$|` +
  `^(${CLASSES.join('|')}) Cantrips?$|` +                       // bare "Mage Cantrips" header
  `^(${CLASSES.join('|')}) (Class )?Skills$|` +
  `^(${CLASSES.join('|')}) Right Hand Powers$|` +
  `^Basic (${CLASSES.join('|')}) Powers$|` +
  `^(Skills,|Flaws|Perks|Devotions|Lineages|Advanced Classes|Champion Classes|Appendix)`
);

function extractPowerSection(headerPattern, afterIdx = 0) {
  const startIdx = findIdx(headerPattern, afterIdx);
  if (startIdx === -1) return [];

  // Skip past any "Incantation" label line immediately after the section header
  let contentStart = startIdx + 1;
  if (/Incantation$/i.test(lines[contentStart]?.trim())) contentStart++;

  const end = lines.findIndex((l, i) => i > startIdx && MAJOR_SECTION.test(l.trim()));
  return parsePowerSection(lines.slice(contentStart, end === -1 ? lines.length : end));
}

// ─── CLASS PROGRESSION TABLE ──────────────────────────────────────────────────
// The doc exports each table cell on its own tab-indented line. Two wrinkles:
//   1. A long "Class Bonuses" cell word-wraps onto a following NON-tab line
//      (e.g. "\tInnate Bonus Cantrip: Cancel," then "Astride the Weave"). That
//      continuation belongs to the preceding cell, not a new row/section.
//   2. The table always ends at the "Note:" line — the only reliable terminator.
// Row shape is fixed: a level integer, then the per-column data cells, then a
// bonus cell that may be "-", empty, or wrapped. We anchor on the level integer
// and treat everything up to the next level integer as that row's cells.

function parseProgressionTable(classStartIdx) {
  const tableIdx = findIdx(/^Class Progression Table$/, classStartIdx);
  if (tableIdx === -1) return {};

  // Bound the table at the trailing Note: line (present for every class).
  let endIdx = lines.length;
  for (let i = tableIdx + 1; i < Math.min(tableIdx + 300, lines.length); i++) {
    if (/^Note:/.test(lines[i].trim())) { endIdx = i; break; }
  }
  const rawLines = lines.slice(tableIdx + 1, endIdx);

  const isCaster = /cantrip|spell/i.test(rawLines.slice(0, 20).join(' '));

  // Build cells: tab-indented lines are new cells; non-tab, non-blank lines are
  // wrapped continuations appended to the previous cell. Column headers (single-
  // and multi-word) are dropped so the remaining stream is pure row data.
  const HEADER_CELLS = /^(Class|Level|Utility Powers|Basic Powers|Advanced Powers|Veteran Powers|Cantrips?|Spells? Known|Spell Slots|Class Bonuses?)$/i;
  const cells = [];
  for (const line of rawLines) {
    if (line.startsWith('\t')) {
      const v = line.trim();
      if (v) cells.push(v);
    } else {
      // A non-tab line is a wrapped continuation only when the previous cell is
      // visibly incomplete (ends with a comma). Otherwise it's a heading or body
      // line that happens to sit inside the table region — ignore it.
      const cont = line.trim();
      const prev = cells[cells.length - 1];
      if (cont && prev && /,$/.test(prev)) cells[cells.length - 1] = prev + ' ' + cont;
    }
  }
  const data = cells.filter(v => !HEADER_CELLS.test(v));

  const num = v => parseInt(v) || 0;
  const orNull = v => (!v || v === '-' ? null : v);

  // The stream is now regular: each row is a level integer followed by a fixed
  // number of data cells (caster: cantrips, spellsKnown, slots, bonus = 4;
  // martial: utility, basic, advanced, veteran, bonus = 5). Consume fixed-width.
  const width = isCaster ? 4 : 5;
  const progression = {};
  let i = 0;
  // Skip any leading non-level cells (stray header fragments).
  while (i < data.length && !/^\d+$/.test(data[i])) i++;

  for (; i + width < data.length + 1; i += 1 + width) {
    const level = parseInt(data[i]);
    if (!(level >= 1 && level <= 20)) break;
    const cols = data.slice(i + 1, i + 1 + width);

    if (isCaster) {
      progression[level] = {
        cantrips:    num(cols[0]),
        spellsKnown: num(cols[1]),
        slots:       orNull(cols[2]),
        bonus:       orNull(cols[3]),
      };
    } else {
      progression[level] = {
        utility:  num(cols[0]),
        basic:    num(cols[1]),
        advanced: num(cols[2]),
        veteran:  num(cols[3]),
        bonus:    orNull(cols[4]),
      };
    }
  }

  return progression;
}

// ─── PARSE ALL CLASSES ────────────────────────────────────────────────────────

console.log('\nParsing class powers...');
const allClassData = [];

for (const cls of CLASSES) {
  const classIdx = findIdx(new RegExp(`^${cls}: Base Class$`));

  // Description
  const ssIdx = findIdx(/^Starting Skills$/, classIdx);
  const descLines = [];
  for (let i = classIdx + 1; i < (ssIdx === -1 ? classIdx + 30 : ssIdx); i++) {
    const l = lines[i]?.trim();
    if (l && !/^Description$/.test(l)) descLines.push(l);
  }

  // Starting skills (bullet lines)
  const startingSkills = [];
  if (ssIdx !== -1) {
    for (let i = ssIdx + 1; i < ssIdx + 50; i++) {
      const l = lines[i]?.trim();
      if (!l || /^(Multiclass|Note:|Class Progression)/.test(l)) break;
      if (l.startsWith('*')) startingSkills.push(l.replace(/^\*\s*/, ''));
    }
  }

  // Multiclass skills
  const mcIdx = findIdx(/^Multiclass Skills$/, classIdx);
  const multiclassSkills = [];
  if (mcIdx !== -1) {
    for (let i = mcIdx + 1; i < mcIdx + 15; i++) {
      const l = lines[i]?.trim();
      if (!l || /^(Note:|Class Progression|Becoming)/.test(l)) break;
      if (l.startsWith('*')) multiclassSkills.push(l.replace(/^\*\s*/, ''));
    }
  }

  const sec = (tier, altPat) =>
    extractPowerSection(altPat ?? new RegExp(`^${cls} ${tier} Powers$`), classIdx);

  const spell = (tier) => {
    if (tier === 'Cantrip') {
      return extractPowerSection(new RegExp(`^${cls} Cantrips?$`), classIdx);
    }
    // A tier can be split across two sibling sections: "Cls <Tier> Form Spells"
    // (Druid's shapeshift spells) AND "Cls <Tier> Spells". findIdx only returns
    // the first, so collect every matching header in the class range and merge.
    const headerRe = new RegExp(`^${cls} ${tier}( Form)? Spells$`);
    const spells = [];
    let from = classIdx;
    for (;;) {
      const idx = findIdx(headerRe, from);
      if (idx === -1) break;
      spells.push(...extractPowerSection(headerRe, idx));
      from = idx + 1;
    }
    return spells;
  };

  allClassData.push({
    name: cls,
    type: ['Cleric', 'Druid', 'Mage', 'Sourcerer'].includes(cls) ? 'Spellcaster' : 'Martial',
    description: descLines.join(' '),
    startingSkills,
    multiclassSkills,
    progression: parseProgressionTable(classIdx),
    innate:        sec('Innate'),
    utility:       sec('Utility'),
    basic:         sec('Basic', new RegExp(`^(${cls} Basic Powers|Basic ${cls} Powers)$`)),
    advanced:      sec('Advanced'),
    veteran:       sec('Veteran'),
    classSkills:   sec('Class', new RegExp(`^${cls} (Class )?Skills$`)),
    rightHandPowers: sec('RightHand', new RegExp(`^${cls} Right Hand Powers$`)),
    cantrips:      spell('Cantrip'),
    noviceSpells:  spell('Novice'),
    adeptSpells:   spell('Adept'),
    greaterSpells: spell('Greater'),
  });
}

write('classes.json', allClassData);

// ─── SKILLS ───────────────────────────────────────────────────────────────────
// Name\nCost: N\nPrerequisites: ...\n<description>

console.log('\nParsing skills...');

function parseSkills() {
  // Start at "Skill Descriptions" so the leading "Martial Skills" category header
  // is included (the old "Basic Martial Weapons" anchor skipped past it). End at
  // the Perks/Flaws section.
  const startIdx = findBodyHeader(/^Skill Descriptions$/);
  const endIdx = findIdx(/^(Perks( List)?$|Flaws( List)?$|Devotions)/, startIdx);
  const section = lines.slice(startIdx + 1, endIdx);

  // Category headers are bare "<Name> Skills" lines between entries.
  const CATEGORY = /^(Martial|Magic|Scholar|Medical|Trade|Thieving|Gathering|Crafting) Skills$/;

  // A skill begins with a name line whose next non-empty line is "Cost: N".
  const costAfter = i => {
    let n = i + 1;
    while (n < section.length && !section[n].trim()) n++;
    return /^Cost:\s*\d/.test(section[n]?.trim() || '') ? n : -1;
  };
  const isNameLine = i => {
    const l = section[i].trim();
    if (!l || l.startsWith('*') || /^Note:/.test(l) || CATEGORY.test(l)) return false;
    if (/^(Cost:|Prerequisites?:|Ranks?:)/.test(l)) return false;
    return costAfter(i) !== -1;
  };

  let currentCat = 'Martial';
  const skills = [];
  let i = 0;

  while (i < section.length) {
    const l = section[i].trim();
    const cat = l.match(CATEGORY);
    if (cat) { currentCat = cat[1]; i++; continue; }

    if (isNameLine(i)) {
      // Ranks may be embedded in the name as a trailing "(N)".
      const rawName = l;
      const ranksInName = rawName.match(/\((\d+)\)\s*$/);
      const name = rawName.replace(/\s*\(\d+\)\s*$/, '').trim();

      const ci = costAfter(i);
      const cost = parseInt(section[ci].match(/Cost:\s*(\d+)/)[1]);
      let prereq = null;
      let ranks = ranksInName ? parseInt(ranksInName[1]) : null;
      let j = ci + 1;
      for (; j < section.length; j++) {
        const fl = section[j].trim();
        if (!fl) continue;
        if (/^Prerequisites?:\s*/.test(fl)) prereq = fl.replace(/^Prerequisites?:\s*/, '').trim();
        else if (/^Ranks?:\s*/.test(fl)) ranks = parseInt(fl.match(/\d+/)[0]);
        else break;
      }

      // Description runs until the next category header or next skill name.
      // Blank lines and inline "Note:" lines are skipped, not treated as ends.
      const descParts = [];
      while (j < section.length) {
        const dl = section[j].trim();
        if (CATEGORY.test(dl) || isNameLine(j)) break;
        if (dl && !/^Note:/.test(dl)) descParts.push(dl);
        j++;
      }

      skills.push({ name, cost, prereq, ranks, category: currentCat, description: descParts.join(' ') });
      i = j;
      continue;
    }
    i++;
  }
  return skills;
}

write('skills.json', parseSkills());

// ─── PERKS & FLAWS ────────────────────────────────────────────────────────────
// Tab-per-line table: one value per line with leading \t.
// Rows are 5 cells: Name, Cost/Award, Ranks, Prerequisites, Description.
// Category headers are non-indented lines between rows.

console.log('\nParsing perks & flaws...');

function parseTabTable(startPattern, endPattern, valueKey) {
  const startIdx = findIdx(startPattern);
  if (startIdx === -1) return [];
  const endIdx = findIdx(endPattern, startIdx + 1);
  const section = lines.slice(startIdx, endIdx === -1 ? lines.length : endIdx);

  const HEADER = /^(Name|Cost|Award|Ranks?|Pre-requisites?|Prerequisites?|Description)$/i;
  const CAT_SUFFIX = /\s+(Perks|Flaws)$/;

  const results = [];
  let currentCat = '';
  let cells = [];

  const flushRow = () => {
    if (cells.length >= 2 && cells[0] && !HEADER.test(cells[0])) {
      // Cost/Award is usually numeric but can be a word like "Var" (variable);
      // keep the string in that case rather than flattening it to 0.
      const rawVal = cells[1];
      const value = /^\d+$/.test(rawVal) ? parseInt(rawVal) : rawVal;
      const entry = {
        name: cells[0],
        [valueKey]: value,
        ranks: !cells[2] || cells[2] === '-' ? null : parseInt(cells[2]) || null,
        prereq: !cells[3] || cells[3] === '-' ? null : cells[3],
        category: currentCat,
        description: cells[4] || '',
      };
      results.push(entry);
    }
    cells = [];
  };

  for (const line of section) {
    if (line.startsWith('\t')) {
      const v = line.trim();
      if (!v) { flushRow(); continue; }
      if (HEADER.test(v)) continue;
      // Columns are exactly Name, value, Ranks, Prereq, Description (verified a
      // clean /5 across every group), so flush each row at 5 cells.
      cells.push(v);
      if (cells.length === 5) flushRow();
    } else {
      // A whitespace-only non-tab line is an export artifact mid-row (e.g. a
      // lone space between a perk name and its Cost cell). Ignore it — flushing
      // here would drop the partial row and desync every following row.
      const l = line.trim();
      if (!l) continue;
      // A real non-tab line ends the current row; if it's a category header,
      // switch categories.
      flushRow();
      if (CAT_SUFFIX.test(l)) {
        currentCat = l.replace(CAT_SUFFIX, '');
      }
    }
  }
  flushRow();
  return results.filter(r => r.name && !HEADER.test(r.name));
}

// The Perks List tab-table ends at "Descriptions" (the expanded Award:-format
// flaw text that follows). Stopping at Devotions would swallow that region and
// produce malformed cost=0 rows.
const perks = parseTabTable(/^Perks List$/, /^Descriptions$/, 'cost');
const flaws = parseTabTable(/^Flaws List$/, /^(Perks List|Descriptions|Devotions)/, 'bp');

write('perks.json', perks);
write('flaws.json', flaws);

// ─── DEVOTIONS ────────────────────────────────────────────────────────────────
// Two parts: (1) a tab-table mapping each Devotion to Locality + up to 4 Domains,
// then (2) per-Devotion descriptive entries (lore, tenets, color, iconography).
// Bound the section at "Divine Domains" so it doesn't run into that section and
// the Economy table beyond it.

console.log('\nParsing devotions...');

function parseDevotions() {
  const startIdx = findBodyHeader(/^Devotions & Divine Beings$/);
  if (startIdx === -1) return [];
  const endIdx = findIdx(/^Divine Domains$/, startIdx + 1);
  const section = lines.slice(startIdx, endIdx === -1 ? lines.length : endIdx);

  // (1) Mapping table: God, Locality, Domain 1..4 (tab-indented, 6-cell rows).
  const HEADER = /^(God|Locality|Domain \d+)$/i;
  const mapping = [];
  let cells = [];
  const flush = () => {
    if (cells.length >= 2 && cells[0] && !HEADER.test(cells[0])) {
      mapping.push({
        name: cells[0],
        locality: cells[1] || '',
        domains: cells.slice(2).filter(d => d && d !== '-'),
      });
    }
    cells = [];
  };
  for (const line of section) {
    if (!line.startsWith('\t')) continue; // table is entirely tab-indented
    const v = line.trim();
    if (!v) { flush(); continue; }
    if (HEADER.test(v)) continue;
    cells.push(v);
    if (cells.length === 6) flush();
  }
  flush();

  // (2) Descriptions: each devotion is a non-indented name header (matching a
  // mapping entry, optionally with an epithet like "Senri, Voice of Mercy"),
  // followed by lore, a tenets block (label varies: "The Truth:", "Laws:",
  // "Guiding Principles:", etc.) of "*" bullets, then Color Scheme / Iconography.
  const byName = new Map(mapping.map(m => [m.name, { ...m, epithet: '', tenets: [], colorScheme: '', iconography: '', lore: '' }]));
  // Name headers are matched case-insensitively: the mapping table and the
  // description headers disagree on casing for some devotions (e.g. "The Song In
  // Iron" vs "The Song in Iron").
  const nameAt = line => {
    const t = line.trim();
    const lc = t.toLowerCase();
    for (const m of mapping) {
      const ml = m.name.toLowerCase();
      if (lc === ml) return { name: m.name, epithet: '' };
      if (lc.startsWith(ml + ',')) return { name: m.name, epithet: t.slice(m.name.length + 1).trim() };
    }
    return null;
  };

  // Index the description lines (skip the tab-table region at the top).
  const descStart = section.findIndex((l, i) => !l.startsWith('\t') && nameAt(l) && i > 5);
  let cur = null;
  let mode = 'lore';
  const loreParts = [];
  const commit = () => { if (cur) cur.lore = loreParts.join(' ').trim(); loreParts.length = 0; };

  for (let i = descStart; i >= 0 && i < section.length; i++) {
    const raw = section[i];
    if (raw.startsWith('\t')) continue;
    const t = raw.trim();
    if (!t) continue;

    const hit = nameAt(t);
    if (hit && (!cur || hit.name !== cur.name)) {
      commit();
      cur = byName.get(hit.name);
      if (cur) cur.epithet = hit.epithet;
      mode = 'lore';
      continue;
    }
    if (!cur) continue;

    if (/^(The Truth|Truths|Divine Truths|Divine Demands|Guiding Principles|Guiding Beliefs|Laws|Lessons|Edicts|Codex of the Forge|Church Principles):$/.test(t)) {
      mode = 'tenets';
      continue;
    }
    if (/^Devotion Color Scheme:/.test(t)) { cur.colorScheme = t.replace(/^Devotion Color Scheme:\s*/, '').trim(); mode = 'meta'; continue; }
    if (/^Common Iconography:/.test(t)) { cur.iconography = t.replace(/^Common Iconography:\s*/, '').trim(); mode = 'meta'; continue; }
    if (/^Example Sigil:/.test(t)) { mode = 'meta'; continue; }

    // Bullets are always tenets — the label (Laws:/Lessons:/etc.) is optional and
    // some devotions (e.g. Filian) list tenets with no label at all.
    if (t.startsWith('*')) { cur.tenets.push(t.replace(/^\*\s*/, '').trim()); continue; }
    if (mode === 'lore') loreParts.push(t);
  }
  commit();

  return [...byName.values()];
}

write('devotions.json', parseDevotions());

// ─── DIVINE DOMAINS ───────────────────────────────────────────────────────────
// 16 domains, each a bare domain-name header followed by exactly 3 Domain Powers.
// Power header is "Name - N BP" (an [Adept] tier tag may prefix the name). Powers
// share the class stat-block fields (Call/Target/Duration/Delivery/Accent/Effect).
// Preceding the powers are two tab-tables we also capture: Devotion→Domains and
// Domain→Devotion-Accent.

console.log('\nParsing divine domains...');

const DOMAIN_NAMES = [
  'Chaos', 'Creation', 'Death', 'Destruction', 'Expression', 'Life', 'Light',
  'Knowledge', 'Manipulation', 'Nature', 'Order', 'Peace', 'Protection', 'Shadow', 'War',
];
const isDomainHeader = t => DOMAIN_NAMES.includes(t) || /^Energy:/.test(t);

function parseDomainPowerBlock(blockLines) {
  const header = blockLines[0].trim();
  // "[Adept] Name - N BP" or "Name - N BP"; tier tag may lead.
  const tierMatch = header.match(/\[(\w+)\]/);
  const tier = tierMatch ? tierMatch[1] : null;
  const costMatch = header.match(/-\s*(\d+)\s*BP\s*$/);
  const cost = costMatch ? parseInt(costMatch[1]) : null;
  const name = header
    .replace(/\[\w+\]/, '')
    .replace(/-\s*\d+\s*BP\s*$/, '')
    .trim();

  const { fields, description } = extractStatBlock(blockLines);

  return {
    name, tier, cost,
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
  };
}

function parseDivineDomains() {
  const startIdx = findBodyHeader(/^Divine Domains$/);
  if (startIdx === -1) return { domains: [], accents: {} };
  // Powers end at the Economy section ("Wellspring Economy Overview").
  const endIdx = findIdx(/^Wellspring Economy Overview$/, startIdx);
  const section = lines.slice(startIdx, endIdx === -1 ? lines.length : endIdx);

  // Domain → Devotion Accent table (pairs of tab cells after "Devotion Accent").
  const accents = {};
  const accIdx = section.findIndex(l => /^Divine Domain$/.test(l.trim()));
  if (accIdx !== -1) {
    const accCells = [];
    for (let i = accIdx + 1; i < section.length; i++) {
      const l = section[i];
      if (!l.startsWith('\t')) break;
      const v = l.trim();
      if (!v || v === 'Devotion Accent') continue;
      accCells.push(v);
    }
    for (let i = 0; i + 1 < accCells.length; i += 2) accents[accCells[i]] = accCells[i + 1];
  }

  // Domain power blocks: walk from the first domain header, grouping powers under
  // the current domain. A power block starts at a "... - N BP" header and runs to
  // the next power header or domain header.
  const firstDomain = section.findIndex((l, i) => i > accIdx && !l.startsWith('\t') && isDomainHeader(l.trim()));
  const isPwrHeader = t => /-\s*\d+\s*BP\s*$/.test(t);

  const domains = [];
  let cur = null;
  let block = [];
  const flushBlock = () => {
    if (cur && block.length) cur.powers.push(parseDomainPowerBlock(block));
    block = [];
  };
  const flushDomain = () => { flushBlock(); if (cur) domains.push(cur); };

  for (let i = firstDomain; i >= 0 && i < section.length; i++) {
    const raw = section[i];
    const t = raw.trim();
    if (raw.startsWith('\t')) { if (block.length) block.push(raw); continue; }
    if (!t) { if (block.length) block.push(raw); continue; }

    if (isDomainHeader(t) && !isPwrHeader(t)) {
      flushDomain();
      const name = /^Energy:/.test(t) ? 'Energy' : t;
      cur = { name, label: t, accent: accents[name] || accents[t] || null, powers: [] };
      continue;
    }
    if (isPwrHeader(t)) { flushBlock(); block = [raw]; continue; }
    if (block.length) block.push(raw);
  }
  flushDomain();

  return { domains, accents };
}

const divineDomains = parseDivineDomains();
write('domains.json', divineDomains.domains);

// ─── LINEAGES ─────────────────────────────────────────────────────────────────
// Inline format: Name [Repped] [Required] (LBP): description text

console.log('\nParsing lineages...');

const LINEAGE_NAMES = ['Aewen', 'Chimera', 'Forged', 'Human', 'Lost', 'Oaksworn', 'Ogrim', 'Underkin'];

function parseInlineItems(section) {
  // Item line: "Name [Tag] (LBP): description". Items are grouped under subgroup
  // headers — "General" (available to all) or a named sub-lineage like
  // "Stonewalker" / "People of Silver (Civilization: Streams in Silver)". A
  // header is any non-item, non-structural line; it sets the group for the items
  // that follow, which we record on each item as `sublineage`.
  // Item line: "Name [Tags] (LBP): desc" — also the dash variant "...(LBP) - desc".
  const ITEM_RE = /^(.+?)\s*\((\d+|Variable)\)\s*[:\-]\s*(.+)$/;
  const SKIP = /^(Challenges|Advantages|Costuming|Sub-?[Ll]ineages?|Description|Illustration|Note:|Table of)/;
  // A subgroup header is a short title line: no terminal sentence punctuation,
  // not a power stat-field (Call:/Target:/etc.), not a bracketed power tag. This
  // separates real sub-lineage headers from wrapped descriptions and the inline
  // power stat-blocks that some advantages embed.
  const isHeader = l =>
    l.length <= 60 &&
    !/[.,:]$/.test(l) &&
    !/^(Call|Target|Duration|Delivery|Refresh|Accent|Effect|Incantation|Requirement|Prerequisites?):/.test(l) &&
    !/\[(Lineage|Repped|Required)\]/.test(l) &&
    !/:/.test(l.replace(/\(Civilization:[^)]*\)/, '')); // allow only the civ-note colon

  const items = [];
  let group = 'General';

  for (const line of section) {
    const l = line.trim();
    if (!l || SKIP.test(l)) continue;

    const m = l.match(ITEM_RE);
    if (m) {
      const fullName = m[1].trim();
      const required = /\[Required\]/i.test(fullName);
      const repped = /\[Repped\]/i.test(fullName);
      const name = fullName
        .replace(/\s*\[Required\]/gi, '')
        .replace(/\s*\[Repped\]/gi, '')
        .replace(/\s*\[Requires[^\]]*\]/gi, '')
        .trim();
      const lbp = m[2] === 'Variable' ? null : parseInt(m[2]);
      items.push({ name, lbp, required, repped, sublineage: group, description: m[3].trim() });
    } else if (isHeader(l)) {
      group = l;
    }
    // Otherwise: a wrapped description or embedded stat-line — ignore for grouping.
  }
  return items;
}

function parseLineages() {
  // Find the "Lineages (All)" section which has the actual lineage content
  const LINEAGES_ALL_IDX = findIdx(/^Lineages \(All\)$/);
  const lineages = [];

  for (let li = 0; li < LINEAGE_NAMES.length; li++) {
    const name = LINEAGE_NAMES[li];
    const nextName = LINEAGE_NAMES[li + 1];

    // The TOC lists each lineage name once; the actual content section repeats the name.
    // Skip the first occurrence (TOC) by searching for the second match.
    const firstOccurrence = findIdx(new RegExp(`^${name}$`), LINEAGES_ALL_IDX);
    const startIdx = findIdx(new RegExp(`^${name}$`), firstOccurrence + 1);
    if (startIdx === -1) { console.warn(`  ${name}: not found`); continue; }

    const endIdx = nextName
      ? findIdx(new RegExp(`^${nextName}$`), startIdx + 1)
      : findIdx(/^(Advanced Classes|Devotions & Divine|Skills,|Champion)/, startIdx + 1);

    const section = lines.slice(startIdx + 1, endIdx === -1 ? startIdx + 700 : endIdx);

    // Description
    const descIdx = section.findIndex(l => /^Description$/.test(l.trim()));
    const descStop = section.findIndex((l, i) => i > descIdx && /^(Sub-?[Ll]ineages?|Costuming|Challenges)/.test(l.trim()));
    const descLines = [];
    for (let i = (descIdx === -1 ? 0 : descIdx + 1); i < (descStop === -1 ? 30 : descStop); i++) {
      const l = section[i]?.trim();
      if (l && !/^(Description|".*")/.test(l)) descLines.push(l);
    }

    // Costume
    const costumeLine = section.find(l => /^Costuming (Challenge|Requirement|Difficulty)?:?/.test(l.trim()));
    const costume = costumeLine ? costumeLine.trim().replace(/^Costuming.*?:\s*/i, '').trim() : '';

    // Challenges
    const chalIdx = section.findIndex(l => /^Challenges$/.test(l.trim()));
    const chalStop = section.findIndex((l, i) => i > chalIdx && /^Advantages$/.test(l.trim()));
    const challenges = chalIdx !== -1
      ? parseInlineItems(section.slice(chalIdx + 1, chalStop === -1 ? undefined : chalStop))
      : [];

    // Advantages
    const advIdx = section.findIndex(l => /^Advantages$/.test(l.trim()));
    const advantages = advIdx !== -1
      ? parseInlineItems(section.slice(advIdx + 1))
      : [];

    // Sub-lineages are the distinct non-"General" groups that the challenge and
    // advantage items fall under. A group name may carry a civ note in parens,
    // e.g. "People of Silver (Civilization: Streams in Silver)".
    // Dedup by base name (a sub-lineage can appear under both Challenges and
    // Advantages, sometimes with the civ-note on only one occurrence — keep the
    // noted variant).
    const byName = new Map();
    for (const it of [...challenges, ...advantages]) {
      const g = it.sublineage;
      if (g === 'General') continue;
      const m = g.match(/^([^(]+?)(?:\s*\((.+)\))?$/);
      const sub = { name: (m ? m[1] : g).trim(), note: m && m[2] ? m[2].trim() : '' };
      const existing = byName.get(sub.name);
      if (!existing || (!existing.note && sub.note)) byName.set(sub.name, sub);
    }
    const sublineages = [...byName.values()];

    lineages.push({ name, description: descLines.join(' '), costume, sublineages, challenges, advantages });
  }

  return lineages;
}

write('lineages.json', parseLineages());

// ─── LEVEL TABLE ──────────────────────────────────────────────────────────────
// Parsed from the Core Rules "Level Progression Table" (one cell per line):
// columns Level, Total XP, Base BP, LP, Spikes. Ends at "Level Floor".

console.log('\nParsing level table...');

function parseLevelTable() {
  // "Level Progression Table" appears in the Core Rules nested TOC before the
  // actual body table; skip past that.
  const start = findBodyHeader(/^Level Progression Table$/, PAST_CORE_RULES_TOC);
  if (start === -1) return [];
  const nums = [];
  for (let i = start + 1; i < start + 120; i++) {
    const t = lines[i].trim();
    if (/^Level Floor$/.test(t)) break;
    if (/^\d+$/.test(t)) nums.push(parseInt(t));
  }
  const rows = [];
  for (let i = 0; i + 4 < nums.length; i += 5) {
    rows.push({ level: nums[i], xp: nums[i + 1], bp: nums[i + 2], lp: nums[i + 3], spikes: nums[i + 4] });
  }
  return rows;
}

write('level-table.json', parseLevelTable());

// ─── CRAFTING RECIPES ─────────────────────────────────────────────────────────
// Each recipe is a header "Name [<Tier> <Discipline> Recipe|Formula|Schematic]"
// followed by "Label: value" fields. Most fields are one line; Crafting Process,
// Effect and Description run across multiple lines until the next field or recipe.
// Tier and discipline come from the header tag. Fields vary by discipline (Alchemy
// has Application; Enchanting/Tinkering have Type and ritual-style sub-steps), so
// we collect fields generically into a map and surface the common ones explicitly.

console.log('\nParsing crafting recipes...');

// A recipe header may carry extra trailing tags after the recipe tag, e.g.
// "... [Greater Alchemy Recipe] [BLOOD MAGIC]".
const RECIPE_HEADER = /^(.+?)\s*\[(Apprentice|Journeyman|Greater)\s+(Alchemy|Enchanting|Tinkering)\s+(Recipe|Formula|Schematic)\]((?:\s*\[[^\]]+\])*)\s*$/;
// Field labels that begin a new field within a recipe.
const RECIPE_FIELD = /^(Crafting Materials Needed|Crafting Materials|Uses per Batch|Expiration|Application|Type|Ritualists|Total Participants|Dark Territory Required|Dark Territory Suit|Reality Tear|Requirements|Crafting Process|Description|Effect|Note|IMPORTANT|Circle of Sacrifice|Circle of Empowerment|Circle of Assignment|Rune Circle):\s*(.*)$/;
const FIELD_KEY = {
  'Crafting Materials Needed': 'materials',
  'Crafting Materials': 'materials',
  'Uses per Batch': 'usesPerBatch',
  'Expiration': 'expiration',
  'Application': 'application',
  'Type': 'type',
  'Ritualists': 'ritualists',
  'Total Participants': 'totalParticipants',
  'Dark Territory Required': 'darkTerritoryRequired',
  'Dark Territory Suit': 'darkTerritorySuit',
  'Crafting Process': 'process',
  'Description': 'description',
  'Effect': 'effect',
  'Note': 'note',
};

function parseCraftingRecipes() {
  const startIdx = findBodyHeader(/^Apprentice Alchemy Recipes$/);
  const endIdx = findIdx(/^Rituals$/, startIdx);
  const section = lines.slice(startIdx, endIdx === -1 ? lines.length : endIdx);

  // Split into recipe blocks anchored on recipe headers. A tier section header
  // ("Journeyman Alchemy Recipes" etc.) ends the current block without starting a
  // new one — otherwise it would leak into the last recipe's trailing field.
  const SECTION_HEADER = /^(Apprentice|Journeyman|Greater)\s+(Alchemy|Enchanting|Tinkering)\s+(Recipes|Formulae|Schematics)$/;
  const blocks = [];
  let cur = null;
  for (const line of section) {
    const t = line.trim();
    if (RECIPE_HEADER.test(t)) { if (cur) blocks.push(cur); cur = [t]; }
    else if (SECTION_HEADER.test(t) || t === '________________') { if (cur) { blocks.push(cur); cur = null; } }
    else if (cur) cur.push(t);
  }
  if (cur) blocks.push(cur);

  return blocks.map(block => {
    const h = block[0].match(RECIPE_HEADER);
    const extraTags = [...(h[5] || '').matchAll(/\[([^\]]+)\]/g)].map(m => m[1].trim());
    const recipe = {
      name: h[1].trim(),
      discipline: h[3],
      tier: h[2],
      tags: extraTags,
      materials: null, usesPerBatch: null, expiration: null, application: null,
      type: null, process: '', description: '', effect: '', fields: {},
    };

    let curField = null;            // current known field key being appended to
    let curRaw = null;              // current raw label (for the generic fields map)
    let inProcess = false;          // inside the Crafting Process region
    const append = (key, text) => { recipe.fields[key] = (recipe.fields[key] ? recipe.fields[key] + ' ' : '') + text; };
    const addTo = (key, text) => { recipe[key] = recipe[key] ? recipe[key] + ' ' + text : text; };

    for (let i = 1; i < block.length; i++) {
      const t = block[i];
      if (!t) continue;
      const m = t.match(RECIPE_FIELD);
      if (m) {
        const label = m[1];
        curRaw = label;
        curField = FIELD_KEY[label] || null;
        // Description/Effect end the process region; Note inside it does not.
        if (label === 'Crafting Process') inProcess = true;
        else if (label === 'Description' || label === 'Effect') inProcess = false;
        const val = m[2].trim();
        if (curField && curField in recipe && curField !== 'fields') addTo(curField, val);
        if (val) append(label, val);
      } else if (curRaw) {
        // Continuation line. Bare prose in the process region belongs to the
        // process even when it follows a Note: constraint line.
        if (inProcess && curField !== 'process') addTo('process', t);
        else if (curField && curField in recipe) addTo(curField, t);
        append(curRaw, t);
      }
    }

    // Enchanting recipes express the process as labeled sub-steps (Circle of
    // Sacrifice / Empowerment / Assignment, Rune Circle) instead of a single
    // "Crafting Process" field. When there's no standalone process, assemble one
    // from those steps in their canonical order.
    if (!recipe.process) {
      const steps = ['Circle of Sacrifice', 'Circle of Empowerment', 'Circle of Assignment', 'Rune Circle']
        .filter(k => recipe.fields[k])
        .map(k => `${k}: ${recipe.fields[k]}`);
      if (steps.length) recipe.process = steps.join(' ');
    }
    return recipe;
  });
}

write('crafting-recipes.json', parseCraftingRecipes());

// ─── RITUALS ──────────────────────────────────────────────────────────────────
// The ritual list (after the Dark Territory rules preamble) is uniform: a header
// "Name [<Tier> Ritual]" then a fixed set of "Label: value" fields, with Ritual
// Process running multi-line. Same field-block shape as crafting recipes.

console.log('\nParsing rituals...');

const RITUAL_HEADER = /^(.+?)\s*\[(Apprentice|Journeyman|Greater)\s+Ritual\]\s*$/;
const RITUAL_FIELD = /^(Summary|Required Components|Ritualists|Total Participants|Expiration|Targets?|Tools Used|Location|Other Requirements|Dark Territory Marshal Required|Dark Territory Suit|Category|Effect|Ritual Process|Note):\s*(.*)$/;
const RITUAL_KEY = {
  'Summary': 'summary',
  'Required Components': 'components',
  'Ritualists': 'ritualists',
  'Total Participants': 'totalParticipants',
  'Expiration': 'expiration',
  'Target': 'targets',
  'Targets': 'targets',
  'Tools Used': 'tools',
  'Location': 'location',
  'Other Requirements': 'otherRequirements',
  'Dark Territory Marshal Required': 'darkTerritoryMarshal',
  'Dark Territory Suit': 'darkTerritorySuit',
  'Effect': 'effect',
  'Ritual Process': 'process',
  'Note': 'note',
};

// Split a section into header-anchored blocks, parse each into a record of known
// fields. Multi-line fields accumulate continuation lines until the next label.
// stopRe lines (sub-section headers, dividers) end the current block without
// starting a new one, so they don't leak into the last entry's trailing field.
function parseFieldBlocks(section, headerRe, fieldRe, keyMap, baseFields, stopRe = null) {
  const blocks = [];
  let cur = null;
  for (const line of section) {
    const t = line.trim();
    if (headerRe.test(t)) { if (cur) blocks.push(cur); cur = [t]; }
    else if (stopRe && stopRe.test(t)) { if (cur) { blocks.push(cur); cur = null; } }
    else if (cur) cur.push(t);
  }
  if (cur) blocks.push(cur);

  return blocks.map(block => {
    const h = block[0].match(headerRe);
    const rec = baseFields(h);
    let key = null;
    for (let i = 1; i < block.length; i++) {
      const t = block[i];
      if (!t) continue;
      const m = t.match(fieldRe);
      if (m) {
        key = keyMap[m[1]] || null;
        if (key) rec[key] = rec[key] ? rec[key] + ' ' + m[2].trim() : m[2].trim();
      } else if (key) {
        rec[key] = rec[key] ? rec[key] + ' ' + t : t;
      }
    }
    return rec;
  });
}

function parseRituals() {
  const startIdx = findBodyHeader(/^Apprentice Rituals$/);
  const endIdx = lines.findIndex((l, i) => i > findIdx(/^Greater Rituals$/, startIdx) && /^________________$/.test(l.trim()));
  const section = lines.slice(startIdx, endIdx === -1 ? lines.length : endIdx);

  const stopRe = /^(Apprentice|Journeyman|Greater) Rituals$|^________________$/;
  return parseFieldBlocks(section, RITUAL_HEADER, RITUAL_FIELD, RITUAL_KEY, h => ({
    name: h[1].trim(),
    tier: h[2],
    summary: '', components: null, ritualists: null, totalParticipants: null,
    expiration: null, targets: null, tools: null, location: null,
    otherRequirements: null, darkTerritoryMarshal: null, effect: '', process: '',
  }), stopRe);
}

write('ritual-recipes.json', parseRituals());

// ─── CORE RULES ───────────────────────────────────────────────────────────────
// The Core Rules doc is prose under nested headers. Its own Table of Contents
// lists every section title, which we use as a header whitelist to split the body
// into { heading, content } chunks. The Glossary/Index is pulled out separately
// as clean "Term: definition" entries.

console.log('\nParsing core rules...');

function parseCoreRules() {
  const tocIdx = findIdx(/^Table of Contents$/, findIdx(/^Wellspring - Core Rules$/) - 1);
  // Each section title appears twice: once in the TOC, then again as the body
  // header. The TOC is a contiguous run of short title lines ending where the
  // body begins (the SECOND "Introduction"). Find that to bound the TOC and to
  // mark the body start.
  const tocIntro = findIdx(/^Introduction$/, tocIdx);          // TOC entry
  const bodyStart = findIdx(/^Introduction$/, tocIntro + 1);   // body header
  const glossIdx = findIdx(/^Glossary\/Index$/, bodyStart);    // body glossary header
  const endIdx = findIdx(/^Wellspring Setting Start Guide$/, glossIdx);

  // TOC entries: from "Table of Contents" up to the body start.
  const toc = [];
  for (let i = tocIdx + 1; i < bodyStart; i++) {
    const t = lines[i].trim();
    if (t) toc.push(t);
  }

  // (1) Prose sections. The body repeats the TOC titles in order, so we consume
  // the TOC as an ordered queue: a line only starts a new section if it matches
  // an upcoming TOC title (searched within a small look-ahead window). This
  // rejects body lines that coincidentally equal a title out of order — e.g. a
  // "Spikes" column header inside the Level Progression Table, which would
  // otherwise be mistaken for the much-later "Spikes" section. We also record
  // the source line range per section so a sub-concept walker can find them.
  const sections = [];
  const promotedToSection = new Set(); // TOC entries that became top-level sections
  let cur = null;
  let tp = 0; // pointer into toc
  for (let i = bodyStart; i < glossIdx; i++) {
    const t = lines[i].trim();
    if (!t || t === '________________') continue;

    let matchAt = -1;
    for (let k = tp; k < Math.min(tp + 4, toc.length); k++) {
      if (toc[k] === t) { matchAt = k; break; }
    }
    if (matchAt !== -1) {
      if (cur) { cur.endLine = i - 1; sections.push(cur); }
      cur = { heading: t, content: '', startLine: i, endLine: glossIdx - 1 };
      promotedToSection.add(t);
      tp = matchAt + 1;
    } else if (cur) {
      cur.content += (cur.content ? ' ' : '') + t;
    }
  }
  if (cur) sections.push(cur);

  // Second pass: any TOC entry not promoted to a top-level section is a child
  // of the nearest preceding promoted entry. This derives the parent→children
  // map from the doc structure rather than hardcoding it.
  const tocChildren = {};
  let lastParent = null;
  for (const entry of toc) {
    if (promotedToSection.has(entry)) {
      lastParent = entry;
    } else if (lastParent) {
      (tocChildren[lastParent] ??= []).push(entry);
    }
  }

  // (2) Glossary: "Term: definition" lines.
  const glossary = [];
  for (let i = glossIdx + 1; i < (endIdx === -1 ? lines.length : endIdx); i++) {
    const t = lines[i].trim();
    if (!t || t === '________________') continue;
    const m = t.match(/^([A-Z][A-Za-z '/-]{1,40}?):\s+(.+)$/);
    if (m) glossary.push({ term: m[1].trim(), definition: m[2].trim() });
    else if (glossary.length) {
      // Wrapped continuation of the previous definition.
      glossary[glossary.length - 1].definition += ' ' + t;
    }
  }

  return { sections, glossary, tocChildren };
}

const coreRules = parseCoreRules();
write('core-rules.json', coreRules.sections);
write('glossary.json', coreRules.glossary);
console.log('\nDerived TOC parent→children:');
for (const [parent, children] of Object.entries(coreRules.tocChildren)) {
  console.log(' ', parent, '->', children);
}

// ─── EFFECTS / CONDITIONS / TYPES ─────────────────────────────────────────────
// The Core Rules Effects, Conditions, and Types sections are keyword lists in the
// source: "Keyword\nDefinition…" separated by blank lines. These keywords (Wounding,
// Slept, Discern, Berserk, …) are the dense mechanical vocabulary referenced all
// over skill/power text, so we extract them as first-class entities to link against.
// A keyword may carry a bracketed parameter, e.g. "Discern [Information]" — the
// entity name is the stem ("Discern"); the bracket is kept as `param`.

console.log('\nParsing effects / conditions / types...');

function parseKeywordList(headerRe, endRe) {
  // Effects/Conditions/Types also appear as bare entries in the Core Rules
  // nested TOC, so we need to skip past that to reach the keyword-list body.
  const start = findBodyHeader(headerRe, PAST_CORE_RULES_TOC);
  if (start === -1) return [];
  const end = findIdx(endRe, start + 1);
  // Skip the intro sentence ("The following is a list of…").
  const body = lines.slice(start + 1, end === -1 ? start + 400 : end);

  const entries = [];
  let i = 0;
  // Advance past the intro line(s) to the first blank-separated block.
  while (i < body.length && body[i].trim() && !/^[A-Z]/.test(body[i].trim())) i++;

  // The canonical entity name is the leading keyword stem before any bracketed
  // parameter (so "Grant [Number] Barrier" and "Grant [Accent]" both belong to
  // "Grant"; "Vulnerable to" -> "Vulnerable"). The full source form is kept as a
  // variant. Variants of the same stem are merged into one entity.
  // A keyword line is short, starts with a capital or "[", and has no sentence
  // punctuation. Definition lines are prose. We use this to start a new entry
  // even when the source omits the blank-line separator between two entries
  // (e.g. Insubstantial's multi-line def runs straight into "Obedient").
  const isKeywordLine = (t) =>
    t && t.length <= 45 && /^[A-Z[]/.test(t) && !/[.!?:),]$/.test(t) && !/^The\s/.test(t);

  const byName = new Map();
  while (i < body.length) {
    while (i < body.length && !body[i].trim()) i++;
    if (i >= body.length) break;
    const keyword = body[i].trim();
    i++;
    // Definition: following non-blank lines until a blank OR the next keyword.
    const def = [];
    while (i < body.length && body[i].trim() && !isKeywordLine(body[i].trim())) { def.push(body[i].trim()); i++; }
    if (!def.length) continue;

    // Stem = the keyword without bracketed parameters (leading or inline) and
    // trailing connective words. "Grant [Number] Barrier" -> "Grant";
    // "[Kind] Immunity" -> "Immunity"; "Vulnerable to" -> "Vulnerable".
    const stem = keyword
      .replace(/^\[[^\]]+\]\s*/, '')   // drop a leading [param]
      .replace(/\s*\[.*$/, '')          // drop from the first inline [param] on
      .replace(/\s+(to|or|vs\.?|Plus)\s*$/i, '')
      .trim() || keyword;

    if (!byName.has(stem)) {
      byName.set(stem, { name: stem, variants: [], description: def.join(' ') });
    }
    const entry = byName.get(stem);
    // Record the full source form when it differs from the bare stem.
    if (keyword !== stem) entry.variants.push({ form: keyword, description: def.join(' ') });
  }

  // Derive the effect→condition relationship the doc states in each definition
  // ("Causes the Charmed Condition"). This makes the edge rebuildable from the
  // source rather than hand-encoded downstream.
  for (const entry of byName.values()) {
    const m = entry.description.match(/(?:causes?|applies|grants?|inflicts?) the (\w[\w '-]*?) condition/i);
    if (m) entry.causesCondition = m[1].trim();
  }

  return [...byName.values()];
}

// The intro sentence ends with a period so the keyword-walk skips it; the first
// real keyword (e.g. "Berserk") begins the list.
write('effects.json', parseKeywordList(/^Effects$/, /^Stacking Effects$/));
write('conditions.json', parseKeywordList(/^Conditions$/, /^Types$/));
write('types.json', parseKeywordList(/^Types$/, /^Items$/));

// ─── CRAFTING RESOURCES ──────────────────────────────────────────────────────
// Source format: "Name (Tier)\nDescription" pairs in the Crafting Resources
// List section. Tier is Basic / Uncommon / Advanced. The list ends at "Named
// Resources".

console.log('\nParsing crafting resources...');

function parseResources() {
  const start = findBodyHeader(/^Crafting Resources List$/, PAST_CORE_RULES_TOC);
  if (start === -1) return [];
  const end = findIdx(/^Named Resources$/, start + 1);
  const body = lines.slice(start + 1, end === -1 ? start + 50 : end);

  const out = [];
  for (let i = 0; i < body.length; i++) {
    const t = body[i].trim();
    if (!t) continue;
    const m = t.match(/^(.+?)\s*\((Basic|Uncommon|Advanced)\)\s*$/);
    if (!m) continue;
    // Description: next non-blank line(s) until blank or next keyword line.
    const def = [];
    let j = i + 1;
    while (j < body.length && body[j].trim() && !/\((Basic|Uncommon|Advanced)\)$/.test(body[j].trim())) {
      def.push(body[j].trim());
      j++;
    }
    out.push({ name: m[1].trim(), tier: m[2], description: def.join(' ') });
    i = j - 1;
  }
  return out;
}

write('resources.json', parseResources());

// ─── ACCENTS ─────────────────────────────────────────────────────────────────
// 15 accents in the Core Rules Accent section. Each line: "Name [Elemental] - desc.
// The list starts after "The known Accents that exist in Wellspring are:" and
// ends at "Defense Calls".

console.log('\nParsing accents...');

function parseAccents() {
  const intro = findIdx(/^The known Accents that exist in Wellspring are:/);
  if (intro === -1) return [];
  const end = findIdx(/^Defense Calls$/, intro + 1);
  const out = [];
  for (let i = intro + 1; i < end; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    // "Acid [Elemental] - Caustic substances..." or "Force - Physical power..."
    const m = t.match(/^(.+?)(?:\s*(\[Elemental\]))?\s*-\s*(.+)$/);
    if (!m) continue;
    out.push({
      name: m[1].trim(),
      elemental: !!m[2],
      description: m[3].trim(),
    });
  }
  return out;
}

write('accents.json', parseAccents());

// ─── DEFENSE CALLS & MODIFIERS ───────────────────────────────────────────────
// Same keyword-list pattern as Effects/Conditions/Types (Name\nDefinition).

console.log('\nParsing defense calls / modifiers...');
write('defense-calls.json', parseKeywordList(/^Defense Calls$/, /^Modifiers$/));
write('modifiers.json', parseKeywordList(/^Modifiers$/, /^Combat Rules$/));

// ─── CRAFTING CONCEPTS ───────────────────────────────────────────────────────
// Each crafting discipline (Alchemy / Enchanting / Tinkering) has a cluster of
// structural sub-sections defined between the discipline header and its first
// recipe list (e.g. "The Hermetic Laboratory" / "Corrupted Alchemy" /
// "Mana Sickness" under Alchemy; "Essences" / "Drawing" / "Unravelling Essence"
// / "The Enchanting Forge" under Enchanting). These read as terms in body text
// but only get described in the prose. Extract them as discrete entities so
// references resolve.
//
// Each entry: { name, discipline, description, tools? (when an equipment list
// follows) }. Filters out recipe field-label sub-sections (Application/Quaff/
// Topical/Ingest/Component) which are already captured per-recipe.

console.log('\nParsing crafting concepts...');

const RECIPE_FIELD_LABELS = new Set([
  'Application', 'Quaff', 'Topical', 'Ingest', 'Component',
  'Crafting Materials', 'Uses Per Batch', 'Expiration', 'Crafting Process',
  'Description', 'Effect', 'Recipes/Formulae/Schematics', 'Introduction',
  'Turn of the Hourglass', 'Item Cards', 'Ashbin', 'Dark Territory',
  'Crafting Resources List', 'Named Resources',
  // Per-discipline parent headers
  'Alchemy', 'Enchanting', 'Tinkering',
]);

function parseCraftingConcepts() {
  const out = [];
  // Each discipline's concept-sub-sections live between its body header and the
  // start of its first recipe list. The discipline headers also appear in the
  // Crafting table-of-contents (~lines 14412-14415), so we chain searches: find
  // each discipline's body header by walking forward from the *previous*
  // discipline's recipe list (or from "Named Resources" for the first).
  const disciplines = [
    { name: 'Alchemy', start: /^Alchemy$/, end: /^Apprentice Alchemy Recipes$/, after: /^Named Resources$/ },
    { name: 'Enchanting', start: /^Enchanting$/, end: /^Apprentice Enchanting Formulae$/, after: /^Apprentice Alchemy Recipes$/ },
    { name: 'Tinkering', start: /^Tinkering$/, end: /^Apprentice Tinkering Schematics$/, after: /^Apprentice Enchanting Formulae$/ },
  ];

  const isHeader = (t) => t && t.length <= 50 && !/[.!?:),]\s*$/.test(t) && !/^\*/.test(t) && !/^[a-z]/.test(t) && !/[\[\]]/.test(t);

  for (const d of disciplines) {
    const afterIdx = findIdx(d.after, PAST_CORE_RULES_TOC);
    if (afterIdx === -1) continue;
    const s = findIdx(d.start, afterIdx + 1);
    if (s === -1) continue;
    const e = findIdx(d.end, s + 1);
    if (e === -1) continue;

    for (let i = s + 1; i < e; i++) {
      const t = lines[i].trim();
      if (!isHeader(t) || RECIPE_FIELD_LABELS.has(t)) continue;
      // Look at the next non-blank line — must be prose (long sentence), not a
      // bullet or another header. That distinguishes real concept-sections from
      // mis-classified lines.
      let j = i + 1;
      while (j < e && !lines[j].trim()) j++;
      if (j >= e) continue;
      const nextLine = lines[j].trim();
      if (nextLine.length < 30 || /^\*/.test(nextLine) || isHeader(nextLine) && !RECIPE_FIELD_LABELS.has(nextLine)) continue;

      // Capture description (prose lines) and any bullet list that follows.
      const descLines = [];
      const tools = [];
      let k = j;
      while (k < e) {
        const line = lines[k].trim();
        if (!line) { k++; continue; }
        if (/^\*/.test(line)) {
          tools.push(line.replace(/^\*\s*/, '').trim());
          k++; continue;
        }
        // Stop if we hit the next header.
        if (isHeader(line) && !RECIPE_FIELD_LABELS.has(line)) break;
        descLines.push(line);
        k++;
      }
      const concept = {
        name: t,
        discipline: d.name,
        description: descLines.join(' '),
      };
      if (tools.length) concept.tools = tools;
      out.push(concept);
      i = k - 1;
    }
  }
  return out;
}

write('crafting-concepts.json', parseCraftingConcepts());

// ─── RITUAL CONCEPTS ─────────────────────────────────────────────────────────
// The Rituals body (before the ritual list itself) defines roles (Ritualists,
// Primary/Secondary Ritualist, Participant), the Dark Territory process
// (Beginning the Ritual, Ritual Points, Potential Success, The Deck and its
// suits), and other structural concepts (Arcane Matrix, Consecrated/Desecrated
// locations). These are referenced throughout ritual descriptions; extract
// them so the links resolve.

console.log('\nParsing ritual concepts...');

// Field labels that are part of a per-ritual definition (already captured via
// rituals.json), not standalone concepts.
const RITUAL_FIELD_LABELS = new Set([
  'Expiration', 'Target', 'Required Components', 'Tools Used',
  'Other Requirements', 'Location', 'Effect', 'Ritual Process',
  'Dark Territory', 'Dark Territory Suit', 'Dark Territory Marshal Required',
]);

function parseRitualConcepts() {
  const start = findIdx(/^Rituals$/, PAST_CORE_RULES_TOC);
  if (start === -1) return [];
  const end = findIdx(/^Apprentice Rituals$/, start + 1);
  if (end === -1) return [];

  const isHeader = (t) => t && t.length <= 50 && !/[.!?:),]\s*$/.test(t) && !/^\*/.test(t) && !/^[a-z]/.test(t) && !/[\[\]]/.test(t);

  const out = [];
  for (let i = start + 1; i < end; i++) {
    const t = lines[i].trim();
    if (!isHeader(t) || RITUAL_FIELD_LABELS.has(t)) continue;
    let j = i + 1;
    while (j < end && !lines[j].trim()) j++;
    if (j >= end) continue;
    const nextLine = lines[j].trim();
    if (nextLine.length < 30 || /^\*/.test(nextLine)) continue;
    if (isHeader(nextLine) && !RITUAL_FIELD_LABELS.has(nextLine)) continue;

    const descLines = [];
    const bullets = [];
    let k = j;
    while (k < end) {
      const line = lines[k].trim();
      if (!line) { k++; continue; }
      if (/^\*/.test(line)) {
        bullets.push(line.replace(/^\*\s*/, '').trim());
        k++; continue;
      }
      if (isHeader(line) && !RITUAL_FIELD_LABELS.has(line)) break;
      descLines.push(line);
      k++;
    }
    const concept = { name: t, description: descLines.join(' ') };
    if (bullets.length) concept.bullets = bullets;
    out.push(concept);
    i = k - 1;
  }
  return out;
}

write('ritual-concepts.json', parseRitualConcepts());

// ─── CORE RULES SUB-CONCEPTS ─────────────────────────────────────────────────
// Each Core Rules top-level section has nested sub-headers (Header\nProse) that
// the original parseCoreRules flattened into one prose blob per section. Carve
// them out as discrete entities so they can participate in the linker graph.
// Sections already carved out (Effects, Conditions, Types, Modifiers, Defense
// Calls, Accent, Glossary) are skipped. Policy/etiquette sections are skipped.
// The remaining sub-concepts route to typed files (deliveries.json, durations.json,
// etc.) where they form a coherent cluster, or to rules-concepts.json otherwise.

console.log('\nParsing core rules sub-concepts...');

// Section title -> target entity type. Sections not in this map send their
// sub-concepts to rules-concepts.json. SKIP suppresses extraction entirely.
//
// Some sections in the doc TOC are *themselves* sub-concepts of an earlier
// parent section (the TOC happens to be flat, but the doc semantically groups
// them). For those, we route the whole section's body — heading + prose —
// directly into the parent's typed bucket via the AS_SELF marker, so e.g.
// "Hold!"/Caution/Clarify each become power-words entities.
const SECTION_TO_TYPE = {
  // Already carved out as their own entity files; skip to avoid duplication.
  'Effects': 'SKIP', 'Conditions': 'SKIP', 'Types': 'SKIP',
  'Modifiers': 'SKIP', 'Defense Calls': 'SKIP', 'Accent': 'SKIP',
  // Policy / etiquette — not navigable game mechanics; skip.
  'Code of Conduct': 'SKIP', 'Consent and Calibration': 'SKIP',
  'Combat Etiquette': 'SKIP', 'Roleplay Etiquette': 'SKIP',
  // New typed clusters whose own bodies have sub-headers worth extracting.
  'Delivery': 'deliveries',
  'Duration': 'durations',
  'Death and Dying': 'death-states',
  'Armor Points': 'armor-types',
  'Object and Location Markers': 'markers',
  'Spellcasting': 'spellcasting-concepts',
};

// Parent sections that have TOC-sibling children. The walker enters the parent's
// context when it sees the parent heading; subsequent sections become AS_SELF
// children of that parent (routed whole to the parent's type bucket) until
// either another parent appears or we hit a non-child (e.g. "Object and
// Location Markers" terminates "Game Markers and Signals" children). This
// position-based grouping correctly handles duplicate child names like
// "Clarify" appearing under both Power Words and Game Markers.
const AS_SELF_PARENTS = new Map([
  ['Power Words and Power Phrases', {
    type: 'power-words',
    children: new Set(['“Hold!”', 'Caution', 'Clarify', 'Instruction',
      'It Has Been Told…', 'It Can Be Seen…', 'It Can Be Believed…',
      '“What Would Your Mother Say?”', '“Prepare for Action”']),
  }],
  ['Game Markers and Signals', {
    type: 'game-markers',
    children: new Set(['Out-of-Game', 'Non-Combatant', 'Clarify', 'Lookdown',
      'OK Check', 'Spirit Form']),
  }],
]);

// Sub-header detection inside a section's source range: short, title-case, no
// terminal punctuation, no brackets, followed by prose. Matches both bare names
// ("Berserk") and quoted phrases ("“Hold!”").
function isSubHeader(t, nextLine) {
  if (!t || t.length > 50) return false;
  if (/[.!?,):]\s*$/.test(t)) return false;
  if (/^\*/.test(t) || /[\[\]]/.test(t)) return false;
  if (/^[a-z0-9]/.test(t)) return false;
  return nextLine && nextLine.length > 30 && !/^\*/.test(nextLine);
}

function parseSubConcepts(sections) {
  // bucketsByType: { 'rules-concepts': [...], 'deliveries': [...], ... }
  const bucketsByType = {};
  const push = (type, entry) => { (bucketsByType[type] ??= []).push(entry); };
  // Track which AS_SELF parent we're currently inside (so duplicate child
  // names like "Clarify" route to the right type based on position).
  let asSelfParent = null;

  for (let s = 0; s < sections.length; s++) {
    const section = sections[s];

    // Entering an AS_SELF parent? Set the context (and also extract its body as
    // an introductory entry into the parent's bucket).
    if (AS_SELF_PARENTS.has(section.heading)) {
      asSelfParent = AS_SELF_PARENTS.get(section.heading);
      if (section.content.trim()) {
        push(asSelfParent.type, { name: section.heading, section: section.heading, description: section.content });
      }
      continue;
    }
    // Inside an AS_SELF parent and this section is one of its children?
    if (asSelfParent && asSelfParent.children.has(section.heading)) {
      push(asSelfParent.type, {
        name: section.heading.replace(/^[“"]+|[”"]+$/g, '').trim(),
        section: section.heading,
        description: section.content,
      });
      continue;
    }
    // Any other section ends the AS_SELF parent context.
    asSelfParent = null;

    const target = SECTION_TO_TYPE[section.heading];
    if (target === 'SKIP') continue;
    const bucket = target || 'rules-concepts';

    // Walk the source range for this section. Use the *next* section's start
    // line as the exclusive end so a sub-concept whose body falls in the gap
    // immediately before the next top-level section (e.g. Roleplay Delivery is
    // the last sub-header in Delivery, and its body line is one before the
    // Duration section starts) is still captured.
    const sectionEnd = sections[s + 1]?.startLine ?? (section.endLine + 1);
    let i = section.startLine + 1;
    while (i < sectionEnd) {
      const t = lines[i].trim();
      if (!t) { i++; continue; }
      // Skip any nested header that IS the section heading itself (e.g. "Effects"
      // section header repeating inside).
      if (t === section.heading) { i++; continue; }
      let nextI = i + 1;
      while (nextI < sectionEnd && !lines[nextI].trim()) nextI++;
      const nextLine = lines[nextI]?.trim() || '';
      if (!isSubHeader(t, nextLine)) { i++; continue; }
      // Capture sub-concept body: lines until the next sub-header or end.
      const descLines = [];
      let j = nextI;
      while (j < sectionEnd) {
        const lt = lines[j].trim();
        if (!lt) { j++; continue; }
        let nj = j + 1;
        while (nj < sectionEnd && !lines[nj].trim()) nj++;
        const nl = lines[nj]?.trim() || '';
        if (isSubHeader(lt, nl) && lt !== section.heading) break;
        descLines.push(lt);
        j++;
      }
      push(bucket, {
        name: t,
        section: section.heading,
        description: descLines.join(' '),
      });
      i = j;
    }
  }
  return bucketsByType;
}

const subConcepts = parseSubConcepts(coreRules.sections);
// Write each typed bucket to its own file. Order is fixed so reruns are stable.
for (const [type, entries] of Object.entries(subConcepts).sort(([a], [b]) => a.localeCompare(b))) {
  write(`${type}.json`, entries);
}

console.log('\nDone.');
