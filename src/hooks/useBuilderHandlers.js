import { useCallback } from "react";
import {
  CLASS_POWER_SLOTS,
  CLASSES,
} from "../engine/data.js";
import { EVENTS_TABLE } from "../engine/validate.js";
import { getClasses } from "../engine/resolver.js";
import { EMPTY_CHARACTER, applyClassStartingAbilities, loadArchetype } from "../engine/character-state.js";
import { entityPickerSpec } from "./usePickers.js";
import { usePickers } from "./usePickers.js";
import { useCoreHandlers } from "./handlers/useCoreHandlers.js";
import { useIdentityHandlers } from "./handlers/useIdentityHandlers.js";
import { useLineageHandlers } from "./handlers/useLineageHandlers.js";
import { useClassHandlers } from "./handlers/useClassHandlers.js";

export function useBuilderHandlers({
  character,
  report,
  setCharacter,
  setView,
  setChase,
  setPicking,
  setHistory,
  setLineageOpen: _setLineageOpen,
}) {

  const handlePickArchetype = useCallback((archetype) => {
    setCharacter(loadArchetype(archetype));
    setView(null);
    setChase(null);
    setHistory([]);
  }, [setCharacter, setView, setChase, setHistory]);

  const identityHandlers = useIdentityHandlers({ character, setCharacter, setPicking });

  const handleSetName = identityHandlers.handleSetName;
  const handlePickDevotion = identityHandlers.handlePickDevotion;
  const handleToggleDomain = identityHandlers.handleToggleDomain;
  const handleClearDevotion = identityHandlers.handleClearDevotion;
  const handleToggleBackstory = identityHandlers.handleToggleBackstory;

  const handleSetEvent = useCallback((eventNum) => {
    setCharacter((c) => {
      const next = { ...c, currentEvent: eventNum };
      const levelFloor = EVENTS_TABLE.find((e) => e.event === eventNum)?.level || 4;
      const classes = getClasses(next);
      if (classes.length === 1) {
        const primary = classes[0];
        if (primary.level < levelFloor) {
          const nextClasses = [{ name: primary.name, level: levelFloor }];
          let updated = { ...next, classes: nextClasses };
          updated = applyClassStartingAbilities(updated, primary.name, levelFloor);
          return updated;
        }
      }
      return next;
    });
  }, [setCharacter]);

  const handleSetExtraBP = useCallback((bp) => {
    setCharacter((c) => ({ ...c, extraMaxBP: bp }));
  }, [setCharacter]);

  // ─── LINEAGE ─────────────────────────────────────────────────────────────
  const lineageHandlers = useLineageHandlers({ setCharacter });
  const handleSetLineage = lineageHandlers.handleSetLineage;
  const handleSetSublineage = lineageHandlers.handleSetSublineage;
  const handleToggleLineageItem = lineageHandlers.handleToggleLineageItem;
  const handleSetLineageRep = lineageHandlers.handleSetLineageRep;
  const handleSetAdvantageChoice = lineageHandlers.handleSetAdvantageChoice;

  const handleStartBlank = useCallback(() => {
    const candidates = Object.keys(CLASS_POWER_SLOTS).map((name) => ({
      name,
      desc: CLASSES[name]?.description || "",
      cat: CLASSES[name]?.type || "Class",
    }));
    setPicking(
      entityPickerSpec({
        kind: "class",
        entityType: "classes",
        candidates,
        title: "Start blank — choose your class",
        taken: new Set(),
        onChoose: (name) => {
          const char = {
            ...EMPTY_CHARACTER,
            archetypeName: "Custom Build",
            classes: [{ name, level: 1 }],
          };
          setCharacter(applyClassStartingAbilities(char, name, 1));
          setView(null);
          setHistory([]);
          setPicking(null);
        },
      }),
    );
  }, [setCharacter, setView, setHistory, setPicking]);

  // Primary gesture: clicking an owned item → expand its detail INLINE under the row.
  // Re-clicking the same item closes it. Moving to a DIFFERENT row (or closing) means
  // you've moved on, so it also dismisses any open chase drawer.
  const handleInspect = useCallback(
    (item, field, resolveType, slot = null, index = null) => {
      setChase(null);
      setHistory([]);
      setView((cur) => {
        if (cur && cur.item === item && cur.field === field) return null; // toggle closed
        return {
          mode: "inspect",
          item,
          field,
          resolveType,
          archetypeName: character.archetypeName,
          category: slot?.category,
          index: index !== null ? index : slot?.index,
          choosable: !!slot,
        };
      });
    },
    [character.archetypeName, setChase, setHistory, setView],
  );

  // Chasing: following a concept link inside a detail body opens/continues the right
  // DRAWER with a back-stack. Never touches `view`, so the inline expand stays put.
  // Re-clicking the entity that's already at the drawer head closes it.
  const handleChase = useCallback(
    (item, field, resolveType, slot = null, index = null) => {
      setChase((cur) => {
        if (cur && cur.item === item && cur.field === field) {
          setHistory([]);
          return null;
        }
        if (cur) setHistory((h) => [...h, cur]);
        return {
          mode: "inspect",
          item,
          field,
          resolveType,
          archetypeName: character.archetypeName,
          category: slot?.category,
          index: index !== null ? index : slot?.index,
          choosable: !!slot,
        };
      });
    },
    [character.archetypeName, setChase, setHistory],
  );

  const coreHandlers = useCoreHandlers({ character, setCharacter, setPicking, setView });
  const handleSetChoice = coreHandlers.handleSetChoice;
  const handleUpdateParameter = coreHandlers.handleUpdateParameter;
  const handleOpenSlot = coreHandlers.handleOpenSlot;
  const handleAddEntity = coreHandlers.handleAddEntity;
  const handleRemoveEntity = coreHandlers.handleRemoveEntity;
  const handleSetRank = coreHandlers.handleSetRank;
  const handleSetSpecialty = coreHandlers.handleSetSpecialty;
  const handleSetGrantedSelection = coreHandlers.handleSetGrantedSelection;
  const handleSetAgileLearnerTrade = coreHandlers.handleSetAgileLearnerTrade;

  const classHandlers = useClassHandlers({ setCharacter });
  const handleLevelChange = classHandlers.handleLevelChange;
  const handleSetClassLevel = classHandlers.handleSetClassLevel;
  const _handleAddClass = classHandlers.handleAddClass;
  const _handleRemoveClass = classHandlers.handleRemoveClass;

  const handleAddClass = useCallback((name) => {
    _handleAddClass(name);
    setPicking(null);
  }, [_handleAddClass, setPicking]);
  const handleRemoveClass = useCallback(
    (name) => _handleRemoveClass(name, {
      utility: "utilityPowers",
      basic: "basicPowers",
      advanced: "advancedPowers",
      veteran: "veteranPowers",
      cantrips: "cantrips",
      spellsKnown: "noviceSpells",
    }),
    [_handleRemoveClass]
  );

  const { handleOpenClassPicker, handleOpenAdd } = usePickers({
    character,
    report,
    setPicking,
    handleAddClass,
    handleAddEntity,
  });

  // Back/close operate on the CHASE drawer (the inline expand is closed by re-click).
  const handleBack = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) {
        setChase(null);
        return h;
      }
      const prev = h[h.length - 1];
      setChase(prev);
      return h.slice(0, -1);
    });
  }, [setHistory, setChase]);

  const handleClose = useCallback(() => {
    setChase(null);
    setHistory([]);
  }, [setChase, setHistory]);

  const handleRestart = useCallback(() => {
    if (window.confirm("Discard this character and start over?")) {
      setCharacter(EMPTY_CHARACTER);
      setView(null);
      setChase(null);
      setHistory([]);
    }
  }, [setCharacter, setView, setChase, setHistory]);

  const handleChangeArchetype = useCallback(() => {
    if (window.confirm("Select a different archetype? Any changes you've made to this character will be lost.")) {
      setCharacter(EMPTY_CHARACTER);
      setView(null);
      setChase(null);
      setHistory([]);
    }
  }, [setCharacter, setView, setChase, setHistory]);

  const handleClickIdentityField = useCallback(
    (field) => {
      // Identity-rail items (class, devotion) have no inline-detail anchor in the
      // rail, so handleInspect's inline `view` would never render. Promote to the
      // chase DRAWER (the right DetailPane) instead — that's where these resolve and
      // display. Map the field name to the registry's entity type (plural) so the
      // lookup hits: "devotion" → "devotions", "class" → "classes".
      const RESOLVE_TYPE = { devotion: "devotions", class: "classes" };
      const resolveType = RESOLVE_TYPE[field] || field;
      const item = field === "class" ? getClasses(character)[0]?.name : character[field];
      if (item) handleChase(item, null, resolveType);
    },
    [character, handleChase],
  );


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
    handleSetGrantedSelection,
    handleSetAgileLearnerTrade,
    handleStartBlank,
    handleInspect,
    handleChase,
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
