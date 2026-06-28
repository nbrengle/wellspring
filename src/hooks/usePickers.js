import { useCallback } from "react";
import { getClasses, bareSkill, cleanItemName } from "../engine/resolver.js";
import { eligiblePowers, CLASS_POWER_SLOTS, CLASSES, ALL_SKILLS, ALL_PERKS, ALL_FLAWS, UNLIMITED_SKILLS } from "../engine/data.js";
import { getMaxRanks } from "../engine/validate.js";

const SLOT_FIELD = {
  utility: "utilityPowers",
  basic: "basicPowers",
  advanced: "advancedPowers",
  veteran: "veteranPowers",
  cantrips: "cantrips",
  spellsKnown: "noviceSpells",
};

export function powerPickerSpec(slot, character) {
  const { category, label, cls } = slot;
  const field = SLOT_FIELD[category];
  const candidates = eligiblePowers(cls, category);
  const fieldFor = (name) => {
    if (category !== "spellsKnown") return field;
    const c = candidates.find((x) => x.name === name);
    return c?.tierList || "noviceSpells";
  };
  const takenFields = category === "spellsKnown"
    ? ["noviceSpells", "adeptSpells", "greaterSpells"] : [field];
  const taken = new Set();
  const counts = {};
  for (const f of takenFields) {
    for (const powerName of (character[f] || [])) {
      if (powerName) {
        counts[powerName] = (counts[powerName] || 0) + 1;
      }
    }
  }
  for (const name of Object.keys(counts)) {
    const maxR = getMaxRanks(name, field, character);
    if (counts[name] >= maxR) {
      taken.add(name);
    }
  }
  return {
    kind: "power", entityType: "powers",
    title: `Choose a ${label} power`,
    subtitle: `${candidates.length} options for ${cls}`,
    candidates,
    taken,
    onChoose: (name) => slot.onChoose(name, fieldFor(name)),
  };
}

export function entityPickerSpec({ kind, entityType, candidates, title, subtitle, taken, onChoose }) {
  return {
    kind, entityType, title,
    subtitle: subtitle || `${candidates.length} options`,
    candidates,
    taken, onChoose,
  };
}

export function usePickers({ character, report, setPicking, handleAddClass, handleAddEntity }) {
  const handleOpenClassPicker = useCallback(() => {
    const taken = new Set(getClasses(character).map((c) => c.name));
    const candidates = Object.keys(CLASS_POWER_SLOTS).map((name) => ({
      name, desc: CLASSES[name]?.description || "", cat: CLASSES[name]?.type || "Class",
    }));
    setPicking(entityPickerSpec({
      kind: "class", entityType: "classes", candidates,
      title: "Add a class", taken, onChoose: handleAddClass,
    }));
  }, [character, handleAddClass, setPicking]);

  const handleOpenAdd = useCallback((kind) => {
    if (kind === "domainPower") {
      const eligible = (report.devotion?.eligiblePowers || []).map((p) => ({
        name: p.name, desc: p.description || p.desc || "", cat: p.domain, cost: p.cost,
      }));
      setPicking(entityPickerSpec({
        kind: "domainPower", entityType: "powers", candidates: eligible, title: "Add a domain power",
        taken: new Set(character.domainPowers || []),
        onChoose: (name) => handleAddEntity("domainPowers", name),
      }));
      return;
    }
    if (kind === "classPower") {
      const eligible = getClasses(character).flatMap((c) =>
        (eligiblePowers(c.name, "classSkills") || []).map((p) => ({
          name: p.name, desc: p.description || p.desc || "", cat: c.name,
          cost: p.cost, refresh: p.refresh,
        })));
      setPicking(entityPickerSpec({
        kind: "classPower", entityType: "powers", candidates: eligible, title: "Add a class power",
        taken: new Set((report.owned?.classPowers || []).map((r) => r.name)),
        onChoose: (name) => handleAddEntity("classPowers", name),
      }));
      return;
    }
    const config = {
      skill: { field: "purchasedSkills", entityType: "skills", candidates: ALL_SKILLS, title: "Add a skill",
               taken: (report.owned?.skills || []).map((r) => r.name).filter(name => !UNLIMITED_SKILLS.has(bareSkill(cleanItemName(name)))) },
      perk:  { field: "purchasedPerks", entityType: "perks", candidates: ALL_PERKS, title: "Add a perk",
               taken: (report.owned?.perks || []).map((r) => r.name) },
      flaw:  { field: "flaws", entityType: "flaws", candidates: ALL_FLAWS, title: "Add a flaw",
               taken: (character.flaws || []) },
    }[kind];
    setPicking(entityPickerSpec({
      kind, entityType: config.entityType, candidates: config.candidates, title: config.title,
      taken: new Set(config.taken),
      onChoose: (name) => handleAddEntity(config.field, name),
    }));
  }, [character, handleAddEntity, report.devotion, report.owned, setPicking]);

  return { handleOpenClassPicker, handleOpenAdd };
}
