#!/usr/bin/env node
// check-data-drift.mjs — guard against committed data drifting from its generator.
//
// src/data/*.json is GENERATED: parse-megadoc.js (MegaDoc → entity JSON) and
// link-refs.js (entity JSON → refs.json). If someone hand-edits a generated file
// (or updates a generator without re-running it), the committed data silently
// diverges from what the pipeline produces — exactly how the Extended Capacity
// "Sphere" patch (PR #116) drifted from the parser.
//
// This guard re-runs both generators and fails if the working tree's generated
// files changed — i.e. the commit doesn't match its generators' current output.
// It leaves the tree as it found it (restores on exit) so it's safe to run
// anywhere, including CI (`npm run check:data`).
//
// To fix a failure: re-run the generators (`npm run parse && npm run link`) and
// commit the result — or, if the change is unwanted, revert your data edit.

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'pipe' });
const git = (...args) => run('git', args).toString().trim();

// Files written by the generators (everything under src/data the pipeline owns).
const GENERATED = 'src/data';

// Refuse to run with pre-existing uncommitted changes to the generated files: we
// can't tell our regen diff from the user's own edits, and we'd clobber them.
const dirtyBefore = git('status', '--porcelain', '--', GENERATED);
if (dirtyBefore) {
  console.error('✗ check:data needs a clean working tree under src/data/ to run.');
  console.error('  Commit or stash your data changes first. Currently dirty:');
  console.error(dirtyBefore.split('\n').map((l) => `    ${l}`).join('\n'));
  process.exit(2);
}

let failed = false;
try {
  // Regenerate in place, then diff against HEAD's committed data.
  run('npx', ['tsx', 'scripts/parse-megadoc.js']);
  run('npx', ['tsx', 'scripts/parse-archetypes.js']);
  run('npx', ['tsx', 'scripts/link-refs.js']);

  const drift = git('status', '--porcelain', '--', GENERATED);
  if (drift) {
    failed = true;
    const files = git('diff', '--name-only', '--', GENERATED);
    console.error('✗ DATA DRIFT: committed src/data/ does not match the generators.');
    console.error('  These generated files differ from `npm run parse && npm run link`:');
    console.error(files.split('\n').map((f) => `    ${f}`).join('\n'));
    console.error('\n  Fix: re-run the generators and commit the result —');
    console.error('       npm run parse && npm run link');
    console.error('  (or revert the offending hand-edit to a generated file).');
  } else {
    console.log('✓ src/data/ matches the generators (parse-megadoc + link-refs).');
  }
} finally {
  // Always restore the working tree to exactly what it was (our regen is a probe).
  run('git', ['checkout', '--', GENERATED]);
}

process.exit(failed ? 1 : 0);
