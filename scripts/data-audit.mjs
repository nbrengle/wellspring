// data-audit.mjs — flags entities whose parsed data looks dropped, truncated, or
// mis-bounded vs the source, so source↔data gaps (like the dropped Adept Ritualist
// benefits) surface systematically instead of by hand. Read-only; prints a
// prioritized report. Run: node --import ./scripts/register-json.mjs scripts/data-audit.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');
const read = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const MEGADOC = readFileSync(join(DATA, '..', '..', 'Wellspring MegaDoc.txt'), 'utf8');

// Which files hold described entities, and how to get [name, description, extra].
// Powers live nested inside classes; everything else is a flat array.
function* entities() {
  for (const c of read('classes.json')) {
    for (const [tier, arr] of Object.entries(c)) {
      if (!Array.isArray(arr)) continue;
      for (const p of arr) if (p && p.name) yield { file: 'classes', type: `${c.name}/${tier}`, name: p.name, desc: p.description || '', obj: p };
    }
  }
  const flat = {
    'skills.json': 'description', 'perks.json': 'description', 'flaws.json': 'description',
    'domains.json': null, 'devotions.json': 'lore', 'accents.json': 'description',
    'conditions.json': 'description', 'effects.json': 'description', 'modifiers.json': 'description',
    'defense-calls.json': 'description', 'resources.json': 'description', 'types.json': 'description',
    'crafting-concepts.json': 'description', 'ritual-concepts.json': 'description',
    'crafting-recipes.json': 'description', 'ritual-recipes.json': 'effect', 'glossary.json': 'definition',
  };
  for (const [file, descKey] of Object.entries(flat)) {
    for (const e of read(file)) {
      const name = e.name || e.term;
      if (!name) continue;
      yield { file: file.replace('.json', ''), type: file.replace('.json', ''), name, desc: descKey ? (e[descKey] || '') : '', obj: e };
    }
  }
}

// Flags, ordered by severity. Each returns a reason string or null.
const CHECKS = [
  // EMPTY — has no description at all (multiclassGrants are skill refs, exempt).
  (e) => (!e.desc.trim() && !/multiclassGrants/.test(e.type) && e.file !== 'domains') ? 'EMPTY description' : null,
  // DANGLING COLON — ends on a colon (a list/table the parser likely dropped).
  // Suppress benign trailing labels that legitimately precede a non-text element
  // (an image / sigil in the source), e.g. devotions' "Example Sigil:".
  (e) => (/[:：]\s*$/.test(e.desc.trim()) && !/\b(Example Sigil|Example|Sigil|e\.g\.)\s*[:：]\s*$/i.test(e.desc.trim()))
    ? 'ends with ":" (dropped list?)' : null,
  // PROMISES MORE — "following"/"below"/"at various levels" but text looks cut off.
  (e) => /\b(the following|listed below|as follows|at various .* levels)\s*[:.]?\s*$/i.test(e.desc.trim()) ? 'promises a list that isn\'t there' : null,
  // STAT-TABLE GARBAGE — body is mostly bare numbers (grabbed a progression table).
  (e) => {
    const toks = e.desc.trim().split(/\s+/);
    if (toks.length >= 6 && toks.filter((t) => /^[\d-]+$/.test(t)).length / toks.length > 0.4) return 'looks like a stat-table fragment';
    return null;
  },
  // DANGLING REFERENCE — names a sub-power "X Power below" that isn't its own entity.
  (e) => {
    const m = e.desc.match(/\b([A-Z][\w’' ]+?)\s+Power\s+below\b/);
    return m ? `refs "${m[1].trim()} Power below" (likely an unextracted sub-power)` : null;
  },
  // VERY SHORT — suspiciously terse for a described entity (skills/perks excepted: many are 1-liners).
  (e) => (e.desc.trim().length > 0 && e.desc.trim().length < 15 && /classes/.test(e.file)) ? `very short (${e.desc.trim().length} chars)` : null,
];

// Does the megadoc clearly have MORE for this entity than we captured? Compares the
// captured length to the span from the name to the next ~stat-block/heading marker.
function megadocHasMore(e) {
  const i = MEGADOC.indexOf(e.name);
  if (i < 0) return false;
  // crude: source text immediately after the name, up to 600 chars, stripped.
  const after = MEGADOC.slice(i + e.name.length, i + e.name.length + 600).replace(/\s+/g, ' ');
  return after.length > e.desc.length + 200;   // notably more in source than captured
}

const findings = [];
for (const e of entities()) {
  for (const check of CHECKS) {
    const reason = check(e);
    if (reason) { findings.push({ ...e, reason, more: megadocHasMore(e) }); break; }
  }
}

// Report, grouped by reason, worst first.
const order = ['EMPTY description', 'looks like a stat-table fragment', 'refs', 'ends with', 'promises', 'very short'];
const sev = (r) => { const i = order.findIndex((o) => r.startsWith(o)); return i < 0 ? 99 : i; };
findings.sort((a, b) => sev(a.reason) - sev(b.reason));

console.log(`═══ Data audit — ${findings.length} suspect entities ═══\n`);
let lastReasonGroup = '';
for (const f of findings) {
  const group = order.find((o) => f.reason.startsWith(o)) || 'other';
  if (group !== lastReasonGroup) { console.log(`\n── ${group} ──`); lastReasonGroup = group; }
  console.log(`  [${f.type}] ${f.name}: ${f.reason}${f.more ? '  (⚠ megadoc has more)' : ''}`);
}
console.log(`\nTotal: ${findings.length} flagged. (multiclassGrants skill-refs + domain power-lists exempt.)`);
