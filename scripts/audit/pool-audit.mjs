// pool-audit.mjs — surfaces every "pool" mechanic across the data and flags the
// source-text inconsistencies that block deriving pools cleanly (the first step
// toward exposing pools in the UI; see the pools plan).
//
// A "pool" is a per-character points reserve a class power establishes (Healing
// Touch Pool, Living Iron pool, …) that other powers spend from / add to. To
// model pools we must (a) know the canonical set of pools and (b) reliably match
// every prose mention to one — but the source spells them inconsistently
// ("Healing Touch Pool" vs "healing pool", "Pool" vs "pool", "a pool of
// Maintenance Points"). This audit lists each canonical pool's mentions WITH
// LOCATIONS, and flags mentions that don't cleanly resolve, so the source text
// (MegaDoc) can be fixed to one canonical spelling per pool.
//
// Run: node scripts/audit/pool-audit.mjs   (or tsx)
import { readdirSync, readFileSync } from 'node:fs';

const flatten = (d) => {
  const o = [];
  const w = (v) => {
    if (Array.isArray(v)) v.forEach(w);
    else if (v && typeof v === 'object') { if (v.name) o.push(v); Object.values(v).forEach(w); }
  };
  w(d);
  return o;
};

const all = [];
for (const f of readdirSync('src/data').filter((x) => x.endsWith('.json'))) {
  let d;
  try { d = JSON.parse(readFileSync('src/data/' + f)); } catch { continue; }
  for (const e of flatten(d)) { e._file = f.replace('.json', ''); all.push(e); }
}

// ── Canonical pools ──────────────────────────────────────────────────────────
// The known pools and the regexes that should match a reference to each. The
// `defines` phrase is what the source SHOULD say (one canonical spelling).
// TODO(derive): ideally these are parsed from the defining power, not listed here.
const CANONICAL_POOLS = [
  { id: 'healing-touch', name: 'Healing Touch Pool', match: /healing touch pool/i, definedBy: 'Healing Touch' },
  { id: 'life-tap',      name: 'Life Tap Pool',      match: /life tap pool/i,      definedBy: 'Life Tap' },
  { id: 'living-iron',   name: 'Living Iron Pool',   match: /living iron pool/i,   definedBy: 'Living Iron' },
  { id: 'balance',       name: 'Balance Pool',       match: /balance pool/i,       definedBy: 'The Balance of Life' },
  { id: 'maintenance',   name: 'Maintenance Points',  match: /maintenance points?\b|maintenance pool/i, definedBy: 'Field Maintenance' },
];

// Any "<words> pool" or "pool of <X>" phrase, to catch mentions that DON'T map to
// a canonical pool (variant spellings, or a pool we haven't catalogued).
const ANY_POOL = /\b([A-Za-z][A-Za-z'’]*(?:\s+[A-Za-z][A-Za-z'’]*){0,3}\s+[Pp]ool)\b|pool of ([A-Za-z][A-Za-z ]+?Points?)/g;
// Phrases that are anaphora, not a named pool ("this pool", "the pool") — ignore.
const ANAPHORA = /^(this|the|a|their|its|that|existing|same)\s+pool$/i;

const byPool = new Map(CANONICAL_POOLS.map((p) => [p.id, []]));
const unresolved = [];   // pool-ish phrases that match no canonical pool
const variantSpellings = new Map(); // canonical id -> Set of exact raw spellings seen

const textOf = (e) => [e.description, e.effect, e.call].filter(Boolean).join('  ');

for (const e of all) {
  const text = textOf(e);
  if (!/pool/i.test(text)) continue;

  // 1) which canonical pools does this entity reference?
  for (const p of CANONICAL_POOLS) {
    if (p.match.test(text)) byPool.get(p.id).push(e);
  }

  // 2) collect raw "...pool" spellings; flag any that don't map to a canonical.
  let m;
  ANY_POOL.lastIndex = 0;
  while ((m = ANY_POOL.exec(text))) {
    const raw = (m[1] || m[2] || '').replace(/\s+/g, ' ').trim();
    if (!raw || ANAPHORA.test(raw)) continue;
    const canon = CANONICAL_POOLS.find((p) => p.match.test(raw));
    if (canon) {
      // Track just the canonical-name span's exact casing (e.g. "Healing Touch
      // Pool" vs "Healing Touch pool") — that's the actionable spelling variance,
      // not the surrounding grammar words.
      const span = raw.match(/([A-Z][a-z]+(?:\s+[A-Za-z][a-z]+)*\s+[Pp]ool)$/);
      const key = span ? span[1] : raw;
      if (!variantSpellings.has(canon.id)) variantSpellings.set(canon.id, new Map());
      const vm = variantSpellings.get(canon.id);
      if (!vm.has(key)) vm.set(key, new Set());
      vm.get(key).add(`${e.name} [${e._file}]`);
    } else {
      unresolved.push({ raw, entity: e.name, file: e._file });
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log('═══ POOL AUDIT ═══\n');

for (const p of CANONICAL_POOLS) {
  const ents = byPool.get(p.id);
  const def = all.find((e) => e.name === p.definedBy);
  console.log(`▶ ${p.name}  (id: ${p.id})`);
  console.log(`   defined by: ${p.definedBy}${def ? ` [${def._file}]` : '  ⚠ DEFINING POWER NOT FOUND'}`);
  const vm = variantSpellings.get(p.id) || new Map();
  const spellings = [...vm.keys()];
  // Flag when the canonical name is spelled more than one way (e.g. casing).
  const offCanon = spellings.filter((s) => s !== p.name);
  if (offCanon.length > 0) {
    console.log(`   ⚠ non-canonical spellings (canonical = "${p.name}"):`);
    for (const s of offCanon) {
      console.log(`       "${s}"  in  ${[...vm.get(s)].join(', ')}`);
    }
  }
  console.log(`   referenced by ${ents.length}: ${ents.map((e) => e.name).join(', ')}`);
  console.log('');
}

// Variant / wrong-name mentions that should be fixed in source.
console.log('═══ UNRESOLVED / VARIANT MENTIONS (fix these in the MegaDoc) ═══');
if (unresolved.length === 0) {
  console.log('  (none — every pool mention maps to a canonical pool)');
} else {
  for (const u of unresolved) {
    console.log(`  ✗ "${u.raw}"  in  ${u.entity} [${u.file}]`);
  }
}
console.log(`\n${unresolved.length} unresolved mention(s).`);
