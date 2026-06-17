import React from "react";
import { LINEAGES } from "../engine/data.js";
import Overlay from "./ui/Overlay.jsx";
import LineageGallery from "./lineage/LineageGallery.jsx";
import LineageDetail from "./lineage/LineageDetail.jsx";

// Strip a stored item's rep parameter + tags down to its display name, so a stored
// "Lost Life (Horns)" / "Mana Lines [Repped]" matches its data entry. Exported
// because the lineage choice components compare against it.
export const cleanChallengeName = (s) => {
  const firstOpen = s.indexOf('(');
  const lastClose = s.lastIndexOf(')');
  let clean = s;
  if (firstOpen !== -1 && lastClose > firstOpen) {
    clean = (s.slice(0, firstOpen) + s.slice(lastClose + 1)).trim();
  }
  return clean.replace(/\s*\[[^\]]+\]/g, '').trim();
};

// The lineage experience — a discovery-first, widened workspace. Step 1: browse the
// lineage gallery (search/sort). Step 2: focus one lineage in a two-pane detail
// (identity + sublineage on the left, the searchable choice list on the right).
// This component owns only the browse↔focus shell + the LBP header; all rules logic
// lives in engine selectors, and the sub-choice handling is generalized (one
// onSetChoice path, no per-item special cases).
export default function LineagePanel({
  character, report, onSetLineage, onSetSublineage, onToggle, onSetRep,
  onInspect, onClose, onSetAdvantageChoice,
}) {
  const lbp = report.lbp;
  const lineage = character.lineage;
  const lin = lineage ? LINEAGES[lineage] : null;

  const subtitle = lin
    ? `${lineage} · ${lbp.remaining} LBP left (${lbp.awarded} earned − ${lbp.spent} spent)${lbp.capped ? ", capped at 10" : ""}`
    : "Discover your ancestry — what each lineage is, does, and costs";

  return (
    <Overlay onClose={onClose} overlayClassName="b-overlay-dock"
             panelClassName="b-picker b-picker-dock b-lin-panel" modal={false} ariaLabel="Lineage">
      <header className="b-picker-head">
        <div>
          <h2 className="b-picker-title">Lineage</h2>
          <p className="b-picker-sub">{subtitle}</p>
        </div>
        <button className="b-picker-x" aria-label="Close" onClick={onClose}>×</button>
      </header>

      {lin ? (
        <LineageDetail
          lineage={lineage} lin={lin} character={character} lbp={lbp}
          onBack={() => onSetLineage("")}
          onSetSublineage={onSetSublineage}
          onToggle={onToggle}
          onInspect={onInspect}
          onSetChoice={onSetAdvantageChoice}
          onSetRep={onSetRep}
        />
      ) : (
        <LineageGallery onPick={onSetLineage} />
      )}
    </Overlay>
  );
}
