// pool-registry.test.mjs — pool derivation works against the CURRENT (un-fixed)
// source spellings: resolves each pool, derives its size formula, and classifies
// interacting powers. Tolerant matching (case-insensitive + variant aliases) means
// pools resolve whether or not the pending MegaDoc spelling fixes land.
import { test, eq, ok } from './harness.mjs';
import { lookupEntity } from '../../src/engine/data.js';
import { POOLS, poolSize, poolMax, poolsReferenced, poolRelation, unresolvedPoolMentions, characterPools } from '../../src/engine/pool-registry.js';
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
  eq(poolRelation(ght, 'healing-touch'), 'augments-max', 'Greater Healing Touch → permanent max boost (resolved via "healing pool" alias)');
});

test('pool-registry: relation distinguishes PERMANENT max-boost from TEMPORARY refill', () => {
  eq(poolRelation(lookupEntity('classes:Healing Touch'), 'healing-touch'), 'defines', 'Healing Touch defines its pool');
  // Greater Healing Touch permanently raises the max ("+1 per cleric level").
  eq(poolRelation(lookupEntity('classes:Greater Healing Touch'), 'healing-touch'), 'augments-max',
     'Greater Healing Touch → permanent max boost');
  // Cure/Heal add points when CAST → temporary refill, not a max change.
  eq(poolRelation(lookupEntity('classes:Cure'), 'healing-touch'), 'refills', 'Cure → temporary refill');
  eq(poolRelation(lookupEntity('skills:Peacecaster'), 'life-tap'), 'refills', 'Peacecaster → temporary refill');
});

test('pool-registry: poolMax folds in owned PERMANENT augments, not refills', () => {
  const ht = lookupEntity('classes:Healing Touch');
  const ght = lookupEntity('classes:Greater Healing Touch');
  const cure = lookupEntity('classes:Cure');
  eq(poolMax('healing-touch', 3, [ht]).total, 9, 'base only: 3×3');
  const withGht = poolMax('healing-touch', 3, [ht, ght]);
  eq(withGht.total, 12, 'base 9 + Greater Healing Touch (+3 at L3)');
  eq(withGht.sources.length, 1, 'one permanent source');
  // a refill power owned must NOT change the max.
  eq(poolMax('healing-touch', 3, [ht, cure]).total, 9, 'Cure (refill) does not raise max');
});

test('pool-registry: characterPools resolves a character to read-layer pool records', () => {
  // Cleric L3 owning the definer + a permanent augment + two refills.
  const owned = [
    { name: 'Healing Touch', source: 'class', cls: 'Cleric' },
    { name: 'Greater Healing Touch', source: 'purchased', cls: 'Cleric' },
    { name: 'Cure', source: 'purchased', cls: 'Cleric' },
    { name: 'Heal', source: 'purchased', cls: 'Cleric' },
  ];
  const pools = characterPools(owned, (c) => (c === 'Cleric' ? 3 : 0));
  const ht = pools.find((p) => p.id === 'healing-touch');
  ok(ht, 'character has the Healing Touch Pool');
  eq(ht.max.total, 12, 'max = base 9 + Greater Healing Touch (+3)');
  eq(ht.max.sources.length, 1, 'one permanent source in the max breakdown');
  eq(ht.refills.map((r) => r.name).sort().join(','), 'Cure,Heal', 'Cure + Heal are refills');
  ok(!ht.refills.some((r) => r.relation !== 'refills'), 'refills are not in the max');
});

test('pool-registry: a character only HAS a pool if it owns the defining power', () => {
  // owns a refill power (Cure) but NOT the definer → no pool.
  const pools = characterPools([{ name: 'Cure', source: 'purchased', cls: 'Cleric' }], () => 3);
  eq(pools.length, 0, 'no definer owned → no pool surfaces');
});

test('pool-registry: build guard surfaces pools with no derivable size', () => {
  const offenders = unresolvedPoolMentions(allEntities());
  // Life Tap has no inline size formula in current data — the guard SHOULD flag it,
  // documenting the gap rather than silently sizing it wrong.
  ok(offenders.some((o) => o.pool === 'life-tap' && o.reason === 'no-formula'),
     'guard flags Life Tap (no inline formula): ' + JSON.stringify(offenders));
});
