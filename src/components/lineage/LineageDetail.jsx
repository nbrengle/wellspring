// Step 2 — Focus a lineage. Two panes: LEFT = identity (lore, costuming cost, the
// prominent sublineage picker + what's-unique); RIGHT = the unified searchable
// choice list with inline impact. A back button returns to the gallery.
import React from "react";
import { subKey } from "../../engine/validate.js";
import SublineagePicker from "./SublineagePicker.jsx";
import ChoiceList from "./ChoiceList.jsx";

export default function LineageDetail({
  lineage, lin, character, lbp, onBack, onSetSublineage,
  onToggle, onInspect, onSetChoice, onSetRep,
}) {
  const pickedSub = character.sublineage ? subKey(character.sublineage) : null;

  return (
    <div className="b-lin-detail">
      {/* LEFT: identity */}
      <aside className="b-lin-identity">
        <button className="b-lin-back" onClick={onBack}>‹ All lineages</button>
        <h2 className="b-lin-identity-name">{lineage}</h2>
        {lin.description && <p className="b-lin-identity-lore">{lin.description}</p>}
        {lin.costume && (
          <p className="b-lin-identity-cost"><span className="b-lin-cost-icon">🎭</span> {lin.costume}</p>
        )}

        <SublineagePicker lin={lin} selected={character.sublineage} onSelect={onSetSublineage} />

        {!lbp.valid && (
          <p className="b-lin-flag">
            {lbp.overspent && `Over by ${lbp.spent - lbp.awarded} LBP. `}
            {lbp.mixedSublineage && "Items from more than one sublineage. "}
            {lbp.needsSublineage && `Select the ${lbp.requiredSublineages.join("/")} sublineage to take its options. `}
            {lbp.missingRequired.length > 0 && `Required: ${lbp.missingRequired.map((c) => c.baseName).join(", ")}.`}
          </p>
        )}
      </aside>

      {/* RIGHT: choices */}
      <ChoiceList
        lin={lin} lineage={lineage} character={character} lbp={lbp} pickedSub={pickedSub}
        onToggle={onToggle} onInspect={onInspect} onSetChoice={onSetChoice} onSetRep={onSetRep}
      />
    </div>
  );
}
