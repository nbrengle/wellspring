import { useMemo } from "react";
import {
  lookupEntity, REFS, allergenAward, powerSpellChoiceSpec
} from '../engine/data.js';
import { PARAMETER_SUGGESTIONS, TYPEABLE_PARAMS } from "./parameter-suggestions.js";
import SubSelect from "./SubSelect.jsx";
import { formatParameterizedName } from "../engine/resolver.js";
// Re-export so existing importers (Builder.jsx) keep their path; the impl now lives
// in the engine where it's unit-tested.
export { formatParameterizedName };


export default function DetailPane({ view, report, choices, onSetChoice, onUpdateParameter, onInspect, onBack, onClose }) {
  if (!view) {
    return (
      <aside className="b-rail b-rail-right is-empty">
        <div className="b-detail-empty">
          <p className="b-detail-hint">Click any item to see what it does, or click an empty power slot to choose one.</p>
        </div>
      </aside>
    );
  }
  return <EntityDetail view={view} report={report} choices={choices} onSetChoice={onSetChoice} onUpdateParameter={onUpdateParameter} onInspect={onInspect} onBack={onBack} onClose={onClose} />;
}

function EntityDetail({ view, report, choices, onSetChoice, onUpdateParameter, onInspect, onBack, onClose }) {
  const entity = useResolvedEntity(view.item, view.field, view.resolveType);
  const { item, resolveType } = view;

  return (
    <aside className="b-rail b-rail-right">
      <header className="b-detail-header">
        <div className="b-detail-nav">
          {onBack
            ? <button className="b-detail-back" onClick={onBack}>‹ back</button>
            : <span />}
          <button className="b-detail-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <h2 className="b-detail-title">{entity?.name || item}</h2>
        <p className="b-detail-type">{entity?.type || resolveType}</p>
      </header>
      <div className="b-detail-body">
        <EntityBody entity={entity} view={view} report={report} choices={choices} onSetChoice={onSetChoice} onUpdateParameter={onUpdateParameter} onInspect={onInspect} />
      </div>
    </aside>
  );
}

function conceptTerms(entity) {
  if (!entity?.id) return [];
  const ids = new Set([
    ...(REFS.mentions[entity.id] || []),
    ...((REFS.prereqs[entity.id]?.skills) || []),
    ...((REFS.prereqs[entity.id]?.anyOf || []).flat()),
    ...(REFS.unlocks[entity.id] || []),
  ]);
  const terms = [];
  for (const id of ids) {
    if (id === entity.id) continue;
    const ent = lookupEntity(id);
    if (!ent?.name || ent.name.length < 3) continue;
    if (ent.name.toLowerCase() === (entity.name || "").toLowerCase()) continue;
    const summary = ent.summary || ent.description || ent.definition || "";
    terms.push({ name: ent.name, id, type: id.slice(0, id.indexOf(":")), summary: String(summary).slice(0, 240) });
  }
  const seen = new Set();
  return terms
    .sort((a, b) => b.name.length - a.name.length)
    .filter((t) => { const k = t.name.toLowerCase(); return seen.has(k) ? false : seen.add(k); });
}

function linkifyConcepts(text, terms, onInspect, keyPrefix) {
  if (!terms.length || !onInspect) return [text];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b(${terms.map((t) => esc(t.name)).join("|")})\\b`, "gi");
  const byName = new Map(terms.map((t) => [t.name.toLowerCase(), t]));
  const linked = new Set();
  const out = [];
  let last = 0, m, n = 0;
  while ((m = re.exec(text))) {
    const term = byName.get(m[0].toLowerCase());
    if (!term) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    if (linked.has(term.name.toLowerCase())) {
      out.push(m[0]);
    } else {
      linked.add(term.name.toLowerCase());
      out.push(
        <button key={`${keyPrefix}-${n++}`} className="b-concept"
                title={term.summary ? `${term.name} — ${term.summary}` : term.name}
                onClick={() => onInspect(term.name, null, term.type)}>
          {m[0]}
        </button>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function DescriptionBlock({ text, terms = [], onInspect }) {
  const [lead, ...bulletParts] = String(text).split(/\s*•\s+/);
  const bullets = bulletParts.map((b) => b.trim()).filter(Boolean);
  const paras = lead
    .split(/(?=\b(?:Note|Enhancement|Spike|Special|Cost|Restriction|Requirement|Prerequisite)s?:)/)
    .map((s) => s.trim()).filter(Boolean);
  return (
    <div className="b-detail-desc">
      {paras.map((p, i) => <p key={i} className="b-detail-para">{linkifyConcepts(p, terms, onInspect, `p${i}`)}</p>)}
      {bullets.length > 0 && (
        <ul className="b-detail-bullets">
          {bullets.map((b, i) => <li key={i}>{linkifyConcepts(b, terms, onInspect, `b${i}`)}</li>)}
        </ul>
      )}
    </div>
  );
}


// A devotion's detail: its lore (the narrative "description"), tenets/guiding
// principles, structured facts, and clickable domains. The data lives in the
// devotion entity's lore/tenets/etc. fields — there is no `description` field —
// which is why the generic body rendered blank for devotions before.
function DevotionBody({ entity, terms, onInspect }) {
  // The parser leaves a trailing "Example Sigil:" label where the (now-dropped)
  // sigil image was — strip it so it doesn't show as stray text.
  const lore = String(entity.lore || "").replace(/\s*Example Sigil:\s*$/i, "").trim();
  const tenets = entity.tenets || [];
  const facts = [
    ["Locality", entity.locality],
    ["Color scheme", entity.colorScheme || entity.color],
    ["Iconography", entity.iconography],
  ].filter(([, v]) => v && String(v).trim());
  const domainIds = (entity.domains || []).map((d) => `domains:${d}`);
  return (
    <>
      {lore
        ? <DescriptionBlock text={lore} terms={terms} onInspect={onInspect} />
        : <p className="b-detail-missing">No lore on record.</p>}
      {tenets.length > 0 && (
        <div className="b-detail-section">
          <h3 className="b-detail-section-title">Tenets</h3>
          <ul className="b-detail-bullets">
            {tenets.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
      )}
      {facts.length > 0 && (
        <dl className="b-facts">
          {facts.map(([label, value]) => (
            <div key={label} className="b-fact">
              <dt className="b-fact-label">{label}</dt>
              <dd className="b-fact-val">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {domainIds.length > 0 && (
        <LinkList title="Domains" tone="purple" ids={domainIds} onInspect={onInspect} />
      )}
    </>
  );
}

function ParameterEditor({ baseName, entity, view, suggestions: suggestionsProp, groups, onUpdateParameter }) {
  const chosenParam = entity.baseName ? (entity.parameter || "") : "";

  const isSpellChoice = baseName === "Bookcaster" || baseName === "Basic Arcane" || baseName === "Basic Faith";
  const flat = suggestionsProp || PARAMETER_SUGGESTIONS[baseName] || [];
  // SubSelect takes flat options OR grouped [{label, options}].
  const options = (groups && groups.length) ? groups : flat;
  const hasOptions = options.length > 0;
  const allowCustom = TYPEABLE_PARAMS.has(baseName);

  const sectionLabel = baseName === "Lore" ? "Customize Area"
    : isSpellChoice ? "Choose a Spell" : "Choose";

  const choose = (opt) => {
    const newName = opt ? formatParameterizedName(baseName, opt, entity.name) : (entity.baseName || baseName);
    onUpdateParameter(view.field, entity.name, newName, view.index);
  };

  return (
    <div className="b-detail-section b-parameter-editor">
      {isSpellChoice && !hasOptions ? (
        <>
          <h3 className="b-detail-section-title">{sectionLabel}</h3>
          <p className="b-detail-hint">No accessible spell lists yet — gain spell-slots (or a caster class) to bookcast.</p>
        </>
      ) : (
        <SubSelect
          prompt={sectionLabel}
          value={chosenParam || null}
          onChange={choose}
          options={options}
          allowCustom={allowCustom}
          customLabel={baseName === "Lore" ? "Type an area…" : "Type your own…"}
        />
      )}
    </div>
  );
}

export function EntityBody({ entity, view, report, choices, onSetChoice, onUpdateParameter, onInspect }) {
  // Hooks must run unconditionally and in the same order every render — so this
  // useMemo is hoisted ABOVE the early `!entity` return (it already guards on
  // entity?.id internally). Calling it after the return tripped rules-of-hooks.
  const grantedSubPowers = useMemo(() => {
    if (!entity?.id) return [];
    const targets = REFS.grants?.[entity.id] || [];
    return targets
      .map((id) => lookupEntity(id))
      .filter((sub) => sub && sub.tier === "SubPower");
  }, [entity]);
  if (!entity) {
    return <p className="b-detail-missing">No detail available — this item may be unresolved.</p>;
  }
  const domainPowers = entity.type === "domains" ? (entity.powers || []) : null;
  const activeBenefits = entity.levelBenefits
    ? (report?.powerBenefits?.find((b) => b.power === entity.name)?.benefits || entity.levelBenefits)
    : null;
  const terms = conceptTerms(entity);
  const baseName = entity.baseName || entity.name;

  let paramSuggestions = null;
  let paramGroups = null;
  if (baseName === "Bookcaster") {
    const bc = report?.bookcasterOptions || { known: [], other: [] };
    paramGroups = [
      { label: "Known Spells", options: bc.known || [] },
      { label: "Other Accessible Spells", options: bc.other || [] },
    ].filter((g) => g.options.length);
  } else if (report?.classChoices && baseName in report.classChoices) {
    // Cross-class grants (Extensive Combat Training / Training / Spell-Scholar):
    // offer ONLY the classes this character is eligible to pick (their own classes
    // of the right kind), not the hardcoded full list.
    paramSuggestions = report.classChoices[baseName] || [];
  } else if (report?.basicSpellChoices && baseName in report.basicSpellChoices) {
    // Basic Arcane / Basic Faith: pick the one spell you learn, from the
    // sphere-appropriate pool (your caster class's list, or any base class's).
    paramSuggestions = report.basicSpellChoices[baseName] || [];
  } else {
    paramSuggestions = PARAMETER_SUGGESTIONS[baseName] || null;
  }
  const isParamEditable = !!(onUpdateParameter && view?.field && view.field !== "multiclassGrant"
    && (paramSuggestions?.length || paramGroups?.length || baseName === "Bookcaster"
        || TYPEABLE_PARAMS.has(baseName)));  // typeable params are editable even with no suggestions
  // A devotion's "description" lives in lore + tenets (not a `description` field),
  // plus structured facts (color, iconography, locality, domains). Render those
  // instead of falling through to the blank "No description on record".
  if (entity.type === "devotions") {
    return <DevotionBody entity={entity} terms={terms} onInspect={onInspect} />;
  }

  return (
    <>
      {entity.description
        ? <DescriptionBlock text={entity.description} terms={terms} onInspect={onInspect} />
        : domainPowers
          ? <p className="b-detail-desc">A divine domain{entity.accent ? ` (${entity.accent} accent)` : ""} granting {domainPowers.length} power{domainPowers.length === 1 ? "" : "s"}.</p>
          : <p className="b-detail-missing">No description on record.</p>}
      <DetailFacts entity={entity} isEditable={isParamEditable} />
      {isParamEditable && (
        <ParameterEditor
          baseName={baseName}
          entity={entity}
          view={view}
          suggestions={paramSuggestions}
          groups={paramGroups}
          onUpdateParameter={onUpdateParameter}
        />
      )}
      {activeBenefits && (
        <div className="b-detail-section">
          <h3 className="b-detail-section-title">Benefits by {entity.levelBenefitClass || "class"} level</h3>
          <ul className="b-level-benefits">
            {activeBenefits.map((b) => (
              <li key={b.level} className={`b-level-benefit ${b.active === false ? "is-locked" : b.active ? "is-active" : ""}`}>
                <span className="b-level-tag">Lv {b.level}</span>
                <span className="b-level-text">{b.text}</span>
                {b.active === false && <span className="b-level-locked">locked</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {entity.chooseOne && (() => {
        const co = entity.chooseOne;
        const powerId = `powers:${entity.name}`;
        const chosen = choices?.[powerId];
        const build = co.kind === "build";
        // A build choose-one (Way of the Blade, Expert Craft) is a real selection —
        // render the shared chip control with its "Choose"/free affordances. An
        // in-play "choose one when used" is informational, so it stays a plain list.
        if (build && onSetChoice) {
          // Match the stored value whether it's the option text or a granted skill name.
          const value = co.options.find((o) =>
            o.text === chosen || (o.grants || o.grantsSkills || []).includes(chosen))?.text || null;
          return (
            <div className="b-detail-section">
              <SubSelect
                prompt="Choose one (free)"
                value={value}
                onChange={(v) => onSetChoice(powerId, v)}
                options={co.options.map((o) => ({
                  value: o.text,
                  free: (o.grants || o.grantsSkills || []).length > 0,
                }))}
              />
            </div>
          );
        }
        return (
          <div className="b-detail-section">
            <h3 className="b-detail-section-title">Choose one when used</h3>
            <ul className="b-choose-list">
              {co.options.map((o, i) => (
                <li key={i} className="b-choose-opt">
                  <span className="b-choose-text">• {o.text}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}
      {(() => {
        // A power that grants a chosen spell (Arcane Secrets) — pick one spell; the
        // engine adds it to Known Spells. The pool is rank-gated and comes from the
        // report (not a flat list), since the rules gate by what you can cast.
        const spellSpec = powerSpellChoiceSpec(entity);
        if (!spellSpec || !onSetChoice) return null;
        const powerId = `powers:${entity.baseName || entity.name}`;
        const pool = report?.arcaneSecretsOptions || [];
        return (
          <div className="b-detail-section">
            {pool.length ? (
              <SubSelect
                prompt="Choose a Spell"
                value={choices?.[powerId] || null}
                onChange={(v) => onSetChoice(powerId, v || "")}
                options={pool.map((s) => ({ value: s }))}
              />
            ) : (
              <>
                <h3 className="b-detail-section-title">Choose a Spell</h3>
                <p className="b-detail-hint">No arcane spells available to learn yet.</p>
              </>
            )}
          </div>
        );
      })()}
      {domainPowers && domainPowers.length > 0 && (
        <LinkList title="Domain powers" tone="purple" onInspect={onInspect}
                  ids={domainPowers.map((p) => `powers:${p.name}`)} />
      )}
      {grantedSubPowers.length > 0 && (
        <div className="b-detail-subpowers">
          {grantedSubPowers.map((sub) => {
            const subTerms = conceptTerms(sub);
            return (
              <div key={sub.id} className="b-detail-section b-detail-subpower-inline">
                <h3 className="b-detail-section-title">Granted Power: {sub.name}</h3>
                <DetailFacts entity={sub} isEditable={false} />
                {sub.description && (
                  <DescriptionBlock text={sub.description} terms={subTerms} onInspect={onInspect} />
                )}
              </div>
            );
          })}
        </div>
      )}
      <ForwardLinks entity={entity} onInspect={onInspect} />
      <BackLinks entity={entity} onInspect={onInspect} />
    </>
  );
}

function DetailFacts({ entity, isEditable }) {
  if (!entity) return null;
  const facts = [];
  if (entity.parameter && !isEditable) facts.push([entity.baseName === "Lore" ? "Area" : "Choice", entity.parameter]);
  if (typeof entity.cost === "number") facts.push(["Cost", `${entity.cost} BP`]);
  else if (entity.cost && /^var/i.test(String(entity.cost))) facts.push(["Cost", "Variable"]);
  if (typeof entity.bp === "number" || typeof entity.bp === "string") {
    let val = entity.bp;
    // Allergy award is per-substance, from the parsed allergen table. With a
    // substance chosen, show its exact award; otherwise leave the "1 or 2" range.
    const allergyAward = allergenAward(entity.baseName, entity.parameter);
    if (allergyAward != null) val = allergyAward;
    facts.push(["Award", `${val} BP`]);
  }
  if (entity.prereq && entity.prereq !== "None") facts.push(["Prereq", entity.prereq]);
  if (entity.prerequisites && entity.prerequisites !== "None") facts.push(["Prereq", entity.prerequisites]);
  if (entity.tier) facts.push(["Tier", entity.tier]);
  if (entity.discipline) facts.push(["Discipline", entity.discipline]);
  if (entity.materials) facts.push(["Materials", entity.materials]);
  if (entity.application) facts.push(["Application", entity.application]);
  if (entity.components) facts.push(["Components", entity.components]);
  if (entity.ritualists) facts.push(["Ritualists", String(entity.ritualists)]);
  if (entity.refresh && entity.refresh !== "None") facts.push(["Refresh", entity.refresh]);
  if (entity.call && entity.call !== "None") facts.push(["Call", entity.call]);
  if (entity.effect) facts.push(["Effect", entity.effect]);
  if (entity.tags && entity.tags.length > 0) facts.push(["Tags", entity.tags.join(", ")]);

  if (facts.length === 0) return null;
  return (
    <dl className="b-facts">
      {facts.map(([k, v]) => (
        <div key={k} className="b-fact">
          <dt className="b-fact-label">{k}</dt>
          <dd className="b-fact-val">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function LinkList({ title, ids, tone, onInspect }) {
  const links = useMemo(() => {
    const seen = new Set();
    return (ids || []).filter((id) => !seen.has(id) && seen.add(id))
      .map((id) => ({ id, ent: lookupEntity(id), type: id.slice(0, id.indexOf(":")), name: id.slice(id.indexOf(":") + 1) }))
      .filter((l) => l.ent);
  }, [ids]);
  if (links.length === 0) return null;
  return (
    <div className="b-links">
      {title && <h3 className={`b-links-title b-links-${tone}`}>{title}</h3>}
      <ul className="b-links-list">
        {links.map((l) => (
          <li key={l.id}>
            <button className="b-link" onClick={() => onInspect(l.name, null, l.type)}>
              {l.name}
              <span className="b-link-type">{l.type}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ForwardLinks({ entity, onInspect }) {
  const pr = REFS.prereqs[entity.id];
  const prereqIds = pr ? [...(pr.skills || []), ...((pr.anyOf || []).flat())] : [];
  const unlockIds = REFS.unlocks[entity.id] || [];
  const mentionIds = REFS.mentions[entity.id] || [];
  // Mutually-exclusive perks/flaws — "cannot be taken along with" each other.
  const excludeIds = (REFS.excludes || {})[entity.id] || [];
  return (
    <>
      <LinkList title="Requires" ids={prereqIds} tone="red" onInspect={onInspect} />
      <LinkList title="Cannot combine with" ids={excludeIds} tone="red" onInspect={onInspect} />
      <LinkList title="Unlocks" ids={unlockIds} tone="green" onInspect={onInspect} />
      <LinkList title="References" ids={mentionIds} tone="blue" onInspect={onInspect} />
    </>
  );
}

function BackLinks({ entity, onInspect }) {
  const mb = REFS.mentionedBy[entity.id] || [];
  const archetypes = mb.filter((id) => id.startsWith("archetypes:"));
  const others = mb.filter((id) => !id.startsWith("archetypes:"));
  if (archetypes.length === 0 && others.length === 0) return null;
  return (
    <>
      {archetypes.length > 0 && (
        <div className="b-links">
          <h3 className="b-links-title b-links-dim">Picked by archetypes</h3>
          <ul className="b-links-list">
            {archetypes.map((id) => <li key={id} className="b-link-static">{id.slice("archetypes:".length)}</li>)}
          </ul>
        </div>
      )}
      {others.length > 0 && (
        <details className="b-mentioned">
          <summary className="b-mentioned-summary">Mentioned by {others.length} other{others.length > 1 ? "s" : ""}</summary>
          <LinkList ids={others} tone="dim" onInspect={onInspect} />
        </details>
      )}
    </>
  );
}

export function useResolvedEntity(item, field, resolveType) {
  return useMemo(() => {
    if (!item) return null;
    let type = resolveType;
    if (!type && field) {
      if (field === 'flaws') type = 'flaws';
      else if (field.endsWith('Skills')) type = 'skills';
      else if (field.endsWith('Perks')) type = 'perks';
      else type = 'powers';
    }
    const resolved = type ? lookupEntity(`${type}:${item}`) : null;
    if (resolved) {
      return { ...resolved, name: item };
    }
    return null;
  }, [item, field, resolveType]);
}
