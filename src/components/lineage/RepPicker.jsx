// Lost Life rep picker. The Lost choose a [Repped] physical challenge from ANOTHER
// lineage and earn its LBP. That's 1-of-47 options across 7 lineages — far too many
// for a bare <select> where each option is just a name + number and you'd have to
// hunt elsewhere to learn what "Mana Lines" or "Altered Skin" actually is.
//
// So this is a searchable overlay in the same shape as the power/skill PickerOverlay
// (shared <Overlay> shell + .b-picker-* skin): a left column of challenges grouped by
// lineage, and a right READ pane that shows the selected challenge's description, its
// lineage/sublineage, and the LBP it awards — so you read what you're picking before
// you commit. We render rep-challenge data directly (these live inside lineages, not
// as standalone entities), so we don't borrow PickerOverlay's entity-lookup model.
import { useMemo, useState } from "react";
import { lineageRepOptions } from "../../engine/data.js";
import Overlay from "../ui/Overlay.jsx";

export default function RepPicker({ title = "Rep a challenge", subtitle, value, onChoose, onClose }) {
  const lineages = useMemo(() => lineageRepOptions(), []);
  const [query, setQuery] = useState("");

  // Flatten once so search and the initial selection are easy; keep lineage on each.
  const all = useMemo(
    () => lineages.flatMap(([lin, challenges]) => challenges.map((c) => ({ ...c, lineage: lin }))),
    [lineages],
  );
  const nameOf = (c) => c.baseName || c.name;
  const descOf = (c) => c.desc || c.description || "";
  // Most challenges are "General"; only surface a real sublineage as a tag.
  const subOf = (c) => (c.sublineage && c.sublineage !== "General" ? c.sublineage : null);

  const [selected, setSelected] = useState(() => value || nameOf(all[0] || {}) || null);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lineages
      .map(([lin, challenges]) => [
        lin,
        challenges.filter(
          (c) =>
            !q ||
            nameOf(c).toLowerCase().includes(q) ||
            lin.toLowerCase().includes(q) ||
            descOf(c).toLowerCase().includes(q),
        ),
      ])
      .filter(([, cs]) => cs.length > 0);
  }, [lineages, query]);

  const selectedChallenge = useMemo(
    () => all.find((c) => nameOf(c) === selected) || null,
    [all, selected],
  );

  return (
    <Overlay onClose={onClose} panelClassName="b-picker" ariaLabel={title}>
      <header className="b-picker-head">
        <div>
          <h2 className="b-picker-title">{title}</h2>
          <p className="b-picker-sub">{subtitle || "Choose a [Repped] physical challenge from another lineage — you earn its Lineage Build Points."}</p>
        </div>
        <button className="b-picker-x" aria-label="Close" onClick={onClose}>×</button>
      </header>

      <div className="b-picker-cols">
        <div className="b-picker-browse">
          <div className="b-picker-controls">
            <input className="b-picker-search" type="text" aria-label="Search" placeholder="Search challenges…"
                   value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          </div>
          <div className="b-picker-groups">
            {groups.length === 0 && <p className="b-detail-missing">Nothing matches.</p>}
            {groups.map(([lin, challenges]) => (
              <div key={lin} className="b-picker-group">
                <h3 className="b-picker-group-label">{lin}</h3>
                <ul className="b-picker-names">
                  {challenges.map((c) => {
                    const name = nameOf(c);
                    return (
                      <li key={`${lin}:${name}`}>
                        <button
                          className={`b-picker-row ${selected === name ? "is-selected" : ""}`}
                          onClick={() => setSelected(name)}>
                          <span className="b-picker-row-name">{name}</span>
                          {subOf(c) && <span className="b-picker-row-tag">{subOf(c)}</span>}
                          <span className="b-picker-row-cost is-award">+{c.lbp} LBP</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="b-picker-read">
          {selectedChallenge ? (
            <>
              <header className="b-read-head">
                <h2 className="b-read-title">{nameOf(selectedChallenge)}</h2>
                <p className="b-detail-type">
                  {selectedChallenge.lineage}
                  {subOf(selectedChallenge) ? ` · ${subOf(selectedChallenge)}` : ""}
                  {" · "}+{selectedChallenge.lbp} LBP
                </p>
              </header>
              <div className="b-read-body">
                <p className="b-detail-desc">{descOf(selectedChallenge) || "No description."}</p>
              </div>
              <footer className="b-read-foot">
                <button className="b-read-choose" onClick={() => onChoose(nameOf(selectedChallenge))}>
                  {value === nameOf(selectedChallenge) ? "Keep this rep" : `Rep ${nameOf(selectedChallenge)}`}
                </button>
              </footer>
            </>
          ) : (
            <p className="b-detail-hint">Select a challenge on the left to read it.</p>
          )}
        </div>
      </div>
    </Overlay>
  );
}
