// Builder — single-page character creator. State lives in the URL.
// Decomposed into modular subcomponents in src/components/ directory.

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  DEVOTIONS,
  DOMAINS,
  ALL_SKILLS,
  ALL_PERKS,
  ALL_FLAWS,
  CLASS_POWER_SLOTS,
  CLASSES,
  META,
  UNLIMITED_SKILLS,
  LEVEL_TABLE,
  LINEAGES,
  eligiblePowers,
} from "./engine/data.js";
import {
  validate,
  characterLevel,
  pickClass,
  MAX_DOMAINS,
  EVENTS_TABLE,
  getMaxRanks,
  validityReasons,
  subKey,
} from "./engine/validate.js";
import { bareSkill, cleanItemName, getClasses } from "./engine/resolver.js";
import {
  STARTING_CHOICES_CONFIG,
  hasStartingChoices,
  reconcileStartingChoices,
  rebuildStartingSkills,
} from "./engine/starting-choices.js";
import { EMPTY_CHARACTER, applyClassStartingAbilities, loadArchetype } from "./engine/character-state.js";
import { useCharacterState } from "./hooks/useCharacterState.js";
import RulesExplorer from "./RulesExplorer.jsx";
import RecipeChecker from "./RecipeChecker.jsx";
import { usePickers, powerPickerSpec, entityPickerSpec } from "./hooks/usePickers.js";
import "./Builder.css";

// Components
import LineagePanel, { cleanChallengeName } from "./components/LineagePanel.jsx";
import { requiredChallengeNames } from "./components/lineage/lineage-helpers.js";
import ExportImportPanel from "./components/ExportImportPanel.jsx";
import PickerOverlay from "./components/PickerOverlay.jsx";
import DetailPane, { formatParameterizedName } from "./components/DetailPane.jsx";
import BuildSheet, { IdentityRail } from "./components/BuildSheet.jsx";
import { BuilderProvider } from "./components/builder-context.jsx";

// ─── SLOT MODEL ──────────────────────────────────────────────────────────────
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
const LEVEL_CAP = 10;

// ─── ROOT COMPONENT ─────────────────────────────────────────────────────────

export default function Builder() {
  const [mode, setMode] = useState("builder"); // "builder" | "explorer" | "recipes"
  const { character, setCharacter, report } = useCharacterState();
  const [view, setView] = useState(null);
  const [picking, setPicking] = useState(null); // null | picker spec
  const [exportOpen, setExportOpen] = useState(false);
  const [history, setHistory] = useState([]);

  const handlePickArchetype = useCallback((archetype) => {
    setCharacter(loadArchetype(archetype));
    setView(null);
    setHistory([]);
  }, []);

  const handleSetName = useCallback((name) => {
    setCharacter((c) => ({ ...c, name }));
  }, []);

  // ─── DEVOTION ────────────────────────────────────────────────────────────
  const handlePickDevotion = useCallback(() => {
    const candidates = DEVOTIONS.map((d) => ({
      name: d.name,
      desc: d.lore || (d.tenets || []).join(" "),
      cat: d.locality || "Devotion",
    }));
    setPicking(
      entityPickerSpec({
        kind: "devotion",
        entityType: "devotions",
        candidates,
        title: "Choose a devotion",
        taken: new Set(character.devotion ? [character.devotion] : []),
        onChoose: (name) => {
          const dev = DEVOTIONS.find((d) => d.name === name);
          setCharacter((c) => {
            const updateWorship = (list) => {
              return list.map((s) => {
                if (/^worship\b/i.test(s)) {
                  return formatParameterizedName("Worship", name, s);
                }
                return s;
              });
            };
            return {
              ...c,
              devotion: name,
              divineDomains: (c.divineDomains || []).filter((dn) => dev?.domains.includes(dn)),
              startingSkills: updateWorship(c.startingSkills || []),
              purchasedSkills: updateWorship(c.purchasedSkills || []),
            };
          });
          setPicking(null);
        },
      }),
    );
  }, [character.devotion]);

  const handleToggleDomain = useCallback((domain) => {
    setCharacter((c) => {
      const cur = c.divineDomains || [];
      if (cur.includes(domain)) {
        const nextDomains = cur.filter((d) => d !== domain);
        const domPowers = (DOMAINS.find((x) => x.name === domain)?.powers || []).map((p) => p.name);
        return {
          ...c,
          divineDomains: nextDomains,
          domainPowers: (c.domainPowers || []).filter(
            (p) => !domPowers.includes(p.replace(/\s*\(.+\)$/, "")) && !domPowers.includes(p),
          ),
        };
      }
      if (cur.length >= MAX_DOMAINS) return c;
      return { ...c, divineDomains: [...cur, domain] };
    });
  }, []);

  const handleClearDevotion = useCallback(() => {
    setCharacter((c) => {
      const clearWorship = (list) => {
        return list.map((s) => {
          if (/^worship\b/i.test(s)) {
            return "Worship";
          }
          return s;
        });
      };
      return {
        ...c,
        devotion: null,
        divineDomains: [],
        domainPowers: [],
        startingSkills: clearWorship(c.startingSkills || []),
        purchasedSkills: clearWorship(c.purchasedSkills || []),
      };
    });
  }, []);

  const handleToggleBackstory = useCallback(() => {
    setCharacter((c) => ({ ...c, backstoryApproved: !c.backstoryApproved }));
  }, []);

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
  }, []);

  const handleSetExtraBP = useCallback((bp) => {
    setCharacter((c) => ({ ...c, extraMaxBP: bp }));
  }, []);

  // ─── LINEAGE ─────────────────────────────────────────────────────────────
  const [lineageOpen, setLineageOpen] = useState(false);

  const handleSetLineage = useCallback((name) => {
    setCharacter((c) =>
      name === c.lineage
        ? c
        : // Seed the General required challenges so the player never hunts for the
          // mandatory ones (sublineage-scoped requireds are added when their sublineage
          // is picked, in handleSetSublineage).
          {
            ...c,
            lineage: name,
            sublineage: null,
            lineageChallenges: requiredChallengeNames(LINEAGES[name], null),
            lineageAdvantages: [],
          },
    );
  }, []);

  // Pick / switch / clear a sublineage. Free-swap, no lock-in: clearing or switching
  // DROPS the old sublineage's taken items (so no orphaned picks linger), then
  // auto-adds the new sublineage's required challenges so they behave like General
  // requireds. Toggling the current one off clears to "no sublineage".
  const handleSetSublineage = useCallback((sub) => {
    setCharacter((c) => {
      const next = c.sublineage === sub ? null : sub;
      const lin = LINEAGES[c.lineage];
      const nextKey = next ? subKey(next) : null;
      // Keep General items + items of the new sublineage; drop other-sublineage items.
      const keep = (names, list) =>
        (names || []).filter((n) => {
          const item = (list || []).find((x) => cleanChallengeName(n) === cleanChallengeName(x.baseName || x.name));
          const k = item ? subKey(item.sublineage) : null;
          return !k || k === "general" || k === nextKey;
        });
      const challenges = keep(c.lineageChallenges, lin?.challenges);
      const advantages = keep(c.lineageAdvantages, lin?.advantages);
      // Auto-add the new sublineage's required challenges (merged, no duplicates).
      for (const r of requiredChallengeNames(lin, next)) {
        if (!challenges.some((x) => cleanChallengeName(x) === cleanChallengeName(r))) challenges.push(r);
      }
      return { ...c, sublineage: next, lineageChallenges: challenges, lineageAdvantages: advantages };
    });
  }, []);

  const handleSetChoice = useCallback((powerId, option) => {
    setCharacter((c) => {
      const choices = { ...(c.choices || {}) };
      if (option == null || choices[powerId] === option) delete choices[powerId];
      else choices[powerId] = option;
      return { ...c, choices };
    });
  }, []);

  const handleToggleLineageItem = useCallback((field, name) => {
    setCharacter((c) => {
      const cur = c[field] || [];
      const clean = cleanChallengeName(name);
      const exists = cur.some((x) => cleanChallengeName(x) === clean);
      if (exists) {
        return { ...c, [field]: cur.filter((x) => cleanChallengeName(x) !== clean) };
      } else {
        return { ...c, [field]: [...cur, name] };
      }
    });
  }, []);

  // Set/replace the [Repped] parameter on a Lost Life-style challenge already taken
  // (e.g. base "Lost Life" → stored "Lost Life (Runic Lattice)"). Keyed by the base
  // name so changing the rep replaces in place rather than adding a duplicate.
  const handleSetLineageRep = useCallback((field, baseName, rep) => {
    setCharacter((c) => {
      const cur = c[field] || [];
      const next = rep && rep.trim() ? `${baseName} (${rep.trim()})` : baseName;
      const i = cur.findIndex((x) => cleanChallengeName(x) === cleanChallengeName(baseName));
      const out = [...cur];
      if (i === -1) out.push(next);
      else out[i] = next;
      return { ...c, [field]: out };
    });
  }, []);

  // Record a per-advantage choice (e.g. the free Cantrip an Aewen's "Divine Magic"
  // advantage grants). Stored under character.advantageChoices[<advantage>] and
  // consumed by the engine (graph.js → GRANT_SOURCE, slots.js → granted cantrip).
  const handleSetAdvantageChoice = useCallback((advantage, value) => {
    setCharacter((c) => ({
      ...c,
      advantageChoices: { ...(c.advantageChoices || {}), [advantage]: value },
    }));
  }, []);

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
  }, []);

  const handleInspect = useCallback(
    (item, field, resolveType, slot = null, index = null) => {
      setView((cur) => {
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
    [character.archetypeName],
  );

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
  }, []);

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
  }, []);

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
    [character, setSlotPick],
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
  }, []);

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
  }, []);

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
  }, []);

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
  }, []);

  const handleLevelChange = useCallback((next) => {
    const level = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, next));
    setCharacter((c) => {
      if (!c.classLevels) return c;
      return { ...c, classLevels: c.classLevels.replace(/\d+/, String(level)) };
    });
  }, []);

  const toClassesForm = (c) => {
    if (Array.isArray(c.classes) && c.classes.length) return c;
    const classes = getClasses(c);
    return { ...c, classes, classLevels: undefined };
  };

  const handleSetClassLevel = useCallback((className, level) => {
    setCharacter((c0) => {
      const c = toClassesForm(c0);
      const others = c.classes.filter((x) => x.name !== className).reduce((n, x) => n + x.level, 0);
      const lvl = Math.max(1, Math.min(MAX_LEVEL - others, level));
      const nextClasses = c.classes.map((x) => (x.name === className ? { ...x, level: lvl } : x));
      let updated = { ...c, classes: nextClasses };
      const primary = nextClasses[0];
      if (primary) {
        updated = applyClassStartingAbilities(updated, primary.name, primary.level);
      }
      return updated;
    });
  }, []);

  const handleAddClass = useCallback((className) => {
    setCharacter((c0) => {
      const c = toClassesForm(c0);
      if (c.classes.some((x) => x.name === className)) return c0;
      const nextClasses = [...c.classes, { name: className, level: 1 }];
      let updated = { ...c, classes: nextClasses };
      const primary = nextClasses[0];
      if (primary) {
        updated = applyClassStartingAbilities(updated, primary.name, primary.level);
      }
      updated = applyClassStartingAbilities(updated, className, 1);
      return updated;
    });
    setPicking(null);
  }, []);

  const handleRemoveClass = useCallback((className) => {
    setCharacter((c0) => {
      const c = toClassesForm(c0);
      if (c.classes.length <= 1) return c0;
      const classes = c.classes.filter((x) => x.name !== className);
      const next = { ...c, classes };
      for (const field of Object.values(SLOT_FIELD)) {
        const picks = c[field];
        if (!picks) continue;
        const keep = picks
          .map((name, i) => ({ name, i }))
          .filter(({ name, i }) => pickClass(c, field, i, name) !== className);
        next[field] = keep.map((k) => k.name);
        if (c.powerClass?.[field]) {
          next.powerClass = { ...(next.powerClass || c.powerClass) };
          next.powerClass[field] = keep.map((k) => c.powerClass[field][k.i]);
        }
      }
      const primary = classes[0];
      let updated = next;
      if (primary) {
        updated = applyClassStartingAbilities(updated, primary.name, primary.level);
      }
      return updated;
    });
  }, []);

  const { handleOpenClassPicker, handleOpenAdd } = usePickers({
    character,
    report,
    setPicking,
    handleAddClass,
    handleAddEntity,
  });

  const handleBack = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) {
        setView(null);
        return h;
      }
      const prev = h[h.length - 1];
      setView(prev);
      return h.slice(0, -1);
    });
  }, []);

  const handleClose = useCallback(() => {
    setView(null);
    setHistory([]);
  }, []);

  const handleRestart = useCallback(() => {
    if (window.confirm("Discard this character and start over?")) {
      setCharacter(EMPTY_CHARACTER);
      setView(null);
      setHistory([]);
    }
  }, []);

  const handleChangeArchetype = useCallback(() => {
    if (window.confirm("Select a different archetype? Any changes you've made to this character will be lost.")) {
      setCharacter(EMPTY_CHARACTER);
      setView(null);
      setHistory([]);
    }
  }, []);

  const handleClickIdentityField = useCallback(
    (field) => {
      if (field === "class") {
        const primary = getClasses(character)[0]?.name;
        if (primary) handleInspect(primary, null, "classes");
        return;
      }
      const item = character[field];
      if (item) handleInspect(item, null, field);
    },
    [character, handleInspect],
  );

  // ─── CONTEXT BUNDLES ──────────────────────────────────────────────────────
  // State changes per keystroke; actions are (mostly) stable. Split into two
  // contexts so action-only components don't re-render on every state change.
  const builderState = useMemo(() => ({ character, report, view }), [character, report, view]);
  const builderActions = useMemo(
    () => ({
      onPickArchetype: handlePickArchetype,
      onStartBlank: handleStartBlank,
      onSetName: handleSetName,
      onInspect: handleInspect,
      onClickField: handleClickIdentityField,
      onRestart: handleRestart,
      onChangeArchetype: handleChangeArchetype,
      onSetClassLevel: handleSetClassLevel,
      onRemoveClass: handleRemoveClass,
      onAddClass: handleOpenClassPicker,
      onPickDevotion: handlePickDevotion,
      onToggleDomain: handleToggleDomain,
      onClearDevotion: handleClearDevotion,
      onToggleBackstory: handleToggleBackstory,
      onSetEvent: handleSetEvent,
      onSetExtraBP: handleSetExtraBP,
      onOpenSlot: handleOpenSlot,
      onOpenAdd: handleOpenAdd,
      onRemoveEntity: handleRemoveEntity,
      onSetRank: handleSetRank,
      onSetSpecialty: handleSetSpecialty,
      onSetChoice: handleSetChoice,
      onUpdateParameter: handleUpdateParameter,
      onSetLineage: handleSetLineage,
      onSetSublineage: handleSetSublineage,
      onToggleLineageItem: handleToggleLineageItem,
      onSetLineageRep: handleSetLineageRep,
      onSetAdvantageChoice: handleSetAdvantageChoice,
      onOpenLineage: () => setLineageOpen(true),
    }),
    [
      handlePickArchetype,
      handleStartBlank,
      handleSetName,
      handleInspect,
      handleClickIdentityField,
      handleRestart,
      handleSetClassLevel,
      handleRemoveClass,
      handleOpenClassPicker,
      handlePickDevotion,
      handleToggleDomain,
      handleClearDevotion,
      handleToggleBackstory,
      handleSetEvent,
      handleSetExtraBP,
      handleOpenSlot,
      handleOpenAdd,
      handleRemoveEntity,
      handleSetRank,
      handleSetSpecialty,
      handleSetChoice,
      handleUpdateParameter,
      handleSetLineage,
      handleSetSublineage,
      handleToggleLineageItem,
      handleSetLineageRep,
      handleSetAdvantageChoice,
    ],
  );

  return (
    <div className="b-root">
      <BTopBar
        mode={mode}
        setMode={setMode}
        character={character}
        report={report}
        onLevelChange={handleLevelChange}
        onExport={() => setExportOpen(true)}
      />
      {mode === "explorer" ? (
        <RulesExplorer onClose={() => setMode("builder")} />
      ) : mode === "recipes" ? (
        <RecipeChecker onClose={() => setMode("builder")} />
      ) : (
        <BuilderProvider state={builderState} actions={builderActions}>
          <div className="b-cols">
            <IdentityRail />
            <BuildSheet />
            <DetailPane
              view={view}
              report={report}
              choices={character.choices}
              onSetChoice={handleSetChoice}
              onUpdateParameter={handleUpdateParameter}
              onInspect={handleInspect}
              onBack={history.length ? handleBack : null}
              onClose={handleClose}
            />
          </div>
        </BuilderProvider>
      )}
      {picking && <PickerOverlay spec={picking} character={character} onClose={() => setPicking(null)} />}
      {exportOpen && (
        <ExportImportPanel
          character={character}
          report={report}
          onImport={(c) => {
            let prepared = { ...c };
            const primary = getClasses(prepared)[0]?.name;
            if (primary && hasStartingChoices(primary)) {
              prepared.startingChoices = reconcileStartingChoices(prepared, primary);
              prepared = rebuildStartingSkills(prepared, primary, prepared.startingChoices);
            }
            setCharacter(prepared);
            setExportOpen(false);
            setView(null);
            setHistory([]);
          }}
          onClose={() => setExportOpen(false)}
        />
      )}
      {lineageOpen && (
        <LineagePanel
          character={character}
          report={report}
          onInspect={handleInspect}
          onSetLineage={handleSetLineage}
          onSetSublineage={handleSetSublineage}
          onToggle={handleToggleLineageItem}
          onSetRep={handleSetLineageRep}
          onClose={() => setLineageOpen(false)}
          onSetAdvantageChoice={handleSetAdvantageChoice}
        />
      )}
      <SiteFooter />
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="b-footer">
      <span className="b-footer-alpha">Alpha</span>
      <span className="b-footer-ver">v{META.appVersion}</span>
      <span className="b-footer-sep">·</span>
      <span className="b-footer-sync">
        Rules data synced from the {META.sourceDoc} ({META.sourceVersion}) on {META.sourceSyncedLabel}
      </span>
      <span className="b-footer-sep">·</span>
      <span className="b-footer-note">Unofficial fan tool — verify against the current rules.</span>
    </footer>
  );
}

function BTopBar({ mode, setMode, character, report, onLevelChange, onExport }) {
  const level = character.archetypeName ? characterLevel(character) : null;
  const [linkCopied, setLinkCopied] = useState(false);
  const copyShareLink = () => {
    navigator.clipboard?.writeText(window.location.href);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1500);
  };
  return (
    <header className="b-topbar">
      <div className="b-topbar-brand">
        <span className="b-topbar-title">Wellspring</span>
        <span className="b-topbar-sub">
          {mode === "explorer" ? "Rules Explorer" : mode === "recipes" ? "Recipe Explorer" : "Character Builder"}
        </span>
      </div>
      <div className="b-topbar-tabs">
        <button className={`b-topbar-tab ${mode === "builder" ? "is-active" : ""}`} onClick={() => setMode("builder")}>
          Character Creator
        </button>
        <button
          className={`b-topbar-tab ${mode === "explorer" ? "is-active" : ""}`}
          onClick={() => setMode("explorer")}
        >
          Rules Explorer
        </button>
        <button className={`b-topbar-tab ${mode === "recipes" ? "is-active" : ""}`} onClick={() => setMode("recipes")}>
          Recipe Checker
        </button>
      </div>
      <div className="b-topbar-stats">
        {mode === "builder" && level && (
          <>
            <span className="b-topbar-stat b-level">
              Level
              <button
                className="b-level-btn"
                disabled={level <= MIN_LEVEL}
                aria-label="Level down"
                onClick={() => onLevelChange(level - 1)}
                title="Level down"
              >
                −
              </button>
              <strong aria-live="polite">{level}</strong>
              <button
                className="b-level-btn"
                disabled={level >= MAX_LEVEL}
                aria-label="Level up"
                onClick={() => onLevelChange(level + 1)}
                title="Level up"
              >
                +
              </button>
            </span>
            <span className="b-topbar-stat">
              Budget <strong>{report.budget} BP</strong>
            </span>
            <span
              className={`b-topbar-stat ${report.valid ? "is-valid" : "is-invalid"}`}
              title={report.valid ? "" : validityReasons(report).join("\n")}
            >
              {report.valid
                ? "✓ legal build"
                : report.belowFloor
                  ? `⚠ below level ${report.legalMinLevel}`
                  : "⚠ check build"}
            </span>
            {report.aboveCap && (
              <span
                className="b-topbar-stat is-note"
                title={`Total level ${report.level} exceeds the current cap of ${report.levelCap}. Advancing past ${report.levelCap} requires Advanced Classes, which aren't published yet; slots/stats are frozen at level ${report.levelCap}.`}
              >
                ⚑ above level {report.levelCap} cap (Advanced Classes pending)
              </span>
            )}
          </>
        )}
      </div>
      <div className="b-topbar-actions">
        {mode === "builder" ? (
          <>
            <button className="b-topbar-btn" onClick={onExport}>
              Export / Import
            </button>
            <button className={`b-topbar-btn ${linkCopied ? "is-copied" : ""}`} onClick={copyShareLink}>
              {linkCopied ? "Link copied!" : "Copy share link"}
            </button>
          </>
        ) : (
          <span />
        )}
      </div>
    </header>
  );
}
