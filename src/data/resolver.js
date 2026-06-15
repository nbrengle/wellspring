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

// Normalize a character's class/level info into [{ name, level }], the canonical
// multi-class form. Accepts either the new `classes` array or the legacy
// `classLevels` string ("Fighter 4", or "Fighter 2 / Rogue 2"). This is the one
// place that understands both shapes; everything else reads through it.
export function getClasses(character) {
  if (Array.isArray(character?.classes) && character.classes.length) {
    return character.classes
      .filter((c) => c && c.name)
      .map((c) => ({ name: c.name, level: c.level || 0 }));
  }
  const str = character?.classLevels;
  if (typeof str === 'string' && str.trim()) {
    return str.split('/').map((part) => {
      const m = part.trim().match(/^(.+?)\s+(\d+)$/);
      return m ? { name: m[1].trim(), level: parseInt(m[2], 10) } : null;
    }).filter(Boolean);
  }
  return [];
}

// The character's PRIMARY (first) class — used for spell-slot tier shape and as
// the default context where a single class is assumed.
export function primaryClass(character) {
  return getClasses(character)[0]?.name || null;
}

