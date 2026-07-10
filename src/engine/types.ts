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
  kind: "build" | "play";
  options: ChoiceOption[];
}

export interface StatMod {
  stat: string;
  amount: number;
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

  // Parsed loose JSON fields across various entities
  ranks?: number | string;
  levelBenefits?: { level: number; text: string }[];
  levelBenefitClass?: string;
  slotGrants?: SlotGrant[];
  grantedSelections?: Record<string, unknown>[];
  highestSlot?: number;
  magicType?: string;
  bp?: number | string; // For flawed abilities that grant bp
  effect?: string;
  call?: string;
  /** BP cost, when the entity carries one directly (skills/perks; also lineage
   *  entities via `lbp`). Skill/Perk redeclare `cost` as required. */
  cost?: number | string;
  /** Lineage BP cost — attached to advantage/challenge entities by the data layer. */
  lbp?: number;
}

export interface Skill extends BaseEntity {
  type: "skill";
  cost: number | string;
  category?: string; // e.g. "Martial", "Crafting"
  stats?: StatMod[];
  chooseOne?: ChooseOneConfig;
}

export interface Power extends BaseEntity {
  type: "power";
  tier: "Basic" | "Advanced" | "Veteran" | "Utility" | "Class";
  parentClass?: string;
  parameter?: string; // E.g. (Swords)
}

export interface Spell extends BaseEntity {
  type: "spell";
  tier: "Cantrip" | "Novice" | "Adept" | "Greater";
  sphere: string; // e.g. "Arcane", "Divine"
}

export interface Perk extends BaseEntity {
  type: "perk";
  cost: number | string;
  category?: string;
}

export interface Flaw extends BaseEntity {
  type: "flaw";
  award: number | string;
  category?: string;
}

export interface Class extends BaseEntity {
  type: "class";
  innate?: { name: string; requiredLevel?: number }[];
  spellcaster?: boolean;
}

/**
 * A discriminated union of all possible entities that can be returned by the data layer.
 * Allows the engine to narrow the type via `if (ent.type === 'spell') { ... }`.
 */
export type Entity = Skill | Power | Spell | Perk | Flaw | Class;

// ─── 2. Ontological Character State ────────────────────────────────────

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
  | { type: "purchased" }
  | { type: "class"; name: string }
  | { type: "starting"; class: string }
  | { type: "innate"; class?: string }
  | { type: "granted"; by: string }
  | { type: "lineage" }
  | { type: "flaw" };

// ─── EntitySource constructors + readers ────────────────────────────────────
// Constructors keep source-object creation in one place; readers let call-sites
// ask a structural question instead of switching on `type` inline.

export const Source = {
  purchased: (): EntitySource => ({ type: "purchased" }),
  class: (name: string): EntitySource => ({ type: "class", name }),
  starting: (cls: string): EntitySource => ({ type: "starting", class: cls }),
  innate: (cls?: string): EntitySource => ({ type: "innate", ...(cls ? { class: cls } : {}) }),
  granted: (by: string): EntitySource => ({ type: "granted", by }),
  lineage: (): EntitySource => ({ type: "lineage" }),
  flaw: (): EntitySource => ({ type: "flaw" }),
};

export const isPurchased = (s: EntitySource | undefined): boolean => s?.type === "purchased";
export const isStarting = (s: EntitySource | undefined): boolean => s?.type === "starting";
export const isInnate = (s: EntitySource | undefined): boolean => s?.type === "innate";
export const isFlaw = (s: EntitySource | undefined): boolean => s?.type === "flaw";

/** The class a choice belongs to, when its source names one (class-slot, starting,
 *  or innate power). null otherwise. Replaces the old sourceClass('Class:X') parse. */
export function sourceClass(s: EntitySource | undefined): string | null {
  if (!s) return null;
  if (s.type === "class") return s.name;
  if (s.type === "starting") return s.class;
  if (s.type === "innate") return s.class ?? null;
  return null;
}

/** The granting entity when the source is a grant (else null). */
export function grantedBy(s: EntitySource | undefined): string | null {
  return s?.type === "granted" ? s.by : null;
}

/**
 * A choice made by the player to add an entity to their sheet.
 */
export interface CharacterChoice {
  entityId: string; // The canonical name/key of the entity in the rules database
  source: EntitySource; // Where this capability came from

  // Overrides & Metadata
  costOverride?: number; // E.g. from Apprentice Alchemy discount (-1)
  parameter?: string; // If the choice requires a parameter (e.g. Weapon Specialization - Swords)
  ranks?: number; // For multi-rank purchases like Agile Learner
  // originalIndex bridges the still-flat startingSkills path (index-based floor/cost
  // keys); it's deleted with those flat fields in the startingSkills slice.
  originalIndex?: number;
  // The originating field (e.g. 'basicPowers') — keys the node's BP-ledger prefix
  // and lets the validator tell same-tier picks apart (book spells vs spells-known).
  costField?: string;
}

export interface CharacterState {
  name?: string;
  archetypeName?: string | null;
  backstoryApproved?: boolean;
  extraMaxBP?: number;
  currentEvent?: number;
  wealth?: string | number | null;
  resources?: string | null;

  /** Classes the character has as {name, level}. getClasses also understands the
   *  legacy `classLevels` string and `{Name: level}` map on raw input. */
  classes: { name: string; level: number }[];
  lineage?: string | { name: string; choices: string[] } | null;
  sublineage?: string | null;
  /** Sublineage-challenge map, drives lineage-constraint checks. */
  sublineages?: Record<string, string>;
  devotion?: string | null;
  devotions: CharacterChoice[];

  /** Artisan-only: "Mystic" / "Crafter" / "Artificer". */
  specialization?: string | null;
  /** Point-in-time derived-stat overrides carried on the state when set by the
   *  sheet importer / archetype loader (otherwise derived; see wellspring-derived-stats). */
  lifePoints?: number | null;
  armorPoints?: number | null;
  spikes?: number | null;
  /** Per-class starting choose-one selections, keyed by choice id. Seeded by
   *  reconcileStartingChoices when a primary class is set. */
  startingChoices?: Record<string, string>;

  // The ontological buckets — the engine's single shape. Every producer (UI
  // reducers, loadArchetype, the sheet importer, the test factory) writes these
  // directly via addToCharacter.
  skills: CharacterChoice[];
  perks: CharacterChoice[];
  flaws: CharacterChoice[];
  powers: CharacterChoice[];
  /** Divine domain powers — their OWN bucket, not class powers. Purchased under a
   *  chosen domain; pruned when that domain is dropped. Kept separate from `powers`
   *  so nothing conflates a domain power with a class power. */
  domainPowers: CharacterChoice[];
  spells: CharacterChoice[];

  /** Per-stat overrides read by lineage checks (e.g. The Fractured). */
  stats?: Record<string, number>;
  advantageChoices?: Record<string, string>;
  divineDomains?: string[];
  choices?: Record<string, string>;
  agileLearnerTrades?: Record<string, number>;
  /** Selections made for granted "choose one" powers, keyed by selection id. */
  grantedSelections?: Record<string, unknown>;
  /** Lineage picks (names). Read directly by the graph's lineage-item resolution. */
  lineageChallenges?: string[];
  lineageAdvantages?: string[];
}

export interface GrantedAbility {
  ability: string;
  abilityName: string;
  abilityType: string;
  source: string;
  sourceId: string;
  sourceKind: string;
}

export interface WealthReport {
  base: number;
  income: number;
  total: number;
  sources: { source: string; amount: number; note?: string }[];
}

export interface ResolvedStats {
  baseLifePoints: number;
  baseSpikes: number;
  lifePoints: number;
  spikes: number;
  armor: number;
  naturalArmor: number;
  mods: {
    lifePoints?: number;
    spikes?: number;
    armor?: number;
    naturalArmor?: number;
    sources: { name: string; stat: string; n: number }[];
    notes: { name: string; stat: string; [k: string]: unknown }[];
  };
}

export interface PrereqIssue {
  id: string;
  item: string;
  field: string;
  text?: string;
  tierLevel?: number;
  tier?: number;
  missing?: { id: string; name: string }[];
  anyOf?: { id: string; name: string }[][];
  requiresEntity?: string;
  duplicate?: number;
  excludes?: string;
}

export interface PrereqNote {
  id: string;
  item: string;
  field: string;
  kind?: string;
  text: string;
}

export interface PrereqReport {
  issues: PrereqIssue[];
  notes: PrereqNote[];
}

// ─── 3. Graph Types ─────────────────────────────────────────────────────────

/** Why an item is free/discounted (grant provenance) in the BP ledger. */
export interface BPGrant {
  kind: string; // 'grant' | …
  source?: string; // the granting entity/class name
  derived?: boolean;
  amount?: number;
}

/** Per-item BP accounting entry (graph.spend.byItem[id]). */
export interface BPLedgerEntry {
  cost: number; // BP actually charged (negative = award/refund)
  base: number; // the item's base cost before grants/discounts
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
  spent: number; // gross BP spent on purchases
  awarded: number; // flaw BP awarded (capped at MAX_FLAW_BP)
  rawAwarded: number; // flaw BP before the cap
  flawCapped: boolean; // true when rawAwarded exceeded the cap
  discountsApplied: { key: string; source: string; amount: number }[];
  net: number; // the bottom line: spent − refunds − discounts
  byItem: Record<string, BPLedgerEntry>;
}

/** A BP discount scope + amount, as emitted by discount extractors and consumed in
 *  the spend phase. `scope.value` is the parameter the discount is keyed to (e.g. a
 *  skill name); null-cap means uncapped. */
export interface DiscountSpec {
  scope: { kind: string; value: string | string[]; n?: number };
  amount: number;
  min?: number | null;
  cap?: number | null;
  refundIfFree?: boolean;
  exclusions?: string[];
}

/** A single game/build effect emitted by an extractor and applied by the graph.
 *  Discriminated on `type` so each variant's payload is statically known. */
export type Effect =
  | { type: "STAT"; stat: string; amount: number }
  | { type: "GRANT_SOURCE"; grants: string[] }
  | { type: "DISCOUNT_SOURCE"; discount: DiscountSpec }
  | { type: "WEALTH"; amount: number; note?: string }
  | { type: "FLAW_AWARD"; amount: number }
  | { type: "OVER_CAP"; cap: number }
  | { type: "REFUND_GRANT"; source: string };

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
  entity?: Entity | null;
  effects: Effect[];
  specialty?: string | null;
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
  sourceType: string;
  cls?: string | null;
  grantedBy?: string;
  free: boolean;
  cost: number;
  rank: number;
  effects: Effect[];
  rawString?: string;
  field: string;
  choiceData?: CharacterChoice;
  specialty?: string | null;
  floor?: number;
};

export type SkillView = Skill & ViewState;
export type PowerView = Power & ViewState;
export type SpellView = Spell & ViewState;
export type PerkView = Perk & ViewState;
export type FlawView = Flaw & ViewState;
export type ClassView = Class & { level: number };

export interface BucketedView {
  classes: ClassView[];
  innatePowers: PowerView[];
  basicPowers: PowerView[];
  advancedPowers: PowerView[];
  veteranPowers: PowerView[];
  utilityPowers: PowerView[];
  classPowers: PowerView[];
  domainPowers: PowerView[];
  skills: SkillView[];
  perks: PerkView[];
  flaws: FlawView[];
  knownSpells: SpellView[];
}

export interface CharacterGraph {
  character: CharacterState;
  items: GraphItem[];
  characterLevel: number;
  classes: { name: string; level: number }[];
}
