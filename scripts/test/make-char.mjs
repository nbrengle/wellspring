// make-char.mjs — the character factory for tests.
//
// Tests express INTENT — "a Fighter 4 with Battlemind and Toughness" — not the
// character's internals. They never name a bucket, an EntitySource, or a costField;
// those are derived by the REAL add-to-character API (src/engine/character-add.ts),
// the same code the app uses, so a fixture can never encode a character differently
// than production does.
//
//   makeChar('Fighter 4', { add: ['Battlemind', 'Toughness', 'Athletics'] })
//   makeChar('Mage 4', { add: ['Force Shield'], lineage: 'Human' })
//   makeChar('Cleric 4', { devotion: 'The Mother', add: [{ name: 'Lore', param: 'Religion' }] })
//
// `add` items are a bare name, or { name, cls?, param?, cost?, ranks?, source?,
// field? } for the rare cases the API can't derive (multiclass grantor, a param, an
// authored cost). Everything else on the options bag is a scalar the character
// carries as-is (lineage, devotion, choices, sublineage, agileLearnerTrades, …).

import { addToCharacter } from "../../src/engine/character-add.js";
import { applyClassStartingAbilities } from "../../src/engine/character-state.js";

// Parse "Fighter 4" / "Cleric 6, Mage 4" / [{name,level}] → canonical [{name,level}].
function parseClasses(spec) {
  if (Array.isArray(spec)) return spec;
  return String(spec)
    .split(",")
    .map((part) => {
      const m = part.trim().match(/^(.+?)\s+(\d+)$/);
      return m ? { name: m[1].trim(), level: parseInt(m[2], 10) } : { name: part.trim(), level: 1 };
    });
}

const EMPTY = () => ({
  classes: [],
  skills: [],
  perks: [],
  powers: [],
  spells: [],
  flaws: [],
  devotions: [],
});

/**
 * Build a character for a test.
 * @param {string|Array} classSpec  "Fighter 4" | "Cleric 6, Mage 4" | [{name,level}]
 * @param {object} [opts]  { add?: (string|object)[], ...scalars } — scalars
 *        (lineage, devotion, choices, sublineage, lineageChallenges, …) are copied
 *        onto the character verbatim.
 */
export function makeChar(classSpec, opts = {}) {
  const { add = [], startingKit = true, ...scalars } = opts;
  let c = { ...EMPTY(), classes: parseClasses(classSpec), ...scalars };

  // Seed class starting abilities (starting skills) the way the app does when a
  // class is chosen — so a bare makeChar('Fighter 4') already owns its starting kit.
  // Pass startingKit:false for a precise test that controls its own starting skills.
  const primary = c.classes[0];
  if (primary && startingKit) c = applyClassStartingAbilities(c, primary.name, primary.level);

  // Funnel every intent item through the one real add API.
  for (const item of add) {
    const { name, ...addOpts } = typeof item === "string" ? { name: item } : item;
    c = addToCharacter(c, name, addOpts);
  }
  return c;
}
