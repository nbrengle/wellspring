import { EFFECT_EXTRACTORS } from "../extractors.js";
import {
  lookupEntity,
  allergenAward,
  ALLERGEN_AWARDS,
  LEVEL_TABLE,
  CLASS_PROGRESSION,
  REFS,
  CLASS_POWERS,
  CLASSES,
  BASE_CLASSES,
  collectionOf,
} from "../../engine/data.js";
import { startingSkillGrants } from "../starting-choices.js";
import { MAX_FLAW_BP } from "../validate/core.js";
import { costKey } from "../validate/cost-key.js";
import { cleanItemName, bareSkill, getClasses, parseWordNumber } from "../resolver.js";
import { characterLevel, getMaxRanks } from "../validate/core.js";
import { paramInfo, paramReusable } from "../param-domain.js";
import { spellSlots, type SpellPool } from "../validate/slots.js";
import type {
  CharacterState,
  GraphItem,
  CharacterGraph,
  Effect,
  EntitySource,
  BucketedView,
  BPLedger,
  BPLedgerEntry,
  BaseEntity,
  Entity,
  CharacterChoice,
  DiscountSpec,
  WealthReport,
} from "../types.js";
import {
  Source,
  isPurchased,
  isStarting,
  sourceClass,
  ResolvedStats,
  GrantedAbility,
  PrereqReport,
  PrereqIssue,
  PrereqNote,
} from "../types.js";
import type { CharacterGraphModel } from "./model.js";
export function computeWealth(graph: CharacterGraphModel): WealthReport {
    const DEFAULT_WEALTH = 8;
    const characterWealth = graph.character.wealth;
    const base =
      characterWealth != null && characterWealth !== ""
        ? parseInt(String(characterWealth), 10) || DEFAULT_WEALTH
        : DEFAULT_WEALTH;

    const sources: WealthReport["sources"] = [];
    let income = 0;

    const add = (source: string, amount: number, note: string) => {
      if (amount > 0) {
        income += amount;
        sources.push({ source, amount, note });
      }
    };

    // The graph already extracted all WEALTH effects (including the synthetic Tax Evasion)
    for (const node of graph.items) {
      for (const eff of node.effects) {
        if (eff.type === "WEALTH") {
          add(node.name, eff.amount, eff.note || "");
        }
      }
    }

    return { base, income, total: base + income, sources };
}
