// pool-registry.test.mjs — pool derivation works against the CURRENT (un-fixed)
// source spellings: resolves each pool, derives its size formula, and classifies
// interacting powers. Tolerant matching (case-insensitive + variant aliases) means
// pools resolve whether or not the pending MegaDoc spelling fixes land.
import { test, eq, ok } from './harness.mjs';
import { lookupEntity } from '../../src/engine/data.js';
import { POOLS, poolSize, poolsReferenced, poolRelation, unresolvedPoolMentions } from '../../src/engine/pool-registry.js';
import skillsJson from '../../src/data/skills.json' with { type: 'json' };
import classesJson from '../../src/data/classes.json' with { type: 'json' };
import domainsJson from '../../src/data/domains.json' with { type: 'json' };

const allEntities = () => {
  const flat = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') { if (v.name) flat.push(v); Object.values(v).forEach(walk); }
  };
  walk(skillsJson); walk(classesJson); walk(domainsJson);
  return flat;
};

test('pool-registry: known pools are catalogued with a definer', () => {
  for (const id of ['healing-touch', 'life-tap', 'living-iron', 'balance', 'maintenance']) {
    const p = POOLS.find((x) => x.id === id);
    ok(p, `pool catalogued: ${id}`);
    ok(lookupEntity(`classes:${p.definedBy}`) || lookupEntity(`domains:${p.definedBy}`), `definer exists: ${p.definedBy}`);
  }
});

test('pool-registry: size formulas derive from prose (incl. word-numbers)', () => {
  eq(poolSize('healing-touch', 3), 9, 'Healing Touch = "three times" class-level → 3×3');
  eq(poolSize('living-iron', 4), 12, 'Living Iron = "3 x" class-level → 3×4');
  eq(poolSize('maintenance', 2), 12, 'Maintenance = "10 plus" class-level → 10+2');
  eq(poolSize('balance', 5), 5, 'Balance = flat "maximum points of 5"');
});

test('pool-registry: tolerant matching resolves variant spellings (pre-source-fix)', () => {
  // Greater Healing Touch says "healing pool", not "Healing Touch Pool" — must still
  // resolve to the Healing Touch Pool via the alias.
  const ght = lookupEntity('classes:Greater Healing Touch');
  ok(poolsReferenced(ght).includes('healing-touch'), 'Greater Healing Touch → healing-touch via "healing pool"');
  eq(poolRelation(ght, 'healing-touch'), 'augments', 'Greater Healing Touch augments the pool');
});

test('pool-registry: relation classification', () => {
  eq(poolRelation(lookupEntity('classes:Healing Touch'), 'healing-touch'), 'defines', 'Healing Touch defines its pool');
  // Cure/Heal add points to the pool → augments (they refill it as a side effect).
  eq(poolRelation(lookupEntity('classes:Cure'), 'healing-touch'), 'augments', 'Cure adds points → augments');
});

test('pool-registry: build guard surfaces pools with no derivable size', () => {
  const offenders = unresolvedPoolMentions(allEntities());
  // Life Tap has no inline size formula in current data — the guard SHOULD flag it,
  // documenting the gap rather than silently sizing it wrong.
  ok(offenders.some((o) => o.pool === 'life-tap' && o.reason === 'no-formula'),
     'guard flags Life Tap (no inline formula): ' + JSON.stringify(offenders));
});
