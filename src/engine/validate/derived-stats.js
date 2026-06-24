import { LEVEL_TABLE, CLASS_PROGRESSION } from '../data.js';

export function statMods(graph) {
  const mods = { lifePoints: 0, spikes: 0, naturalArmor: 0, armor: 0 };
  const sources = [];
  const notes = [];

  const apply = (name, ent) => {
    if (!ent) return;
    for (const { stat, n } of (ent.statMods || [])) {
      // Apply both bonuses AND penalties (e.g. Fragile Form: −1 Maximum Life Point).
      if (n !== 0) {
        mods[stat] = (mods[stat] || 0) + n;
        sources.push({ name, stat, n });
      }
    }
    for (const note of (ent.statModNotes || [])) {
      notes.push({ name, ...note });
    }
  };

  // 1. Extract from the graph items (Perks, Advantages, Powers, Innates, Skills)
  for (const node of graph.items) {
    for (const eff of node.effects) {
      if (eff.type === 'STAT') {
        mods[eff.stat] = (mods[eff.stat] || 0) + eff.amount;
        sources.push({ name: node.name, stat: eff.stat, n: eff.amount });
      }
    }
    if (node.entity?.statModNotes) {
      for (const note of node.entity.statModNotes) {
        if (note.text === 'variable' && node.effects.some(e => e.type === 'STAT' && e.stat === note.stat)) {
          continue;
        }
        notes.push({ name: node.name, ...note });
      }
    }
  }

  // 2. Class Progression Bonuses (Level-gated)
  for (const { name: cls, level: clsLevel } of graph.classes) {
    const prog = CLASS_PROGRESSION[cls] || {};
    for (let lvl = 1; lvl <= clsLevel; lvl++) {
      apply(`${cls} L${lvl}`, prog[lvl]);
    }
  }

  return { ...mods, sources, notes };
}

export function levelStats(graph) {
  const level = graph.characterLevel;
  const minRow = LEVEL_TABLE[0] || { level: 4, lp: 3, spikes: 0 };
  const maxRow = LEVEL_TABLE[LEVEL_TABLE.length - 1] || minRow;
  
  const row = LEVEL_TABLE.find((r) => r.level === level)
    || (level < minRow.level ? minRow : maxRow);

  const baseLp = row.lp ?? 0;
  const baseSp = row.spikes ?? 0;

  const mods = statMods(graph);
  
  return {
    baseLifePoints: baseLp, 
    baseSpikes: baseSp,
    lifePoints: baseLp + (mods.lifePoints || 0),
    spikes: baseSp + (mods.spikes || 0),
    armor: mods.armor || 0,
    naturalArmor: mods.naturalArmor || 0,
    mods,
  };
}
