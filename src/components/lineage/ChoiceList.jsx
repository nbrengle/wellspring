// The choices area — B5 layout: two FACING columns (challenges earn LBP ⇄
// advantages spend LBP), always both visible, so the two-sided budget is obvious.
// Within each column, items are grouped into LBP-value bands (a price list you scan
// by cost). One shared search/filter spans both. Sublineage-scoped items are shown
// dimmed/locked until their sublineage is picked. Each item is a ChoiceRow.
import { useState, useMemo } from "react";
import { subKey } from "../../engine/validate.js";
import { lineageItemImpact } from "../../engine/data.js";
import { cleanChallengeName } from "../LineagePanel.jsx";
import { parseSublineage } from "./lineage-helpers.js";
import { browse, gameEffectAxes, axisApplies } from "../browse/browse.js";
import ChoiceRow from "./ChoiceRow.jsx";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "taken", label: "Taken" },
  { id: "required", label: "Required" },
];

// The catch-all bucket for items whose effect ISN'T a build-time / derived-stat
// change. These items still have real mechanical effects — they're in-play (a
// granted power, an accent, a domain) — so the label must NOT imply "does nothing".
const OTHER_EFFECT_LABEL = "Other (in-play) effects";
const SORT_OPTS = [
  { id: "cost", label: "Cost" },
  { id: "az", label: "A–Z" },
  { id: "effect", label: "Effect" },
];

const subLabel = (s) => (s ? parseSublineage(s).name : "");
const itemName = (it) => it.baseName || it.name;
const itemLbp = (it) => (typeof it.lbp === "number" ? it.lbp : -1);

// The primary BUILD-effect label of an item (its first parsed impact, e.g. "+3
// Natural Armor"). lineageItemImpact only knows build-time / derived effects, so

export default function ChoiceList({
  lin,
  lineage,
  character,
  lbp,
  pickedSub,
  onToggle,
  onInspect,
  onSetChoice,
  onSetRep,
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  // Pill management: how to group (cost band / effect / sublineage), how to sort
  // within a group, and whether to hide locked off-sublineage options.
  const [groupBy, setGroupBy] = useState("band");
  const [sort, setSort] = useState("cost");
  const [hideLocked, setHideLocked] = useState(false);
  // Which item's detail is expanded ("field|name"), so pills stay compact and
  // pickable; clicking a pill's name expands its description/mechanics in place.
  const [expandedKey, setExpandedKey] = useState(null);

  const storedFor = (field, it) =>
    (character[field] || []).find((n) => n === it.name || cleanChallengeName(n) === cleanChallengeName(it.name));

  const resolvedLbpFor = (it) =>
    lbp?.chosenChallenges?.find((c) => cleanChallengeName(c.name) === cleanChallengeName(it.name))?.lbp;

  const subInfo = (it) => {
    const k = subKey(it.sublineage);
    const general = !k || k === "general";
    // A sublineage-scoped item is OFF (locked) whenever it isn't the picked
    // sublineage — including when none is picked (then every sublineage item is
    // locked; "General only" really means General only).
    const offSublineage = !general && k !== pickedSub;
    return { general, offSublineage, label: subLabel(it.sublineage) };
  };

  const matches = (it, field) => {
    const q = query.trim().toLowerCase();
    if (q && !((it.baseName || it.name).toLowerCase().includes(q) || (it.desc || "").toLowerCase().includes(q)))
      return false;
    if (filter === "taken") return storedFor(field, it) !== undefined;
    if (filter === "required") return !!it.required;
    return true; // 'all' — sublineage scoping is shown via dimming, not hiding
  };

  // A required challenge applies (auto-taken, locked) when it's General OR scoped to
  // the currently-picked sublineage — identical treatment regardless of source.
  const requiredActive = (it) => {
    if (!it.required) return false;
    const k = subKey(it.sublineage);
    return !k || k === "general" || k === pickedSub;
  };

  const renderRow = (it, field, kind) => {
    const storedName = storedFor(field, it);
    const info = subInfo(it);
    const key = `${field}|${it.name}`;
    return (
      <ChoiceRow
        key={it.name}
        item={it}
        kind={kind}
        chosen={storedName !== undefined}
        storedName={storedName}
        resolvedLbp={resolvedLbpFor(it)}
        subLabel={info.general ? null : info.label}
        dimmed={info.offSublineage}
        locked={info.offSublineage}
        requiredActive={requiredActive(it)}
        expanded={expandedKey === key}
        onExpand={() => setExpandedKey((cur) => (cur === key ? null : key))}
        onToggle={onToggle}
        onInspect={onInspect}
        onSetChoice={onSetChoice}
        onSetRep={onSetRep}
        advantageChoices={character.advantageChoices}
      />
    );
  };

  // Sort comparator within a group, per the chosen sort axis (shared by both columns).
  const compare = (a, b, s) => {
    if (s === "az") return itemName(a).localeCompare(itemName(b));
    if (s === "effect") {
      const ea = lineageItemImpact(a).length,
        eb = lineageItemImpact(b).length;
      if (ea !== eb) return eb - ea; // items WITH effects first
      return itemName(a).localeCompare(itemName(b));
    }
    return itemLbp(b) - itemLbp(a) || itemName(a).localeCompare(itemName(b)); // cost desc
  };

  // The lineage's OWN axes (cost band / build effect / sublineage), expressed as
  // browse axes, plus the shared game-effect axes (Effect / Damage type / Condition)
  // so the same player-facing grouping lights up here as in the power picker. The
  // band axis needs the +/− sign, so it's built per column (per `kind`).
  const axesFor = (kind) => {
    const sign = kind === "challenge" ? "+" : "−";
    const native = [
      {
        id: "band",
        label: "Cost band",
        key: (it) => (typeof it.lbp === "number" ? `${sign}${it.lbp} LBP` : "Variable"),
        // High LBP band first (ascending order on negated value); "Variable" last.
        order: (label) => (label === "Variable" ? Infinity : -parseInt(String(label).replace(/[^\d]/g, ""), 10)),
      },
      {
        id: "buildeffect",
        label: "Build effect",
        key: (it) => {
          const imp = lineageItemImpact(it);
          return imp.length ? imp[0] : OTHER_EFFECT_LABEL;
        },
        order: (label) => (label === OTHER_EFFECT_LABEL ? 1 : 0),
      },
      {
        id: "sublineage",
        label: "Sublineage",
        key: (it) => (subInfo(it).general ? "General" : subInfo(it).label),
        order: (label) => (label === "General" ? -1 : 0),
      },
    ];
    // Lineage items key in the refs graph on the BARE name (e.g. "challenges:Mana
    // Lines") — lineage is a field, not part of the id (#195) — so resolve facets with
    // the bare name + the matching type.
    const facetType = kind === "challenge" ? "challenges" : "advantages";
    return [...native, ...gameEffectAxes(() => facetType, itemName)];
  };

  // Game-effect axes only appear when some item in EITHER column carries that facet.
  const groupOptions = useMemo(() => {
    const all = [...(lin.challenges || []), ...(lin.advantages || [])];
    return axesFor("challenge").filter((a) => axisApplies(a, all));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lin, lineage, pickedSub]);

  const column = (list, field, kind) => {
    let visible = (list || []).filter((it) => matches(it, field));
    if (hideLocked) visible = visible.filter((it) => !subInfo(it).offSublineage);
    const { groups } = browse({
      items: visible,
      axes: axesFor(kind),
      groupBy,
      sort,
      compare,
    });
    return (
      <div className={`b-lin-col b-lin-col-${kind === "challenge" ? "earn" : "spend"}`}>
        <div className="b-lin-col-head">
          <span className="b-lin-col-tot">{kind === "challenge" ? `+${lbp.awarded}` : `−${lbp.spent}`} LBP</span>
          <h3 className="b-lin-col-title">{kind === "challenge" ? "① Challenges — earn" : "② Advantages — spend"}</h3>
          <p className="b-lin-col-sub">
            {kind === "challenge" ? "Take these to build your LBP budget." : "Buy these with earned LBP."}
          </p>
        </div>
        {groups.length === 0 ? (
          <p className="b-empty">No matching {kind === "challenge" ? "challenges" : "advantages"}.</p>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="b-lin-band">
              <div className="b-lin-band-head">
                <span className="b-lin-band-v">{g.label}</span>
                <span className="b-lin-band-line" />
              </div>
              <ul className="b-lin-pills">{g.items.map((it) => renderRow(it, field, kind))}</ul>
            </div>
          ))
        )}
      </div>
    );
  };

  return (
    <div className="b-lin-choices">
      <div className="b-lin-choices-controls">
        <input
          className="b-lin-search"
          type="search"
          placeholder="Search challenges & advantages…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search lineage options"
        />
        <div className="b-lin-filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={`b-lin-filter ${filter === f.id ? "is-on" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {/* Group / Sort / Hide-locked — reuses the power picker's control classes
            (b-picker-sortrow/sortlabel/sortsel/toggle) so the whole app's browse
            controls look and read the same. */}
        <div className="b-picker-sortrow">
          <label className="b-picker-sortlabel">
            Group
            <select className="b-picker-sortsel" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              {groupOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="b-picker-sortlabel">
            Sort
            <select className="b-picker-sortsel" value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORT_OPTS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="b-picker-toggle">
            <input type="checkbox" checked={hideLocked} onChange={(e) => setHideLocked(e.target.checked)} />
            Hide locked
          </label>
        </div>
      </div>
      <div className="b-lin-cols">
        {column(lin.challenges, "lineageChallenges", "challenge")}
        {column(lin.advantages, "lineageAdvantages", "advantage")}
      </div>
    </div>
  );
}
