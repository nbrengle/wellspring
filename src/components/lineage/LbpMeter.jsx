// The LBP balance gauge that anchors the focus view: challenges earn LBP,
// advantages spend it, and the books should BALANCE. This shows balance directly
// — a center line you sit on when even (green), a bar that pushes RIGHT when you've
// overspent (amber, "earn N more") and LEFT when you still have LBP to spend.
// It never pins or dies: the further out of balance, the further the bar slides,
// so "over by 2" and "over by 15" look clearly different.
//
// Calm by design: overspending reads as a neutral errand (amber), never an error —
// taking several advantages in a row should never feel like a mistake. Sublineage /
// required-item gaps surface as quiet notes beneath.

export default function LbpMeter({ lbp, costume }) {
  const { awarded, spent, remaining, cap, capped, bonusLbp } = lbp;
  const even = remaining === 0;
  const over = remaining < 0;
  // A persistent costuming-requirement chip (when the lineage carries one) keeps the
  // [Repped] requirement in view alongside the budget, not hidden in the About strip.
  const showCostume = costume && costume.req.minRepped > 0;

  // How far the bar reaches from center, as a % of each half. Scale by the larger
  // of the two sides so the gauge auto-fits the numbers in play and a small
  // imbalance still reads. Full half = you're off by your whole earned budget.
  const span = Math.max(awarded, spent, 1);
  const reach = Math.min((Math.abs(remaining) / span) * 100, 100);

  const notes = [];
  if (lbp.mixedSublineage) notes.push("Items from more than one sublineage.");
  if (lbp.needsSublineage)
    notes.push(`Select the ${lbp.requiredSublineages.join("/")} sublineage to take its options.`);
  if (lbp.missingRequired.length > 0) notes.push(`Required: ${lbp.missingRequired.map((c) => c.baseName).join(", ")}.`);

  const state = even ? "is-even" : over ? "is-over" : "is-under";

  return (
    <div className={`b-budget b-lin-budget ${state}`}>
      <div className="b-budget-head">
        <span className="b-budget-label">Lineage BP</span>
        <span className="b-budget-nums">
          <strong className="is-award">+{awarded}</strong> earned
          <span className="b-lin-bp-op"> · </span>
          <strong className="is-cost">−{spent}</strong> spent
          {capped && <span className="b-budget-flaws"> · capped {cap}</span>}
          {bonusLbp > 0 && <span className="b-budget-flaws"> · +{bonusLbp} bonus</span>}
        </span>
        {showCostume && (
          <span className={`b-lin-cost-chip ${costume.met ? "is-met" : "is-unmet"}`} title={costume.req.text}>
            🎭 {costume.met ? "costuming met" : costume.label}
          </span>
        )}
      </div>

      {/* Centered balance gauge: bar grows out from the middle tick. */}
      <div className="b-lin-gauge" role="presentation">
        <span className="b-lin-gauge-fill" style={{ width: `${reach / 2}%` }} />
        <span className="b-lin-gauge-tick" />
      </div>

      <p className="b-lin-gauge-foot">
        {even
          ? "Balanced — earned exactly covers spent"
          : over
            ? `Overspent by ${-remaining} — earn ${-remaining} more LBP`
            : `${remaining} LBP left to spend`}
      </p>
      {notes.length > 0 && <p className="b-lin-budget-note">{notes.join(" ")}</p>}
    </div>
  );
}
