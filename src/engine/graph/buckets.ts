import type {
    BucketedView
} from "../types.js";
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

      // Use the structured node.param (parsed once at creation); fall back to the
      // entity's param label only for display when the node carries no value.
      const paramValue = node.param ?? (node.entity?.parameter || undefined);
      const displayName = paramValue && !node.name.includes(paramValue) ? `${node.name} (${paramValue})` : node.name;

      const isFree =
        node.sourceType === "grant" || (node.effects && node.effects.some((e) => e.type === "REFUND_GRANT"));
      let grantedBy = node.grantedBy;
      if (isFree && !grantedBy) {
        const refundEff = node.effects?.find((e) => e.type === "REFUND_GRANT");
        if (refundEff) grantedBy = refundEff.source;
      }

      const viewEntry = {
        ...(node.entity || { name: displayName, type: "unknown" }),
        id: node.id,
        entityId: node.entity?.id || node.id,
        name: displayName,
        sourceType: node.sourceType,
        grantedBy,
        free: isFree,
        cost: isFree ? 0 : (node.authoredCost ?? node.baseCost),
        rank: node.rank,
        // Grants/synthesized items have no storage index; -1 marks them
        // non-removable (the UI's canRemove is `!fromClass && index >= 0`).
        index: node.index ?? (node.sourceType === "grant" ? -1 : node.index),
        // Which class this came from (for multiclass clarity): the granting/owning
        // class, else the entity's parentClass.
        cls: node.cls ?? node.entity?.parentClass ?? null,
        effects: node.effects,
        rawString: node.rawString,
        field: node.field,
        choiceData: node.choiceData,
        specialty: node.specialty,
        floor: node.floor,
        // One object literal is routed at runtime into 12 differently-typed buckets
        // (SkillView | PowerView | …), and the fallback branch has no real Entity
        // (`type: "unknown"`), so it can't statically satisfy any single variant. The
        // routing below IS the discriminator; this is the one honest escape hatch.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      if (node.field === "flaws") {
        view.flaws.push(viewEntry);
        continue;
      }

      // Entity types are PLURAL ('skills' / 'perks' / 'powers' / 'spell'); route by them.
      const t = node.entity?.type;
      const tier = node.entity?.tier;

      if (node.sourceType === "innate") {
        view.innatePowers.push(viewEntry);
      } else if (t === "spell") {
        view.knownSpells.push(viewEntry);
      } else if (t === "power") {
        if (tier === "Basic") view.basicPowers.push(viewEntry);
        else if (tier === "Advanced") view.advancedPowers.push(viewEntry);
        else if (tier === "Veteran") view.veteranPowers.push(viewEntry);
        else if (tier === "Utility") view.utilityPowers.push(viewEntry);
        else if (tier === "Class" || node.field === "classPowers") view.classPowers.push(viewEntry);
        else if (node.field === "domainPowers") view.domainPowers.push(viewEntry);
        else view.classPowers.push(viewEntry);
      } else if (t === "perk") {
        view.perks.push(viewEntry);
      } else {
        view.skills.push(viewEntry);
      }
    }

    return view;
}
