// Single source of truth for the character-sheet field schema, shared by the
// build-time parser (scripts/parse-archetypes.js) and the runtime importer
// (src/data/sheet.js). Both used to keep their own copies of this label→field
// map and item-annotation stripping, which drifted and caused bugs; this module
// is the one place that knows the mapping. Pure ESM, no deps, so both a Node
// script and the browser bundle can import it.

// Section / inline label → character field. Includes the casing/spelling
// variants the source doc uses ("Spells known" vs "Spells Known", with/without
// "(free)").
export const LABEL_FIELD = {
  // Lineage carries an optional "(sublineage)" parenthetical, so sheet.js parses
  // it specially rather than through this map; the build-time parser uses it as a
  // plain inline label.
  'Lineage': 'lineage',
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
  'Adept Spells Known': 'adeptSpells',
  'Greater Spells known': 'greaterSpells',
  'Greater Spells Known': 'greaterSpells',
  'Book Spells': 'bookSpells',
  'Domain Powers': 'domainPowers',
  'Form Powers': 'formPowers',
  'Novice Spell-slots': 'noviceSpellSlots',
  'Adept Spell-slots': 'adeptSpellSlots',
  'Greater Spell-slots': 'greaterSpellSlots',
};

// Fields holding a single scalar value rather than a list of items.
export const SCALAR_FIELDS = new Set([
  'lineage', 'sublineage', 'lifePoints', 'armorPoints', 'spikes', 'classLevels',
  'specialization', 'devotion', 'noviceSpellSlots', 'adeptSpellSlots', 'greaterSpellSlots',
]);

// Fields holding a list of item names (skills/powers/etc.). Lineage is scalar,
// not an item list, so it's excluded.
export const ITEM_FIELDS = new Set(
  Object.values(LABEL_FIELD).filter((f) => !SCALAR_FIELDS.has(f)),
);

// Resolve a label to its field, tolerating case and a missing "(free)" suffix so
// variant sheets ("Starting Skills" / "starting skills (free)") still match.
export function fieldForLabel(label) {
  if (LABEL_FIELD[label]) return LABEL_FIELD[label];
  const norm = label.toLowerCase().replace(/\s*\(free\)\s*$/, '').trim();
  for (const [k, v] of Object.entries(LABEL_FIELD)) {
    if (k.toLowerCase().replace(/\s*\(free\)\s*$/, '').trim() === norm) return v;
  }
  return null;
}

// Item-annotation patterns. An item name may carry "- N BP", a grant note
// "(from X)", a refund "(N BP refunded from X)", or a flaw award "(+N BP)".
const ITEM_BP = /\s*-\s*(-?\d+)\s*BP\b.*$/i;
const ITEM_GRANT = /\(\s*from\s+([^)]+)\)/i;
const ITEM_REFUND = /\(\s*(\d+)\s*BP\s+refunded\s+from\s+([^)]+)\)/i;
const ITEM_AWARD = /\(\+(\d+)\s*BP\)/i;

// Split an annotated item into its canonical name + parsed annotations:
//   { name, bp, grant }  where grant is {kind:'grant'|'discount', amount, source}.
export function cleanItem(raw) {
  const refundM = raw.match(ITEM_REFUND);
  const awardM = raw.match(ITEM_AWARD);
  const grantM = !refundM && raw.match(ITEM_GRANT);
  const bpM = !refundM && !awardM && raw.match(ITEM_BP);
  const name = raw
    .replace(ITEM_REFUND, '').replace(ITEM_AWARD, '').replace(ITEM_GRANT, '')
    .replace(ITEM_BP, '').trim();
  const grant = refundM
    ? { kind: 'discount', amount: parseInt(refundM[1], 10), source: refundM[2].trim() }
    : grantM ? { kind: 'grant', amount: null, source: grantM[1].trim() } : null;
  return { name, bp: bpM ? parseInt(bpM[1], 10) : null, grant };
}

// "None"/empty → []; otherwise comma-split into trimmed item strings.
export const splitItems = (v) =>
  (v.trim() === 'None' || v.trim() === '')
    ? []
    : v.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
