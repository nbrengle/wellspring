import { CLASS_PROGRESSION, LEVEL_TABLE } from "../../engine/data.js";
import type { BaseEntity } from "../types.js";
import type { CharacterGraphModel } from "./model.js";
export function computeStats(graph: CharacterGraphModel) {
  const mods: Record<string, number> = { lifePoints: 0, spikes: 0, naturalArmor: 0, armor: 0 };
  const sources: { name: string; stat: string; amount: number }[] = [];
  const notes: { name: string; stat: string; text: string }[] = [];

  const apply = (name: string, ent: Pick<BaseEntity, "statMods"> | undefined) => {
    if (!ent) return;
    for (const mod of ent.statMods || []) {
      if ("amount" in mod) {
        if (mod.amount !== 0) {
          mods[mod.stat] = (mods[mod.stat] || 0) + mod.amount;
          sources.push({ name, stat: mod.stat, amount: mod.amount });
        }
      } else if ("text" in mod) {
        notes.push({ name, ...mod });
      }
    }
  };

  for (const node of graph.items) {
    for (const eff of node.effects) {
      if (eff.type === "STAT") {
        mods[eff.stat] = (mods[eff.stat] || 0) + eff.amount;
        sources.push({ name: node.name, stat: eff.stat, amount: eff.amount });
      }
    }
    if (node.entity?.statMods) {
      for (const mod of node.entity.statMods) {
        if ("text" in mod) {
          notes.push({ name: node.name, ...mod });
        }
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
