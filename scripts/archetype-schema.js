// Schema constants for the archetype READER (parse-archetypes.js) — the section
// label → intermediate-field map and the default parameters for choose-one skills.
//
// These describe the MegaDoc/StarterCharacterSheets SOURCE FORMAT, so they belong
// with the reader, not the engine. The reader parses source text into these
// intermediate fields and emits the canonical CharacterState shape; nothing here
// leaks past the reader. (Formerly in engine/sheet-schema.ts, alongside the now-
// deleted text importer.)

// A source-sheet section label → the intermediate field the reader accumulates it
// under. `classLevels` is a READ-ONLY intermediate (the "Class Levels: Cleric 4"
// line) the reader turns into the canonical classes:[{name,level}] — it never
// reaches output.
export const LABEL_FIELD = {
  Lineage: "lineage",
  "Lineage Challenges": "lineageChallenges",
  "Lineage Advantages": "lineageAdvantages",
  "Life Points": "lifePoints",
  "Armor Points": "armorPoints",
  Spikes: "spikes",
  Wealth: "wealth",
  Resources: "resources",
  "Class Levels": "classLevels",
  Specialization: "specialization",
  Devotion: "devotion",
  "Active Event": "currentEvent",
  Event: "currentEvent",
  Flaws: "flaws",
  "Starting Skills (free)": "startingSkills",
  "Starting Skills": "startingSkills",
  "Divine Domains": "divineDomains",
  "Available Devotion Accents": "devotionAccents",
  "Purchased Skills": "purchasedSkills",
  "Purchased Perks": "purchasedPerks",
  "Innate Powers": "innatePowers",
  "Utility Powers": "utilityPowers",
  "Basic Powers": "basicPowers",
  "Advanced Powers": "advancedPowers",
  "Veteran Powers": "veteranPowers",
  "Class Powers": "classPowers",
  "Right Hand Powers": "rightHandPowers",
  Cantrips: "cantrips",
  "Novice Spells known": "noviceSpells",
  "Novice Spells Known": "noviceSpells",
  "Adept Spells known": "adeptSpells",
  "Adept Spells Known": "adeptSpells",
  "Greater Spells known": "greaterSpells",
  "Greater Spells Known": "greaterSpells",
  "Book Spells": "bookSpells",
  "Domain Powers": "domainPowers",
  "Form Powers": "formPowers",
};

// When a starter archetype leaves a choose-one skill unparameterized, the reader
// fills in reasonable concrete values so the emitted character is complete.
export const CHOICE_DEFAULTS = {
  Lore: ["Historical", "Arcane", "Religious", "Nature", "Political", "Monstrous"],
  Bookcaster: ["Magekey", "Mask Aura", "Identify", "Cancel", "Stop", "Mageskin"],
  "Divine Favor": ["Blessing", "Protection", "Guidance"],
  Profession: ["Smith", "Cook", "Tailor"],
  Patron: ["a Patron"],
  "Favored Form": ["Hunting Panther"],
  "Chronic Hobbyist": ["Cooking", "Brewing", "Gardening"],
};
