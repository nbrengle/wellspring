import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const perks = JSON.parse(readFileSync(join(ROOT, 'src/data/perks.json'), 'utf8'));
const flaws = JSON.parse(readFileSync(join(ROOT, 'src/data/flaws.json'), 'utf8'));

const keywords = [
  'choose', 'choice', 'select', 'determine', 'specify', 'attune to',
  'type of', 'one of', 'which must be approved', 'named'
];

function check(list, name) {
  console.log(`=== Scanning ${name} ===`);
  for (const item of list) {
    const desc = (item.description || '').toLowerCase();
    const matches = keywords.filter(k => desc.includes(k));
    if (matches.length > 0) {
      console.log(`- ${item.name} (${item.category}):`);
      console.log(`  Matched keywords: ${matches.join(', ')}`);
      console.log(`  Desc: ${item.description.slice(0, 180)}...`);
    }
  }
}

check(perks, 'Perks');
check(flaws, 'Flaws');
