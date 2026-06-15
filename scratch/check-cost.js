import { readFileSync } from 'fs';

const html = readFileSync('WellspringMegaDoc.html', 'utf8');
const lines = html.split('\n');
const lineIndex = lines.findIndex(l => l.includes('The Fighter gains the Heavy Armor Skill.'));
console.log('Line index (0-indexed):', lineIndex);
console.log('Line content:', lines[lineIndex]);
process.exit(0);
