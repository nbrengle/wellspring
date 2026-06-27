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
//   'spell'   — pick a cantrip/novice spell from any base class of the magic type
//               (Arcane Aptitude). Stored in advantageChoices[item]; the engine
//               grants the chosen spell as a Known Spell.
//   'flavor'  — free pick with no mechanical effect (Elemental Expression accent,
//               Favored Gem). Stored in advantageChoices[item]; display only.
import { useState } from "react";
import { cantripOptions, lineageSpellOptions, pickAndChooseOptions } from "../../engine/data.js";
import RepPicker from "./RepPicker.jsx";
import SubSelect from "../SubSelect.jsx";
import EntityChoicePicker from "../ui/EntityChoicePicker.jsx";

const FLAVOR_OPTIONS = {
  Accent: ["Flame", "Ice", "Lightning", "Acid", "Force", "Mind", "Fear", "Shadow"],
};

export default function SubChoice({ spec, item, field, value, onSetChoice, onSetRep }) {
  if (!spec) return null;

  if (spec.kind === "cantrip") {
    // 18–33 cantrips → the shared control falls back to its searchable list.
    return (
      <div className="b-lin-subchoice">
        <SubSelect
          prompt="Cantrip"
          value={value || null}
          onChange={(v) => onSetChoice(item, v || "")}
          options={cantripOptions(spec.pool).map((c) => ({ value: c }))}
        />
      </div>
    );
  }

  if (spec.kind === "spell") {
    // Arcane Aptitude: cantrip/novice spell from any base arcane class — large pool,
    // so the shared control's search fallback kicks in.
    return (
      <div className="b-lin-subchoice">
        <SubSelect
          prompt="Spell"
          value={value || null}
          onChange={(v) => onSetChoice(item, v || "")}
          options={lineageSpellOptions(spec.pool, spec.tiers).map((s) => ({ value: s }))}
        />
      </div>
    );
  }

  if (spec.kind === "rep") {
    return <RepChoice item={item} field={field} value={value} onSetRep={onSetRep} />;
  }

  if (spec.kind === "advantage") {
    return <AdvantageChoice item={item} value={value} onSetChoice={onSetChoice} />;
  }

  // flavor
  return <FlavorChoice spec={spec} item={item} value={value} onSetChoice={onSetChoice} />;
}

// Pick and Choose: pick one Lineage Advantage from another lineage (80 options
// across 7 lineages) — the read-pane picker, grouped by lineage, so you read what
// each advantage does before committing. The choice is stored as "<Lineage> -
// <Advantage>" (advId) so the engine resolves it cross-lineage.
function AdvantageChoice({ item, value, onSetChoice }) {
  const [open, setOpen] = useState(false);
  const options = pickAndChooseOptions().map((o) => ({ ...o, advId: o.advId, key: o.advId }));
  // Display the bare advantage name; the stored value is the "<Lineage> - <Advantage>" id.
  const current = options.find((o) => o.advId === value);
  return (
    <div className="b-lin-subchoice">
      <span className="b-lin-subchoice-label">Advantage</span>
      <button type="button" className="b-lin-subchoice-btn" onClick={() => setOpen(true)}>
        {current ? `${current.name} (${current.group})` : "Choose an advantage…"}
        <span className="b-lin-subchoice-btn-caret">⌄</span>
      </button>
      {open && (
        <EntityChoicePicker
          title="Pick an advantage from another lineage"
          subtitle="Purchase one Lineage Advantage from another lineage — you must still meet its prerequisites."
          options={options.map((o) => ({ name: o.name, group: o.group, description: o.description, advId: o.advId }))}
          value={current?.name || null}
          chooseLabel={(name) => `Choose ${name}`}
          onChoose={(name) => {
            // Resolve back to the advId (lineage-qualified) for the recorded choice.
            const opt = options.find((o) => o.name === name);
            onSetChoice(item, opt ? opt.advId : "");
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

// Lost Life: the recorded rep is shown as a button (not a bare <select>) that opens
// the searchable RepPicker overlay, where each option carries its description and LBP.
function RepChoice({ item, field, value, onSetRep }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="b-lin-subchoice">
      <span className="b-lin-subchoice-label">Repping</span>
      <button type="button" className="b-lin-subchoice-btn" onClick={() => setOpen(true)}>
        {value ? value : "Choose a challenge to rep…"}
        <span className="b-lin-subchoice-btn-caret">⌄</span>
      </button>
      {open && (
        <RepPicker
          value={value || null}
          onChoose={(rep) => { onSetRep(field, item, rep); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function FlavorChoice({ spec, item, value, onSetChoice }) {
  const opts = FLAVOR_OPTIONS[spec.label];
  // A fixed flavor list (Accent, 8 options) → chips. A free-text flavor (no preset
  // list) stays a text input.
  if (opts) {
    return (
      <div className="b-lin-subchoice">
        <SubSelect
          prompt={spec.label || "Choice"}
          value={value || null}
          onChange={(v) => onSetChoice(item, v || "")}
          options={opts.map((o) => ({ value: o }))}
        />
      </div>
    );
  }
  return (
    <label className="b-lin-subchoice">
      <span className="b-lin-subchoice-label">{spec.label || "Choice"}</span>
      <input
        className="b-lin-subchoice-select"
        type="text"
        value={value || ""}
        placeholder={`Your ${(spec.label || "choice").toLowerCase()}…`}
        onChange={(e) => onSetChoice(item, e.target.value)}
      />
    </label>
  );
}
