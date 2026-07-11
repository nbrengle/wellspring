import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { createPortal } from "react-dom";
import { bestowSourceRole } from "./utils.js";

export function Stat({ label, value, title }) {
  return (
    <div className="b-stat" title={title}>
      <span className="b-stat-val">{value}</span>
      <span className="b-stat-label">{label}</span>
    </div>
  );
}

export function StatWithSources({
  label,
  value,
  title,
  base,
  baseLabel = "base",
  sources = [],
  onInspect,
  sublabel,
  extra,
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  // The breakdown is reachable whenever there's ANYTHING to explain — a base
  // value (e.g. Wealth's starting 8, or a pool's level base with no boosts yet),
  // contributing sources, or an `extra` section (a pool's interacting powers).
  // Previously base-only stats fell back to a plain, non-interactive tile, so
  // their explanation was unreachable.
  const hasBreakdown = base != null || sources.length > 0 || extra != null;
  if (!hasBreakdown) return <Stat label={label} value={value} title={title} />;
  return (
    <div className={`b-stat b-stat-interactive ${open ? "is-open" : ""}`}>
      <button
        ref={btnRef}
        className="b-stat-btn"
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-expanded={open}
        aria-label={`${label} breakdown`}
      >
        <span className="b-stat-val">{value}</span>
        <span className="b-stat-label">{label}</span>
        {sublabel && <span className="b-stat-sublabel">{sublabel}</span>}
      </button>
      {open && (
        <StatPopover anchorRef={btnRef} label={label} onClose={() => setOpen(false)}>
          <button className="b-stat-pop-x" aria-label="Close" onClick={() => setOpen(false)}>
            ×
          </button>
          <h4 className="b-stat-pop-title">{label} breakdown</h4>
          {(base != null || sources.length > 0) && (
            <ul className="b-stat-pop-list">
              {base != null && (
                <li className="b-stat-pop-row">
                  <span className="b-stat-pop-name">{baseLabel}</span>
                  <span className="b-stat-pop-n">{base}</span>
                </li>
              )}
              {sources.map((s, i) => (
                <li key={`${s.name}-${i}`} className="b-stat-pop-row">
                  {s.type && onInspect ? (
                    <button
                      className="b-stat-pop-link"
                      onClick={() => {
                        onInspect(s.name, null, s.type);
                        setOpen(false);
                      }}
                    >
                      {s.name}
                    </button>
                  ) : (
                    <span className="b-stat-pop-name">{s.name}</span>
                  )}
                  <span className="b-stat-pop-n">
                    {s.n >= 0 ? `+${s.n}` : s.n}
                    {s.note ? <span className="b-stat-pop-note"> {s.note}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {extra && (
            <div className="b-stat-pop-extra">{typeof extra === "function" ? extra(() => setOpen(false)) : extra}</div>
          )}
        </StatPopover>
      )}
    </div>
  );
}

// The breakdown popover is portalled to <body> and fixed-positioned under its
// trigger, so it escapes the identity rail's overflow clip (overflow-y:auto forces
// overflow-x to clip, which was shearing the right edge off). It pins under the
// button, sizes to its content, and shifts left if it would run off the viewport.
function StatPopover({ anchorRef, label, onClose, children }) {
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      const pop = popRef.current;
      if (!a || !pop) return;
      const w = pop.offsetWidth;
      const margin = 8;
      let left = a.left;
      if (left + w > window.innerWidth - margin) left = window.innerWidth - margin - w;
      if (left < margin) left = margin;
      setPos({ top: a.bottom + 5, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef]);

  useEffect(() => {
    const onDown = (e) => {
      if (popRef.current?.contains(e.target) || anchorRef.current?.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchorRef, onClose]);

  // Portal into the themed .b-root (not document.body) so the popover keeps the
  // builder's CSS custom properties (--b-panel etc.) — on <body> those vars are
  // undefined, leaving the popover transparent so the page bleeds through. .b-root
  // has no overflow clip, so the popover still escapes the identity rail's clip.
  const host =
    (typeof document !== "undefined" && document.querySelector(".b-root")) ||
    (typeof document !== "undefined" ? document.body : null);
  if (!host) return null;
  return createPortal(
    <div
      ref={popRef}
      className="b-stat-pop"
      role="dialog"
      aria-label={`${label} sources`}
      style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
    >
      {children}
    </div>,
    host,
  );
}

export function Section({ title, tone = "amber", onAdd, children }) {
  return (
    <section className="b-section">
      <h2 className={`b-section-title b-section-${tone}`}>
        {title}
        {onAdd && (
          <button className="b-section-add" onClick={onAdd} title={`Add ${title.toLowerCase()}`}>
            + add
          </button>
        )}
      </h2>
      <div className="b-section-body">{children}</div>
    </section>
  );
}

export function CostBadge({ cost }) {
  if (!cost) return null;
  if (cost.cost < 0) return <span className="b-row-bp is-award">+{-cost.cost} BP</span>;
  if (!(cost.base > 0)) return null;
  if (cost.cost === 0 && cost.bestow?.source) {
    const role = bestowSourceRole(cost.bestow);
    return (
      <span className="b-row-bp is-free" title={`Granted by ${cost.bestow.source}${role ? ` (${role})` : ""}`}>
        free · {cost.bestow.source}
        {role && <span className="b-row-role"> ({role})</span>}
      </span>
    );
  }
  if (cost.discount) {
    return (
      <span
        className="b-row-bp is-discounted"
        title={`${cost.base} BP, discounted ${cost.discount.amount} by ${cost.discount.source}`}
      >
        <span className="b-row-final-cost">{cost.cost} BP</span>
        <span className="b-row-disc">
          {" "}
          (base {cost.base}, −{cost.discount.amount} {cost.discount.source})
        </span>
      </span>
    );
  }
  return (
    <span className={`b-row-bp ${cost.cost === 0 ? "is-free" : ""}`}>
      {cost.cost === 0 ? "free" : `${cost.cost} BP`}
    </span>
  );
}
