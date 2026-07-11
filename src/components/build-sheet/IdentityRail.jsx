import { useBuilderState, useBuilderActions } from "../builder-context.jsx";
import { StatWithSources, Stat } from "./SharedUI.jsx";
import { statTitle, statSources, sourceType, CLASS_TONES } from "./utils.js";
import { getClasses } from "../../engine/resolver.js";
import { EVENTS_TABLE } from "../../engine/data.js";
import { MAX_DOMAINS } from "../../engine/validate.js";

const DEFAULT_WEALTH = 8;

export function IdentityRail() {
  const { character, report } = useBuilderState();
  const { onClickField, onRestart, onSetClassLevel, onRemoveClass, onAddClass, onOpenLineage, onInspect, onSetEvent } =
    useBuilderActions();
  const classes = getClasses(character);
  return (
    <aside className="b-rail b-rail-left">
      <header className="b-rail-header">
        <h2 className="b-rail-title">Identity</h2>
        {character.archetypeName && (
          <p className="b-rail-sub">
            Based on <em>{character.archetypeName}</em>
          </p>
        )}
      </header>

      {/* Event Selector card */}
      <div className="b-id-card is-set">
        <span className="b-id-icon">📅</span>
        <span className="b-id-body">
          <span className="b-id-label">Active Campaign Event</span>
          <select
            className="b-event-select"
            value={character.currentEvent || 1}
            onChange={(e) => onSetEvent && onSetEvent(parseInt(e.target.value, 10))}
          >
            {EVENTS_TABLE.map((evt) => (
              <option key={evt.event} value={evt.event}>
                Event {evt.event} (Level Floor {evt.level})
              </option>
            ))}
          </select>
        </span>
      </div>

      <ClassCard
        classes={classes}
        spec={character.specialization}
        onSetLevel={onSetClassLevel}
        onRemove={onRemoveClass}
        onAdd={onAddClass}
        onInspect={() => onClickField("class")}
      />

      {/* Lineage card */}
      <button className={`b-id-card ${character.lineage ? "is-set" : "is-empty"}`} onClick={onOpenLineage}>
        <span className="b-id-icon">🧬</span>
        <span className="b-id-body">
          <span className="b-id-label">Lineage</span>
          <span className="b-id-value">{character.lineage || <em>+ choose a lineage</em>}</span>
          {character.sublineage && <span className="b-id-sub">{character.sublineage}</span>}
          {report.lbp && (report.lbp.chosenChallenges.length > 0 || report.lbp.chosenAdvantages.length > 0) && (
            <span
              className={`b-id-sub ${report.lbp.valid ? "" : "b-lbp-warn"}`}
              title={`${report.lbp.awarded} LBP earned from challenges − ${report.lbp.spent} spent on advantages`}
            >
              {report.lbp.remaining} LBP left
            </span>
          )}
        </span>
      </button>

      <DevotionCard />

      <div className="b-stat-strip">
        <StatWithSources
          label="Life"
          title={statTitle(report.stats, "lifePoints", "Life Points")}
          value={report.stats?.lifePoints ?? character.lifePoints ?? "—"}
          base={report.stats?.baseLifePoints}
          baseLabel={`level ${report.level} base`}
          sources={statSources(report.stats, "lifePoints")}
          onInspect={onInspect}
        />
        <StatWithSources
          label="Spikes"
          title={statTitle(report.stats, "spikes", "Maximum Spikes")}
          value={report.stats?.spikes ?? character.spikes ?? "—"}
          base={report.stats?.baseSpikes}
          baseLabel={`level ${report.level} base`}
          sources={statSources(report.stats, "spikes")}
          onInspect={onInspect}
        />
        {(() => {
          const physStr = character.armorPoints ? String(character.armorPoints) : "";
          const physInput = parseInt(physStr.match(/^\s*(\d+)/)?.[1] ?? "0", 10);

          const armorSrcRows = statSources(report.stats, "armor");
          const physSkill = Math.max(0, ...armorSrcRows.map((s) => s.n));
          const phys = Math.max(physInput, physSkill);

          const natSrcRows = statSources(report.stats, "naturalArmor");
          const natFixed = Math.max(0, ...natSrcRows.map((s) => s.n));
          const natNotes = (report.stats?.mods?.notes || []).filter((n) => n.stat === "naturalArmor");

          const hasNat = natFixed > 0 || natNotes.length > 0;
          let value, type;
          if (hasNat && (natFixed > phys || (natNotes.length && phys === 0))) {
            value = natFixed > 0 ? String(natFixed) : "※";
            type = "natural";
          } else {
            value = String(phys);
            type = phys > 0 ? "physical" : "—";
          }
          const sources = [];
          if (physInput > 0)
            sources.push({
              name: "Manual Entry",
              n: physInput,
              note: type === "physical" && physInput === phys ? "in use" : "not in use",
            });
          for (const s of armorSrcRows)
            sources.push({ ...s, note: `physical${type === "physical" && s.n === phys ? ", in use" : ""}` });
          for (const s of natSrcRows)
            sources.push({ ...s, note: `natural${type === "natural" && s.n === natFixed ? ", in use" : ""}` });
          for (const n of natNotes)
            sources.push({ name: n.name, n: 0, note: "natural, variable", type: sourceType(n.name) });

          const tip =
            hasNat || armorSrcRows.length > 0
              ? `Armor doesn't stack — pick one. Showing best (${type}). Sources: ${sources.map((s) => `${s.n} ${s.name} (${s.note})`).join(", ")}`
              : physStr || "Physical Armor Points";

          return <StatWithSources label="Armor" title={tip} value={value} sources={sources} onInspect={onInspect} />;
        })()}
        {(() => {
          const w = report.wealth || {
            base: character.wealth ?? DEFAULT_WEALTH,
            income: 0,
            total: character.wealth ?? DEFAULT_WEALTH,
            sources: [],
          };
          const tip =
            w.income > 0
              ? `Wealth at your first event: ${w.base} starting + ${w.income} from sources = ${w.total}.`
              : "Wealth at your first event (default 8 starting; perks/professions add income).";
          return (
            <StatWithSources
              label="Wealth"
              title={tip}
              value={w.income > 0 ? `${w.total}` : w.base}
              base={w.base}
              baseLabel="starting"
              sources={w.sources.map((s) => ({
                name: s.source,
                n: s.amount,
                note: s.note,
                type: sourceType(s.source),
              }))}
              onInspect={onInspect}
            />
          );
        })()}
        {character.resources && (
          <Stat
            label="Resources"
            title="Resources available to the character (free-form; from the sheet)."
            value={character.resources}
          />
        )}
      </div>

      {/* Class pools (Healing Touch, Living Iron, …) get their OWN row of tiles
          below the core stats, styled identically and tagged "pool". */}
      {report.pools?.length > 0 && (
        <div className="b-stat-strip b-pool-strip">
          {report.pools.map((pool) => (
            <PoolTile key={pool.id} pool={pool} onInspect={onInspect} />
          ))}
        </div>
      )}

      {report.spellSlots &&
        Object.entries(report.spellSlots).map(([magicType, slots]) => (
          <SpellSlotStrip
            key={magicType}
            magicType={Object.keys(report.spellSlots).length > 1 ? magicType : null}
            slots={slots}
          />
        ))}

      <BudgetMeter />

      <button className="b-restart" onClick={onRestart}>
        <span className="b-restart-icon">↺</span> Start over
      </button>
    </aside>
  );
}

function ClassCard({ classes, spec, onSetLevel, onRemove, onAdd, onInspect }) {
  return (
    <div className="b-id-card b-class-card is-set">
      <span className="b-id-icon">⚔</span>
      <span className="b-id-body">
        <span className="b-id-label">{classes.length > 1 ? "Classes" : "Class"}</span>
        {classes.length === 0 && (
          <span className="b-id-value">
            <em>not set</em>
          </span>
        )}
        {classes.map((c, i) => (
          <span key={c.name} className="b-class-row">
            <button
              className="b-class-name"
              onClick={() => onInspect(c.name)}
              title="Inspect class"
              style={{ color: CLASS_TONES[c.name] ? `var(--b-${CLASS_TONES[c.name]})` : undefined }}
            >
              {c.name}
              {i === 0 && spec ? ` (${spec})` : ""}
            </button>
            <span className="b-class-lvl">
              <button
                className="b-level-btn"
                disabled={c.level <= 1}
                aria-label={`Lower ${c.name} level`}
                onClick={() => onSetLevel(c.name, c.level - 1)}
              >
                −
              </button>
              <strong>{c.level}</strong>
              <button
                className="b-level-btn"
                aria-label={`Raise ${c.name} level`}
                onClick={() => onSetLevel(c.name, c.level + 1)}
              >
                +
              </button>
            </span>
            {classes.length > 1 && (
              <button
                className="b-class-remove"
                title="Remove class"
                aria-label={`Remove ${c.name}`}
                onClick={() => onRemove(c.name)}
              >
                ×
              </button>
            )}
          </span>
        ))}
        <button className="b-class-add" onClick={onAdd}>
          + add class
        </button>
      </span>
    </div>
  );
}

function DevotionCard() {
  const { character, report } = useBuilderState();
  const { onPickDevotion: onPick, onToggleDomain, onClearDevotion: onClear, onClickField } = useBuilderActions();
  const devotion = report.devotion;
  const onInspect = () => onClickField("devotion");
  if (!character.devotion || !devotion) {
    return (
      <button className="b-id-card is-empty" onClick={onPick}>
        <span className="b-id-icon">🌟</span>
        <span className="b-id-body">
          <span className="b-id-label">Devotion</span>
          <span className="b-id-value">
            <em>+ choose a devotion</em>
          </span>
        </span>
      </button>
    );
  }
  const { available, chosen, worship } = devotion;
  return (
    <div className="b-id-card b-devotion-card is-set">
      <span className="b-id-icon">🌟</span>
      <span className="b-id-body">
        <span className="b-id-label">Devotion</span>
        <span className="b-devotion-head">
          <button className="b-class-name" onClick={onInspect} title="Inspect devotion">
            {character.devotion}
          </button>
          <button className="b-class-remove" title="Clear devotion" aria-label="Clear devotion" onClick={onClear}>
            ×
          </button>
        </span>
        {available.length > 0 && (
          <>
            <span className="b-devotion-sub">
              Domains ({chosen.length}/{MAX_DOMAINS}):
            </span>
            <span className="b-domain-chips">
              {available.map((d) => {
                const on = chosen.includes(d);
                const full = chosen.length >= MAX_DOMAINS && !on;
                return (
                  <button
                    key={d}
                    disabled={full}
                    className={`b-domain-chip ${on ? "is-on" : ""}`}
                    onClick={() => onToggleDomain(d)}
                    title={full ? `Pick up to ${MAX_DOMAINS} domains` : on ? "Remove domain" : "Add domain"}
                  >
                    {d}
                  </button>
                );
              })}
            </span>
          </>
        )}
        {!worship && <span className="b-devotion-flag">⚑ needs Worship skill to buy domain powers</span>}
        <button className="b-class-add" onClick={onPick}>
          change devotion
        </button>
      </span>
    </div>
  );
}

function SpellSlotStrip({ magicType, slots }) {
  const tiers = [
    { key: "novice", label: "Novice" },
    { key: "adept", label: "Adept" },
    { key: "greater", label: "Greater" },
  ];
  return (
    <div className="b-spellslots">
      <span className="b-spellslots-label">{magicType ? `${magicType} Spell Slots` : "Spell Slots"}</span>
      <div className="b-spellslots-row">
        {tiers.map((t) => (
          <div key={t.key} className={`b-spellslot b-tier-${t.key} ${slots[t.key] ? "" : "is-zero"}`}>
            <span className="b-spellslot-val">{slots[t.key]}</span>
            <span className="b-spellslot-label">{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// A class pool (Healing Touch Pool, Living Iron Pool, …): its computed maximum
// with a base+sources breakdown (permanent augments fold into the max), plus the
// powers that refill / spend from it. Reads report.pools entries (read-layer shape).
// A class pool renders as a stat tile in the strip (same look as Life/Armor) with
// a "pool" sublabel so it reads as a pool, not a raw stat. Its ⓘ breakdown shows
// the max composition (base + permanent boosts, like Armor's sources) AND the
// powers that refill / spend from it — all in the popover, so the tile keeps the
// strip's footprint instead of sprawling its own card.
function PoolTile({ pool, onInspect }) {
  const { max } = pool;
  const sources = (max.sources || []).map((s) => ({ name: s.name, n: s.amount, type: "powers" }));
  const refills = pool.refills || [];
  const spends = pool.spends || [];
  const title =
    max.total != null
      ? `${pool.name}: ${max.total} max (${max.base} base${sources.length ? " + permanent boosts" : ""}). Resets each rest.`
      : `${pool.name}: size depends on rules not yet derivable.`;

  const powersSection =
    refills.length > 0 || spends.length > 0
      ? (close) => (
          <>
            <h4 className="b-stat-pop-title b-stat-pop-subhead">Interacts with</h4>
            <ul className="b-pool-powers">
              {spends.map((p) => (
                <li key={`s-${p.name}`} className="b-pool-power">
                  <span className="b-pool-power-tag is-spend">spends</span>
                  <button
                    className="b-pool-power-link"
                    onClick={() => {
                      onInspect?.(p.name, null, "powers");
                      close();
                    }}
                  >
                    {p.name}
                  </button>
                </li>
              ))}
              {refills.map((p) => (
                <li key={`r-${p.name}`} className="b-pool-power">
                  <span className="b-pool-power-tag is-refill">refills</span>
                  <button
                    className="b-pool-power-link"
                    onClick={() => {
                      onInspect?.(p.name, null, "powers");
                      close();
                    }}
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )
      : null;

  return (
    <StatWithSources
      label={pool.name.replace(/ Pool$/, "")}
      sublabel="pool"
      title={title}
      value={max.total ?? "?"}
      base={max.base ?? undefined}
      baseLabel={`level ${pool.classLevel} base`}
      sources={sources}
      extra={powersSection}
      onInspect={onInspect}
    />
  );
}

function BudgetMeter() {
  const { character, report } = useBuilderState();
  const { onToggleBackstory, onSetExtraBP } = useBuilderActions();
  const { spend, budget, remaining, overBudget } = report;
  const pct = budget ? Math.min(100, (spend.net / budget) * 100) : 0;

  const refundsByClass = {};
  if (report.multiclassBestows?.freeBPItems) {
    for (const item of report.multiclassBestows.freeBPItems) {
      const clsName = item.source;
      refundsByClass[clsName] = (refundsByClass[clsName] || 0) + item.bp;
    }
  }

  return (
    <div className={`b-budget ${overBudget ? "is-over" : ""}`}>
      <div className="b-budget-head">
        <span className="b-budget-label">Build Points</span>
        <span className="b-budget-nums">
          <strong>{spend.net}</strong> / {budget}
          {spend.awarded > 0 && (
            <span className="b-budget-flaws">
              {" "}
              (+{spend.awarded} from flaws{spend.flawCapped ? ", capped at 5" : ""})
            </span>
          )}
          {Object.entries(refundsByClass).map(
            ([clsName, amount]) =>
              amount > 0 && (
                <span key={clsName} className="b-budget-flaws">
                  {" "}
                  +{amount} {clsName}
                </span>
              ),
          )}
          {report.backstoryBP > 0 && <span className="b-budget-flaws"> +{report.backstoryBP} backstory</span>}
          {character.extraMaxBP > 0 && <span className="b-budget-flaws"> +{character.extraMaxBP} extra</span>}
        </span>
      </div>
      <div className="b-budget-bar">
        <div className="b-budget-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="b-budget-foot">{overBudget ? `${-remaining} BP over budget` : `${remaining} BP remaining`}</p>
      <div className="b-budget-extra-row">
        {onToggleBackstory && (
          <label className="b-budget-backstory" title="Approved backstories grant +2 BP (submit to the plot team).">
            <input type="checkbox" checked={!!character?.backstoryApproved} onChange={onToggleBackstory} />
            <span>
              Approved backstory <span className="b-budget-flaws">+2 BP</span>
            </span>
          </label>
        )}
        {onSetExtraBP && (
          <div
            className="b-budget-extra-control"
            title="Add extra Build Points (e.g. from service points, NPC shifts, or donations)."
          >
            <span>Extra BP:</span>
            <input
              type="number"
              className="b-extra-bp-input"
              value={character.extraMaxBP || 0}
              min="0"
              max="100"
              onChange={(e) => onSetExtraBP(Math.max(0, parseInt(e.target.value, 10) || 0))}
            />
          </div>
        )}
      </div>
    </div>
  );
}
