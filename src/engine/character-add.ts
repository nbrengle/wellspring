// character-add.ts — the ONE "add a thing to a character" API.
//
// A character owns exactly one way to gain an entity: this module. Every producer
// — the UI reducers, the archetype loader, the sheet importer, the test factory —
// funnels through `addToCharacter`, so the rules for "where does a skill/perk/power/
// spell/flaw land, and with what source" live in a SINGLE place and can never drift
// between producers.
//
// The caller passes intent — a name (and, only when it can't be derived, a granting
// class or a parameter). The API looks the entity up and DERIVES the rest from the
// rules data: which bucket, which EntitySource, the costField that keys the BP
// ledger. Callers never name a bucket, a Source.*, or a costField themselves —
// those are the character's internals, not the caller's concern.

import type { CharacterState, CharacterChoice, EntitySource, Entity } from "./types.js";
import { Source } from "./types.js";
import { lookupEntity } from "./data.js";
import { getClasses } from "./resolver.js";

// tier (e.g. 'Basic') → the costField that keys its BP-ledger prefix ('basicPowers').
// Slot powers/spells key by tier; purchased/granted ones by their own field.
const POWER_TIER_FIELD: Record<string, string> = {
  Basic: "basicPowers",
  Advanced: "advancedPowers",
  Veteran: "veteranPowers",
  Utility: "utilityPowers",
};
const SPELL_TIER_FIELD: Record<string, string> = {
  Cantrip: "cantrips",
  Novice: "noviceSpells",
  Adept: "adeptSpells",
  Greater: "greaterSpells",
};

// Caster tiers — a 'power'-typed entity with one of these tiers is a SPELL (the data
// models spells as powers whose tier is a caster tier). Bucket routing keys on this,
// not on `type` alone. `tier` lives on BaseEntity, so it reads off any Entity.
const CASTER_TIERS = new Set<string>(["Cantrip", "Novice", "Adept", "Greater"]);
const isSpellEntity = (ent: Entity | null): boolean =>
  !!ent && (ent.type === "spell" || (ent.tier != null && CASTER_TIERS.has(ent.tier)));

/** Which bucket an entity lives in. Spells are powers with a caster tier, so we
 *  route on the entity, not the bare type. A null entity (unknown name) → skills. */
function bucketOf(ent: Entity | null): keyof Pick<CharacterState, "skills" | "perks" | "powers" | "spells" | "flaws"> {
  if (isSpellEntity(ent)) return "spells";
  switch (ent?.type) {
    case "perk":
      return "perks";
    case "power":
      return "powers";
    case "flaw":
      return "flaws";
    case "skill":
    default:
      return "skills";
  }
}

export interface AddOpts {
  /** Granting class for a slot power/spell, when it can't be derived (multiclass,
   *  or the entity has no unique parentClass). Defaults to the entity's parentClass,
   *  else the character's sole class. */
  cls?: string;
  /** Parameter value for a parameterized pick (e.g. 'Arcane' for Lore) — caller
   *  intent, never derivable. Appended to the entityId as "Name (param)". */
  param?: string;
  /** Explicit BP override (the sheet's authored effective cost). */
  cost?: number;
  /** Rank for multi-rank picks (Agile Learner). Defaults to 1. */
  ranks?: number;
  /** Force the provenance instead of deriving it — e.g. a starting skill
   *  (Source.starting), an innate power, or a Bookcaster-granted book spell. The
   *  common path omits this and lets the API derive purchased/class. */
  source?: EntitySource;
  /** Force the costField instead of deriving from tier (e.g. a Novice book spell
   *  keyed 'bookSpells', or a class power keyed 'classPowers'). */
  costField?: string;
  /** Field-driven callers (the UI reducers know the slot field the user clicked)
   *  can pass it so the costField + spell/power bucket follow the field, not the
   *  entity's canonical tier. Rarely needed — the entity derivation is the norm. */
  field?: string;
}

// Spell fields — a field-driven add whose field is one of these lands in `spells`.
const SPELL_FIELDS = new Set(["cantrips", "spellsKnown", "noviceSpells", "adeptSpells", "greaterSpells", "bookSpells"]);

/** Derive the EntitySource for a freshly-added entity from its type/tier + the
 *  granting class. Slot powers/spells are class-sourced (free); everything else the
 *  player buys is purchased. Callers override via opts.source for starting/innate/
 *  granted provenance. */
function deriveSource(ent: Entity | null, cls: string | undefined): EntitySource {
  const tier = ent?.tier;
  // Caster slot spells (cantrips + spells-known) are class-sourced (free).
  if (isSpellEntity(ent)) return Source.class(cls || "");
  if (ent?.type === "power") {
    // Innate powers are class grants (level-gated), not player picks.
    if (tier === "Innate") return Source.innate(cls);
    // Basic/Advanced/Veteran/Utility fill a class slot (free); Class-tier powers
    // (classPowers) are purchased.
    if (tier && POWER_TIER_FIELD[tier]) return Source.class(cls || "");
    return Source.purchased();
  }
  if (ent?.type === "flaw") return Source.flaw();
  // skills + perks the player buys (and the unknown-name fallback).
  return Source.purchased();
}

/** Derive the costField (BP-ledger key prefix) from the entity's tier. Skills/perks
 *  key by their own bucket, so they get no costField. Callers override via
 *  opts.costField for classPowers/domainPowers/bookSpells. */
function deriveCostField(ent: Entity | null): string | undefined {
  const tier = ent?.tier;
  if (isSpellEntity(ent)) return (tier && SPELL_TIER_FIELD[tier]) || "noviceSpells";
  if (ent?.type === "power") {
    if (tier === "Innate") return "innatePowers";
    return (tier && POWER_TIER_FIELD[tier]) || "classPowers";
  }
  return undefined;
}

// ─── Sheet-field → EntitySource ─────────────────────────────────────────────
// The archetype HTML + the character-sheet importer parse a SECTION HEADER
// ("Basic Powers:", "Purchased Skills:") into a field, and the section is the
// authority on provenance (not the entity). This maps that field to its source —
// the single place the "which section means which source" rule lives, shared by
// both text parsers. `primaryClass` fills class/starting sources.
export function sourceForField(field: string, primaryClass: string): EntitySource {
  switch (field) {
    case "startingSkills":
      return Source.starting(primaryClass);
    case "innatePowers":
      return Source.innate();
    case "bookSpells":
      return Source.granted("Bookcaster");
    // Slot powers + all caster spells fill a class slot (free) — sourced to the class.
    case "utilityPowers":
    case "basicPowers":
    case "advancedPowers":
    case "veteranPowers":
    case "formPowers":
    case "cantrips":
    case "spellsKnown":
    case "noviceSpells":
    case "adeptSpells":
    case "greaterSpells":
      return Source.class(primaryClass);
    case "flaws":
      return Source.flaw();
    // Everything else the sheet lists is bought with BP.
    default:
      return Source.purchased();
  }
}

// Which bucket a parsed SECTION field lands in (routes by field, the section's
// authority — not by looking the entity up).
type PowerBucket = keyof Pick<CharacterState, "skills" | "perks" | "powers" | "domainPowers" | "spells" | "flaws">;
const FIELD_BUCKET: Record<string, PowerBucket> = {
  startingSkills: "skills",
  purchasedSkills: "skills",
  purchasedPerks: "perks",
  flaws: "flaws",
  domainPowers: "domainPowers",
};
export function bucketForField(field: string): PowerBucket {
  return FIELD_BUCKET[field] ?? (SPELL_FIELDS.has(field) ? "spells" : "powers");
}

// A parsed item from a sheet (archetype HTML or an imported character sheet): the
// section field it fell under + the raw name, plus any BP/rank the line carried.
// The single intermediate both text parsers emit — a dumb "add this named thing to
// this section", meaningless on its own.
export interface ParsedItem {
  field: string;
  name: string;
  cost?: number | null; // authored effective BP (null/undefined = derive at resolve)
  rank?: number;
}

/** Turn a parsed item into a CharacterChoice for its bucket — the shared "build"
 *  step both text parsers use, so neither re-implements the flat→bucket zip. The
 *  section field decides source (sourceForField) + costField; the entityId is the
 *  raw name VERBATIM — the engine resolves the "Base - Tier (Param)" form itself
 *  (extractParam at node creation), so no separate `parameter` field is needed. */
export function choiceFromParsed(item: ParsedItem, primaryClass: string): CharacterChoice {
  const choice: CharacterChoice = {
    entityId: item.name,
    source: sourceForField(item.field, primaryClass),
    costField: item.field,
  };
  if (item.cost != null) choice.costOverride = item.cost;
  if (item.rank && item.rank > 1) choice.ranks = item.rank;
  return choice;
}

/**
 * Add an entity (by name) to a character, returning a new character. The bucket,
 * source, and costField are DERIVED from the entity unless overridden in `opts`.
 * Idempotent for non-repeatable entities is the caller's concern (the UI reducers
 * dedupe); this primitive appends.
 */
export function addToCharacter(char: CharacterState, name: string, opts: AddOpts = {}): CharacterState {
  const ent: Entity | null = lookupEntity(name);
  // A caller-supplied field wins the bucket routing (the UI knows the slot clicked);
  // otherwise derive from the entity (spells are powers with a caster tier).
  const bucket = opts.field && SPELL_FIELDS.has(opts.field) ? "spells" : bucketOf(ent);

  const cls = opts.cls ?? ent?.parentClass ?? (getClasses(char).length === 1 ? getClasses(char)[0].name : undefined);

  const entityId = opts.param ? `${name} (${opts.param})` : name;
  const source = opts.source ?? deriveSource(ent, cls);
  const costField = opts.costField ?? opts.field ?? deriveCostField(ent);

  const choice: CharacterChoice = {
    entityId,
    source,
    ranks: opts.ranks ?? 1,
    ...(costField ? { costField } : {}),
    ...(opts.cost != null ? { costOverride: opts.cost } : {}),
    ...(opts.param ? { parameter: opts.param } : {}),
  };

  return { ...char, [bucket]: [...(char[bucket] || []), choice] };
}
