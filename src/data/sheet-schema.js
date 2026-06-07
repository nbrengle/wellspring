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
  'Wealth': 'wealth',
  'Resources': 'resources',
  'Class Levels': 'classLevels',
  'Specialization': 'specialization',
  'Devotion': 'devotion',
  'Active Event': 'currentEvent',
  'Event': 'currentEvent',
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
};

// Fields holding a single scalar value rather than a list of items.
export const SCALAR_FIELDS = new Set([
  'lineage', 'sublineage', 'lifePoints', 'armorPoints', 'spikes', 'classLevels',
  'wealth', 'resources',
  'specialization', 'devotion', 'currentEvent',
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
// "(from X)" / "(X)", a refund "(N BP refunded from X)" / "(X +NBP)", or a flaw award "(+N BP)".
// NOTE: the base-class alternation below is hardcoded ON PURPOSE — this module is
// intentionally dependency-free (imported by both a Node build script and the
// browser bundle), so it does not pull in index.js/classesJson to derive the list.
// It parses our OWN serialized sheet format, not MegaDoc content; if the class
// roster changes, update this alternation (the one deliberate exception to deriving
// class lists from the parsed data).
const ITEM_BP = /\s*-\s*(-?\d+)\s*BP\b.*$/i;
const ITEM_GRANT = /\(\s*(?:(?:from\s+([^)]+))|(Artisan|Cleric|Druid|Fighter|Mage|Rogue|Socialite|Sourcerer))\s*\)/i;
const ITEM_REFUND = /\(\s*(?:(?:(\d+)\s*BP\s+refunded\s+from\s+([^)]+))|(?:(Artisan|Cleric|Druid|Fighter|Mage|Rogue|Socialite|Sourcerer)\s*\+(\d+)\s*BP))\)/i;
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
  
  let grant = null;
  if (refundM) {
    if (refundM[1] !== undefined) {
      // old format: (2 BP refunded from Rogue)
      grant = { kind: 'discount', amount: parseInt(refundM[1], 10), source: refundM[2].trim() };
    } else {
      // new format: (ROGUE +2BP)
      grant = { kind: 'discount', amount: parseInt(refundM[4], 10), source: refundM[3].trim() };
    }
  } else if (grantM) {
    const src = grantM[1] !== undefined ? grantM[1] : grantM[2];
    grant = { kind: 'grant', amount: null, source: src.trim() };
  }
  
  return { name, bp: bpM ? parseInt(bpM[1], 10) : null, grant };
}

// Concrete default subjects for instance-based "(your choice)" skills, an ordered
// list per base skill so the i-th instance gets a distinct value (collisions would
// otherwise overwrite each other downstream). Shared by the build-time parser and
// the runtime importer so an expanded "Lore x2" looks identical from either path.
export const CHOICE_DEFAULTS = {
  Lore: ['Historical', 'Arcane', 'Religious', 'Nature', 'Political', 'Monstrous'],
  Bookcaster: ['Magekey', 'Mask Aura', 'Identify', 'Cancel', 'Stop', 'Mageskin'],
  'Divine Favor': ['Blessing', 'Protection', 'Guidance'],
  Profession: ['Smith', 'Cook', 'Tailor'],
  Patron: ['a Patron'],
  'Favored Form': ['Hunting Panther'],
  'Chronic Hobbyist': ['Cooking', 'Brewing', 'Gardening'],
};

// "Skill xN" on an UNLIMITED-ranks skill means N separate instances, not rank N
// (Lore, Bookcaster, …). Expand a raw item string into an array of per-instance
// strings, mirroring the build-time parser so a hand-typed/pasted "Lore x2"
// imports the same as a generated sheet. `isUnlimited(baseName)` tells whether the
// skill is instance-based; for non-unlimited skills the xN is left intact (rank).
// Distinct subjects are appended so instances don't collide downstream.
const XN_RE = /\s*x\s*(\d+)\b/i;
export function expandInstances(raw, isUnlimited, choiceDefaults = {}) {
  const m = raw.match(XN_RE);
  const count = m ? parseInt(m[1], 10) : 1;
  const base = raw.replace(XN_RE, '').split(/\s*-\s*|\s*\(/)[0].trim();
  if (count <= 1 || !isUnlimited(base)) return [raw];
  const stripped = raw.replace(XN_RE, '').replace(/\s*\(your choice\)/i, '').trim();
  const defs = choiceDefaults[base];
  return Array.from({ length: count }, (_, k) =>
    defs ? `${base} (${defs[k % defs.length]})` : (/\(/.test(stripped) ? stripped : `${base} (${k + 1})`));
}

// "None"/empty → []; otherwise comma-split into trimmed item strings.
export const splitItems = (v) =>
  (v.trim() === 'None' || v.trim() === '')
    ? []
    : v.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
