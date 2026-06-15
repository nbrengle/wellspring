import React, { useEffect } from "react";
import { REFS, LINEAGES, lookupEntity } from "../data/index.js";
import { subKey } from "../data/validate.js";

export const cleanChallengeName = (s) => {
  const firstOpen = s.indexOf('(');
  const lastClose = s.lastIndexOf(')');
  let clean = s;
  if (firstOpen !== -1 && lastClose > firstOpen) {
    clean = (s.slice(0, firstOpen) + s.slice(lastClose + 1)).trim();
  }
  return clean.replace(/\s*\[[^\]]+\]/g, '').trim();
};

export default function LineagePanel({ character, report, onSetLineage, onSetSublineage, onToggle, onInspect, onClose }) {
  const lbp = report.lbp;
  const lin = character.lineage ? LINEAGES[character.lineage] : null;

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const picked = character.sublineage ? subKey(character.sublineage) : null;
  const visible = (items) => (items || []).filter((it) => {
    const k = subKey(it.sublineage);
    return !k || k === "general" || !picked || k === picked;
  });

  const Row = ({ it, field, kind }) => {
    const chosen = (character[field] || []).some(name => {
      return name === it.name || cleanChallengeName(name) === cleanChallengeName(it.name);
    });
    const srcId = `${kind === "challenge" ? "challenges" : "advantages"}:${character.lineage} - ${it.baseName || it.name}`;
    const grantIds = (REFS.grants || {})[srcId] || [];
    return (
      <li className={`b-lin-row ${chosen ? "is-on" : ""}`}>
        <div className="b-lin-row-head">
          <button className="b-lin-toggle" onClick={() => onToggle(field, it.name)}
                  title={chosen ? "Remove" : "Take"}>{chosen ? "✓" : "+"}</button>
          <button className="b-lin-name" onClick={() => onInspect(it.name, field, kind === "challenge" ? "flaws" : "perks")}>
            {it.baseName || it.name}
            {it.required && <span className="b-lin-req">required</span>}
            {it.repped && <span className="b-lin-repped">repped</span>}
          </button>
          <span className={`b-lin-lbp ${kind === "challenge" ? "is-award" : "is-cost"}`}>
            {kind === "challenge" ? `+${it.lbp}` : `−${it.lbp}`} LBP
          </span>
        </div>
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
      </li>
    );
  };

  return (
    <div className="b-overlay b-overlay-dock" role="dialog" aria-modal="false" aria-label="Lineage">
      <div className="b-picker b-picker-dock" onClick={(e) => e.stopPropagation()}>
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
      </div>
    </div>
  );
}
