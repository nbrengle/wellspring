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

export function parseCharacterSheet(text) {
  const raw = String(text).replace(/\r/g, '');
  const rows = raw.split('\n').map((l) => l.trim());
  const character = { name: '', archetypeName: 'Imported Character', effectiveBP: {}, grants: {} };

  // First non-empty line = name; an immediately following non-"Label:" line that
  // isn't a known field is the tagline.
  let i = 0;
  while (i < rows.length && !rows[i]) i++;
  if (i < rows.length) { character.name = rows[i]; i++; }
  if (i < rows.length && rows[i] && !/^[^:]+:/.test(rows[i])) { character.tagline = rows[i]; i++; }

  for (; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const m = r.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const label = m[1].trim();
    const value = m[2].trim();
    if (label === 'Lineage') {
      const lm = value.match(/^(.+?)(?:\s*\(([^)]+)\))?$/);
      if (value !== 'None') { character.lineage = lm[1].trim(); if (lm[2]) character.sublineage = lm[2].trim(); }
      continue;
    }
    const field = LABEL_FIELD[label];
    if (!field) continue;
    if (SCALAR_FIELDS.has(field)) {
      character[field] = value || null;
    } else if (ITEM_FIELDS.has(field)) {
      const items = splitItems(value).map(cleanItem);
      character[field] = items.map((it) => it.name);
      if (items.some((it) => it.bp != null)) {
        character.effectiveBP[field] = items.map((it) => it.bp);
      }
      if (items.some((it) => it.grant)) {
        character.grants[field] = items.map((it) => it.grant);
      }
    }
  }
  if (!Object.keys(character.effectiveBP).length) delete character.effectiveBP;
  if (!Object.keys(character.grants).length) delete character.grants;
  return character;
}

