import type { Effect, Entity, CharacterState, ChoiceOption } from "./types.js";
import { REFS, lookupEntity, refsKey } from "./data.js";
import { getClasses } from "./resolver.js";
/**
 * Extractor plugins for the CharacterGraph.
 * Each extractor takes an entity and character context and returns an array of Effects.
 * This pattern keeps `graph.js` agnostic to specific game mechanics.
 */

function extractDiscounts(ent: Entity | null, character: CharacterState, id: string): Effect[] {
  const key = refsKey(id);
  if (REFS.discounts?.[key]) {
    return [{ type: "DISCOUNT_SOURCE", discount: REFS.discounts[key] }];
  }
  return [];
}

function extractGlobalBestows(ent: Entity | null, _character: CharacterState, _id: string): Effect[] {
  // The entity's `bestows` (EntityRef[]) lists ALL the grant options, so emitting them
  // flat would wrongly grant every option for free (The Learned One = "choose one of 8"
  // at level-up). Trust the PARSED chooseOne, not a description regex: a fixed grant can
  // sit beside an unrelated in-play "Choose one target…" sentence (Lessons from Scars)
  // and must still fire. So: skip only when a chooseOne structure exists.
  const isChoiceGated = !!(ent && "chooseOne" in ent && ent.chooseOne);

  if (ent?.bestows?.length && !isChoiceGated) {
    return [{ type: "BESTOW_SOURCE", bestows: ent.bestows }];
  }
  return [];
}

function extractWealth(ent: Entity | null, _character: CharacterState, _id: string): Effect[] {
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

function extractStatMods(ent: Entity | null, _character: CharacterState, _id: string): Effect[] {
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

function extractChooseOne(ent: Entity | null, character: CharacterState, _id: string): Effect[] {
  if (ent?.chooseOne?.kind === "build") {
    const chosen = character.choices?.[`powers:${ent.name}`];
    if (chosen) {
      // Find the option by direct text match, or by seeing if one of its bestowed skills matches the chosen string.
      const opt = ent.chooseOne.options.find((o: ChoiceOption) => o.text === chosen || optBestows(o).includes(chosen));
      const bestows = optBestows(opt);
      if (bestows.length > 0) {
        return [{ type: "BESTOW_SOURCE", bestows: bestows.map((s: string) => ({ name: s, type: "skill" })) }];
      }
    }
  }
  return [];
}

import { lineageChoiceSpec, powerSpellChoiceSpec } from "./choice-specs.js";

function extractLineageChoiceSpec(ent: Entity | null, character: CharacterState, _id: string): Effect[] {
  if (ent?.type === "advantage" || ent?.type === "challenge") {
    const spec = lineageChoiceSpec(ent);
    if (spec?.kind === "cantrip" || spec?.kind === "spell") {
      const chosen = character.advantageChoices?.[ent.name];
      if (chosen) {
        return [{ type: "BESTOW_SOURCE", bestows: [{ name: chosen, type: "power" }] }];
      }
    }
  }
  return [];
}

function extractPowerSpellChoiceSpec(ent: Entity | null, character: CharacterState, _id: string): Effect[] {
  const spec = powerSpellChoiceSpec(ent);
  if (spec && (spec.kind === "spell" || spec.kind === "power") && ent) {
    const chosen = character.choices?.[`powers:${ent.name}`];
    if (chosen) {
      return [{ type: "BESTOW_SOURCE", bestows: [{ name: chosen, type: "power" }] }];
    }
  }
  return [];
}

function extractStudiedFocus(ent: Entity | null, character: CharacterState, _id: string): Effect[] {
  if (ent?.name === "Studied Focus") {
    const pick1 = character.choices?.["powers:Studied Focus:1"];
    const pick2 = character.choices?.["powers:Studied Focus:2"];
    const effects: Effect[] = [];
    if (pick1) effects.push({ type: "BESTOW_SOURCE", bestows: [{ name: pick1, type: "power" }] });
    if (pick2) effects.push({ type: "BESTOW_SOURCE", bestows: [{ name: pick2, type: "power" }] });
    return effects;
  }
  return [];
}

// Tax Evasion (Socialite Utility power): a cross-entity wealth rule. Per the rules text,
// "3 Wealth for every rank of Profession, and 2 Wealth for Manse and Income." This counts
// the character's OWNED Profession skills + the Manse/Income perks, so it's a whole-character
// aggregate keyed off the character buckets (not the resolved graph, which isn't built yet
// when extractors run). Profession/Manse/Income are never bestowed or discounted, so the
// bucket count equals the resolved-node count. Emits a single WEALTH effect on the Tax
// Evasion node itself — replacing the old synthetic "Tax Evasion Bonus" node in resolve.ts.
function extractTaxEvasion(ent: Entity | null, character: CharacterState, _id: string): Effect[] {
  if (ent?.name !== "Tax Evasion") return [];
  const profRanks = (character.skills || []).filter((s) =>
    /^\bProfession\b/i.test(s.entityId.replace(/^skills:/i, "")),
  ).length;
  const ownsPerk = (name: string) => (character.perks || []).some((p) => p.entityId.replace(/^perks:/i, "") === name);
  let bonus = profRanks * 3;
  if (ownsPerk("Manse")) bonus += 2;
  if (ownsPerk("Income")) bonus += 2;
  return bonus > 0 ? [{ type: "WEALTH", amount: bonus, note: "from Profession/Manse/Income" }] : [];
}

function extractLevelDiscounts(ent: Entity | null, character: CharacterState, id: string): Effect[] {
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
  extractTaxEvasion,
];
