// Generalized sub-selection chooser. ONE component for every lineage item that
// needs a recorded pick — replaces the two bespoke <select>s (the hardcoded-style
// Divine Magic cantrip picker and the Lost Life rep picker). The kind comes from
// the engine's lineageChoiceSpec; options come from engine selectors.
//
//   'cantrip' — pick a cantrip from the spec's magic-type pool (Divine Magic,
//               Psionic Cantrip). Stored in advantageChoices[item]; the engine
//               grants it + gives a casting slot.
//   'rep'     — pick a [Repped] challenge from another lineage (Lost Life). Stored
//               as a parameterized name "<item> (<rep>)" via onSetRep.
//   'flavor'  — free pick with no mechanical effect (Elemental Expression accent,
//               Favored Gem). Stored in advantageChoices[item]; display only.
import React from "react";
import { cantripOptions, lineageRepOptions } from "../../engine/data.js";

const FLAVOR_OPTIONS = {
  Accent: ["Flame", "Ice", "Lightning", "Acid", "Force", "Mind", "Fear", "Shadow"],
};

export default function SubChoice({ spec, item, field, value, onSetChoice, onSetRep }) {
  if (!spec) return null;

  if (spec.kind === "cantrip") {
    return (
      <label className="b-lin-subchoice">
        <span className="b-lin-subchoice-label">Cantrip</span>
        <select
          className="b-lin-subchoice-select"
          value={value || ""}
          onChange={(e) => onSetChoice(item, e.target.value)}
        >
          <option value="" disabled>
            Choose a cantrip…
          </option>
          {cantripOptions(spec.pool).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (spec.kind === "rep") {
    return (
      <label className="b-lin-subchoice">
        <span className="b-lin-subchoice-label">Repping</span>
        <select
          className="b-lin-subchoice-select"
          value={value || ""}
          onChange={(e) => onSetRep(field, item, e.target.value)}
        >
          <option value="">Choose a challenge to rep…</option>
          {lineageRepOptions().map(([linName, challenges]) => (
            <optgroup key={linName} label={linName}>
              {challenges.map((c) => (
                <option key={`${linName}:${c.baseName || c.name}`} value={c.baseName || c.name}>
                  {c.baseName || c.name} (+{c.lbp})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
    );
  }

  // flavor
  const opts = FLAVOR_OPTIONS[spec.label];
  return (
    <label className="b-lin-subchoice">
      <span className="b-lin-subchoice-label">{spec.label || "Choice"}</span>
      {opts ? (
        <select
          className="b-lin-subchoice-select"
          value={value || ""}
          onChange={(e) => onSetChoice(item, e.target.value)}
        >
          <option value="" disabled>
            Choose…
          </option>
          {opts.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="b-lin-subchoice-select"
          type="text"
          value={value || ""}
          placeholder={`Your ${(spec.label || "choice").toLowerCase()}…`}
          onChange={(e) => onSetChoice(item, e.target.value)}
        />
      )}
    </label>
  );
}
