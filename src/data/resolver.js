// resolver.js — name-to-ID resolution and cleaning helpers


// Strip any trailing parentheses/parameter from a skill name, e.g. "Lore (History)" -> "Lore"
export const bareSkill = (s) => String(s).replace(/\s*\([^)]*\)\s*$/, '').trim();

// Strip any display suffixes from a character sheet item name, e.g. "Generous Soul - 5 BP" -> "Generous Soul"
export function cleanItemName(item) {
  if (typeof item !== 'string') return '';
  return item.replace(/\s*-\s*\d+\s*BP$/i, '').trim();
}

// Map a character sheet field to its database collection/type namespace
export function entityType(field) {
  if (field.endsWith('Perks')) return 'perks';
  if (field === 'flaws') return 'flaws';
  if (field.endsWith('Skills')) return 'skills';
  return 'powers';
}

// Get the user-facing name from a typed ID, e.g. "skills:Basic Faith" -> "Basic Faith"
export const idName = (id) => {
  if (!id || typeof id !== 'string') return '';
  const idx = id.indexOf(':');
  return idx === -1 ? id : id.slice(idx + 1);
};

// Resolve a character sheet item name to its typed ID, e.g. "Basic Faith" in purchasedSkills -> "skills:Basic Faith"
export function resolveId(item, field, character) {
  return `${entityType(field)}:${cleanItemName(item)}`;
}
