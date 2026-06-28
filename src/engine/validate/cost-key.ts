export function costKey(nodeOrId) {
  if (typeof nodeOrId === 'string') return nodeOrId;
  const node = nodeOrId;
  if (!node) return undefined;
  
  if (node.id && node.id.includes(':')) return node.id;
  
  // Construct a V1-style key from field and rawString/name
  const field = node.field === 'skills' && node.sourceType === 'purchased' ? 'purchasedSkills' :
                node.field === 'skills' && (node.sourceType === 'class' || node.sourceType === 'grant' || node.sourceType === 'lineage') ? 'startingSkills' :
                node.field === 'perks' ? 'purchasedPerks' : node.field;
  
  // For startingSkills, V1 tests expect startingSkills:0:Name format
  if (field === 'startingSkills') {
    return `startingSkills:${node.index ?? 0}:${node.rawString || node.name}`;
  }
  return `${field}:${node.rawString || node.name}`;
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
