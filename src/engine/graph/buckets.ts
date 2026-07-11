import type { BucketedView, FlawView, PowerView, SpellView, PerkView, SkillView, GraphItem, Entity, Flaw, Power, Spell, Perk, Skill, FallbackEntity, ViewState } from "../types.js";
import type { CharacterGraphModel } from "./model.js";

function isEntity<T extends Entity>(entity: Entity | null | undefined, type: string): entity is T {
  return entity?.type === type;
}
export function buildBucketedView(graph: CharacterGraphModel): BucketedView {
  const view: BucketedView = {
    classes: [],
    innatePowers: [],
    basicPowers: [],
    advancedPowers: [],
    veteranPowers: [],
    utilityPowers: [],
    classPowers: [],
    domainPowers: [],
    skills: [],
    perks: [],
    flaws: [],
    knownSpells: [],
  };

  for (const { name: cls, level: clsLevel } of graph.classes) {
    view.classes.push({ name: cls, level: clsLevel, type: "class" });
  }

  for (const node of graph.items) {
    if (node.field === "synthetic" || node.field === "lineageAdvantages" || node.field === "lineageChallenges")
      continue;

    if (node.field === "flaws") {
      view.flaws.push(createViewEntry<Flaw>(node, "flaw"));
      continue;
    }

    const t = node.entity?.type;
    const tier = node.entity?.tier;

    if (t === "spell") {
      view.knownSpells.push(createViewEntry<Spell>(node, "spell"));
    } else if (node.sourceType === "innate") {
      view.innatePowers.push(createViewEntry<Power>(node, "power"));
    } else if (t === "power") {
      if (tier === "Basic") view.basicPowers.push(createViewEntry<Power>(node, "power"));
      else if (tier === "Advanced") view.advancedPowers.push(createViewEntry<Power>(node, "power"));
      else if (tier === "Veteran") view.veteranPowers.push(createViewEntry<Power>(node, "power"));
      else if (tier === "Utility") view.utilityPowers.push(createViewEntry<Power>(node, "power"));
      else if (tier === "Class" || node.field === "classPowers")
        view.classPowers.push(createViewEntry<Power>(node, "power"));
      else if (node.field === "domainPowers") view.domainPowers.push(createViewEntry<Power>(node, "power"));
      else view.classPowers.push(createViewEntry<Power>(node, "power"));
    } else if (t === "perk") {
      view.perks.push(createViewEntry<Perk>(node, "perk"));
    } else {
      view.skills.push(createViewEntry<Skill>(node, "skill"));
    }
  }

  return view;
}

function createViewEntry<T extends Entity>(node: GraphItem, expectedType: string): (T | FallbackEntity) & ViewState {
  const isFree =
    node.sourceType === "grant" ||
    node.sourceType === "innate" ||
    (node.effects && node.effects.some((e) => e.type === "REFUND_GRANT"));
  const paramValue = node.param ?? (node.entity?.parameter || undefined);
  const displayName = paramValue && !node.name.includes(paramValue) ? `${node.name} (${paramValue})` : node.name;

  let grantedBy = node.grantedBy;
  if (node.sourceType === "grant" && !grantedBy) {
    const refundEff = node.effects?.find((e) => e.type === "REFUND_GRANT");
    if (refundEff) grantedBy = refundEff.source;
  }

  const baseEntity = isEntity<T>(node.entity, expectedType) ? node.entity : { name: displayName, type: "unknown" as const };

  const viewState: ViewState = {
    id: node.id,
    entityId: node.entity?.id || node.id,
    param: paramValue,
    sourceType: node.sourceType,
    grantedBy,
    free: isFree,
    cost: isFree ? 0 : (node.authoredCost ?? node.baseCost),
    rank: node.rank,
    index: node.index ?? (node.sourceType === "grant" ? -1 : node.index),
    cls: node.cls ?? node.entity?.parentClass ?? null,
    effects: node.effects,
    rawString: node.rawString,
    field: node.field,
    choiceData: node.choiceData,
    specialty: node.specialty,
    floor: node.floor,
  };

  return { ...baseEntity, ...viewState };
}
