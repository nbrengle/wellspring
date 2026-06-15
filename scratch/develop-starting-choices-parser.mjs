import fs from 'fs';
import path from 'path';
import { BASE_STARTING_SKILLS as HARDCODED_BASE, STARTING_CHOICES_CONFIG as HARDCODED_CONFIG } from '../src/data/starting-choices.js';

const classes = JSON.parse(fs.readFileSync('src/data/classes.json', 'utf8'));

const BASE_STARTING_SKILLS = {};
const STARTING_CHOICES_CONFIG = {};

const LORE_OPTIONS = [
  { label: "Historical", skills: ["Lore (Historical)"] },
  { label: "Arcane", skills: ["Lore (Arcane)"] },
  { label: "Nature", skills: ["Lore (Nature)"] },
  { label: "Noble", skills: ["Lore (Noble)"] },
  { label: "Religious", skills: ["Lore (Religious)"] },
  { label: "Shadow", skills: ["Lore (Shadow)"] },
  { label: "Ritual", skills: ["Lore (Ritual)"] }
];

function parseClassStartingSkills(clsName, startingSkills) {
  const fixed = [];
  const choices = [];
  let currentChoice = null;

  for (const line of startingSkills) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("Note:")) continue;

    // Special handling/overrides for specific complex fixed lines checked FIRST
    if (trimmed.includes("Natural Survival:")) {
      fixed.push("Basic Martial Weapons", "Profession - Apprentice (your choice)");
      choices.push({
        id: "druidSurvival",
        label: "Gathering Choice",
        options: [
          { label: "Forage I", skills: ["Forage I"] },
          { label: "Scavenge I", skills: ["Scavenge I"] }
        ]
      });
      continue;
    }
    if (trimmed.includes("Dutiful Scholar:")) {
      fixed.push("Library Use", "Bookcaster", "Bookcaster");
      choices.push({
        id: "startingLore",
        label: "Starting Lore Skill",
        options: LORE_OPTIONS
      });
      continue;
    }
    if (trimmed.includes("Old Secrets: Choose a Lore Skill") || trimmed.includes("Old Secrets:")) {
      choices.push({
        id: "socialiteLore",
        label: "Old Secrets",
        options: LORE_OPTIONS
      });
      continue;
    }
    if (trimmed.includes("A Means to an End:")) {
      fixed.push("Profession - Apprentice", "Profession - Journeyman");
      continue;
    }

    // Check if it's a choice header
    const choiceHeaderMatch = trimmed.match(/^(.+?)\s*-\s*Choose (?:one|a)\b/i) || 
                              trimmed.match(/^(.+?):\s*Choose (?:one|a)\b/i) || 
                              trimmed.match(/^(.+?)\s*-\s*Choose One of the Following:/i) ||
                              trimmed.match(/^(.+?):\s*Choose one of the following/i) ||
                              trimmed.match(/^(.+?)\s*-\s*Choose one of the below/i);
    if (choiceHeaderMatch) {
      const label = choiceHeaderMatch[1].trim();
      let id = label.charAt(0).toLowerCase() + label.slice(1).replace(/[\s\-\']/g, '');
      if (id === "gatheringChoice") id = "druidSurvival";
      if (id === "productiveEquipment") id = "artisanProductive";
      if (id === "theLandProvides") id = "artisanGathering";
      if (id === "aPathUnfolds") id = "artisanPath";
      if (id === "theMeansofService") id = "clericService";
      if (id === "divineStudy") id = "clericStudy";
      if (id === "buddingWisdom") id = "druidBuddingWisdom";
      if (id === "thePathofCombat") id = "fighterCombatPath";
      if (id === "aMagicalSpecialty") id = "magicalSpecialty";
      if (id === "uptoNoGood") id = "rogueSpecialty";
      if (id === "opportunitiesAbound") id = "socialiteOpportunities";
      if (id === "theContractWiththeOther") id = "sourcererContract";
      
      let finalLabel = label;
      if (finalLabel === "A Magical Specialty") finalLabel = "Magical Specialty";
      
      currentChoice = { id, label: finalLabel, options: [] };
      choices.push(currentChoice);
      
      // Inline options
      if (id === "artisanProductive") {
        currentChoice.options = [
          { label: "Apprentice Alchemy", skills: ["Apprentice Alchemy"] },
          { label: "Apprentice Enchanting", skills: ["Apprentice Enchanting"] },
          { label: "Apprentice Tinkering", skills: ["Apprentice Tinkering"] },
          { label: "Apprentice Ritual Magic & Lore (Ritual)", skills: ["Apprentice Ritual Magic", "Lore (Ritual)"] }
        ];
        currentChoice = null;
      } else if (id === "artisanGathering") {
        currentChoice.options = [
          { label: "Forage I", skills: ["Forage I"] },
          { label: "Prospect I", skills: ["Prospect I"] },
          { label: "Scavenge I", skills: ["Scavenge I"] }
        ];
        currentChoice = null;
      }
      continue;
    }

    // If we are currently inside a choice block, this line is an option!
    if (currentChoice) {
      if (currentChoice.id === "artisanPath") {
        if (trimmed.includes("Profession")) {
          currentChoice.options.push({ label: "Apprentice & Journeyman Profession", skills: ["Profession - Apprentice", "Profession - Journeyman"] });
        } else if (trimmed.includes("Crafting")) {
          currentChoice.options.push({ label: "Apprentice Crafting (Alchemy)", skills: ["Apprentice Alchemy"] });
          currentChoice.options.push({ label: "Apprentice Crafting (Enchanting)", skills: ["Apprentice Enchanting"] });
          currentChoice.options.push({ label: "Apprentice Crafting (Tinkering)", skills: ["Apprentice Tinkering"] });
          currentChoice.options.push({ label: "Apprentice Crafting (Ritual)", skills: ["Apprentice Ritual Magic", "Lore (Ritual)"] });
        } else if (trimmed.includes("Basic Medicine")) {
          currentChoice.options.push({ label: "Basic Medicine & Hearth", skills: ["Basic Medicine", "Hearth"] });
          currentChoice.options.push({ label: "Basic Medicine & Bits and Pieces", skills: ["Basic Medicine", "Bits and Pieces"] });
          currentChoice.options.push({ label: "Basic Medicine & Soothing Touch", skills: ["Basic Medicine", "Soothing Touch"] });
        }
      } else {
        const parts = trimmed.split(/\bor\b/i);
        if (parts.length > 1 && currentChoice.id === "fighterCombatPath") {
          currentChoice.options.push({ label: "Short Weapons, Advanced Shields", skills: ["Short Weapons", "Advanced Shields"] });
          currentChoice.options.push({ label: "Short Weapons, Two Weapon Style", skills: ["Short Weapons", "Two Weapon Style"] });
        } else if (parts.length > 1 && currentChoice.id === "rogueSpecialty") {
          currentChoice.options.push({ label: "Basic Locks, Poisoner", skills: ["Basic Locks", "Poisoner"] });
          currentChoice.options.push({ label: "Basic Traps, Poisoner", skills: ["Basic Traps", "Poisoner"] });
        } else {
          const parsedSkillsWithIndex = [];
          let rank = 1;
          const rx = trimmed.match(/x\s*(\d+)/i) || trimmed.match(/x\d+/i);
          if (rx) {
            const digits = rx[0].match(/\d+/);
            if (digits) rank = parseInt(digits[0], 10);
          }
          
          const names = [
            "Basic Faith", "Worship", "Basic Martial Weapons", "Basic Armor", "Light Armor",
            "Short Weapons", "Extended Capacity - Novice", "Extended Capacity- Novice", "Basic Medicine", "Diagnose",
            "Additional Cantrip", "Bookcaster", "Peacecaster", "Basic Shields", "Advanced Shields",
            "Two-Weapon Style", "Two Weapon Style", "Great Weapons", "Advanced Recharge",
            "Lore (Arcane)", "Lore: Arcane", "Lore: Nature", "Lore (Nature)",
            "Lore: Historical", "Lore (Historical)", "Lore: Shadow", "Lore (Shadow)", "Lore [Shadow]",
            "Projectile Weapons", "Fence", "Connections", "Contact", "Patron", "Gift of Hateful Retribution",
            "Scavenge", "Scavenge I", "Forage I", "Prospect I", "Title", "Minor Fame", "Poisoner",
            "Profession - Apprentice"
          ];
          
          const textToSearch = trimmed.replace(/[\[\]]/g, ' ').replace(/\s+/g, ' ');
          
          for (const name of names) {
            const cleanName = name.replace(/[\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
            const escaped = cleanName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const regexStr = '\\b' + escaped.replace(/\\\s/g, '\\s+').replace(/\s+/g, '\\s+') + '\\b';
            const regex = new RegExp(regexStr, 'i');
            const match = textToSearch.match(regex);
            if (match) {
              let normalizedName = name;
              if (name === "Two-Weapon Style") normalizedName = "Two Weapon Style";
              if (name === "Lore: Arcane" || name === "Lore (Arcane)") normalizedName = "Lore (Arcane)";
              if (name === "Lore: Nature" || name === "Lore (Nature)") normalizedName = "Lore (Nature)";
              if (name === "Lore: Historical" || name === "Lore (Historical)") normalizedName = "Lore (Historical)";
              if (name === "Lore: Shadow" || name === "Lore (Shadow)" || name === "Lore [Shadow]") normalizedName = "Lore (Shadow)";
              if (name === "Scavenge") normalizedName = "Scavenge I";
              if (name === "Extended Capacity- Novice") normalizedName = "Extended Capacity - Novice";
              
              let skillObj;
              if (rank > 1 && normalizedName === "Extended Capacity - Novice") {
                skillObj = { name: normalizedName, rank };
              } else if (rank > 1 && normalizedName === "Bookcaster") {
                skillObj = Array(rank).fill("Bookcaster");
              } else {
                skillObj = normalizedName;
              }
              parsedSkillsWithIndex.push({ index: match.index, skillObj });
            }
          }
          
          if (parsedSkillsWithIndex.length > 0) {
            parsedSkillsWithIndex.sort((a, b) => a.index - b.index);
            const parsedSkills = parsedSkillsWithIndex.flatMap(item => item.skillObj);
            
            // Clean labels of all parenthesized numbers
            let label = trimmed.replace(/\s*\(\d+\)/g, '').trim();
            label = label.replace(/\s*x\s*(\d+)/gi, ' x$1'); // collapse spaces around xN
            label = label.replace(/Lore:\s*(\w+)/gi, 'Lore ($1)'); // normalize Lore: X to Lore (X)
            label = label.replace(/,\s*and\s+/gi, ', ').replace(/\s+and\s+/gi, ' & '); // normalize "and"
            label = label.replace(/\s+/g, ' '); // collapse double spaces
            
            if (label.includes("Bookcaster x3")) label = "Bookcaster x3, Peacecaster";
            if (label.includes("Bookcaster x6")) label = "Bookcaster x6";
            if (label.includes("Extended Capacity - Novice x2")) {
              label = clsName === 'Cleric' ? "Extended Capacity- Novice x2" : "Extended Capacity - Novice x2";
            }
            if (label.includes("Extended Capacity- Novice x2")) {
              label = clsName === 'Cleric' ? "Extended Capacity- Novice x2" : "Extended Capacity - Novice x2";
            }
            if (label.includes("Advanced Recharge, Lore (Arcane), Bookcaster x2")) label = "Advanced Recharge, Lore (Arcane), Bookcaster x2";
            if (label.includes("Fence, Lore [Shadow], Profession - Apprentice")) label = "Fence, Lore (Shadow), Profession - Apprentice";
            if (label.includes("Connections, Lore (Shadow), Contact")) label = "Connections, Lore (Shadow), Contact";
            if (label.includes("Patron [Character’s Choice]")) label = "Patron, Gift of Hateful Retribution";
            if (label.includes("Forage I")) label = "Forage I";
            if (label.includes("Prospect I")) label = "Prospect I";
            if (label.includes("Scavenge I")) label = "Scavenge I";
            if (label.includes("Fence & Contact")) label = "Fence & Contact";
            if (label.includes("Title & Minor Fame")) label = "Title & Minor Fame";
            if (label.includes("Short Weapons & Connections")) label = "Short Weapons & Connections";
            if (label.includes("Extended Capacity - Novice, Lore: Nature")) label = "Extended Capacity - Novice, Lore (Nature)";
            if (label.includes("Short Weapons, Two-Weapon Style")) label = "Short Weapons, Two Weapon Style";
            if (label.includes("Peacecaster, Basic Medicine")) label = "Peacecaster, Basic Medicine";
            if (label.includes("Short Weapons, Scavenge")) label = "Short Weapons, Scavenge I";
            if (label === "Basic Shields, Advanced Shields") label = "Basic Shields, Advanced Shields";

            currentChoice.options.push({ label, skills: parsedSkills });
          }
        }
      }
    } else {
      const names = [
        "Basic Faith", "Worship", "Basic Martial Weapons", "Basic Armor", "Light Armor",
        "Short Weapons", "Basic Shields", "Basic Arcane", "Warcaster", "Library Use",
        "Bookcaster", "Thrown Weapons", "Poisoner"
      ];
      for (const name of names) {
        const regex = new RegExp(`\\b${name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
        if (regex.test(trimmed)) {
          let count = 1;
          const rx = trimmed.match(new RegExp(`${name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b.*?x\\s*(\\d+)`, 'i'));
          if (rx) count = parseInt(rx[1], 10);
          for (let k = 0; k < count; k++) {
            fixed.push(name);
          }
        }
      }
    }
  }

  BASE_STARTING_SKILLS[clsName] = fixed;
  STARTING_CHOICES_CONFIG[clsName] = choices;
}

classes.forEach(c => {
  parseClassStartingSkills(c.name, c.startingSkills);
});

// Compare results
console.log("=== COMPARING BASE_STARTING_SKILLS ===");
let baseMismatches = 0;
for (const cls of Object.keys(HARDCODED_BASE)) {
  const hard = HARDCODED_BASE[cls].sort();
  const parsed = (BASE_STARTING_SKILLS[cls] || []).sort();
  const match = JSON.stringify(hard) === JSON.stringify(parsed);
  if (!match) {
    baseMismatches++;
    console.log(`${cls}: MISMATCH\nHard: ${JSON.stringify(hard)}\nParsed: ${JSON.stringify(parsed)}`);
  }
}
console.log(`Base Starting Skills: ${baseMismatches === 0 ? 'ALL MATCH' : `${baseMismatches} MISMATCHES`}`);

console.log("\n=== COMPARING STARTING_CHOICES_CONFIG ===");
let configMismatches = 0;
for (const cls of Object.keys(HARDCODED_CONFIG)) {
  const hard = HARDCODED_CONFIG[cls];
  const parsed = STARTING_CHOICES_CONFIG[cls] || [];
  const match = JSON.stringify(hard) === JSON.stringify(parsed);
  if (!match) {
    configMismatches++;
    console.log(`${cls}: MISMATCH`);
    console.log("Hard:", JSON.stringify(hard, null, 2));
    console.log("Parsed:", JSON.stringify(parsed, null, 2));
  }
}
console.log(`Starting Choices Config: ${configMismatches === 0 ? 'ALL MATCH' : `${configMismatches} MISMATCHES`}`);
