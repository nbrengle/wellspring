// xlsx-import.js — parse a Wellspring "Basic Sheet" .xlsx into a character object
// the builder can validate/load. The sheet is a fixed-layout form (labels in
// column A/F, values in the cell to their right; list sections run down a column),
// so we read it label-anchored rather than by hardcoded addresses — robust to the
// occasional inserted row. Returns the same flat character shape parseCharacterSheet
// produces, so it flows through the existing import → validate → load path.
import * as XLSX from 'xlsx';
import { cleanItem } from './sheet-schema.js';

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
    const rawItems = readColumnList(grid, labels, clean);
    if (rawItems.length) {
      const items = [];
      const costs = [];
      const grants = [];
      for (const raw of rawItems) {
        const cleaned = cleanItem(raw);
        items.push(cleaned.name);
        costs.push(cleaned.bp);
        grants.push(cleaned.grant);
      }
      character[field] = items;
      if (costs.some(c => c !== null)) {
        character.effectiveBP = character.effectiveBP || {};
        character.effectiveBP[field] = costs;
      }
      if (grants.some(g => g !== null)) {
        character.grants = character.grants || {};
        character.grants[field] = grants;
      }
    }
  }

  // Challenges / Advantages: two-column tables (Name + Award/Cost).
  const challenges = readNamedTable(grid, /^challenges$/i, clean);
  if (challenges.length) {
    character.lineageChallenges = challenges.map(c => cleanItem(c).name);
  }
  const advantages = readNamedTable(grid, /^advantages$/i, clean);
  if (advantages.length) {
    character.lineageAdvantages = advantages.map(a => cleanItem(a).name);
  }

  if (character.effectiveBP && !Object.keys(character.effectiveBP).length) delete character.effectiveBP;
  if (character.grants && !Object.keys(character.grants).length) delete character.grants;
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

// ─── XLSX EXPORTER ────────────────────────────────────────────────────────────

function bpSuffix(name, field, report, idx) {
  let e = null;
  if (field === 'startingSkills') {
    if (idx !== undefined) {
      e = report?.spend.byItem[`startingSkills:${idx}:${name}`];
    }
    if (!e) {
      const match = Object.keys(report?.spend.byItem || {}).find(k => k.startsWith('startingSkills:') && k.endsWith(`:${name}`));
      if (match) e = report.spend.byItem[match];
    }
  } else {
    e = report?.spend.byItem[`${field}:${name}`];
  }
  if (!e) return '';
  if (e.cost < 0) {
    return e.grant?.source ? ` (${-e.cost} BP refunded from ${e.grant.source})` : ` (+${-e.cost} BP)`;
  }
  if (e.cost === 0 && e.grant?.source) return ` - 0 BP (from ${e.grant.source})`;
  if (e.cost > 0) return ` - ${e.cost} BP`;
  if (e.base > 0) return ` - 0 BP`;
  return '';
}

export function buildXlsxCharacter(character, report) {
  const data = [];
  data.push(["Character Name", character.name || ""]);
  data.push(["Life Points", character.lifePoints || report?.stats?.lifePoints || ""]);
  data.push(["Spikes", character.spikes || report?.stats?.spikes || ""]);
  data.push(["Armor Points", character.armorPoints || report?.stats?.armorPoints || ""]);
  data.push(["Wealth", character.wealth || ""]);
  data.push(["Resources", character.resources || ""]);
  data.push([]);

  // Class Levels
  data.push(["Class", "Level"]);
  const classLevels = character.classLevels || "";
  const parts = classLevels.split("/").map(p => p.trim()).filter(Boolean);
  for (const part of parts) {
    const match = part.match(/^(.*?)\s+(\d+)$/);
    if (match) {
      data.push([match[1], parseInt(match[2], 10)]);
    }
  }
  data.push([]);

  // Lineage
  data.push(["Lineage:", character.lineage || ""]);
  data.push(["Sub-Lineage (if any)", character.sublineage || ""]);
  data.push([]);

  // Devotion & Domains
  data.push(["Devotion", character.devotion || ""]);
  data.push(["Domain 1", "Domain 2", "Domain 3", "Domain 4"]);
  const domains = character.divineDomains || [];
  data.push([domains[0] || "", domains[1] || "", domains[2] || "", domains[3] || ""]);
  data.push([]);

  // Challenges
  data.push(["Challenges"]);
  data.push(["Name", "Award", "Notes"]);
  for (const ch of (character.lineageChallenges || [])) {
    data.push([ch, "", ""]);
  }
  data.push([]);

  // Advantages
  data.push(["Advantages"]);
  data.push(["Name", "Cost", "Notes"]);
  for (const adv of (character.lineageAdvantages || [])) {
    data.push([adv, "", ""]);
  }
  data.push([]);

  // Partition startingSkills and purchasedPerks
  const owned = report?.owned || { skills: [], perks: [], classPowers: [] };
  
  // Starting/free skills & perks to export under "Starting/Free Skills:"
  const startingSkillsSet = new Set(character.startingSkills || []);
  for (const pk of owned.perks) {
    if (pk.source === 'class') {
      startingSkillsSet.add(pk.name);
    }
  }
  const startingSkillsToExport = Array.from(startingSkillsSet);

  // Purchased perks: only those with source !== 'class'
  const purchasedPerksSet = new Set();
  for (const pk of owned.perks) {
    if (pk.source !== 'class') {
      purchasedPerksSet.add(pk.name);
    }
  }
  const purchasedPerksToExport = Array.from(purchasedPerksSet);

  // Purchased skills: combine purchasedSkills and classPowers
  const purchasedSkillsToExport = Array.from(new Set([
    ...(character.purchasedSkills || []),
    ...(character.classPowers || [])
  ]));

  // Lists
  data.push(["Starting/Free Skills:"]);
  data.push(["Name"]);
  for (const item of startingSkillsToExport) {
    const suffix = bpSuffix(item, 'startingSkills', report);
    data.push([`${item}${suffix}`]);
  }
  data.push([]);

  data.push(["Purchased Skills:"]);
  data.push(["Name"]);
  for (const item of purchasedSkillsToExport) {
    let suffix = bpSuffix(item, 'purchasedSkills', report);
    if (!suffix) suffix = bpSuffix(item, 'classPowers', report);
    data.push([`${item}${suffix}`]);
  }
  data.push([]);

  data.push(["Perks:"]);
  data.push(["Name"]);
  for (const item of purchasedPerksToExport) {
    const suffix = bpSuffix(item, 'purchasedPerks', report);
    data.push([`${item}${suffix}`]);
  }
  data.push([]);

  data.push(["Flaws:"]);
  data.push(["Name"]);
  for (const item of (character.flaws || [])) {
    const suffix = bpSuffix(item, 'flaws', report);
    data.push([`${item}${suffix}`]);
  }
  data.push([]);

  data.push(["Utility Powers/Cantrips:"]);
  data.push(["Name"]);
  const utilityPowersToExport = Array.from(new Set([
    ...(character.utilityPowers || []),
    ...(character.cantrips || [])
  ]));
  for (const item of utilityPowersToExport) {
    let suffix = bpSuffix(item, 'utilityPowers', report);
    if (!suffix) suffix = bpSuffix(item, 'cantrips', report);
    data.push([`${item}${suffix}`]);
  }
  data.push([]);

  data.push(["Basic Powers/Known Spells:"]);
  data.push(["Name"]);
  const basicPowersToExport = Array.from(new Set([
    ...(character.basicPowers || []),
    ...(character.noviceSpells || []),
    ...(character.adeptSpells || []),
    ...(character.greaterSpells || [])
  ]));
  for (const item of basicPowersToExport) {
    let suffix = bpSuffix(item, 'basicPowers', report);
    if (!suffix) suffix = bpSuffix(item, 'noviceSpells', report);
    if (!suffix) suffix = bpSuffix(item, 'adeptSpells', report);
    if (!suffix) suffix = bpSuffix(item, 'greaterSpells', report);
    data.push([`${item}${suffix}`]);
  }
  data.push([]);

  data.push(["Innate Powers:"]);
  data.push(["Name"]);
  for (const item of (character.innatePowers || [])) {
    const suffix = bpSuffix(item, 'innatePowers', report);
    data.push([`${item}${suffix}`]);
  }
  data.push([]);

  data.push(["Purchased Domain Powers:"]);
  data.push(["Name"]);
  for (const item of (character.domainPowers || [])) {
    const suffix = bpSuffix(item, 'domainPowers', report);
    data.push([`${item}${suffix}`]);
  }
  data.push([]);

  // Create workbook & worksheet
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "Basic Sheet");
  
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
}
