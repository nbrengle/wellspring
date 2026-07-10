// Validator: turns a character object into a build report. Wellspring has two
// independent "currencies":
//   1. BP (Build Points) — a single pool that buys skills + perks, refunded by
//      flaws. Budget comes from the level table.
//   2. Power slots — per-class, per-tier counts granted at the character's level
//      (e.g. a level-4 Fighter gets 2 utility + 2 basic). Casters instead have
//      cantrip and spells-known counts. These don't draw from BP.
//
// Pure functions, no React, so the UI calls them in a useMemo and they stay
// unit-testable. The input is a CharacterState; resolveCharacterGraph derives the
// class innates + devotion entry, and everything downstream reads the resolved graph.

import {
  LEVEL_TABLE,
  lookupEntity,
  CLASS_POWER_SLOTS,
  DEVOTIONS,
  DOMAINS,
  CRAFTING,
  RITUALS,
  divineSubstitutionOptions,
} from "../engine/data.js";
import { cleanItemName, bareSkill, getClasses, primaryClass } from "./resolver.js";
import type { CharacterState, CharacterChoice, BaseEntity, BPLedgerEntry } from "./types.js";

// Shared primitives now live in validate/core.js (hotspot split). Import the ones
// this module still uses internally, and re-export the public surface from the
// barrel so existing imports (`from './data/validate.js'`) keep working unchanged.
import {
  MAX_LBP,
  MAX_FLAW_BP,
  BACKSTORY_BP,
  MAX_DOMAINS,
  DEFAULT_WEALTH,
  LEGAL_MIN_LEVEL,
  LEVEL_CAP,
  subKey,
  characterLevel,
  getLegalMinLevel,
  getMaxRanks,
  maxProgressionLevel,
} from "./validate/core.js";
export {
  MAX_LBP,
  MAX_FLAW_BP,
  BACKSTORY_BP,
  MAX_DOMAINS,
  DEFAULT_WEALTH,
  LEGAL_MIN_LEVEL,
  LEVEL_CAP,
  subKey,
  getClasses,
  primaryClass,
  characterLevel,
  getLegalMinLevel,
  getMaxRanks,
};
export { EVENTS_TABLE } from "./validate/core.js";
import { lbpState } from "./validate/lbp.js";
export { lbpState };

// Slot/spell-slot accounting (validate/slots.js) and prerequisite checking
// (validate/prereqs.js) — extracted leaves. Import the ones the orchestrator calls
// internally; re-export the public surface so the barrel keeps its API.
import {
  computeSlots,
  spellSlots,
  bookcasterSpellOptions,
  arcaneSecretsSpellOptions,
  weirdWanderingsOptions as weirdWanderingsPool,
  studiedFocusOptions as studiedFocusPool,
  ARTISAN_SPECIALTY_TAGS,
  eligibleClassChoices,
  CLASS_CHOICE_SKILLS,
  basicSpellOptions,
  BASIC_SPELL_SKILLS,
} from "./validate/slots.js";
export {
  innateBonusCantrips,
  eligibleClassChoices,
  CLASS_CHOICE_SKILLS,
  agileLearnerCapacity,
  basicSpellOptions,
  BASIC_SPELL_SKILLS,
} from "./validate/slots.js";
import { resolveCharacterGraph, grantedAbilities } from "./graph.js";
import { characterPools } from "./pool-registry.js";
export { grantedAbilities };

import { costKey } from "./validate/cost-key.js";

export { prereqStatus, checkLevelConstraint } from "./validate/prereqs.js";
import { CRAFT_DISCIPLINES, CRAFTING_TIERS } from "./config.js";

// Wellspring has three distinct "consequence" kinds, kept separate by design:
//   1. GRANT-OF-ENTITY — a source gives you a named Perk/Power/Skill for free
//      ("gains the Magical Resilience Perk"). Edge: REFS.grants/grantedBy. ↓ here.
//   2. GRANT-OF-SLOT    — a source gives you an extra slot/pool ("+1 Novice
//      spell-slot"). Parser-extracted to entity.slotGrants; applied by
//      slotGrants/spellSlots, not here.
//   3. DISCOUNT         — a source makes other purchases cheaper (Patron, etc.).
//      Edge: REFS.discounts. Handled by discountSources/applyDiscounts.
// (We use one word — "grant" — for #1; an earlier draft called it "bestowal".)

// Per-level power benefits (kind: per-level tiers). Some powers gain benefits as a
// CLASS LEVEL rises — "at various Artisan Levels: Level 1 …, Level 3 …" — parsed
// into `levelBenefits` at build time. For each such power the character owns, mark
// which entries are ACTIVE given the character's level in that power's gating class
// (auto-granted, no BP, no error — higher tiers are simply still locked). Returns
// [{ power, gateClass, benefits: [{ level, text, active }] }].
interface PowerBenefit {
  power: string;
  gateClass?: string;
  benefits: { level: number; text: string; param?: string; active: boolean }[];
}
export function activePowerBenefits(character: CharacterState) {
  const levelByClass = Object.fromEntries(getClasses(character).map((c) => [c.name, c.level]));
  const out: PowerBenefit[] = [];
  for (const item of character.powers || []) {
    const ent = lookupEntity(`powers:${cleanItemName(item.entityId || (item as CharacterChoice & {name?: string}).name || "")}`);
    if (!ent?.levelBenefits) continue;
    const lvl = (ent.levelBenefitClass ? levelByClass[ent.levelBenefitClass] : undefined) ?? characterLevel(character);
    out.push({
      power: ent.name,
      gateClass: ent.levelBenefitClass,
      benefits: ent.levelBenefits.map((b: {level: number; text: string}) => ({ ...b, active: lvl >= b.level })),
    });
  }
  return out;
}

// Whether the character has the Worship skill (lets them follow a devotion and
// access its domains). Reads the skills bucket (entityId), any source. Any
// class can take it; "Worship - <Devotion>" matches the prefix.
export function hasWorship(character: CharacterState) {
  return (character?.skills || []).some((s: CharacterChoice & { name?: string }) => /^worship\b/i.test(s.entityId || s.name || ""));
}

// Devotion / domain state for the UI: the chosen devotion, the domains it grants,
// the character's selected domains (≤2, intersected with what the devotion has),
// whether Worship is held, and the domain powers available to purchase from the
// selected domains. Returns null when no devotion is set.
export function devotionState(character: CharacterState) {
  const devName = character?.devotion;
  if (!devName) return null;
  const dev = DEVOTIONS.find((d) => d.name === devName || d.baseName === devName);
  const standard = dev?.domains || [];

  // Divine Substitution (Cleric Class power): grants access to ONE extra domain that
  // is neither standard nor in direct opposition to a standard domain. Eligible
  // options are computed from the parsed opposed-domains data; the chosen one (stored
  // in choices['powers:Divine Substitution']) joins `available` so its powers can be
  // bought. ownsSubstitution gates the UI picker.
  const ownsSubstitution = ownsDivineSubstitution(character);
  const substitutionOptions = ownsSubstitution ? divineSubstitutionOptions(standard) : [];
  const subPick = character.choices?.["powers:Divine Substitution"];
  const substituted = ownsSubstitution && subPick && substitutionOptions.includes(subPick) ? subPick : undefined;

  const available = substituted ? [...standard, substituted] : standard;
  const chosen = (character.divineDomains || []).filter((d) => available.includes(d)).slice(0, MAX_DOMAINS);
  // Domain powers purchasable from the chosen domains.
  const powers = chosen.flatMap((dn) => {
    const baseName = dn.split(":")[0].trim();
    const dom = DOMAINS.find((x) => x.name === baseName);
    return (dom?.powers || []).map((p) => ({ ...p, domain: dn }));
  });
  return {
    devotion: dev || { name: devName, domains: [] },
    available,
    standard,
    chosen,
    worship: hasWorship(character),
    eligiblePowers: powers,
    substitution: ownsSubstitution ? { options: substitutionOptions, chosen: substituted } : null,
  };
}

// Whether the character owns the Divine Substitution Class power (in the
// powers bucket).
function ownsDivineSubstitution(character: CharacterState) {
  return (character.powers || []).some((p: CharacterChoice & { name?: string }) => /^Divine Substitution\b/.test(cleanItemName(p.entityId || p.name || "")));
}

// Normalization functions getClasses and primaryClass are now imported from ./resolver.js

// bareSkill helper is now imported from ./resolver.js

// multiclassGrants moved to validate/core.js (the graph emits its `skills` as
// owned items; validate() consumes its `freeBP` as a budget derivation). Import
// for internal use and re-export to preserve the public API.
import { multiclassGrants } from "./validate/core.js";
export { multiclassGrants };

export function classifyOwnedItems(character: CharacterState) {
  // The single resolution site is the CharacterGraph: project its bucketed read
  // layer (graph.uiBuckets) into the 4 buckets the build sheet + pickers read.
  // No second graph-walk, no parallel dedupe/misfile machinery — the model already
  // deduped, routed grants, and stamped provenance. Power tiers (basic/advanced/
  // veteran/utility/class/domain) collapse into one classPowers list for the UI.
  const g = resolveCharacterGraph(character);
  const b = g.uiBuckets;
  const classPowers = [...b.basicPowers, ...b.advancedPowers, ...b.veteranPowers, ...b.utilityPowers, ...b.classPowers];
  const skills = [...b.skills];
  const mcGrants = multiclassGrants(character).skills;
  for (const mc of mcGrants) {
    skills.push({
      name: mc.name,
      field: "skills",
      sourceType: "multiclass",
      cls: mc.source,
      index: -1,
      rank: 1,
    } as any);
  }

  return {
    skills,
    perks: b.perks,
    classPowers,
    domainPowers: b.domainPowers,
    flaws: b.flaws,
    innatePowers: b.innatePowers,
    misfiled: {},
  };
}

// ─── CRAFTING / RITUAL CAPABILITY ──────────────────────────────────────────
// What a character can MAKE, derived purely from the crafting/ritual skills they
// own. Crafting tiers nest (Greater requires Journeyman requires Apprentice — see
// REFS.prereqs), so the highest owned tier in a discipline unlocks that tier and
// every tier below it. Ritual Magic gates the ritual recipe list the same way.
const CRAFT_TIER_RANK: Record<string, number> = { Apprentice: 1, Journeyman: 2, Greater: 3 };

// Every skill the character possesses (starting + purchased + granted), bare of
// any "(parameter)" suffix. Shared basis for capability checks.
export function ownedSkillNames(character: CharacterState) {
  // All owned skills (starting + purchased) are CharacterChoice[] in skills[].
  const skillNames = (character.skills || []).map((s: CharacterChoice) => s.entityId);
  const names = new Set(skillNames.map(bareSkill));
  for (const g of grantedAbilities(character).list) {
    if (g.abilityType === "skills") names.add(bareSkill(g.abilityName));
  }
  // Multiclass auto-granted skills count too.
  for (const s of multiclassGrants(character).skills) names.add(bareSkill(s.name));
  return names;
}

// Returns { crafting: [{ discipline, tier, count, recipes:[...] }], rituals:
// { tier, recipes:[...] }|null, any: bool }. `tier` is the HIGHEST unlocked
// (subsumes lower); recipes lists every makeable recipe at or below that tier.
export function craftingCapability(character: CharacterState) {
  const owned = ownedSkillNames(character);
  const topTier = (stem: string) => {
    let best = 0;
    for (const t of CRAFTING_TIERS) {
      if (owned.has(`${t} ${stem}`)) best = Math.max(best, CRAFT_TIER_RANK[t]);
    }
    return best; // 0 = none
  };

  const crafting: {
    discipline: string;
    tier: string | undefined;
    count: number;
    recipes: { name: string; tier: string }[];
  }[] = [];
  for (const [discipline, stem] of Object.entries(CRAFT_DISCIPLINES)) {
    const rank = topTier(stem);
    if (!rank) continue;
    const tier = Object.keys(CRAFT_TIER_RANK).find((t) => CRAFT_TIER_RANK[t] === rank);
    const recipes = CRAFTING.filter((r) => r.discipline === discipline && CRAFT_TIER_RANK[r.tier] <= rank).map((r) => ({
      name: r.name,
      tier: r.tier,
    }));
    crafting.push({ discipline, tier, count: recipes.length, recipes });
  }

  const ritualRank = topTier("Ritual Magic");
  let rituals: { tier: string | undefined; count: number; recipes: { name: string; tier: string }[] } | null = null;
  if (ritualRank) {
    const tier = Object.keys(CRAFT_TIER_RANK).find((t) => CRAFT_TIER_RANK[t] === ritualRank);
    const recipes = RITUALS.filter((r) => CRAFT_TIER_RANK[r.tier] <= ritualRank).map((r) => ({
      name: r.name,
      tier: r.tier,
    }));
    rituals = { tier, count: recipes.length, recipes };
  }

  return { crafting, rituals, any: crafting.length > 0 || !!rituals };
}

// Base Build Points from the level table (9 at level 4). Below the table's floor
// the rule is "2 BP per level", so we extrapolate down (L3=7, L2=5, L1=3) rather
// than report 0 — even though such a character is flagged below-floor / invalid.
export function budgetFor(level: number, legalMinLevel = 4) {
  const row = LEVEL_TABLE.find((l) => l.level === level);
  if (row) return row.bp;
  const floor = LEVEL_TABLE.find((l) => l.level === legalMinLevel);
  if (floor && level < legalMinLevel) return Math.max(0, floor.bp - 2 * (legalMinLevel - level));
  return 0;
}

// Bonus BP allowance: a character may earn bonus Build Points up to a cap equal
// to their total character level (MegaDoc "Bonus BP" rule). It's optional/earned,
// so it's surfaced as headroom above the base budget rather than free spend — a
// build that exceeds base but stays within base+bonus is "legal with bonus BP".
export function bonusBudgetFor(level: number) {
  return level;
}

export function computeActiveSelections(graph: import("./types.js").CharacterGraph, lbp?: { missingRequired?: { baseName: string }[], advantages?: { name: string, baseName?: string }[] } | null) {
  // A granted "choose one" selection surfaced for the UI, tagged with the entity that
  // granted it. `gs` is parser-shaped (open), so we widen it and add sourceName.
  const active: (Record<string, unknown> & { sourceName: string })[] = [];
  const check = (name: string) => {
    const ent = lookupEntity(name);
    if (ent?.grantedSelections) {
      for (const gs of ent.grantedSelections) {
        active.push({ ...gs, sourceName: name });
      }
    }
  };
  for (const item of graph.items) {
    if (item.field !== "synthetic") {
      const nm = item.name || item.rawString; if (nm) check(nm);
    }
  }
  for (const a of lbp?.advantages || []) {
    const nm = a.name || a.baseName; if (nm) check(nm);
  }
  return active;
}

export function validate(character: CharacterState) {
  const graph = resolveCharacterGraph(character);
  const resolved = graph.character;
  const level = characterLevel(resolved);
  const legalMinLevel = getLegalMinLevel(resolved);
  // Base budget plus DERIVED "free BP" (redundant multiclass grants award free BP
  // equal to the skill's cost). Derived from the classes, not a cached field, so
  // it's correct for any character (built, imported, or hand-edited).
  const mcGrants = multiclassGrants(resolved);
  const freeBP = mcGrants.freeBP;
  // "Approved backstories provide the character with 2 additional BP." Opt-in
  // (plot-team approval), so it's a flag on the character that lifts the base
  // budget by a fixed +2 rather than free spend.
  const backstoryBP = resolved.backstoryApproved ? BACKSTORY_BP : 0;
  const extraMaxBP = resolved.extraMaxBP || 0;
  const spend = graph.spend;
  // Flaws AWARD BP: they raise the build budget rather than offsetting spend, so a
  // character with 5 flaw BP shows "spent of (base + 5)" — more headroom — instead
  // of looking like they spent 5 less. `spend.awarded` is already capped at
  // MAX_FLAW_BP, so the lift is capped too.
  const budget = budgetFor(level, legalMinLevel) + freeBP + backstoryBP + extraMaxBP + spend.awarded;
  const bonusBudget = bonusBudgetFor(level);
  const maxBudget = budget + bonusBudget;
  const slots = computeSlots(resolved);
  const spellSlotCounts = spellSlots(resolved);
  const bookcasterOptions = bookcasterSpellOptions(resolved);
  // Arcane Secrets (Knowledge domain power): the arcane spells the character may add
  // to Known Spells — rank-gated for casters, capped at Adept for non-casters.
  const arcaneSecretsOptions = arcaneSecretsSpellOptions(resolved);
  // Weird Wanderings (Artisan Basic power): Basic powers from any non-Artisan Base
  // Class the Artisan may copy (no Spell-refresh).
  const weirdWanderingsOptions = weirdWanderingsPool();
  // Studied Focus (Artisan Advanced power): the chosen Specialty Tag + the two Basic
  // Artisan powers it lets you pick (both must share the tag).
  const studiedFocus = {
    tags: ARTISAN_SPECIALTY_TAGS,
    tag: resolved.choices?.["powers:Studied Focus"] || null,
    options: studiedFocusPool(resolved.choices?.["powers:Studied Focus"] || undefined),
  };
  // Basic Arcane / Basic Faith pickable spell pools (sphere-gated; non-casters get
  // any base class of that sphere). Keyed by skill base name for the UI picker.
  const basicSpellChoices = Object.fromEntries(
    Object.entries(BASIC_SPELL_SKILLS).map(([skill, mt]) => [skill, basicSpellOptions(resolved, mt)]),
  );
  const stats = graph.stats;
  const wealth = graph.wealth;
  const devotion = devotionState(resolved);
  const lbp = lbpState(resolved);
  const granted = grantedAbilities(resolved);
  const crafting = craftingCapability(resolved);
  const owned = classifyOwnedItems(resolved);
  // Class "pools" (Healing Touch Pool, Living Iron Pool, …): derived from the
  // owned set + class levels. Only pools whose defining power is owned appear.
  // Read-layer-shaped record the identity rail + a Pool facet consume directly.
  const ownedFlat = [...owned.skills, ...owned.perks, ...owned.classPowers, ...owned.innatePowers];
  const classLevelOf = (className: string) => getClasses(resolved).find((c) => c.name === className)?.level ?? 0;
  const pools = characterPools(ownedFlat, classLevelOf);
  // Class-choice grants (Extensive Combat Training / Extensive Training /
  // Spell-Scholar): the classes the player may pick for each, gated by the classes
  // they actually have. The UI reads this to offer ONLY eligible classes (not the
  // hardcoded full list) as the skill's parameter.
  const classChoices = Object.fromEntries(
    Object.keys(CLASS_CHOICE_SKILLS).map((baseName) => [baseName, eligibleClassChoices(resolved, baseName)]),
  );
  // Attach each classified row's computed cost record (from the BP ledger) so the
  // UI reads `row.cost` directly instead of reconstructing a ledger key per row.
  for (const bucket of ["skills", "perks", "classPowers", "domainPowers", "flaws", "innatePowers"] as const) {
    for (const row of (owned[bucket as keyof typeof owned] as (import("./types.js").ViewState & { cost: number | import("./types.js").BPLedgerEntry })[])) {
      const key = costKey(row.id);
      if (key) {
        row.cost = spend.byItem[key] || row.cost;
      }
    }
  }
  const activeSelections = computeActiveSelections(graph, lbp);
  const powerBenefits = activePowerBenefits(resolved);
  const prereqs = graph.prereqs;
  const slotsOver = slots.some((s) => s.over);
  // BP used beyond the base allowance, drawn from the bonus pool (clamped ≥0).
  const bonusUsed = Math.max(0, spend.net - budget);
  // A build is over budget when spend exceeds the DISPLAYED cap — i.e. the base
  // budget (incl. free + backstory BP). "Bonus BP" is earned in play and saved,
  // not a creation-time allowance, so spending past the shown 9/9 is illegal even
  // if it's within base+bonus. (The rules say "Spend your BP, or save it for
  // later" — under-spend is fine; over-spend past the cap is not.)
  const overBudget = spend.net > budget;
  // Characters below the campaign's documented floor are buildable but
  // not legal play — flagged so the UI can mark them invalid with a reason.
  const belowFloor = level < legalMinLevel;
  // Total level above the current play cap (10). Not enforced — just flagged —
  // since the only path past 10 is Advanced Classes, which aren't published yet.
  const aboveCap = level > LEVEL_CAP;
  // Any class past its documented progression (base classes cap at 10; 11+ is
  // Advanced Classes, not yet published). Slots/stats are frozen at the top row.
  const beyondProgression = getClasses(character).some(
    (c) => CLASS_POWER_SLOTS[c.name] && c.level > maxProgressionLevel(c.name),
  );
  return {
    level,
    budget,
    freeBP,
    backstoryBP,
    multiclassGrants: mcGrants,
    bonusBudget,
    maxBudget,
    _graph: graph,
    spend,
    remaining: budget - spend.net, // vs. base (may be negative)
    bonusUsed,
    overBudget,
    usesBonus: bonusUsed > 0 && !overBudget, // legal, but dips into bonus
    slots,
    slotsOver,
    spellSlots: spellSlotCounts,
    bookcasterOptions,
    arcaneSecretsOptions,
    weirdWanderingsOptions,
    studiedFocus,
    basicSpellChoices,
    stats,
    wealth,
    devotion,
    lbp,
    grantedAbilities: granted,
    crafting,
    owned,
    pools,
    classChoices,
    activeSelections,
    powerBenefits,
    prereqs,
    belowFloor,
    aboveCap,
    beyondProgression,
    legalMinLevel,
    levelCap: LEVEL_CAP,
    valid: !prereqs.issues.length && !overBudget && !slotsOver && !belowFloor && (!lbp || lbp.valid),
  };
}

/** The build report validate() produces — the resolved character + all derived
 *  views the UI reads. Inferred from the return so it tracks reality; consumers
 *  annotate their `report` params with it instead of `any`. */
export type BuildReport = ReturnType<typeof validate>;

export function validityReasons(report: BuildReport | null | undefined) {
  if (!report) return [];
  const out: string[] = [];
  if (report.belowFloor) out.push(`Below the level-${report.legalMinLevel} minimum`);
  if (report.aboveCap) out.push(`Above the level-${report.levelCap} cap (Advanced Classes pending)`);
  if (report.overBudget) out.push(`Over budget by ${report.spend.net - report.budget} BP`);
  for (const s of report.slots || []) {
    if (s.over) out.push(`${s.label}: ${s.used}/${s.allowed} (over by ${s.used - s.allowed})`);
  }
  for (const iss of report.prereqs?.issues || []) {
    if (iss.text && !iss.missing) {
      out.push(`${iss.item}: ${iss.text}`);
      continue;
    }
    const need = [
      ...(iss.missing || []).map((m: { name: string }) => m.name),
      ...(iss.anyOf || []).map((g: { name: string }[]) => g.map((m) => m.name).join(" or ")),
    ].join(", ");
    out.push(`${iss.item} needs: ${need}`);
  }
  const lbp = report.lbp;
  if (lbp) {
    if (lbp.overspent) out.push(`Lineage: ${lbp.spent - lbp.awarded} LBP overspent`);
    if (lbp.mixedSublineage) out.push("Lineage: items from more than one sublineage");
    if (lbp.needsSublineage)
      out.push(`Lineage: select the ${lbp.requiredSublineages.join("/")} sublineage to take its items`);
    if (lbp.missingRequired?.length)
      out.push(`Lineage: missing required ${lbp.missingRequired.map((c: { baseName: string }) => c.baseName).join(", ")}`);
  }
  for (const n of report.prereqs?.notes || []) {
    out.push(`Note (${n.item}): ${n.text}`);
  }
  return out;
}
