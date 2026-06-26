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


export const SPELL_TIERS = new Set(['novice', 'adept', 'greater']);
export const SLOT_CATS = ['cantrips', 'spellsKnown', 'utility', 'basic', 'advanced', 'veteran'];
export const BOOKCASTER_TIER_FIELD = { novice: 'noviceSpells', adept: 'adeptSpells', greater: 'greaterSpells' };
export const KNOWN_SPELL_FIELDS = ['noviceSpells', 'adeptSpells', 'greaterSpells'];

// ─── Crafting Systems ───────────────────────────────────────────────────────
export const CRAFT_DISCIPLINES = {
  Alchemy: 'Alchemy',
  Tinkering: 'Tinkering',
  Enchanting: 'Enchanting'
};

export const CRAFTING_TIERS = ['Apprentice', 'Journeyman', 'Greater'];

// ─── Equipment & Skills ─────────────────────────────────────────────────────
export const ARMOR_SKILLS = [
  'Basic Armor', 'Light Armor', 'Medium Armor', 'Heavy Armor', 'Ironclad Armor'
];

// (Allergen common/uncommon split is no longer hardcoded — the per-substance
// award is derived from each allergy flaw's rulebook table; see ALLERGEN_AWARDS
// in data.js.)

// ─── Character State Field Mappings ─────────────────────────────────────────
export const BP_FIELDS = ['purchasedSkills', 'purchasedPerks'];
export const BP_POWER_FIELDS = ['domainPowers', 'classPowers', 'formPowers'];
export const MARTIAL_SLOT_FIELDS = {
  utility: 'utilityPowers',
  basic: 'basicPowers',
  advanced: 'advancedPowers',
  veteran: 'veteranPowers',
};
export const CASTER_SLOT_FIELDS = {
  cantrips: 'cantrips',
  spellsKnown: ['noviceSpells', 'adeptSpells', 'greaterSpells'],
};

export const ENTITY_FIELDS = [
  'startingSkills', 'purchasedSkills', 'purchasedPerks',
  'innatePowers', 'utilityPowers', 'basicPowers', 'advancedPowers',
  'veteranPowers', 'classPowers', 'rightHandPowers', 'cantrips',
  'noviceSpells', 'adeptSpells', 'greaterSpells', 'bookSpells',
  'domainPowers', 'formPowers',
];

export const POWER_SOURCE_FIELDS = [
  'innatePowers', 'utilityPowers', 'basicPowers', 'advancedPowers',
  'veteranPowers', 'classPowers', 'rightHandPowers', 'domainPowers', 'formPowers',
  'cantrips', 'noviceSpells', 'adeptSpells', 'greaterSpells', 'bookSpells',
];

export const CLASS_POWER_TIERS = new Set(['Class', 'classSkills']);
