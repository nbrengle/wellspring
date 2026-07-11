import { getClasses, cleanItemName } from "./resolver.js";
import { getAllEntities } from "./data.js";
import type { CharacterState } from "./types.js";
import { emptyBuckets } from "./config.js";
import {
  STARTING_CHOICES_CONFIG,
  hasStartingChoices,
  reconcileStartingChoices,
  rebuildStartingSkills,
} from "../engine/starting-choices.js";

// Infer build choose-one selections (Way of the Blade, Expert Craft) from the skills
// a character already owns. Archetypes ship the granted skills + a grant sidecar but
// often NO `choices` entry, so the chooseOne UI shows nothing selected and the choice
// can't be changed/cleaned. This is the read-side counterpart: if an owned skill
// matches one of a build choose-one's options' granted skills, that option was chosen.
// Mirrors reconcileStartingChoices (derive choices from the resolved character).
function reconcileBuildChoices(character: CharacterState) {
  // Options differ only by their PARAMETERIZED grant ("Weapon Specialization -
  // Swords" vs "- Daggers"), so match on the full param-aware key, not the bare
  // skill (which would make every option look matched). Normalize both the dash
  // form ("Foo - Swords") and the parens form ("Foo (Swords)") to "foo|swords".
  const key = (name: string) => {
    const clean = cleanItemName(name);
    const m = clean.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    if (m && !/^\d+$/.test(m[2].trim())) return `${m[1].trim().toLowerCase()}|${m[2].trim().toLowerCase()}`;
    const dash = clean.match(/^(.*?) - ([^-]+)$/);
    if (dash) return `${dash[1].trim().toLowerCase()}|${dash[2].trim().toLowerCase()}`;
    return clean.toLowerCase();
  };
  // All owned skills (starting + purchased) live in the skills[] bucket.
  const ownedSkillNames = (character.skills || []).map((s) => s.entityId || s.name);
  const owned = new Set(ownedSkillNames.map(key));
  const choices = { ...(character.choices || {}) };
  for (const ent of getAllEntities()) {
    if (ent.chooseOne?.kind !== "build") continue;
    const choiceKey = `powers:${ent.name}`;
    if (choices[choiceKey]) continue; // already recorded — don't override an explicit pick
    for (const opt of ent.chooseOne.options) {
      const grants = opt.grants || opt.grantsSkills || [];
      // The option's DISTINGUISHING grant is its parameterized one; require that it's
      // owned (shared grants like "Two Weapon Style" can't tell options apart).
      const distinguishing = grants.filter((g: string) => key(g).includes("|"));
      const probe = distinguishing.length ? distinguishing : grants;
      if (probe.length && probe.every((g: string) => owned.has(key(g)))) {
        choices[choiceKey] = opt.text;
        break;
      }
    }
  }
  return choices;
}

// ─── INITIAL STATE TEMPLATE ──────────────────────────────────────────────────
// A blank CharacterState: empty ontological buckets, no class. Everything a
// character owns is a CharacterChoice in one of the buckets — there are no flat
// name-arrays. applyClassStartingAbilities seeds starting skills when a class is
// chosen; the reducers (addToCharacter) add the rest.
export const EMPTY_CHARACTER: CharacterState = {
  name: "",
  archetypeName: null, // which archetype this was loaded from (for the badge)
  specialization: null, // "Mystic" / "Crafter" / "Artificer" — only for Artisan
  lineage: null, // "Human" / "Aewen" / ...
  sublineage: null,
  devotion: null, // for clerics: "The Mother" / "Senri" / ...
  lifePoints: null,
  armorPoints: null,
  spikes: null,
  wealth: null, // null → DEFAULT_WEALTH (8); perks/sheet may set it
  resources: null, // free-form, from the sheet
  classes: [],
  ...emptyBuckets(),
  devotions: [],
  advantageChoices: {},
  grantedSelections: {},
  agileLearnerTrades: {},
};

// ─── PURE STATE MODIFIERS ───────────────────────────────────────────────────
export function applyClassStartingAbilities(character: CharacterState, className: string, _level = 1) {
  const isPrimary = getClasses(character)[0]?.name === className;

  let nextCharacter = { ...character };
  if (isPrimary) {
    const expectedKeys = (STARTING_CHOICES_CONFIG[className] || []).map((c) => c.id);
    const hasAllExpected = expectedKeys.every((k) => character.startingChoices?.[k] !== undefined);
    const hasOnlyExpected = Object.keys(character.startingChoices || {}).every((k) => expectedKeys.includes(k));
    if (!character.startingChoices || !hasAllExpected || !hasOnlyExpected) {
      nextCharacter.startingChoices = reconcileStartingChoices(character, className);
    }
    nextCharacter = rebuildStartingSkills(nextCharacter, className);
  }

  return nextCharacter;
}

export function loadArchetype(
  archetype: Partial<CharacterState> & { name?: string; lineage?: string | { name: string } },
): CharacterState {
  const c = { ...EMPTY_CHARACTER, archetypeName: archetype.name as string | null } as CharacterState;
  for (const k of Object.keys(EMPTY_CHARACTER) as (keyof CharacterState)[]) {
    if (k === "archetypeName") continue;
    const archValue = archetype[k];
    if (archValue !== undefined) {
      if (k === "lineage" && typeof archValue === "object" && archValue !== null && "name" in archValue) {
        c.lineage = (archValue as { name: string }).name;
      } else {
        Object.assign(c, { [k]: archValue });
      }
    }
  }
  // archetype.classes is already the canonical [{name, level}] array (the copy loop
  // above carried it), so no normalization step is needed.
  const primary = getClasses(c)[0]?.name;
  let out = c;
  if (primary && hasStartingChoices(primary)) {
    c.startingChoices = reconcileStartingChoices(c, primary);
    out = rebuildStartingSkills(c, primary, c.startingChoices);
  }
  // Infer build choose-one selections (Way of the Blade, …) from the granted skills
  // the archetype shipped, so the choice shows as made and stays editable.
  const choices = reconcileBuildChoices(out);
  if (Object.keys(choices).length) out = { ...out, choices };
  return out;
}
