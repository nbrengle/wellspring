import type {
  BucketedView,
  GraphItem,
  Entity,
  Flaw,
  Power,
  Spell,
  Perk,
  Skill,
  FallbackEntity,
  ViewState,
} from "../types.js";
import type { CharacterGraphModel } from "./model.js";
import { composeDisplayName } from "./model.js";

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
    bestowedSkills: [],
    perks: [],
    flaws: [],
    knownSpells: [],
  };

  for (const { name: cls, level: clsLevel } of graph.classes) {
    view.classes.push({ name: cls, level: clsLevel, type: "class" });
  }

  for (const node of graph.items) {
    // Lineage advantage/challenge rows aren't view entities.
    if (node.sourceType === "lineage") continue;

    if (node.sourceType === "flaw") {
      view.flaws.push(createViewEntry<Flaw>(node, "flaw"));
      continue;
    }

    const t = node.entity?.type;
    const tier = t === "power" || t === "spell" || t === "subpower" ? node.entity?.tier : undefined;

    if (t === "spell") {
      view.knownSpells.push(createViewEntry<Spell>(node, "spell"));
    } else if (node.sourceType === "innate") {
      view.innatePowers.push(createViewEntry<Power>(node, "power"));
    } else if (t === "power") {
      // A domain power is a `power` with no distinguishing entity field — the graph
      // stamps `powerKind` from its originating bucket so it routes here, not into the
      // class-power list (the old `field === "domainPowers"` check never fired).
      if (node.powerKind === "domain") view.domainPowers.push(createViewEntry<Power>(node, "power"));
      else if (tier === "Basic") view.basicPowers.push(createViewEntry<Power>(node, "power"));
      else if (tier === "Advanced") view.advancedPowers.push(createViewEntry<Power>(node, "power"));
      else if (tier === "Veteran") view.veteranPowers.push(createViewEntry<Power>(node, "power"));
      else if (tier === "Utility") view.utilityPowers.push(createViewEntry<Power>(node, "power"));
      else view.classPowers.push(createViewEntry<Power>(node, "power"));
    } else if (t === "perk") {
      view.perks.push(createViewEntry<Perk>(node, "perk"));
    } else {
      // Skills split by HOW they were acquired, matching the sheet's two blocks:
      // BOUGHT (Purchased Skills) vs BESTOWED for free (Starting/Free Skills). A skill
      // is bestowed iff its source isn't a purchase — class starting skills, lineage
      // or power grants. The grouping is purely a view concern; the row's provenance
      // already lives in node.sourceType.
      const entry = createViewEntry<Skill>(node, "skill");
      if (node.sourceType === "purchased") view.skills.push(entry);
      else view.bestowedSkills.push(entry);
    }
  }

  return view;
}

function createViewEntry<T extends Entity>(node: GraphItem, expectedType: string): (T | FallbackEntity) & ViewState {
  const isFree =
    node.sourceType === "bestow" ||
    node.sourceType === "innate" ||
    (node.effects && node.effects.some((e) => e.type === "REFUND_BESTOW"));
  const paramValue = node.param ?? (node.entity?.parameter || undefined);
  const displayName = composeDisplayName(node.name, paramValue);

  let bestowedBy = node.bestowedBy;
  if (node.sourceType === "bestow" && !bestowedBy) {
    const refundEff = node.effects?.find((e) => e.type === "REFUND_BESTOW");
    if (refundEff) bestowedBy = refundEff.source;
  }

  const baseEntity = isEntity<T>(node.entity, expectedType)
    ? node.entity
    : { name: displayName, type: "unknown" as const };

  const viewState: ViewState = {
    id: node.id,
    name: displayName,
    entityId: node.entity?.id || node.id,
    param: paramValue,
    sourceType: node.sourceType,
    bestowedBy,
    free: isFree,
    cost: isFree ? 0 : (node.authoredCost ?? node.baseCost),
    rank: node.rank,
    index: node.index ?? (node.sourceType === "bestow" ? -1 : node.index),
    cls:
      node.cls ??
      (node.entity?.type === "power" || node.entity?.type === "skill" ? node.entity.parentClass : undefined) ??
      null,
    effects: node.effects,
    rawString: node.rawString,
    field: node.field,
    choiceData: node.choiceData,
    specialty: node.specialty,
    floor: node.floor,
  };

  return { ...baseEntity, ...viewState };
}
