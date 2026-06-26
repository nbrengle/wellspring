// Builder — single-page character creator. State lives in the URL.
// Decomposed into modular subcomponents in src/components/ directory.

import { useState, useEffect, useMemo } from "react";
import {
  META,
  LEVEL_TABLE,
} from "./engine/data.js";
import {
  characterLevel,
  validityReasons,
} from "./engine/validate.js";
import { getClasses } from "./engine/resolver.js";
import {
  hasStartingChoices,
  reconcileStartingChoices,
  rebuildStartingSkills,
} from "./engine/starting-choices.js";
import { useCharacterState } from "./hooks/useCharacterState.js";
import { useBuilderHandlers } from "./hooks/useBuilderHandlers.js";
import RulesExplorer from "./RulesExplorer.jsx";
import RecipeChecker from "./RecipeChecker.jsx";
import "./Builder.css";

// Components
import LineagePanel from "./components/LineagePanel.jsx";
import ExportImportPanel from "./components/ExportImportPanel.jsx";
import PickerOverlay from "./components/PickerOverlay.jsx";
import DetailPane from "./components/DetailPane.jsx";
import BuildSheet, { IdentityRail } from "./components/BuildSheet.jsx";
import { BuilderProvider } from "./components/builder-context.jsx";

const MAX_LEVEL = LEVEL_TABLE.length ? Math.max(...LEVEL_TABLE.map((l) => l.level)) : 15;
const MIN_LEVEL = 1;

// ─── ROOT COMPONENT ─────────────────────────────────────────────────────────

export default function Builder() {
  const [mode, setMode] = useState("builder"); // "builder" | "explorer" | "recipes"
  const { character, setCharacter, report } = useCharacterState();
  // `view` = the INLINE detail expanded under a build-sheet row (the primary glance).
  // `chase` = the right DRAWER's current entity when following concept links. They're
  // independent so chasing a link never collapses the inline expand. `history` is the
  // chase back-stack.
  const [view, setView] = useState(null);
  const [chase, setChase] = useState(null);
  const [picking, setPicking] = useState(null); // null | picker spec
  const [exportOpen, setExportOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [lineageOpen, setLineageOpen] = useState(false);

  const handlers = useBuilderHandlers({
    character,
    report,
    setCharacter,
    setView,
    setChase,
    setPicking,
    setHistory,
    setLineageOpen,
  });

  // Close the chase drawer on Escape — a reliable "I'm done" gesture. Click-away is
  // deliberately NOT a global mousedown so that following another chase link never
  // closes-then-reopens the drawer.
  useEffect(() => {
    if (!chase) return;
    const onKey = (e) => e.key === "Escape" && handlers.handleClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chase, handlers]);

  // ─── CONTEXT BUNDLES ──────────────────────────────────────────────────────
  // State changes per keystroke; actions are (mostly) stable. Split into two
  // contexts so action-only components don't re-render on every state change.
  const builderState = useMemo(() => ({ character, report, view }), [character, report, view]);
  const builderActions = useMemo(
    () => ({
      onPickArchetype: handlers.handlePickArchetype,
      onStartBlank: handlers.handleStartBlank,
      onSetName: handlers.handleSetName,
      onInspect: handlers.handleInspect,
      onChase: handlers.handleChase,
      onClickField: handlers.handleClickIdentityField,
      onRestart: handlers.handleRestart,
      onChangeArchetype: handlers.handleChangeArchetype,
      onSetClassLevel: handlers.handleSetClassLevel,
      onRemoveClass: handlers.handleRemoveClass,
      onAddClass: handlers.handleOpenClassPicker,
      onPickDevotion: handlers.handlePickDevotion,
      onToggleDomain: handlers.handleToggleDomain,
      onClearDevotion: handlers.handleClearDevotion,
      onToggleBackstory: handlers.handleToggleBackstory,
      onSetEvent: handlers.handleSetEvent,
      onSetExtraBP: handlers.handleSetExtraBP,
      onOpenSlot: handlers.handleOpenSlot,
      onOpenAdd: handlers.handleOpenAdd,
      onRemoveEntity: handlers.handleRemoveEntity,
      onSetRank: handlers.handleSetRank,
      onSetSpecialty: handlers.handleSetSpecialty,
      onSetChoice: handlers.handleSetChoice,
      onUpdateParameter: handlers.handleUpdateParameter,
      onSetLineage: handlers.handleSetLineage,
      onSetSublineage: handlers.handleSetSublineage,
      onToggleLineageItem: handlers.handleToggleLineageItem,
      onSetLineageRep: handlers.handleSetLineageRep,
      onSetAdvantageChoice: handlers.handleSetAdvantageChoice,
      onSetGrantedSelection: handlers.handleSetGrantedSelection,
      onSetAgileLearnerTrade: handlers.handleSetAgileLearnerTrade,
      onOpenLineage: () => setLineageOpen(true),
    }),
    [handlers],
  );

  return (
    <div className="b-root">
      <BTopBar
        mode={mode}
        setMode={setMode}
        character={character}
        report={report}
        onLevelChange={handlers.handleLevelChange}
        onExport={() => setExportOpen(true)}
      />
      {mode === "explorer" ? (
        <RulesExplorer onClose={() => setMode("builder")} />
      ) : mode === "recipes" ? (
        <RecipeChecker onClose={() => setMode("builder")} />
      ) : (
        <BuilderProvider state={builderState} actions={builderActions}>
          <div className={`b-cols ${chase ? "is-chasing" : ""}`}>
            <IdentityRail />
            <BuildSheet />
            {/* The right detail pane is the CHASE drawer: it appears only when you
                follow a concept link from a detail body. Item detail itself renders
                inline in the build sheet (the inline expand stays open underneath). */}
            {chase && (
              <DetailPane
                view={chase}
                report={report}
                choices={character.choices}
                onSetChoice={handlers.handleSetChoice}
                onUpdateParameter={handlers.handleUpdateParameter}
                onInspect={handlers.handleChase}
                onBack={history.length ? handlers.handleBack : null}
                onClose={handlers.handleClose}
              />
            )}
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
          onInspect={handlers.handleInspect}
          onSetLineage={handlers.handleSetLineage}
          onSetSublineage={handlers.handleSetSublineage}
          onToggle={handlers.handleToggleLineageItem}
          onSetRep={handlers.handleSetLineageRep}
          onClose={() => setLineageOpen(false)}
          onSetAdvantageChoice={handlers.handleSetAdvantageChoice}
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
        Rules data synced from the <a href="https://docs.google.com/document/d/1lh8WAAWPk2ELo4_djuQg0fBTdt6Y5Oqp3a124qvtUrM/" target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{META.sourceDoc}</a> ({META.sourceVersion}) on {META.sourceSyncedLabel}
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
        <a href="https://www.wellspringlarp.org/" target="_blank" rel="noreferrer" className="b-topbar-title" style={{ textDecoration: "none" }}>Wellspring</a>
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
