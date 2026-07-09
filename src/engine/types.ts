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
  /** Type-prefixed id, e.g. "skills:Lore". Attached by the entity index. */
  id?: string;
  /** Name with any parameter suffix stripped ("Lore (Arcane)" → "Lore"). */
  baseName?: string;
  /** The parameter type/value when the item takes one (e.g. "Area of Lore"). */
  parameter?: string;
  description?: string;
  prereq?: string;
  category?: string;
  /** Tier label (Basic/Advanced/…/SubPower) — on powers/spells, but read broadly. */
  tier?: string;
  /** Rank tiers (each may gate on a character level), for tiered perks/skills. */
  tiers?: { cost?: number; level?: number }[];
  /** The class this belongs to (powers/class skills). */
  parentClass?: string;
  /** Parser-extracted stat modifiers + free-text stat notes. */
  statMods?: StatMod[];
  statModNotes?: { stat: string; [k: string]: unknown }[];

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
  innate?: { name: string; requiredLevel?: number }[];
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
 * Represents where a capability was acquired — a STRUCTURED discriminated union on
 * `type`, so consumers read `source.type` / `source.name` instead of parsing a
 * compound `'Class:Fighter'` string. Compound source strings do NOT exist in the
 * engine anymore (and never leak into refs.json — that stays name-keyed).
 *
 *  - purchased : bought with BP (skills, perks, classPowers, spells).
 *  - class     : fills a class-progression slot (basic/advanced/veteran/utility
 *                power) — FREE; `name` is the granting class.
 *  - starting  : a class's granted starting skill; `class` is that class.
 *  - innate    : a class innate power (level-gated grant); `class` when known.
 *  - granted   : granted by another owned entity; `by` is that entity.
 *  - lineage   : granted by the character's lineage.
 *  - flaw      : a flaw (awards BP).
 */
export type EntitySource =
  | { type: 'purchased' }
  | { type: 'class'; name: string }
  | { type: 'starting'; class: string }
  | { type: 'innate'; class?: string }
  | { type: 'granted'; by: string }
  | { type: 'lineage' }
  | { type: 'flaw' };

// ─── EntitySource constructors + readers ────────────────────────────────────
// Constructors keep source-object creation in one place; readers let call-sites
// ask a structural question instead of switching on `type` inline.

export const Source = {
  purchased: (): EntitySource => ({ type: 'purchased' }),
  class: (name: string): EntitySource => ({ type: 'class', name }),
  starting: (cls: string): EntitySource => ({ type: 'starting', class: cls }),
  innate: (cls?: string): EntitySource => ({ type: 'innate', ...(cls ? { class: cls } : {}) }),
  granted: (by: string): EntitySource => ({ type: 'granted', by }),
  lineage: (): EntitySource => ({ type: 'lineage' }),
  flaw: (): EntitySource => ({ type: 'flaw' }),
};

export const isPurchased = (s: EntitySource | undefined): boolean => s?.type === 'purchased';
export const isStarting = (s: EntitySource | undefined): boolean => s?.type === 'starting';
export const isInnate = (s: EntitySource | undefined): boolean => s?.type === 'innate';
export const isFlaw = (s: EntitySource | undefined): boolean => s?.type === 'flaw';

/** The class a choice belongs to, when its source names one (class-slot, starting,
 *  or innate power). null otherwise. Replaces the old sourceClass('Class:X') parse. */
export function sourceClass(s: EntitySource | undefined): string | null {
  if (!s) return null;
  if (s.type === 'class') return s.name;
  if (s.type === 'starting') return s.class;
  if (s.type === 'innate') return s.class ?? null;
  return null;
}

/** The granting entity when the source is a grant (else null). */
export function grantedBy(s: EntitySource | undefined): string | null {
  return s?.type === 'granted' ? s.by : null;
}

/**
 * A choice made by the player to add an entity to their sheet.
 */
export interface CharacterChoice {
  entityId: string;       // The canonical name/key of the entity in the rules database
  source: EntitySource;   // Where this capability came from

  // Overrides & Metadata
  costOverride?: number;  // E.g. from Apprentice Alchemy discount (-1)
  parameter?: string;     // If the choice requires a parameter (e.g. Weapon Specialization - Swords)
  ranks?: number;         // For multi-rank purchases like Agile Learner
  // originalIndex bridges the still-flat startingSkills path (index-based floor/cost
  // keys); it's deleted with those flat fields in the startingSkills slice.
  originalIndex?: number;
  // Transient bridge: the originating V1 character field (e.g. 'classPowers') for
  // flat-path buckets, so the node keeps its legacy BP-ledger key prefix. Set by
  // v1ToV2's converter; dies with the flat fields.
  costField?: string;
}

/** The raw, V1-flat character the UI / loadArchetype produce and edit: parallel
 *  arrays of name strings per ontological field, plus loose metadata. Converted to
 *  CharacterStateV2 at the engine boundary (v1ToV2). This is the LEGACY input shape;
 *  the goal is to retire it once the UI writes V2 directly. */
export interface V1CharacterInput {
  name?: string;
  archetypeName?: string;
  classLevels?: string;
  classes?: { name: string; level: number }[] | Record<string, number>;
  lineage?: string | { name: string; choices: string[] };
  sublineage?: string;
  sublineages?: Record<string, string>;
  devotion?: string;
  /** All skills (starting + purchased) are V2-native: CharacterChoice[] in `skills`,
   *  source 'Class:Starting' or 'Purchased'. No flat skill arrays on a live char. */
  skills?: CharacterChoice[];
  /** Perks are V2-native: CharacterChoice[] in `perks` (source 'Purchased'). */
  perks?: CharacterChoice[];
  /** Powers/spells are V2-native buckets (archetypes ship them here); the flat power/
   *  spell fields below are the legacy/importer shape, not migrated in the perks slice. */
  powers?: CharacterChoice[];
  spells?: CharacterChoice[];
  /** Transient: the sheet importer parses the "Starting/Purchased Skills" and
   *  "Purchased Perks" lines into these flat arrays, then converts them into the
   *  `skills`/`perks` buckets and deletes them. No live character carries them;
   *  they exist only inside parseCharacterSheet. */
  startingSkills?: string[];
  purchasedSkills?: string[];
  purchasedPerks?: string[];
  flaws?: string[];
  classPowers?: string[];
  classSkills?: string[];
  rightHandPowers?: string[];
  utilityPowers?: string[];
  basicPowers?: string[];
  advancedPowers?: string[];
  veteranPowers?: string[];
  domainPowers?: string[];
  innatePowers?: string[];
  cantrips?: string[];
  bookSpells?: string[];
  spellsKnown?: string[];
  noviceSpells?: string[];
  adeptSpells?: string[];
  greaterSpells?: string[];
  divineDomains?: string[];
  powerClass?: Record<string, string[]>;
  choices?: Record<string, string>;
  grantedSelections?: Record<string, unknown>;
  agileLearnerTrades?: Record<string, number>;
  effectiveBP?: Record<string, (number | undefined)[]>;
  ranks?: Record<string, number[]>;
  stats?: Record<string, number>;
  [key: string]: unknown;
}

export interface CharacterStateV2 {
  /** Set by v1ToV2 to mark a normalized-V2 character, so the boundary
   *  (resolveCharacterGraph) passes it through instead of re-converting (which
   *  double-wraps already-converted bucket entries). Retire when V1 is gone. */
  _v2?: true;
  name?: string;
  archetypeName?: string;
  backstoryApproved?: boolean;
  extraMaxBP?: number;
  currentEvent?: number;
  wealth?: string;
  resources?: string;

  /** Classes the character has as {name, level}. getClasses also understands the
   *  legacy `classLevels` string and `{Name: level}` map on raw input. */
  classes: { name: string; level: number }[];
  lineage?: string | { name: string; choices: string[] };
  sublineage?: string;
  /** Sublineage-challenge map, drives lineage-constraint checks. */
  sublineages?: Record<string, string>;
  devotion?: string;
  devotions: CharacterChoice[];

  // The resolved ontological buckets — the engine's single (V2) shape. Raw input
  // is converted into these at the boundary (see v1ToV2 in graph.ts).
  skills: CharacterChoice[];
  perks: CharacterChoice[];
  flaws: CharacterChoice[];
  powers: CharacterChoice[];
  spells: CharacterChoice[];

  /** Per-stat overrides read by lineage checks (e.g. The Fractured). */
  stats?: Record<string, number>;
  advantageChoices?: Record<string, string>;
  divineDomains?: string[];
  choices?: Record<string, string>;
  agileLearnerTrades?: Record<string, number>;
}

// ─── 3. Graph Types ─────────────────────────────────────────────────────────

/** Why an item is free/discounted (grant provenance) in the BP ledger. */
export interface BPGrant {
  kind: string;               // 'grant' | …
  source?: string;            // the granting entity/class name
  derived?: boolean;
  amount?: number;
}

/** Per-item BP accounting entry (graph.spend.byItem[id]). */
export interface BPLedgerEntry {
  cost: number;               // BP actually charged (negative = award/refund)
  base: number;               // the item's base cost before grants/discounts
  grant: BPGrant | null;
  rank?: number;
  authored?: boolean;
  freeRanks?: number;
  paidRanks?: number;
  discount?: { source: string; amount: number };
}

/** The BP ledger — graph.spend. Totals consumers actually read + the per-item
 *  breakdown. (Accounting intermediates like `refunded`/`discountFreeBP` stay
 *  local to computeSpend; they only feed `net`.) */
export interface BPLedger {
  spent: number;              // gross BP spent on purchases
  awarded: number;            // flaw BP awarded (capped at MAX_FLAW_BP)
  rawAwarded: number;         // flaw BP before the cap
  flawCapped: boolean;        // true when rawAwarded exceeded the cap
  discountsApplied: { key: string; source: string; amount: number }[];
  net: number;                // the bottom line: spent − refunds − discounts
  byItem: Record<string, BPLedgerEntry>;
}

export interface Effect {
  type: string;
  [key: string]: any;
}

export interface GraphItem {
  id: string;
  name: string;
  rawString?: string;
  /** The chosen parameter value (e.g. "Arcane" for Lore (Arcane)), parsed once at
   *  node creation so downstream (identity, buckets) reads it structurally instead
   *  of re-scraping it from the display name. null when the entity takes no param. */
  param?: string | null;
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
  entityId?: string;
  /** The BP cost accounting for THIS item, computed and attached here (the
   *  spreadsheet row's cost cells) rather than looked up in a separate name-keyed
   *  map. `graph.spend.byItem` is a derived projection of these. */
  costEntry?: BPLedgerEntry;
  /** Class this power/skill came from (multiclass clarity). */
  cls?: string | null;
}


export type ViewState = {
  id: string;
  entityId: string;
  param?: string;
  source: string;
  grantedBy?: string;
  free: boolean;
  cost: number;
  rank: number;
  effects: Effect[];
  rawString?: string;
  field: string;
  choiceData?: CharacterChoice;
  specialty?: any;
  floor?: number;
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
  classes: { name: string; level: number }[];
}
