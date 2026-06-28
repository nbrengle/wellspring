/**
 * src/engine/types.ts
 * Type definitions for the Wellspring Rules Engine.
 * This defines both the static definitions (from JSON) and the player's Character State.
 */

// ─── 1. Core Data Models (The Rules) ────────────────────────────────────────

export interface SlotGrant {
  cat: string;
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
  amount: number | string;
}

// ─── Discriminated Union for Entities ───────────────────────────────────────

export interface BaseEntity {
  name: string;
  description?: string;
  prereq?: string;
  
  // Mechanically extracted prerequisites
  requiredLevel?: number;
  requiredClass?: string;
  requiresEntity?: string[];
}

export interface Skill extends BaseEntity {
  type: 'skill';
  cost: number | string;
  ranks?: number;
  category?: string; // e.g. "Martial", "Crafting"
  slotGrants?: SlotGrant[];
  stats?: StatMod[];
  chooseOne?: ChooseOneConfig;
}

export interface Power extends BaseEntity {
  type: 'power';
  tier: 'Basic' | 'Advanced' | 'Veteran' | 'Utility' | 'Class';
  parentClass?: string;
  parameter?: string; // E.g. (Swords)
  highestSlot?: number;
}

export interface Spell extends BaseEntity {
  type: 'spell';
  tier: 'Cantrip' | 'Novice' | 'Adept' | 'Greater';
  sphere: string; // e.g. "Arcane", "Divine"
  magicType?: string; 
}

export interface Perk extends BaseEntity {
  type: 'perk';
  cost: number | string;
  ranks?: number;
  category?: string;
}

export interface Flaw extends BaseEntity {
  type: 'flaw';
  award: number | string;
  category?: string;
}

export interface Class extends BaseEntity {
  type: 'class';
  spellcaster?: boolean;
  magicType?: string;
}

/** 
 * A discriminated union of all possible entities that can be returned by the data layer. 
 * Allows the engine to narrow the type via `if (ent.type === 'spell') { ... }`.
 */
export type Entity = Skill | Power | Spell | Perk | Flaw | Class;


// ─── 2. Ontological Character State (V2) ────────────────────────────────────

/** 
 * Represents where a capability was acquired. 
 */
export type EntitySource = 'Purchased' | `Class:${string}` | 'Lineage' | `GrantedBy:${string}` | string;

/**
 * A choice made by the player to add an entity to their sheet.
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

export interface CharacterStateV2 {
  archetypeName?: string;
  backstoryApproved?: boolean;
  extraMaxBP?: number;
  currentEvent?: number;
  wealth?: string;
  resources?: string;
  
  classes: Record<string, number>; 
  lineage?: { name: string; choices: string[] };
  devotions: CharacterChoice[];    
  
  skills: CharacterChoice[];
  perks: CharacterChoice[];
  flaws: CharacterChoice[];
  
  powers: CharacterChoice[];       
  spells: CharacterChoice[];       
  
  agileLearnerTrades?: Record<string, number>;
}

// ─── 3. Graph Types ─────────────────────────────────────────────────────────

export interface Effect {
  type: string;
  [key: string]: any;
}

export interface GraphItem {
  id: string;
  name: string;
  rawString?: string;
  field: string;
  sourceType: string;
  rank: number;
  baseCost: number;
  authoredCost?: number;
  grantSidecar?: any;
  entity?: Entity | null;
  effects: Effect[];
  specialty?: any;
  floor?: number;
  choiceData?: CharacterChoice;
  index?: number;
  grantedBy?: string;
  grantKind?: string;
}


export type ViewState = {
  param?: string;
  source: string;
  grantedBy?: string;
  free: boolean;
  cost: number;
  rank: number;
};

export type SkillView = Skill & ViewState;
export type PowerView = Power & ViewState;
export type SpellView = Spell & ViewState;
export type PerkView = Perk & ViewState;
export type FlawView = Flaw & ViewState;
export type ClassView = Class & { level: number };

export interface BucketedView {
  classes:       ClassView[];
  innatePowers:  PowerView[];
  basicPowers:   PowerView[];
  advancedPowers:PowerView[];
  veteranPowers: PowerView[];
  utilityPowers: PowerView[];
  classPowers:   PowerView[];
  domainPowers:  PowerView[];
  skills:        SkillView[];
  perks:         PerkView[];
  flaws:         FlawView[];
  knownSpells:   SpellView[];
}

export interface CharacterGraph {
  character: CharacterStateV2;
  items: GraphItem[];
  characterLevel: number;
  classes: Record<string, number>;
}
