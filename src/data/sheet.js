// Character-sheet export: turns a character + its validation report into a
// human-readable plain-text sheet, formatted the same way the starter archetypes
// are written in StarterCharacterSheets (a "<Label>: items" line per section,
// with BP costs as " - N BP" suffixes). Pure (no React/DOM) so it's unit-testable
// and reusable for copy / download / print. The output round-trips visually with
// the source archetype format.

import { getClasses } from './validate.js';
import { ARCHETYPES } from './index.js';

// BP annotation for any item line, mirroring the archetype source. Pulls the
// effective cost from the report's byItem map so EVERY section that can carry a
// cost (purchased skills/perks, BP-bought powers, refund-bearing starting skills,
// flaws) round-trips. Returns '' when the item has no cost/grant of note.
function bpSuffix(name, field, report) {
  const e = report?.spend.byItem[`${field}:${name}`];
  if (!e) return '';
  // Flaws award BP; a starting-skill refund is also a negative cost on a free item.
  if (e.cost < 0) {
    return e.grant?.source ? ` (${-e.cost} BP refunded from ${e.grant.source})` : ` (+${-e.cost} BP)`;
  }
  if (e.cost === 0 && e.grant?.source) return ` - 0 BP (from ${e.grant.source})`;
  if (e.cost > 0) return ` - ${e.cost} BP`;
  if (e.base > 0) return ` - 0 BP`;
  return '';
}

// Join a list of item names into the "item, item" form used per section, adding
// each item's BP suffix when a field/report is given.
function joinItems(items, field, report) {
  if (!items || !items.length) return 'None';
  return items.map((n) => `${n}${field ? bpSuffix(n, field, report) : ''}`).join(', ');
}

// Power/spell sections in source order. These carry no BP suffix in the source
// (they're slot-filled, not purchased), so they're listed plain.
const POWER_SECTIONS = [
  ['innatePowers', 'Innate Powers'],
  ['utilityPowers', 'Utility Powers'],
  ['basicPowers', 'Basic Powers'],
  ['advancedPowers', 'Advanced Powers'],
  ['veteranPowers', 'Veteran Powers'],
  ['classPowers', 'Class Powers'],
  ['rightHandPowers', 'Right Hand Powers'],
  ['cantrips', 'Cantrips'],
  ['noviceSpells', 'Novice Spells known'],
  ['adeptSpells', 'Adept Spells known'],
  ['greaterSpells', 'Greater Spells known'],
  ['bookSpells', 'Book Spells'],
  ['domainPowers', 'Domain Powers'],
  ['formPowers', 'Form Powers'],
];

export function formatCharacterSheet(character, report) {
  const lines = [];
  const classes = getClasses(character);
  const title = character.name?.trim() || character.archetypeName || 'Unnamed Character';
  const line = (label, value) => lines.push(`${label}: ${value}`);

  // ── Header: name + tagline (matches the archetype H1 + subtitle) ──
  lines.push(title);
  const tagline = character.tagline
    || (character.archetypeName && ARCHETYPES.find((a) => a.name === character.archetypeName)?.tagline);
  if (tagline) lines.push(tagline);

  // ── Identity block ──
  line('Lineage', character.lineage
    ? `${character.lineage}${character.sublineage ? ` (${character.sublineage})` : ''}`
    : 'None');
  line('Lineage Challenges', joinItems(character.lineageChallenges));
  line('Lineage Advantages', joinItems(character.lineageAdvantages));
  line('Life Points', report.stats?.lifePoints ?? character.lifePoints ?? '—');
  line('Armor Points', character.armorPoints ?? '—');
  line('Spikes', report.stats?.spikes ?? character.spikes ?? '—');
  line('Class Levels', classes.length ? classes.map((c) => `${c.name} ${c.level}`).join(' / ') : 'None');
  if (character.specialization) line('Specialization', character.specialization);
  if (character.devotion) line('Devotion', character.devotion);
  line('Flaws', joinItems(character.flaws, 'flaws', report));

  // ── Skills / perks ── (starting skills may carry a refund annotation)
  line('Starting Skills (free)', joinItems(character.startingSkills, 'startingSkills', report));
  if (character.divineDomains?.length) line('Divine Domains', joinItems(character.divineDomains));
  if (character.devotionAccents?.length) line('Available Devotion Accents', joinItems(character.devotionAccents));
  line('Purchased Skills', joinItems(character.purchasedSkills, 'purchasedSkills', report));
  line('Purchased Perks', joinItems(character.purchasedPerks, 'purchasedPerks', report));

  // ── Powers / spells ── (domain/class powers may be BP-bought)
  for (const [field, label] of POWER_SECTIONS) {
    if (character[field]?.length) line(label, joinItems(character[field], field, report));
  }

  // ── Spell slots (casters), shown like the source's "Novice Spell-slots: N" ──
  if (report.spellSlots) {
    const { novice, adept, greater } = report.spellSlots;
    if (novice) line('Novice Spell-slots', novice);
    if (adept) line('Adept Spell-slots', adept);
    if (greater) line('Greater Spell-slots', greater);
  }

  // ── Build summary footer (not in the source, but useful on an export) ──
  lines.push('');
  const { spend, budget } = report;
  lines.push(`Build Points: ${spend.net} / ${budget}` +
    (spend.awarded > 0 ? ` (+${spend.awarded} from flaws)` : '') +
    (report.usesBonus ? ` (+${report.bonusUsed} bonus BP)` : ''));
  const flags = [];
  if (report.belowFloor) flags.push(`below level ${report.legalMinLevel}`);
  if (report.aboveCap) flags.push(`above level ${report.levelCap} cap`);
  if (report.overBudget) flags.push('over budget');
  if (report.slotsOver) flags.push('power slots exceeded');
  if (report.prereqs.issues.length) flags.push(`${report.prereqs.issues.length} unmet prereq(s)`);
  lines.push(report.valid && !flags.length ? '✓ Legal build' : `⚠ ${flags.join('; ') || 'check build'}`);

  return lines.join('\n');
}

// ─── IMPORT (inverse of the export) ───────────────────────────────────────────
// Parse the plain-text sheet format back into a character object. This is the
// inverse of formatCharacterSheet, so export→import round-trips. It also reads
// the StarterCharacterSheets layout the export mirrors, so a real character
// pasted from the source can be validated.

// Section label → character field. Mirrors the export's line() labels and the
// archetype source headers (some appear with slight variants).
const LABEL_FIELD = {
  'Lineage Challenges': 'lineageChallenges',
  'Lineage Advantages': 'lineageAdvantages',
  'Life Points': 'lifePoints',
  'Armor Points': 'armorPoints',
  'Spikes': 'spikes',
  'Class Levels': 'classLevels',
  'Specialization': 'specialization',
  'Devotion': 'devotion',
  'Flaws': 'flaws',
  'Starting Skills (free)': 'startingSkills',
  'Starting Skills': 'startingSkills',
  'Divine Domains': 'divineDomains',
  'Available Devotion Accents': 'devotionAccents',
  'Purchased Skills': 'purchasedSkills',
  'Purchased Perks': 'purchasedPerks',
  'Innate Powers': 'innatePowers',
  'Utility Powers': 'utilityPowers',
  'Basic Powers': 'basicPowers',
  'Advanced Powers': 'advancedPowers',
  'Veteran Powers': 'veteranPowers',
  'Class Powers': 'classPowers',
  'Right Hand Powers': 'rightHandPowers',
  'Cantrips': 'cantrips',
  'Novice Spells known': 'noviceSpells',
  'Novice Spells Known': 'noviceSpells',
  'Adept Spells known': 'adeptSpells',
  'Greater Spells known': 'greaterSpells',
  'Book Spells': 'bookSpells',
  'Domain Powers': 'domainPowers',
  'Form Powers': 'formPowers',
  'Novice Spell-slots': 'noviceSpellSlots',
  'Adept Spell-slots': 'adeptSpellSlots',
  'Greater Spell-slots': 'greaterSpellSlots',
};
// Fields stored as scalars (not item lists).
const SCALAR_FIELDS = new Set([
  'lifePoints', 'armorPoints', 'spikes', 'classLevels', 'specialization',
  'devotion', 'noviceSpellSlots', 'adeptSpellSlots', 'greaterSpellSlots',
]);
// Lineage is special (may carry a "(sublineage)" parenthetical).
const ITEM_FIELDS = new Set(Object.values(LABEL_FIELD).filter((f) => !SCALAR_FIELDS.has(f) && f !== 'lineage'));

// Strip an item's " - N BP …" / "(+N BP)" annotation back to the canonical name,
// and capture the BP + grant provenance into parallel sidecars so the validator
// sees the authored cost and free/granted state. Mirrors the parser's stripping.
const ITEM_BP = /\s*-\s*(-?\d+)\s*BP\b.*$/i;
const ITEM_GRANT = /\(\s*from\s+([^)]+)\)/i;                       // "- 0 BP (from Linked Armor)"
const ITEM_REFUND = /\(\s*(\d+)\s*BP\s+refunded\s+from\s+([^)]+)\)/i; // "(3 BP refunded from X)"
const ITEM_AWARD = /\(\+(\d+)\s*BP\)/i;                            // flaw "(+1 BP)"
function cleanItem(raw) {
  const refundM = raw.match(ITEM_REFUND);
  const awardM = raw.match(ITEM_AWARD);
  const grantM = !refundM && raw.match(ITEM_GRANT);
  const bpM = !refundM && !awardM && raw.match(ITEM_BP);
  const name = raw
    .replace(ITEM_REFUND, '').replace(ITEM_AWARD, '').replace(ITEM_GRANT, '')
    .replace(ITEM_BP, '').trim();
  // A refund on a (free) starting skill is a discount grant with an amount.
  const grant = refundM
    ? { kind: 'discount', amount: parseInt(refundM[1], 10), source: refundM[2].trim() }
    : grantM ? { kind: 'grant', amount: null, source: grantM[1].trim() } : null;
  return { name, bp: bpM ? parseInt(bpM[1], 10) : null, grant };
}
const splitItems = (v) => v.trim() === 'None' || v.trim() === ''
  ? [] : v.split(/,\s*/).map((s) => s.trim()).filter(Boolean);

// Look up a field by label, tolerating case and a missing "(free)" suffix so
// variant sheets ("Starting Skills" / "starting skills (free)") still match.
function fieldForLabel(label) {
  if (LABEL_FIELD[label]) return LABEL_FIELD[label];
  const norm = label.toLowerCase().replace(/\s*\(free\)\s*$/, '').trim();
  for (const [k, v] of Object.entries(LABEL_FIELD)) {
    if (k.toLowerCase().replace(/\s*\(free\)\s*$/, '').trim() === norm) return v;
  }
  return null;
}
// True for a line that looks like "Label: …" where Label is a known section.
function labelOf(line) {
  const m = line.match(/^([^:]{1,40}):\s*(.*)$/);
  if (!m) return null;
  const label = m[1].trim();
  if (label === 'Lineage' || fieldForLabel(label)) return { label, value: m[2].trim() };
  return null;
}

// Parse already-normalized plain text in the "Label: value" sheet shape. Internal
// — callers use parseCharacterSheet, which handles format detection first.
function parseSheetText(text) {
  const raw = String(text).replace(/\r/g, '');
  const rows = raw.split('\n').map((l) => l.trim());
  const character = { name: '', archetypeName: 'Imported Character', effectiveBP: {}, grants: {} };

  // First non-empty line = name; an immediately following non-"Label:" line that
  // isn't a known field is the tagline.
  let i = 0;
  while (i < rows.length && !rows[i]) i++;
  if (i < rows.length) { character.name = rows[i]; i++; }
  if (i < rows.length && rows[i] && !rows[i].includes(':')) { character.tagline = rows[i]; i++; }

  // Apply a parsed section (label + its collected item strings) to the character.
  const apply = (label, valueStr, extraItems) => {
    if (label === 'Lineage') {
      const lm = valueStr.match(/^(.+?)(?:\s*\(([^)]+)\))?$/);
      if (valueStr && valueStr !== 'None') {
        character.lineage = lm[1].trim();
        if (lm[2]) character.sublineage = lm[2].trim();
      }
      return;
    }
    const field = fieldForLabel(label);
    if (!field) return;
    if (SCALAR_FIELDS.has(field)) { character[field] = valueStr || null; return; }
    if (!ITEM_FIELDS.has(field)) return;
    // Items can be inline (comma-separated after the label) AND/OR on the lines
    // that follow the label until the next section — gather both.
    const items = [...splitItems(valueStr), ...extraItems].map(cleanItem);
    character[field] = items.map((it) => it.name);
    if (items.some((it) => it.bp != null)) character.effectiveBP[field] = items.map((it) => it.bp);
    if (items.some((it) => it.grant)) character.grants[field] = items.map((it) => it.grant);
  };

  for (; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const lab = labelOf(r);
    if (!lab) continue;
    // Collect following item lines for this section (the source lists each
    // skill/power on its own line). Stop at the next blank line or any line with a
    // colon — that's either the next section label or a footer ("Build Points:"),
    // never an item. This prevents the export footer leaking into the last section.
    const extra = [];
    let j = i + 1;
    for (; j < rows.length; j++) {
      if (!rows[j]) break;
      if (rows[j].includes(':')) break;
      extra.push(rows[j]);
    }
    apply(lab.label, lab.value, extra);
    i = j - 1;
  }
  if (!Object.keys(character.effectiveBP).length) delete character.effectiveBP;
  if (!Object.keys(character.grants).length) delete character.grants;
  return character;
}

// ─── FORMAT-TOLERANT ENTRY POINT ──────────────────────────────────────────────
// Real characters arrive in varied formats: our plain-text export, an HTML export
// (Google Docs), or spreadsheet/Excel paste (tab-separated). Normalize to the
// text shape parseCharacterSheet understands, then parse. For multi-character
// HTML (like the full starter sheet) only the FIRST character block is taken.
function htmlToText(html) {
  const decode = (s) => s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&rsquo;|&#8217;/g, '’')
    .replace(/&lsquo;|&#8216;/g, '‘').replace(/&ldquo;|&#8220;/g, '“')
    .replace(/&rdquo;|&#8221;/g, '”').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&[a-z]+;/gi, ' ');
  return decode(html
    .replace(/<\/(p|li|h[1-6]|tr|div|td|th)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

// Trim a multi-block sheet down to a single character: from the first line that
// is immediately followed (within a few lines) by a "Lineage:"/"Class Levels:"
// header, up to the next such header. Keeps single-character input intact.
function firstCharacterBlock(lines) {
  const isHeader = (l) => /^(Lineage|Class Levels|Life Points):/i.test(l);
  // A real block is: name → tagline → header. A table-of-contents is a run of
  // bare name lines (name → name). So the block starts at a NON-header, NON-label
  // line whose NEXT line is also non-header/non-label (the tagline) and the line
  // after that begins the headers. This skips the TOC.
  // Tightest, least-ambiguous shape: name, then tagline, then a header on the
  // very next line (name / tagline / "Lineage:"). The TOC has no taglines between
  // its name lines, so this lands on the first real block.
  let start = 0;
  const plain = (l) => l && !isHeader(l) && !l.includes(':');
  for (let i = 0; i < lines.length - 2; i++) {
    if (plain(lines[i]) && plain(lines[i + 1]) && isHeader(lines[i + 2])) { start = i; break; }
  }
  // End at the next name+header boundary (a non-header line followed by a header,
  // after we've already seen this block's headers).
  let seenHeader = false, end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isHeader(lines[i])) { seenHeader = true; continue; }
    if (seenHeader && lines.slice(i + 1, i + 4).some(isHeader) && !lines[i].includes(':')) { end = i; break; }
  }
  return lines.slice(start, end);
}

// Parse a character from a pasted sheet in ANY supported format — our plain-text
// export, an HTML export (Google Docs), or a spreadsheet/Excel copy (tab-
// separated). Detects the format, normalizes to text, isolates the first
// character block (skipping a table of contents), and parses. This is the single
// public entry point; callers don't need to know the input format.
export function parseCharacterSheet(input) {
  let text = String(input);
  if (/<[a-z][^>]*>/i.test(text)) text = htmlToText(text);       // HTML
  else if (text.includes('\t')) {                                 // spreadsheet/TSV
    text = text.split('\n').map((row) => row.replace(/\t+/g, ': ')).join('\n');
  }
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return parseSheetText(firstCharacterBlock(lines).join('\n'));
}

