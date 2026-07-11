import type { BPLedgerEntry } from "../types.js";

export type CostKeyItem = {
  id?: string;
  name?: string;
  rawString?: string;
  field?: string;
  sourceType?: string;
  index?: number;
  choiceData?: { costField?: string };
};

export function costKey(nodeOrId: CostKeyItem | string | null | undefined): string | undefined {
  if (typeof nodeOrId === "string") return nodeOrId;
  const node = nodeOrId;
  if (!node) return undefined;

  // Skills are keyed by SOURCE, derived here (independent of node.id shape, which is
  // built for identity, not for the ledger). These MUST precede the node.id
  // short-circuit below, since a starting skill's id ('startingSkills:Name') would
  // otherwise return without the index the ledger key needs.
  //   - purchased → `skills:<name>`              (positional)
  //   - starting  → `startingSkills:<i>:<name>`  (indexed, still flat-path)
  if (node.field === "skills") {
    if (node.sourceType === "purchased") return `skills:${node.rawString || node.name}`;
    if (node.sourceType === "class" || node.sourceType === "bestow" || node.sourceType === "lineage") {
      return `startingSkills:${node.index ?? 0}:${node.rawString || node.name}`;
    }
  }

  // Perks key under the character field `purchasedPerks:` (not the entity-type id
  // `perks:`), so map before the node.id short-circuit below.
  if (node.field === "perks") {
    return `purchasedPerks:${node.rawString || node.name}`;
  }

  if (node.id && node.id.includes(":")) return node.id;

  return `${node.field}:${node.rawString || node.name}`;
}

type ByItem = Record<string, BPLedgerEntry>;
export function lookupCost(
  byItem: ByItem | undefined,
  choiceIdOrField: string,
  name?: string,
  index?: number,
): BPLedgerEntry | undefined {
  if (arguments.length > 2) {
    // Field-keyed lookup: `${field}:${name}` (or `${field}:${index}:${name}`).
    let key = `${choiceIdOrField}:${name}`;
    if (index !== undefined) key = `${choiceIdOrField}:${index}:${name}`; // mainly for startingSkills
    if (byItem && byItem[key]) return byItem[key];
    // Fallback without index
    return byItem ? byItem[`${choiceIdOrField}:${name}`] : undefined;
  }
  return byItem ? byItem[choiceIdOrField] : undefined;
}
