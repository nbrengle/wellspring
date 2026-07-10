// config.js — Centralized Domain Configuration
//
// This file acts as the single source of truth for all hardcoded game rules,
// strings, and domain concepts. By keeping these arrays and sets here, the
// core engine calculation loops remain purely mathematical and agnostic.
// If the game designers rename a skill or add a new spellcaster class,
// you only need to update this file.

// ─── Economy & Level Constants ──────────────────────────────────────────────
export const MAX_LBP = 10;
export const MAX_FLAW_BP = 5;
export const BACKSTORY_BP = 2;
export const MAX_DOMAINS = 2;
export const DEFAULT_WEALTH = 8;
export const LEVEL_CAP = 10;

// ─── Character Storage Buckets ──────────────────────────────────────────────
// The SINGLE source of truth for the CharacterChoice[] buckets on CharacterState.
// Every producer inits these (EMPTY_CHARACTER, the sheet importer, the archetype
// parser) and the add-path types against them — all DERIVED from this list, so a
// new bucket is declared once here (plus its field on CharacterState) and can't
// drift across the init/type sites. NOT the materialized view (BucketedView) or
// the owned/classified sets — those are view concepts with their own shape.
export const CHARACTER_BUCKETS = ["skills", "perks", "flaws", "powers", "domainPowers", "spells"] as const;

/** A fresh, empty set of the storage buckets — the one place that materializes the
 *  `{ skills: [], perks: [], … }` shape. Every character producer spreads this so
 *  none re-lists the buckets by hand. */
export function emptyBuckets(): Record<(typeof CHARACTER_BUCKETS)[number], []> {
  return Object.fromEntries(CHARACTER_BUCKETS.map((b) => [b, []])) as Record<(typeof CHARACTER_BUCKETS)[number], []>;
}

export const SPELL_TIERS = new Set(["novice", "adept", "greater"]);
export const SLOT_CATS = ["cantrips", "spellsKnown", "utility", "basic", "advanced", "veteran"];
export const BOOKCASTER_TIER_FIELD = { novice: "noviceSpells", adept: "adeptSpells", greater: "greaterSpells" };
export const KNOWN_SPELL_FIELDS = ["noviceSpells", "adeptSpells", "greaterSpells"];

// ─── Crafting Systems ───────────────────────────────────────────────────────
export const CRAFT_DISCIPLINES = {
  Alchemy: "Alchemy",
  Tinkering: "Tinkering",
  Enchanting: "Enchanting",
};

export const CRAFTING_TIERS = ["Apprentice", "Journeyman", "Greater"];

// ─── Equipment & Skills ─────────────────────────────────────────────────────
export const ARMOR_SKILLS = new Set(["Basic Armor", "Light Armor", "Medium Armor", "Heavy Armor", "Ironclad Armor"]);

// (Allergen common/uncommon split is no longer hardcoded — the per-substance
// award is derived from each allergy flaw's rulebook table; see ALLERGEN_AWARDS
// in data.js.)

// ─── Character State Field Mappings ─────────────────────────────────────────
export const MARTIAL_SLOT_FIELDS = {
  utility: "utilityPowers",
  basic: "basicPowers",
  advanced: "advancedPowers",
  veteran: "veteranPowers",
};
export const CASTER_SLOT_FIELDS = {
  cantrips: "cantrips",
  spellsKnown: ["noviceSpells", "adeptSpells", "greaterSpells"],
};

// Every character field that stores a POWER entity. Used as a MEMBERSHIP set —
// "is this field a power field?" (e.g. to classify or skip it). Not all of these
// should be blindly ITERATED to materialize owned items: see GENERIC_POWER_FIELDS.
export const POWER_SOURCE_FIELDS = [
  "innatePowers",
  "utilityPowers",
  "basicPowers",
  "advancedPowers",
  "veteranPowers",
  "classPowers",
  "rightHandPowers",
  "domainPowers",
  "formPowers",
  "cantrips",
  "noviceSpells",
  "adeptSpells",
  "greaterSpells",
  "bookSpells",
];

// Fields whose stored entries the GENERIC "walk the field and add an owned item"
// loop should materialize. This excludes any power field that has a DEDICATED
// derivation owning it end-to-end — `innatePowers` is fully resolved by
// activeInnatePowers() (it merges class-granted + stored innates, deduped), so
// iterating it generically too would double-count every stored innate power.
export const FIELDS_WITH_DEDICATED_HANDLER = new Set(["innatePowers"]);
export const GENERIC_POWER_FIELDS = POWER_SOURCE_FIELDS.filter((f) => !FIELDS_WITH_DEDICATED_HANDLER.has(f));
