const fs = require('fs');

const code = fs.readFileSync('src/Builder.jsx', 'utf-8');

const handlersStart = code.indexOf('  const handlePickArchetype = useCallback(');
const handlersEnd = code.indexOf('  // ─── CONTEXT BUNDLES ──────────────────────────────────────────────────────');

const handlersCode = code.slice(handlersStart, handlersEnd);

const newFileContent = `import { useCallback } from "react";
import {
  DEVOTIONS,
  DOMAINS,
  CLASS_POWER_SLOTS,
  CLASSES,
  UNLIMITED_SKILLS,
  LEVEL_TABLE,
  LINEAGES,
} from "../engine/data.js";
import { MAX_DOMAINS, EVENTS_TABLE } from "../engine/validate.js";
import { getClasses } from "../engine/resolver.js";
import {
  hasStartingChoices,
  reconcileStartingChoices,
  rebuildStartingSkills,
} from "../engine/starting-choices.js";
import { EMPTY_CHARACTER, applyClassStartingAbilities, loadArchetype } from "../engine/character-state.js";
import { powerPickerSpec, entityPickerSpec } from "./usePickers.js";
import { cleanChallengeName, requiredChallengeNames } from "../components/lineage/lineage-helpers.js";
import { formatParameterizedName } from "../components/DetailPane.jsx";
import { usePickers } from "./usePickers.js";

const SLOT_FIELD = {
  utility: "utilityPowers",
  basic: "basicPowers",
  advanced: "advancedPowers",
  veteran: "veteranPowers",
  cantrips: "cantrips",
  spellsKnown: "noviceSpells",
};

const MAX_LEVEL = LEVEL_TABLE.length ? Math.max(...LEVEL_TABLE.map((l) => l.level)) : 15;
const MIN_LEVEL = 1;

export function useBuilderHandlers({
  character,
  report,
  setCharacter,
  setView,
  setPicking,
  setHistory,
  setLineageOpen,
}) {
  const subKey = (n) => (n || "general").toLowerCase().replace(/[^a-z0-9]+/g, "-");

${handlersCode}
  return {
    handlePickArchetype,
    handleSetName,
    handlePickDevotion,
    handleToggleDomain,
    handleClearDevotion,
    handleToggleBackstory,
    handleSetEvent,
    handleSetExtraBP,
    handleSetLineage,
    handleSetSublineage,
    handleSetChoice,
    handleToggleLineageItem,
    handleSetLineageRep,
    handleSetAdvantageChoice,
    handleStartBlank,
    handleInspect,
    handleUpdateParameter,
    handleOpenSlot,
    handleAddEntity,
    handleRemoveEntity,
    handleSetRank,
    handleSetSpecialty,
    handleLevelChange,
    handleSetClassLevel,
    handleAddClass,
    handleRemoveClass,
    handleOpenClassPicker,
    handleOpenAdd,
    handleBack,
    handleClose,
    handleRestart,
    handleChangeArchetype,
    handleClickIdentityField,
  };
}
`;

fs.writeFileSync('src/hooks/useBuilderHandlers.js', newFileContent);
console.log("Extracted handlers to src/hooks/useBuilderHandlers.js");
