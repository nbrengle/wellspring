// Starting-choice model — a class's "Starting Skills" entry includes one or more
// named "Choose one of the following" blocks (the class's specialty choices).
// This module is the single source of truth for what those blocks are, plus the
// PURE logic that materializes the chosen skills and reconciles an existing build
// back onto the dropdowns. It deliberately holds no React so the validator and the
// test suite can import it; the UI (Builder.jsx) wires it to state.
//
// An archetype is just starting data: it ships a flat, pre-resolved startingSkills
// list, and reconcileStartingChoices() maps that list back onto these blocks so
// the implicit choice shows as selected and stays editable — the same control a
// from-scratch build gets.

import classesJson from './classes.json';
import { lookupEntity } from './index.js';
import { getClasses } from './validate.js';
import { bareSkill, cleanItemName } from './resolver.js';

// The class's fixed starting skills (granted regardless of the choice blocks). The
// choice-block grants are appended on top via STARTING_CHOICES_CONFIG.
export const BASE_STARTING_SKILLS = {
  Artisan: ["Basic Martial Weapons", "Short Weapons", "Basic Armor"],
  Cleric: ["Basic Faith", "Worship", "Basic Martial Weapons", "Basic Armor"],
  Druid: ["Basic Martial Weapons", "Profession - Apprentice (your choice)", "Basic Faith"],
  Fighter: ["Basic Martial Weapons", "Basic Shields", "Basic Armor", "Light Armor"],
  Mage: ["Basic Arcane", "Library Use", "Bookcaster", "Bookcaster"],
  Rogue: ["Basic Martial Weapons", "Thrown Weapons", "Basic Armor", "Light Armor"],
  Socialite: ["Basic Martial Weapons", "Library Use", "Poisoner", "Basic Armor", "Profession - Apprentice", "Profession - Journeyman"],
  Sourcerer: ["Basic Arcane", "Warcaster"]
};

// Per-class "choose one" blocks. Each block: { id, label (the sheet name), options }
// where each option is { label, skills: [name | { name, rank }] }. `label` is shown
// in the dropdown; `id` keys the recorded choice; the block's `label` is the
// provenance shown on granted items ("<Class> · <label>").
export const STARTING_CHOICES_CONFIG = {
  Mage: [
    {
      id: "startingLore",
      label: "Starting Lore Skill",
      options: [
        { label: "Historical", skills: ["Lore (Historical)"] },
        { label: "Arcane", skills: ["Lore (Arcane)"] },
        { label: "Nature", skills: ["Lore (Nature)"] },
        { label: "Noble", skills: ["Lore (Noble)"] },
        { label: "Religious", skills: ["Lore (Religious)"] },
        { label: "Shadow", skills: ["Lore (Shadow)"] },
        { label: "Ritual", skills: ["Lore (Ritual)"] }
      ]
    },
    {
      id: "magicalSpecialty",
      label: "Magical Specialty",
      options: [
        { label: "Extended Capacity - Novice x2", skills: [{ name: "Extended Capacity - Novice", rank: 2 }] },
        { label: "Advanced Recharge, Lore (Arcane), Bookcaster x2", skills: ["Advanced Recharge", "Lore (Arcane)", "Bookcaster", "Bookcaster"] },
        { label: "Bookcaster x6", skills: ["Bookcaster", "Bookcaster", "Bookcaster", "Bookcaster", "Bookcaster", "Bookcaster"] },
        { label: "Additional Cantrip", skills: ["Additional Cantrip"] }
      ]
    }
  ],
  Cleric: [
    {
      id: "clericService",
      label: "The Means of Service",
      options: [
        { label: "Short Weapons", skills: ["Short Weapons"] },
        { label: "Extended Capacity - Novice", skills: ["Extended Capacity - Novice"] },
        { label: "Basic Medicine, Diagnose", skills: ["Basic Medicine", "Diagnose"] }
      ]
    },
    {
      id: "clericStudy",
      label: "Divine Study",
      options: [
        { label: "Extended Capacity- Novice x2", skills: [{ name: "Extended Capacity - Novice", rank: 2 }] },
        { label: "Additional Cantrip", skills: ["Additional Cantrip"] },
        { label: "Bookcaster x3, Peacecaster", skills: ["Bookcaster", "Bookcaster", "Bookcaster", "Peacecaster"] },
        { label: "Basic Shields, Advanced Shields", skills: ["Basic Shields", "Advanced Shields"] }
      ]
    }
  ],
  Druid: [
    {
      id: "druidSurvival",
      label: "Gathering Choice",
      options: [
        { label: "Forage I", skills: ["Forage I"] },
        { label: "Scavenge I", skills: ["Scavenge I"] }
      ]
    },
    {
      id: "druidBuddingWisdom",
      label: "Budding Wisdom",
      options: [
        { label: "Extended Capacity - Novice, Lore (Nature)", skills: ["Extended Capacity - Novice", "Lore (Nature)"] },
        { label: "Short Weapons, Two Weapon Style", skills: ["Short Weapons", "Two Weapon Style"] },
        { label: "Peacecaster, Basic Medicine", skills: ["Peacecaster", "Basic Medicine"] }
      ]
    }
  ],
  Fighter: [
    {
      id: "fighterCombatPath",
      label: "The Path of Combat",
      options: [
        { label: "Projectile Weapons, Lore (Historical)", skills: ["Projectile Weapons", "Lore (Historical)"] },
        { label: "Short Weapons, Advanced Shields", skills: ["Short Weapons", "Advanced Shields"] },
        { label: "Short Weapons, Two Weapon Style", skills: ["Short Weapons", "Two Weapon Style"] },
        { label: "Great Weapons", skills: ["Great Weapons"] }
      ]
    }
  ],
  Rogue: [
    {
      id: "rogueSpecialty",
      label: "Up to No Good",
      options: [
        { label: "Short Weapons, Scavenge I", skills: ["Short Weapons", "Scavenge I"] },
        { label: "Fence, Lore (Shadow), Profession - Apprentice", skills: ["Fence", "Lore (Shadow)", "Profession - Apprentice"] },
        { label: "Basic Locks, Poisoner", skills: ["Basic Locks", "Poisoner"] },
        { label: "Basic Traps, Poisoner", skills: ["Basic Traps", "Poisoner"] },
        { label: "Connections, Lore (Shadow), Contact", skills: ["Connections", "Lore (Shadow)", "Contact"] }
      ]
    }
  ],
  Socialite: [
    {
      id: "socialiteLore",
      label: "Old Secrets",
      options: [
        { label: "Historical", skills: ["Lore (Historical)"] },
        { label: "Arcane", skills: ["Lore (Arcane)"] },
        { label: "Nature", skills: ["Lore (Nature)"] },
        { label: "Noble", skills: ["Lore (Noble)"] },
        { label: "Religious", skills: ["Lore (Religious)"] },
        { label: "Shadow", skills: ["Lore (Shadow)"] },
        { label: "Ritual", skills: ["Lore (Ritual)"] }
      ]
    },
    {
      id: "socialiteOpportunities",
      label: "Opportunities Abound",
      options: [
        { label: "Fence & Contact", skills: ["Fence", "Contact"] },
        { label: "Title & Minor Fame", skills: ["Title", "Minor Fame"] },
        { label: "Short Weapons & Connections", skills: ["Short Weapons", "Connections"] }
      ]
    }
  ],
  Sourcerer: [
    {
      id: "sourcererContract",
      label: "The Contract With the Other",
      options: [
        { label: "Extended Capacity - Novice x2", skills: [{ name: "Extended Capacity - Novice", rank: 2 }] },
        { label: "Additional Cantrip", skills: ["Additional Cantrip"] },
        { label: "Patron, Gift of Hateful Retribution", skills: ["Patron", "Gift of Hateful Retribution"] }
      ]
    }
  ],
  Artisan: [
    {
      id: "artisanProductive",
      label: "Productive Equipment",
      options: [
        { label: "Apprentice Alchemy", skills: ["Apprentice Alchemy"] },
        { label: "Apprentice Enchanting", skills: ["Apprentice Enchanting"] },
        { label: "Apprentice Tinkering", skills: ["Apprentice Tinkering"] },
        { label: "Apprentice Ritual Magic & Lore (Ritual)", skills: ["Apprentice Ritual Magic", "Lore (Ritual)"] }
      ]
    },
    {
      id: "artisanGathering",
      label: "The Land Provides",
      options: [
        { label: "Forage I", skills: ["Forage I"] },
        { label: "Prospect I", skills: ["Prospect I"] },
        { label: "Scavenge I", skills: ["Scavenge I"] }
      ]
    },
    {
      id: "artisanPath",
      label: "A Path Unfolds",
      options: [
        { label: "Apprentice & Journeyman Profession", skills: ["Profession - Apprentice", "Profession - Journeyman"] },
        { label: "Apprentice Crafting (Alchemy)", skills: ["Apprentice Alchemy"] },
        { label: "Apprentice Crafting (Enchanting)", skills: ["Apprentice Enchanting"] },
        { label: "Apprentice Crafting (Tinkering)", skills: ["Apprentice Tinkering"] },
        { label: "Apprentice Crafting (Ritual)", skills: ["Apprentice Ritual Magic", "Lore (Ritual)"] },
        { label: "Basic Medicine & Hearth", skills: ["Basic Medicine", "Hearth"] },
        { label: "Basic Medicine & Bits and Pieces", skills: ["Basic Medicine", "Bits and Pieces"] },
        { label: "Basic Medicine & Soothing Touch", skills: ["Basic Medicine", "Soothing Touch"] }
      ]
    }
  ]
};

// Does this class have any starting-choice blocks?
export function hasStartingChoices(className) {
  return !!(STARTING_CHOICES_CONFIG[className] || []).length;
}

// Does a config skill name pin a CONCRETE parameter — a trailing "(value)" that
// names a real subject, as the Lore options do ("Lore (Arcane)")? Such a name must
// override a kept item's stale parameter when the choice changes. Placeholder
// parentheticals ("(your choice)", "(Specific Profession)") are NOT concrete — they
// mark a slot the player fills, so a player-chosen value must survive a rebuild. A
// bare " - " (e.g. "Extended Capacity - Novice") is part of the canonical name, not
// a parameter, so it never counts.
const PLACEHOLDER_PARAM = /\b(your|character'?s?|specific|a)\b.*\bchoice\b|\bspecific\b|\bcharacter'?s?\b/i;
function hasParameter(name) {
  const m = String(name).match(/\(([^()]*)\)\s*$/);
  return !!m && !PLACEHOLDER_PARAM.test(m[1]);
}

// Normalize an option's skills entry to { name, rank }.
export function optionSkills(opt) {
  return (opt?.skills || []).map((s) =>
    typeof s === 'string' ? { name: s, rank: 1 } : { name: s.name, rank: s.rank || 1 });
}

// Resolve a starting-skill name to its backing entity (skill / perk / power), or
// null. Knows the alias map (e.g. "Apprentice Profession" ⇄ "Profession -
// Apprentice", parameter stripping, rank suffixes) via lookupEntity. The single
// resolution path shared by reconciliation, match-keying, and the config-integrity
// test — so the test can't drift from how the runtime actually resolves names.
export function resolveSkill(name) {
  return lookupEntity(`skills:${cleanItemName(name)}`)
    || lookupEntity(`perks:${cleanItemName(name)}`)
    || lookupEntity(`powers:${cleanItemName(name)}`)
    || null;
}

// Canonical match-key for a skill name, used to compare a character's starting
// skill against a choice-config option regardless of surface form. Keys off the
// resolved BASE entity name; falls back to the bare cleaned name when nothing
// resolves. Lower-cased so case never matters.
function skillMatchKey(name) {
  const ent = resolveSkill(name);
  const base = ent ? (ent.baseName || ent.name) : bareSkill(cleanItemName(name));
  return base.toLowerCase();
}

// Parse a trailing rank off a skill name ("Extended Capacity - Novice x2" → 2).
// Only the explicit "xN" form bumps the count here; bare Roman/digit suffixes are
// left to the validator's richer parseTrailingRank. Lets reconciliation tell a
// shipped "Foo x2" apart from a single "Foo".
function parseStartingRank(name) {
  const m = String(name || '').trim().match(/\sx\s*(\d+)$/i);
  return m ? parseInt(m[1], 10) : 1;
}

// Reconcile a character's CURRENT starting skills against the choice config to
// infer which option each named choice block (Druid's "Budding Wisdom", Artisan's
// "Productive Equipment" / "The Land Provides" / "A Path Unfolds", …) implicitly
// took. Archetypes ship a flat, pre-resolved startingSkills list with no
// `startingChoices` sidecar — this maps that list back onto the dropdowns so an
// archetype's baked-in choices show as selected and stay editable, exactly like a
// from-scratch build.
//
// The blocks are NOT independent: a class with several choices (Artisan) may offer
// the SAME skill in two blocks, and an archetype that took it once must attribute
// it to exactly one block ("must be different from the choice made in …"). So this
// is a small assignment problem, not per-block greedy matching — we search over
// option combinations, CONSUMING each option's skills from a shared owned-skill
// pool, and keep the assignment that explains the most owned skills. Falls back to
// the default option for any block left unmatched. Pure: returns { [id]: label }.
export function reconcileStartingChoices(character, className) {
  const configs = STARTING_CHOICES_CONFIG[className] || [];
  if (!configs.length) return {};
  // Owned starting skills by canonical key, RANK-AWARE: a skill stored once with
  // rank 2 (e.g. "Extended Capacity - Novice" at ranks[5]===2) counts as two
  // copies, so an option asking for "x2" still matches. Falls back to a trailing
  // "xN" suffix in the name when no rank sidecar is present.
  const startRanks = character.ranks?.startingSkills || [];
  const ownedPool = {};
  (character.startingSkills || []).forEach((s, i) => {
    const b = skillMatchKey(s);
    ownedPool[b] = (ownedPool[b] || 0) + (startRanks[i] || parseStartingRank(s) || 1);
  });

  // Need-counts for one option, keyed by canonical skill key.
  const optionNeed = (opt) => {
    const need = {};
    for (const s of optionSkills(opt)) {
      const b = skillMatchKey(s.name);
      need[b] = (need[b] || 0) + (s.rank || 1);
    }
    return need;
  };
  // Can `need` be drawn from the remaining `pool`? Returns the post-draw pool, or
  // null if not fully satisfiable.
  const draw = (pool, need) => {
    const next = { ...pool };
    for (const [b, n] of Object.entries(need)) {
      if ((next[b] || 0) < n) return null;
      next[b] -= n;
    }
    return next;
  };

  // DFS over blocks: for each, try every option that the remaining pool can still
  // satisfy (consuming its skills), plus an "unmatched" branch. Score = total
  // owned skills consumed; richer (more-specific) matches win, and shared skills
  // can only be claimed once. Best assignment across the whole search is kept.
  let bestAssign = null;
  let bestScore = -1;
  const search = (i, pool, assign, score) => {
    if (i === configs.length) {
      if (score > bestScore) { bestScore = score; bestAssign = { ...assign }; }
      return;
    }
    const conf = configs[i];
    for (const opt of conf.options) {
      const after = draw(pool, optionNeed(opt));
      if (!after) continue;
      search(i + 1, after, { ...assign, [conf.id]: opt.label }, score + optionSkills(opt).length);
    }
    // Always allow leaving this block unmatched (its default) so a partial match
    // elsewhere isn't blocked by one unsatisfiable block.
    search(i + 1, pool, { ...assign, [conf.id]: null }, score);
  };
  search(0, ownedPool, {}, 0);

  const res = {};
  for (const conf of configs) {
    res[conf.id] = (bestAssign && bestAssign[conf.id]) || conf.options[0]?.label;
  }
  return res;
}

// The starting skills a class+choices grant, each tagged with { name, rank,
// specialty }: the class's fixed base grants first (specialty null), then each
// chosen option's skills tagged with their block label. The single source of truth
// for "what does this build's starting block produce", shared by rebuild (forward)
// and startingSkillGrants (derive-on-read).
function expectedStartingSkills(primaryClassName, choices) {
  const fixed = (BASE_STARTING_SKILLS[primaryClassName] || []).map((s) =>
    typeof s === 'string' ? { name: s, rank: 1, specialty: null } : { name: s.name, rank: s.rank || 1, specialty: null });
  const out = [...fixed];
  for (const conf of STARTING_CHOICES_CONFIG[primaryClassName] || []) {
    const chosenVal = choices?.[conf.id];
    const opt = chosenVal && conf.options.find((o) => o.label === chosenVal);
    if (!opt) continue;
    for (const s of optionSkills(opt)) out.push({ name: s.name, rank: s.rank, specialty: conf.label });
  }
  return out;
}

// Derive, for a character's CURRENT startingSkills array, which choice block
// granted each index and the free rank floor it grants — WITHOUT relying on a
// persisted sidecar. This is the read-side counterpart to rebuildStartingSkills:
// it matches each current skill to an expected template (same canonical-key /
// in-order logic), so provenance badges and floor-billing work on ANY character
// (freshly built, imported from a sheet, or loaded from a URL hash) rather than
// only on ones that just went through a rebuild. Returns
// { specialty: {idx→label}, floor: {idx→rank} } for indices that came from a grant.
export function startingSkillGrants(character) {
  const primary = getClasses(character)[0]?.name;
  const specialty = {};
  const floor = {};
  if (!primary || !hasStartingChoices(primary)) return { specialty, floor };
  const choices = (character.startingChoices && Object.keys(character.startingChoices).length)
    ? character.startingChoices
    : reconcileStartingChoices(character, primary);
  const expected = expectedStartingSkills(primary, choices);
  const byBase = {};
  for (const t of expected) (byBase[skillMatchKey(t.name)] = byBase[skillMatchKey(t.name)] || []).push(t);
  const kept = {};
  (character.startingSkills || []).forEach((item, idx) => {
    const base = skillMatchKey(item);
    const templates = byBase[base] || [];
    const k = kept[base] || 0;
    if (k < templates.length) {
      const t = templates[k];
      if (t.specialty) specialty[idx] = t.specialty;
      floor[idx] = t.rank || 1;       // floor exists even for fixed grants (their full rank is free)
      kept[base] = k + 1;
    }
  });
  return { specialty, floor };
}

// Materialize a class's starting skills from its fixed grants + the chosen options.
// Drives both blank builds (choices from the dropdown) and archetype-loaded builds
// (choices reconciled from the shipped skill list). Existing parameters (e.g. a
// chosen Lore subject) are preserved when a kept skill still matches an expected
// one; skills unrelated to any choice block are preserved untouched (never silently
// deleted), and a previously-chosen option's skills drop when the choice changes.
// Provenance (which block granted each skill) and the free-rank floor are NOT
// persisted on the character — they're derived on read by startingSkillGrants, so
// they can't be lost on import / round-trip.
export function rebuildStartingSkills(character, primaryClassName, updatedChoices = null) {
  const choices = updatedChoices || character.startingChoices || {};

  const expectedList = expectedStartingSkills(primaryClassName, choices);
  const classConfigs = STARTING_CHOICES_CONFIG[primaryClassName] || [];

  // Group expected entries by canonical match-key so we can match current items
  // (which may carry a chosen parameter or an alias spelling) against the right
  // template in order.
  const expectedByBase = {};
  for (const item of expectedList) {
    const base = skillMatchKey(item.name);
    (expectedByBase[base] = expectedByBase[base] || []).push(item);
  }

  // Every skill key that ANY option of ANY block for this class can grant. A
  // current starting skill whose key is in here but NOT in the expected list was
  // the PREVIOUSLY selected option — it must drop when the choice changes. A skill
  // whose key is NOT in here is unrelated to the choices (a manual add, or a skill
  // an archetype shipped that doesn't conform to the config, e.g. Blaster
  // Sourcerer's mislabeled Advanced Recharge) — preserve it untouched so a rebuild
  // never silently deletes build state it doesn't own.
  const choiceKeys = new Set();
  for (const conf of classConfigs) {
    for (const opt of conf.options) {
      for (const s of optionSkills(opt)) choiceKeys.add(skillMatchKey(s.name));
    }
  }

  const currentSkills = character.startingSkills || [];
  const currentRanks = character.ranks?.startingSkills || [];
  const nextSkills = [];
  const nextRanks = [];

  const keptCounts = {};
  const pushItem = (name, rank) => {
    nextSkills.push(name);
    nextRanks.push(rank || 1);
  };

  // Keep current items that still belong (matched to an expected template),
  // plus any items unrelated to the choices.
  for (let i = 0; i < currentSkills.length; i++) {
    const item = currentSkills[i];
    const base = skillMatchKey(item);
    const templates = expectedByBase[base] || [];
    const kept = keptCounts[base] || 0;
    if (kept < templates.length) {
      const t = templates[kept];
      const floor = t.rank || 1;
      // Preserve any rank the user bought ABOVE the free floor; never below it.
      const total = Math.max(floor, currentRanks[i] || floor);
      // Name: when the chosen OPTION pins a specific parameter (e.g. the Lore
      // dropdown selects "Lore (Arcane)"), the template wins so switching the
      // choice actually changes the subject. When the template is parameter-less
      // (a generic grant the player later customized — "Profession - Apprentice
      // (Smith)"), keep the player's current name so their pick survives a rebuild.
      const name = hasParameter(t.name) ? t.name : item;
      pushItem(name, total);
      keptCounts[base] = kept + 1;
    } else if (!choiceKeys.has(base)) {
      // Unrelated to any choice block — preserve as-is (keeps its current rank).
      pushItem(item, currentRanks[i] || 1);
    }
    // else: a choice-block skill that's no longer expected → dropped (old choice).
  }

  // Add any still-missing expected skills.
  for (const [base, templates] of Object.entries(expectedByBase)) {
    for (let i = keptCounts[base] || 0; i < templates.length; i++) {
      pushItem(templates[i].name, templates[i].rank);
    }
  }

  const grants = startingSkillGrants({ ...character, startingSkills: nextSkills, startingChoices: choices, ranks: { ...(character.ranks || {}), startingSkills: nextRanks } });
  return {
    ...character,
    startingSkills: nextSkills,
    ranks: { ...(character.ranks || {}), startingSkills: nextRanks },
    startingChoices: choices,
    specialtySources: grants.specialty,
    grantedRanks: grants.floor,
  };
}

// ─── SOURCE-DRIFT GUARD ────────────────────────────────────────────────────────
// STARTING_CHOICES_CONFIG is curated by hand because the MegaDoc's "Starting
// Skills" prose is too irregular to fully parse into the dropdown STRUCTURE (see
// DOC_EDITS_WANTED.md #12). But the SET of skills that prose references IS
// extractable, and that's the thing most likely to drift when the doc is edited.
// configSkillKeys() and sourceStartingSkillKeys() return comparable skill-key sets
// so a test can assert the curated config still covers exactly what the source
// grants — turning silent drift into a loud, located failure.

// Canonical key for a config-or-source skill name (shared with reconciliation).
function skillKey(name) {
  return skillMatchKey(name);
}

// The skill keys the curated config can grant for a class (across all blocks +
// options), each tagged so a diff can point at the offending block.
export function configSkillKeys(className) {
  const out = new Set();
  for (const block of STARTING_CHOICES_CONFIG[className] || []) {
    for (const s of block.options.flatMap(optionSkills)) out.add(skillKey(s.name));
  }
  return out;
}

// Every skill key a class's "Starting Skills" prose plausibly references. The
// prose structure is too irregular to segment reliably (the ` - ` inside names
// like "Extended Capacity - Novice", inline-vs-header choices, bracket params —
// see DOC_EDITS_WANTED.md #12), so instead of parsing structure we do a
// resolution-driven sweep: try every short contiguous word window and keep the
// ones that resolve to a real entity (via the alias layer). It's a SUPERSET — it
// also picks up fixed grants — which is exactly what the config-coverage guard
// needs ("every config skill is mentioned somewhere in the prose"). This can't be
// fooled by a typo'd config skill, and degrades gracefully (a window that doesn't
// resolve is simply ignored).
export function sourceStartingSkillKeys(className) {
  const cls = classesJson.find((c) => c.name === className);
  if (!cls) return new Set();
  const keys = new Set();
  for (const line of cls.startingSkills || []) {
    if (/^Note:/i.test(line)) continue;
    for (const k of resolvableWindows(line)) keys.add(k);

    // Also look for combinations of any tier word in the line with any other words in the line
    const tiers = [...line.matchAll(/\b(Apprentice|Journeyman|Greater|Master)\b/gi)].map(m => m[1]);
    if (tiers.length > 0) {
      const cleanLine = line
        .replace(/\b(Apprentice|Journeyman|Greater|Master)\b/gi, ' ')
        .replace(/\(\d+\)/g, ' ')
        .replace(/x\s*\d+/ig, ' ')
        .replace(/[,&:[\]()]/g, ' ')
        .replace(/\bAND\b/g, ' ');
      const words = cleanLine.split(/\s+/).filter(Boolean);
      for (let i = 0; i < words.length; i++) {
        for (let len = 1; len <= 3 && i + len <= words.length; len++) {
          const phrase = words.slice(i, i + len).join(' ');
          for (const tier of tiers) {
            for (const combo of [`${tier} ${phrase}`, `${phrase} ${tier}`]) {
              if (resolveSkill(combo)) keys.add(skillKey(combo));
            }
          }
        }
      }
    }

    // A "Choose … <Tier> [opt, opt]" label distributes its tier word across the
    // bracketed options: "Apprentice Crafting: [Alchemy, Enchanting]" grants
    // "Apprentice Alchemy", "Apprentice Enchanting", … General rule, not per-class.
    const br = line.match(/\b(Apprentice|Journeyman|Greater|Master)\b[^[]*\[([^\]]*)\]/i);
    if (br) {
      for (const opt of br[2].split(/,|\bor\b|\bAND\b/i)) {
        const o = opt.replace(/[()]/g, '').trim();
        for (const combo of [`${br[1]} ${o}`, `${o} ${br[1]}`]) {
          if (o && resolveSkill(combo)) keys.add(skillKey(combo));
        }
      }
    }
  }
  return keys;
}

// All resolvable 1–5-word windows in a prose line, as canonical skill keys. Cost
// "(n)" and rank "xN" markers are stripped; commas/&/AND/brackets become word
// breaks so neighbouring skills don't fuse.
function resolvableWindows(line) {
  const out = new Set();
  const words = line
    .replace(/\(\d+\)/g, '').replace(/x\s*\d+/ig, '')
    .replace(/\s*&\s*/g, ' and ')
    .replace(/[,:[\]()]/g, ' ').replace(/\bAND\b/g, ' ')
    .split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    for (let len = 1; len <= 5 && i + len <= words.length; len++) {
      const phrase = words.slice(i, i + len).join(' ');
      if (resolveSkill(phrase)) out.add(skillKey(phrase));
    }
  }
  return out;
}
