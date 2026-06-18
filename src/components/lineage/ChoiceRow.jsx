// One challenge/advantage as a COMPACT PILL inside an LBP band. The pill shows only
// the take/remove toggle, the name, tags, and the LBP delta — so a whole price band
// is a scannable, pickable row of chips (not a wall of prose). Clicking the name
// EXPANDS the item in place to reveal its description, mechanical-impact summary, and
// the SubChoice chooser (rep / cantrip) when chosen.
//
// Required-active items (General requireds, or a picked sublineage's requireds) are
// auto-included and NON-removable: the toggle becomes a locked ✓ marker with an
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
  expanded,
  onExpand,
  onToggle,
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
  const desc = item.desc || item.description;

  // The toggle stores either the bare base name or the rep-parameterized form.
  const repParam = spec?.kind === "rep" && storedName ? repParamOf(storedName) : "";
  const toggleValue = spec?.kind === "rep" && repParam ? `${base} (${repParam})` : base;

  // The current sub-choice value (for SubChoice's controlled input).
  const choiceValue = spec?.kind === "rep" ? repParam : advantageChoices?.[base] || "";

  return (
    <li
      className={`b-lin-pill ${chosen ? "is-on" : ""} ${dimmed ? "is-dimmed" : ""} ${requiredActive ? "is-required" : ""} ${expanded ? "is-expanded" : ""}`}
      title={dimmed ? `Belongs to the ${subLabel} sublineage — select it to take this.` : undefined}
    >
      <div className="b-lin-pill-head">
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
        <button className="b-lin-name" onClick={onExpand} aria-expanded={expanded} title="Show details">
          {base}
        </button>
        <span className="b-lin-row-tags">
          {subLabel && <span className="b-lin-tag b-lin-subtag">{subLabel}</span>}
          {requiredActive && <span className="b-lin-tag b-lin-req">auto</span>}
          {item.repped && <span className="b-lin-tag b-lin-repped">repped</span>}
        </span>
        <span className={`b-lin-lbp ${kind === "challenge" ? "is-award" : "is-cost"}`}>{lbpLabel}</span>
      </div>

      {/* Detail revealed on expand: impact summary, description, and (when chosen)
          the rep/cantrip sub-choice. SubChoice is also shown when chosen even if
          collapsed, so a required choice never hides. */}
      {expanded && impact.length > 0 && (
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

      {expanded && desc && <p className="b-lin-desc">{desc}</p>}
    </li>
  );
}
