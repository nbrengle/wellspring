export function costKey(nodeOrId) {
  if (typeof nodeOrId === 'string') return nodeOrId;
  const node = nodeOrId;
  if (!node) return undefined;

  // Skills are keyed by SOURCE, derived here (independent of node.id shape, which is
  // built for identity, not for the ledger). These MUST precede the node.id
  // short-circuit below, since a starting skill's id ('startingSkills:Name') would
  // otherwise return without the index the ledger key needs.
  //   - purchased → `skills:<name>`              (positional, V2-native)
  //   - starting  → `startingSkills:<i>:<name>`  (indexed, still flat-path)
  if (node.field === 'skills') {
    if (node.sourceType === 'purchased') return `skills:${node.rawString || node.name}`;
    if (node.sourceType === 'class' || node.sourceType === 'grant' || node.sourceType === 'lineage') {
      return `startingSkills:${node.index ?? 0}:${node.rawString || node.name}`;
    }
  }

  // Perks key under the character field `purchasedPerks:` (not the entity-type id
  // `perks:`), so map before the node.id short-circuit below.
  if (node.field === 'perks') {
    return `purchasedPerks:${node.rawString || node.name}`;
  }

  if (node.id && node.id.includes(':')) return node.id;

  return `${node.field}:${node.rawString || node.name}`;
}

export function lookupCost(byItem, choiceIdOrField, name, index) {
  if (arguments.length > 2) {
    // V1 legacy lookup
    let key = `${choiceIdOrField}:${name}`;
    if (index !== undefined) key = `${choiceIdOrField}:${index}:${name}`; // mainly for startingSkills
    if (byItem && byItem[key]) return byItem[key];
    // Fallback without index
    return byItem ? byItem[`${choiceIdOrField}:${name}`] : undefined;
  }
  return byItem ? byItem[choiceIdOrField] : undefined;
}
