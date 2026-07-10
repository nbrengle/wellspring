import {
    lookupEntity
} from "../../engine/data.js";
import { bareSkill, cleanItemName } from "../resolver.js";
import type {
    CharacterState
} from "../types.js";
import {
    GrantedAbility
} from "../types.js";
import { CharacterGraphModel, idPrefix } from "./model.js";
import { resolveCharacterGraph } from "./resolve.js";

export function computeGrantedAbilitiesList(graph: CharacterGraphModel): GrantedAbility[] {
    const list: GrantedAbility[] = [];
    for (const node of graph.items) {
      for (const eff of node.effects) {
        if (eff.type !== "GRANT_SOURCE") continue;
        for (const ability of eff.grants) {
          const ent = lookupEntity(ability);
          list.push({
            ability,
            abilityName: ent?.name || ability.split(":")[1],
            abilityType: ability.slice(0, ability.indexOf(":")),
            source: node.name,
            sourceId: node.id,
            sourceKind: node.sourceType,
          });
        }
      }
    }
    return list;
}

export function computeOwnedIds(graph: CharacterGraphModel): Set<string> {
    const owned = new Set<string>();
    for (const node of graph.items) {
      if (node.field === "flaws" || node.field === "synthetic") continue;
      if (node.id) {
        owned.add(node.id);
        if (node.id.includes("|")) owned.add(node.id.split("|")[0] + "|any");
      }
      const clean = cleanItemName(node.rawString || node.name);
      const bare = bareSkill(clean);
      const candidates = [
        `${node.field}:${bare}`,
        `powers:${clean}`,
        `perks:${clean}`,
        `skills:${clean}`,
        `powers:${bare}`,
        `perks:${bare}`,
        `skills:${bare}`,
      ];
      for (const cand of candidates) {
        const e = lookupEntity(cand);
        if (e) {
          if (e.id) owned.add(e.id);
          owned.add(`${idPrefix(e)}:${bareSkill(e.name)}`);
        }
      }
      if (node.entity?.id) {
        owned.add(node.entity.id);
        owned.add(`${idPrefix(node.entity)}:${bareSkill(node.entity.name)}`);
      }

      if (node.entity && node.entity.parameter) {
        const p = node.entity.parameter.toLowerCase();
        owned.add(`${node.id}|${p}`);
        owned.add(`${node.id}|any`);
      }
    }
    // Granted abilities also satisfy prerequisites.
    for (const g of graph._grantedAbilitiesList) {
      owned.add(g.ability);
      const ent = lookupEntity(g.ability);
      if (ent) owned.add(`${idPrefix(ent)}:${bareSkill(ent.name)}`);
    }
    return owned;
}

export function grantedAbilities(character: CharacterState) {
    const graph = resolveCharacterGraph(character);
    const list: GrantedAbility[] = [];
    const bySource: Record<string, { source: string; sourceKind: string; abilities: GrantedAbility[] }> = {};
    const addRow = (ability: string, sourceName: string, sourceId: string, sourceKind: string) => {
            const ent = lookupEntity(ability);
            const row = {
              ability,
              abilityName: ent?.name || ability.split(":")[1],
              abilityType: ability.slice(0, ability.indexOf(":")),
              source: sourceName,
              sourceId,
              sourceKind,
            };
            list.push(row);
            if (!bySource[sourceId]) bySource[sourceId] = { source: sourceName, sourceKind, abilities: [] };
            bySource[sourceId].abilities.push(row);
          };
    for (const node of graph) {
    for (const eff of node.effects) {
      if (eff.type !== "GRANT_SOURCE") continue;
      for (const ability of eff.grants) {
        addRow(ability, node.name, node.id, node.sourceType);
      }
    }
    }

    return { list, bySource };
}
