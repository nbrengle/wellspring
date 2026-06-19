// Step 2 — Focus a lineage (the B5 layout). Top to bottom: back link + lineage
// name; a collapsible "About" strip (lore + costuming status); the slim LBP balance
// meter; the OPTIONAL sublineage step (its own band, not a column); then the two
// FACING columns (challenges earn ⇄ advantages spend) so the two-sided budget is
// always visible. All rules logic stays in the engine selectors + lbp report.
import React from "react";
import { subKey } from "../../engine/validate.js";
import { cleanChallengeName } from "../LineagePanel.jsx";
import { costumeStatus } from "./lineage-helpers.js";
import SublineagePicker from "./SublineagePicker.jsx";
import ChoiceList from "./ChoiceList.jsx";
import LbpMeter from "./LbpMeter.jsx";
import LineageAbout from "./LineageAbout.jsx";

export default function LineageDetail({
  lineage,
  lin,
  character,
  lbp,
  onBack,
  onSetSublineage,
  onToggle,
  onInspect,
  onSetChoice,
  onSetRep,
}) {
  const pickedSub = character.sublineage ? subKey(character.sublineage) : null;

  // [Repped] challenges the character currently has taken — feeds the costuming
  // requirement check (counts toward the lineage's "at least N [Repped]" rule).
  const takenRepped = (lin.challenges || [])
    .filter(
      (c) =>
        c.repped &&
        (character.lineageChallenges || []).some(
          (n) => cleanChallengeName(n) === cleanChallengeName(c.baseName || c.name),
        ),
    )
    .map((c) => c.baseName || c.name);
  const costume = costumeStatus(lin, takenRepped, character.sublineage);

  return (
    <div className="b-lin-focus">
      {/* Single header (replaces the Overlay's separate picker-head): back link +
          lineage name + the earn→spend→balance one-liner. */}
      <header className="b-lin-focus-head">
        <button className="b-lin-back" onClick={onBack}>
          ‹ Change lineage
        </button>
        <div className="b-lin-focus-titles">
          <h2 className="b-lin-focus-name">{lineage}</h2>
          <p className="b-lin-focus-tag">Earn LBP from Challenges → spend on Advantages → keep it balanced</p>
        </div>
      </header>

      <LineageAbout name={lineage} description={lin.description} costume={costume} />

      <LbpMeter lbp={lbp} costume={costume} />

      <SublineagePicker lin={lin} selected={character.sublineage} onSelect={onSetSublineage} />

      <div className="b-lin-options-banner">Lineage options — challenges earn LBP · advantages spend it</div>

      <ChoiceList
        lin={lin}
        lineage={lineage}
        character={character}
        lbp={lbp}
        pickedSub={pickedSub}
        onToggle={onToggle}
        onInspect={onInspect}
        onSetChoice={onSetChoice}
        onSetRep={onSetRep}
      />
    </div>
  );
}
