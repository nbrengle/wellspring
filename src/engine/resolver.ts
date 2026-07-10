import type { CharacterState, CharacterChoice } from "./types.js";

/**
 * The character's classes as {name, level}[]. classes IS that array (the one shape
 * every producer emits — archetypes, the reducers), so this is just a null-safe read.
 */
export function getClasses(character: Partial<CharacterState> | null | undefined): { name: string; level: number }[] {
  return character?.classes ?? [];
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
export const bareSkill = (s: string): string =>
  String(s)
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();

/**
 * A choice's canonical name: its entityId, or a name string with any trailing
 * " - N BP" cost suffix stripped.
 */
export function cleanItemName(item: string | CharacterChoice): string {
  if (typeof item !== "string") return item.entityId || "";
  return item.replace(/\s*-\s*\d+\s*BP$/i, "").trim();
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

const WORD_NUM: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
export function parseWordNumber(s: string): number | null {
  const w = WORD_NUM[s.toLowerCase()];
  if (w != null) return w;
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}
