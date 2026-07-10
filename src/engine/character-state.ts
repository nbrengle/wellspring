import { getClasses, cleanItemName } from "./resolver.js";
import { getAllEntities } from "./data.js";
import type { CharacterState } from "./types.js";
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
function reconcileBuildChoices(character) {
  // Options differ only by their PARAMETERIZED grant ("Weapon Specialization -
  // Swords" vs "- Daggers"), so match on the full param-aware key, not the bare
  // skill (which would make every option look matched). Normalize both the dash
  // form ("Foo - Swords") and the parens form ("Foo (Swords)") to "foo|swords".
  const key = (name) => {
    const clean = cleanItemName(name);
    const m = clean.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    if (m && !/^\d+$/.test(m[2].trim())) return `${m[1].trim().toLowerCase()}|${m[2].trim().toLowerCase()}`;
    const dash = clean.match(/^(.*?) - ([^-]+)$/);
    if (dash) return `${dash[1].trim().toLowerCase()}|${dash[2].trim().toLowerCase()}`;
    return clean.toLowerCase();
  };
  // All owned skills (starting + purchased) live in the skills[] bucket.
  const ownedSkillNames = (character.skills || [])
    .filter((s) => typeof s !== "string")
    .map((s) => s.entityId || s.name);
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
      const distinguishing = grants.filter((g) => key(g).includes("|"));
      const probe = distinguishing.length ? distinguishing : grants;
      if (probe.length && probe.every((g) => owned.has(key(g)))) {
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
  skills: [],
  perks: [],
  powers: [],
  domainPowers: [],
  spells: [],
  flaws: [],
  devotions: [],
  advantageChoices: {},
  grantedSelections: {},
  agileLearnerTrades: {},
};

// ─── PURE STATE MODIFIERS ───────────────────────────────────────────────────
export function applyClassStartingAbilities(character, className, _level = 1) {
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

// Normalize any class representation to the canonical array [{name, level}]:
//   { Cleric: 4 }            (archetype object map)
//   [{ name, level }]        (already canonical)
//   "Cleric 4" / "Cleric 4, Fighter 2"  (legacy classLevels string)
function normalizeClasses(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value.split(",").map((part) => {
      const m = part.trim().match(/^(.+?)\s+(\d+)$/);
      return m ? { name: m[1], level: parseInt(m[2], 10) } : { name: part.trim(), level: 1 };
    });
  }
  if (typeof value === "object") {
    return Object.entries(value).map(([name, level]) => ({ name: String(name), level: Number(level) || 1 }));
  }
  return [];
}

export function loadArchetype(archetype) {
  const c = { ...EMPTY_CHARACTER, archetypeName: archetype.name };
  for (const k of Object.keys(EMPTY_CHARACTER)) {
    if (k === "archetypeName") continue;
    if (archetype[k] !== undefined) {
      if (k === "lineage" && typeof archetype[k] === "object" && archetype[k] !== null) {
        c[k] = archetype[k].name;
        // In the future, we could also map archetype[k].choices to c.advantageChoices here
      } else {
        c[k] = archetype[k];
      }
    }
  }
  // Normalize classes to the canonical array form [{name, level}] that getClasses +
  // the class handlers use. Archetypes store it as an object map ({ Cleric: 4 }); the
  // copy loop above would carry that raw shape, so overwrite with the normalized form.
  // (Also accept a "Cleric 4" string defensively from older data.)
  if (archetype.classes !== undefined) {
    c.classes = normalizeClasses(archetype.classes);
  } else if (archetype.classLevels) {
    c.classes = normalizeClasses(archetype.classLevels);
  }
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
