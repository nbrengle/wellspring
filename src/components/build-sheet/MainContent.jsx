import React, { useMemo } from "react";
import { useBuilderState, useBuilderActions } from "../builder-context.jsx";
import { Section, CostBadge } from "./SharedUI.jsx";
import SubSelect from "../SubSelect.jsx";
import { spellTierKey, spellTierLabel } from "./utils.js";
import { ALL_SKILLS, LINEAGES, CRAFTING, RITUALS, CLASSES, DOMAINS, lookupEntity } from "../../engine/data.js";
import { getMaxRanks, pickClass, agileLearnerCapacity } from "../../engine/validate.js";
import { bareSkill, getClasses, cleanItemName } from "../../engine/resolver.js";
import { lookupCost } from "../../engine/validate/cost-key.js";
import { STARTING_CHOICES_CONFIG, reconcileStartingChoices } from "../../engine/starting-choices.js";
import { UNLIMITED_SKILLS } from "../../engine/data.js";
import Tag from "./Tag.jsx";
import InspectableRow from "./InspectableRow.jsx";
import InlineDetail from "./InlineDetail.jsx";

const SLOT_FIELD = {
  utility: "utilityPowers",
  basic: "basicPowers",
  advanced: "advancedPowers",
  veteran: "veteranPowers",
  cantrips: "cantrips",
  spellsKnown: "noviceSpells",
};

const SPELL_TIER_LABEL = {
  noviceSpells: "Novice", adeptSpells: "Adept", greaterSpells: "Greater", cantrips: "Cantrip",
};

export function LineageSummary() {
  const { character, report } = useBuilderState();
  const { onOpenLineage } = useBuilderActions();
  if (!character.lineage) return null;
  const lbp = report.lbp;
  const chosen = lbp?.chosenAdvantages || [];
  const grantedBySource = {};
  for (const g of (report.grantedAbilities?.list || [])) {
    if (g.sourceKind !== "advantage") continue;
    (grantedBySource[g.source] = grantedBySource[g.source] || []).push(g);
  }
  const challenges = lbp?.chosenChallenges || [];
  const title = `Lineage — ${character.lineage}${character.sublineage ? ` · ${character.sublineage}` : ""}`;
  return (
    <Section title={title} tone="green" onAdd={onOpenLineage}>
      {challenges.length === 0 && chosen.length === 0 && (
        <p className="b-empty">No challenges or advantages chosen yet.</p>
      )}
      {challenges.length > 0 && (
        <>
          <h3 className="b-lin-subhead">Challenges <span className="b-lin-subhead-note">award LBP</span></h3>
          <ul className="b-rows">
            {challenges.map((ch, i) => {
              const name = ch.baseName || ch.name;
              return (
                <InspectableRow key={`ch-${i}-${name}`} item={name} field="lineageChallenges" resolveType="flaws" className="b-lin-adv-row">
                  {ch.required && <span className="b-row-badge b-badge-granted">required</span>}
                  <span className="b-row-bp is-award">+{ch.lbp} LBP</span>
                </InspectableRow>
              );
            })}
          </ul>
        </>
      )}
      {chosen.length > 0 && (
        <h3 className="b-lin-subhead">Advantages <span className="b-lin-subhead-note">spend LBP</span></h3>
      )}
      <ul className="b-rows">
        {chosen.map((adv, i) => {
          const name = adv.baseName || adv.name;
          const grants = grantedBySource[name] || [];
          return (
            <React.Fragment key={`adv-${i}-${name}`}>
              <InspectableRow item={name} field="lineageAdvantages" resolveType="perks" className="b-lin-adv-row">
                <span className="b-row-bp is-cost">−{adv.lbp} LBP</span>
              </InspectableRow>
              {grants.map((g) => (
                <InspectableRow key={g.ability} item={g.abilityName} field={g.abilityType} resolveType={g.abilityType}
                                className="b-lin-grant-row" label={<>↳ {g.abilityName}</>}>
                  <span className="b-row-bp is-free" title={`Granted by ${g.source}`}>free · {g.source}</span>
                </InspectableRow>
              ))}
            </React.Fragment>
          );
        })}
      </ul>
    </Section>
  );
}

export function StartingChoicesSection() {
  const { character } = useBuilderState();
  const { onSetSpecialty } = useBuilderActions();
  const primary = getClasses(character)[0]?.name;
  const configs = (primary && STARTING_CHOICES_CONFIG[primary]) || [];
  const selected = useMemo(() => {
    if (!primary || !configs.length) return {};
    const have = character.startingChoices && Object.keys(character.startingChoices).length;
    return have ? character.startingChoices : reconcileStartingChoices(character, primary);
  }, [character.startingChoices, character.startingSkills, character.ranks?.startingSkills, primary, configs.length]);

  if (!primary || !configs.length) return null;

  return (
    <Section title="Starting Choices" tone="amber">
      <p className="b-spec-hint">
        Your {primary} made {configs.length > 1 ? `${configs.length} choices` : "a choice"} at
        character creation. Change one to swap the free abilities it grants.
      </p>
      <ul className="b-spec-list">
        {configs.map((conf) => (
          <li key={conf.id} className="b-spec-row">
            {/* Starting choices always have a value (they default to the first
                option), so no "Choose" badge — but the shared chip control keeps
                them visually consistent with every other sub-selection. */}
            <SubSelect
              prompt={conf.label}
              showBadge={false}
              allowClear={false}
              value={selected[conf.id] ?? conf.options[0]?.label ?? ""}
              onChange={(v) => v && onSetSpecialty(conf.id, v)}
              options={conf.options.map((opt) => ({ value: opt.label }))}
            />
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function CraftingSection({ crafting }) {
  const groups = [
    ...crafting.crafting.map((c) => ({
      key: c.discipline, label: `${c.discipline} — ${c.tier}`,
      resolveType: "recipes", recipes: c.recipes,
    })),
    ...(crafting.rituals ? [{
      key: "Rituals", label: `Rituals — ${crafting.rituals.tier} Ritual Magic`,
      resolveType: "rituals", recipes: crafting.rituals.recipes,
    }] : []),
  ];
  return (
    <Section title="Can Craft" tone="teal">
      {groups.map((g) => (
        <div key={g.key} className="b-craft-group">
          <h3 className="b-craft-head">{g.label} <span className="b-craft-count">{g.recipes.length}</span></h3>
          <ul className="b-craft-list">
            {g.recipes.map((r) => (
              <InspectableRow key={r.name} item={r.name} field={null} resolveType={g.resolveType} className="b-craft-row">
                <span className="b-craft-tier">{r.tier}</span>
              </InspectableRow>
            ))}
          </ul>
        </div>
      ))}
    </Section>
  );
}


function getSelectionOptions(sel) {
  const opts = [];
  if (sel.type === "power" && sel.source === "BaseClasses") {
    for (const c of Object.values(CLASSES)) {
      if (c.name === sel.excludeClass) continue;
      const tierArray = c[sel.tier?.toLowerCase()] || [];
      for (const p of tierArray) {
        opts.push(`${p.name} (${c.name})`);
      }
    }
  } else if (sel.type === "spell") {
    for (const c of Object.values(CLASSES)) {
      if (!c.spellSphere || c.spellSphere !== sel.sphere) continue;
      if (sel.tier === "Cantrip") {
         const tierArray = c.cantrips || [];
         for (const s of tierArray) opts.push(`${s.name} (${c.name})`);
      } else {
         const allSpells = [...(c.noviceSpells||[]), ...(c.adeptSpells||[]), ...(c.greaterSpells||[])];
         for (const s of allSpells) opts.push(`${s.name} (${c.name})`);
      }
    }
  } else if (sel.type === "devotionAccent") {
    for (const d of Object.values(DOMAINS)) {
      if (d.accents) {
        for (const a of d.accents) opts.push(`${a.name} (${d.name})`);
      }
    }
  }
  return opts.sort();
}

export function GrantedSelectionsSection() {
  const { character, report } = useBuilderState();
  const { onSetGrantedSelection } = useBuilderActions();
  const active = report.activeSelections || [];
  if (active.length === 0) return null;

  return (
    <Section title="Granted Selections" tone="purple">
      <ul className="b-choices">
        {active.map((sel, i) => {
          const value = character.grantedSelections?.[sel.id] || "";
          const options = getSelectionOptions(sel);
          const typeLabel = sel.type === "devotionAccent" ? "Devotion Accent" : sel.type;
          return (
            <li key={i} className="b-choice-row">
              {/* A granted selection can be unmade (value ""), so the chip control's
                  "Choose" badge surfaces it — the easy-to-miss case the user flagged. */}
              <SubSelect
                prompt={<>{sel.sourceName} <span className="b-choice-desc">({typeLabel})</span></>}
                value={value || null}
                onChange={(v) => onSetGrantedSelection(sel.id, v || "")}
                options={options.map((opt) => ({ value: opt }))}
              />
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export function AgileLearnerSection() {
  const { character } = useBuilderState();
  const { onSetAgileLearnerTrade } = useBuilderActions();

  // Owned Agile Learner ranks = the number of trades available (engine is the
  // single source of truth, so the UI cap matches what computeSlots enforces).
  const rank = agileLearnerCapacity(character);

  if (!rank) return null;

  const trades = character.agileLearnerTrades || {};
  const used = Object.values(trades).reduce((a, b) => a + b, 0);
  const available = rank - used;
  const classes = getClasses(character);

  const addTrade = (cls) => onSetAgileLearnerTrade(cls, 1);
  const removeTrade = (cls) => onSetAgileLearnerTrade(cls, -1);

  return (
    <div className="b-slot-block">
      <div className="b-slot-head">
        <h3 className="b-slot-label">Agile Learner Trades</h3>
        <span className="b-slot-count">{used} / {rank}</span>
      </div>
      <ul className="b-rows" style={{ marginTop: '0.5rem' }}>
        {classes.map(c => {
           const classTrades = trades[c.name] || 0;
           return (
             <li key={c.name} className="b-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               <span>{c.name} <em style={{opacity:0.7, paddingLeft: '0.5rem'}}>(trade 1st-tier for 2nd-tier)</em></span>
               <div className="b-row-rank-adjust">
                 <button className="b-rank-btn" type="button" onClick={() => removeTrade(c.name)} disabled={classTrades <= 0}>-</button>
                 <span className="b-rank-val" style={{ margin: '0 0.5rem' }}>{classTrades}</span>
                 <button className="b-rank-btn" type="button" onClick={() => addTrade(c.name)} disabled={available <= 0}>+</button>
               </div>
             </li>
           );
        })}
      </ul>
    </div>

  );
}

export function SlotBlock({ slot, pickClassOf }) {
  const { character, view } = useBuilderState();
  const { onInspect, onOpenSlot } = useBuilderActions();
  const isFocused = (item, field) =>
    view?.mode === "inspect" && view.item === item && view.field === field;
  const fields = slot.category === "spellsKnown"
    ? ["noviceSpells", "adeptSpells", "greaterSpells"]
    : [SLOT_FIELD[slot.category]];
  const granted = slot.granted || [];
  const grantedSet = new Set(granted);
  const myPicks = fields.flatMap((field) =>
    (character[field] || [])
      .map((name, flatIndex) => ({ name, flatIndex, field }))
      .filter((p) => pickClassOf(field, p.flatIndex, p.name) === slot.cls && !grantedSet.has(p.name)));

  const rowCount = Math.max(slot.allowed, myPicks.length);
  if (rowCount === 0 && granted.length === 0) return null;
  const rows = Array.from({ length: rowCount }, (_, i) => myPicks[i] ?? null);
  const state = slot.over ? "is-over" : slot.used === slot.allowed && slot.allowed > 0 ? "is-full" : "";

  return (
    <div className={`b-slot-block ${state}`}>
      <div className="b-slot-head">
        <h3 className="b-slot-label">{slot.label}</h3>
        {slot.bonusFrom?.length > 0 && (
          <span className="b-slot-bonus" title={`+${slot.bonus} bonus slot${slot.bonus === 1 ? "" : "s"} from ${slot.bonusFrom.join(", ")}`}>
            +{slot.bonus} from {slot.bonusFrom.join(", ")}
          </span>
        )}
        <span className="b-slot-count">{slot.used} / {slot.allowed}</span>
      </div>
      <ol className="b-slot-rows">
        {granted.map((name) => (
            <React.Fragment key={`granted-${name}`}>
              {(() => {
                const ent = lookupEntity(`powers:${name}`);
                const tags = ent?.tags || [];
                return (
                  <li className="b-slot-row is-filled is-granted">
                    <span className="b-slot-num" title="Granted by class">★</span>
                    <button className="b-slot-pick" onClick={() => onInspect(name, fields[0], "powers")}>{name}</button>
                    {tags.map((t) => <span key={t} className="b-picker-row-tag b-data">{t}</span>)}
                    <span className="b-slot-tier b-slot-granted-tag">innate</span>
                  </li>
                );
              })()}
            <InlineDetail item={name} field={fields[0]} />
          </React.Fragment>
        ))}
        {rows.map((pick, i) => {
          const over = i >= slot.allowed;
          if (pick) {
            return (
              <React.Fragment key={i}>
                {(() => {
                  const ent = lookupEntity(`powers:${pick.name}`);
                  const tags = ent?.tags || [];
                  return (
                    <li className={`b-slot-row is-filled ${over ? "is-over" : ""} ${isFocused(pick.name, pick.field) ? "is-focused" : ""}`}>
                      <span className="b-slot-num">{i + 1}</span>
                      <button className="b-slot-pick" onClick={() => onInspect(pick.name, pick.field, "powers")}>{pick.name}</button>
                      {tags.map((t) => <span key={t} className="b-picker-row-tag b-data">{t}</span>)}
                      {slot.category === "spellsKnown" && spellTierKey({ tierList: pick.field }) && (
                        <span className={`b-slot-tier b-tier-${spellTierKey({ tierList: pick.field })}`}>
                          {SPELL_TIER_LABEL[pick.field]}
                        </span>
                      )}
                      <button className="b-slot-action" title="Swap" aria-label={`Swap ${pick.name}`} onClick={() => onOpenSlot(slot, pick.flatIndex, false, pick.field)}>✎</button>
                      <button className="b-slot-action" title="Clear" aria-label={`Clear ${pick.name}`} onClick={() => onOpenSlot(slot, pick.flatIndex, true, pick.field)}>✕</button>
                    </li>
                  );
                })()}
                <InlineDetail item={pick.name} field={pick.field} />
              </React.Fragment>
            );
          }
          return (
            <li key={i} className="b-slot-row is-empty">
              <span className="b-slot-num">{i + 1}</span>
              <button className="b-slot-add" onClick={() => onOpenSlot(slot, -1)}>
                + choose a {slot.label} power
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function ClassifiedRows({ rows, resolveType, showClass }) {
  const { character } = useBuilderState();
  const { onRemoveEntity: onRemove, onSetRank } = useBuilderActions();
  if (!rows || rows.length === 0) return <p className="b-empty">none</p>;
  return (
    <ul className="b-rows">
      {rows.map((row) => {
        const { name, field, index, source, grantedBy, cls, refundedBP, specialty, floor } = row;
        // Cost is attached to the row by validate() (from the BP ledger).
        const cost = row.cost;
        const fromClass = source === "class";
        const canRemove = !fromClass && index >= 0;
        const rank = cost?.rank || (index >= 0 ? character.ranks?.[field]?.[index] : null) || 1;

        const baseName = bareSkill(cleanItemName(name));
        const maxR = getMaxRanks(name, field, character);
        const grantedFloor = floor || 0;
        const canBuyUp = fromClass && grantedFloor > 0 && maxR > grantedFloor
          && !UNLIMITED_SKILLS.has(baseName);
        const rankFloor = canBuyUp ? grantedFloor : 1;
        const hasRanks = (canRemove || canBuyUp) && maxR > 1 && !UNLIMITED_SKILLS.has(baseName);

        const ent = lookupEntity(resolveType ? `${resolveType}:${baseName}` : baseName) || lookupEntity(resolveType ? `${resolveType}:${name}` : name);
        const tags = ent?.tags || [];

        return (
          <InspectableRow key={`${field}-${index}-${name}-${grantedBy || cls || ''}`}
                          item={name} field={field} resolveType={resolveType} index={index}
                          label={<>{name}{rank > 1 && !hasRanks && <span className="b-row-rank">×{rank}</span>}</>}>
            {tags.map((t) => <span key={t} className="b-picker-row-tag b-data">{t}</span>)}
            {showClass && cls && !fromClass && <span className="b-row-badge b-badge-class">{cls.toUpperCase()}</span>}
            {fromClass
              ? (() => {
                  const src = grantedBy || cls;
                  return (
                    <>
                      {src && (
                        <span className="b-row-badge b-badge-granted"
                              title={specialty ? `Granted free by your ${src}'s "${specialty}" starting choice`
                                : grantedBy ? `Granted free by your ${grantedBy} multi-class`
                                : `Granted free by your ${src} class`}>
                          {src.toUpperCase()}{specialty && <span className="b-badge-spec"> · {specialty}</span>}
                        </span>
                      )}
                      {refundedBP ? (
                        <span className="b-row-badge b-badge-refund" title="Redundant grant refunded as free BP">
                          +{refundedBP} BP
                        </span>
                      ) : null}
                      {canBuyUp && cost?.paidRanks > 0 && <CostBadge cost={cost} />}
                    </>
                  );
                })()
              : <CostBadge cost={cost} />}
            {hasRanks && onSetRank && (
              <div className="b-row-rank-adjust">
                <button className="b-rank-btn" type="button" onClick={() => onSetRank(field, index, rank - 1)} disabled={rank <= rankFloor}>-</button>
                <span className="b-rank-val">{rank}</span>
                <button className="b-rank-btn" type="button" onClick={() => onSetRank(field, index, rank + 1)} disabled={rank >= maxR}>+</button>
              </div>
            )}
            {canRemove && (
              <button className="b-row-remove" title="Remove" aria-label={`Remove ${name}`}
                      onClick={() => onRemove(field, index)}>×</button>
            )}
          </InspectableRow>
        );
      })}
    </ul>
  );
}

export function EditableRows({ items, field, resolveType, removable }) {
  const { character, report } = useBuilderState();
  const { onRemoveEntity } = useBuilderActions();
  if (!items || items.length === 0) {
    return <p className="b-empty">none</p>;
  }
  return (
    <ul className="b-rows">
      {items.map((item, i) => {
        const cost = lookupCost(report?.spend.byItem, field, item, i);
        const canRemove = removable ? removable(i) : false;
        const rank = cost?.rank || 1;

        const baseName = bareSkill(cleanItemName(item));
        const maxR = getMaxRanks(item, field, character);
        const hasRanks = canRemove && maxR > 1 && !UNLIMITED_SKILLS.has(baseName);

        const ent = lookupEntity(resolveType ? `${resolveType}:${baseName}` : baseName) || lookupEntity(resolveType ? `${resolveType}:${item}` : item);
        const tags = ent?.tags || [];

        return (
          <InspectableRow key={`${field}-${i}-${item}`} item={item} field={field} resolveType={resolveType} index={i}
                          label={<>{item}{rank > 1 && !hasRanks && <span className="b-row-rank">×{rank}</span>}</>}>
            {tags.map((t) => <span key={t} className="b-picker-row-tag b-data">{t}</span>)}
            <CostBadge cost={cost} />
            {canRemove && (
              <button className="b-row-remove" title="Remove" aria-label={`Remove ${item}`} onClick={() => onRemoveEntity(field, i)}>×</button>
            )}
          </InspectableRow>
        );
      })}
    </ul>
  );
}


