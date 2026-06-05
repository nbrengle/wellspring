// Effect-coverage auditor.
//
// The LP bug taught us the real failure mode: an ability's MegaDoc text STATES a
// mechanical effect, but the builder's text-scanners don't recognize it, so it's
// silently dropped. This script looks for that across EVERY ability.
//
// Method: for each ability (skills, perks, flaws, class powers/innate, class
// progression bonuses), scan its description for "effect signals" — phrases that
// denote a permanent, build-relevant mechanical effect (max LP/Spikes/Armor,
// extra slots/known-spells, recurring Wealth, granted abilities). For each signal
// hit, check whether the builder's OWN extraction logic would catch it. A signal
// the builder catches → covered; a signal it misses → a CANDIDATE GAP to triage.
//
// This is a heuristic lint, not proof: it over-reports (a sentence may mention
// "Life Points" in a non-build way) and under-reports (novel phrasings escape the
// signal set). Output is a triage list, not a pass/fail gate.

import {
  ALL_SKILLS, ALL_PERKS, ALL_FLAWS, CLASS_POWERS, CLASS_PROGRESSION, LINEAGES, lookupEntity,
} from '../../src/data/index.js';

// Full description for an ability — the ALL_* collections carry `desc`, class
// power buckets are stripped (resolve via lookupEntity), progression rows carry
// the bonus prose directly.
const descOf = (e, typePrefix) =>
  e?.description || e?.desc
  || (e?.name && typePrefix && lookupEntity(`${typePrefix}:${e.name}`)?.description)
  || '';

// ── 1. Effect signals: "this text claims a permanent build effect" ───────────
// Each signal has a category and a broad detector. Kept deliberately broad so we
// don't miss a real effect; false positives are triaged out by hand.
const SIGNALS = [
  { cat: 'maxLifePoints', re: /\bMaximum Life Points?\b|\bLife Points?\b[^.]*\bmax|max[^.]*\bLife Points?\b|\+\s*\d+\s*(?:Base\s+)?(?:Maximum\s+)?Life Points?/i },
  // Maximum Spikes only — NOT "Spike Damage" (a damage bonus, different stat).
  { cat: 'maxSpikes',     re: /(?:Maximum|Base Maximum)\s+Spikes?\b(?!\s+Damage)|\+\s*\d+\s+(?:Bonus\s+)?Maximum\s+Spikes?\b/i },
  { cat: 'armor',         re: /\bNatural Armor\b|\+\s*\d+\s*(?:physical\s+)?Armor Points?\b|\bArmor Points?\b[^.]*\bmax/i },
  { cat: 'slots',         re: /\badditional\s+(?:Cantrip|Utility|Basic|Advanced|Veteran)\s+(?:Tier\s+)?Power|\badds?\s+\d+\s+to\s+the\s+number\s+of\s+Known Spells|additional\s+Known Spell/i },
  // Per-day SPELL-slots (Novice/Adept/Greater) — scanned by spellSlots(), which
  // ONLY walks startingSkills/purchasedSkills. A grant from a perk, lineage
  // advantage, or innate is dropped. `spellSlotField` flags whether the source
  // field is one spellSlots() actually reads.
  { cat: 'spellSlot',     re: /\badditional\s+(?:Novice|Adept|Greater|highest[- ]level)\s+spell-?slot|gains?\s+an?\s+additional\s+spell-?slot/i },
  { cat: 'wealth',        re: /\bWealth\b[^.]*\b(?:beginning of (?:each|every) (?:game|event)|per Event)|Alternatively,?\s*\d+\s*Wealth|\d+\s*Wealth\s+at the beginning of (?:their\s+)?first/i },
  { cat: 'grant',         re: /\bgains?\s+(?:the\s+)?[A-Z][\w' -]+\s+(?:Perk|Power|Skill|Cantrip|Spell)\b|\bgrants?\s+(?:them|themselves|the character)\b/i },
  // STRUCTURAL grants stated in progression / innate text: "Innate Bonus Cantrip:
  // Cancel" (Mage has Cancel — must be materialized as a locked cantrip), and
  // named auto-grants. These are not numeric stats; the check is whether the
  // builder MATERIALIZES the named ability, not whether a regex extracts a number.
  { cat: 'innateCantrip', re: /\bInnate Bonus Cantrip:\s*[A-Z]/i },
];

// ── 2. Builder coverage: would validate.js extract something here? ────────────
// Mirror of the builder's actual scanner regexes (validate.js). Keep in sync if
// those change — this is the whole point of the audit, so a drift is itself a
// finding.

// statMods STAT_PATTERNS (post-LP-fix).
const STAT_RE = {
  lifePoints: [
    /(?:\+?(\d+)|\bone)\s+(?:maximum\s+)?Life\s+Points?\s+to\s+(?:their\s+)?max(?:imum)?/i,
    /(?:additional\s+)?(?:\+?(\d+)|\bone)\s+maximum\s+Life\s+Points?/i,
    /(?:adds?|gains?)\s+(?:\+?(\d+)|\bone)\s+Life\s+Points?\s+to\s+(?:their\s+)?max(?:imum)?/i,
    /\+\s*(\d+)\s+(?:Base\s+)?Maximum\s+Life\s+Points?/i,
    /(?:Base\s+)?Maximum\s+Life\s+Points?\s+(?:is|are)\s+increased\s+by\s+(?:\+?(\d+)|\bone)/i,
    /(?:\+?(\d+)|\bone)\s+Maximum\s+Health\b/i,
  ],
  spikes: [
    /(?:\+?(\d+)|\bone)\s+(?:(?:Base|Bonus)\s+)?Maximum\s+Spikes?\b/i,
    /(?:Base\s+)?Maximum\s+Spikes?\s+(?:is|are)\s+increased\s+by\s+(?:\+?(\d+)|\bone)/i,
  ],
  armor: [
    /(?:gains?|grant(?:ing|s)?)\s+(?:\+?(\d+)|\bone|three|two)\s+(?:points?\s+of\s+)?Natural\s+Armor/i,
    /(\d+)\s+points?\s+of\s+Natural\s+Armor/i,
    /\+?(\d+)\s+(?:Maximum\s+Health,?\s+)?(?:physical\s+)?Armor\s+Points?/i,
    /\+?(\d+)\s+Maximum\s+Health,?\s+physical\s+Armor\s+Points?,?\s+and\s+Natural\s+Armor\s+Points?/i,
    /(?:and\s+)?(?:\+?(\d+)\s+)?Natural\s+Armor\s+Points?/i,
  ],
};
// scanSlotGrant
const SLOT_RE = [
  /\badditional\s+cantrip\b/i,
  /\badditional\s+(Novice|Adept|Greater|Utility|Basic|Advanced|Veteran)\s+(?:Tier\s+)?(?:spell-?\s*slot|slot|power)/i,
  /\badds?\s+(\d+)\s+to\s+the\s+number\s+of\s+Known\s+Spells/i,
];
// scanWealthIncome
const WEALTH_RE = [
  /(\d+)\s*Wealth\s+(?:at the beginning of (?:each|every)\s+(?:game|event)|per\s+Event)/i,
  /Alternatively,?\s*(\d+)\s*Wealth/i,
  /(\d+)\s*Wealth\s+at the beginning of (?:their\s+)?first\s+Event/i,
  /one-time\s+sum[^.]*?(\d+)\s*Wealth/i,
];

const anyMatch = (res, text) => res.some((re) => re.test(text));

// Map a signal category to "does the builder catch THIS kind of effect at all".
// `grant` is handled by the reference graph (REFS.grants) at build time, not by a
// text scan, so we can't cheaply replicate it — mark those as 'graph' (needs
// manual check that the grant edge exists) rather than miss.
// Per-day spell-slot grant regex (spellSlots()), and the fields it walks.
const SPELLSLOT_RE = /\badditional\s+(Novice|Adept|Greater|highest[- ]level)\s+spell-?slot|gains?\s+an?\s+additional\s+spell-?slot/i;
const SPELLSLOT_FIELDS_SCANNED = ['skill', 'perk', 'lineage'];

function builderCatches(cat, text, kind) {
  switch (cat) {
    case 'maxLifePoints': return anyMatch(STAT_RE.lifePoints, text);
    case 'maxSpikes':     return anyMatch(STAT_RE.spikes, text);
    case 'armor':         return anyMatch(STAT_RE.armor, text);
    case 'slots':         return anyMatch(SLOT_RE, text);
    case 'wealth':        return anyMatch(WEALTH_RE, text);
    case 'grant':         return 'graph';
    // innateBonusCantrips (PR #12) extracts the named cantrip from this prose.
    case 'innateCantrip': return /\binnate\s+bonus\s+cantrip:\s*([^]*)/i.test(text);
    case 'spellSlot': {
      // Caught only if the phrasing matches AND the source is a field spellSlots
      // actually reads.
      const sourceKind = kind.split(':')[0].split('/')[0];
      const fieldScanned = SPELLSLOT_FIELDS_SCANNED.includes(sourceKind);
      if (!SPELLSLOT_RE.test(text)) return false;     // phrasing missed
      return fieldScanned ? true : 'wrong-field';     // right phrasing, unscanned source
    }
    default:              return false;
  }
}

// ── 3. Enumerate every ability with its description ──────────────────────────
function* abilities() {
  for (const s of ALL_SKILLS) yield { kind: 'skill', name: s.name, text: descOf(s, 'skills') };
  for (const p of ALL_PERKS) yield { kind: 'perk', name: p.name, text: descOf(p, 'perks') };
  for (const f of ALL_FLAWS) yield { kind: 'flaw', name: f.name, text: descOf(f, 'flaws') };
  for (const [cls, buckets] of Object.entries(CLASS_POWERS)) {
    for (const [b, arr] of Object.entries(buckets)) {
      if (!Array.isArray(arr)) continue;
      for (const p of arr) yield { kind: `power:${cls}/${b}`, name: p.name, text: descOf(p, 'powers'), tags: p.tags };
    }
  }
  for (const [cls, prog] of Object.entries(CLASS_PROGRESSION)) {
    for (const [lvl, row] of Object.entries(prog)) {
      if (row?.bonus) yield { kind: `progression:${cls}`, name: `${cls} L${lvl} bonus`, text: row.bonus, progression: { cls, lvl: +lvl } };
    }
  }
  for (const [ln, d] of Object.entries(LINEAGES || {})) {
    for (const a of (d.advantages || [])) {
      yield { kind: `lineage:${ln}`, name: a.baseName || a.name, text: a.desc || a.description };
    }
  }
}

// ── 4. Run ───────────────────────────────────────────────────────────────────
const gaps = [];        // signal hit, builder misses
const graphChecks = []; // grant signals to eyeball
let scanned = 0, signalHits = 0;

for (const a of abilities()) {
  if (!a.text) continue;
  scanned++;
  for (const { cat, re } of SIGNALS) {
    if (!re.test(a.text)) continue;
    signalHits++;
    const caught = builderCatches(cat, a.text, a.kind);
    // Form-tagged powers grant LP/armor only while transformed — intentionally
    // excluded from permanent stats, so not a gap.
    const formExcluded = (cat === 'maxLifePoints' || cat === 'armor' || cat === 'maxSpikes')
      && Array.isArray(a.tags) && a.tags.includes('Form');
    if (caught === 'graph') {
      graphChecks.push({ ...a, cat });
    } else if (caught === 'wrong-field') {
      gaps.push({ kind: a.kind, name: a.name, cat: `${cat} (unscanned source field)`, sentence: firstEffectSentence(a.text, cat) });
    } else if (!caught && !formExcluded) {
      gaps.push({ kind: a.kind, name: a.name, cat, sentence: firstEffectSentence(a.text, cat) });
    }
  }
}

function firstEffectSentence(text, cat) {
  for (const s of text.split(/(?<=[.•])\s+/)) {
    if (SIGNALS.find((x) => x.cat === cat)?.re.test(s)) return s.trim().slice(0, 160);
  }
  return text.slice(0, 160);
}

// ── 5. Report ─────────────────────────────────────────────────────────────────
console.log(`Scanned ${scanned} abilities; ${signalHits} effect-signal hits.\n`);

const byCat = {};
for (const g of gaps) (byCat[g.cat] = byCat[g.cat] || []).push(g);
console.log(`=== CANDIDATE GAPS: text states an effect the builder's scanners DON'T extract ===`);
if (!gaps.length) console.log('  (none)');
for (const [cat, list] of Object.entries(byCat)) {
  console.log(`\n## ${cat} (${list.length})`);
  for (const g of list) console.log(`  [${g.kind}] ${g.name}\n      "${g.sentence}"`);
}

console.log(`\n=== GRANT signals (verify a REFS.grants edge exists for each) — ${graphChecks.length} ===`);
for (const g of graphChecks.slice(0, 40)) console.log(`  [${g.kind}] ${g.name}`);
if (graphChecks.length > 40) console.log(`  …and ${graphChecks.length - 40} more`);
