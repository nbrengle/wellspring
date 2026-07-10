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
export function computeStats(graph: CharacterGraphModel) {
    const mods: Record<string, number> = { lifePoints: 0, spikes: 0, naturalArmor: 0, armor: 0 };
    const sources: { name: string; stat: string; n: number }[] = [];
    const notes: { name: string; stat: string; [k: string]: unknown }[] = [];

    const apply = (name: string, ent: Pick<BaseEntity, "statMods" | "statModNotes"> | undefined) => {
      if (!ent) return;
      for (const { stat, amount } of ent.statMods || []) {
        if (amount !== 0) {
          mods[stat] = (mods[stat] || 0) + amount;
          sources.push({ name, stat, n: amount });
        }
      }
      for (const note of ent.statModNotes || []) {
        notes.push({ name, ...note });
      }
    };

    for (const node of graph.items) {
      for (const eff of node.effects) {
        if (eff.type === "STAT") {
          mods[eff.stat] = (mods[eff.stat] || 0) + eff.amount;
          sources.push({ name: node.name, stat: eff.stat, n: eff.amount });
        }
      }
      if (node.entity?.statModNotes) {
        for (const note of node.entity.statModNotes) {
          notes.push({ name: node.name, ...note });
        }
      }
    }

    for (const { name: cls, level: clsLevel } of graph.classes) {
      const prog = CLASS_PROGRESSION[cls] || {};
      for (let lvl = 1; lvl <= clsLevel; lvl++) {
        apply(`${cls} L${lvl}`, prog[lvl]);
      }
    }

    const level = graph.characterLevel;
    const minRow = LEVEL_TABLE[0] || { level: 4, lp: 3, spikes: 0 };
    const maxRow = LEVEL_TABLE[LEVEL_TABLE.length - 1] || minRow;

    const row = LEVEL_TABLE.find((r) => r.level === level) || (level < minRow.level ? minRow : maxRow);

    const baseLp = row.lp ?? 0;
    const baseSp = row.spikes ?? 0;

    return {
      baseLifePoints: baseLp,
      baseSpikes: baseSp,
      lifePoints: baseLp + (mods.lifePoints || 0),
      spikes: baseSp + (mods.spikes || 0),
      armor: mods.armor || 0,
      naturalArmor: mods.naturalArmor || 0,
      mods: { ...mods, sources, notes },
    };
}
