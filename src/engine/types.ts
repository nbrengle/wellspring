/**
 * src/engine/types.ts
 * Type definitions for the Wellspring Rules Engine.
 * This defines both the static definitions (from JSON) and the player's Character State.
 */

import { CHARACTER_BUCKETS } from "./config.js";

/** A storage-bucket name — derived from the CHARACTER_BUCKETS source of truth. */
export type CharacterBucket = (typeof CHARACTER_BUCKETS)[number];
/** The CharacterChoice[] bucket fields on the character, derived from the constant
 *  so the interface and the list can't drift. */
export type CharacterBuckets = Record<CharacterBucket, CharacterChoice[]>;

// ─── 1. Core Data Models (The Rules) ────────────────────────────────────────

export interface SlotBestow {
  cat: string;
  n: number;
}

export interface ChoiceOption {
  text: string;
  grants?: string[];
  bestows?: string[];
  bestowsSkill?: boolean;
}

export interface ChooseOneConfig {
  kind: "build" | "play";
  options: ChoiceOption[];
}

export type StatMod = { stat: string; amount: number } | { stat: string; text: string };

/** How many times an entity can be taken: a finite cap, or genuinely unbounded.
 *  "unlimited" skills are instance-based ("Skill xN" = N distinct subjects, not rank
 *  N; see UNLIMITED_SKILLS). Read the cap with `rankCap()` rather than switching on
 *  the union inline. */
export type Rank = number | "unlimited";

/** The numeric cap of a Rank — Infinity when unbounded. */
export const rankCap = (r: Rank | undefined): number => (r === "unlimited" ? Infinity : (r ?? 1));

// ─── Discriminated Union for Entities ───────────────────────────────────────

/** The `type` discriminator shared by every entity in the union (below). Declared
 *  ahead of `Entity` so `EntityRef` can reference it without a forward cycle. */
export type EntityType =
  | "skill"
  | "power"
  | "spell"
  | "subpower"
  | "perk"
  | "flaw"
  | "class"
  | "advantage"
  | "challenge";

/** A resolved reference to another entity — the shape the linker stamps onto an
 *  entity's grant/prereq/exclusion edges. Carries `type` (the realm) so it resolves
 *  unambiguously with NO lookup: read `ref.name`/`ref.type` directly. This is a NAMED
 *  facade — never destructure the raw `{name,type}` at call sites; go through
 *  `entityRef()` / `resolveRef()` (data.ts) so the shape can grow in one place. */
export interface EntityRef {
  name: string;
  type: EntityType;
}

/** A skill/perk's structured prerequisites, with entity edges as refs (name+type)
 *  and the free-text gates (`levels`/`other`) kept as prose. */
export interface PrereqSpec {
  skills?: EntityRef[];
  anyOf?: EntityRef[][];
  levels?: string[];
  other?: string[];
}

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

  // Mechanically extracted prerequisites
  requiredLevel?: number;
  requiredClass?: string;
  requiresEntity?: string[];

  // Parsed loose JSON fields across various entities
  /** How many times the entity can be taken — see Rank. Read via rankCap(). */
  ranks?: Rank;
  levelBenefits?: { level: number; text: string }[];
  levelBenefitClass?: string;
  slotBestows?: SlotBestow[];
  bestowedSelections?: Record<string, string>[];
  highestSlot?: number;
  effect?: string;
  call?: string;
  /** BP cost, when the entity carries one directly (skills/perks; also lineage
   *  entities via `lbp`). Skill/Perk redeclare `cost` as required. */
  cost?: number;
  /** Lineage BP cost — attached to advantage/challenge entities by the data layer. */
  lbp?: number;
  chooseOne?: ChooseOneConfig;
  levelDiscounts?: { atLevel: number; amount: number; pool?: string; category?: string; skill?: string }[];
  wealthIncome?: { n: number; kind: string; skill?: string };

  // ─── Cross-entity edges (stamped by the linker) ────────────────────────────
  // What this entity requires / grants / cannot coexist with / is granted by —
  // resolved to EntityRef at link time so the engine reads them as fields, never
  // by re-parsing a string-keyed refs graph. See #244.
  /** Structured prerequisites (entity edges as refs; prose gates as strings). */
  prereqs?: PrereqSpec;
  /** Entities this one grants for free when taken ("gains the X Perk"). */
  bestows?: EntityRef[];
  /** Entities this cannot be taken alongside (symmetric mutual-exclusion). */
  excludes?: EntityRef[];
}

export interface Skill extends BaseEntity {
  type: "skill";
  cost: number;
  category?: string; // e.g. "Martial", "Crafting"
  stats?: StatMod[];
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

// A granted ability conferred by a power/spell ("Grant Power: Curious Balm") — never
// picked, never costed. Shares the power/spell stat-block shape but is its OWN type: it
// is neither a spell nor a power, and the build treats it as a mechanical grant, not an
// acquisition (see resolve.ts: no build node is created for it).
export interface SubPower extends BaseEntity {
  type: "subpower";
  tier: "SubPower";
}

export interface Perk extends BaseEntity {
  type: "perk";
  cost: number;
  category?: string;
}

export interface Flaw extends BaseEntity {
  type: "flaw";
  /** BP the flaw awards — the numeric floor the BP math uses. A variable award
   *  ("1 or 2") is resolved elsewhere (allergies from ALLERGEN_AWARDS, per
   *  substance); `bpLabel` carries the human-readable range for display. */
  bp: number;
  /** The award as written ("1 or 2"), when it differs from the numeric floor. */
  bpLabel?: string;
  category?: string;
}

/** A class's domain kind. Non-null `magicType` iff `kind === "Spellcaster"`. */
export type ClassKind = "Martial" | "Spellcaster";

export interface Class extends BaseEntity {
  type: "class";
  /** The domain kind — Martial vs Spellcaster. Distinct from `type` (the Entity
   *  discriminator, always "class"); use `isCaster()` to read caster-ness. */
  kind: ClassKind;
  /** Arcane/Divine for casters, null for martials. */
  magicType: string | null;
  innate?: { name: string; requiredLevel?: number }[];
  startingSkills?: string[];
  multiclassSkills?: string[];
  multiclassBestows?: { name: string; cost: number }[];
  /** Class tags (e.g. "Martial") — parser doesn't emit these yet; a typed seam
   *  that lights up when the data carries them. */
  tags?: string[];
}

/** Is this a spellcasting class? The one place caster-ness is decided. */
export const isCaster = (c: { kind?: ClassKind } | null | undefined): boolean => c?.kind === "Spellcaster";

export interface Advantage extends BaseEntity {
  type: "advantage";
  lineage?: string;
}

export interface Challenge extends BaseEntity {
  type: "challenge";
  lineage?: string;
}

/**
 * A discriminated union of all possible entities that can be returned by the data layer.
 * Allows the engine to narrow the type via `if (ent.type === 'spell') { ... }`.
 */
export type Entity = Skill | Power | Spell | SubPower | Perk | Flaw | Class | Advantage | Challenge;

// ─── 2. Ontological Character State ────────────────────────────────────

/**
 * Represents where a capability was acquired — a STRUCTURED discriminated union on
 * `type`, so consumers read `source.type` / `source.name` instead of parsing a
 * compound `'Class:Fighter'` string. Compound source strings do NOT exist in the
 * engine anymore (and never leak into refs.json — that stays name-keyed).
 *
 *  - purchased : bought with BP (skills, perks, classPowers, spells).
 *  - class     : bestowed FREE by the class — a class-progression slot pick
 *                (basic/advanced/… power, a caster spell) OR a starting skill;
 *                `name` is the bestowing class. (There is no separate 'starting'
 *                source — a class-sourced SKILL *is* a starting/free skill, routed
 *                to the Bestowed/Free Skills bucket. See isStarting.)
 *  - innate    : a class innate power (level-gated grant); `class` when known.
 *  - bestowed  : bestowed by another owned entity; `by` is that entity.
 *  - lineage   : bestowed by the character's lineage.
 *  - flaw      : a flaw (awards BP).
 */
export type EntitySource =
  | { type: "purchased" }
  | { type: "class"; name: string }
  | { type: "innate"; class?: string }
  | { type: "bestowed"; by: string }
  | { type: "lineage" }
  | { type: "flaw" };

// ─── EntitySource constructors + readers ────────────────────────────────────
// Constructors keep source-object creation in one place; readers let call-sites
// ask a structural question instead of switching on `type` inline.

export const Source = {
  purchased: (): EntitySource => ({ type: "purchased" }),
  class: (name: string): EntitySource => ({ type: "class", name }),
  innate: (cls?: string): EntitySource => ({ type: "innate", ...(cls ? { class: cls } : {}) }),
  bestowed: (by: string): EntitySource => ({ type: "bestowed", by }),
  lineage: (): EntitySource => ({ type: "lineage" }),
  flaw: (): EntitySource => ({ type: "flaw" }),
};

export const isPurchased = (s: EntitySource | undefined): boolean => s?.type === "purchased";
/** A STARTING (free) skill is one a class bestowed — i.e. class-sourced. Only skills
 *  carry a class source (slot powers/spells live in the powers/spells buckets), so
 *  within `character.skills` this uniquely identifies the class's starting skills. */
export const isStarting = (s: EntitySource | undefined): boolean => s?.type === "class";
export const isInnate = (s: EntitySource | undefined): boolean => s?.type === "innate";
export const isFlaw = (s: EntitySource | undefined): boolean => s?.type === "flaw";

/** The class a choice belongs to, when its source names one (class-slot, starting,
 *  or innate power). null otherwise. Replaces the old sourceClass('Class:X') parse. */
export function sourceClass(s: EntitySource | undefined): string | null {
  if (!s) return null;
  if (s.type === "class") return s.name;
  if (s.type === "innate") return s.class ?? null;
  return null;
}

/** The bestowing entity when the source is a bestowal (else null). */
export function bestowedBy(s: EntitySource | undefined): string | null {
  return s?.type === "bestowed" ? s.by : null;
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

export interface CharacterState extends CharacterBuckets {
  name?: string;
  archetypeName?: string | null;
  backstoryApproved?: boolean;
  extraMaxBP?: number;
  currentEvent?: number;
  wealth?: string | number | null;
  resources?: string | null;

  /** Classes the character has, as {name, level}[] — the one shape every producer
   *  emits (archetypes, sheet importer, reducers). */
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
  // The bucket fields (skills / perks / flaws / powers / domainPowers / spells) are
  // derived from CHARACTER_BUCKETS below via `Record<CharacterBucket, …>`, so this
  // interface and the constant can't disagree. domainPowers is its OWN bucket, not
  // class powers — kept separate so nothing conflates a domain power with a class one.

  /** Per-stat overrides read by lineage checks (e.g. The Fractured). */
  stats?: Record<string, number>;
  advantageChoices?: Record<string, string>;
  divineDomains?: string[];
  choices?: Record<string, string>;
  agileLearnerTrades?: Record<string, number>;
  /** Selections made for granted "choose one" powers, keyed by selection id. */
  bestowedSelections?: Record<string, string>;
  /** Lineage picks (names). Read directly by the graph's lineage-item resolution. */
  lineageChallenges?: string[];
  lineageAdvantages?: string[];
}

export interface BestowedAbility {
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
    sources: { name: string; stat: string; amount: number }[];
    notes: { name: string; stat: string; text: string }[];
  };
}

export interface PrereqIssue {
  id: string;
  item: string;
  field: string;
  text?: string;
  /** The tier at issue (a tiered perk's rank), for tier-level prereqs. */
  tier?: number;
  missing?: { id: string; name: string }[];
  anyOf?: { id: string; name: string }[][];
  /** The specific entity this item requires (structured, for tests/consumers). */
  requiresEntity?: string;
  /** The entity this item is mutually exclusive with. */
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

/** Why an item is free/discounted (bestowal provenance) in the BP ledger. */
export interface BPBestow {
  kind: string; // 'bestow' | …
  source?: string; // the bestowing entity/class name
  derived?: boolean;
  amount?: number;
}

/** Per-item BP accounting entry (graph.spend.byItem[id]). */
export interface BPLedgerEntry {
  cost: number; // BP actually charged (negative = award/refund)
  base: number; // the item's base cost before bestowals/discounts
  bestow: BPBestow | null;
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
  | { type: "BESTOW_SOURCE"; bestows: string[] }
  | { type: "DISCOUNT_SOURCE"; discount: DiscountSpec }
  | { type: "WEALTH"; amount: number; note?: string }
  | { type: "FLAW_AWARD"; amount: number }
  | { type: "OVER_CAP"; cap: number }
  | { type: "REFUND_BESTOW"; source: string };

/** A resolved graph node's PROVENANCE — the honest, closed set the graph actually
 *  produces. Derived from the stored `EntitySource.type` via the SOURCE_TYPE map in
 *  resolve.ts (note the stored `bestowed` → graph `bestow` rename). Every member has a
 *  live consumer. (`synthetic` was retired when Tax Evasion became a WEALTH effect.) */
export type GraphSourceType = "purchased" | "class" | "innate" | "bestow" | "lineage" | "flaw";

/** A resolved graph node's ORIGINATING COLLECTION. This is `collectionOf(entity.type)`
 *  for real nodes plus the `${type}Bestow` kinds for grant-expansion nodes — it is NOT a
 *  classifier (use `entity.type`/`sourceType`/`powerKind` for that). It survives only as
 *  the BP-ledger / prereq key PREFIX (see cost-key.ts, grants.ts); collapsing those keys
 *  is #210. */
export type GraphField =
  | "skills"
  | "perks"
  | "powers"
  | "spells"
  | "flaws"
  | "devotions"
  | "classes"
  | "advantages"
  | "challenges"
  | "unknown";

/** Whether a power is a class-progression power or a domain power. The two are both
 *  `entity.type === "power"` with no distinguishing entity field, so this carries the
 *  provenance `field === "domainPowers"` used to (incorrectly) try to. */
export type PowerKind = "class" | "domain";

export interface GraphItem {
  id: string;
  name: string;
  rawString?: string;
  /** The chosen parameter value (e.g. "Arcane" for Lore (Arcane)), parsed once at
   *  node creation so downstream (identity, buckets) reads it structurally instead
   *  of re-scraping it from the display name. null when the entity takes no param. */
  param?: string | null;
  field: GraphField;
  sourceType: GraphSourceType;
  /** class vs domain power (set from choice.costField at node creation). */
  powerKind?: PowerKind;
  rank: number;
  baseCost: number;
  authoredCost?: number;
  entity: Entity | null;
  effects: Effect[];
  specialty?: string | null;
  floor?: number;
  choiceData?: CharacterChoice;
  index?: number;
  bestowedBy?: string;
  bestowKind?: string;
  entityId?: string;
  /** The BP cost accounting for THIS item, computed and attached here (the
   *  spreadsheet row's cost cells) rather than looked up in a separate name-keyed
   *  map. `graph.spend.byItem` is a derived projection of these. */
  costEntry?: BPLedgerEntry;
  /** Class this power/skill came from (multiclass clarity). */
  cls?: string | null;
}

/** A graph node whose entity id didn't resolve to a known entity (stale/typo'd id
 *  from saved character data, or parser/data drift). Surfaced by buildBucketedView on
 *  BucketedView.unresolved instead of being silently stubbed into a view row. */
export type UnresolvedEntity = {
  entityId: string;
  name: string;
  sourceType: GraphSourceType;
  field: GraphField;
};
export type ViewState = {
  id: string;
  name: string;
  entityId: string;
  param?: string;
  sourceType: GraphSourceType;
  cls?: string | null;
  bestowedBy?: string;
  free: boolean;
  cost: number;
  rank: number;
  index?: number;
  effects: Effect[];
  rawString?: string;
  field: GraphField;
  powerKind?: PowerKind;
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
  /** Skills the player BOUGHT with BP. */
  skills: SkillView[];
  /** Skills BESTOWED for free (class starting skills, lineage/power grants) — the
   *  game's "Starting/Free Skills" block. Grouping is a VIEW concern: a skill lands
   *  here iff its source is a bestowal (not a purchase), mirroring how the sheet
   *  splits Starting/Free from Purchased. (No analogous perk bucket yet — a UI
   *  accident, not a domain one; a bestowed perk is the same kind of thing.) */
  bestowedSkills: SkillView[];
  perks: PerkView[];
  flaws: FlawView[];
  knownSpells: SpellView[];
  /** Nodes whose entity id didn't resolve — a data-integrity failure surfaced to
   *  validation instead of stubbed into a view row. Empty in the healthy case. */
  unresolved: UnresolvedEntity[];
}

export interface CharacterGraph {
  character: CharacterState;
  items: GraphItem[];
  characterLevel: number;
  classes: { name: string; level: number }[];
}

export interface ProgressionRow {
  utility?: number;
  basic?: number;
  advanced?: number;
  veteran?: number;
  bonus?: string | number | null;
  cantrips?: number;
  spellsKnown?: number;
  slots?: string;
  innateCantrips?: string[];
  statMods?: StatMod[];
}
