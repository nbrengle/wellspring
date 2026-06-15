import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DOC = join(ROOT, 'WellspringMegaDoc.html');

const raw = readFileSync(DOC, 'utf8');

function decode(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&hellip;/g, '…')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&[a-z]+;/gi, '');
}

function stripTags(s) {
  return decode(s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
}

function parseHTML() {
  const nodes = [];
  const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
  let pos = 0;
  let inTag = null;
  let inList = false;
  let listItems = [];

  const flushList = () => {
    if (listItems.length) { nodes.push({ type: 'list', items: [...listItems] }); listItems = []; }
    inList = false;
  };

  let buf = '';
  const BLOCK_TAGS = new Set(['p','li','td','th','h1','h2','h3','h4','h5','h6']);

  let match;
  TAG.lastIndex = 0;
  while ((match = TAG.exec(raw)) !== null) {
    const between = raw.slice(pos, match.index);
    if (inTag) buf += between;
    pos = match.index + match[0].length;

    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();

    if (!closing && BLOCK_TAGS.has(tag)) {
      buf = '';
      inTag = tag;
    } else if (closing && inTag === tag) {
      const text = stripTags(buf).trim();
      buf = '';
      inTag = null;
      if (!text) continue;

      if (tag === 'li') {
        listItems.push(text);
      } else {
        if (listItems.length && tag !== 'li') flushList();
        if (/^h[1-6]$/.test(tag)) {
          nodes.push({ type: 'heading', level: +tag[1], text });
        } else if (tag === 'td' || tag === 'th') {
          nodes.push({ type: 'cell', text });
        } else {
          nodes.push({ type: 'text', text });
        }
      }
    } else if (!closing && tag === 'ul' || !closing && tag === 'ol') {
      inList = true;
    } else if (closing && (tag === 'ul' || tag === 'ol')) {
      flushList();
    }
  }
  flushList();
  return nodes;
}

const nodes = parseHTML();
const classesStart = nodes.findIndex(n => n.type === 'heading' && n.text === 'Base Classes (All)');
const classesEnd = nodes.findIndex(n => n.type === 'heading' && n.text === 'Lineages (All)');

let i = classesStart + 1;
while (i < classesEnd) {
  const n = nodes[i];
  if (n.type === 'heading' && n.level === 1 && /^(.+):\s*Base Class$/.test(n.text)) {
    const clsName = n.text.replace(/:\s*Base Class$/, '').trim();
    const clsStart = i;
    const clsEnd = nodes.findIndex((m, j) => j > clsStart && m.type === 'heading' && m.level === 1);
    const end = clsEnd === -1 ? classesEnd : Math.min(clsEnd, classesEnd);

    // List all H2 headings under this class
    const h2s = [];
    for (let j = clsStart + 1; j < end; j++) {
      if (nodes[j].type === 'heading' && nodes[j].level === 2) {
        h2s.push(nodes[j].text);
      }
    }
    console.log(clsName, h2s);
    i = end;
  } else {
    i++;
  }
}
