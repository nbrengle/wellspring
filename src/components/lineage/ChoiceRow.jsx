// One challenge/advantage row: take/remove toggle, name + tags, the LBP delta, an
// inline mechanical-impact summary (pain #7), and — for sub-choice items — the
// generalized SubChoice chooser. Description is shown muted below.
import React from "react";
import { lineageChoiceSpec, lineageItemImpact } from "../../engine/data.js";
import SubChoice from "./SubChoice.jsx";

// "Lost Life (Runic Lattice)" → "Runic Lattice"; "" if none.
const repParamOf = (name) => {
  const m = name && name.match(/\(([^)]+)\)\s*$/);
  return m ? m[1].trim() : "";
};

export default function ChoiceRow({
  item, lineage, kind, chosen, storedName, resolvedLbp,
  onToggle, onInspect, onSetChoice, onSetRep, advantageChoices,
}) {
  const field = kind === "challenge" ? "lineageChallenges" : "lineageAdvantages";
  const base = item.baseName || item.name;
  const spec = lineageChoiceSpec(item);
  const impact = lineageItemImpact(item, lineage);
  const lbp = resolvedLbp ?? item.lbp;

  // The toggle stores either the bare base name or the rep-parameterized form.
  const repParam = spec?.kind === "rep" && storedName ? repParamOf(storedName) : "";
  const toggleValue = spec?.kind === "rep" && repParam ? `${base} (${repParam})` : base;

  // The current sub-choice value (for SubChoice's controlled input).
  const choiceValue = spec?.kind === "rep" ? repParam : (advantageChoices?.[base] || "");

  return (
    <li className={`b-lin-row ${chosen ? "is-on" : ""}`}>
      <div className="b-lin-row-head">
        <button className="b-lin-toggle" title={chosen ? "Remove" : "Take"}
                onClick={() => onToggle(field, toggleValue)}>{chosen ? "✓" : "+"}</button>
        <button className="b-lin-name"
                onClick={() => onInspect(item.name, field, kind === "challenge" ? "flaws" : "perks")}>
          {base}
        </button>
        <span className="b-lin-row-tags">
          {item.required && <span className="b-lin-tag b-lin-req">required</span>}
          {item.repped && <span className="b-lin-tag b-lin-repped">repped</span>}
        </span>
        <span className={`b-lin-lbp ${kind === "challenge" ? "is-award" : "is-cost"}`}>
          {kind === "challenge" ? `+${lbp}` : `−${lbp}`} LBP
        </span>
      </div>

      {impact.length > 0 && (
        <ul className="b-lin-impact">
          {impact.map((s, i) => <li key={i} className="b-lin-impact-chip">{s}</li>)}
        </ul>
      )}

      {chosen && spec && (
        <SubChoice spec={spec} item={base} field={field} value={choiceValue}
                   onSetChoice={onSetChoice} onSetRep={onSetRep} />
      )}

      {(item.desc || item.description) && (
        <p className="b-lin-desc">{item.desc || item.description}</p>
      )}
    </li>
  );
}
