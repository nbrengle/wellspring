// One challenge/advantage row inside an LBP band. Compact head (take/remove toggle,
// name, tags, LBP delta); below it, the inline mechanical-impact summary, the
// generalized SubChoice chooser (rep / cantrip) when chosen, and the muted desc.
//
// Required-active items (General requireds, or a picked sublineage's requireds) are
// auto-included and NON-removable: the toggle becomes a locked ✓ marker and shows an
// "auto" tag — identical treatment regardless of where the requirement comes from.
import React from "react";
import { lineageChoiceSpec, lineageItemImpact } from "../../engine/data.js";
import SubChoice from "./SubChoice.jsx";

// "Lost Life (Runic Lattice)" → "Runic Lattice"; "" if none.
const repParamOf = (name) => {
  const m = name && name.match(/\(([^)]+)\)\s*$/);
  return m ? m[1].trim() : "";
};

export default function ChoiceRow({
  item,
  lineage,
  kind,
  chosen,
  storedName,
  resolvedLbp,
  subLabel,
  dimmed,
  requiredActive,
  onToggle,
  onInspect,
  onSetChoice,
  onSetRep,
  advantageChoices,
}) {
  const field = kind === "challenge" ? "lineageChallenges" : "lineageAdvantages";
  const base = item.baseName || item.name;
  const spec = lineageChoiceSpec(item);
  const impact = lineageItemImpact(item, lineage);
  const lbp = resolvedLbp ?? item.lbp;
  const lbpLabel = typeof lbp === "number" ? `${kind === "challenge" ? "+" : "−"}${lbp}` : "var";

  // The toggle stores either the bare base name or the rep-parameterized form.
  const repParam = spec?.kind === "rep" && storedName ? repParamOf(storedName) : "";
  const toggleValue = spec?.kind === "rep" && repParam ? `${base} (${repParam})` : base;

  // The current sub-choice value (for SubChoice's controlled input).
  const choiceValue = spec?.kind === "rep" ? repParam : advantageChoices?.[base] || "";

  return (
    <li
      className={`b-lin-row ${chosen ? "is-on" : ""} ${dimmed ? "is-dimmed" : ""} ${requiredActive ? "is-required" : ""}`}
      title={dimmed ? `Belongs to the ${subLabel} sublineage — select it to take this.` : undefined}
    >
      <div className="b-lin-row-head">
        {requiredActive ? (
          <span className="b-lin-toggle is-locked" title="Required — automatically included">
            ✓
          </span>
        ) : (
          <button
            className="b-lin-toggle"
            title={chosen ? "Remove" : "Take"}
            onClick={() => onToggle(field, toggleValue)}
          >
            {chosen ? "✓" : "+"}
          </button>
        )}
        <button className="b-lin-name" onClick={() => onInspect(base, field, kind === "challenge" ? "flaws" : "perks")}>
          {base}
        </button>
        <span className="b-lin-row-tags">
          {subLabel && <span className="b-lin-tag b-lin-subtag">{subLabel}</span>}
          {requiredActive && <span className="b-lin-tag b-lin-req">auto</span>}
          {item.repped && <span className="b-lin-tag b-lin-repped">repped</span>}
        </span>
        <span className={`b-lin-lbp ${kind === "challenge" ? "is-award" : "is-cost"}`}>{lbpLabel} LBP</span>
      </div>

      {impact.length > 0 && (
        <ul className="b-lin-impact">
          {impact.map((s, i) => (
            <li key={i} className="b-lin-impact-chip">
              {s}
            </li>
          ))}
        </ul>
      )}

      {chosen && spec && (
        <SubChoice
          spec={spec}
          item={base}
          field={field}
          value={choiceValue}
          onSetChoice={onSetChoice}
          onSetRep={onSetRep}
        />
      )}

      {(item.desc || item.description) && <p className="b-lin-desc">{item.desc || item.description}</p>}
    </li>
  );
}
