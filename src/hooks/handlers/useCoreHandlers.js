import { useCallback } from "react";
import { getClasses } from "../../engine/resolver.js";
import { reconcileStartingChoices, rebuildStartingSkills } from "../../engine/starting-choices.js";
import { powerPickerSpec } from "../usePickers.js";
import * as reducers from "../../engine/reducers.js";

const SLOT_FIELD = {
  utility: "utilityPowers",
  basic: "basicPowers",
  advanced: "advancedPowers",
  veteran: "veteranPowers",
  cantrips: "cantrips",
  spellsKnown: "noviceSpells",
};

export function useCoreHandlers({ character, setCharacter, setPicking, setView }) {
  const handleSetChoice = useCallback(
    (powerId, option) => {
      setCharacter((c) => reducers.setChoice(c, powerId, option));
    },
    [setCharacter],
  );

  // Set the parameter of an owned row (field + index) to a raw value. Param is a
  // FIELD — no old/new name, no id-string rebuild. `displayName` is the row's new
  // display form, only so the open detail pane stays pointed at it.
  const handleUpdateParameter = useCallback(
    (field, index, value, displayName) => {
      setCharacter((c) => reducers.setParameter(c, field, index, value));
      setView((v) => (v ? { ...v, item: displayName } : null));
    },
    [setCharacter, setView],
  );

  const setSlotPick = useCallback(
    (slot, flatIndex, powerName, fieldOverride) => {
      const field = fieldOverride || SLOT_FIELD[slot.category];
      setCharacter((c) => reducers.setSlotPick(c, field, flatIndex, powerName, slot.cls));
      setPicking(null);
    },
    [setCharacter, setPicking],
  );

  const handleOpenSlot = useCallback(
    (slot, flatIndex, clear = false, fieldHint) => {
      const field = fieldHint || SLOT_FIELD[slot.category];
      if (clear) {
        setCharacter((c) => reducers.clearSlot(c, field, flatIndex));
        return;
      }
      setPicking(
        powerPickerSpec(
          { ...slot, onChoose: (name, fieldOverride) => setSlotPick(slot, flatIndex, name, fieldOverride) },
          character,
        ),
      );
    },
    [character, setSlotPick, setCharacter, setPicking],
  );

  const handleAddEntity = useCallback(
    (field, name) => {
      setCharacter((c) => reducers.addEntity(c, field, name));
      setPicking(null);
    },
    [setCharacter, setPicking],
  );

  const handleRemoveEntity = useCallback(
    (field, index) => {
      setCharacter((c) => reducers.removeEntity(c, field, index));
    },
    [setCharacter],
  );

  const handleSetRank = useCallback(
    (field, index, nextRank) => {
      setCharacter((c) => reducers.setRank(c, field, index, nextRank));
    },
    [setCharacter],
  );

  const handleSetSpecialty = useCallback(
    (choiceId, optionLabel) => {
      setCharacter((c) => {
        const primary = getClasses(c)[0]?.name;
        if (!primary) return c;
        const base =
          c.startingChoices && Object.keys(c.startingChoices).length
            ? c.startingChoices
            : reconcileStartingChoices(c, primary);
        const nextChoices = { ...base, [choiceId]: optionLabel };
        return rebuildStartingSkills(c, primary, nextChoices);
      });
    },
    [setCharacter],
  );

  const handleSetGrantedSelection = useCallback(
    (selectionId, value) => {
      setCharacter((c) => reducers.setGrantedSelection(c, selectionId, value));
    },
    [setCharacter],
  );

  const handleSetAgileLearnerTrade = useCallback(
    (cls, delta) => {
      setCharacter((c) => reducers.setAgileLearnerTrade(c, cls, delta));
    },
    [setCharacter],
  );

  return {
    handleSetChoice,
    handleUpdateParameter,
    handleOpenSlot,
    handleAddEntity,
    handleRemoveEntity,
    handleSetRank,
    handleSetSpecialty,
    handleSetGrantedSelection,
    handleSetAgileLearnerTrade,
  };
}
