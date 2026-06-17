import React, { useState } from "react";
import { useBuilderState, useBuilderActions } from "../builder-context.jsx";
import { grantSourceRole } from "./utils.js";

export function Stat({ label, value, title }) {
  return (
    <div className="b-stat" title={title}>
      <span className="b-stat-val">{value}</span>
      <span className="b-stat-label">{label}</span>
    </div>
  );
}

export function StatWithSources({ label, value, title, base, baseLabel = "base", sources = [], onInspect }) {
  const [open, setOpen] = useState(false);
  const hasBreakdown = sources.length > 0;
  if (!hasBreakdown) return <Stat label={label} value={value} title={title} />;
  return (
    <div className={`b-stat b-stat-interactive ${open ? "is-open" : ""}`}>
      <button className="b-stat-btn" onClick={() => setOpen((o) => !o)}
              title={title} aria-expanded={open} aria-label={`${label} breakdown`}>
        <span className="b-stat-val">{value}</span>
        <span className="b-stat-label">{label} <span className="b-stat-caret">ⓘ</span></span>
      </button>
      {open && (
        <div className="b-stat-pop" role="dialog" aria-label={`${label} sources`}>
          <button className="b-stat-pop-x" aria-label="Close" onClick={() => setOpen(false)}>×</button>
          <h4 className="b-stat-pop-title">{label} breakdown</h4>
          <ul className="b-stat-pop-list">
            {base != null && (
              <li className="b-stat-pop-row">
                <span className="b-stat-pop-name">{baseLabel}</span>
                <span className="b-stat-pop-n">{base}</span>
              </li>
            )}
            {sources.map((s, i) => (
              <li key={`${s.name}-${i}`} className="b-stat-pop-row">
                {s.type && onInspect
                  ? <button className="b-stat-pop-link" onClick={() => { onInspect(s.name, null, s.type); setOpen(false); }}>{s.name}</button>
                  : <span className="b-stat-pop-name">{s.name}</span>}
                <span className="b-stat-pop-n">{s.n >= 0 ? `+${s.n}` : s.n}{s.note ? <span className="b-stat-pop-note"> {s.note}</span> : null}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function Section({ title, tone = "amber", onAdd, children }) {
  return (
    <section className="b-section">
      <h2 className={`b-section-title b-section-${tone}`}>
        {title}
        {onAdd && <button className="b-section-add" onClick={onAdd} title={`Add ${title.toLowerCase()}`}>+ add</button>}
      </h2>
      <div className="b-section-body">{children}</div>
    </section>
  );
}

export function CostBadge({ cost }) {
  if (!cost) return null;
  if (cost.cost < 0) return <span className="b-row-bp is-award">+{-cost.cost} BP</span>;
  if (!(cost.base > 0)) return null;
  if (cost.cost === 0 && cost.grant?.source) {
    const role = grantSourceRole(cost.grant);
    return (
      <span className="b-row-bp is-free" title={`Granted by ${cost.grant.source}${role ? ` (${role})` : ""}`}>
        free · {cost.grant.source}{role && <span className="b-row-role"> ({role})</span>}
      </span>
    );
  }
  if (cost.discount) {
    return (
      <span className="b-row-bp is-discounted"
            title={`${cost.base} BP, discounted ${cost.discount.amount} by ${cost.discount.source}`}>
        {cost.cost} BP <span className="b-row-disc">−{cost.discount.amount} · {cost.discount.source}</span>
      </span>
    );
  }
  return <span className={`b-row-bp ${cost.cost === 0 ? "is-free" : ""}`}>{cost.cost === 0 ? "free" : `${cost.cost} BP`}</span>;
}


