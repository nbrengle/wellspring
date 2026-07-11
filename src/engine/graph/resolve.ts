import { ALLERGEN_AWARDS, allergenAward, lookupEntity } from "../../engine/data.js";
import { EFFECT_EXTRACTORS } from "../extractors.js";
import { paramInfo, paramReusable } from "../param-domain.js";
import { bareSkill, cleanItemName, getClasses } from "../resolver.js";
import { startingSkillGrants } from "../starting-choices.js";
import type {
  CharacterChoice,
  CharacterState,
  Effect,
  Entity,
  EntitySource,
  GraphField,
  GraphItem,
  GraphSourceType,
  PowerKind,
} from "../types.js";
import { Source, isPurchased, isStarting, sourceClass } from "../types.js";
import { characterLevel, getMaxRanks } from "../validate/core.js";
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

export function resolveCharacterGraph(charInput: CharacterState): CharacterGraphModel {
  const character = normalizeCharacter(charInput);
  const items: GraphItem[] = [];
  const charLevel = characterLevel(character);
  const classes = getClasses(character);

  buildNodes(character, items);
  const itemIdentities = applyCaps(items);
  expandBestows(items, itemIdentities);
  applySynthetics(character, items);

  return new CharacterGraphModel(character, items, charLevel, classes);
}

function buildNodes(character: CharacterState, items: GraphItem[]) {
  const addItem = (choice: CharacterChoice) => {
    let ent = lookupEntity(choice.entityId);
    const rawName = choice.entityId.replace(/^[a-z]+:/i, "");
    const cleanName = cleanItemName(rawName);
    const bareName = bareSkill(cleanName);

    if (!ent) {
      ent =
        lookupEntity(`skills:${bareName}`) || lookupEntity(`perks:${cleanName}`) || lookupEntity(`powers:${cleanName}`);
    }

    const baseDisplay = ent?.name || cleanName;
    const param = choice.parameter;
    const displayName = composeDisplayName(baseDisplay, param);

    const rank = choice.ranks || 1;
    const effects: Effect[] = [];

    let baseCost = 0;
    if (ent && "tiers" in ent && Array.isArray(ent.tiers) && ent.tiers.length) {
      const n = Math.min(rank, ent.tiers.length);
      baseCost = ent.tiers.slice(0, n).reduce((s: number, t: { cost?: number }) => s + (t.cost || 0), 0);
    } else {
      const entityCost = ent && "cost" in ent ? ent.cost : undefined;
      const lbp = ent && "lbp" in ent ? ent.lbp : 0;
      baseCost = (typeof entityCost === "number" ? entityCost : lbp || 0) * rank;
    }

    const entityId = ent?.id || choice.entityId;
    for (const extractor of EFFECT_EXTRACTORS) {
      effects.push(...extractor(ent, character, entityId));
    }

    const src: EntitySource = choice.source || Source.purchased();
    const sourceType = SOURCE_TYPE[src.type];

    const field = toGraphField(choice.entityId.split(":")[0], ent?.id?.split(":")[0]);

    const powerKind: PowerKind | undefined =
      ent?.type === "power" ? (choice.costField === "domainPowers" ? "domain" : "class") : undefined;

    const idPrefixName = ent?.type ? idPrefix(ent) : null;
    const nodeId = idPrefixName ? `${idPrefixName}:${displayName}` : entityId;

    items.push({
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
    });
  };

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
        entityId = `advantages:${character.advantageChoices["Pick and Choose"]}`;
      }
      const choice = { entityId, ranks: 1, source: Source.lineage() };
      addItem(choice);
    }
  }

  for (const choice of character.flaws || []) {
    const rawName = choice.entityId.replace(/^flaws:/i, "");
    const cleanName = cleanItemName(rawName);
    const ent = lookupEntity(`flaws:${cleanName}`);

    const param = choice.parameter;
    let bp = 0;
    if (ent) {
      const allergenBase = ent.baseName || ent.name;
      const allergenTable = allergenBase ? ALLERGEN_AWARDS[allergenBase] : undefined;
      if (allergenTable) {
        const chosen = allergenAward(allergenBase, param);
        bp = chosen != null ? chosen : Math.min(...Object.values(allergenTable));
      } else if (ent?.type === "flaw") {
        bp = typeof ent.bp === "number" ? ent.bp : 0;
      }
    }

    const displayName = composeDisplayName(ent?.name || cleanName, param);
    const rawString = ent?.name && param ? `${ent.name} (${param})` : choice.entityId;

    items.push({
      id: ent?.id || `flaws:${cleanName}`,
      name: displayName,
      rawString,
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

function getIdentity(rawName: string, ent: Entity | null | undefined, param?: string | null) {
  const clean = cleanItemName(rawName);
  const entityId = ent?.id || rawName;
  const cap = getMaxRanks(entityId);
  const info = paramInfo(ent);
  const reusable = paramReusable(ent, entityId);
  const baseName = (ent?.baseName || ent?.name || bareSkill(clean)).toLowerCase();

  if (cap <= 1) return { key: baseName, cap };
  if (!info || reusable) return { key: baseName, cap };

  const paramValue = (param ?? ent?.parameter ?? "unknown").toLowerCase();
  return { key: `${baseName}|${paramValue}`, cap: 1 };
}

function applyCaps(items: GraphItem[]) {
  const itemIdentities = new Map<string, { cap: number; nodes: GraphItem[] }>();
  for (const it of items) {
    if (it.sourceType === "lineage") continue;
    const { key, cap } = getIdentity(it.rawString || it.name, it.entity, it.param);
    if (!itemIdentities.has(key)) itemIdentities.set(key, { cap, nodes: [] });
    itemIdentities.get(key)!.nodes.push(it);
  }

  for (const group of itemIdentities.values()) {
    const purchases = group.nodes.filter((n) => n.sourceType === "purchased");
    if (purchases.length > group.cap) {
      for (const surplus of purchases.slice(group.cap)) {
        surplus.effects = surplus.effects || [];
        surplus.effects.push({ type: "OVER_CAP", cap: group.cap });
      }
    }
  }
  return itemIdentities;
}

function expandBestows(items: GraphItem[], itemIdentities: Map<string, { cap: number; nodes: GraphItem[] }>) {
  for (const node of [...items]) {
    for (const eff of node.effects) {
      if (eff.type !== "BESTOW_SOURCE") continue;
      for (const gid of eff.bestows) {
        let ent = lookupEntity(gid);
        const gType = gid.slice(0, gid.indexOf(":"));
        const rawGidName = gid.slice(gid.indexOf(":") + 1);
        if (!ent) {
          const clean = cleanItemName(rawGidName);
          ent = lookupEntity(`skills:${clean}`) || lookupEntity(`powers:${clean}`) || lookupEntity(`perks:${clean}`);
        }

        const gName = ent?.name || rawGidName;
        // Still need extractParam here as it comes from a string gid
        const { key, cap } = getIdentity(gName, ent, extractParam(rawGidName));

        let group = itemIdentities.get(key);
        if (!group) {
          group = { cap, nodes: [] };
          itemIdentities.set(key, group);
        }

        const bestowCount = group.nodes.filter((n) => n.sourceType === "bestow").length;
        const purchaseCount = group.nodes.filter((n) => n.sourceType === "purchased").length;

        if (bestowCount + purchaseCount >= cap) {
          const purchasedNode = group.nodes.find(
            (n) => n.sourceType === "purchased" && !n.effects?.some((e) => e.type === "REFUND_BESTOW"),
          );
          if (purchasedNode) {
            purchasedNode.effects = purchasedNode.effects || [];
            purchasedNode.effects.push({ type: "REFUND_BESTOW", source: node.name });
          }
          continue;
        }

        const bucketCls = node.cls;
        const pClass = ent?.type === "power" || ent?.type === "skill" ? ent.parentClass : undefined;
        const newBestow: GraphItem = {
          id: ent?.id || gid,
          name: gName,
          rawString: gName,
          param: extractParam(gName),
          field: toGraphField(gType),
          sourceType: "bestow",
          bestowedBy: node.name,
          bestowKind: node.sourceType,
          cls: pClass && bucketCls !== pClass ? pClass : bucketCls,
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
    }
  }
}

function applySynthetics(character: CharacterState, items: GraphItem[]) {
  const grants = startingSkillGrants(character);
  let startingNodeIdx = 0;
  for (const node of items) {
    if (node.field === "skills" && node.sourceType === "class") {
      if (grants.specialty[startingNodeIdx] != null) node.specialty = grants.specialty[startingNodeIdx];
      if (grants.floor[startingNodeIdx] != null) node.floor = grants.floor[startingNodeIdx];
      startingNodeIdx++;
    }
  }
}
