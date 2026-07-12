import type { BucketedView, GraphItem, Entity, Flaw, Power, Spell, Perk, Skill, ViewState } from "../types.js";
import type { CharacterGraphModel } from "./model.js";
import { composeDisplayName } from "./model.js";
import { CLASSES } from "../data.js";

function isEntity<T extends Entity>(entity: Entity | null, type: T["type"]): entity is T {
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
    unresolved: [],
  };

  for (const { name: cls, level: clsLevel } of graph.classes) {
    const def = CLASSES[cls];
    view.classes.push(
      def
        ? { ...def, level: clsLevel }
        : { name: cls, level: clsLevel, type: "class", kind: "Martial", magicType: null },
    );
  }

  // Push node into `bucket` as a view entry of the expected entity type. A node whose
  // entity didn't resolve to that type is a data-integrity failure (stale/typo'd id) —
  // instead of pushing a stub, record it on `unresolved` so validation can surface it.
  const pushInto = <T extends Entity>(bucket: (T & ViewState)[], node: GraphItem, type: T["type"]) => {
    if (!isEntity<T>(node.entity, type)) {
      view.unresolved.push({
        entityId: node.entityId ?? node.id,
        name: node.name,
        sourceType: node.sourceType,
        field: node.field,
      });
      return;
    }
    bucket.push(createViewEntry(node, node.entity));
  };

  for (const node of graph.items) {
    // Lineage advantage/challenge rows aren't view entities.
    if (node.sourceType === "lineage") continue;
    // Devotions are graph-internal (effect carriers) — the UI shows the chosen devotion
    // via report.devotion, not a view bucket. They're indexed with a `devotions:` id but
    // aren't part of the Entity view union, so skip by collection to keep them out of the
    // skills list. (Match on the entity's own id, not the node's originating field.)
    if (node.entity?.id?.startsWith("devotions:")) continue;

    if (node.sourceType === "flaw") {
      pushInto<Flaw>(view.flaws, node, "flaw");
      continue;
    }

    const t = node.entity?.type;
    const tier = node.entity?.tier;

    if (t === "spell") {
      pushInto<Spell>(view.knownSpells, node, "spell");
    } else if (node.sourceType === "innate") {
      pushInto<Power>(view.innatePowers, node, "power");
    } else if (t === "power") {
      // A domain power is a `power` with no distinguishing entity field — the graph
      // stamps `powerKind` from its originating bucket so it routes here, not into the
      // class-power list (the old `field === "domainPowers"` check never fired).
      if (node.powerKind === "domain") pushInto<Power>(view.domainPowers, node, "power");
      else if (tier === "Basic") pushInto<Power>(view.basicPowers, node, "power");
      else if (tier === "Advanced") pushInto<Power>(view.advancedPowers, node, "power");
      else if (tier === "Veteran") pushInto<Power>(view.veteranPowers, node, "power");
      else if (tier === "Utility") pushInto<Power>(view.utilityPowers, node, "power");
      else pushInto<Power>(view.classPowers, node, "power");
    } else if (t === "perk") {
      pushInto<Perk>(view.perks, node, "perk");
    } else {
      // Skills split by HOW they were acquired, matching the sheet's two blocks:
      // BOUGHT (Purchased Skills) vs BESTOWED for free (Starting/Free Skills). A skill
      // is bestowed iff its source isn't a purchase — class starting skills, lineage
      // or power grants. The grouping is purely a view concern; the row's provenance
      // already lives in node.sourceType.
      pushInto<Skill>(node.sourceType === "purchased" ? view.skills : view.bestowedSkills, node, "skill");
    }
  }

  return view;
}

function createViewEntry<T extends Entity>(node: GraphItem, entity: T): T & ViewState {
  const isFree =
    node.sourceType === "bestow" ||
    node.sourceType === "innate" ||
    (node.effects && node.effects.some((e) => e.type === "REFUND_BESTOW"));
  const paramValue = node.param ?? (entity.parameter || undefined);
  const displayName = composeDisplayName(node.name, paramValue);

  let bestowedBy = node.bestowedBy;
  if (node.sourceType === "bestow" && !bestowedBy) {
    const refundEff = node.effects?.find((e) => e.type === "REFUND_BESTOW");
    if (refundEff) bestowedBy = refundEff.source;
  }

  const viewState: ViewState = {
    id: node.id,
    name: displayName,
    entityId: entity.id || node.id,
    param: paramValue,
    sourceType: node.sourceType,
    bestowedBy,
    free: isFree,
    cost: isFree ? 0 : (node.authoredCost ?? node.baseCost),
    rank: node.rank,
    index: node.index ?? (node.sourceType === "bestow" ? -1 : node.index),
    cls: node.cls ?? entity.parentClass ?? null,
    effects: node.effects,
    rawString: node.rawString,
    field: node.field,
    choiceData: node.choiceData,
    specialty: node.specialty,
    floor: node.floor,
  };

  return { ...entity, ...viewState };
}
