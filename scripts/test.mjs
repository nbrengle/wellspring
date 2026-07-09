// Zero-dependency test suite for the character builder's data + validation logic.
// Run with: npm test  (which registers the JSON loader hook first).
//
// The suite is split into per-domain files under scripts/test/*.test.mjs so a new
// feature adds its tests + imports to ONE domain file instead of a single giant
// shared file (the old merge hotspot). Each domain file registers its tests with
// the shared harness on import; this entry imports them all, then reports once.
//
// Covers the invariants the builder relies on so regressions surface immediately:
//   - all 14 starter archetypes validate to exactly 9 BP and are legal
//   - export → import round-trips losslessly (BP + validity identical)
//   - devotion → domain → domain-power chain resolves
//   - level / slot math, xN rank multipliers, spell-tier routing, per-class slots
//   - grants / discounts / starting choices / referential integrity

import { report } from './test/harness.mjs';

import './test/bp-and-levels.test.mjs';
import './test/grants-and-classes.test.mjs';
import './test/lineages-devotions.test.mjs';
import './test/costs-and-powers.test.mjs';
import './test/skills-and-stats.test.mjs';
import './test/param-domain.test.mjs';
import './test/pool-registry.test.mjs';
import './test/starting-choices.test.mjs';
import './test/validation-coverage.test.mjs';
import './test/reducers.test.mjs';
import './test/character-add.test.mjs';

report();
