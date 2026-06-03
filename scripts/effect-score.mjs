// effect-score.mjs — the single source of truth for scoring an ability's power by
// the EFFECTS it delivers. Shared by power-search.mjs (ranking) and
// build-sheets.mjs (build generation) so the two can't drift — and so the
// cantrip/accent weighting (#64) applies everywhere. All factors live in
// effect-weights.json (effects/conditions/defenses + tierMultiplier + accentRarity).
import { REFS, CLASS_POWERS } from '../src/data/index.js';
import EFFECT_WEIGHTS from '../src/data/effect-weights.json' with { type: 'json' };

const WEIGHT = { effects: EFFECT_WEIGHTS.effects, conditions: EFFECT_WEIGHTS.conditions, defenses: EFFECT_WEIGHTS.defenses };

// Frequency multiplier from a power's `refresh`. Steep (user): a spammable effect
// is worth far more than once-per-event. Multi-valued refresh → most generous tier.
export function freqMult(refresh) {
  const r = String(refresh || '').toLowerCase();
  if (/at[- ]?will|immediate|instantaneous|quick|focus/.test(r)) return 3;
  if (/short rest/.test(r)) return 2;
  if (/spell/.test(r)) return 1.5;        // costs a spell-slot — repeatable while slots last
  if (/long rest/.test(r)) return 1;
  if (/event|special|once/.test(r)) return 0.5;
  return 1;
}

// Tier multiplier — cantrips are weak despite spammability; higher tiers hit
// harder (#64). Defaults to 1 for unlisted tiers.
export const tierMult = (tier) => EFFECT_WEIGHTS.tierMultiplier?.[tier] ?? 1;

// Accent-availability penalty — effects gated behind rare accents (Divine needs a
// devotion; Void/Radiant uncommon) are less practical (#64). Take the rarest accent
// the power's text invokes.
const ACCENT_RARITY = EFFECT_WEIGHTS.accentRarity || {};
export function accentPenalty(text) {
  let mult = 1;
  for (const [accent, m] of Object.entries(ACCENT_RARITY)) {
    if (accent === '_comment') continue;
    if (new RegExp(`\\b${accent}\\b`).test(text || '') && m < mult) mult = m;
  }
  return mult;
}

// Duration / usability penalty — how long a power takes to USE. Combat is
// real-time, so a long setup makes an otherwise-spammable effect impractical
// mid-fight (Soothe is an at-will Cure but needs a multi-minute conversation).
// "Quick N" is an IN-COMBAT timed count (N seconds): only mildly penalized,
// scaling with N (longer = worse). "Out of combat" / minute-scale setups are
// penalized hardest. Returns the SINGLE harshest applicable factor. Tunable in
// effect-weights.json → durationPenalty.
const DUR = EFFECT_WEIGHTS.durationPenalty || {};
export function durationPenalty(text) {
  const t = String(text || '');
  let mult = 1;
  const take = (m) => { if (typeof m === 'number' && m < mult) mult = m; };
  // Hardest: explicitly out of combat (can't be cast/used in a fight at all).
  if (/out(side)? of combat|may not be used in combat|cannot be (used|cast)[^.]*in combat/i.test(t)) take(DUR.outOfCombat);
  // Minute-scale setup (e.g. "a long conversation for a few minutes").
  if (/\b(a few|several|couple of|\d+)\s+minutes?\b|long conversation/i.test(t)) take(DUR.minutes);
  // "Quick N" — in-combat count; longer counts are worse.
  for (const m of t.matchAll(/Quick (\d+)/gi)) {
    const n = +m[1];
    take(n >= 100 ? DUR.quick100 : n >= 30 ? DUR.quick30 : DUR.quick10);
  }
  // Sub-minute spoken/held setup ("spend ten seconds…").
  if (/\b(ten|twenty|thirty|\d+)\s+seconds?\b/i.test(t)) take(DUR.seconds);
  return mult;
}

// The effect-ish entities an ability invokes, with per-effect weight.
export function effectHits(entityId) {
  const hits = [];
  for (const t of REFS.mentions[entityId] || []) {
    const [type, name] = [t.slice(0, t.indexOf(':')), t.slice(t.indexOf(':') + 1)];
    const w = (WEIGHT[type] && WEIGHT[type][name]) || 0;
    if (w > 0) hits.push({ id: t, name, w });
  }
  return hits;
}

// Raw (frequency-unweighted) effect-power of an ability.
export const rawPower = (entityId) => effectHits(entityId).reduce((s, h) => s + h.w, 0);

// Frequency-weighted power (perks/skills have no refresh → ×1).
export const abilityPower = (entityId, refresh) => rawPower(entityId) * freqMult(refresh);

// Full power score: effect × frequency × tier × accent × duration. Duration
// down-weights powers that take a long real-time setup to use (combat is real
// time, so a multi-minute Cure is far less useful than the refresh implies).
export function powerScore(p, tier) {
  const text = [p.desc, p.description, p.call, p.effect, p.accent].filter(Boolean).join(' ');
  return rawPower(`powers:${p.name}`)
    * freqMult(p.refresh || p.refreshes)
    * tierMult(tier)
    * accentPenalty(text)
    * durationPenalty(text);
}

// Every power a class can hold, with its refresh, effect hits, and full score.
export function classPowers(cls) {
  const out = [];
  for (const [tier, arr] of Object.entries(CLASS_POWERS[cls] || {})) {
    if (!Array.isArray(arr)) continue;
    for (const p of arr) {
      const hits = effectHits(`powers:${p.name}`);
      if (!hits.length) continue;
      out.push({
        name: p.name, tier, refresh: p.refresh || p.refreshes || 'None',
        hits, score: powerScore(p, tier),
        topEffects: hits.sort((a, b) => b.w - a.w).map((h) => h.name),
      });
    }
  }
  return out;
}
