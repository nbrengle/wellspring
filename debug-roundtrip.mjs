import { validate } from './src/data/validate.js';
import { buildXlsxCharacter, parseXlsxCharacter } from './src/data/xlsx-import.js';
import ARCHETYPES from './src/data/archetypes.json' with { type: 'json' };

const fromArchetype = (a) => ({ ...a, archetypeName: a.name });

for (const a of ARCHETYPES) {
  const c = fromArchetype(a);
  const orig = validate(c);
  const xlsxBytes = buildXlsxCharacter(c, orig);
  const parsed = parseXlsxCharacter(xlsxBytes);
  const rt = validate(parsed);

  if (rt.spend.net !== orig.spend.net) {
    console.log(`\n=================== ARCHETYPE: ${a.name} ===================`);
    console.log(`Original Net BP: ${orig.spend.net}, Parsed Net BP: ${rt.spend.net}`);
    
    console.log('--- Original spend by item ---');
    for (const [k, v] of Object.entries(orig.spend.byItem)) {
      console.log(`  ${k}: cost=${v.cost} (base=${v.base}, grant=${v.grant ? JSON.stringify(v.grant) : 'null'})`);
    }

    console.log('--- Parsed spend by item ---');
    for (const [k, v] of Object.entries(rt.spend.byItem)) {
      console.log(`  ${k}: cost=${v.cost} (base=${v.base}, grant=${v.grant ? JSON.stringify(v.grant) : 'null'})`);
    }

    if (orig.spend.discountsApplied.length || rt.spend.discountsApplied.length) {
      console.log('Original discounts:', orig.spend.discountsApplied);
      console.log('Parsed discounts:', rt.spend.discountsApplied);
    }
  }
}


