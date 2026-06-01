// xlsx-import.js — parse a Wellspring "Basic Sheet" .xlsx into a character object
// the builder can validate/load. The sheet is a fixed-layout form (labels in
// column A/F, values in the cell to their right; list sections run down a column),
// so we read it label-anchored rather than by hardcoded addresses — robust to the
// occasional inserted row. Returns the same flat character shape parseCharacterSheet
// produces, so it flows through the existing import → validate → load path.
import * as XLSX from 'xlsx';

// Read a workbook (ArrayBuffer) → character. Throws on a non-Wellspring sheet.
export function parseXlsxCharacter(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = wb.SheetNames.find((n) => /basic sheet/i.test(n)) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws || !ws['!ref']) throw new Error('Empty or unreadable spreadsheet.');
  const grid = toGrid(ws);

  // Placeholder values the template uses for un-filled dropdowns — treat as empty.
  const PLACEHOLDER = /^-?\s*select .*-?$|^\(.*\)$|^$/i;
  const clean = (v) => {
    const s = String(v ?? '').trim();
    return PLACEHOLDER.test(s) ? '' : s;
  };

  // Value in the cell immediately right of the first cell whose text matches `label`
  // AND that actually has a value (skips a same-named section header with an empty
  // neighbour, e.g. the "Devotion" section title above the "Devotion " value row).
  const after = (label) => {
    const re = label instanceof RegExp ? label : new RegExp(`^${label}`, 'i');
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        if (!re.test(String(grid[r][c] ?? '').trim())) continue;
        const v = clean(grid[r]?.[c + 1]);
        if (v) return v;
      }
    }
    return '';
  };

  // Value in the cell BELOW the first cell matching `label` (column-oriented pairs
  // like the Domain N headers, whose chosen value sits underneath).
  const below = (label) => {
    const pos = findLabel(grid, label);
    return pos ? clean(grid[pos.r + 1]?.[pos.c]) : '';
  };

  const character = { name: '', archetypeName: 'Imported Character', effectiveBP: {}, grants: {} };

  character.name = after(/character name/i) || 'Imported Character';
  const lp = after(/life points/i); if (lp) character.lifePoints = lp;
  const sp = after(/^spikes/i); if (sp) character.spikes = sp;
  const ap = after(/armor points/i); if (ap) character.armorPoints = ap;
  const wealth = after(/^wealth:?$/i); if (wealth) character.wealth = wealth;
  const resources = after(/^resources:?$/i); if (resources) character.resources = resources;

  // Classes: rows under the "Class" / "Level" header — "<Class>  <Level>" pairs.
  const classes = readClasses(grid, clean);
  if (classes.length) character.classLevels = classes.map((c) => `${c.name} ${c.level}`).join(' / ');

  // Lineage + sublineage.
  const lineage = after(/^lineage:/i);
  if (lineage) {
    character.lineage = lineage;
    const sub = after(/sub-?lineage/i);
    if (sub) character.sublineage = sub;
  }

  // Devotion.
  const devotion = after(/^devotion\b/i);
  if (devotion) character.devotion = devotion;
  const domains = ['domain 1', 'domain 2', 'domain 3', 'domain 4']
    .map((d) => below(new RegExp(`^${d}$`, 'i'))).filter(Boolean);
  if (domains.length) character.divineDomains = domains;

  // List sections: a header cell, then items running down the same column until blank.
  const lists = {
    startingSkills: [/starting\/?free skills/i, /starting skills/i],
    purchasedSkills: [/purchased skills/i],
    purchasedPerks: [/^perks:/i, /^perks$/i],
    flaws: [/^flaws$/i, /^flaws:/i],
    utilityPowers: [/utility powers\/cantrips/i],
    basicPowers: [/basic powers\/known spells/i],
    innatePowers: [/innate powers/i],
    domainPowers: [/purchased domain powers/i],
  };
  for (const [field, labels] of Object.entries(lists)) {
    const items = readColumnList(grid, labels, clean);
    if (items.length) character[field] = items;
  }

  // Challenges / Advantages: two-column tables (Name + Award/Cost).
  const challenges = readNamedTable(grid, /^challenges$/i, clean);
  if (challenges.length) character.lineageChallenges = challenges;
  const advantages = readNamedTable(grid, /^advantages$/i, clean);
  if (advantages.length) character.lineageAdvantages = advantages;

  if (!Object.keys(character.effectiveBP).length) delete character.effectiveBP;
  if (!Object.keys(character.grants).length) delete character.grants;
  return character;
}

// ─── grid + label helpers ─────────────────────────────────────────────────────

// Worksheet → 2-D array of raw cell values (grid[row][col]), 0-indexed.
function toGrid(ws) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  const grid = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      row.push(cell ? cell.v : undefined);
    }
    grid.push(row);
  }
  return grid;
}

// Find the first cell matching `label` (RegExp); returns { r, c } or null.
function findLabel(grid, label) {
  const re = label instanceof RegExp ? label : new RegExp(`^${label}`, 'i');
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (re.test(String(grid[r][c] ?? '').trim())) return { r, c };
    }
  }
  return null;
}

// Read "<Class>  <Level>" rows beneath the "Class" header (paired with "Level").
function readClasses(grid, clean) {
  const head = findLabel(grid, /^class$/i);
  if (!head) return [];
  const out = [];
  for (let r = head.r + 1; r < grid.length; r++) {
    const name = clean(grid[r]?.[head.c]);
    const level = String(grid[r]?.[head.c + 1] ?? '').trim();
    if (!name) { if (out.length) break; else continue; }
    out.push({ name, level: parseInt(level, 10) || 0 });
  }
  return out;
}

// Items running down a column from the first matching header label until a blank.
// A "Name" sub-header row (some sections have one) is skipped, not taken as an item.
function readColumnList(grid, labels, clean) {
  let head = null;
  for (const l of labels) { head = findLabel(grid, l); if (head) break; }
  if (!head) return [];
  const out = [];
  let started = false;
  for (let r = head.r + 1; r < grid.length; r++) {
    const raw = String(grid[r]?.[head.c] ?? '').trim();
    if (/^(name|award|cost|notes|refund\??)$/i.test(raw)) continue;   // column sub-header
    // Stop at the next SECTION label — a short cell ending in ":" (e.g. "Perks:",
    // "Purchased Skills:") — so an empty section doesn't bleed into the next one.
    if (/:$/.test(raw) || /^(perks|flaws|challenges|advantages|devotion|lineage|class)$/i.test(raw)) break;
    const v = clean(grid[r]?.[head.c]);
    if (!v) { if (started) break; else continue; }
    started = true;
    out.push(v);
  }
  return out;
}

// A Name(+Award/Cost) table under a section header: read the Name column.
function readNamedTable(grid, headerRe, clean) {
  const head = findLabel(grid, headerRe);
  if (!head) return [];
  // The "Name" sub-header is usually the next row; items follow under it.
  const nameHead = findLabelFrom(grid, /^name$/i, head.r, head.c);
  const col = nameHead ? nameHead.c : head.c;
  const startRow = nameHead ? nameHead.r + 1 : head.r + 1;
  const out = [];
  for (let r = startRow; r < grid.length; r++) {
    const v = clean(grid[r]?.[col]);
    if (!v) break;
    out.push(v);
  }
  return out;
}

// Like findLabel but bounded to near a row (the section's own "Name" sub-header).
function findLabelFrom(grid, re, fromRow, nearCol) {
  for (let r = fromRow; r < Math.min(fromRow + 3, grid.length); r++) {
    for (let c = Math.max(0, nearCol - 1); c < grid[r].length; c++) {
      if (re.test(String(grid[r][c] ?? '').trim())) return { r, c };
    }
  }
  return null;
}
