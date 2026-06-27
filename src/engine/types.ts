/**
 * src/engine/types.ts
 * Type definitions for the Wellspring Rules Engine.
 * This defines both the static definitions (from JSON) and the player's Character State.
 */

// ─── 1. Core Data Models (The Rules) ────────────────────────────────────────

export interface SlotGrant {
  cat: string; // e.g. "basic", "cantrip", "spellsKnown"
  n: number;
}

export interface ChoiceOption {
  text: string;
  grants?: string[];
  grantsSkill?: boolean;
}

export interface ChooseOneConfig {
  kind: 'build' | 'play';
  options: ChoiceOption[];
}

export interface StatMod {
  stat: string;
  amount: number | string; // sometimes a string like "+1/rank"
}

export interface EntityDef {
  name: string;
  cost?: number | string;
  prereq?: string;
  ranks?: number;
  category?: string;
  description?: string;
  
  // Mechanically extracted fields
  requiredLevel?: number;
  requiredClass?: string;
  requiresEntity?: string[];
  slotGrants?: SlotGrant[];
  highestSlot?: number;
  stats?: StatMod[];
  chooseOne?: ChooseOneConfig;
  tier?: string;
  parentClass?: string;
  parameter?: string;
  
  // Specific to classes
  spellcaster?: boolean;
  magicType?: string;
  
  // Specific to spells
  sphere?: string;
}

// ─── 2. Ontological Character State (V2) ────────────────────────────────────

/** 
 * Represents where a capability was acquired. 
 * E.g. "Class:Rogue", "Purchased", "Lineage", "StartingChoice:A Path Unfolds"
 */
export type EntitySource = 'Purchased' | `Class:${string}` | 'Lineage' | `GrantedBy:${string}` | string;

/**
 * A choice made by the player to add an entity (Skill, Power, etc.) to their sheet.
 */
export interface CharacterChoice {
  id: string;             // UUID for safe targeted deletion/updates
  entityId: string;       // The canonical name/key of the entity in the rules database
  source: EntitySource;   // Where this capability came from
  
  // Overrides & Metadata
  costOverride?: number;  // E.g. from Apprentice Alchemy discount (-1)
  parameter?: string;     // If the choice requires a parameter (e.g. Weapon Specialization - Swords)
  ranks?: number;         // For multi-rank purchases like Agile Learner
}

/**
 * The unified, ontologically-grouped character save state.
 * All choices are stored in buckets that mirror their nature in the rules.
 */
export interface CharacterStateV2 {
  // Foundational Metadata
  archetypeName?: string;
  backstoryApproved?: boolean;
  extraMaxBP?: number;
  currentEvent?: number;
  wealth?: string;
  resources?: string;
  
  // Core Paths
  classes: Record<string, number>; // className -> level
  lineage?: { name: string; choices: string[] };
  devotions: CharacterChoice[];    // Devotion Accents, Interventions
  
  // Acquired Capabilities (The Ontological Buckets)
  skills: CharacterChoice[];
  perks: CharacterChoice[];
  flaws: CharacterChoice[];
  
  powers: CharacterChoice[];       // Class powers, Domain powers, Form powers
  spells: CharacterChoice[];       // Cantrips, Novice, Adept, Greater
  
  // Specific Trades
  agileLearnerTrades?: Record<string, number>;
}
