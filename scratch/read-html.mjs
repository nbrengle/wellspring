import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DOC = join(ROOT, 'WellspringMegaDoc.html');

const raw = readFileSync(DOC, 'utf8');

const target = 'Mild Allergy';
let pos = raw.indexOf(target);
while (pos !== -1) {
  // Find preceding h4 tag
  const h4Idx = raw.lastIndexOf('<h4', pos);
  if (h4Idx !== -1 && pos - h4Idx < 200) {
    console.log('Found heading at index:', h4Idx);
    const snippet = raw.slice(h4Idx, h4Idx + 3000);
    console.log(snippet.replace(/</g, '\n<'));
    break;
  }
  pos = raw.indexOf(target, pos + 1);
}
