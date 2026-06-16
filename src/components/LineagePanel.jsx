import React from "react";
import { REFS, LINEAGES, lookupEntity, CLASSES, CLASS_POWERS } from "../engine/data.js";
import { subKey } from "../engine/validate.js";
import Overlay from "./ui/Overlay.jsx";

const DIVINE_CANTRIPS = (() => {
  const divineClasses = Object.entries(CLASSES).filter(([_, c]) => c.type === 'Spellcaster' && c.magicType === 'Divine').map(([name, _]) => name);
  const cantrips = new Set();
  for (const c of divineClasses) {
    if (CLASS_POWERS[c] && CLASS_POWERS[c].cantrips) {
      for (const p of CLASS_POWERS[c].cantrips) cantrips.add(p.name);
    }
  }
  return Array.from(cantrips).sort();
})();

export const cleanChallengeName = (s) => {
  const firstOpen = s.indexOf('(');
  const lastClose = s.lastIndexOf(')');
  let clean = s;
  if (firstOpen !== -1 && lastClose > firstOpen) {
    clean = (s.slice(0, firstOpen) + s.slice(lastClose + 1)).trim();
  }
  return clean.replace(/\s*\[[^\]]+\]/g, '').trim();
};


// Lost Life / Additional Lost Life carry no fixed LBP — the player "reps" a
// physical [Repped] challenge from another lineage and earns THAT challenge's LBP
// instead. These are stored parameterized as "Lost Life (Chosen Challenge)" and
// resolved by lbpState. baseName is how the engine special-cases them.
const REPPED_PARENTS = new Set(['Lost Life', 'Additional Lost Life']);
const needsRep = (it) => REPPED_PARENTS.has(it.baseName || it.name);

// Extract the chosen rep from a stored name ("Lost Life (Runic Lattice)" → "Runic
// Lattice"); '' when none picked yet.
const repParameterOf = (name) => {
  const m = name && name.match(/\(([^)]+)\)\s*$/);
  return m ? m[1].trim() : '';
};

// Every physical [Repped] challenge from lineages OTHER than Lost, grouped by
// source lineage — the option list a Lost character may rep. Computed once.
const repOptionsByLineage = () =>
  Object.entries(LINEAGES)
    .filter(([name]) => name !== 'Lost')
    .map(([name, lin]) => [name, (lin.challenges || []).filter((c) => c.repped)])
    .filter(([, challenges]) => challenges.length > 0);

export default function LineagePanel({ character, report, onSetLineage, onSetSublineage, onToggle, onSetRep, onInspect, onClose, onSetAdvantageChoice }) {
  const lbp = report.lbp;
  const lin = character.lineage ? LINEAGES[character.lineage] : null;
  const repOptions = repOptionsByLineage();

  const picked = character.sublineage ? subKey(character.sublineage) : null;
  const visible = (items) => (items || []).filter((it) => {
    const k = subKey(it.sublineage);
    return !k || k === "general" || !picked || k === picked;
  });

  const Row = ({ it, field, kind }) => {
    // The stored name for this row (carries the rep parameter for Lost Life).
    const storedName = (character[field] || []).find(name =>
      name === it.name || cleanChallengeName(name) === cleanChallengeName(it.name));
    const chosen = storedName !== undefined;
    const srcId = `${kind === "challenge" ? "challenges" : "advantages"}:${character.lineage} - ${it.baseName || it.name}`;
    const grantIds = (REFS.grants || {})[srcId] || [];

    const isRepChallenge = needsRep(it);
    const repParam = isRepChallenge && storedName ? repParameterOf(storedName) : '';
    // Resolved (rep-derived) LBP for a Lost Life row — lbpState computed it.
    const resolvedLbp = isRepChallenge && chosen
      ? (lbp?.chosenChallenges?.find(c => cleanChallengeName(c.name) === cleanChallengeName(it.name))?.lbp ?? 0)
      : it.lbp;

    return (
      <li className={`b-lin-row ${chosen ? "is-on" : ""}`}>
        <div className="b-lin-row-head">
          <button className="b-lin-toggle" onClick={() => onToggle(field, isRepChallenge && repParam ? `${it.baseName || it.name} (${repParam})` : (it.baseName || it.name))}
                  title={chosen ? "Remove" : "Take"}>{chosen ? "✓" : "+"}</button>
          <button className="b-lin-name" onClick={() => onInspect(it.name, field, kind === "challenge" ? "flaws" : "perks")}>
            {it.baseName || it.name}
            {it.required && <span className="b-lin-req">required</span>}
            {it.repped && <span className="b-lin-repped">repped</span>}
          </button>
          <span className={`b-lin-lbp ${kind === "challenge" ? "is-award" : "is-cost"}`}>
            {kind === "challenge" ? `+${resolvedLbp}` : `−${resolvedLbp}`} LBP
          </span>
        </div>
        {/* Lost Life / Additional Lost Life: pick which other-lineage [Repped]
            challenge you're repping — its LBP becomes this challenge's award. */}
        {isRepChallenge && chosen && (
          <div className="b-lin-rep-pick">
            <label className="b-lin-rep-label">Repping:</label>
            <select className="b-lin-rep-select" value={repParam}
                    onChange={(e) => onSetRep(field, it.baseName || it.name, e.target.value)}>
              <option value="">— choose a challenge to rep —</option>
              {repOptions.map(([linName, challenges]) => (
                <optgroup key={linName} label={linName}>
                  {challenges.map((c) => (
                    <option key={`${linName}:${c.baseName || c.name}`} value={c.baseName || c.name}>
                      {c.baseName || c.name} (+{c.lbp})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        )}
        {(it.desc || it.description) && <p className="b-lin-desc">{it.desc || it.description}</p>}
        {grantIds.length > 0 && (
          <p className="b-lin-grants">
            grants:{" "}
            {grantIds.map((id, i) => {
              const ent = lookupEntity(id);
              const type = id.slice(0, id.indexOf(":"));
              return (
                <button key={id} className="b-lin-grant-link"
                        onClick={() => onInspect(ent?.name || id.slice(id.indexOf(":") + 1), type, type)}>
                  {ent?.name || id.slice(id.indexOf(":") + 1)}{i < grantIds.length - 1 ? ", " : ""}
                </button>
              );
            })}
          </p>
        )}
        {it.name === "Divine Magic" && chosen && (
          <div style={{ marginTop: '0.5rem' }}>
            <label style={{ display: 'block', fontSize: '14px', marginBottom: '4px', color: '#666' }}>
              Select your free Cantrip:
            </label>
            <select
              className="b-spec-select"
              value={character.advantageChoices?.["Divine Magic"] || ""}
              onChange={(e) => onSetAdvantageChoice("Divine Magic", e.target.value)}
            >
              <option value="" disabled>Select a cantrip...</option>
              {DIVINE_CANTRIPS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}
      </li>
    );
  };

  return (
    <Overlay onClose={onClose} overlayClassName="b-overlay-dock" panelClassName="b-picker b-picker-dock" modal={false} closeOnBackdrop={false} ariaLabel="Lineage">
        <header className="b-picker-head">
          <div>
            <h2 className="b-picker-title">Lineage</h2>
            <p className="b-picker-sub">
              {lin ? `${character.lineage} · ${lbp.remaining} LBP left (${lbp.awarded} earned − ${lbp.spent} spent)${lbp.capped ? ", capped at 10" : ""}`
                   : "Choose your ancestry"}
            </p>
          </div>
          <button className="b-picker-x" aria-label="Close" onClick={onClose}>×</button>
        </header>

        {!lin && (
          <div className="b-lin-cards">
            {Object.entries(LINEAGES).map(([name, l]) => (
              <button key={name} className="b-lin-card" onClick={() => onSetLineage(name)}>
                <span className="b-lin-card-name">{name}</span>
                {l.description && <span className="b-lin-card-desc">{l.description}</span>}
                {l.sublineages?.length > 0 && (
                  <span className="b-lin-card-subs">
                    {l.sublineages.map((s) => (
                      <span key={typeof s === "string" ? s : s.name} className="b-lin-card-sub">
                        {typeof s === "string" ? s : s.name}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {lin && (
          <div className="b-lin-selectors">
            <select className="b-lin-select" value={character.lineage || ""}
                    onChange={(e) => onSetLineage(e.target.value)}>
              <option value="">— choose a lineage —</option>
              {Object.keys(LINEAGES).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            {lin?.sublineages?.length > 0 && (
              <div className="b-domain-chips">
                {lin.sublineages.map((s) => {
                  const label = typeof s === "string" ? s : s.name;
                  const on = character.sublineage === label;
                  return (
                    <button key={label} className={`b-domain-chip ${on ? "is-on" : ""}`}
                            onClick={() => onSetSublineage(label)}>{label}</button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {lin && (
          <>
            {!lbp.valid && (
              <p className="b-lin-flag">
                {lbp.overspent && `Over by ${lbp.spent - lbp.awarded} LBP. `}
                {lbp.mixedSublineage && "Items from more than one sublineage. "}
                {lbp.needsSublineage && `Select the ${lbp.requiredSublineages.join("/")} sublineage above to take its Challenges/Advantages. `}
                {lbp.missingRequired.length > 0 && `Required: ${lbp.missingRequired.map((c) => c.baseName).join(", ")}.`}
              </p>
            )}
            <div className="b-export-cols">
              <div className="b-export-half">
                <h3 className="b-export-label">Challenges — award LBP</h3>
                <ul className="b-lin-list">
                  {visible(lin.challenges).map((it) => <Row key={it.name} it={it} field="lineageChallenges" kind="challenge" />)}
                </ul>
              </div>
              <div className="b-export-half">
                <h3 className="b-export-label">Advantages — spend {lbp.remaining} LBP left</h3>
                <ul className="b-lin-list">
                  {visible(lin.advantages).map((it) => <Row key={it.name} it={it} field="lineageAdvantages" kind="advantage" />)}
                </ul>
              </div>
            </div>
          </>
        )}
    </Overlay>
  );
}
