// Data adapter: imports the parser's JSON outputs and reshapes them into the
// structures the character creator UI consumes. All field-mapping lives here so
// the UI stays decoupled from the parser's exact schema. Re-running the parser
// (npm run parse) refreshes everything downstream automatically.

import classesJson from './classes.json';
import skillsJson from './skills.json';
import perksJson from './perks.json';
import flawsJson from './flaws.json';
import devotionsJson from './devotions.json';
import lineagesJson from './lineages.json';
import levelTableJson from './level-table.json';
import eventsTableJson from './events-table.json';
import domainsJson from './domains.json';
import craftingJson from './crafting-recipes.json';
import ritualsJson from './ritual-recipes.json';
import archetypesJson from './archetypes.json';
import refsJson from './refs.json';

// Concept content files — the glossary and rules-reference data the linker emits
// references to (terms:, rules-concepts:, effects:, accents:, …). Indexed below
// so those reference links resolve and open instead of dead-ending.
import glossaryJson from './glossary.json';
import effectsJson from './effects.json';
import accentsJson from './accents.json';
import resourcesJson from './resources.json';
import modifiersJson from './modifiers.json';
import conditionsJson from './conditions.json';
import defenseCallsJson from './defense-calls.json';
import craftingConceptsJson from './crafting-concepts.json';
import ritualConceptsJson from './ritual-concepts.json';
import creatureTypesJson from './types.json';
import coreRulesJson from './core-rules.json';
import combatRulesJson from './combat-rules.json';
import restsJson from './rests.json';
import powerWordsJson from './power-words-and-power-phrases.json';
import callsJson from './calls.json';
import gameMarkersJson from './game-markers-and-signals.json';
import coreRulesMiscJson from './core-rules-miscellaneous.json';
import craftingAllJson from './crafting-all.json';
import advancementJson from './advancement.json';
import deathDyingJson from './death-and-dying.json';
import wealthJson from './wealth.json';
import powersJson from './powers.json';
import metaJson from './meta.json';
import devotionsBeingsJson from './devotions-divine-beings.json';
import introductionJson from './introduction.json';

export const LEVEL_TABLE = levelTableJson;
export const EVENTS_TABLE = eventsTableJson;


// Build/source provenance shown publicly in the footer: the app's alpha version
// and the MegaDoc sync date the data was generated from. Edit src/data/meta.json
// when re-syncing the doc.
export const META = {
  ...metaJson,
  appVersion: (typeof import.meta.env !== 'undefined' && import.meta.env.VITE_APP_VERSION) || metaJson.appVersion,
};

// ─── SKILLS / PERKS / FLAWS ───────────────────────────────────────────────────
// UI expects { name, cost, cat, prereq, ranks, desc }.

const cleanPrereq = p => (!p || p === 'None' ? null : p);

// Perk / flaw descriptions are stored as "<one-line table summary>. Cost: N
// Prerequisites: X <full description>" — the leading summary + Cost/Prereq
// boilerplate is the at-a-glance table row, duplicated in front of the real
// prose. Split them so the UI can show the FULL description (not the summary)
// while keeping the summary available as a tagline. When the boilerplate isn't
// present the whole string is the body and there's no separate summary.
// Returns { summary, body }.
export function splitDescription(text) {
  const s = String(text || '');
  // Match: summary up to the first "Cost:"/"Prerequisites:" marker, the
  // Cost/Prereq boilerplate, then the body starting at the next capitalized word.
  const m = s.match(/^(.*?)\s*(?:Cost:\s*[^]*?)?Prerequisites?:\s*[^.]*?\s+([A-Z][^]*)$/);
  if (m) return { summary: m[1].trim(), body: m[2].trim() };
  return { summary: '', body: s.trim() };
}
const descBody = text => splitDescription(text).body;

export const ALL_SKILLS = skillsJson.map(s => ({
  name: s.name,
  cost: s.cost,
  ranks: s.ranks,
  cat: s.category,
  prereq: cleanPrereq(s.prereq),
  desc: s.description,
}));

// Skills with unlimited ranks are instance-based: "Skill xN" means N separate
// skills (each a distinct subject), not rank N. Single source of truth for the
// rule, shared by the importer's xN expansion.
export const UNLIMITED_SKILLS = new Set(
  skillsJson.filter(s => String(s.ranks).toLowerCase() === 'unlimited').map(s => s.name)
);

// Perk categories in the source use "Social/Background"; the UI groups under
// "Social". Normalize here so the UI's category list matches.
const PERK_CAT = { 'Social/Background': 'Social' };

export const ALL_PERKS = perksJson.map(p => ({
  name: p.name,
  cost: p.cost,
  ranks: p.ranks,
  cat: PERK_CAT[p.category] || p.category,
  prereq: cleanPrereq(p.prereq),
  desc: descBody(p.description),
  summary: splitDescription(p.description).summary,
}));

export const ALL_FLAWS = flawsJson.map(f => ({
  name: f.name,
  // Award/BP may be a number or a string like "1 or 2"; keep as-is and expose a
  // numeric value the BP math can use (the lower bound when it's a range).
  bp: typeof f.bp === 'number' ? f.bp : parseInt(String(f.bp), 10) || 0,
  bpLabel: String(f.bp),
  ranks: f.ranks,
  cat: f.category,
  prereq: cleanPrereq(f.prereq),
  desc: descBody(f.description),
  summary: splitDescription(f.description).summary,
}));

// ─── CLASSES ──────────────────────────────────────────────────────────────────
// UI expects CLASSES keyed by name with { type, spellcaster, magicType,
// description, startingSkills, multiclassSkills }. Role/keyFeatures prose is not
// in the data (intentionally — to be parsed later), so it's simply omitted.

export const SPELLCASTERS = new Set(['Cleric', 'Druid', 'Mage', 'Sourcerer']);
const MAGIC_TYPE = { Cleric: 'Divine', Druid: 'Divine', Mage: 'Arcane', Sourcerer: 'Arcane' };

export const CLASSES = Object.fromEntries(
  classesJson.map(c => [
    c.name,
    {
      type: c.type,
      spellcaster: SPELLCASTERS.has(c.name),
      magicType: MAGIC_TYPE[c.name] || null,
      description: c.description,
      startingSkills: c.startingSkills,
      multiclassSkills: c.multiclassSkills,
      multiclassGrants: c.multiclassGrants || [],
    },
  ])
);

// ─── CLASS POWERS ─────────────────────────────────────────────────────────────
// UI consumes CLASS_POWERS[class] = { utility, basic, advanced, veteran } for
// martials and the spell tiers for casters. Each entry is { name, desc, refresh,
// prereq, ... }. We surface every parsed tier so all 8 classes work, including
// caster cantrips/novice/adept and the Class-tier and Right Hand powers.

function powerEntry(p) {
  return {
    name: p.name,
    desc: p.description,
    refresh: p.refresh ?? null,
    prereq: p.prerequisites ?? null,
    requirement: p.requirement ?? null,
    cost: p.cost ?? null,
    tier: p.tier,
    tags: p.tags ?? [],
    call: p.call ?? null,
    effect: p.effect ?? null,
    incantation: p.incantation ?? null,
    maxRanks: p.maxRanks ?? 1,
    // Parser-extracted structured mechanics (read by the validator instead of
    // re-parsing the description). Keep this list in sync with enrichMechanics.
    statMods: p.statMods ?? [],
    statModNotes: p.statModNotes ?? [],
    wealthIncome: p.wealthIncome ?? null,
    slotGrants: p.slotGrants ?? [],
    highestSlot: p.highestSlot ?? false,
  };
}

export const CLASS_POWERS = Object.fromEntries(
  classesJson.map(c => [
    c.name,
    {
      innate: (c.innate || []).map(powerEntry),
      utility: (c.utility || []).map(powerEntry),
      basic: (c.basic || []).map(powerEntry),
      advanced: (c.advanced || []).map(powerEntry),
      veteran: (c.veteran || []).map(powerEntry),
      classSkills: (c.classSkills || []).map(powerEntry),
      rightHandPowers: (c.rightHandPowers || []).map(powerEntry),
      cantrips: (c.cantrips || []).map(powerEntry),
      noviceSpells: (c.noviceSpells || []).map(powerEntry),
      adeptSpells: (c.adeptSpells || []).map(powerEntry),
      greaterSpells: (c.greaterSpells || []).map(powerEntry),
    },
  ])
);

// Which power list(s) a slot category draws from. Martial categories map 1:1 to
// a tier; the caster "spellsKnown" budget spans every learnable spell tier, so
// the picker offers them all under one budget. Keyed by the slot category names
// used in CLASS_POWER_SLOTS / validate.computeSlots.
export const SLOT_POWER_LISTS = {
  utility: ['utility'],
  basic: ['basic'],
  advanced: ['advanced'],
  veteran: ['veteran'],
  cantrips: ['cantrips'],
  spellsKnown: ['noviceSpells', 'adeptSpells', 'greaterSpells'],
  // Class Skills aren't slot-filled — they're BP-PURCHASED (like Domain Powers),
  // gated by having levels in the class. Mapped here so eligiblePowers can list
  // them for the purchase picker.
  classSkills: ['classSkills'],
};

// The powers a character may choose to fill a given slot category, i.e. every
// power in the class's lists for that category's tier(s). Each carries a `tier`
// label so the picker can group spells-known by novice/adept/greater. Returns []
// for unknown class/category.
export function eligiblePowers(className, category) {
  const lists = SLOT_POWER_LISTS[category];
  const byTier = CLASS_POWERS[className];
  if (!lists || !byTier) return [];
  return lists.flatMap(tier => (byTier[tier] || [])
    .filter(p => p.tier !== 'SubPower')
    .map(p => ({ ...p, tierList: tier })));
}

// Power-slot counts at the starting level come from the progression table's
// level-4 row, so they stay in sync with the source rather than being hardcoded.
export const CLASS_POWER_SLOTS = Object.fromEntries(
  classesJson.map(c => {
    const lvl4 = c.progression?.['4'] || {};
    if (SPELLCASTERS.has(c.name)) {
      return [c.name, {
        cantrips: lvl4.cantrips ?? 0,
        spellsKnown: lvl4.spellsKnown ?? 0,
        slots: lvl4.slots ?? null,
      }];
    }
    return [c.name, {
      utility: lvl4.utility ?? 0,
      basic: lvl4.basic ?? 0,
      advanced: lvl4.advanced ?? 0,
      veteran: lvl4.veteran ?? 0,
    }];
  })
);

// Full per-level progression table per class (level → { cantrips, spellsKnown,
// slots, utility, basic, …, bonus }). The validator scans the `bonus` prose for
// level-granted features like the casters' "Innate Bonus Cantrip".
export const CLASS_PROGRESSION = Object.fromEntries(
  classesJson.map(c => [c.name, c.progression || {}])
);

// ─── LINEAGES ─────────────────────────────────────────────────────────────────
// UI expects LINEAGES keyed by name with challenges/advantages whose display
// names carry the [Repped]/[Required] tags and sublineage hints, matching the
// old inline format. We reconstruct those from the parsed flags.

function lineageItemName(it) {
  let n = it.name;
  if (it.repped) n += ' [Repped]';
  if (it.required) n += ' [Required]';
  if (it.sublineage && it.sublineage !== 'General') n += ` (${it.sublineage})`;
  return n;
}

const lineageItem = it => ({
  name: lineageItemName(it),
  baseName: it.name,
  lbp: it.lbp ?? 0,
  required: it.required,
  repped: it.repped,
  sublineage: it.sublineage,
  desc: it.description,
  statMods: it.statMods ?? [],
  statModNotes: it.statModNotes ?? [],
  wealthIncome: it.wealthIncome ?? null,
  slotGrants: it.slotGrants ?? [],
  highestSlot: it.highestSlot ?? false,
});

export const LINEAGES = Object.fromEntries(
  lineagesJson.map(l => [
    l.name,
    {
      description: l.description,
      costume: l.costume,
      sublineages: l.sublineages.map(s => (s.note ? `${s.name} (${s.note})` : s.name)),
      challenges: l.challenges.map(lineageItem),
      advantages: l.advantages.map(lineageItem),
    },
  ])
);

// ─── DEVOTIONS ────────────────────────────────────────────────────────────────
// UI expects an array with { name, locality, domains, color, tenets } where
// tenets is a single string. Join the parsed tenet bullets.

export const DEVOTIONS = devotionsJson.map(d => ({
  name: d.epithet ? `${d.name}, ${d.epithet}` : d.name,
  baseName: d.name,
  locality: d.locality,
  domains: d.domains,
  color: d.colorScheme || '',
  tenets: (d.tenets || []).join(' '),
  iconography: d.iconography || '',
  lore: d.lore || '',
}));

// ─── REFERENCE DATA (not yet surfaced in the wizard, available for later) ──────
export const DOMAINS = domainsJson;
export const CRAFTING = craftingJson;
export const RITUALS = ritualsJson;

// ─── ARCHETYPES + REFS ────────────────────────────────────────────────────────
// Starter character templates and the cross-reference graph the builder uses
// to look up details, backlinks, and prereqs.
export const ARCHETYPES = archetypesJson;
export const REFS = refsJson;

// Lookup by entity id, e.g. "skills:Basic Faith" → { type, name, description, ... }.
// Used by the detail pane when an item card is clicked.
const ENTITY_INDEX = new Map();
// `splitDesc` (perks/flaws): strip the duplicated table-summary + Cost/Prereq
// boilerplate so the detail pane shows the full prose, keeping the summary as a
// separate field. Skills aren't split (no boilerplate) but parameterized ones
// are resolved on lookup (see lookupEntity).
const indexCollection = (items, type, { nameKey = 'name', extra = e => ({}), splitDesc = false } = {}) => {
  for (const e of items) {
    const name = e[nameKey];
    if (!name) continue;
    const desc = splitDesc && e.description
      ? (() => { const { summary, body } = splitDescription(e.description); return { description: body, summary }; })()
      : {};
    ENTITY_INDEX.set(`${type}:${name}`, { ...e, ...desc, ...extra(e), id: `${type}:${name}`, type, name });
  }
};
indexCollection(skillsJson, 'skills');
indexCollection(perksJson, 'perks', { splitDesc: true });
indexCollection(flawsJson, 'flaws', { splitDesc: true });
indexCollection(devotionsJson, 'devotions');
indexCollection(domainsJson, 'domains');
indexCollection(craftingJson, 'recipes');
indexCollection(ritualsJson, 'rituals');
for (const c of classesJson) {
  ENTITY_INDEX.set(`classes:${c.name}`, { ...c, id: `classes:${c.name}`, type: 'classes' });
  for (const s of (c.specializations || [])) {
    ENTITY_INDEX.set(`classes:${s.name}`, { ...s, id: `classes:${s.name}`, type: 'classes', parentClass: c.name });
  }
  const TIERS = ['innate','utility','basic','advanced','veteran','classSkills','rightHandPowers','cantrips','noviceSpells','adeptSpells','greaterSpells'];
  for (const t of TIERS) for (const p of (c[t] || [])) {
    ENTITY_INDEX.set(`powers:${p.name}`, { tier: t, ...p, id: `powers:${p.name}`, type: 'powers', parentClass: c.name });
  }
}
for (const d of domainsJson) for (const p of (d.powers || [])) {
  ENTITY_INDEX.set(`powers:${p.name}`, { ...p, id: `powers:${p.name}`, type: 'powers', domain: d.name });
}
// Lineage advantages. Keyed "advantages:<Lineage> - <name>" to match how the rules
// relations reference them (REFS.grants/discounts) and how ownedGrantSources builds
// the id — without this, grant/discount edges from advantages, plus their
// descriptions and the inspector, resolve to nothing.
for (const lin of lineagesJson) for (const a of (lin.advantages || [])) {
  const id = `advantages:${lin.name} - ${a.name}`;
  ENTITY_INDEX.set(id, { ...a, id, type: 'advantages', name: a.name, lineage: lin.name });
}

// ─── CONCEPT / GLOSSARY INDEX ──────────────────────────────────────────────────
// Index the rules-reference content so the linker's reference links (terms:,
// rules-concepts:, effects:, accents:, …) resolve. Field names vary per file, so
// normalize each entry to { name, description }. Multiple source files map to the
// same linker type (e.g. rules-concepts is spread across core-rules, combat-rules,
// power-words); they're merged into one type bucket.
const indexConcepts = (items, type, { nameKey = 'name', descKey = 'description' } = {}) => {
  for (const e of items || []) {
    const name = e[nameKey] ?? e.name ?? e.term ?? e.heading;
    if (!name) continue;
    const description = e[descKey] ?? e.description ?? e.definition ?? e.content ?? '';
    const id = `${type}:${name}`;
    // Don't clobber a richer earlier entry (e.g. a real skill) with a concept.
    if (!ENTITY_INDEX.has(id)) {
      ENTITY_INDEX.set(id, { ...e, id, type, name, description });
    }
    // Many rules entries nest named sub-concepts (e.g. Spellcasting > Spellbook,
    // Delivery > Weapon Delivery). Index those under the same type so refs to the
    // sub-concept resolve too.
    if (Array.isArray(e.subConcepts)) {
      indexConcepts(
        e.subConcepts.map((s) => (typeof s === 'string' ? { name: s, description: '' } : s)),
        type,
      );
    }
  }
};

indexConcepts(glossaryJson, 'terms', { nameKey: 'term', descKey: 'definition' });
indexConcepts(effectsJson, 'effects');
indexConcepts(accentsJson, 'accents');
indexConcepts(resourcesJson, 'resources');
indexConcepts(modifiersJson, 'modifiers');
indexConcepts(conditionsJson, 'conditions');
indexConcepts(defenseCallsJson, 'defenses');
indexConcepts(craftingConceptsJson, 'crafting-concepts');
indexConcepts(ritualConceptsJson, 'ritual-concepts');
indexConcepts(creatureTypesJson, 'creature-types');
// rules-concepts content is spread across many doc-derived rules files — index
// all of them (recursing into subConcepts) under the one linker type so refs
// like rules-concepts:Spellcasting / Summoned Armor / Multi-Classing resolve.
// The intermediate JSON shape doesn't matter; it's regenerated from the doc.
for (const src of [
  coreRulesJson, combatRulesJson, restsJson, powerWordsJson, callsJson,
  gameMarkersJson, coreRulesMiscJson, craftingAllJson, advancementJson,
  deathDyingJson, wealthJson, powersJson, devotionsBeingsJson, introductionJson,
]) {
  indexConcepts(src, 'rules-concepts', { nameKey: 'name', descKey: 'description' });
}

// Canonical-name fallback: the linker's type prefix doesn't always match where
// the content actually lives (e.g. it emits `terms:Long Rest` but the entry is
// indexed under `rules-concepts:Long Rests`). Build a map from a normalized name
// to the best entity id so lookup can recover across that mismatch.
const canon = (s) => String(s).toLowerCase()
  .replace(/[“”"’‘]/g, '').replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').trim()
  .replace(/(\w)s$/, (m, c) => (c === 's' ? m : c)); // drop trailing plural -s
const NAME_INDEX = new Map();
for (const [id, ent] of ENTITY_INDEX) {
  const key = canon(ent.name);
  if (!NAME_INDEX.has(key)) NAME_INDEX.set(key, id);
}

// Name-variant aliases the source prose uses that differ from an entity's real
// name in ways canon() (which only folds punctuation / plurals) can't bridge.
// Two kinds:
//   • PATTERN — a transform applied to the matching prefix/shape (handles the
//     parameterized Profession tiers and the "Lore: X" / "Lore [X]" → "Lore (X)"
//     re-bracketing the MegaDoc's Starting Skills lists use).
//   • EXACT — whole-name substitutions for skills the doc spells differently
//     ("Scavenge" → "Scavenge I", "Basic Lock Skill" → "Basic Locks").
// Add a row here rather than special-casing a call site, so every resolver
// (reconcile, cost, links) gets the alias.
const ALIAS_PATTERNS = [
  [/^apprentice profession\b/i, () => 'Profession - Apprentice'],
  [/^journeyman profession\b/i, () => 'Profession - Journeyman'],
  [/^master profession\b/i, () => 'Profession - Master'],
  // "Lore: Nature" / "Lore [Shadow]" → "Lore (Nature)" / "Lore (Shadow)"
  [/^lore(?::\s*\[?|\s+\[)([^\]]+)\]?$/i, (m) => `Lore (${m[1]})`],
];
const ALIAS_EXACT = {
  'scavenge': 'Scavenge I',
  'basic lock skill': 'Basic Locks',
  'basic trap skill': 'Basic Traps',
  'bits & pieces': 'Bits and Pieces',
  'two-weapon style': 'Two Weapon Style',
  'ritual lore': 'Lore (Ritual)',
};
function applySkillAlias(name) {
  const lower = name.trim().toLowerCase();
  if (ALIAS_EXACT[lower]) return ALIAS_EXACT[lower];
  for (const [re, fn] of ALIAS_PATTERNS) {
    const m = name.match(re);
    if (m) return name.replace(re, fn(m));
  }
  return name;
}

// Lookup by entity id, e.g. "skills:Basic Faith" → { type, name, description, ... }.
// Falls back to a canonical-name match across all types when the exact id misses,
// so reference links resolve despite linker/file namespace differences.
export const lookupEntity = (id) => {
  if (!id) return null;
  const direct = ENTITY_INDEX.get(id);
  if (direct) return direct;
  const type = id.slice(0, id.indexOf(':'));
  let name = id.slice(id.indexOf(':') + 1);

  // Map sheet / MegaDoc-prose name variants to their canonical entity names.
  // These are spellings the source uses that don't match the entity's real name
  // (beyond the punctuation/plural folding canon() already does) — e.g. the doc
  // writes "Basic Lock Skill" but the skill is "Basic Locks", or "Lore: Nature"
  // for "Lore (Nature)". Centralized so reconcile, cost, and link resolution all
  // share one alias table instead of ad-hoc per-call-site fixes.
  name = applySkillAlias(name);

  const byName = NAME_INDEX.get(canon(name));
  if (byName) return ENTITY_INDEX.get(byName);

  // Try stripping trailing rank (Roman numeral or digit) if we missed
  const xMatch = name.trim().match(/^(.*?)\s+x\s*(\d+)$/i);
  if (xMatch) {
    const stripped = xMatch[1].trim();
    const byStrippedName = NAME_INDEX.get(canon(stripped));
    if (byStrippedName) return ENTITY_INDEX.get(byStrippedName);
  }
  const ROMAN_MAP = {
    i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
    xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15
  };
  const romanMatch = name.trim().match(/^(.*?)\s+([IVXLCDM]+)$/i);
  if (romanMatch && ROMAN_MAP[romanMatch[2].toLowerCase()]) {
    const stripped = romanMatch[1].trim();
    const byStrippedName = NAME_INDEX.get(canon(stripped));
    if (byStrippedName) return ENTITY_INDEX.get(byStrippedName);
  }
  const digitMatch = name.trim().match(/^(.*?)\s+(\d+)$/);
  if (digitMatch) {
    const stripped = digitMatch[1].trim();
    const byStrippedName = NAME_INDEX.get(canon(stripped));
    if (byStrippedName) return ENTITY_INDEX.get(byStrippedName);
  }
  // Parameterized skills carry a trailing "(value)" the base skill doesn't —
  // "Lore (Historical)" → the Lore skill, "Profession - Apprentice (Smith)" →
  // Profession - Apprentice. Resolve to the base entity but keep the chosen
  // parameter visible (name + a `parameter` field) so the detail pane shows the
  // base skill's full description with the picked area called out.
  let paramMatch = name.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (!paramMatch) {
    const dashIdx = name.indexOf(' - ');
    if (dashIdx > 0) {
      paramMatch = [name, name.slice(0, dashIdx).trim(), name.slice(dashIdx + 3).trim()];
    }
  }
  if (paramMatch) {
    const base = ENTITY_INDEX.get(`${type}:${paramMatch[1].trim()}`)
      || (NAME_INDEX.get(canon(paramMatch[1])) && ENTITY_INDEX.get(NAME_INDEX.get(canon(paramMatch[1]))));
    if (base) return { ...base, name, baseName: base.name, parameter: paramMatch[2].trim() };
  }
  return null;
};

export const getAllEntities = () => Array.from(ENTITY_INDEX.values());
