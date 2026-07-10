import type { CharacterState, CharacterChoice } from './types.js';

/**
 * Normalizes a character's class/level info into an array of {name, level}.
 */
export function getClasses(character: any): { name: string; level: number }[] {
  if (character?.classLevels && !character?.classes) {
    return character.classLevels.split(',').map((c) => {
      const match = c.trim().match(/^(.+?)\s+(\d+)$/);
      return match ? { name: match[1], level: parseInt(match[2], 10) } : { name: c.trim(), level: 1 };
    });
  }
  if (!character?.classes) return [];
  if (Array.isArray(character.classes)) return character.classes;
  return Object.entries(character.classes).map(([name, level]) => ({ name: String(name), level: Number(level) }));
}

/**
 * The character's PRIMARY (first) class.
 */
export function primaryClass(character: CharacterState): string | null {
  return getClasses(character)[0]?.name || null;
}

/**
 * Strips any trailing parameter from a name, e.g. "Lore (History)" -> "Lore".
 * Useful when the parameter wasn't explicitly separated.
 */
export const bareSkill = (s: string): string => String(s).replace(/\s*\([^)]*\)\s*$/, '').trim();

/**
 * Legacy cleanItemName for the text exporter/importer.
 */
export function cleanItemName(item: string | CharacterChoice): string {
  if (typeof item !== 'string') return item.entityId || '';
  return item.replace(/\s*-\s*\d+\s*BP$/i, '').trim();
}

/**
 * Builds a parameterized skill name from its base + chosen parameter.
 */
export function formatParameterizedName(baseName: string, parameter: string, originalName?: string): string {
  if (!parameter) return baseName;
  const baseHasDash = baseName.includes(" - ");
  if (!baseHasDash && originalName && originalName.includes(" - ") && !originalName.includes("(")) {
    return `${baseName} - ${parameter}`;
  }
  return `${baseName} (${parameter})`;
}
