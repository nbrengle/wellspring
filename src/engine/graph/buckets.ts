import type { BucketedView, FlawView, PowerView, SpellView, PerkView, SkillView, GraphItem } from "../types.js";
import type { CharacterGraphModel } from "./model.js";
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
      view.flaws.push(createViewEntry(node) as unknown as FlawView);
      continue;
    }

    const t = node.entity?.type;
    const tier = node.entity?.tier;

    if (t === "spell") {
      view.knownSpells.push(createViewEntry(node) as unknown as SpellView);
    } else if (node.sourceType === "innate") {
      view.innatePowers.push(createViewEntry(node) as unknown as PowerView);
    } else if (t === "power") {
      if (tier === "Basic") view.basicPowers.push(createViewEntry(node) as unknown as PowerView);
      else if (tier === "Advanced") view.advancedPowers.push(createViewEntry(node) as unknown as PowerView);
      else if (tier === "Veteran") view.veteranPowers.push(createViewEntry(node) as unknown as PowerView);
      else if (tier === "Utility") view.utilityPowers.push(createViewEntry(node) as unknown as PowerView);
      else if (tier === "Class" || node.field === "classPowers")
        view.classPowers.push(createViewEntry(node) as unknown as PowerView);
      else if (node.field === "domainPowers") view.domainPowers.push(createViewEntry(node) as unknown as PowerView);
      else view.classPowers.push(createViewEntry(node) as unknown as PowerView);
    } else if (t === "perk") {
      view.perks.push(createViewEntry(node) as unknown as PerkView);
    } else {
      view.skills.push(createViewEntry(node) as unknown as SkillView);
    }
  }

  return view;
}

function createViewEntry(node: GraphItem) {
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

  return {
    ...(node.entity || { name: displayName, type: "unknown" }),
    id: node.id,
    entityId: node.entity?.id || node.id,
    name: displayName,
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
}
