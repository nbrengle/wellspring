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
import domainsJson from './domains.json';
import craftingJson from './crafting-recipes.json';
import ritualsJson from './ritual-recipes.json';

export const LEVEL_TABLE = levelTableJson;

// ─── SKILLS / PERKS / FLAWS ───────────────────────────────────────────────────
// UI expects { name, cost, cat, prereq, ranks, desc }.

const cleanPrereq = p => (!p || p === 'None' ? null : p);

export const ALL_SKILLS = skillsJson.map(s => ({
  name: s.name,
  cost: s.cost,
  ranks: s.ranks,
  cat: s.category,
  prereq: cleanPrereq(s.prereq),
  desc: s.description,
}));

// Perk categories in the source use "Social/Background"; the UI groups under
// "Social". Normalize here so the UI's category list matches.
const PERK_CAT = { 'Social/Background': 'Social' };

export const ALL_PERKS = perksJson.map(p => ({
  name: p.name,
  cost: p.cost,
  ranks: p.ranks,
  cat: PERK_CAT[p.category] || p.category,
  prereq: cleanPrereq(p.prereq),
  desc: p.description,
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
  desc: f.description,
}));

// ─── CLASSES ──────────────────────────────────────────────────────────────────
// UI expects CLASSES keyed by name with { type, spellcaster, magicType,
// description, startingSkills, multiclassSkills }. Role/keyFeatures prose is not
// in the data (intentionally — to be parsed later), so it's simply omitted.

const SPELLCASTERS = new Set(['Cleric', 'Druid', 'Mage', 'Sourcerer']);
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
