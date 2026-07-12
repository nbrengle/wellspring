import { lookupEntity } from "../../engine/data.js";
import { bareSkill } from "../resolver.js";
import type { CharacterState, Entity } from "../types.js";
import { BestowedAbility } from "../types.js";
import { CharacterGraphModel, idPrefix } from "./model.js";
import { resolveCharacterGraph } from "./resolve.js";

export function computeBestowedAbilitiesList(graph: CharacterGraphModel): BestowedAbility[] {
  const list: BestowedAbility[] = [];
  for (const node of graph.items) {
    for (const eff of node.effects) {
      if (eff.type !== "BESTOW_SOURCE") continue;
      for (const ability of eff.bestows) {
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

// The keys a single owned entity can satisfy a prereq under: its exact id, and its
// param-stripped "bare" form (so "Lore (Arcane)" answers a "Lore" requirement). One
// entity → the (at most) two forms a prereq could name it by.
function ownedKeysFor(id: string | undefined, entity: Entity | null, into: Set<string>): void {
  if (id) into.add(id);
  if (entity?.id) {
    into.add(entity.id);
    into.add(`${idPrefix(entity)}:${bareSkill(entity.name)}`);
  }
}

export function computeOwnedIds(graph: CharacterGraphModel): Set<string> {
  const owned = new Set<string>();
  for (const node of graph.items) {
    if (node.sourceType === "flaw") continue;
    ownedKeysFor(node.id, node.entity, owned);
    // Parameter variants: an exact-parameter match and a wildcard, so a prereq can
    // require either "Lore|arcane" specifically or "Lore|any".
    if (node.id?.includes("|")) owned.add(node.id.split("|")[0] + "|any");
    if (node.entity?.parameter) {
      owned.add(`${node.id}|${node.entity.parameter.toLowerCase()}`);
      owned.add(`${node.id}|any`);
    }
  }
  // Bestowed abilities satisfy prerequisites too — resolve each to add its bare form.
  for (const g of graph._bestowedAbilitiesList) {
    ownedKeysFor(g.ability, lookupEntity(g.ability), owned);
  }
  return owned;
}

export function bestowedAbilities(character: CharacterState) {
  const graph = resolveCharacterGraph(character);
  const list: BestowedAbility[] = [];
  const bySource: Record<string, { source: string; sourceKind: string; abilities: BestowedAbility[] }> = {};
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
      if (eff.type !== "BESTOW_SOURCE") continue;
      for (const ability of eff.bestows) {
        addRow(ability, node.name, node.id, node.sourceType);
      }
    }
  }

  return { list, bySource };
}
