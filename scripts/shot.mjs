// Headless screenshot helper for visual checks, run via `npm run shot`.
// Usage:
//   npm run shot -- <hashB64> [outfile] [width] [height]
// or to screenshot the home/picker screen with no character:
//   npm run shot -- "" /tmp/home.png
//
// The character is passed as the base64 URL-hash the app already uses, so any
// state (built char, multiclass, devotion, etc.) can be rendered. Requires the
// dev server running at localhost:5173 (npm run dev).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

// Args: <hash|@file> [outfile] [width] [height]. A leading "@" reads the hash
// from a file (so callers never need to shell out with cat to pass it).
let [hash = '', out = '/tmp/shot.png', w = '1400', h = '1000'] = process.argv.slice(2);
if (hash.startsWith('@')) hash = readFileSync(hash.slice(1), 'utf8').trim();
const url = `http://localhost:5173/wellspring/${hash ? '#' + hash : ''}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
await page.goto(url, { waitUntil: 'networkidle' });
await page.screenshot({ path: out, fullPage: false });
await browser.close();
console.log(`shot → ${out}  (${url.slice(0, 60)}${url.length > 60 ? '…' : ''})`);
