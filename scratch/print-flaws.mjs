import fs from 'fs';

const flaws = JSON.parse(fs.readFileSync('/Users/nmooney/Workspaces/wellspring/src/data/flaws.json', 'utf8'));
flaws.forEach(f => {
  console.log(`- ${f.name} (Award: ${f.cost || f.bp})`);
});
