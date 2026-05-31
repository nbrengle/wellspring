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

// Full power score for a class power object: effect × frequency × tier × accent.
export function powerScore(p, tier) {
  const accentText = [p.description, p.call, p.effect, p.accent].filter(Boolean).join(' ');
  return rawPower(`powers:${p.name}`) * freqMult(p.refresh || p.refreshes) * tierMult(tier) * accentPenalty(accentText);
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
