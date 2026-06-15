import fs from 'fs';

const skills = JSON.parse(fs.readFileSync('/Users/nmooney/Workspaces/wellspring/src/data/skills.json', 'utf8'));
const perks = JSON.parse(fs.readFileSync('/Users/nmooney/Workspaces/wellspring/src/data/perks.json', 'utf8'));

console.log("=== SKILLS ===");
skills.forEach(s => {
  console.log(`- ${s.name} (Cost: ${s.cost}, Category: ${s.category})`);
});

console.log("\n=== PERKS ===");
perks.forEach(p => {
  console.log(`- ${p.name} (Cost: ${p.cost}, Category: ${p.category})`);
});
