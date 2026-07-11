import type { Effect, Entity, CharacterState, ChoiceOption } from "./types.js";
import { REFS, lookupEntity, refsKey } from "./data.js";
import { getClasses } from "./resolver.js";
/**
 * Extractor plugins for the CharacterGraph.
 * Each extractor takes an entity and character context and returns an array of Effects.
 * This pattern keeps `graph.js` agnostic to specific game mechanics.
 */

function extractDiscounts(ent: Entity | null | undefined, character: CharacterState, id: string): Effect[] {
  const key = refsKey(id);
  if (REFS.discounts?.[key]) {
    return [{ type: "DISCOUNT_SOURCE", discount: REFS.discounts[key] }];
  }
  return [];
}

function extractGlobalBestows(ent: Entity | null | undefined, character: CharacterState, id: string): Effect[] {
  // choice — REFS.bestows lists ALL the options, so emitting them flat would wrongly
  // grant every option for free (The Learned One = "choose one of 8" at level-up).
  // Trust the PARSED chooseOne, not a description regex: a fixed grant can sit beside
  // an unrelated in-play "Choose one target…" sentence (Lessons from Scars) and must
  // still fire. So: skip only when a chooseOne structure exists.
  const isChoiceGated = !!(ent && "chooseOne" in ent && ent.chooseOne);

  const key = refsKey(id);
  if (REFS.bestows?.[key] && !isChoiceGated) {
    return [{ type: "BESTOW_SOURCE", bestows: REFS.bestows[key] }];
  }
  return [];
}

function extractWealth(ent: Entity | null | undefined, _character: CharacterState, _id: string): Effect[] {
  if (ent && "wealthIncome" in ent && ent.wealthIncome) {
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
  if (ent && "statMods" in ent && Array.isArray(ent.statMods)) {
    return ent.statMods.map((mod: { stat: string; amount?: number; text?: string }) => ({
      type: "STAT",
      stat: mod.stat,
      amount: mod.amount || 0,
    }));
  }
  return [];
}

// A build chooseOne option's bestowed skills — the entities the chosen option grants
// you for free (Way of the Blade → Weapon Specialization). Parser emits them under the
// option's `bestows` field.
const optBestows = (o: ChoiceOption | undefined) => o?.bestows || [];

function extractChooseOne(ent: Entity | null | undefined, character: CharacterState, _id: string): Effect[] {
  if (ent?.chooseOne?.kind === "build") {
    const chosen = character.choices?.[`powers:${ent.name}`];
    if (chosen) {
      // Find the option by direct text match, or by seeing if one of its bestowed skills matches the chosen string.
      const opt = ent.chooseOne.options.find((o: ChoiceOption) => o.text === chosen || optBestows(o).includes(chosen));
      const bestows = optBestows(opt);
      if (bestows.length > 0) {
        return [{ type: "BESTOW_SOURCE", bestows: bestows.map((s: string) => `skills:${s}`) }];
      }
    }
  }
  return [];
}

import { lineageChoiceSpec, powerSpellChoiceSpec } from "./choice-specs.js";

function extractLineageChoiceSpec(ent: Entity | null | undefined, character: CharacterState, _id: string): Effect[] {
  if (ent?.type === "advantage" || ent?.type === "challenge") {
    const spec = lineageChoiceSpec(ent);
    if (spec?.kind === "cantrip" || spec?.kind === "spell") {
      const chosen = character.advantageChoices?.[ent.name];
      if (chosen) {
        return [{ type: "BESTOW_SOURCE", bestows: [`powers:${chosen}`] }];
      }
    }
  }
  return [];
}

function extractPowerSpellChoiceSpec(ent: Entity | null | undefined, character: CharacterState, _id: string): Effect[] {
  const spec = powerSpellChoiceSpec(ent);
    if (spec && (spec.kind === "spell" || spec.kind === "power") && ent) {
      const chosen = character.choices?.[`powers:${ent.name}`];
    if (chosen) {
      return [{ type: "BESTOW_SOURCE", bestows: [`powers:${chosen}`] }];
    }
  }
  return [];
}

function extractStudiedFocus(ent: Entity | null | undefined, character: CharacterState, _id: string): Effect[] {
  if (ent?.name === "Studied Focus") {
    const pick1 = character.choices?.["powers:Studied Focus:1"];
    const pick2 = character.choices?.["powers:Studied Focus:2"];
    const effects: Effect[] = [];
    if (pick1) effects.push({ type: "BESTOW_SOURCE", bestows: [`powers:${pick1}`] });
    if (pick2) effects.push({ type: "BESTOW_SOURCE", bestows: [`powers:${pick2}`] });
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
    const clsDef = lookupEntity(`classes:${c.name}`);
    if (!clsDef) continue;

    const offers = ["innate", "utility", "basic", "advanced", "veteran", "classSkills", "rightHandPowers"].some(
      (cat) => {
        const field = (clsDef as unknown as Record<string, Entity[]>)[cat];
        return field?.some((p: Entity) => (p.id || p.name) === ent.name || p.id === id || p.name === ent.name);
      },
    );

    if (offers && c.level > maxRelevantLevel) {
      maxRelevantLevel = c.level;
    }
  }

  for (const ld of ent.levelDiscounts) {
    if (maxRelevantLevel >= ld.atLevel) {
      effects.push({
        type: "DISCOUNT_SOURCE",
        discount: {
          scope: { kind: "namedSkill", value: ld.skill as string },
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
  extractGlobalBestows,
  extractWealth,
  extractStatMods,
  extractChooseOne,
  extractLineageChoiceSpec,
  extractPowerSpellChoiceSpec,
  extractStudiedFocus,
];
