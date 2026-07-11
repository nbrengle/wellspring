// Data adapter: imports the parser's JSON outputs and reshapes them into the
// structures the character creator UI consumes. All field-mapping lives here so
// the UI stays decoupled from the parser's exact schema. Re-running the parser
// (npm run parse) refreshes everything downstream automatically.

import classesJson from "../data/classes.json";
import type { Entity, ProgressionRow, DiscountSpec } from "./types.js";
import skillsJson from "../data/skills.json";
import perksJson from "../data/perks.json";
import flawsJson from "../data/flaws.json";
import devotionsJson from "../data/devotions.json";
import lineagesJson from "../data/lineages.json";
import levelTableJson from "../data/level-table.json";
import eventsTableJson from "../data/events-table.json";
import domainsJson from "../data/domains.json";
import craftingJson from "../data/crafting-recipes.json";
import ritualsJson from "../data/ritual-recipes.json";
import archetypesJson from "../data/archetypes.json";
import refsJson from "../data/refs.json";
// Choice/parameter spec registries — kept in their own module (see re-export below).
import { LINEAGE_CHOICE_SPECS, lineageChoiceSpec } from "./choice-specs.js";

// Concept content files — the glossary and rules-reference data the linker emits
// references to (terms:, rules-concepts:, effects:, accents:, …). Indexed below
// so those reference links resolve and open instead of dead-ending.
import glossaryJson from "../data/glossary.json";
import effectsJson from "../data/effects.json";
import accentsJson from "../data/accents.json";
import resourcesJson from "../data/resources.json";
import modifiersJson from "../data/modifiers.json";
import conditionsJson from "../data/conditions.json";
import defenseCallsJson from "../data/defense-calls.json";
import craftingConceptsJson from "../data/crafting-concepts.json";
import ritualConceptsJson from "../data/ritual-concepts.json";
import creatureTypesJson from "../data/types.json";
import coreRulesJson from "../data/core-rules.json";
import combatRulesJson from "../data/combat-rules.json";
import restsJson from "../data/rests.json";
import powerWordsJson from "../data/power-words-and-power-phrases.json";
import callsJson from "../data/calls.json";
import gameMarkersJson from "../data/game-markers-and-signals.json";
import coreRulesMiscJson from "../data/core-rules-miscellaneous.json";
import craftingAllJson from "../data/crafting-all.json";
import advancementJson from "../data/advancement.json";
import deathDyingJson from "../data/death-and-dying.json";
import wealthJson from "../data/wealth.json";
import powersJson from "../data/powers.json";
import metaJson from "../data/meta.json";
import devotionsBeingsJson from "../data/devotions-divine-beings.json";
import introductionJson from "../data/introduction.json";

export const LEVEL_TABLE = levelTableJson;
export const EVENTS_TABLE = eventsTableJson;

// Build/source provenance shown publicly in the footer: the app's alpha version
// and the MegaDoc sync date the data was generated from. Edit src/data/meta.json
// when re-syncing the doc.
export const META = {
  ...metaJson,
  appVersion:
    (typeof (import.meta as unknown as { env?: { VITE_APP_VERSION?: string } }).env !== "undefined" &&
      (import.meta as unknown as { env?: { VITE_APP_VERSION?: string } }).env?.VITE_APP_VERSION) ||
    metaJson.appVersion,
};

// ─── SKILLS / PERKS / FLAWS ───────────────────────────────────────────────────
// UI expects { name, cost, cat, prereq, ranks, desc }.

const cleanPrereq = (p) => (!p || p === "None" ? null : p);

// Perk / flaw descriptions are stored as "<one-line table summary>. Cost: N
// Prerequisites: X <full description>" — the leading summary + Cost/Prereq
// boilerplate is the at-a-glance table row, duplicated in front of the real
// prose. Split them so the UI can show the FULL description (not the summary)
// while keeping the summary available as a tagline. When the boilerplate isn't
// present the whole string is the body and there's no separate summary.
// Returns { summary, body }.
export function splitDescription(text) {
  const s = String(text || "");
  // Match: summary up to the first "Cost:"/"Prerequisites:" marker, the
  // Cost/Prereq boilerplate, then the body starting at the next capitalized word.
  const m = s.match(/^(.*?)\s*(?:Cost:\s*[^]*?)?Prerequisites?:\s*[^.]*?\s+([A-Z][^]*)$/);
  if (m) return { summary: m[1].trim(), body: m[2].trim() };
  return { summary: "", body: s.trim() };
}
const descBody = (text) => splitDescription(text).body;

export const ALL_SKILLS = skillsJson.map((s) => ({
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
  skillsJson.filter((s) => String(s.ranks).toLowerCase() === "unlimited").map((s) => s.name),
);

// Perk categories in the source use "Social/Background"; the UI groups under
// "Social". Normalize here so the UI's category list matches.
const PERK_CAT = { "Social/Background": "Social" };

export const ALL_PERKS = perksJson.map((p) => ({
  name: p.name,
  cost: p.cost,
  ranks: p.ranks,
  cat: PERK_CAT[p.category] || p.category,
  prereq: cleanPrereq(p.prereq),
  desc: descBody(p.description),
  summary: splitDescription(p.description).summary,
}));

export const ALL_FLAWS = flawsJson.map((f) => ({
  name: f.name,
  // Award/BP may be a number or a string like "1 or 2"; keep as-is and expose a
  // numeric value the BP math can use (the lower bound when it's a range).
  bp: typeof f.bp === "number" ? f.bp : parseInt(String(f.bp), 10) || 0,
  bpLabel: String(f.bp),
  ranks: f.ranks,
  cat: f.category,
  prereq: cleanPrereq(f.prereq),
  desc: descBody(f.description),
  summary: splitDescription(f.description).summary,
}));

// ─── ALLERGENS ────────────────────────────────────────────────────────────────
// Mild/Severe Allergy award a variable BP amount depending on the chosen substance
// ("Award: 1 or 2" / "2 or 3"). The per-substance award comes from the parser:
// scripts/parse-megadoc.js reads the rulebook's "Standard Allergens and Awards"
// table out of each flaw's detail prose into a structured `allergens` field. The
// engine just READS that field — no runtime prose scraping, no hardcoded substance
// lists. A MegaDoc edit to the table flows through on the next parse.
//
//   ALLERGEN_AWARDS = { 'Mild Allergy': { cloth: 2, gold: 1, … }, 'Severe Allergy': {…} }
//
// keyed by lowercased substance, value = BP awarded (a positive magnitude).
export const ALLERGEN_AWARDS = Object.fromEntries(
  flawsJson
    .filter((f) => f.allergens && Object.keys(f.allergens).length)
    .map((f) => [
      f.name,
      Object.fromEntries(Object.entries(f.allergens as Record<string, number>).map(([s, bp]) => [s.toLowerCase(), bp])),
    ]),
);

// The substances a given allergy flaw can take, in rulebook order — drives the
// picker. From the same parsed field, so picker options and awards never drift.
export function allergenOptions(flawName) {
  const f = flawsJson.find((x) => x.name === flawName);
  return Object.keys(f?.allergens || {});
}

// BP a given allergy flaw awards for a chosen substance. Returns null when the flaw
// isn't an allergy or no (recognized) substance is chosen yet — callers decide how
// to present an as-yet-undetermined award (the rulebook leaves it to Staff).
export function allergenAward(flawName, substance) {
  const table = ALLERGEN_AWARDS[flawName];
  if (!table) return null;
  const key = String(substance || "")
    .toLowerCase()
    .trim();
  return key && key in table ? table[key] : null;
}

// ─── CLASSES ──────────────────────────────────────────────────────────────────
// UI expects CLASSES keyed by name with { type, spellcaster, magicType,
// description, startingSkills, multiclassSkills }. Role/keyFeatures prose is not
// in the data (intentionally — to be parsed later), so it's simply omitted.

// Derived from the parsed class data, not hand-maintained — a class is a caster
// when its parsed type is 'Spellcaster', and its Divine/Arcane magicType is a
// parser-extracted field. A MegaDoc change to the class roster flows through here
// without edits. BASE_CLASSES is the canonical base-class set, shared by the
// validator and sheet logic so the list lives in exactly one place.
const MAGIC_TYPE = Object.fromEntries(classesJson.filter((c) => c.magicType).map((c) => [c.name, c.magicType]));
// Base (non-advanced) classes. Today every parsed class is a base class — Advanced
// Classes aren't in the MegaDoc yet ("published when the campaign draws closer").
// When they arrive the parser should mark them (e.g. type:'Advanced' or
// isAdvanced); exclude any such marker here so the base/advanced split stays correct.
export const BASE_CLASSES = new Set(
  classesJson.filter((c) => c.type !== "Advanced" && !("isAdvanced" in c && c.isAdvanced)).map((c) => c.name),
);

export const CLASSES = Object.fromEntries(
  classesJson.map((c) => [
    c.name,
    {
      type: c.type,
      spellcaster: c.type === "Spellcaster",
      magicType: c.magicType || MAGIC_TYPE[c.name] || null,
      description: c.description,
      startingSkills: c.startingSkills,
      multiclassSkills: c.multiclassSkills,
      multiclassGrants: c.multiclassGrants || [],
      // The parser does not emit class tags today, so this is always empty; a
      // "Martial Classes" prereq that reads it therefore never matches on tags.
      // Kept as a typed seam so that consumer (prereqs) type-checks and lights up
      // for free once the data carries tags. See wellspring-class-tags note.
      tags: (c as { tags?: string[] }).tags ?? ([] as string[]),
    },
  ]),
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
    ranks: p.ranks ?? 1,
    // Parser-extracted structured mechanics (read by the validator instead of
    // re-parsing the description). Keep this list in sync with enrichMechanics.
    statMods: [...(p.statMods ?? []), ...(p.statModNotes ?? [])],
    wealthIncome: p.wealthIncome ?? null,
    slotGrants: p.slotGrants ?? [],
    highestSlot: p.highestSlot ?? false,
    levelDiscounts: p.levelDiscounts ?? [],
    sharedWith: p.sharedWith ?? [],
    requiredLevel: p.requiredLevel ?? 0,
    requiredClass: p.requiredClass ?? null,
    requiresEntity: p.requiresEntity ?? [],
  };
}

export const CLASS_POWERS = Object.fromEntries(
  classesJson.map((c) => [
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
  ]),
);

// Which power list(s) a slot category draws from. Martial categories map 1:1 to
// a tier; the caster "spellsKnown" budget spans every learnable spell tier, so
// the picker offers them all under one budget. Keyed by the slot category names
// used in CLASS_POWER_SLOTS / validate.computeSlots.
export const SLOT_POWER_LISTS = {
  utility: ["utility"],
  basic: ["basic"],
  advanced: ["advanced"],
  veteran: ["veteran"],
  cantrips: ["cantrips"],
  spellsKnown: ["noviceSpells", "adeptSpells", "greaterSpells"],
  // Class Skills aren't slot-filled — they're BP-PURCHASED (like Domain Powers),
  // gated by having levels in the class. Mapped here so eligiblePowers can list
  // them for the purchase picker.
  classSkills: ["classSkills"],
};

// The powers a character may choose to fill a given slot category, i.e. every
// power in the class's lists for that category's tier(s). Each carries a `tier`
// label so the picker can group spells-known by novice/adept/greater. Returns []
// for unknown class/category.
export function eligiblePowers(className, category) {
  const lists = SLOT_POWER_LISTS[category];
  const byTier = CLASS_POWERS[className];
  if (!lists || !byTier) return [];
  return lists.flatMap((tier) =>
    (byTier[tier] || []).filter((p) => p.tier !== "SubPower").map((p) => ({ ...p, tierList: tier })),
  );
}

// Cantrip names from spellcasting classes of the given magic type(s) — the option
// pool a "learn a cantrip of your choice" lineage choice offers. Rules knowledge,
// kept in the engine so the UI doesn't re-derive it. Sorted, de-duped.
export function cantripOptions(magicTypes) {
  const want = new Set(magicTypes);
  const classes = Object.entries(CLASSES)
    .filter(([, c]) => c.type === "Spellcaster" && want.has(c.magicType))
    .map(([name]) => name);
  const cantrips = new Set();
  for (const cls of classes) {
    for (const p of CLASS_POWERS[cls]?.cantrips || []) cantrips.add(p.name);
  }
  return [...cantrips].sort();
}

// Divine-only pool (Divine Magic). Thin wrapper over cantripOptions.
export function divineCantripOptions() {
  return cantripOptions(["Divine"]);
}

// Spells choosable from any base spellcasting class of the given magic type(s), at
// the given spell tiers (cantrips/novice/…). Drives lineage picks like Arcane
// Aptitude ("a Cantrip or Novice spell from any Base arcane class"). `tiers` maps to
// the CLASS_POWERS fields.
const SPELL_TIER_FIELD = {
  cantrip: "cantrips",
  novice: "noviceSpells",
  adept: "adeptSpells",
  greater: "greaterSpells",
};
export function lineageSpellOptions(magicTypes, tiers = ["cantrip", "novice"]) {
  const want = new Set(magicTypes);
  const classes = Object.entries(CLASSES)
    .filter(([, c]) => c.type === "Spellcaster" && want.has(c.magicType))
    .map(([name]) => name);
  const spells = new Set();
  for (const cls of classes) {
    for (const tier of tiers) {
      const field = SPELL_TIER_FIELD[tier];
      for (const p of CLASS_POWERS[cls]?.[field] || []) {
        if (p?.name && !/^(Adept|Greater)\s+\w+\s+Power$/i.test(p.name)) spells.add(p.name);
      }
    }
  }
  return [...spells].sort();
}

// The [Repped] challenges a Lost character may rep, grouped by source lineage
// (every lineage other than Lost). Returns [[lineageName, challenges[]], …] for
// lineages that have at least one repped challenge. Rules knowledge — see Lost
// Life / Additional Lost Life.
export function lineageRepOptions() {
  return Object.entries(LINEAGES)
    .filter(([name]) => name !== "Lost")
    .map(([name, lin]) => [name, (lin.challenges || []).filter((c) => c.repped)])
    .filter(([, challenges]) => challenges.length > 0);
}

// Lost "Pick and Choose" (Fractured): may purchase ONE Lineage Advantage from
// ANOTHER lineage. Returns every non-Lost advantage shaped for the read-pane picker:
// { name (baseName), group (lineage), description, advId }. The chosen one is
// recorded as "<Lineage> - <Advantage>" so the graph can resolve it cross-lineage
// and apply its full effects (with prereqs still enforced).
export function pickAndChooseOptions() {
  const out: { name: string; group: string; description: string; advId: string }[] = [];
  for (const [lineage, lin] of Object.entries(LINEAGES)) {
    if (lineage === "Lost") continue;
    for (const a of lin.advantages || []) {
      const name = a.baseName || a.name;
      out.push({
        name,
        group: lineage,
        description:
          ("description" in a ? (a as { description?: string }).description : (a as { desc?: string }).desc) || "",
        advId: `${lineage} - ${name}`,
      });
    }
  }
  return out.sort((x, y) => x.group.localeCompare(y.group) || x.name.localeCompare(y.name));
}

// A lineage challenge/advantage that requires the player to record a SUB-CHOICE.
// Returns null for ordinary items, else { kind, ... }:
//   'cantrip' — learns a chosen, castable cantrip (granted + given a slot). `pool`
//               is the magic-type filter for cantripOptions. Divine Magic (Divine),
//               Psionic Cantrip (Arcane + Divine).
//   'rep'     — Lost Life / Additional Lost Life: rep a [Repped] challenge from
//               another lineage; its LBP becomes the award.
//   'flavor'  — a recorded string with NO mechanical effect (like a Lore parameter):
//               Elemental Expression (an Accent), Favored Gem (a gem).
// Keyed by baseName so the same mechanic is one code path, not a per-name special
// case. New choice items only need an entry here (no new component / wiring).
// Choice/parameter spec registries now live in ./choice-specs.js so adding a new
// pickable mechanic doesn't churn this file. Re-exported here so existing import
// paths (`from '../engine/data.js'`) keep working; also imported for the internal
// uses below (lineageItemImpact, lineageCantripChoices).
export {
  LINEAGE_CHOICE_SPECS,
  lineageChoiceSpec,
  POWER_SPELL_CHOICE_SPECS,
  powerSpellChoiceSpec,
} from "./choice-specs.js";

// Lineage cantrip CHOICES the character has actually recorded — the chosen cantrip
// for each owned cantrip-kind item (Divine Magic, Psionic Cantrip, …). Drives both
// the grant (graph.js) and the casting slot (slots.js) so neither special-cases a
// name. Returns [{ item: <baseName>, cantrip }]. Looks up the item across the
// character's lineage challenges + advantages.
// Human-readable mechanical impact of a lineage challenge/advantage, derived from
// its parser-extracted fields + grant edges. Returns a list of short strings the UI
// shows inline so a choice's effect on the character is obvious (pain #7). `lineage`
// is needed to resolve the grant-edge id. A `cantrip`/`rep`/`flavor` sub-choice item
// reports its choice nature instead of fixed mechanics.
const STAT_LABELS = {
  lifePoints: "Max Life",
  spikes: "Max Spikes",
  armor: "Armor",
  naturalArmor: "Natural Armor",
  wealth: "Wealth",
};
export function lineageItemImpact(item, lineage) {
  const spec = lineageChoiceSpec(item);
  if (spec?.kind === "cantrip") return ["grants a chosen cantrip (+slot to cast it)"];
  if (spec?.kind === "rep") return ["reps another lineage’s challenge for its LBP"];
  if (spec?.kind === "flavor") {
    const label = spec.label || "detail";
    const article = /^[aeiou]/i.test(label) ? "an" : "a";
    return [`pick ${article} ${label} (flavor)`];
  }

  const out: string[] = [];
  for (const m of item.statMods || []) {
    if ("text" in m && m.text) {
      out.push(m.text);
    } else if ("amount" in m) {
      const label = STAT_LABELS[m.stat] || m.stat;
      out.push(`${m.amount >= 0 ? "+" : ""}${m.amount} ${label}`);
    }
  }
  for (const g of item.slotGrants || []) {
    out.push(`+${g.n} ${g.cat} slot${g.n === 1 ? "" : "s"}`);
  }
  if (item.highestSlot) out.push("+1 highest spell-slot");
  if (item.wealthIncome?.n) out.push(`+${item.wealthIncome.n} Wealth`);
  // Fixed grants (Telekinesis Power, Magical Resilience perk, …).
  const base = item.baseName || item.name;
  const gid = lineage ? `advantages:${lineage} - ${base}` : null;
  const grants = gid ? REFS.grants?.[gid] || REFS.grants?.[`challenges:${lineage} - ${base}`] : null;
  for (const tid of grants || []) {
    const ent = lookupEntity(tid);
    out.push(`grants ${ent?.name || idNameLocal(tid)}`);
  }
  return out;
}
function idNameLocal(id) {
  const i = id.indexOf(":");
  return i >= 0 ? id.slice(i + 1) : id;
}

export function lineageCantripChoices(character): { item: string; cantrip: string }[] {
  const choices = character?.advantageChoices || {};
  const lin = character?.lineage && LINEAGES[character.lineage];
  if (!lin) return [];
  const out: { item: string; cantrip: string }[] = [];
  for (const it of [...(lin.challenges || []), ...(lin.advantages || [])]) {
    const base = it.baseName || it.name;
    const spec = LINEAGE_CHOICE_SPECS[base];
    if (spec?.kind === "cantrip" && choices[base]) {
      out.push({ item: base, cantrip: String(choices[base]) });
    }
  }
  return out;
}

type ClassJsonType = {
  name: string;
  type?: string;
  progression?: Record<string, ProgressionRow>;
  utilityPowers?: number;
  basicPowers?: number;
  advancedPowers?: number;
  veteranPowers?: number;
  cantrips?: number;
  spellsKnown?: number;
  slots?: string;
};

// Power-slot counts at the starting level come from the progression table's
// level-4 row, so they stay in sync with the source rather than being hardcoded.
export const CLASS_POWER_SLOTS: Record<string, ProgressionRow> = Object.fromEntries(
  classesJson.map((c: unknown) => {
    const cls = c as ClassJsonType;
    const lvl4 = cls.progression?.["4"] || {};
    if (cls.type === "Spellcaster") {
      return [
        cls.name,
        {
          cantrips: lvl4.cantrips ?? 0,
          spellsKnown: lvl4.spellsKnown ?? 0,
          slots: lvl4.slots ?? null,
        },
      ];
    }
    return [
      cls.name,
      {
        utility: lvl4.utility ?? 0,
        basic: lvl4.basic ?? 0,
        advanced: lvl4.advanced ?? 0,
        veteran: lvl4.veteran ?? 0,
      },
    ];
  }),
);

// Full per-level progression table per class (level → { cantrips, spellsKnown,
// slots, utility, basic, …, bonus }). The validator scans the `bonus` prose for
// level-granted features like the casters' "Innate Bonus Cantrip".
export const CLASS_PROGRESSION: Record<string, Record<number, ProgressionRow>> = Object.fromEntries(
  classesJson.map((c: unknown) => [(c as ClassJsonType).name, (c as ClassJsonType).progression || {}]),
);

// ─── LINEAGES ─────────────────────────────────────────────────────────────────
// UI expects LINEAGES keyed by name with challenges/advantages whose display
// names carry the [Repped]/[Required] tags and sublineage hints, matching the
// old inline format. We reconstruct those from the parsed flags.

function lineageItemName(it) {
  let n = it.name;
  if (it.repped) n += " [Repped]";
  if (it.required) n += " [Required]";
  if (it.sublineage && it.sublineage !== "General") n += ` (${it.sublineage})`;
  return n;
}

const lineageItem = (it) => ({
  name: lineageItemName(it),
  baseName: it.name,
  lbp: it.lbp ?? 0,
  required: it.required,
  repped: it.repped,
  sublineage: it.sublineage,
  desc: it.description,
  statMods: [...(it.statMods ?? []), ...(it.statModNotes ?? [])],
  wealthIncome: it.wealthIncome ?? null,
  slotGrants: it.slotGrants ?? [],
  highestSlot: it.highestSlot ?? false,
});

export const LINEAGES = Object.fromEntries(
  lineagesJson.map((l) => [
    l.name,
    {
      description: l.description,
      costume: l.costume,
      sublineages: l.sublineages.map((s) => (s.note ? `${s.name} (${s.note})` : s.name)),
      challenges: l.challenges.map(lineageItem),
      advantages: l.advantages.map(lineageItem),
    },
  ]),
);

// ─── DEVOTIONS ────────────────────────────────────────────────────────────────
// UI expects an array with { name, locality, domains, color, tenets } where
// tenets is a single string. Join the parsed tenet bullets.

export const DEVOTIONS = devotionsJson.map((d) => ({
  name: d.epithet ? `${d.name}, ${d.epithet}` : d.name,
  baseName: d.name,
  locality: d.locality,
  domains: d.domains,
  color: d.colorScheme || "",
  tenets: (d.tenets || []).join(" "),
  iconography: d.iconography || "",
  lore: d.lore || "",
}));

// ─── REFERENCE DATA (not yet surfaced in the wizard, available for later) ──────
export const DOMAINS = domainsJson;

// Divine Substitution: a Cleric may add a domain NOT in their Devotion's standard
// domains and NOT in direct opposition to any of them. Opposition comes from the
// parsed `opposedBy` field (the MegaDoc's Opposed Domains table). Returns the
// eligible domain names. `standard` is the Devotion's own domain list.
export function divineSubstitutionOptions(standard) {
  const std = new Set((standard || []).map((d) => String(d).split(":")[0].trim()));
  const opposedToStandard = new Set(DOMAINS.filter((d) => std.has(d.name) && d.opposedBy).map((d) => d.opposedBy));
  return DOMAINS.filter((d) => !std.has(d.name) && !opposedToStandard.has(d.name)).map((d) => d.name);
}
export const CRAFTING = craftingJson;
export const RITUALS = ritualsJson;

// ─── ARCHETYPES + REFS ────────────────────────────────────────────────────────
// Starter character templates and the cross-reference graph the builder uses
// to look up details, backlinks, and prereqs.
// Archetype definitions carry `name` directly (the parser emits it) — no alias.
// The CHARACTER built from one carries `archetypeName` as provenance (loadArchetype).
export const ARCHETYPES = archetypesJson;

// The cross-reference graph the linker emits (refs.json): per-entity-id maps of
// grant/discount/exclusion/prereq/mention edges. Typed here at the JSON boundary so
// consumers read REFS.prereqs[id] etc. without casting.
/** A perk's effect on the Lineage-BP economy: extra LBP granted and/or a raised cap. */
export interface LbpBonus {
  extra?: number;
  newMax?: number;
}
export interface RefsData {
  grants: Record<string, string[]>;
  discounts: Record<string, DiscountSpec>;
  excludes: Record<string, string[]>;
  prereqs: Record<string, { skills?: string[]; anyOf?: string[][]; levels?: string[]; other?: string[] }>;
  mentions: Record<string, string[]>;
  lbpBonuses: Record<string, LbpBonus>;
  [key: string]: unknown;
}
export const REFS = refsJson as RefsData;

// Lookup by entity id, e.g. "skills:Basic Faith" → { type, name, description, ... }.
// Used by the detail pane when an item card is clicked.
const ENTITY_INDEX = new Map();

// Two facets of entity identity, one source of truth:
//   - `type` (SINGULAR, e.g. 'skill') — the discriminator, stored on the object.
//   - collection (PLURAL, e.g. 'skills') — the id/key namespace.
// Code reads `.type` off the object and BUILDS keys via collectionOf(type); it must
// never parse an id string to recover either. This map bridges the two.
const SINGULAR_TYPE: Record<string, string> = {
  skills: "skill",
  perks: "perk",
  powers: "power",
  flaws: "flaw",
  classes: "class",
  spells: "spell",
  devotions: "devotion",
  domains: "domain",
  recipes: "recipe",
  rituals: "ritual",
  advantages: "advantage",
  challenges: "challenge",
};
const singularType = (collection: string): string => SINGULAR_TYPE[collection] ?? collection;
const PLURAL_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(SINGULAR_TYPE).map(([plural, singular]) => [singular, plural]),
);
/** The plural collection/key namespace for a singular entity type ('skill' →
 *  'skills'). Use to BUILD an id/lookup key from a resolved object's `.type`. */
export const collectionOf = (type: string): string => PLURAL_TYPE[type] ?? type;
// `splitDesc` (perks/flaws): strip the duplicated table-summary + Cost/Prereq
// boilerplate so the detail pane shows the full prose, keeping the summary as a
// separate field. Skills aren't split (no boilerplate) but parameterized ones
// are resolved on lookup (see lookupEntity).
type JsonRecord = Record<string, unknown>;
interface IndexOptions {
  nameKey?: string;
  extra?: (e: JsonRecord) => JsonRecord;
  splitDesc?: boolean;
}
const indexCollection = (
  items: JsonRecord[],
  type: string,
  { nameKey = "name", extra = () => ({}), splitDesc = false }: IndexOptions = {},
) => {
  for (const e of items) {
    const name = e[nameKey];
    if (!name) continue;
    const desc =
      splitDesc && e.description
        ? (() => {
            const { summary, body } = splitDescription(e.description);
            return { description: body, summary };
          })()
        : {};
    // `id` prefix is the plural COLLECTION path (perks:Foo); `type` is the SINGULAR
    // discriminator (perk). Two different concepts — deliberately not the same string.
    ENTITY_INDEX.set(`${type}:${name}`, {
      ...e,
      ...desc,
      ...extra(e),
      id: `${type}:${name}`,
      type: singularType(type),
      name,
    });
  }
};
indexCollection(skillsJson, "skills");
indexCollection(perksJson, "perks", { splitDesc: true });
indexCollection(flawsJson, "flaws", { splitDesc: true });
indexCollection(devotionsJson, "devotions");
indexCollection(domainsJson, "domains");
indexCollection(craftingJson, "recipes");
indexCollection(ritualsJson, "rituals");
for (const c of classesJson) {
  ENTITY_INDEX.set(`classes:${c.name}`, { ...c, id: `classes:${c.name}`, type: "class" });
  for (const s of c.specializations || []) {
    ENTITY_INDEX.set(`classes:${s.name}`, { ...s, id: `classes:${s.name}`, type: "class", parentClass: c.name });
  }
  const TIERS = [
    "innate",
    "utility",
    "basic",
    "advanced",
    "veteran",
    "classSkills",
    "rightHandPowers",
    "cantrips",
    "noviceSpells",
    "adeptSpells",
    "greaterSpells",
  ];
  for (const t of TIERS)
    for (const p of c[t] || []) {
      ENTITY_INDEX.set(`powers:${p.name}`, {
        tier: t,
        ...p,
        id: `powers:${p.name}`,
        type: "power",
        parentClass: c.name,
      });
    }
}
for (const d of domainsJson)
  for (const p of d.powers || []) {
    ENTITY_INDEX.set(`powers:${p.name}`, { ...p, id: `powers:${p.name}`, type: "power", domain: d.name });
  }
// Lineage advantages AND challenges. Keyed "<type>:<Lineage> - <name>" to match how
// the rules relations reference them (REFS.grants/discounts) and how ownedGrantSources
// builds the id — without this, grant/discount edges, descriptions, and the inspector
// resolve to nothing. `...item` carries the lineage facets (sublineage, repped,
// required, lbp, statMods, desc) straight onto the entity so they're browsable/
// filterable; `lineage` is added so it's a first-class facet too. Challenges were
// previously absent from the entity index entirely (so 105 of them were invisible to
// the Rules Explorer); registering them here makes them browsable like advantages.
for (const lin of lineagesJson) {
  for (const a of lin.advantages || []) {
    const id = `advantages:${lin.name} - ${a.name}`;
    ENTITY_INDEX.set(id, { ...a, id, type: "advantage", name: a.name, lineage: lin.name });
  }
  for (const c of lin.challenges || []) {
    const id = `challenges:${lin.name} - ${c.name}`;
    ENTITY_INDEX.set(id, { ...c, id, type: "challenge", name: c.name, lineage: lin.name });
  }
}

// ─── CONCEPT / GLOSSARY INDEX ──────────────────────────────────────────────────
// Index the rules-reference content so the linker's reference links (terms:,
// rules-concepts:, effects:, accents:, …) resolve. Field names vary per file, so
// normalize each entry to { name, description }. Multiple source files map to the
// same linker type (e.g. rules-concepts is spread across core-rules, combat-rules,
// power-words); they're merged into one type bucket.
const indexConcepts = (items, type, { nameKey = "name", descKey = "description" } = {}) => {
  for (const e of items || []) {
    const name = e[nameKey] ?? e.name ?? e.term ?? e.heading;
    if (!name) continue;
    const description = e[descKey] ?? e.description ?? e.definition ?? e.content ?? "";
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
        e.subConcepts.map((s) => (typeof s === "string" ? { name: s, description: "" } : s)),
        type,
      );
    }
  }
};

indexConcepts(glossaryJson, "terms", { nameKey: "term", descKey: "definition" });
indexConcepts(effectsJson, "effects");
indexConcepts(accentsJson, "accents");
indexConcepts(resourcesJson, "resources");
indexConcepts(modifiersJson, "modifiers");
indexConcepts(conditionsJson, "conditions");
indexConcepts(defenseCallsJson, "defenses");
indexConcepts(craftingConceptsJson, "crafting-concepts");
indexConcepts(ritualConceptsJson, "ritual-concepts");
indexConcepts(creatureTypesJson, "creature-types");
// rules-concepts content is spread across many doc-derived rules files — index
// all of them (recursing into subConcepts) under the one linker type so refs
// like rules-concepts:Spellcasting / Summoned Armor / Multi-Classing resolve.
// The intermediate JSON shape doesn't matter; it's regenerated from the doc.
for (const src of [
  coreRulesJson,
  combatRulesJson,
  restsJson,
  powerWordsJson,
  callsJson,
  gameMarkersJson,
  coreRulesMiscJson,
  craftingAllJson,
  advancementJson,
  deathDyingJson,
  wealthJson,
  powersJson,
  devotionsBeingsJson,
  introductionJson,
]) {
  indexConcepts(src, "rules-concepts", { nameKey: "name", descKey: "description" });
}

// Canonical-name fallback: the linker's type prefix doesn't always match where
// the content actually lives (e.g. it emits `terms:Long Rest` but the entry is
// indexed under `rules-concepts:Long Rests`). Build a map from a normalized name
// to the best entity id so lookup can recover across that mismatch.
const canon = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[“”"’‘]/g, "")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(\w)s$/, (m, c) => (c === "s" ? m : c)); // drop trailing plural -s
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
  [/^apprentice profession\b/i, () => "Profession - Apprentice"],
  [/^journeyman profession\b/i, () => "Profession - Journeyman"],
  [/^master profession\b/i, () => "Profession - Master"],
  // "Lore: Nature" / "Lore [Shadow]" → "Lore (Nature)" / "Lore (Shadow)"
  [/^lore(?::\s*\[?|\s+\[)([^\]]+)\]?$/i, (m) => `Lore (${m[1]})`],
];
const ALIAS_EXACT = {
  scavenge: "Scavenge I",
  "basic lock skill": "Basic Locks",
  "basic trap skill": "Basic Traps",
  "bits & pieces": "Bits and Pieces",
  "two-weapon style": "Two Weapon Style",
  "ritual lore": "Lore (Ritual)",
};
function applySkillAlias(name) {
  const lower = name.trim().toLowerCase();
  if (ALIAS_EXACT[lower]) return ALIAS_EXACT[lower];
  for (const [re, fn] of ALIAS_PATTERNS) {
    const m = name.match(re);
    if (m) return name.replace(re, (fn as (match: RegExpMatchArray) => string)(m));
  }
  return name;
}

// Lookup by entity id, e.g. "skills:Basic Faith" → { type, name, description, ... }.
// Falls back to a canonical-name match across all types when the exact id misses,
// so reference links resolve despite linker/file namespace differences.
export const lookupEntity = (id: string | null | undefined): Entity | null => {
  if (!id) return null;
  const baseId = id.includes("|") ? id.split("|")[0] : id;
  const direct = ENTITY_INDEX.get(baseId);
  if (direct) return direct;
  const type = baseId.slice(0, baseId.indexOf(":"));
  let name = baseId.slice(baseId.indexOf(":") + 1);

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
    i: 1,
    ii: 2,
    iii: 3,
    iv: 4,
    v: 5,
    vi: 6,
    vii: 7,
    viii: 8,
    ix: 9,
    x: 10,
    xi: 11,
    xii: 12,
    xiii: 13,
    xiv: 14,
    xv: 15,
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
  // Purely-numeric parens are a COST annotation, not a parameter ("Two Weapon Style
  // (2)" / "Weapon Specialization (4)" / "Short Weapons (3)" all just note the skill's
  // BP cost — there's no skill named "2"/"3"/"4"). Resolve to the bare base skill so
  // these names don't become spurious parameterized entities.
  if (paramMatch && /^\d+$/.test(paramMatch[2].trim())) {
    const base =
      ENTITY_INDEX.get(`${type}:${paramMatch[1].trim()}`) ||
      (NAME_INDEX.get(canon(paramMatch[1])) && ENTITY_INDEX.get(NAME_INDEX.get(canon(paramMatch[1]))));
    if (base) return { ...base, name, baseName: base.name };
    paramMatch = null; // fall through to other resolution if the base isn't known
  }
  if (!paramMatch) {
    const dashIdx = name.indexOf(" - ");
    if (dashIdx > 0) {
      paramMatch = [name, name.slice(0, dashIdx).trim(), name.slice(dashIdx + 3).trim()];
    }
  }
  if (paramMatch) {
    const base =
      ENTITY_INDEX.get(`${type}:${paramMatch[1].trim()}`) ||
      (NAME_INDEX.get(canon(paramMatch[1])) && ENTITY_INDEX.get(NAME_INDEX.get(canon(paramMatch[1]))));
    if (base) return { ...base, name, baseName: base.name, parameter: paramMatch[2].trim() };
  }
  return null;
};

export const getAllEntities = () => Array.from(ENTITY_INDEX.values());
