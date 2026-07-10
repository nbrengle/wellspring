import {
    REFS
} from "../../engine/data.js";
import { bareSkill, cleanItemName } from "../resolver.js";
import type {
    BPLedger,
    BPLedgerEntry,
    DiscountSpec,
    GraphItem
} from "../types.js";
import { MAX_FLAW_BP } from "../validate/core.js";
import { costKey } from "../validate/cost-key.js";
import type { CharacterGraphModel } from "./model.js";
import { stripParam } from "./model.js";

export function computeSpend(graph: CharacterGraphModel): BPLedger {
    // Build index of things granted by the character's owned items.
    const paramKey = (typedName: string) => {
      const c = typedName.includes(":") ? typedName : `:${typedName}`;
      let type = c.slice(0, c.indexOf(":"));
      const rest = c.slice(c.indexOf(":") + 1);
      if (type === "purchasedSkills" || type === "startingSkills") type = "skills";
      if (type === "purchasedPerks") type = "perks";
      const paren = rest.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
      const dash = rest.match(/^(.*?)\s+-\s+(.*)$/);
      const m = paren || dash;
      if (!m) return null;
      return `${type}:${m[1].trim()}|${m[2].trim().toLowerCase()}`;
    };
    const grantIndex: Record<string, string> = {};
    const grantParamIndex: Record<string, string> = {};
    for (const node of graph.items) {
      for (const eff of node.effects) {
        if (eff.type === "GRANT_SOURCE") {
          eff.grants.forEach((g) => {
            if (!grantIndex[g]) grantIndex[g] = node.name;
            const pk = paramKey(g);
            if (pk && !grantParamIndex[pk]) grantParamIndex[pk] = node.name;
          });
        }
      }
    }

    let rawAwarded = 0;
    let refunded = 0;
    const byItem: Record<string, BPLedgerEntry> = {};

    // Phase 1: Base Costs and Grants
    //
    // The cost entry lives ON the node (node.costEntry) — the spreadsheet-row model:
    // each owned item carries its own base/rank/floor/discount/you-pay. Phases 2–3
    // and the total read the entry off the node; nothing looks a cost up by a string
    // key or array index. `byItem` (below) is a derived name-keyed PROJECTION built
    // once at the end for external/UI consumers, not the engine's source of truth.
    const setEntry = (node: GraphItem, entry: BPLedgerEntry) => {
      node.costEntry = entry;
    };

    for (const node of graph.items) {
      if (node.field === "flaws") {
        setEntry(node, { cost: node.baseCost, base: node.baseCost, grant: null });
        rawAwarded += -node.baseCost;
        continue;
      }

      let isGranted = false;
      let grantSrc: string | undefined;
      let isDerived = false;
      const nId = node.entityId || node.id;
      // Build the grant-matching key from the node's STRUCTURED param (parsed once
      // at creation) instead of re-scraping rawString. Key shape matches paramKey():
      // `${type}:${base}|${param}`. null when the node carries no param.
      const nodeParamKey =
        node.param && nId
          ? `${nId.slice(0, nId.indexOf(":"))}:${node.entity?.baseName || stripParam(node.name)}|${node.param.toLowerCase()}`
          : null;
      const normalizedId = nId
        ? nId
            .replace(/^purchasedSkills:/, "skills:")
            .replace(/^startingSkills(:\d+)?:/, "skills:")
            .replace(/^purchasedPerks:/, "perks:")
        : null;

      if (normalizedId && grantIndex[normalizedId]) {
        isGranted = true;
        grantSrc = grantIndex[normalizedId];
        isDerived = true;
      } else if (nodeParamKey && grantParamIndex[nodeParamKey]) {
        isGranted = true;
        grantSrc = grantParamIndex[nodeParamKey];
        isDerived = true;
      } else if (node.sourceType === "innate" || node.field === "multiclassGrant") {
        isGranted = true;
        grantSrc = "class";
        isDerived = true;
      }

      if (typeof node.authoredCost === "number") {
        if (isDerived && node.authoredCost > 0) {
          setEntry(node, {
            cost: 0,
            base: node.baseCost,
            grant: { kind: "grant", source: grantSrc, derived: true },
            rank: node.rank,
          });
        } else {
          setEntry(node, {
            cost: node.authoredCost,
            base: node.baseCost,
            grant: null,
            rank: node.rank,
            authored: true,
          });
        }
        continue;
      }

      if (node.sourceType === "class") {
        const floor = node.floor;

        if (isGranted) {
          setEntry(node, { cost: -node.baseCost, base: 0, grant: { kind: "grant", source: grantSrc, derived: true } });
          refunded += node.baseCost;
          continue;
        }

        if (floor && node.rank > floor) {
          const extra = node.rank - floor;
          const entCost = node.baseCost / node.rank || 0;
          const extraCost = entCost * extra;
          setEntry(node, {
            cost: extraCost,
            base: entCost,
            grant: null,
            rank: node.rank,
            freeRanks: floor,
            paidRanks: extra,
          });
        } else {
          setEntry(node, {
            cost: 0,
            base: node.baseCost / node.rank || 0,
            grant: null,
            rank: node.rank,
            freeRanks: floor || 1,
            paidRanks: 0,
          });
        }
        continue;
      }

      if (isGranted) {
        setEntry(node, {
          cost: 0,
          base: node.baseCost,
          grant: { kind: "grant", source: grantSrc, derived: true },
          rank: node.rank,
        });
      } else {
        setEntry(node, { cost: node.baseCost, base: node.baseCost, grant: null, rank: node.rank });
      }
    }

    // Phase 2: Apply Discounts
    const discountSources: (DiscountSpec & { id: string; name: string })[] = [];
    for (const node of graph.items) {
      for (const eff of node.effects) {
        if (eff.type === "DISCOUNT_SOURCE") {
          discountSources.push({ ...eff.discount, id: node.id, name: node.name });
        }
      }
    }

    const used = new Map<string, number>();
    const catCount = new Map<string, number>();
    let discountFreeBP = 0;
    const discountsApplied: BPLedger["discountsApplied"] = [];

    for (const node of graph.items) {
      if (node.field !== "skills" && node.field !== "perks") continue;

      const eff = node.costEntry;
      if (!eff || eff.authored) continue;

      const catKey = node.entity?.category || cleanItemName(node.rawString || node.name).split(" ")[0];
      const pos = catCount.get(catKey) || 0;
      catCount.set(catKey, pos + 1);

      for (const src of discountSources) {
        if (!discountApplies(src, node, pos)) continue;
        const min = src.min ?? 0;
        const room = src.cap == null ? Infinity : src.cap - (used.get(src.id) || 0);
        if (room <= 0) continue;

        const reducible = Math.max(0, eff.cost - min);
        const cut = Math.min(src.amount, reducible, room);

        if (cut <= 0) {
          if (eff.cost === 0 && (eff.grant?.kind === "grant" || (eff.freeRanks || 0) > 0) && src.refundIfFree) {
            const refund = Math.min(src.amount, room);
            discountFreeBP += refund;
            used.set(src.id, (used.get(src.id) || 0) + refund);
            discountsApplied.push({ key: node.id, source: src.name, amount: refund });
          }
          continue;
        }

        eff.cost -= cut;
        eff.discount = { source: src.name, amount: cut };
        used.set(src.id, (used.get(src.id) || 0) + cut);
        discountsApplied.push({ key: node.id, source: src.name, amount: cut });
        break;
      }
    }

    // Phase 3: Total Summation — read the you-pay cost straight off each node's
    // entry (flaws carry a negative "cost" that feeds rawAwarded, not spend).
    let spent = 0;
    for (const node of graph.items) {
      if (node.field === "flaws") continue;
      const eff = node.costEntry;
      if (eff && eff.cost > 0) spent += eff.cost;
    }

    // Derived name-keyed projection for external/UI consumers (sheet, validate rows).
    // Not the engine's source of truth — that's node.costEntry. Later readers move
    // to reading cost off the resolved row and this can go.
    for (const node of graph.items) {
      const k = costKey(node);
      if (node.costEntry && k) byItem[k] = node.costEntry;
    }

    const awarded = Math.min(rawAwarded, MAX_FLAW_BP);

    // `refunded` and `discountFreeBP` are accounting intermediates — they feed `net`
    // and nothing outside reads them, so they stay local (not part of the ledger).
    return {
      spent,
      awarded,
      rawAwarded,
      flawCapped: rawAwarded > MAX_FLAW_BP,
      discountsApplied,
      net: spent - refunded - discountFreeBP,
      byItem,
    };
}

export function discountApplies(src: DiscountSpec & { id: string; name: string }, itemNode: GraphItem, pos: number): boolean {
    const ent = itemNode.entity;
    const itemName = itemNode.name;
    const scopeValue = String(src.scope.value);
    if ((ent?.id && src.exclusions?.includes(ent.id)) || src.exclusions?.includes(`perks:${cleanItemName(itemName)}`))
    return false;
    const cat = ent?.category;
    if (src.scope.kind === "category") {
    return (
      Array.isArray(src.scope.value) &&
      src.scope.value.some((c: string) => c.toLowerCase() === String(cat).toLowerCase())
    );
    }

    if (src.scope.kind === "firstN") {
    return (
      new RegExp(`^${scopeValue}\\b`, "i").test(cleanItemName(itemName)) && (src.scope.n == null || pos < src.scope.n)
    );
    }

    if (src.scope.kind === "skillRanks") {
    return new RegExp(`^${scopeValue}\\b`, "i").test(cleanItemName(itemName));
    }

    if (src.scope.kind === "namedSkill") {
    return bareSkill(cleanItemName(itemName)) === scopeValue;
    }

    if (src.scope.kind === "prereq") {
    const pr = ent?.id ? REFS.prereqs?.[ent.id] : undefined;
    const target = `perks:${scopeValue}`;
    return (
      !!pr && (pr.skills?.includes(target) || !!pr.other?.some((o: string) => new RegExp(scopeValue, "i").test(o)))
    );
    }

    if (src.scope.kind === "giftEligible") {
    if (!ent || ent.id?.startsWith("skills:")) return false;
    if (ent.id === `perks:${scopeValue}`) return false;
    const prereqText = String(ent.prereq || "");
    if (new RegExp(`\\b${scopeValue}\\b`, "i").test(prereqText)) return false;
    return true;
    }

    return false;
}
