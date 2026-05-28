import { useState, useMemo } from "react";
import {
  LEVEL_TABLE,
  ALL_SKILLS,
  ALL_PERKS,
  ALL_FLAWS,
  CLASSES,
  LINEAGES,
  DEVOTIONS,
} from "./data/index.js";
import "./CharacterCreator.css";

// Category orderings for the UI, derived from the data so they never drift from
// what's actually present. (Order is curated; any unexpected category still shows.)
const ordered = (values, preferred) => {
  const present = [...new Set(values)];
  const head = preferred.filter((c) => present.includes(c));
  const tail = present.filter((c) => !preferred.includes(c)).sort();
  return [...head, ...tail];
};

const SKILL_CATS = ordered(
  ALL_SKILLS.map((s) => s.cat),
  ["Martial", "Magic", "Scholar", "Medical", "Trade", "Thieving", "Gathering", "Crafting"]
);
const PERK_CATS = ordered(
  ALL_PERKS.map((p) => p.cat),
  ["Mystical", "Physical", "Patron", "Social", "Supernatural", "Hearth"]
);
const FLAW_CATS = ordered(
  ALL_FLAWS.map((f) => f.cat),
  ["Personal", "Physical", "Spiritual"]
);

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function Tag({ label, tone = "amber" }) {
  return <span className={`tag tag-${tone}`}>{label}</span>;
}

function Accordion({ title, icon, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="accordion">
      <button className="accordion-head" onClick={() => setOpen((o) => !o)}>
        <span className="accordion-title">{icon} {title}</span>
        <span className="accordion-caret">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="accordion-body">{children}</div>}
    </div>
  );
}

function BPBar({ spent, total }) {
  const pct = total > 0 ? Math.min(100, (spent / total) * 100) : 0;
  const over = spent > total;
  return (
    <div className="bpbar">
      <div className="bpbar-track">
        <div className={`bpbar-fill ${over ? "is-over" : pct > 85 ? "is-warn" : ""}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`bpbar-label ${over ? "is-over" : ""}`}>{spent}/{total} BP</span>
      {over && <span className="bpbar-over">⚠ OVER</span>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

export default function WellspringCharacterCreator() {
  const [step, setStep] = useState(0);
  const [char, setChar] = useState({
    name: "", level: 4, civilization: "Auros", backstory: "",
    selectedClass: "", secondaryClass: "",
    selectedLineage: "", selectedSubLineage: "",
    selectedChallenges: [], lbpAdvantages: [],
    selectedDevotionIndex: null,
    selectedFlaws: [],
    selectedPerks: [],
    selectedSkills: [],
  });

  const levelData = LEVEL_TABLE.find((l) => l.level === char.level) || LEVEL_TABLE[0];

  // ── BP MATH ────────────────────────────────────────────────────────────────

  const flawBPRaw = char.selectedFlaws.reduce((sum, n) => {
    const f = ALL_FLAWS.find((x) => x.name === n);
    return sum + (f ? f.bp : 0);
  }, 0);
  const flawBP = Math.min(5, flawBPRaw);

  const backstoryBP = char.backstory.trim().length > 20 ? 2 : 0;
  const totalBP = levelData.bp + flawBP + backstoryBP;

  const perkBPSpent = char.selectedPerks.reduce((sum, n) => {
    const p = ALL_PERKS.find((x) => x.name === n);
    return sum + (p && typeof p.cost === "number" ? p.cost : 0);
  }, 0);
  const skillBPSpent = char.selectedSkills.reduce((sum, n) => {
    const s = ALL_SKILLS.find((x) => x.name === n);
    return sum + (s && typeof s.cost === "number" ? s.cost : 0);
  }, 0);

  const totalSpent = perkBPSpent + skillBPSpent;
  const remainingBP = totalBP - totalSpent;

  // LBP
  const lineageData = LINEAGES[char.selectedLineage];
  const earnedLBP = Math.min(10, char.selectedChallenges.reduce((sum, n) => {
    const ch = lineageData?.challenges.find((x) => x.name === n);
    return sum + (ch && typeof ch.lbp === "number" ? ch.lbp : 0);
  }, 0));
  const spentLBP = char.lbpAdvantages.reduce((sum, n) => {
    const adv = lineageData?.advantages.find((x) => x.name === n);
    return sum + (adv && typeof adv.lbp === "number" ? adv.lbp : 0);
  }, 0);

  const bonusLP = char.selectedPerks.includes("Toughness") ? 1 : 0;
  const totalLP = levelData.lp + bonusLP;

  function upd(k, v) { setChar((p) => ({ ...p, [k]: v })); }
  function tog(k, v) { setChar((p) => ({ ...p, [k]: p[k].includes(v) ? p[k].filter((x) => x !== v) : [...p[k], v] })); }

  // ── STEP CONTENT ───────────────────────────────────────────────────────────

  const STEPS = ["Identity", "Class", "Lineage", "Devotion", "Build", "Summary"];

  function Step0() {
    return (
      <div className="stack">
        <p className="muted">Who is your character before the mechanics?</p>
        <div>
          <label className="label">Character Name</label>
          <input className="input" value={char.name} onChange={(e) => upd("name", e.target.value)} placeholder="Name your character…" />
        </div>
        <div>
          <label className="label">Starting Level</label>
          <div className="row wrap">
            {LEVEL_TABLE.map((row) => (
              <button key={row.level} onClick={() => upd("level", row.level)} className={`chip lg ${char.level === row.level ? "is-on" : ""}`}>
                Level {row.level}<span className="chip-sub">{row.bp} BP base</span>
              </button>
            ))}
          </div>
          <p className="hint">Game 2 new players start at Level 4. Higher if joining later.</p>
        </div>
        <div>
          <label className="label">Civilization</label>
          <select className="input" value={char.civilization} onChange={(e) => upd("civilization", e.target.value)}>
            <option value="Auros">Auros — World of Seasons (default)</option>
            <option value="Empire of Light">Empire of Light</option>
            <option value="Unified Technarchy">Unified Technarchy</option>
            <option value="Astari">Astari — The Rampant Green</option>
            <option value="Shorn">The Shorn — Godhunters</option>
            <option value="Streams in Silver">Streams in Silver</option>
            <option value="Traveling Star">The Traveling Star</option>
            <option value="Unincorporated Lands">Unincorporated Lands</option>
          </select>
          {char.civilization !== "Auros" && <p className="warn-text">⚠ Non-Aurosian characters require reading the "Main Camera" setting disclaimer and staff approval.</p>}
        </div>
        <div>
          <label className="label">Backstory <span className="muted normal">(optional — approved backstories grant +2 BP)</span></label>
          <textarea className="input tall" value={char.backstory} onChange={(e) => upd("backstory", e.target.value)} placeholder="How did your character arrive? What drives them?…" />
          {backstoryBP > 0 && <p className="ok-text">✓ Backstory recorded — submit to plot team for +2 BP</p>}
        </div>
        <div className="panel">
          <p className="panel-title">Starting Resources</p>
          <p className="muted">• <b className="amber">{levelData.bp} BP</b> base · up to <span className="amber">+5</span> from Flaws · <span className="amber">+2</span> from approved backstory</p>
          <p className="muted">• <b className="amber">{levelData.lp} LP</b> base Life Points</p>
          <p className="muted">• <b className="amber">{levelData.spikes} Spikes</b></p>
          <p className="muted">• <b className="amber">8 Wealth</b> starting gold</p>
        </div>
      </div>
    );
  }

  function Step1() {
    return (
      <div className="stack-sm">
        <p className="muted">Your class determines your Powers and free Starting Skills. Level 4 = 4 levels in one class, or split across multiple.</p>
        {Object.entries(CLASSES).map(([name, cls]) => {
          const sel = char.selectedClass === name;
          return (
            <button key={name} onClick={() => upd("selectedClass", name)} className={`card ${sel ? "is-sel" : ""}`}>
              <div className="card-head">
                <span className="card-name">{name}</span>
                <div className="row gap1">
                  <Tag label={cls.type} tone="gray" />
                  {cls.magicType && <Tag label={cls.magicType} tone={cls.spellcaster ? "purple" : "teal"} />}
                </div>
              </div>
              <p className="card-desc">{cls.description}</p>
              {sel && (
                <div className="card-detail">
                  <div>
                    <p className="sub amber">Free Starting Skills</p>
                    {cls.startingSkills.map((s, i) => <p key={i} className="line">✓ {s}</p>)}
                  </div>
                  {cls.multiclassSkills && <p className="line muted">Multiclass skills: {cls.multiclassSkills}</p>}
                </div>
              )}
            </button>
          );
        })}
        {char.selectedClass && (
          <div className="panel">
            <p className="panel-title">Secondary Class (optional multiclass)</p>
            <p className="hint mb">A 2nd class gives Multiclass Skills (not Starting Skills) and uses levels from your total 4.</p>
            <select className="input" value={char.secondaryClass} onChange={(e) => upd("secondaryClass", e.target.value)}>
              <option value="">— Single class —</option>
              {Object.keys(CLASSES).filter((c) => c !== char.selectedClass).map((c) => <option key={c} value={c}>{c} (MC skills: {CLASSES[c].multiclassSkills})</option>)}
            </select>
          </div>
        )}
      </div>
    );
  }

  function Step2() {
    return (
      <div className="stack-sm">
        <p className="muted">Your lineage is your ancestry. Take Challenges (like flaws) to earn LBP, spend LBP on Advantages. Max 10 LBP earned.</p>
        {Object.entries(LINEAGES).map(([name, lin]) => {
          const sel = char.selectedLineage === name;
          const costTone = lin.costume.startsWith("Hard") ? "red" : lin.costume.startsWith("Medium") ? "amber" : "green";
          return (
            <button key={name} onClick={() => { upd("selectedLineage", name); upd("selectedSubLineage", ""); upd("selectedChallenges", []); upd("lbpAdvantages", []); }} className={`card ${sel ? "is-sel" : ""}`}>
              <div className="card-head">
                <span className="card-name">{name}</span>
                <Tag label={lin.costume.split(" —")[0]} tone={costTone} />
              </div>
              <p className="card-desc">{lin.description}</p>
              {sel && (
                <div className="card-detail" onClick={(e) => e.stopPropagation()}>
                  {lin.sublineages.length > 0 && (
                    <div>
                      <p className="sub amber">Sub-Lineage</p>
                      <div className="row wrap gap1">
                        {lin.sublineages.map((sl) => (
                          <button key={sl} onClick={() => upd("selectedSubLineage", sl)} className={`chip ${char.selectedSubLineage === sl ? "is-on" : ""}`}>{sl}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <div className="row between">
                      <p className="sub red">Challenges (earn LBP)</p>
                      <span className="muted sm">{earnedLBP}/10 LBP earned</span>
                    </div>
                    <div className="stack-xs">
                      {lin.challenges.map((ch) => {
                        const on = char.selectedChallenges.includes(ch.name);
                        return (
                          <button key={ch.name} onClick={() => tog("selectedChallenges", ch.name)} className={`opt ${on ? "is-bad" : ""}`}>
                            <b>{ch.name}</b>{ch.lbp > 0 && <span className="red"> +{ch.lbp} LBP</span>} — <span className="muted">{ch.desc}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <div className="row between">
                      <p className="sub teal">Advantages (spend LBP)</p>
                      <span className={`sm ${spentLBP > earnedLBP ? "red" : "muted"}`}>{spentLBP}/{earnedLBP} LBP spent</span>
                    </div>
                    <div className="stack-xs">
                      {lin.advantages.map((adv) => {
                        const on = char.lbpAdvantages.includes(adv.name);
                        const canAfford = on || spentLBP + adv.lbp <= earnedLBP;
                        return (
                          <button key={adv.name} onClick={() => canAfford && tog("lbpAdvantages", adv.name)} className={`opt ${on ? "is-good" : ""} ${!canAfford ? "is-disabled" : ""}`}>
                            <b>{adv.name}</b><span className="teal"> {adv.lbp} LBP</span> — <span className="muted">{adv.desc}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  function Step3() {
    return (
      <div className="stack-sm">
        <p className="muted">Optional (required for Clerics). With Worship (1 BP), access up to 2 Divine Domains from your Devotion.</p>
        {char.selectedClass === "Cleric" && (
          <div className="callout">⚠ <strong>Clerics must choose a Devotion</strong> — it powers Refreshing Prayer and your class identity.</div>
        )}
        <div className="stack-xs">
          {DEVOTIONS.map((dev, i) => {
            const sel = char.selectedDevotionIndex === i;
            return (
              <button key={dev.name} onClick={() => upd("selectedDevotionIndex", sel ? null : i)} className={`card ${sel ? "is-sel" : ""}`}>
                <div className="card-head">
                  <span className="card-name sm">{dev.name}</span>
                  <span className="muted sm">{dev.locality}</span>
                </div>
                <div className="row wrap gap1">
                  {dev.domains.length > 0 ? dev.domains.map((d) => <Tag key={d} label={d} tone="purple" />) : <span className="muted italic sm">No divine domains</span>}
                </div>
                {sel && dev.tenets && <p className="card-quote">"{dev.tenets}"</p>}
                {sel && dev.color && <p className="muted sm">Devotion color: {dev.color}</p>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function Step4() {
    const [skillSearch, setSkillSearch] = useState("");
    const [activeSkillCat, setActiveSkillCat] = useState("All");
    const [activePerkCat, setActivePerkCat] = useState("All");

    const filteredSkills = useMemo(() => ALL_SKILLS.filter((s) => {
      const matchCat = activeSkillCat === "All" || s.cat === activeSkillCat;
      const q = skillSearch.toLowerCase();
      const matchSearch = !skillSearch || s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q) || (s.prereq && s.prereq.toLowerCase().includes(q));
      return matchCat && matchSearch;
    }), [skillSearch, activeSkillCat]);

    const filteredPerks = useMemo(() => ALL_PERKS.filter((p) => activePerkCat === "All" || p.cat === activePerkCat), [activePerkCat]);

    const PurchaseList = ({ items, selectedKey }) => (
      <div className="stack-xs">
        {items.map((it) => {
          const on = char[selectedKey].includes(it.name);
          const cost = typeof it.cost === "number" ? it.cost : 0;
          const wouldOver = !on && totalSpent + cost > totalBP;
          return (
            <button key={it.name} onClick={() => tog(selectedKey, it.name)} className={`opt ${on ? "is-good" : wouldOver ? "is-dim" : ""}`}>
              <div className="opt-head">
                <div>
                  <b>{it.name}</b>
                  {it.ranks && <span className="muted"> (×{it.ranks})</span>}
                  {on && <span className="teal"> ✓</span>}
                </div>
                <span className={`opt-cost ${on ? "teal" : wouldOver ? "dim" : "amber"}`}>{it.cost} BP</span>
              </div>
              {it.prereq && <p className="dim sm">Req: {it.prereq}</p>}
              <p className="muted sm">{it.desc}</p>
            </button>
          );
        })}
      </div>
    );

    return (
      <div className="stack">
        {/* Live BP bar */}
        <div className="bp-sticky">
          <div className="row between">
            <span className="label nomb">Build Points</span>
            <div className="row gap2 muted sm">
              <span>Base: <span className="amber">{levelData.bp}</span></span>
              {flawBP > 0 && <span>Flaws: <span className="green">+{flawBP}</span></span>}
              {backstoryBP > 0 && <span>Story: <span className="green">+{backstoryBP}</span></span>}
            </div>
          </div>
          <BPBar spent={totalSpent} total={totalBP} />
          <div className="row between sm muted">
            <span>Skills: <span className="amber">{skillBPSpent} BP</span></span>
            <span>Perks: <span className="amber">{perkBPSpent} BP</span></span>
            <span className={remainingBP < 0 ? "red bold" : ""}>Remaining: <b>{remainingBP}</b></span>
          </div>
        </div>

        {/* FLAWS */}
        <Accordion title="Flaws — earn up to 5 BP" icon="⚡" defaultOpen={true}>
          <p className="hint mb">Max 5 BP awarded regardless of how many flaws you take. {flawBPRaw > 5 && <span className="amber">({flawBPRaw} BP earned, capped at 5)</span>}</p>
          {FLAW_CATS.map((cat) => (
            <div key={cat} className="mb">
              <p className="cat-label">{cat}</p>
              <div className="stack-xs">
                {ALL_FLAWS.filter((f) => f.cat === cat).map((f) => {
                  const on = char.selectedFlaws.includes(f.name);
                  return (
                    <button key={f.name} onClick={() => tog("selectedFlaws", f.name)} className={`opt ${on ? "is-bad" : ""}`}>
                      <b>{f.name}</b> <span className="red">+{f.bpLabel ?? f.bp} BP</span> — <span className="muted">{f.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </Accordion>

        {/* SKILLS */}
        <Accordion title={`Skills — ${skillBPSpent} BP spent`} icon="⚔" defaultOpen={true}>
          <p className="hint mb">Note: Starting Skills from your Class are free — only purchase skills here that are NOT in your class's Starting Skills list.</p>
          <input className="input mb" placeholder="Search skills…" value={skillSearch} onChange={(e) => setSkillSearch(e.target.value)} />
          <div className="row wrap gap1 mb">
            {["All", ...SKILL_CATS].map((cat) => (
              <button key={cat} onClick={() => setActiveSkillCat(cat)} className={`chip sm ${activeSkillCat === cat ? "is-on" : ""}`}>{cat}</button>
            ))}
          </div>
          <PurchaseList items={filteredSkills} selectedKey="selectedSkills" />
          {filteredSkills.length === 0 && <p className="muted italic sm">No skills match.</p>}
        </Accordion>

        {/* PERKS */}
        <Accordion title={`Perks — ${perkBPSpent} BP spent`} icon="✦" defaultOpen={false}>
          <div className="row wrap gap1 mb">
            {["All", ...PERK_CATS].map((cat) => (
              <button key={cat} onClick={() => setActivePerkCat(cat)} className={`chip sm ${activePerkCat === cat ? "is-on" : ""}`}>{cat}</button>
            ))}
          </div>
          <PurchaseList items={filteredPerks} selectedKey="selectedPerks" />
        </Accordion>
      </div>
    );
  }

  function Step5() {
    const devObj = char.selectedDevotionIndex !== null ? DEVOTIONS[char.selectedDevotionIndex] : null;
    const stats = [
      { label: "Life Points", val: totalLP, icon: "❤" },
      { label: "Spikes", val: levelData.spikes, icon: "⚡" },
      { label: "Wealth", val: "8g", icon: "◈" },
    ];
    return (
      <div className="stack">
        <div className="summary-header">
          <div className="row between start">
            <div>
              <h2 className="summary-name">{char.name || "Unnamed"}</h2>
              <p className="muted sm">{char.civilization} · Level {char.level} {char.selectedClass}{char.secondaryClass ? " / " + char.secondaryClass : ""}</p>
            </div>
            <div className={`summary-bp ${remainingBP < 0 ? "red" : "amber"}`}>
              <span>{totalSpent}/{totalBP} BP</span>
              <span className="summary-bp-sub">{remainingBP >= 0 ? `${remainingBP} remaining` : `${-remainingBP} over budget`}</span>
            </div>
          </div>
          <div className="stat-grid">
            {stats.map((s) => (
              <div key={s.label} className="stat">
                <div>{s.icon}</div>
                <div className="stat-val">{s.val}</div>
                <div className="muted sm">{s.label}</div>
              </div>
            ))}
          </div>
          <BPBar spent={totalSpent} total={totalBP} />
        </div>

        {char.selectedClass && (
          <Accordion title="Class" icon="⚔" defaultOpen={true}>
            <p className="b amber mb">{char.selectedClass}{char.secondaryClass ? " / " + char.secondaryClass : ""}</p>
            {CLASSES[char.selectedClass].startingSkills.map((s, i) => <p key={i} className="line">✓ {s}</p>)}
            {char.secondaryClass && <p className="line muted">MC skills: {CLASSES[char.secondaryClass].multiclassSkills}</p>}
          </Accordion>
        )}

        {char.selectedLineage && (
          <Accordion title="Lineage" icon="🧬" defaultOpen={true}>
            <div className="row gap1 mb">
              <span className="b amber">{char.selectedLineage}</span>
              {char.selectedSubLineage && <Tag label={char.selectedSubLineage} tone="blue" />}
            </div>
            {char.selectedChallenges.length > 0 && (
              <div className="mb">
                <p className="muted sm">Challenges ({earnedLBP} LBP earned):</p>
                {char.selectedChallenges.map((c) => <p key={c} className="line red">⚠ {c}</p>)}
              </div>
            )}
            {char.lbpAdvantages.length > 0 && (
              <div>
                <p className="muted sm">Advantages ({spentLBP}/{earnedLBP} LBP):</p>
                {char.lbpAdvantages.map((a) => <p key={a} className="line teal">✦ {a}</p>)}
              </div>
            )}
          </Accordion>
        )}

        {devObj && (
          <Accordion title="Devotion" icon="🌟" defaultOpen={true}>
            <p className="b amber">{devObj.name}</p>
            <div className="row wrap gap1 mb">{devObj.domains.map((d) => <Tag key={d} label={d} tone="purple" />)}</div>
            {devObj.tenets && <p className="muted italic sm">"{devObj.tenets}"</p>}
          </Accordion>
        )}

        {char.selectedSkills.length > 0 && (
          <Accordion title={`Purchased Skills — ${skillBPSpent} BP`} icon="📚" defaultOpen={true}>
            {char.selectedSkills.map((n) => {
              const s = ALL_SKILLS.find((x) => x.name === n);
              return <div key={n} className="row between sm"><span className="teal">{n}</span><span className="amber">{s?.cost} BP</span></div>;
            })}
          </Accordion>
        )}

        {char.selectedPerks.length > 0 && (
          <Accordion title={`Purchased Perks — ${perkBPSpent} BP`} icon="✦" defaultOpen={true}>
            {char.selectedPerks.map((n) => {
              const p = ALL_PERKS.find((x) => x.name === n);
              return <div key={n} className="row between sm"><span className="teal">{n}</span><span className="amber">{p?.cost} BP</span></div>;
            })}
          </Accordion>
        )}

        {char.selectedFlaws.length > 0 && (
          <Accordion title={`Flaws — +${flawBP} BP earned`} icon="⚡" defaultOpen={true}>
            {char.selectedFlaws.map((n) => {
              const f = ALL_FLAWS.find((x) => x.name === n);
              return <div key={n} className="row between sm"><span className="red">{n}</span><span className="red">+{f?.bpLabel ?? f?.bp} BP</span></div>;
            })}
            {flawBPRaw > 5 && <p className="amber sm">({flawBPRaw} BP earned, capped at 5)</p>}
          </Accordion>
        )}

        <Accordion title="BP Breakdown" icon="📊" defaultOpen={true}>
          <div className="row between sm"><span className="muted">Base (Level {char.level})</span><span className="amber">{levelData.bp}</span></div>
          {flawBP > 0 && <div className="row between sm"><span className="muted">Flaws</span><span className="green">+{flawBP}</span></div>}
          {backstoryBP > 0 && <div className="row between sm"><span className="muted">Backstory (pending approval)</span><span className="green">+{backstoryBP}</span></div>}
          <div className="row between sm b divider"><span>Total Available</span><span className="amber">{totalBP}</span></div>
          {skillBPSpent > 0 && <div className="row between sm"><span className="muted">Skills spent</span><span className="red">−{skillBPSpent}</span></div>}
          {perkBPSpent > 0 && <div className="row between sm"><span className="muted">Perks spent</span><span className="red">−{perkBPSpent}</span></div>}
          <div className={`row between sm b divider ${remainingBP < 0 ? "red" : "amber"}`}><span>Remaining</span><span>{remainingBP} BP</span></div>
        </Accordion>

        <div className="callout stack-xs">
          <p className="b mb">Next Steps</p>
          <p>1. Purchase remaining skills you want with your {remainingBP} remaining BP</p>
          <p>2. Submit to plot via the Character Submission Form on the website</p>
          {char.backstory.trim().length > 20 && <p>3. Include backstory for staff approval (+2 BP if approved)</p>}
          <p>{char.backstory.trim().length > 20 ? "4" : "3"}. Collect your starting 8 Wealth and any mundane equipment you phys-rep</p>
        </div>
      </div>
    );
  }

  const stepFns = [Step0, Step1, Step2, Step3, Step4, Step5];
  const CurrentStep = stepFns[step];

  return (
    <div className="cc">
      <div className="cc-inner">
        <header className="cc-header">
          <h1 className="cc-title">Wellspring</h1>
          <p className="cc-subtitle">Character Creation</p>
          <div className="cc-rule" />
        </header>

        <nav className="step-nav">
          {STEPS.map((s, i) => (
            <button key={i} onClick={() => setStep(i)} className={`step-tab ${i === step ? "is-active" : i < step ? "is-done" : ""}`}>
              <span className="step-num">{i + 1}</span>
              <span className="step-name">{s}</span>
            </button>
          ))}
        </nav>

        <main className="step-content">
          <CurrentStep />
        </main>

        <footer className="cc-nav">
          <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className="btn">← Back</button>
          <div className="row gap2 center">
            <span className={`bold ${remainingBP < 0 ? "red" : "amber"}`}>{totalSpent}/{totalBP} BP</span>
            {step < STEPS.length - 1 && (
              <button onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))} className="btn btn-primary">Next →</button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
