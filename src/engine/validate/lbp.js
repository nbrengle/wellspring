// Lineage Build Point (LBP) economy — a separate currency from BP. Challenges
// AWARD LBP (capped at MAX_LBP); advantages SPEND it. Challenges/advantages are
// scoped to "General" or a single sublineage (you can't mix sublineages). Returns
// null when no lineage is set, else the full state for the UI + validity.
//
// Extracted from validate.js (hotspot split): self-contained, depends only on the
// lineage data + shared constants, so it lives in its own module and is re-exported
// by the validate.js barrel for unchanged imports.

import { LINEAGES, REFS } from '../../data/index.js';
import { cleanItemName } from '../resolver.js';
import { MAX_LBP, subKey } from './core.js';

export function lbpState(character) {
  const lin = character?.lineage && LINEAGES[character.lineage];
  if (!lin) return null;
  const chosenC = character.lineageChallenges || [];
  const chosenA = character.lineageAdvantages || [];
  const stripParameter = (s) => {
    const firstOpen = s.indexOf('(');
    const lastClose = s.lastIndexOf(')');
    if (firstOpen !== -1 && lastClose > firstOpen) {
      return (s.slice(0, firstOpen) + s.slice(lastClose + 1)).trim();
    }
    return s.trim();
  };

  // Match a chosen item-name back to its lineage entry (names may carry [Repped]
  // / sublineage tags; compare on the display name the data exposes).
  const findIn = (list, name) => {
    const clean = stripParameter(name);
    return list.find((x) => x.name === clean || x.baseName === clean || x.name === name || x.baseName === name);
  };

  const challenges = chosenC.map((n) => {
    const c = findIn(lin.challenges, n);
    if (!c) return null;

    // If it's Lost Life or Additional Lost Life, compute the LBP dynamically
    if (c.baseName === 'Lost Life' || c.baseName === 'Additional Lost Life') {
      const firstOpen = n.indexOf('(');
      const lastClose = n.lastIndexOf(')');
      const param = (firstOpen !== -1 && lastClose > firstOpen) ? n.slice(firstOpen + 1, lastClose) : '';
      let lbpVal = 0;
      if (param) {
        const numMatch = param.match(/(\d+)\s*LBP/i) || param.match(/(\d+)/);
        if (numMatch) {
          lbpVal = parseInt(numMatch[1], 10);
        } else {
          const cleanParam = param.trim();
          for (const otherLin of Object.values(LINEAGES)) {
            const found = otherLin.challenges.find(x => x.name === cleanParam || x.baseName === cleanParam);
            if (found && typeof found.lbp === 'number') {
              lbpVal = found.lbp;
              break;
            }
          }
        }
      }
      return { ...c, name: n, lbp: lbpVal };
    }

    return { ...c, name: n };
  }).filter(Boolean);

  const advantages = chosenA.map((n) => findIn(lin.advantages, n)).filter(Boolean);

  // Perks that modify the LBP economy (Strong Bloodline: +3 LBP, cap 10→13). Sum
  // any the character owns; the highest stated newMax raises the challenge cap.
  const lbpB = REFS.lbpBonuses || {};
  let bonusLbp = 0, cap = MAX_LBP;
  for (const name of (character.purchasedPerks || [])) {
    const b = lbpB[`perks:${cleanItemName(name)}`];
    if (b) { bonusLbp += b.extra || 0; if (b.newMax) cap = Math.max(cap, b.newMax); }
  }

  const rawAwarded = challenges.reduce((s, c) => s + (c.lbp || 0), 0);
  // Challenge LBP is capped; the perk bonus is granted on top of the cap.
  const awarded = Math.min(rawAwarded, cap) + bonusLbp;
  const spent = advantages.reduce((s, a) => s + (a.lbp || 0), 0);

  // Sublineage scoping: all chosen non-"General" items must share ONE sublineage
  // (normalized, since the data tags it inconsistently), and — when the character
  // has picked a sublineage — must match that one. REQUIRED challenges are
  // mandatory baseline costume regardless of sublineage choice, so they're
  // excluded from the commitment check below (some lineages tag a required
  // challenge to a default presentation).
  const subs = new Set([...challenges, ...advantages]
    .map((x) => subKey(x.sublineage)).filter((s) => s && s !== 'general'));
  const optionalSubs = new Set([...challenges, ...advantages]
    .filter((x) => !x.required)
    .map((x) => subKey(x.sublineage)).filter((s) => s && s !== 'general'));
  const pickedSub = character.sublineage ? subKey(character.sublineage) : null;
  const mixedSublineage = subs.size > 1
    || (pickedSub && [...subs].some((s) => s !== pickedSub));

  // A sublineage is a COMMITMENT: any OPTIONAL chosen item tagged to a sublineage
  // (e.g. a Psionic challenge, which represents being psionic) requires that the
  // character has actually SELECTED that sublineage. Without this, a Human could
  // take Psionic challenges (their downside) for LBP without committing to Psionic
  // at all (#2). Flags sublineages owned-but-not-selected.
  const needsSublineage = !pickedSub && optionalSubs.size > 0;
  const requiredSublineages = needsSublineage ? [...optionalSubs] : [];

  // Required challenges the character hasn't taken (some lineages mandate them).
  // A required challenge belonging to a specific sublineage is only required if
  // that sublineage is selected.
  const missingRequired = lin.challenges
    .filter((c) => {
      if (!c.required) return false;
      const cSub = subKey(c.sublineage);
      if (cSub && cSub !== 'general' && cSub !== pickedSub) return false;
      return !challenges.some((x) => x.baseName === c.baseName);
    });

  return {
    lineage: character.lineage,
    sublineage: character.sublineage || null,
    sublineages: lin.sublineages || [],
    challenges: lin.challenges,
    advantages: lin.advantages,
    chosenChallenges: challenges,
    chosenAdvantages: advantages,
    awarded, rawAwarded, cap, bonusLbp, capped: rawAwarded > cap,
    spent, remaining: awarded - spent,
    overspent: spent > awarded,
    mixedSublineage,
    needsSublineage,
    requiredSublineages,
    missingRequired,
    valid: spent <= awarded && !mixedSublineage && !needsSublineage && !missingRequired.length,
  };
}
