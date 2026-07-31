import { ALLERGEN_AWARDS, allergenAward, lookupEntity, collectionOf } from "../../engine/data.js";
import { EFFECT_EXTRACTORS } from "../extractors.js";
import { paramInfo, paramReusable } from "../param-domain.js";
import { bareSkill, cleanItemName, getClasses } from "../resolver.js";
import { startingSkillBestows } from "../starting-choices.js";
import type {
  CharacterChoice,
  CharacterState,
  Effect,
  Entity,
  EntityRef,
  EntitySource,
  GraphField,
  GraphItem,
  GraphSourceType,
  PowerKind,
} from "../types.js";
import { Source, isPurchased, isStarting, sourceClass } from "../types.js";
import { characterLevel, maxRanks } from "../validate/core.js";
import { CharacterGraphModel, composeDisplayName, extractParam, idPrefix } from "./model.js";

// Stored EntitySource.type → the graph node's provenance. The stored `bestowed` becomes
// the graph's `bestow`; every other member passes through. Total over EntitySource["type"].
const SOURCE_TYPE: Record<EntitySource["type"], GraphSourceType> = {
  purchased: "purchased",
  class: "class",
  innate: "innate",
  bestowed: "bestow",
  lineage: "lineage",
  flaw: "flaw",
};

const GRAPH_FIELDS = new Set<GraphField>([
  "skills",
  "perks",
  "powers",
  "spells",
  "flaws",
  "devotions",
  "classes",
  "advantages",
  "challenges",
]);

/** Narrow a raw id-prefix (entityId prefix, else the entity-id prefix) to a GraphField,
 *  falling back to "unknown". `field` is the originating collection, not a classifier. */
function toGraphField(idPrefix: string, entPrefix?: string): GraphField {
  if (GRAPH_FIELDS.has(idPrefix as GraphField)) return idPrefix as GraphField;
  if (entPrefix && GRAPH_FIELDS.has(entPrefix as GraphField)) return entPrefix as GraphField;
  return "unknown";
}

export function normalizeCharacter(character: CharacterState): CharacterState {
  const classes = getClasses(character);
  const powers = [...(character.powers || [])];
  const owned = new Set(powers.map((p) => p.entityId));
  for (const c of classes) {
    const clsDef = lookupEntity(`classes:${c.name}`);
    for (const p of (clsDef?.type === "class" ? clsDef.innate : []) || []) {
      if (c.level >= (p.requiredLevel || 1) && !owned.has(p.name)) {
        owned.add(p.name);
        powers.push({ entityId: p.name, source: Source.innate(), ranks: 1, costField: "innatePowers" });
      }
    }
  }

  const devotions = [...(character.devotions || [])];
  if (character.devotion && !devotions.some((d) => d.entityId === `devotions:${character.devotion}`)) {
    devotions.push({ entityId: `devotions:${character.devotion}`, source: Source.purchased() });
  }

  return { ...character, classes, powers, devotions };
}

// The dedupe identity of a taking: its cap and the key that collapses "the same thing
// taken twice". Shared by the cap pass (purchase surplus → OVER_CAP) and the bestow pass
// (a bestow at cap refunds a coinciding purchase). Lifted to module scope so both passes
// read one definition.
function getIdentity(rawName: string, ent: Entity | null, param?: string | null) {
  const clean = cleanItemName(rawName);
  const cap = maxRanks(ent);
  const info = paramInfo(ent);
  const reusable = paramReusable(ent);
  const baseName = (ent?.baseName || ent?.name || bareSkill(clean)).toLowerCase();

  // Take-once entities (cap 1) have ONE identity regardless of parameter — the
  // param is flavor on the single instance, not a distinguisher. e.g. Weapon
  // Specialization (Swords) and (Axes) are the SAME identity, so a second one is
  // redundant (free BP). Without this, a parameterized cap-1 entity keyed by
  // base|param wrongly kept both. (Param distinguishes only when cap > 1.)
  if (cap <= 1) return { key: baseName, cap };

  // No param, or param is payload (reusable) → identity is the base; the cap
  // governs how many total takings are kept.
  if (!info || reusable) return { key: baseName, cap };

  // Parameterized, multi-rank, not reusable (Lore, …) → param distinguishes
  // distinct instances, each capped at one. Read the structured node.param,
  // falling back to the entity's param label only if absent.
  const paramValue = (param ?? ent?.parameter ?? "unknown").toLowerCase();
  return { key: `${baseName}|${paramValue}`, cap: 1 };
}

// Resolve a choice's entityId to its entity. Rules data is keyed on the BARE id
// ("Lore", not "Lore (Historical)"), so we look that up; if the stored id wasn't fully
// qualified, retry the bare name against the common collections.
function resolveChoiceEntity(entityId: string, cleanName: string, bareName: string): Entity | null {
  const direct = lookupEntity(entityId);
  if (direct) return direct;
  return (
    lookupEntity(`skills:${bareName}`) || lookupEntity(`perks:${cleanName}`) || lookupEntity(`powers:${cleanName}`)
  );
}

// A choice's base BP cost: a tiered entity sums the costs of the tiers it has ranks
// for; a flat-cost entity is cost (or lineage lbp) × rank.
function baseCostOf(ent: Entity | null, rank: number): number {
  if (Array.isArray(ent?.tiers) && ent.tiers.length) {
    const n = Math.min(rank, ent.tiers.length);
    return ent.tiers.slice(0, n).reduce((s, t) => s + (t.cost || 0), 0);
  }
  return (typeof ent?.cost === "number" ? ent.cost : ent?.lbp || 0) * rank;
}

// PASS 1 — build a graph node for every stored taking (skills/perks/powers/spells/
// devotions/lineage), resolving the entity, cost, effects, provenance, and display name.
// The `originalIndex` bookkeeping preserves per-bucket positional order for removal.
// Resolves a single stored choice into a graph node. Pure: reads `character` only for
// effect extraction, returns the GraphItem rather than mutating a shared list.
function buildNode(choice: CharacterChoice, character: CharacterState): GraphItem {
  const rawName = choice.entityId.replace(/^[a-z]+:/i, "");
  const cleanName = cleanItemName(rawName);
  // The `parameter` FIELD builds the display name and distinguishes instances for
  // dedupe — it is never used to resolve the entity.
  const ent = resolveChoiceEntity(choice.entityId, cleanName, bareSkill(cleanName));

  // Display form = the entity's name + the chosen parameter (the FIELD). Derived
  // for the row's label / instance key; NOT an entity lookup key. Only a real
  // stored `choice.parameter` reconstructs the name — we must NOT re-append a param
  // scraped from the id string, or a name that merely contains " - " (e.g. a
  // lineage-qualified "Underkin - Iron Touch") would be mangled (composeDisplayName
  // leaves a base that already carries parens untouched). `param` (used for dedup)
  // still falls back to extractParam for any legacy inline-param data.
  const displayName = composeDisplayName(ent?.name || cleanName, choice.parameter);
  const param = choice.parameter ?? extractParam(rawName);

  const rank = choice.ranks || 1;
  const baseCost = baseCostOf(ent, rank);

  const effects: Effect[] = [];
  const entityId = ent?.id || choice.entityId;
  for (const extractor of EFFECT_EXTRACTORS) {
    effects.push(...extractor(ent, character, entityId));
  }

  // The node's provenance (GraphSourceType), mapped from the structured source's
  // `type` via SOURCE_TYPE. A class-sourced skill (a starting/free skill) keeps
  // 'class'; the stored `bestowed` becomes 'bestow'.
  const src: EntitySource = choice.source || Source.purchased();
  const sourceType = SOURCE_TYPE[src.type];

  // Determine the field (originating collection) from the entity-id prefix or fallback.
  const field = toGraphField(choice.entityId.split(":")[0], ent?.id?.split(":")[0]);

  // class vs domain power — the entity carries no flag, so read the originating bucket.
  const powerKind: PowerKind | undefined =
    ent?.type === "power" ? (choice.costField === "domainPowers" ? "domain" : "class") : undefined;

  // Node id is the PARAMETER-PRESERVING instance key used for the BP ledger,
  // prereq issue ids, and dedupe — NOT ent.id (the param-stripped BASE), so it keys
  // off the display form (base + param) to keep two Lores distinct. Its prefix is
  // the ORIGINATING character field: flat-path buckets carry it as `choice.costField`
  // (e.g. 'classPowers'); native skills have none, so they key under their entity
  // collection ('skills'). Falls back to the entity id.
  const idPrefixName = ent?.type ? idPrefix(ent) : null;
  const nodeId = idPrefixName ? `${idPrefixName}:${displayName}` : entityId;
  return {
    id: nodeId,
    entityId: entityId,
    name: displayName,
    rawString: displayName,
    param,
    field,
    sourceType,
    powerKind,
    cls: sourceClass(src),
    rank: choice.ranks || 1,
    index: choice.originalIndex,
    baseCost: baseCost,
    authoredCost: choice.costOverride,
    entity: ent,
    effects,
    specialty: null,
    floor: 0,
    choiceData: choice,
  };
}

function buildNodes(character: CharacterState): GraphItem[] {
  const items: GraphItem[] = [];
  const addItem = (choice: CharacterChoice) => items.push(buildNode(choice, character));
  let purchasedSkillIdx = 0;
  let startingSkillIdx = 0;
  for (const choice of character.skills || []) {
    if (isPurchased(choice.source)) {
      addItem({ ...choice, originalIndex: choice.originalIndex ?? purchasedSkillIdx++ });
    } else if (isStarting(choice.source)) {
      addItem({ ...choice, originalIndex: startingSkillIdx++ });
    } else {
      addItem(choice);
    }
  }

  for (const choice of character.perks || []) addItem(choice);
  const powerIdxByField: Record<string, number> = {};
  const addPurchasablePower = (choice: CharacterChoice) => {
    if (isPurchased(choice.source) && choice.costField) {
      const idx = powerIdxByField[choice.costField] || 0;
      powerIdxByField[choice.costField] = idx + 1;
      addItem({ ...choice, originalIndex: idx });
    } else {
      addItem(choice);
    }
  };
  for (const choice of character.powers || []) addPurchasablePower(choice);
  for (const choice of character.domainPowers || []) addPurchasablePower(choice);
  for (const choice of character.spells || []) addItem(choice);
  for (const choice of character.devotions || []) addItem(choice);
  for (const field of ["lineageAdvantages", "lineageChallenges"] as const) {
    for (const name of character[field] || []) {
      const type = field === "lineageAdvantages" ? "advantages" : "challenges";
      let entityId = `${type}:${name}`;
      if (name === "Pick and Choose" && character.advantageChoices?.["Pick and Choose"]) {
        // The stored value is the chosen advantage's bare name (#195) — globally unique,
        // so it keys directly off the re-keyed entity id and its REFS grant edge.
        entityId = `advantages:${character.advantageChoices["Pick and Choose"]}`;
      }
      const choice = { entityId, ranks: 1, source: Source.lineage() };
      addItem(choice);
    }
  }

  return items;
}

// The BP a flaw awards: a parameterized allergy reads its per-substance award (falling
// back to the table's minimum when the chosen substance is unknown); an ordinary flaw
// carries a flat `bp`. Unresolved / non-flaw entities award nothing.
function flawAward(ent: Entity | null, param: string | null): number {
  if (!ent) return 0;
  const allergenBase = ent.baseName || ent.name;
  const allergenTable = allergenBase ? ALLERGEN_AWARDS[allergenBase] : undefined;
  if (allergenTable) {
    const chosen = allergenAward(allergenBase, param);
    return chosen != null ? chosen : Math.min(...Object.values(allergenTable));
  }
  return ent.type === "flaw" ? ent.bp : 0;
}

// PASS 2 — flaw nodes. Flaws award BP (a negative baseCost + FLAW_AWARD effect); a
// parameterized flaw (Mild Allergy → substance) resolves its award from the allergen
// table keyed on the chosen value. Appends to the node list in place.
function addFlawNodes(character: CharacterState, items: GraphItem[]): void {
  for (const choice of character.flaws || []) {
    const rawName = choice.entityId.replace(/^flaws:/i, "");
    const cleanName = cleanItemName(rawName);
    const ent = lookupEntity(`flaws:${cleanName}`);
    // Param is the FIELD (fallback to any inline "(value)" in legacy data). The award
    // for a parameterized flaw (Mild Allergy → substance) is keyed on the chosen value.
    const param = choice.parameter ?? extractParam(rawName);
    const bp = flawAward(ent, param);
    items.push({
      id: ent?.id || `flaws:${cleanName}`,
      name: ent?.name ? composeDisplayName(ent.name, param) : cleanName,
      rawString: param && ent?.name ? `${ent.name} (${param})` : choice.entityId,
      param,
      field: "flaws",
      sourceType: "flaw",
      index: character.flaws?.indexOf(choice),
      rank: 1,
      baseCost: -bp,
      entity: ent,
      effects: [{ type: "FLAW_AWARD", amount: bp }],
      choiceData: choice,
    });
  }
}

type IdentityGroup = { cap: number; nodes: GraphItem[] };
type IdentityGroups = Map<string, IdentityGroup>;

// Group nodes by dedupe identity (lineage rows don't dedupe).
function groupByIdentity(items: GraphItem[]): IdentityGroups {
  const groups: IdentityGroups = new Map();
  for (const it of items) {
    if (it.sourceType === "lineage") continue;
    const { key, cap } = getIdentity(it.rawString || it.name, it.entity, it.param);
    const group = groups.get(key) ?? { cap, nodes: [] };
    group.nodes.push(it);
    groups.set(key, group);
  }
  return groups;
}

// Flag the purchases beyond an identity's cap with OVER_CAP (the surplus takings).
function flagOverCap(group: IdentityGroup): void {
  const purchases = group.nodes.filter((n) => n.sourceType === "purchased");
  for (const surplus of purchases.slice(group.cap)) {
    surplus.effects.push({ type: "OVER_CAP", cap: group.cap });
  }
}

// PASS 3 — group nodes by dedupe identity and flag over-cap purchases. Returns the
// groups so the bestow pass can extend them (a bestow coinciding with a purchase at cap
// refunds the purchase).
function applyCaps(items: GraphItem[]): IdentityGroups {
  const groups = groupByIdentity(items);
  for (const group of groups.values()) flagOverCap(group);
  return groups;
}

// Resolve a bestow-target ref to its entity, retrying the bare name against the common
// collections when the exact collection misses.
function resolveBestowEntity(ref: EntityRef): Entity | null {
  const direct = lookupEntity(`${collectionOf(ref.type)}:${ref.name}`);
  if (direct) return direct;
  const clean = cleanItemName(ref.name);
  return lookupEntity(`skills:${clean}`) || lookupEntity(`powers:${clean}`) || lookupEntity(`perks:${clean}`);
}

// Bestows + purchases already filling the identity's cap: the bestow is redundant and
// dropped, but it still WINS over a coinciding purchase — refund that purchase so it
// becomes free. Returns true when the bestow was absorbed (caller skips node creation).
function absorbBestowAtCap(group: IdentityGroup, bestowedBy: string): boolean {
  const owned = group.nodes.filter((n) => n.sourceType === "bestow" || n.sourceType === "purchased").length;
  if (owned < group.cap) return false;
  const purchasedNode = group.nodes.find(
    (n) => n.sourceType === "purchased" && !n.effects?.some((e) => e.type === "REFUND_BESTOW"),
  );
  purchasedNode?.effects.push({ type: "REFUND_BESTOW", source: bestowedBy });
  return true;
}

// Add one bestowed node (or absorb it at cap) for a single BESTOW_SOURCE target.
function applyBestow(ref: EntityRef, source: GraphItem, items: GraphItem[], itemIdentities: IdentityGroups): void {
  const ent = resolveBestowEntity(ref);
  const bestowName = ent?.name || ref.name;

  const { key, cap } = getIdentity(bestowName, ent, extractParam(ref.name));
  let group = itemIdentities.get(key);
  if (!group) {
    group = { cap, nodes: [] };
    itemIdentities.set(key, group);
  }

  if (absorbBestowAtCap(group, source.name)) return;

  const newBestow: GraphItem = {
    id: ent?.id || `${collectionOf(ref.type)}:${ref.name}`,
    name: bestowName,
    rawString: bestowName,
    param: extractParam(bestowName),
    field: toGraphField(collectionOf(ref.type)),
    sourceType: "bestow",
    bestowedBy: source.name,
    bestowKind: source.sourceType,
    cls: source.cls ?? source.entity?.parentClass ?? null,
    rank: 1,
    baseCost: 0,
    entity: ent,
    effects: [],
    specialty: null,
    floor: 0,
    index: -1,
  };
  items.push(newBestow);
  group.nodes.push(newBestow);
}

// PASS 4 — expand BESTOW_SOURCE effects into real bestow nodes (cap-aware; see
// applyBestow). Mutates `items` and the identity groups in place.
function expandBestows(items: GraphItem[], itemIdentities: IdentityGroups): void {
  for (const node of [...items]) {
    for (const eff of node.effects) {
      if (eff.type !== "BESTOW_SOURCE") continue;
      for (const ref of eff.bestows) applyBestow(ref, node, items, itemIdentities);
    }
  }
}

// PASS 5 — patch class-granted starting skills with their specialty/floor. The grants
// are positional (indexed over the class-sourced skill nodes in order), so this walks
// those nodes and stamps the matching floor/specialty from startingSkillBestows.
function patchStartingSkills(character: CharacterState, items: GraphItem[]): void {
  const grants = startingSkillBestows(character);
  let startingNodeIdx = 0;
  for (const node of items) {
    if (node.field === "skills" && node.sourceType === "class") {
      if (grants.specialty[startingNodeIdx] != null) node.specialty = grants.specialty[startingNodeIdx];
      if (grants.floor[startingNodeIdx] != null) node.floor = grants.floor[startingNodeIdx];
      startingNodeIdx++;
    }
  }
}

export function resolveCharacterGraph(charInput: CharacterState): CharacterGraphModel {
  const character = normalizeCharacter(charInput);

  const items = buildNodes(character);
  addFlawNodes(character, items);
  const itemIdentities = applyCaps(items);
  expandBestows(items, itemIdentities);
  // Tax Evasion's wealth bonus is a WEALTH effect on the Tax Evasion node itself (see
  // extractTaxEvasion) — no synthetic node, no `synthetic` source/field, so no pass here.
  patchStartingSkills(character, items);

  return new CharacterGraphModel(character, items, characterLevel(character), getClasses(character));
}
