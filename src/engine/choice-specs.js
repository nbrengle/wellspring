// choice-specs.js — the registries describing how a pickable item is CHOSEN.
//
// This is a dedicated home for "spec" data so that adding a new pickable mechanic
// (a lineage cantrip/spell pick, a power that grants a chosen spell, …) touches
// THIS isolated file instead of the import lines and big literals in data.js /
// DetailPane.jsx — the files every feature was colliding on. Each spec is keyed by
// an item's baseName so the same mechanic is one code path, not a per-name case.
//
// Consumers import the accessors (lineageChoiceSpec / powerSpellChoiceSpec); they're
// also re-exported from data.js so existing import paths keep working.

// Lineage challenges/advantages that carry a recorded sub-choice. `kind`:
//   'cantrip' — pick a cantrip from the magic-type `pool` (granted + slotted).
//   'spell'   — pick a spell from `pool` at `tiers` (added to Known Spells).
//   'rep'     — Lost Life: rep another lineage's challenge for its LBP.
//   'flavor'  — free pick, no mechanical effect (carries a display `label`).
export const LINEAGE_CHOICE_SPECS = {
  'Divine Magic':        { kind: 'cantrip', pool: ['Divine'] },
  'Psionic Cantrip':     { kind: 'cantrip', pool: ['Arcane', 'Divine'] },
  // Arcane Aptitude: a Cantrip OR Novice spell from any Base arcane class → adds it
  // to Known Spells. `spell` kind = a spell pick over the given magic-type + tiers.
  'Arcane Aptitude':     { kind: 'spell', pool: ['Arcane'], tiers: ['cantrip', 'novice'] },
  'Lost Life':           { kind: 'rep' },
  'Additional Lost Life':{ kind: 'rep' },
  'Elemental Expression':{ kind: 'flavor', label: 'Accent' },
  'Favored Gem':         { kind: 'flavor', label: 'Gemstone' },
};
export function lineageChoiceSpec(item) {
  const base = item?.baseName || item?.name;
  return base ? (LINEAGE_CHOICE_SPECS[base] || null) : null;
}

// Powers that, when owned, let the character CHOOSE another spell/power to gain.
// The graph grants the chosen ability (keyed by choices['powers:<name>'] → emitted
// as `powers:<picked>`) and the UI offers a picker — no per-name special-casing. The
// pickable POOL is computed in the report (`optionsKey`), not from a flat list here.
//   'Arcane Secrets' (Knowledge domain power) — choose one arcane spell (rank-gated);
//     pool = report.arcaneSecretsOptions (see arcaneSecretsSpellOptions in slots.js).
//   'Weird Wanderings' (Artisan Basic power) — choose one Basic power from any
//     non-Artisan Base Class; pool = report.weirdWanderingsOptions (slots.js).
export const POWER_SPELL_CHOICE_SPECS = {
  'Arcane Secrets':   { kind: 'spell', label: 'Choose a Spell',  optionsKey: 'arcaneSecretsOptions' },
  'Weird Wanderings': { kind: 'power', label: 'Choose a Power',  optionsKey: 'weirdWanderingsOptions' },
};
export function powerSpellChoiceSpec(item) {
  const base = item?.baseName || item?.name;
  return base ? (POWER_SPELL_CHOICE_SPECS[base] || null) : null;
}
