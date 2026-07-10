import type { Effect, Entity, CharacterState, ChoiceOption, Class } from "./types.js";
import { REFS, lookupEntity } from "./data.js";
import { getClasses } from "./resolver.js";
/**
 * Extractor plugins for the CharacterGraph.
 * Each extractor takes an entity and character context and returns an array of Effects.
 * This pattern keeps `graph.js` agnostic to specific game mechanics.
 */

function extractDiscounts(ent: Entity | null | undefined, character: CharacterState, id: string): Effect[] {
  if (REFS.discounts?.[id]) {
    return [{ type: "DISCOUNT_SOURCE", discount: REFS.discounts[id] }];
  }
  return [];
}

function extractGlobalGrants(ent: Entity | null | undefined, character: CharacterState, id: string): Effect[] {
  // choice — REFS.grants lists ALL the options, so emitting them flat would wrongly
  // grant every option for free (The Learned One = "choose one of 8" at level-up).
  // Trust the PARSED chooseOne, not a description regex: a fixed grant can sit beside
  // an unrelated in-play "Choose one target…" sentence (Lessons from Scars) and must
  // still fire. So: skip only when a chooseOne structure exists.
  const isChoiceGated = !!ent?.chooseOne;

  if (REFS.grants?.[id] && !isChoiceGated) {
    return [{ type: "GRANT_SOURCE", grants: REFS.grants[id] }];
  }
  return [];
}

function extractWealth(ent: Entity | null | undefined, _character: CharacterState, _id: string): Effect[] {
  if (ent?.wealthIncome) {
    return [
      {
        type: "WEALTH",
        amount: ent.wealthIncome.n,
        note:
          ent.wealthIncome.kind === "manse"
            ? "or resources"
            : ent.wealthIncome.kind === "firstEvent"
              ? "one-time, first event"
              : undefined,
      },
    ];
  }
  return [];
}

function extractStatMods(ent: Entity | null | undefined, _character: CharacterState, _id: string): Effect[] {
  if (ent?.statMods) {
    return ent.statMods.map((mod) => ({ type: "STAT" as const, stat: mod.stat, amount: typeof mod.amount === "string" ? parseInt(mod.amount, 10) || 0 : mod.amount }));
  }
  return [];
}

// A build chooseOne option's granted skills. The parser emits this under `grants`
// for most powers but `grantsSkills` for a few (Way of the Blade) — read either so a
// field-name drift never silently drops the grant (which left the chosen spec NOT
// free). Normalizing the parser too, but stay tolerant here.
const optGrants = (o: import("./types.js").ChoiceOption | undefined) => o?.grants || o?.grantsSkills || [];

function extractChooseOne(ent: Entity | null | undefined, character: CharacterState, _id: string): Effect[] {
  if (ent?.chooseOne?.kind === "build") {
    const chosen = character.choices?.[`powers:${ent.name}`];
    if (chosen) {
      // Find the option by direct text match, or by seeing if one of its granted skills matches the chosen string.
      const opt = ent.chooseOne.options.find((o: import("./types.js").ChoiceOption) => o.text === chosen || optGrants(o).includes(chosen));
      const grants = optGrants(opt);
      if (grants.length > 0) {
        return [{ type: "GRANT_SOURCE", grants: grants.map((s) => `skills:${s}`) }];
      }
    }
  }
  return [];
}

import { lineageChoiceSpec, powerSpellChoiceSpec } from "./choice-specs.js";

function extractLineageChoiceSpec(ent: Entity | null | undefined, character: CharacterState, _id: string): Effect[] {
  if (!ent) return [];
  if (ent.type === "advantage" || ent.type === "challenge") {
    const spec = lineageChoiceSpec(ent);
    if (spec?.kind === "cantrip" || spec?.kind === "spell") {
      const chosen = character.advantageChoices?.[ent.name];
      if (chosen) {
        return [{ type: "GRANT_SOURCE", grants: [`powers:${chosen}`] }];
      }
    }
  }
  return [];
}

function extractPowerSpellChoiceSpec(ent: Entity | null | undefined, character: CharacterState, _id: string): Effect[] {
  if (!ent) return [];
  const spec = powerSpellChoiceSpec(ent);
  if (spec && (spec.kind === "spell" || spec.kind === "power")) {
    const chosen = character.choices?.[`powers:${ent.name}`];
    if (chosen) {
      return [{ type: "GRANT_SOURCE", grants: [`powers:${chosen}`] }];
    }
  }
  return [];
}

function extractStudiedFocus(ent: Entity | null | undefined, character: CharacterState, _id: string): Effect[] {
  if (ent?.name === "Studied Focus") {
    const pick1 = character.choices?.["powers:Studied Focus:1"];
    const pick2 = character.choices?.["powers:Studied Focus:2"];
    const effects: Effect[] = [];
    if (pick1) effects.push({ type: "GRANT_SOURCE", grants: [`powers:${pick1}`] });
    if (pick2) effects.push({ type: "GRANT_SOURCE", grants: [`powers:${pick2}`] });
    return effects;
  }
  return [];
}

function extractLevelDiscounts(ent: Entity | null | undefined, character: CharacterState, id: string): Effect[] {
  if (!ent?.levelDiscounts || ent.levelDiscounts.length === 0) return [];

  const charClasses = getClasses(character);
  const effects: Effect[] = [];

  let maxRelevantLevel = 0;
  for (const c of charClasses) {
    const clsDef = lookupEntity(`classes:${c.name}`) as Class | null;
    if (!clsDef) continue;

    const offers = [
      clsDef.innate,
      clsDef.utility,
      clsDef.basic,
      clsDef.advanced,
      clsDef.veteran,
      clsDef.classSkills,
      clsDef.rightHandPowers,
    ].some((list) => list?.some((p) => (p.id || p.name) === ent?.name || p.id === id || p.name === ent?.name));

    if (offers && c.level > maxRelevantLevel) {
      maxRelevantLevel = c.level;
    }
  }

  for (const ld of ent.levelDiscounts) {
    if (maxRelevantLevel >= ld.atLevel) {
      effects.push({
        type: "DISCOUNT_SOURCE",
        discount: {
          scope: { kind: "namedSkill", value: ld.skill },
          amount: ld.amount,
          min: 0,
          cap: null,
        },
      });
    }
  }
  return effects;
}

export const EFFECT_EXTRACTORS = [
  extractDiscounts,
  extractLevelDiscounts,
  extractGlobalGrants,
  extractWealth,
  extractStatMods,
  extractChooseOne,
  extractLineageChoiceSpec,
  extractPowerSpellChoiceSpec,
  extractStudiedFocus,
];
