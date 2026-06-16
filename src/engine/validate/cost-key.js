// Canonical key scheme for the BP cost ledger (computeBP's `byItem` map).
//
// The ledger is keyed by "<field>:<name>", except starting skills — which can
// repeat the same name at different indices (two "Lore" rows) — are keyed by
// "startingSkills:<index>:<name>". This key was previously reconstructed inline in
// five places (bp-accounting, BuildSheet ×2, sheet.js, xlsx-import); centralizing
// it here keeps construction and lookup from drifting.

// Build the canonical ledger key for an item.
export function costKey(field, name, index) {
  return field === 'startingSkills' ? `startingSkills:${index}:${name}` : `${field}:${name}`;
}

// Look a cost record up in the ledger. For starting skills, try the exact index
// key first, then fall back to matching by name alone (callers that render a name
// without its original index — sheet/xlsx export). Returns the record or undefined.
export function lookupCost(byItem, field, name, index) {
  if (!byItem) return undefined;
  if (field === 'startingSkills') {
    if (index !== undefined && index !== null) {
      const exact = byItem[costKey('startingSkills', name, index)];
      if (exact) return exact;
    }
    const match = Object.keys(byItem).find(
      (k) => k.startsWith('startingSkills:') && k.endsWith(`:${name}`)
    );
    return match ? byItem[match] : undefined;
  }
  return byItem[costKey(field, name)];
}
