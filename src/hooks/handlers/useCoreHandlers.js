import { useCallback } from "react";
import { getClasses } from "../../engine/resolver.js";
import { reconcileStartingChoices, rebuildStartingSkills } from "../../engine/starting-choices.js";
import { powerPickerSpec } from "../usePickers.js";
import { UNLIMITED_SKILLS } from "../../engine/data.js";
import { DEVOTIONS, DOMAINS } from "../../engine/data.js";

const SLOT_FIELD = {
  utility: "utilityPowers",
  basic: "basicPowers",
  advanced: "advancedPowers",
  veteran: "veteranPowers",
  cantrips: "cantrips",
  spellsKnown: "noviceSpells",
};

export function useCoreHandlers({ character, setCharacter, setPicking, setView }) {
  const handleSetChoice = useCallback((powerId, option) => {
    setCharacter((c) => {
      const choices = { ...(c.choices || {}) };
      if (option == null || choices[powerId] === option) delete choices[powerId];
      else choices[powerId] = option;
      return { ...c, choices };
    });
  }, [setCharacter]);

  const handleUpdateParameter = useCallback((field, oldName, newName, index = null) => {
    setCharacter((c) => {
      const list = c[field] || [];
      const idx = index !== null && index >= 0 ? index : list.indexOf(oldName);
      if (idx < 0) return c;
      const next = [...list];
      next[idx] = newName;

      let nextChar = { ...c, [field]: next };

      let baseName = "";
      let paramVal = "";
      let paramMatch = newName.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
      if (!paramMatch) {
        const dashIdx = newName.indexOf(" - ");
        if (dashIdx > 0) {
          baseName = newName.slice(0, dashIdx).trim();
          paramVal = newName.slice(dashIdx + 3).trim();
        } else {
          baseName = newName.trim();
        }
      } else {
        baseName = paramMatch[1].trim();
        paramVal = paramMatch[2].trim();
      }

      if (baseName === "Worship") {
        if (!paramVal) {
          nextChar.devotion = null;
          nextChar.divineDomains = [];
          nextChar.domainPowers = [];
        } else {
          const dev = DEVOTIONS.find(
            (d) =>
              d.name.toLowerCase() === paramVal.toLowerCase() ||
              d.name.toLowerCase().startsWith(paramVal.toLowerCase()) ||
              paramVal.toLowerCase().startsWith(d.name.toLowerCase()),
          );
          const canonicalDevName = dev ? dev.name : paramVal;
          nextChar.devotion = canonicalDevName;
          if (dev) {
            nextChar.divineDomains = (c.divineDomains || []).filter((dn) => dev.domains.includes(dn));
            const remainingDomains = nextChar.divineDomains;
            nextChar.domainPowers = (c.domainPowers || []).filter((p) => {
              const basePower = p.replace(/\s*\(.+\)$/, "");
              return remainingDomains.some((dn) => {
                const dom = DOMAINS.find((x) => x.name === dn);
                return dom?.powers.some((x) => x.name === basePower || x.name === p);
              });
            });
          }
        }
      }

      return nextChar;
    });
    setView((v) => (v ? { ...v, item: newName } : null));
  }, [setCharacter, setView]);

  const setSlotPick = useCallback((slot, flatIndex, powerName, fieldOverride) => {
    const field = fieldOverride || SLOT_FIELD[slot.category];
    setCharacter((c) => {
      const next = [...(c[field] || [])];
      const pc = { ...(c.powerClass || {}) };
      pc[field] = [...(pc[field] || [])];
      const at = flatIndex >= 0 ? flatIndex : next.length;
      next[at] = powerName;
      pc[field][at] = slot.cls;
      return { ...c, [field]: next, powerClass: pc };
    });
    setPicking(null);
  }, [setCharacter, setPicking]);

  const handleOpenSlot = useCallback(
    (slot, flatIndex, clear = false, fieldHint) => {
      const field = fieldHint || SLOT_FIELD[slot.category];
      if (clear) {
        setCharacter((c) => {
          const next = [...(c[field] || [])];
          next.splice(flatIndex, 1);
          const pc = { ...(c.powerClass || {}) };
          if (pc[field]) {
            pc[field] = [...pc[field]];
            pc[field].splice(flatIndex, 1);
          }
          return { ...c, [field]: next, powerClass: pc };
        });
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

  const handleAddEntity = useCallback((field, name) => {
    setCharacter((c) => {
      const list = c[field] || [];
      if (list.includes(name) && !UNLIMITED_SKILLS.has(name)) return c;
      const next = [...list, name];
      const nextRanks = { ...(c.ranks || {}) };
      const rList = [...(nextRanks[field] || [])];
      while (rList.length < list.length) rList.push(1);
      rList.push(1);
      nextRanks[field] = rList;
      return { ...c, [field]: next, ranks: nextRanks };
    });
    setPicking(null);
  }, [setCharacter, setPicking]);

  const handleRemoveEntity = useCallback((field, index) => {
    setCharacter((c) => {
      const next = [...(c[field] || [])];
      next.splice(index, 1);
      const nextRanks = { ...(c.ranks || {}) };
      if (nextRanks[field]) {
        const rList = [...nextRanks[field]];
        rList.splice(index, 1);
        nextRanks[field] = rList;
      }
      return { ...c, [field]: next, ranks: nextRanks };
    });
  }, [setCharacter]);

  const handleSetRank = useCallback((field, index, nextRank) => {
    setCharacter((c) => {
      const nextRanks = { ...(c.ranks || {}) };
      const rList = [...(nextRanks[field] || [])];
      const listLen = c[field]?.length || 0;
      while (rList.length < listLen) rList.push(1);
      rList[index] = nextRank;
      nextRanks[field] = rList;
      return { ...c, ranks: nextRanks };
    });
  }, [setCharacter]);

  const handleSetSpecialty = useCallback((choiceId, optionLabel) => {
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
  }, [setCharacter]);

  const handleSetGrantedSelection = useCallback((selectionId, value) => {
    setCharacter((c) => ({
      ...c,
      grantedSelections: { ...(c.grantedSelections || {}), [selectionId]: value }
    }));
  }, [setCharacter]);

  return {
    handleSetChoice,
    handleUpdateParameter,
    handleOpenSlot,
    handleAddEntity,
    handleRemoveEntity,
    handleSetRank,
    handleSetSpecialty,
    handleSetGrantedSelection,
  };
}
