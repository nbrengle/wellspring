#!/usr/bin/env node
// parse-megadoc.js — reads WellspringMegaDoc.html, writes structured JSON to src/data/
// Run: node scripts/parse-megadoc.js

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DOC = join(ROOT, "WellspringMegaDoc.html");
const OUT = join(ROOT, "src", "data");

mkdirSync(OUT, { recursive: true });

// ─── HTML PARSER ──────────────────────────────────────────────────────────────
// Parse the HTML into a flat list of nodes: { type: 'heading'|'text'|'list', level?, text, items? }
// We don't need a full DOM — just heading levels and text content in order.

const raw = readFileSync(DOC, "utf8");

// Decode common HTML entities.
function decode(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&hellip;/g, "…")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&[a-z]+;/gi, "");
}

function stripTags(s) {
  return decode(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

// Walk the raw HTML once, emitting nodes in document order.
// Headings become { type:'heading', level, text }.
// <li> items become { type:'list', items:[...] } groups.
// <p> / <span> text becomes { type:'text', text }.
// Table cells become { type:'cell', text }; each table row ends with a
// { type:'rowEnd' } marker so readers can reconstruct rows.
//
// IMPORTANT: Google Docs wraps cell content in a nested <p> INSIDE the <td>
// (`<td><p><span>…</span></p></td>`). A naive walker treats the inner <p> as the
// block and never sees the <td>, flattening tables into plain text and losing all
// row structure. So when we're inside a cell we IGNORE nested block tags and keep
// buffering until the matching </td>/</th>.
function parseHTML() {
  const nodes = [];
  // Match tags we care about. Everything else is consumed as inter-tag text.
  const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
  let pos = 0;
  let inTag = null; // current open block tag being accumulated (non-cell)
  let inCell = null; // 'td' | 'th' when inside a table cell (overrides inTag)
  let cellBuf = ""; // full raw buffer of the current cell (→ flat `text`)
  let cellParts = []; // inner-<p> segments of the current cell, in order
  let inList = false;
  let listItems = [];

  const flushList = () => {
    if (listItems.length) {
      nodes.push({ type: "list", items: [...listItems] });
      listItems = [];
    }
    inList = false;
  };

  // We collect text content between tags into a buffer when inside a known block.
  let buf = "";
  const BLOCK_TAGS = new Set(["p", "li", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6"]);

  let match;
  TAG.lastIndex = 0;
  while ((match = TAG.exec(raw)) !== null) {
    const between = raw.slice(pos, match.index);
    if (inCell) {
      cellBuf += between;
      buf += between;
    } else if (inTag) buf += between;
    pos = match.index + match[0].length;

    const closing = match[1] === "/";
    const tag = match[2].toLowerCase();

    // ── Inside a table cell: buffer everything until </td>/</th>; ignore the
    // nested <p>/<span> wrappers — EXCEPT we snapshot each inner <p> boundary into
    // `parts` so a reader that needs the original paragraph structure (sub-power
    // stat blocks, see parseSubPowerCell) can recover it. `text` is still the whole
    // cell stripped in one pass, so the existing cell readers are byte-for-byte
    // unaffected (`buf` accumulates per-<p>; `cellBuf` holds the full cell). ──
    if (inCell) {
      if (closing && tag === inCell) {
        const seg = stripTags(buf).trim();
        if (seg) cellParts.push(seg);
        nodes.push({ type: "cell", text: stripTags(cellBuf).trim(), parts: cellParts }); // keep empty cells (real columns)
        buf = "";
        cellBuf = "";
        cellParts = [];
        inCell = null;
      } else if (closing && tag === "p") {
        // End of an inner paragraph: snapshot it as one cell part, reset the
        // per-<p> buffer (cellBuf keeps accumulating for the flat `text`).
        const seg = stripTags(buf).trim();
        if (seg) cellParts.push(seg);
        buf = "";
      }
      continue;
    }

    if (!closing && (tag === "td" || tag === "th")) {
      if (listItems.length) flushList();
      buf = "";
      cellBuf = "";
      cellParts = [];
      inCell = tag;
    } else if (closing && tag === "tr") {
      nodes.push({ type: "rowEnd" });
    } else if (!closing && BLOCK_TAGS.has(tag)) {
      buf = "";
      inTag = tag;
    } else if (closing && inTag === tag) {
      const text = stripTags(buf).trim();
      buf = "";
      inTag = null;
      if (!text) continue;

      if (tag === "li") {
        listItems.push(text);
      } else {
        if (listItems.length && tag !== "li") flushList();
        if (/^h[1-6]$/.test(tag)) {
          nodes.push({ type: "heading", level: +tag[1], text });
        } else {
          nodes.push({ type: "text", text });
        }
      }
    } else if ((!closing && tag === "ul") || (!closing && tag === "ol")) {
      inList = true;
    } else if (closing && (tag === "ul" || tag === "ol")) {
      flushList();
    }
  }
  flushList();
  return nodes;
}

const nodes = parseHTML();

// Converts a flat slice of nodes into a nested tree based on heading levels.
function buildTreeFromRange(startIndex, endIndex) {
  const root = { type: "root", level: 0, children: [] };
  const stack = [root];

  for (let i = startIndex; i < endIndex; i++) {
    const node = nodes[i];
    if (node.type === "heading") {
      const headingNode = { ...node, children: [] };
      while (stack.length > 1 && stack[stack.length - 1].level >= headingNode.level) {
        stack.pop();
      }
      stack[stack.length - 1].children.push(headingNode);
      stack.push(headingNode);
    } else {
      stack[stack.length - 1].children.push(node);
    }
  }
  return root;
}

// ─── DEMOTED POWER HEADING RECOVERY ──────────────────────────────────────────
// In the current Google Docs export, several power entries are styled to LOOK
// like H4 headings (bold, same font as their siblings) but the underlying HTML
// is <p><span class="cN">...</span></p>. The walker sees them as plain text and
// the downstream class/domain parsers skip them. We recover by promoting text
// nodes that match the power-heading grammar AND are followed by a power
// stat-block field. Each promoted node is given the level of the nearest
// sibling power heading (H3 for domain powers, H4 for class powers), so the
// downstream parsers see them the same as un-demoted entries.
//
// See DOC_EDITS_WANTED.md #11g. Known affected entries: Care for the Fallen,
// Arcane Barrage, Rise Above This, Infuriate, Synergistic Transfer, Disruption
// (all [Tier]-tagged) and Lifeline - 3 BP (domain power, no tier tag).
// Demote "headings" that are clearly prose paragraphs misstyled as H2/H3 in
// the source doc — they truncate the real heading's range and cause the next
// power section to look empty. Heuristic: a real heading is short (≤80 chars)
// AND ends without sentence punctuation. Anything else gets demoted to text
// so the heading walker treats it as body content.
//
// See DOC_EDITS_WANTED.md #11g/#11h. Known affected: "These Options are
// available for the Socialite..." at Socialite Right Hand Powers, miscast as
// H2 in the export.
for (let i = 0; i < nodes.length; i++) {
  const n = nodes[i];
  if (n.type !== "heading" || !n.text) continue;
  const looksLikeProse = n.text.length > 60 && /[.”!?]\s*$/.test(n.text);
  if (looksLikeProse) nodes[i] = { type: "text", text: n.text };
}

const POWER_STAT_FIELD = /^(Incantation|Incant|Call|Target|Refresh|Cost|Requirements?|Prerequisites?):\s/;
// A power heading has either a tier tag in brackets OR a "- N BP" cost suffix.
// Class powers live at H4 in the doc; domain powers at H3. Tier-tag presence
// alone isn't enough to decide (domain powers may carry [Adept], [Greater],
// etc.) — we also check whether the demoted entry sits inside the Divine
// Domains section.
const DEMOTED_POWER_TIERED =
  /^.{2,80}\[(Utility|Basic|Advanced|Veteran|Cantrip|Novice|Adept|Greater|Innate|Class|Form|Right Hand)\]/;
const DEMOTED_POWER_DOMAIN = /^[A-Z][^[\n]{1,60}-\s*\d+\s*BP\s*$/;
// Find the H1 range of "Divine Domains" so we can tell which demoted entries
// belong to a domain (→ H3) vs. a class (→ H4).
const divineDomainsIdx = nodes.findIndex((m) => m.type === "heading" && m.level === 1 && m.text === "Divine Domains");
const divineDomainsEndIdx = nodes.findIndex((m, j) => j > divineDomainsIdx && m.type === "heading" && m.level === 1);
const inDivineDomains = (idx) =>
  divineDomainsIdx !== -1 && idx > divineDomainsIdx && (divineDomainsEndIdx === -1 || idx < divineDomainsEndIdx);

for (let i = 0; i < nodes.length; i++) {
  const n = nodes[i];
  if (n.type !== "text") continue;

  const isTiered = DEMOTED_POWER_TIERED.test(n.text);
  const isDomain = DEMOTED_POWER_DOMAIN.test(n.text) && inDivineDomains(i);
  if (!isTiered && !isDomain) continue;

  // Confirm the next text node is a power stat-block field, UNLESS it's a domain power
  // (which sometimes have no stat fields and are just "Name - N BP").
  let next = null;
  for (let j = i + 1; j < Math.min(nodes.length, i + 4); j++) {
    if (nodes[j].type === "text") {
      next = nodes[j];
      break;
    }
  }

  if (isTiered && (!next || !POWER_STAT_FIELD.test(next.text))) continue;

  // Domain powers (H3) when inside Divine Domains; class powers (H4) otherwise.
  const level = inDivineDomains(i) ? 3 : 4;
  nodes[i] = { type: "heading", level, text: n.text };
}

function write(filename, data) {
  const path = join(OUT, filename);
  writeFileSync(path, JSON.stringify(data, null, 2));
  const count = Array.isArray(data) ? data.length : Object.keys(data).length;
  console.log(`  ${filename.padEnd(26)} ${count} entries`);
}

// ─── NODE HELPERS ─────────────────────────────────────────────────────────────

// Find the index of the first heading matching text (exact) at a given level,
// optionally starting after `after`.
function findHeading(text, level = null, after = 0) {
  return nodes.findIndex(
    (n, i) => i >= after && n.type === "heading" && (level === null || n.level === level) && n.text === text,
  );
}

// Find first heading whose text matches a regex, optionally at a given level.
function findHeadingRe(re, level = null, after = 0) {
  return nodes.findIndex(
    (n, i) => i >= after && n.type === "heading" && (level === null || n.level === level) && re.test(n.text),
  );
}

// Return all text content between two node indices as a single joined string.
function textBetween(start, end) {
  return nodes
    .slice(start, end)
    .filter((n) => n.type === "text")
    .map((n) => n.text)
    .join(" ");
}

// Return all text+list content between two node indices.
function bodyBetween(start, end) {
  return nodes
    .slice(start, end)
    .filter((n) => n.type === "text" || n.type === "list")
    .map((n) => (n.type === "list" ? n.items.join(" ") : n.text))
    .join(" ");
}

// Parse the multiclass-skill bullet lines into a clean default granted-skill list.
// The Jun 26 MegaDoc reformatted these to a header line carrying the fixed skills +
// a "Choose one of the following:" marker, with the options as their own following
// bullet lines:
//   "Materials, Everywhere: Basic Martial Weapons (1), Choose one of the following:"
//   "Forage I (3)" / "Prospect I (3)" / "Scavenge I (3)"
// We emit the fixed skills, then default each choice to its FIRST listed option (the
// builder can change it later). This replaced the old inline "[a, b, c]" parsing —
// the bracket-splitting regex and hardcoded default map are no longer needed.
//
// `blobs` is the flat <li> list for the section; a line ending in "the following:"
// opens a choice whose options are the subsequent lines until the next header line
// (a line that introduces its own fixed skills / choice). See PARSER_SOURCE_FEEDBACK
// #1: real list indentation would make this structural instead of convention-based.
function parseMulticlassSkills(blobs) {
  const out = [];
  const tokensOf = (text) => {
    // "<Header>: " flavor prefix → drop it; then split the rest into "Name (cost)".
    const body = text
      .replace(/^[^:]+:\s*/, "")
      .replace(/Choose one of the following:\s*$/i, "")
      .trim();
    return body
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((part) => {
        const costM = part.match(/\((\d+)\)\s*$/);
        return { name: part.replace(/\s*\(\d+\)\s*$/, "").trim(), cost: costM ? parseInt(costM[1], 10) : null };
      })
      .filter((t) => t.name);
  };

  // When a line opens a choice ("…the following:"), the subsequent bare-skill lines
  // are its OPTIONS: take the FIRST as the default and skip the rest, until a header
  // / fixed line (one with a "Header:" prefix, or that opens its own choice) ends the
  // option run.
  let inOptions = false; // inside an open choice's option list
  let tookDefault = false;
  for (const blob of blobs || []) {
    const line = blob.trim();
    const opensChoice = /the following:\s*$/i.test(line);
    const isBareOption = !opensChoice && !/^[^:]+:/.test(line);

    if (inOptions && isBareOption) {
      if (!tookDefault) {
        const t = tokensOf(blob);
        if (t.length) {
          out.push(t[0]);
          tookDefault = true;
        }
      }
      continue; // skip non-default options
    }
    // Header / fixed line: emit its fixed skills; (re)open or close the option run.
    for (const t of tokensOf(blob)) out.push(t);
    inOptions = opensChoice;
    tookDefault = false;
  }
  return out;
}

// Find the next heading at or above `level` starting after `after`.
// Used to bound a section: "end of this H2 is the next H2 or H1".
function nextHeadingAtOrAbove(level, after) {
  return nodes.findIndex((n, i) => i > after && n.type === "heading" && n.level <= level);
}

// Collect all direct children of a heading node (nodes between it and the next
// sibling/parent heading). Returns { heading: node, children: node[] }.
function sectionBetween(startIdx, endIdx) {
  return nodes.slice(startIdx + 1, endIdx === -1 ? nodes.length : endIdx);
}

// ─── POWER BLOCK PARSER ───────────────────────────────────────────────────────
// Powers are H4 (occasionally H5 for sub-variants) with the tier tag in the name.
// The stat-block fields follow as text nodes before the description prose.

const TIER_PATTERN = /\[(Utility|Basic|Advanced|Veteran|Cantrip|Novice|Adept|Greater|Innate|Class|Form|Right Hand)\]/;
const POWER_HEADER = new RegExp(TIER_PATTERN.source + String.raw`(\s*\[[^\]]+\])*\s*(-\s*\d+\s*BP)?\s*(\(\d+\))?\s*$`);

// SUB-POWERS: some powers grant a named sub-power ("Grant Power: Curious Balm",
// "the Holy Rest Power below") that has its OWN H4/H5 heading + stat block but NO
// [Tier] tag, so POWER_HEADER rejects it and its block is orphaned. Collect those
// granted names up front so parsePowersInRange can promote the matching heading to
// a real (parseable) power. Built lazily from all nodes on first use.
let _subPowerNames = null;
function subPowerNames() {
  if (_subPowerNames) return _subPowerNames;
  _subPowerNames = new Set();
  // Include cell text — some power descriptions live inside table cells now.
  const text = nodes
    .filter((n) => n.type === "text" || n.type === "cell")
    .map((n) => n.text)
    .join(" ");
  for (const m of text.matchAll(/Grant Power:\s*([A-Z][\w’' ]+?)\s*(?:[”"”,]|$)/g)) _subPowerNames.add(m[1].trim());
  for (const m of text.matchAll(/\bthe\s+([A-Z][\w’' ]+?)\s+Power\s+below\b/g)) _subPowerNames.add(m[1].trim());
  return _subPowerNames;
}

const STAT_FIELD =
  /^(Incantation|Incant|Call|Target|Duration|Delivery|Refresh|Accent|Effect|Requirements?|Prerequisites?|Skills and Options):\s*(.*)$/;
// Same field labels, unanchored — used to find where a stat block starts within a
// run-on string (sub-power cells glue the power NAME onto the first field label).
const STAT_LABEL =
  /(Incantation|Incant|Call|Target|Duration|Delivery|Refresh|Accent|Effect|Requirements?|Prerequisites?|Skills and Options):/;
const STAT_TWO = /^(Target|Delivery|Accent):\s*(.+?)\s{2,}(Duration|Refresh|Effect):\s*(.+)$/;
const statKey = (l) =>
  l
    .toLowerCase()
    .replace(/^incant$/, "incantation")
    .replace(/\s+/g, "_")
    .replace(/s$/, "");

function parsePowerNodes(powerNodes) {
  // powerNodes: text + list nodes belonging to one power (after its heading node).
  // A `list` node's items are flattened to bullet lines ("• …") so a power's
  // level/benefit list survives into the description instead of being dropped.
  const lines = powerNodes
    .flatMap((n) => (n.type === "list" ? n.items.map((it) => `• ${it}`) : [n.text]))
    .filter(Boolean);
  const fields = {};
  let descStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const two = lines[i].match(STAT_TWO);
    if (two) {
      fields[statKey(two[1])] = two[2].trim();
      fields[statKey(two[3])] = two[4].trim();
      descStart = i + 1;
      continue;
    }
    const one = lines[i].match(STAT_FIELD);
    if (one) {
      fields[statKey(one[1])] = one[2].trim();
      descStart = i + 1;
      continue;
    }
    descStart = i;
    break;
  }

  return {
    fields,
    description: lines.slice(descStart).join(" "),
  };
}

// SUB-POWER DEFINITION CELLS: a granted sub-power (Curious Balm, Holy Rest, …) has
// no [Tier]-tagged H4 heading — its whole stat block lives in a single table cell,

// with the sub-power NAME prefixed onto the first field:
//   "Curious Balm" · "Incantation: Quick 100" · "Call: …" · … · "Effect: Heal, Drain" · "<prose>"
// The cell's `parts` array preserves those inner-<p> boundaries (the flat `text`
// concatenates them with no separator). Parse the parts like a normal power body:
// the first part is the name, the rest are stat-field lines + trailing description.
// Returns a sub-power object (type 'subpower', tier 'SubPower') or null if `cell`
// isn't a sub-power def. A sub-power is its OWN entity type — a granted ability, not a
// spell or a power (it's never picked or costed; the build gates it by tier, not type),
// so it's the same type regardless of which section granted it.
function parseSubPowerCell(cell, subNames) {
  if (!cell || cell.type !== "cell" || !Array.isArray(cell.parts) || cell.parts.length < 2) return null;
  // The name is glued to the first stat field inside the leading <p>
  // ("Curious BalmIncantation: Quick 100"). Split at the first stat-field label.
  const first = cell.parts[0];
  const labelAt = first.search(STAT_LABEL);
  if (labelAt <= 0) return null;
  const name = first.slice(0, labelAt).trim();
  if (!subNames.has(name)) return null;
  // Re-attach the trailing stat field as the first body line, then parse the rest.
  const bodyNodes = [
    { type: "text", text: first.slice(labelAt) },
    ...cell.parts.slice(1).map((text) => ({ type: "text", text })),
  ];
  const { fields, description } = parsePowerNodes(bodyNodes);
  return {
    name,
    type: "subpower",
    tier: "SubPower",
    tags: [],
    ranks: 1,
    cost: null,
    incantation: fields["incantation"] ?? null,
    call: fields["call"] ?? null,
    target: fields["target"] ?? null,
    duration: fields["duration"] ?? null,
    delivery: fields["delivery"] ?? null,
    refresh: fields["refresh"] ?? null,
    accent: fields["accent"] ?? null,
    effect: fields["effect"] ?? null,
    requirement: fields["requirement"] ?? null,
    prerequisites: fields["prerequisite"] ?? fields["prerequisites"] ?? null,
    skillsAndOptions: fields["skills_and_option"] ?? null,
    description,
  };
}

function parsePowerHeading(text) {
  const name = text.replace(/\s*(\[|-\s*\d+\s*BP).*$/, "").trim();
  const tierMatch = text.match(TIER_PATTERN);
  const tier = tierMatch ? tierMatch[1] : "Unknown";
  const tags = [...text.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]).filter((t) => t !== tier);
  const ranksMatch = text.match(/\((\d+)\)\s*$/);
  // Ranks = how many times this power can be taken (the "(N)" suffix). Same concept
  // and field name as skills/perks — NOT a separate "maxRanks" — so the dedupe/cap
  // logic reads one field everywhere.
  const ranks = ranksMatch ? parseInt(ranksMatch[1]) : 1;
  const costMatch = text.match(/-\s*(\d+)\s*BP/);
  const cost = costMatch ? parseInt(costMatch[1]) : null;
  return { name, tier, tags, ranks, cost };
}

// Collect all H4/H5 power entries under a section bounded by [start, end). `type`
// ('power' | 'spell') is the entity type of the SECTION — the caller knows it from
// the heading it matched (a "… Cantrips"/"… Novice Spells" section yields spells; a
// "… Basic Powers" section yields powers) — so every entry (and its sub-powers) is
// stamped with it, never inferred from the tier downstream.
function parsePowersInRange(start, end, type) {
  const powers = [];
  const subNames = subPowerNames();
  let i = start;
  while (i < end) {
    const n = nodes[i];
    // A power heading is either tier-tagged (POWER_HEADER) OR a granted SUB-POWER
    // whose bare name appears in a "Grant Power: X" / "X Power below" reference.
    const isSub =
      n.type === "heading" &&
      (n.level === 4 || n.level === 5) &&
      !POWER_HEADER.test(n.text) &&
      subNames.has(n.text.trim());
    if (n.type === "heading" && (n.level === 4 || n.level === 5) && (POWER_HEADER.test(n.text) || isSub)) {
      // A power's body ends at the next REAL heading. Some source paragraphs are
      // mis-styled as <h4> (a long sentence, no [Tier] tag, not a sub-power) — e.g.
      // Arcane Charge's whole description. Don't let those bound the body; treat
      // them as prose so the description isn't lost.
      const isProseHeading = (m) =>
        m.type === "heading" &&
        !POWER_HEADER.test(m.text) &&
        !subNames.has(m.text.trim()) &&
        m.text.length > 60 &&
        /[.”]$/.test(m.text);
      const bodyEnd = nodes.findIndex((m, j) => j > i && m.type === "heading" && !isProseHeading(m));
      // Keep `list` nodes alongside `text`: a power's benefits often follow a
      // "…at various Levels:" colon as a <ul> (Adept Ritualist, Druid Forms). They
      // are separate nodes the walker captured; dropping them here is what left
      // those descriptions truncated at the colon. Prose headings → text too.
      const bodyTo = bodyEnd === -1 ? end : Math.min(bodyEnd, end);
      const bodyRange = nodes.slice(i + 1, bodyTo);
      const bodyNodes = bodyRange
        .filter((m) => m.type === "text" || m.type === "list" || isProseHeading(m))
        .map((m) => (isProseHeading(m) ? { type: "text", text: m.text } : m));
      // A granted sub-power's stat block lives in a table cell INSIDE the granting
      // power's body (between this heading and the next). Emit those as their own
      // SubPower entries; they're filtered out of `bodyNodes` above so they don't
      // pollute the parent's description.
      const subCells = bodyRange.map((m) => parseSubPowerCell(m, subNames)).filter(Boolean);
      // Sub-powers have no tier tag; mark them so they're identifiable + parseable.
      const parsed = parsePowerHeading(n.text);
      const { name, tags, ranks, cost } = parsed;
      const tier = isSub ? "SubPower" : parsed.tier;
      const { fields, description } = parsePowerNodes(bodyNodes);
      powers.push({
        name,
        type,
        tier,
        tags,
        ranks,
        cost,
        incantation: fields["incantation"] ?? null,
        call: fields["call"] ?? null,
        target: fields["target"] ?? null,
        duration: fields["duration"] ?? null,
        delivery: fields["delivery"] ?? null,
        refresh: fields["refresh"] ?? null,
        accent: fields["accent"] ?? null,
        effect: fields["effect"] ?? null,
        requirement: fields["requirement"] ?? null,
        prerequisites: fields["prerequisite"] ?? fields["prerequisites"] ?? null,
        skillsAndOptions: fields["skills_and_option"] ?? null,
        description,
      });
      powers.push(...subCells);
      i = bodyTo;
    } else {
      i++;
    }
  }
  return powers;
}

// ─── CLASSES ──────────────────────────────────────────────────────────────────

console.log("\nParsing classes...");

function parseClasses() {
  const classesStart = findHeading("Base Classes (All)");
  const classesEnd = findHeading("Lineages (All)");
  const classes = [];

  // Each class is an H1 "Name: Base Class" between those bounds.
  let i = classesStart + 1;
  while (i < classesEnd) {
    const n = nodes[i];
    if (n.type !== "heading" || n.level !== 1 || !/^(.+):\s*Base Class$/.test(n.text)) {
      i++;
      continue;
    }

    const clsName = n.text.replace(/:\s*Base Class$/, "").trim();
    const clsStart = i;
    // Class ends at the next H1
    const clsEnd = nodes.findIndex((m, j) => j > clsStart && m.type === "heading" && m.level === 1);
    const end = clsEnd === -1 ? classesEnd : Math.min(clsEnd, classesEnd);

    // H2 sections within the class
    const h2 = (text) => {
      const idx = nodes.findIndex(
        (m, j) => j > clsStart && j < end && m.type === "heading" && m.level === 2 && m.text === text,
      );
      if (idx === -1) return -1;
      const next = nodes.findIndex((m, j) => j > idx && m.type === "heading" && m.level <= 2);
      return { start: idx, end: next === -1 ? end : Math.min(next, end) };
    };

    // Description: text between class H1 and first H2
    const firstH2 = nodes.findIndex((m, j) => j > clsStart && j < end && m.type === "heading" && m.level === 2);
    const description = textBetween(clsStart + 1, firstH2 === -1 ? end : firstH2);

    // Starting / multiclass skills: list nodes under those H2s
    const skillList = (sectionText) => {
      const sec = h2(sectionText);
      if (!sec) return [];
      return nodes
        .slice(sec.start + 1, sec.end)
        .filter((m) => m.type === "list")
        .flatMap((m) => m.items);
    };

    // Class progression table: cells under "Class Progression Table" H2
    const progression = parseProgressionTable(clsStart, end);

    // Specializations: H3 entries under the "Specializations" H2 (e.g. Artisan
    // → Artificer / Crafter / Mystic). Some classes don't have any.
    const specSec = h2("Specializations");
    const specializations =
      specSec === -1
        ? []
        : (() => {
            const out = [];
            let j = specSec.start + 1;
            while (j < specSec.end) {
              const m = nodes[j];
              if (m.type === "heading" && m.level === 3 && m.text) {
                const specEnd = nodes.findIndex((x, k) => k > j && x.type === "heading" && x.level <= 3);
                const sEnd = specEnd === -1 ? specSec.end : Math.min(specEnd, specSec.end);
                out.push({ name: m.text, description: textBetween(j + 1, sEnd) });
                j = sEnd;
              } else j++;
            }
            return out;
          })();

    // Power sections: each is an H2 like "Artisan Innate Powers", "Artisan Basic Powers" etc.
    // We collect all H4/H5 power nodes under each matching H2. `type` is the entity type
    // this whole section yields ('power' or 'spell') — spells are a DISTINCT entity, not a
    // power subtype, so the caster-tier sections say so explicitly (defaults to 'power').
    const powers = (h2Pattern, type = "power") => {
      const results = [];
      let j = clsStart + 1;
      while (j < end) {
        const m = nodes[j];
        if (m.type === "heading" && m.level === 2 && h2Pattern.test(m.text)) {
          const secEnd = nodes.findIndex((x, k) => k > j && x.type === "heading" && x.level <= 2);
          results.push(...parsePowersInRange(j + 1, secEnd === -1 ? end : Math.min(secEnd, end), type));
        }
        j++;
      }
      return results;
    };

    const isCaster = ["Cleric", "Druid", "Mage", "Sourcerer"].includes(clsName);
    // Divine vs Arcane is derived from the class's own text: Divine casters draw on
    // Faith/Worship, Arcane casters on Arcane. Emitted as a structured field so the
    // data layer reads class.magicType instead of hand-maintaining a class→type map.
    const magicType = !isCaster
      ? null
      : /\barcane\b/i.test([description, ...(skillList("Starting Skills") || [])].join(" "))
        ? "Arcane"
        : "Divine";

    // Annotate Extended Capacity references in this class's skill lists with the
    // class's Sphere ("Extended Capacity - Novice" → "...[Divine]"/"[Arcane]"). The
    // doc omits the sphere on these references, but it's unambiguous from the owning
    // caster's magicType — so we DERIVE it here (was a manual patch, PR #116) and the
    // builder can route the granted slot to the right pool. Only touch the bare ref;
    // leave a count suffix "(3)" / "x2" intact.
    const withSphere = (s) =>
      magicType
        ? s.replace(/\bExtended Capacity\s*-?\s*(Novice|Adept|Greater)\b(?!\s*\[)/g, (m) => `${m} [${magicType}]`)
        : s;
    const annotateSkills = (list) => (list || []).map(withSphere);

    classes.push({
      name: clsName,
      // The class's domain kind — Martial vs Spellcaster. Named `kind`, NOT `type`,
      // so it survives entity indexing (which stamps `type: "class"` as the Entity
      // discriminator and would otherwise clobber this).
      kind: isCaster ? "Spellcaster" : "Martial",
      magicType,
      description,
      startingSkills: annotateSkills(skillList("Starting Skills")),
      multiclassSkills: annotateSkills(skillList("Multiclass Skills")),
      multiclassBestows: parseMulticlassSkills(skillList("Multiclass Skills")),
      progression,
      specializations,
      innate: powers(new RegExp(`^${clsName} Innate Powers$`)),
      utility: powers(new RegExp(`^${clsName} Utility Powers$`)),
      basic: powers(new RegExp(`^(${clsName} Basic Powers|Basic ${clsName} Powers)$`)),
      advanced: powers(new RegExp(`^${clsName} Advanced Powers$`)),
      veteran: powers(new RegExp(`^${clsName} Veteran Powers$`)),
      classSkills: powers(new RegExp(`^${clsName} (Class )?Skills$`)),
      rightHandPowers: powers(new RegExp(`^${clsName} Right Hand Powers$`)),
      cantrips: powers(new RegExp(`^${clsName} Cantrips?$`), "spell"),
      noviceSpells: powers(new RegExp(`^${clsName} (Novice( Form)? Spells?)$`), "spell"),
      adeptSpells: powers(new RegExp(`^${clsName} (Adept( Form)? Spells?)$`), "spell"),
      greaterSpells: powers(new RegExp(`^${clsName} (Greater( Form)? Spells?)$`), "spell"),
    });

    i = end;
  }
  return classes;
}

// Class progression table: read the real table rows under the "Class Progression
// Table" H2. Each row is a sequence of `'cell'` nodes terminated by `'rowEnd'`.
// Columns (martial): [Class?] Level, Utility, Basic, Advanced, Veteran, Class Bonuses.
// Columns (caster):  [Class?] Level, Cantrips, Spells Known, Spell Slots, Class Bonuses.
// (Martial tables carry a leading empty "Class" column; we key off the Level column
// by finding the first numeric cell, so the leading column doesn't matter.)
function parseProgressionTable(clsStart, clsEnd) {
  const tableIdx = nodes.findIndex(
    (n, i) =>
      i > clsStart && i < clsEnd && n.type === "heading" && n.level === 2 && n.text === "Class Progression Table",
  );
  if (tableIdx === -1) return {};
  const tableEnd = nodes.findIndex((n, i) => i > tableIdx && n.type === "heading" && n.level <= 2);
  const end = tableEnd === -1 ? clsEnd : Math.min(tableEnd, clsEnd);

  // Gather rows: arrays of cell texts split on 'rowEnd'.
  const rows = [];
  let cur = [];
  for (let i = tableIdx + 1; i < end; i++) {
    const n = nodes[i];
    if (n.type === "rowEnd") {
      if (cur.length) rows.push(cur);
      cur = [];
    } else if (n.type === "cell") cur.push(n.text);
  }
  if (cur.length) rows.push(cur);
  if (!rows.length) return {};

  const HEADER =
    /^(Class|Level|Utility ?Powers|Basic ?Powers|Advanced ?Powers|Veteran ?Powers|Cantrips?|Spells? Known|Spell ?Slots?|Class Bonuses?)$/i;
  const isCaster = rows.flat().some((v) => /cantrip|spell/i.test(v));
  const num = (v) => parseInt(v) || 0;
  const orNull = (v) => (!v || v === "-" ? null : v);

  const progression = {};
  for (const cells of rows) {
    // Header rows: every cell matches a known header label. Skip.
    if (cells.every((c) => !c || HEADER.test(c))) continue;
    // The level is the first purely-numeric cell; data columns follow it, the
    // Class Bonuses cell is last. (A leading empty "Class" cell is skipped.)
    const lvlIdx = cells.findIndex((c) => /^\d+$/.test(c));
    if (lvlIdx === -1) continue;
    const level = parseInt(cells[lvlIdx], 10);
    if (level < 1 || level > 20) continue;
    const cols = cells.slice(lvlIdx + 1, lvlIdx + 1 + (isCaster ? 3 : 4));
    const bonusRaw = cells
      .slice(lvlIdx + 1 + (isCaster ? 3 : 4))
      .join(" ")
      .trim();
    const bonus = bonusRaw && bonusRaw !== "-" ? bonusRaw.replace(/,\s*$/, "") : null;

    // The "Class Bonuses" cell states permanent stat boosts as prose ("+1 Base
    // Maximum Life Points" at Fighter L2). Extract them structurally so the
    // validator reads progression[lvl].statMods instead of re-regexing the prose.
    const { mods: bonusStatMods } = statModsFromText(bonus);
    const row = {};
    if (bonusStatMods.length) row.statMods = bonusStatMods;
    // "Innate Bonus Cantrip: <name>[, <name>]" → structured list.
    const icm = bonus && bonus.match(/innate\s+bonus\s+cantrip:\s*(.+)$/i);
    if (icm) {
      const names = icm[1]
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (names.length) row.innateCantrips = names;
    }
    if (isCaster) {
      progression[level] = { cantrips: num(cols[0]), spellsKnown: num(cols[1]), slots: orNull(cols[2]), bonus, ...row };
    } else {
      progression[level] = {
        utility: num(cols[0]),
        basic: num(cols[1]),
        advanced: num(cols[2]),
        veteran: num(cols[3]),
        bonus,
        ...row,
      };
    }
  }
  return progression;
}

// Some powers grant benefits that scale with CLASS LEVEL: their description reads
// "…benefits at various <Class> Levels: • Level 1 - … • Level 3 - …". Parse those
// "• Level N - …" bullets into a structured `levelBenefits` array so the validator
// can mark which are active at the character's level in that class (auto-granted,
// no BP). The gating class is named in the lead-in ("various Artisan Levels").
const LEVEL_BENEFIT = /•?\s*Level\s+(\d+)\s*[-–—]\s*([^•]+)/g;
function extractPowerBenefits(power) {
  const d = power.description || "";
  if (!/Level\s+\d+\s*[-–—]/.test(d)) return;
  const gate = d.match(/at\s+various\s+([A-Z][\w]+)\s+Levels/i);
  const benefits = [];
  let m;
  LEVEL_BENEFIT.lastIndex = 0;
  while ((m = LEVEL_BENEFIT.exec(d))) {
    benefits.push({ level: parseInt(m[1], 10), text: m[2].trim() });
  }
  if (benefits.length) {
    power.levelBenefits = benefits;
    power.levelBenefitClass = gate ? gate[1] : null; // gate on this class's level
  }
}

// ─── STAT-MOD EXTRACTION (prose → structured) ──────────────────────────────────
// Permanent build-stat boosts (max Life Points / Armor / Spikes / Health / Natural
// Armor) are stated in entity descriptions. We extract them HERE, at parse time,
// next to the prose — emitting entity.statMods = [{ stat, amount }] — so the validator
// reads a structured field instead of re-regexing descriptions at character-build
// time. One extraction site, close to the doc, diffable against it.
const STAT_MOD_PATTERNS = [
  // Decrements first ("N fewer maximum Life Point" — Fragile Form), so the generic
  // "N maximum Life Points" increment below doesn't mis-read it as +N. sign:-1.
  {
    stat: "lifePoints",
    sign: -1,
    re: /(?:has\s+)?(?:\+?(\d+)|\bone|two|three)\s+fewer\s+(?:Base\s+)?maximum\s+Life\s+Points?/i,
  },
  { stat: "lifePoints", re: /(?:additional\s+)?(?:\+?(\d+)|\bone)\s+(?:Base\s+)?maximum\s+Life\s+Points?/i },
  {
    stat: "lifePoints",
    re: /(?:adds?|gains?)\s+(?:\+?(\d+)|\bone)\s+Life\s+Points?\s+to\s+(?:their\s+)?max(?:imum)?/i,
  },
  { stat: "lifePoints", re: /\+\s*(\d+)\s+(?:Base\s+)?Maximum\s+Life\s+Points?/i },
  {
    stat: "lifePoints",
    re: /(?:Base\s+)?Maximum\s+Life\s+Points?\s+(?:is|are)\s+increased\s+by\s+(?:\+?(\d+)|\bone|two|three)\b/i,
  },
  { stat: "lifePoints", re: /(?:\+?(\d+)|\bone)\s+Maximum\s+Health\b/i },
  // Allows an optional pronoun after the verb ("granting them three points …") and
  // word-numbers (one–eight), so e.g. Chimera's Tough Hide ("granting them three
  // points of Natural Armor") is extracted, not just "grants 3 Natural Armor".
  {
    stat: "naturalArmor",
    re: /(?:gains?|grant(?:ing|s)?)\s+(?:them|it|the\s+character)?\s*(?:\+?(\d+)|\b(?:one|two|three|four|five|six|seven|eight))\s+(?:points?\s+of\s+)?Natural\s+Armor/i,
  },
  {
    stat: "naturalArmor",
    re: /(?:\+?(\d+)|\b(?:one|two|three|four|five|six|seven|eight))\s+points?\s+of\s+Natural\s+Armor/i,
  },
  // "natural armor … increases to N" (Chimera's Armored Carapace upgrades Tough Hide).
  {
    stat: "naturalArmor",
    re: /Natural\s+Armor[^.]*?increases?\s+to\s+(?:\+?(\d+)|\b(?:one|two|three|four|five|six|seven|eight))/i,
  },
  {
    stat: "naturalArmor",
    re: /\+?(\d+)\s+Maximum\s+Health,?\s+physical\s+Armor\s+Points?,?\s+and\s+Natural\s+Armor\s+Points?/i,
  },
  // "+N physical Armor Point" AND "one additional point to ... (Base) Maximum
  // Armor Points" (Armor Expertise / Studded Leather — the conditional-on-wearing
  // phrasing the old runtime regex missed).
  { stat: "armor", re: /\+?(\d+)\s+(?:Maximum\s+Health,?\s+)?(?:physical\s+)?Armor\s+Points?/i },
  {
    stat: "armor",
    re: /(?:\+?(\d+)|\bone)\s+additional\s+points?\s+to\s+(?:her|their|his|the)\s+(?:physical\s+)?Base\s+Maximum\s+Armor\s+Points?/i,
  },
  { stat: "armor", re: /benefit\s+from\s+up\s+to\s+(two|four|six|eight|\d+)\s+Armor\s+Points/i },
  { stat: "spikes", re: /(?:\+?(\d+)|\bone)\s+(?:(?:Base|Bonus)\s+)?Maximum\s+Spikes?\b/i },
  { stat: "spikes", re: /(?:Base\s+)?Maximum\s+Spikes?\s+(?:is|are)\s+increased\s+by\s+(?:\+?(\d+)|\bone)/i },
  { stat: "spikes", re: /gains?\s+(?:\+?(\d+)|\bone|two|three)\s+additional\s+Spikes?/i },
];
const STAT_WORD_N = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
const statNum = (w) => (/^\d+$/.test(String(w)) ? parseInt(w, 10) : STAT_WORD_N[String(w).toLowerCase()] || 0);

// Core extractor: prose → [{ stat, amount }]. One boost per stat (alternate
// phrasings of the same boost don't double-count). Returns { mods, variableNaturalArmor }.
function statModsFromText(text) {
  const mods = [];
  const seen = new Set();
  if (!text) return { mods, variableNaturalArmor: false };

  for (const match of text.matchAll(/Grants?\s*(?:a\s+)?\+?(\d+)\s+(?:to\s+)?(Life|Armor)/gi)) {
    const stat = match[2].toLowerCase() === "life" ? "lifePoints" : "armor";
    if (!seen.has(stat)) {
      mods.push({ stat, amount: parseInt(match[1]) });
      seen.add(stat);
    }
  }

  for (const match of text.matchAll(/benefit from up to (two|four|six|eight|\d+) Armor Points/gi)) {
    let val = parseInt(match[1]);
    if (isNaN(val)) {
      const words = { two: 2, four: 4, six: 6, eight: 8 };
      val = words[match[1].toLowerCase()];
    }
    if (!seen.has("armor")) {
      mods.push({ stat: "armor", amount: val });
      seen.add("armor");
    }
  }

  for (const { stat, re, sign = 1 } of STAT_MOD_PATTERNS) {
    if (seen.has(stat)) continue;
    const m = text.match(re);
    if (!m) continue;
    // Reject IN-PLAY boosts, not permanent build stats: a "Grant"/"Mend" is a
    // temporary game Call ("Short Grant +1 Maximum Life Points", "Mend 5 Armor
    // Points"), not a Base change. The doc wraps those in the Call verb (often
    // quoted) right before the stat phrase — skip a match preceded by it.
    // Context immediately around the match — used to reject IN-PLAY (temporary)
    // boosts, which the doc phrases distinctly from permanent "Base" changes.
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    // A "Grant"/"Mend"/"call"/"heal" is a temporary game Call ("Short Grant +1
    // Maximum Life Points", "Mend 5 Armor Points"), not a Base change.
    if (/\b(?:Short |Long )?Grant\b[^."]*$|\bMend\b[^."]*$|\bcall\b[^."]*$|\bheals?\b[^."]*$/i.test(before)) continue;
    // "Bonus Maximum" (vs "Base Maximum") and a nearby "for the duration" both mark
    // a TEMPORARY buff — the doc reserves "Base" for permanent stat changes.
    if (/\bBonus\s+Maximum\b/i.test(m[0]) || /\bfor the duration\b/i.test(before)) continue;
    const w = m[1] || (m[0].match(/\b(one|two|three|four|five|six|seven|eight)\b/i) || [])[1] || "0";
    const amount = statNum(w) * sign;
    if (amount !== 0) {
      mods.push({ stat, amount });
      seen.add(stat);
    }
  }
  // Variable/contextual Natural Armor with no fixed number (Gift of Unbreakable
  // Flesh: "Gains Natural Armor from Patron").
  const variableNaturalArmor = !seen.has("naturalArmor") && /\bgains?\b[^.]*\bNatural Armor\b/i.test(text);
  return { mods, variableNaturalArmor };
}

// Attach statMods (and statModNotes for variable amounts) to any entity with a
// description. `tags` lets Druid Form powers (temporary while-transformed boosts)
// opt out — those are not permanent build stats.
function extractStatMods(entity) {
  if ((entity.tags || []).includes("Form")) return;
  // Skip tactical spells and rituals — only durable build stats belong on the character sheet
  if (/\b(?:Spell|Spell-?Slot|Ritual)\b/i.test(entity.refresh || "")) return;
  const { mods, variableNaturalArmor } = statModsFromText(entity.description || entity.desc || "");
  if (mods.length) entity.statMods = mods;
  if (variableNaturalArmor) (entity.statModNotes ||= []).push({ stat: "naturalArmor", text: "variable" });
}

// ─── WEALTH INCOME (prose → structured) ────────────────────────────────────────
// Per-game income an entity grants ("N Wealth at the beginning of each game", a
// Manse cash alternative, or a one-time first-event sum). Extracted here so the
// validator reads entity.wealthIncome instead of regexing descriptions at runtime.
// Returns { n, kind } | null. kind: 'recurring' | 'manse' | 'firstEvent'.
function wealthIncomeFromText(name, text) {
  if (!text) return null;
  const recurring = text.match(/(\d+)\s*Wealth\s+(?:at the beginning of (?:each|every)\s+(?:game|event)|per\s+Event)/i);
  if (recurring) return { n: parseInt(recurring[1], 10), kind: "recurring" };
  if (/\bManse\b/i.test(name || "")) {
    const alt = text.match(/Alternatively,?\s*(\d+)\s*Wealth/i);
    if (alt) return { n: parseInt(alt[1], 10), kind: "manse" };
  }
  // One-time sums that land AT the first event count toward the point-in-time total.
  const firstEvent =
    text.match(/(\d+)\s*Wealth\s+at the beginning of (?:their\s+)?first\s+Event/i) ||
    text.match(/one-time\s+sum[^.]*?(\d+)\s*Wealth/i);
  if (firstEvent) return { n: parseInt(firstEvent[1], 10), kind: "firstEvent" };
  return null;
}
function extractWealthIncome(entity) {
  const w = wealthIncomeFromText(entity.name, entity.description || entity.desc || "");
  if (w) entity.wealthIncome = w;
}

// ─── SLOT GRANTS (prose → structured) ──────────────────────────────────────────
// Power/spell-slot grants an entity confers: an extra cantrip, an extra tier slot,
// added Known Spells, or a floating "highest-level" slot. Emitted as
// entity.slotBestows = [{ cat, n }] (+ entity.highestSlot for the floating one) so
// the validator reads structured grants instead of regexing descriptions. `cat` is
// the slot category: cantrips | spellsKnown | utility|basic|advanced|veteran |
// novice|adept|greater.
const SLOT_TIER_TO_CAT = {
  novice: "novice",
  adept: "adept",
  greater: "greater",
  utility: "utility",
  basic: "basic",
  advanced: "advanced",
  veteran: "veteran",
};
function slotBestowsFromText(name, text) {
  const grants = [];
  let highest = false;
  if (!text) return { grants, highest };
  // Extensive Combat Training - <Tier>: the NAME's tier word is authoritative (its
  // prose says "Adept Tier Power" for the "- Advanced" variant — a doc mismatch, so
  // trust the name). Keep this name-keyed rule in the parser, next to the data.
  const ect = (name || "").match(/Extensive Combat Training\s*-\s*(Basic|Advanced|Veteran)/i);
  if (ect) {
    grants.push({ cat: ect[1].toLowerCase(), n: 1 });
    return { grants, highest };
  }
  if (/\badditional\s+cantrip\b/i.test(text)) grants.push({ cat: "cantrips", n: 1 });
  const tier = text.match(
    /\badditional\s+(Novice|Adept|Greater|Utility|Basic|Advanced|Veteran)\s+(?:Tier\s+)?(?:spell-?\s*slot|slot|power)/i,
  );
  if (tier) {
    const cat = SLOT_TIER_TO_CAT[tier[1].toLowerCase()];
    if (cat) {
      grants.push({ cat, n: 1 });
      // [REMOVED] Per user feedback, additional spell-slots DO NOT grant spellsKnown automatically.
    }
  }
  const known = text.match(/\badds?\s+(\d+)\s+to\s+the\s+number\s+of\s+Known\s+Spells/i);
  if (known) grants.push({ cat: "spellsKnown", n: parseInt(known[1], 10) });
  if (/additional\s+spell-?slot\s+of\s+their\s+highest[- ]level/i.test(text)) highest = true;

  const chooseTier = text.match(
    /\bchoose\s+(two|three|one|four|\d+)\s+(Novice|Adept|Greater|Utility|Basic|Advanced|Veteran)(?:-tier)?\s+Powers?/i,
  );
  if (chooseTier) {
    const numWords = { one: 1, two: 2, three: 3, four: 4 };
    const n = numWords[chooseTier[1].toLowerCase()] || parseInt(chooseTier[1], 10) || 1;
    const cat = SLOT_TIER_TO_CAT[chooseTier[2].toLowerCase()];
    if (cat) grants.push({ cat, n });
  }

  return { grants, highest };
}

function extractOptionsList(entity) {
  const text = entity.description || entity.desc || "";
  if (!text) return;
  // Look for "Choose one Craft: X, Y, or Z."
  let m = text.match(/Choose one Craft:\s*([^.]+)\./i);
  if (m) {
    const opts = m[1]
      .split(/,(?:\s*or\s+)?|\s+or\s+/i)
      .map((x) => x.trim())
      .filter(Boolean);
    entity.options = opts;
    return;
  }
  // Look for Specialty Tag options e.g. "Specialty Tag (ie: Artificer, Crafter, Mystic)"
  m = text.match(/Specialty Tag\s*\(i\.?e\.?:\s*([^)]+)\)/i);
  if (m) {
    const opts = m[1]
      .split(/,\s*/i)
      .map((x) => x.trim())
      .filter(Boolean);
    entity.options = opts;
    return;
  }
}

function extractSlotBestows(entity) {
  const { grants, highest } = slotBestowsFromText(entity.name, entity.description || entity.desc || "");
  if (grants.length) entity.slotBestows = grants;
  if (highest) entity.highestSlot = true;
  extractOptionsList(entity);
}

// ─── LEVEL-GATED BUILD-POINT DISCOUNTS (prose → structured) ────────────────────
// Some innate powers make a named skill cheaper once the character reaches a level
// in THE GRANTING CLASS (Ritual Affinity: Journeyman Ritual Magic −1 BP at class L7,
// Greater −1 BP at L12). The gate is the granting class's own level, so this can't
// live as a flat refs edge — it's emitted per-power here and applied per class in
// validate.js (mirroring slotBestows/statMods). Each entry: { skill, amount, atLevel }.
// Anchored on the doc's exact phrasing "…Nth level <Class>… for one fewer Build
// Point", which matches ONLY genuine level-gated discounts (not effect-scaling).
function extractLevelDiscounts(entity) {
  const text = entity.description || entity.desc || "";
  if (!/fewer\s+Build\s+Point/i.test(text)) return;
  const out = [];
  const re =
    /(?:once\s+(?:they|the\s+\w+)\s+(?:achieve|reach(?:es)?)\s+)?(\d+)(?:st|nd|rd|th)\s+level\s+\w+,?\s+(?:they\s+can\s+)?purchase\s+(.+?)\s+(?:skill\s+)?for\s+(\d+|one)\s+fewer\s+Build\s+Point/gi;
  let m;
  while ((m = re.exec(text))) {
    const amount = /^\d+$/.test(m[3]) ? parseInt(m[3], 10) : 1;
    out.push({ skill: m[2].trim(), amount, atLevel: parseInt(m[1], 10) });
  }
  if (out.length) entity.levelDiscounts = out;
}

// Run every per-entity mechanical extractor over an entity with a description.
function enrichMechanics(entity) {
  extractStatMods(entity);
  extractWealthIncome(entity);
  extractSlotBestows(entity);
  extractLevelDiscounts(entity);
  extractRequirement(entity);
  extractBestowedSelections(entity);
  extractManualParameterizations(entity);
}

// ─── MANUAL PARAMETERIZATIONS (For powers that need `options` arrays) ──────────
function extractManualParameterizations(entity) {
  if (entity.name === "Studied Focus") {
    entity.options = ["Artificer", "Crafter", "Mystic"];
  }
}

// ─── GRANTED SELECTIONS (Dynamic picks) ────────────────────────────────────────
function extractBestowedSelections(entity) {
  const text = entity.description || entity.desc;
  if (!text) return;
  const selections = [];

  // 1. Broad Study: "choose one Basic-Tier Power from any other non-Artisan Base Class"
  let m = text.match(/choose one (Basic|Advanced|Veteran)(?:-Tier)? Power from any other non-(\w+) Base Class/i);
  if (m) {
    selections.push({
      id: "broad_study_power",
      type: "power",
      tier: m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase(),
      source: "BaseClasses",
      excludeClass: m[2],
      bypassPrereqs: ["class", "level"],
    });
  }

  // 2. Arcane Secret: "choose one arcane spell at a rank they are capable of casting"
  m = text.match(/choose one (arcane|divine) spell at a rank they are capable of casting/i);
  if (m) {
    selections.push({
      id: "arcane_secret_spell",
      type: "spell",
      sphere: m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase(),
      maxTier: "HighestAccessible",
      bypassPrereqs: ["class"],
    });
  }

  // 3. Intervened: "learns one Cantrip from any basic Divine spellcasting class"
  m = text.match(/learns one Cantrip from any basic (Divine|Arcane) spellcasting class/i);
  if (m) {
    selections.push({
      id: "intervened_cantrip",
      type: "spell",
      tier: "Cantrip",
      sphere: m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase(),
      bypassPrereqs: ["class"],
    });
  }

  // 4. Intervened Accent: "choose one Devotion Accent"
  if (text.match(/choose one Devotion Accent/i)) {
    selections.push({
      id: "intervened_accent",
      type: "devotionAccent",
    });
  }

  if (selections.length > 0) {
    entity.bestowedSelections = selections;
  }
}

// ─── POWER REQUIREMENT (prose → structured) ────────────────────────────────────
// A power's `requirement` field is free text the validator used to re-parse on
// every call to gate availability — and it only handled "<Class> Level N", silently
// treating entity prerequisites ("Parry Blow", "The Right Hand") as level 0. Parse
// it ONCE here into:
//   entity.requiredLevel  — number (0 if none)
//   entity.requiredClass  — the class the level refers to (or null)
//   entity.requiresEntity — [names] of prerequisite powers/skills (or [])
// Grammar (comma-separated parts): "<Class> Level N", a bare entity name, or both.
const REQ_CLASS_LEVEL = /^(Artisan|Cleric|Druid|Fighter|Mage|Rogue|Socialite|Sourcerer)\s+Level\s+(\d+)/i;
function extractRequirement(entity) {
  const raw = entity.requirement;
  let requiredLevel = 0,
    requiredClass = null;
  const requiresEntity = [];
  if (raw) {
    for (let part of String(raw).split(",")) {
      part = part.trim();
      if (!part) continue;
      const m = part.match(REQ_CLASS_LEVEL);
      if (m) {
        // Take only the "<Class> Level N" head — guards against run-on capture like
        // "Artisan Level 4Skills and Options: …" where the field fused with prose.
        requiredLevel = parseInt(m[2], 10);
        requiredClass = m[1];
      } else {
        // A named prerequisite entity. Strip a trailing " skill" noise word.
        const nm = part.replace(/\s+skill$/i, "").trim();
        if (nm && !/^level\b/i.test(nm)) requiresEntity.push(nm);
      }
    }
  }

  // Implicit tier-based level requirements for class powers.
  if (!requiredLevel && entity.tier) {
    const t = entity.tier.toLowerCase();
    if (t === "adept" || t === "advanced") requiredLevel = 5;
    else if (t === "greater" || t === "veteran") requiredLevel = 7;
    else if (t === "novice" || t === "basic" || t === "utility" || t === "cantrip") requiredLevel = 1;
  }

  if (requiredLevel) {
    entity.requiredLevel = requiredLevel;
    entity.requiredClass = requiredClass;
  }
  if (requiresEntity.length) entity.requiresEntity = requiresEntity;
}

// Powers offering "choose one of the following: • … • …". Two flavors:
//   - BUILD-TIME permanent: "gains one of the following FOR FREE" (Expert Craft) —
//     a character-creation pick; each option names a skill granted free. Tagged
//     `chooseOne.kind:'build'` with `options[].bestowsSkill`.
//   - IN-PLAY tactical: "may choose one … (each Long Rest / per use / per cast)"
//     (Warrior Spirit, Kick, …) — the player picks at play time, not in the
//     builder. Tagged `kind:'play'`; options are display-only.
// Lead-in: "…one of (the following|three) <benefits|ways|boons|…>…:" then bullets.
const CHOOSE_LEAD = /\bone\s+of\s+(?:the\s+following|three|the)\b([^:]*):\s*(.+)$/i;
function extractChooseOne(power) {
  const d = power.description || "";
  const m = d.match(CHOOSE_LEAD);
  if (!m) return;
  // "(ie: …)" / "(e.g. …)" after the lead-in is an EXAMPLE, not the real option list
  // (Studied Focus: "Choose one of the following: (ie: Artificer, Crafter, Mystic)").
  // Parsing it yields garbage options — skip; such powers get their real options from
  // a dedicated extractor (extractManualParameterizations) instead.
  if (/^\s*\(\s*(?:ie|i\.e\.|e\.g\.|eg)\b/i.test(m[2])) return;
  // Options are the "• …" bullets after the lead-in
  let opts = [...m[2].matchAll(/•\s*([^•]+?)(?=\s*•|$)/g)].map((x) => x[1].trim()).filter(Boolean);

  // If no bullets, try inline comma-separated list (e.g. "Swords, Thrown Weapons, or Daggers.")
  if (opts.length === 0) {
    const inline = m[2].replace(/\.$/, ""); // strip trailing period
    opts = inline
      .split(/,(?:\s*or\s+)?|\s+or\s+/i)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  if (opts.length < 2) return;

  const build = /one of the following for free|gains? .*in one of the following/i.test(d);

  // Look for skills granted BEFORE the choice (e.g. "gains Two Weapon Style (2) and Weapon Specialization (4) in...")
  const prefixText = d.slice(0, m.index);
  const prefixSkills = [...prefixText.matchAll(/([A-Z][\w’' ]+?)\s*\(\d+\)/g)].map((x) => x[1].trim());

  power.chooseOne = {
    kind: build ? "build" : "play",
    options: opts.map((text) => {
      // Direct skill mention: "Greater Alchemy (5)"
      const sk = build && text.match(/^([A-Z][\w’' ]+?)\s*\(\d+\)/);
      if (sk) return { text, bestows: [sk[1].trim()] };

      // Parameterized skill mention from prefix
      if (build && prefixSkills.length > 0) {
        const bestows = prefixSkills.map((s) => {
          if (s.includes("Specialization") || s.includes("Focus") || s.includes("Expertise")) {
            return `${s} - ${text}`;
          }
          return s;
        });
        return { text, bestows };
      }

      return { text };
    }),
  };
}

const CLASSES_OUT = parseClasses();
for (const c of CLASSES_OUT) {
  for (const arr of Object.values(c)) {
    if (Array.isArray(arr))
      for (const p of arr)
        if (p && p.description) {
          extractPowerBenefits(p);
          extractChooseOne(p);
          enrichMechanics(p);
        }
  }
}
// Cross-class pass: a power offered by more than one class is the SAME shared power
// repeated in the doc. Tag each copy with sharedWith:[classes] so downstream code
// (entity index merge, guard test) can treat them as one ability. Only true power
// tiers count — multiclassBestows lists skill NAMES, not power entities.
{
  const POWER_TIERS = [
    "innate",
    "utility",
    "basic",
    "advanced",
    "veteran",
    "classSkills",
    "rightHandPowers",
    "cantrips",
    "noviceSpells",
    "adeptSpells",
    "greaterSpells",
  ];
  const offeredBy = {}; // power name -> Set(class names)
  for (const c of CLASSES_OUT)
    for (const t of POWER_TIERS)
      for (const p of c[t] || []) {
        if (p?.name) (offeredBy[p.name] ||= new Set()).add(c.name);
      }
  for (const c of CLASSES_OUT)
    for (const t of POWER_TIERS)
      for (const p of c[t] || []) {
        const classes = p?.name && offeredBy[p.name];
        if (classes && classes.size > 1) p.sharedWith = [...classes];
      }
}
// MANUAL PATCH: Way of the Blade (complex multi-skill chooseOne)
for (const cls of CLASSES_OUT) {
  if (cls.name === "Rogue" && cls.utility) {
    const wotb = cls.utility.find((p) => p.name === "Way of the Blade");
    if (wotb) {
      wotb.chooseOne = {
        kind: "build",
        options: [
          { text: "Swords", bestows: ["Weapon Specialization - Swords", "Two Weapon Style"] },
          { text: "Thrown Weapons", bestows: ["Weapon Specialization - Thrown Weapons", "Two Weapon Style"] },
          { text: "Daggers", bestows: ["Weapon Specialization - Daggers", "Two Weapon Style"] },
        ],
      };
    }
  }
}

write("classes.json", CLASSES_OUT);

// ─── SKILLS ───────────────────────────────────────────────────────────────────
// H1: "Base Skills, Perks, and Flaws" → H1: "Skills" → H2: "Skill Descriptions"
// Skills are H4 entries; category is the nearest H3 ancestor.

console.log("\nParsing skills...");

function parseSkills() {
  const skillsH1 = findHeading("Skills", 1);
  const descH2 = findHeading("Skill Descriptions", 2, skillsH1);
  const descEnd = nextHeadingAtOrAbove(1, descH2);
  const end = descEnd === -1 ? nodes.length : descEnd;

  const skills = [];
  let currentCat = "Martial";
  let i = descH2 + 1;

  while (i < end) {
    const n = nodes[i];
    if (n.type === "heading" && n.level === 3) {
      // H3 = category (e.g. "Martial Skills")
      currentCat = n.text.replace(/\s+Skills$/, "");
      i++;
      continue;
    }
    if (n.type === "heading" && n.level === 4) {
      // H4 = skill entry. The heading text may carry annotations that are
      // structural metadata, not part of the canonical name:
      //   "(N)"          — finite max ranks  (parsed as numeric ranks)
      //   "(Unlimited)"  — explicitly no rank cap (parsed as 'unlimited' sentinel)
      //   "[Placeholder]"— parameter slot the player fills in (e.g.
      //                    "Lore [Area of Lore]" → parameter "Area of Lore",
      //                    canonical name "Lore"). The linker uses this so
      //                    "Lore (Religious)" prose matches the entity.
      // All three suffixes are stripped from the name as we parse them.
      const raw = n.text;
      const ranksMatch = raw.match(/\((\d+|Unlimited)\)\s*$/i);
      const paramMatch = raw.match(/\s\[([^\]]+)\]/);
      const name = raw
        .replace(/\s*\((?:\d+|Unlimited)\)\s*$/i, "")
        .replace(/\s\[[^\]]+\]/, "")
        .trim();
      const parsedRanks = !ranksMatch ? null : /unlimited/i.test(ranksMatch[1]) ? "unlimited" : parseInt(ranksMatch[1]);
      const parameter = paramMatch ? paramMatch[1].trim() : null;

      // Collect text nodes until next H3/H4
      const bodyEnd = nodes.findIndex((m, j) => j > i && m.type === "heading" && m.level <= 4);
      const bodyNodes = nodes.slice(i + 1, bodyEnd === -1 ? end : Math.min(bodyEnd, end));

      let cost = null,
        prereq = null,
        ranks = parsedRanks;
      const descParts = [];

      for (const bn of bodyNodes) {
        // Flatten <ul> list nodes into bullet lines so a skill's trailing list
        // (Bowmaster's "additional effects by aiming: • …") isn't dropped.
        if (bn.type === "list") {
          for (const it of bn.items) descParts.push(`• ${it}`);
          continue;
        }
        if (bn.type !== "text") continue;
        const t = bn.text;
        const cm = t.match(/^Cost:\s*(\d+)/);
        if (cm) {
          cost = parseInt(cm[1]);
          continue;
        }
        const pm = t.match(/^Prerequisites?:\s*(.+)/);
        if (pm) {
          prereq = pm[1].trim();
          continue;
        }
        const rm = t.match(/^Ranks?:\s*(\d+)/);
        if (rm) {
          ranks = parseInt(rm[1]);
          continue;
        }
        descParts.push(t);
      }

      if (cost !== null) {
        const description = descParts.join(" ");
        const entry = { name, cost, prereq, ranks, category: currentCat, description };
        // Parameter: either an explicit "[Placeholder]" in the name, OR — for skills
        // whose body says the player picks something — derived from that prose. The
        // Extended Capacity skills read "The character chooses one Sphere of magic",
        // so they carry a Sphere parameter even though the name has no bracket. This
        // keeps the parameter DERIVED (was a manual post-parse patch, PR #116).
        const derivedParam = !parameter && /\bchooses?\s+one\s+Sphere\b/i.test(description) ? "Sphere" : null;
        const finalParam = parameter || derivedParam;
        if (finalParam) entry.parameter = finalParam;
        skills.push(entry);
      }
      i = bodyEnd === -1 ? end : Math.min(bodyEnd, end);
    } else {
      i++;
    }
  }
  return skills;
}

// Enrich a flat entity list (skills/perks/flaws) with parsed stat mods, in place.
const withMechanics = (list) => {
  for (const e of list) enrichMechanics(e);
  return list;
};

const SKILLS_OUT = withMechanics(parseSkills());

// MANUAL PATCH: Armor Points (missing statMods extraction)

write("skills.json", SKILLS_OUT);

// ─── PERKS & FLAWS ────────────────────────────────────────────────────────────
// Under "Character Options" H1. Perks/Flaws are H3 entries with Cost/Award, Ranks,
// Prerequisites, Description as text nodes. Category is the H2 ancestor.

console.log("\nParsing perks & flaws...");

function parsePerkFlaw(h1Text, valueKey) {
  const h1 = findHeading(h1Text, null);
  if (h1 === -1) return [];
  const h1End = nextHeadingAtOrAbove(nodes[h1].level, h1);
  const end = h1End === -1 ? nodes.length : h1End;

  const results = [];
  let currentCat = "";
  let i = h1 + 1;

  while (i < end) {
    const n = nodes[i];
    if (n.type === "heading" && n.level === 2) {
      currentCat = n.text.replace(/\s+(Perks|Flaws)$/, "");
      i++;
      continue;
    }
    if (n.type === "heading" && n.level === 3) {
      const name = n.text;
      const bodyEnd = nodes.findIndex((m, j) => j > i && m.type === "heading" && m.level <= 3);
      const bodyNodes = nodes.slice(i + 1, bodyEnd === -1 ? end : Math.min(bodyEnd, end));

      let value = null,
        ranks = null,
        prereq = null;
      const descParts = [];

      for (const bn of bodyNodes) {
        if (bn.type !== "text") continue;
        const t = bn.text;
        const cm = t.match(/^(?:Cost|Award):\s*(.+)/i);
        if (cm) {
          const v = cm[1].trim();
          value = /^\d+$/.test(v) ? parseInt(v) : v;
          continue;
        }
        const rm = t.match(/^Ranks?:\s*(\d+)/i);
        if (rm) {
          ranks = parseInt(rm[1]);
          continue;
        }
        const pm = t.match(/^(?:Pre-?requisites?|Prerequisites?):\s*(.+)/i);
        if (pm) {
          prereq = pm[1].trim();
          continue;
        }
        descParts.push(t);
      }

      if (value !== null) {
        results.push({
          name,
          [valueKey]: value,
          ranks,
          prereq,
          category: currentCat,
          description: descParts.join(" "),
        });
      }
      i = bodyEnd === -1 ? end : Math.min(bodyEnd, end);
    } else {
      i++;
    }
  }
  return results;
}

// Perks and Flaws are both under "Character Options" as H2 sections.
const charOptionsH1 = findHeading("Character Options", 1);
const charOptionsEnd = nextHeadingAtOrAbove(1, charOptionsH1);

function parsePerkFlawSection(sectionName, valueKey) {
  const h2 = nodes.findIndex(
    (n, i) =>
      i > charOptionsH1 &&
      i < charOptionsEnd &&
      n.type === "heading" &&
      n.level === 2 &&
      new RegExp(sectionName, "i").test(n.text),
  );
  if (h2 === -1) return [];
  const secEnd = nodes.findIndex((n, i) => i > h2 && n.type === "heading" && n.level <= 2);
  const end = secEnd === -1 ? charOptionsEnd : Math.min(secEnd, charOptionsEnd);

  const results = [];
  let currentCat = "";
  let i = h2 + 1;

  while (i < end) {
    const n = nodes[i];
    if (n.type === "heading" && n.level === 3) {
      currentCat = n.text.replace(/\s+(Perks|Flaws)$/, "");
      i++;
      continue;
    }
    if (n.type === "heading" && n.level === 4) {
      const name = n.text;
      const bodyEnd = nodes.findIndex((m, j) => j > i && m.type === "heading" && m.level <= 4);
      const bodyNodes = nodes.slice(i + 1, bodyEnd === -1 ? end : Math.min(bodyEnd, end));

      let value = null,
        ranks = null,
        prereq = null;
      const descParts = [];

      for (const bn of bodyNodes) {
        if (bn.type !== "text") continue;
        const t = bn.text;
        const cm = t.match(/^(?:Cost|Award):\s*(.+)/i);
        if (cm) {
          const v = cm[1].trim();
          value = /^\d+$/.test(v) ? parseInt(v) : v;
          continue;
        }
        const rm = t.match(/^Ranks?:\s*(\d+)/i);
        if (rm) {
          ranks = parseInt(rm[1]);
          continue;
        }
        const pm = t.match(/^(?:Pre-?requisites?|Prerequisites?):\s*(.+)/i);
        if (pm) {
          prereq = pm[1].trim();
          continue;
        }
        descParts.push(t);
      }

      if (value !== null) {
        results.push({
          name,
          [valueKey]: value,
          ranks,
          prereq,
          category: currentCat,
          description: descParts.join(" "),
        });
      }
      i = bodyEnd === -1 ? end : Math.min(bodyEnd, end);
    } else {
      i++;
    }
  }
  return results;
}

// Perks and Flaws each have a "Perks List" / "Flaws List" H2 under Character Options.
// They are real tables: 5 columns (Name, Cost/Award, Ranks, Prerequisites, Description),
// one `'cell'` node per column, terminated by a `'rowEnd'` marker per row. Header rows
// ("Name","Cost",…) are skipped. H3 headings between sub-tables set the category.
const PERK_HEADER = /^(Name|Cost|Award|Ranks?|Pre-?requisites?|Prerequisites?|Description)$/i;

function parsePerkFlawList(listH2Text, valueKey) {
  const h2 = nodes.findIndex(
    (n, i) => i > charOptionsH1 && i < charOptionsEnd && n.type === "heading" && n.level === 2 && n.text === listH2Text,
  );
  if (h2 === -1) return [];
  const secEnd = nodes.findIndex((n, i) => i > h2 && n.type === "heading" && n.level <= 2);
  const end = secEnd === -1 ? charOptionsEnd : Math.min(secEnd, charOptionsEnd);

  const results = [];
  let currentCat = "";
  let cells = [];

  const flushRow = () => {
    // A data row has a name + at least a value, and isn't the header row.
    if (cells.length >= 2 && cells[0] && !PERK_HEADER.test(cells[0])) {
      const rawVal = cells[1];
      const value = /^\d+$/.test(rawVal) ? parseInt(rawVal) : rawVal;
      results.push({
        name: cells[0],
        [valueKey]: value,
        ranks: cells[2] && cells[2] !== "-" ? parseInt(cells[2]) || null : null,
        prereq: cells[3] && cells[3] !== "-" ? cells[3] : null,
        category: currentCat,
        description: cells[4] || "",
      });
    }
    cells = [];
  };

  for (let i = h2 + 1; i < end; i++) {
    const n = nodes[i];
    if (n.type === "heading" && n.level === 3) {
      flushRow();
      currentCat = n.text.replace(/\s+(Perks|Flaws)$/, "");
    } else if (n.type === "heading" && n.level <= 2) {
      break;
    } else if (n.type === "rowEnd") {
      flushRow();
    } else if (n.type === "cell") {
      cells.push(n.text);
    }
  }
  flushRow();
  return results.filter((r) => r.name && !PERK_HEADER.test(r.name));
}

// Some perks carry their authoritative rules in a DETAIL sub-section (an H4 whose
// text matches the perk name) rather than the summary table cell — e.g. "Patron"
// has a thin cell ("Gains a personal divine patron.") but an H4 "Patron" detail
// paragraph states the real discount mechanic ("…costs 1 BP less … maximum of 10
// BP in discounts … Strong Bloodline and Inheritance … cannot be discounted").
// The linker parses consequences (grants/discounts) from the description, so fold
// any such detail prose into the matching perk's description. Scoped to Character
// Options H4s, matched by exact name, appended only when it adds new text.
function enrichWithDetailSections(results) {
  const byName = new Map(results.map((r) => [r.name, r]));
  for (let i = charOptionsH1 + 1; i < charOptionsEnd; i++) {
    const n = nodes[i];
    if (!(n.type === "heading" && n.level === 4)) continue;
    const cleanHeading = n.text.replace(/\s*\(\d+\)\s*$/, "").trim();
    const target = byName.get(cleanHeading);
    if (!target) continue;
    const secEnd = nodes.findIndex((m, j) => j > i && m.type === "heading" && m.level <= 4);
    // Gather text + table cells + list items: preserve paragraphs by joining with \n\n.
    // Detect list items in disguise (like "Cloth - 2 BP") and format them with bullets.
    const prose = nodes
      .slice(i + 1, secEnd === -1 ? charOptionsEnd : secEnd)
      .map((m) => {
        if (m.type === "list") {
          return m.items.map((item) => `• ${item}`).join("\n");
        }
        if (m.type === "text" || m.type === "cell") {
          const t = m.text.trim();
          // Detect pseudo-lists to render as bullet points
          if (/^.+?\s*-\s*\d+\s*BP$/i.test(t)) {
            return `• ${t}`;
          }
          return t;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n\n")
      .trim();
    // Append only the parts not already in the (summary) description, so we don't
    // duplicate the cell text the detail section may restate.
    if (prose && !target.description.includes(prose)) {
      target.description = target.description ? `${target.description}\n\n${prose}`.trim() : prose;
    }
  }
  return results;
}

// A few perks are TIERED: their detail prose carries a "Cost / Character Level /
// Ability" table where each row is one purchasable tier (e.g. Draconic Heritage:
// 2/2, 3/5, 4/10, 5/15). Each tier costs its own (non-uniform) BP, is gated on a
// character level, and requires all previous tiers. Parse that table into a
// structured `tiers: [{ cost, level, ability }]` so the validator can price
// cumulatively and gate per tier, instead of the flat rank×cost model.
function extractTiers(results) {
  // Table tail begins after the "Cost Character Level Ability" header; rows are
  // "<cost> <level> <ability…>" until the next "<num> <num>" row or end.
  const HEADER = /Cost\s+Character\s+Level\s+Ability\s+/i;
  const ROW = /(\d+)\s+(\d+)\s+(.+?)(?=\s+\d+\s+\d+\s|$)/gs;
  for (const r of results) {
    // Try generic table idiom first: "Cost" followed by headers, then rows of values
    if (r.description) {
      const lines = r.description
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean);
      const costIdx = lines.indexOf("Cost");
      if (costIdx !== -1) {
        let firstDigitIdx = -1;
        for (let i = costIdx + 1; i < lines.length; i++) {
          if (/^\d+$/.test(lines[i])) {
            firstDigitIdx = i;
            break;
          }
        }
        if (firstDigitIdx !== -1) {
          const numColumns = firstDigitIdx - costIdx;
          if (numColumns >= 2 && numColumns <= 4) {
            const headers = lines.slice(costIdx, firstDigitIdx);

            // Standard tiered tables (Cost, Character Level, Ability) are NOT cumulative
            // and should be handled by the legacy dedicated parser below.
            if (!headers.some((h) => /Character\s+Level/i.test(h))) {
              const keys = headers.map((h) => {
                const k = h
                  .replace(/(?:^\w|[A-Z]|\b\w)/g, (w, i) => (i === 0 ? w.toLowerCase() : w.toUpperCase()))
                  .replace(/[^a-zA-Z0-9]/g, "");
                return k === "byMyVoiceDmg" ? "byMyVoiceDmg" : k;
              });
              const tiers = [];
              let prevCost = 0;
              let i = firstDigitIdx;
              for (; i < lines.length; i += numColumns) {
                if (!/^\d+$/.test(lines[i])) break; // end of table
                const tier = {};
                const cumulativeCost = parseInt(lines[i], 10);
                tier[keys[0]] = cumulativeCost - prevCost;
                prevCost = cumulativeCost;
                for (let j = 1; j < numColumns; j++) {
                  let val = lines[i + j];
                  if (val === "-" || val === undefined) continue;
                  if (/^\d+$/.test(val)) val = parseInt(val, 10);
                  tier[keys[j]] = val;
                }
                tiers.push(tier);
              }
              if (tiers.length > 0) {
                // Only override if we actually got rows
                r.tiers = tiers;
                r.cost = tiers[0].cost;
                r.ranks = tiers.length;
                continue;
              }
            } // Close if (!headers.some(...))
          }
        }
      }
    }

    const m = r.description && r.description.match(HEADER);
    if (!m) continue;
    const tail = r.description.slice(m.index + m[0].length);
    const tiers = [];
    let row;
    ROW.lastIndex = 0;
    while ((row = ROW.exec(tail))) {
      tiers.push({ cost: +row[1], level: +row[2], ability: row[3].trim() });
    }
    if (tiers.length > 1) {
      r.tiers = tiers;
      // The base `cost` is tier 1's cost (the flat field still reflects entry price).
      r.cost = tiers[0].cost;
      // Multi-tier perks implicitly support ranking up to the number of tiers available.
      r.ranks = tiers.length;
    }
  }
  return results;
}

// Mild/Severe Allergy award a VARIABLE BP amount ("Award: 1 or 2" / "2 or 3")
// that depends on the chosen substance. The rulebook embeds a "Standard Allergens
// and Awards" table in the detail prose (one "• <substance> - <n> BP" row each).
// Parse it into a structured `allergens: { <substance>: <bp> }` map so the engine
// reads a typed field instead of re-scraping prose at runtime. A MegaDoc edit to
// the table (new allergen / changed award) flows through on the next parse.
function extractAllergens(results) {
  for (const r of results) {
    const m = (r.description || "").match(/Standard Allergens and Awards:\s*(.+)$/s);
    if (!m) continue;
    const allergens = {};
    for (const row of m[1].matchAll(/•\s*([^-•\n]+?)\s*-\s*(\d+)\s*BP/g)) {
      allergens[row[1].trim()] = parseInt(row[2], 10);
    }
    if (Object.keys(allergens).length) r.allergens = allergens;
  }
  return results;
}

write("perks.json", withMechanics(extractTiers(enrichWithDetailSections(parsePerkFlawList("Perks List", "cost")))));
write("flaws.json", withMechanics(extractAllergens(enrichWithDetailSections(parsePerkFlawList("Flaws List", "bp")))));

// ─── DEVOTIONS ────────────────────────────────────────────────────────────────
// Each devotion is an H1. Content is text nodes with bullet lists for tenets.

console.log("\nParsing devotions...");

// The Divine Domains section opens with a table mapping each Devotion to its
// divine domains: header "God|Devotion | Locality | Domain 1 … Domain 4", then a
// row per devotion. The Google Docs export nests <p> inside each <td>, so cells
// arrive as TEXT nodes and EMPTY cells are dropped — rows are variable length.
// We can't split by a fixed column count, so we split on devotion-name
// boundaries: each known devotion name begins a row, the next token is its
// locality, and the remaining tokens (until the next devotion name) are domains.
// `devNames` is the set of canonical devotion names (base, before any comma).
const normDevName = (s) => s.toLowerCase().replace(/[^a-z]/g, "");
function parseDevotionDomains(devNames) {
  const known = new Set(devNames.map(normDevName));
  // The devotion→domain mapping is a real table. Locate its header cell ("God" or
  // "Devotion") and read the cells that follow, split into rows by 'rowEnd'. Each
  // data row is [Name, Locality, Domain, Domain, …].
  const hdr = nodes.findIndex((n) => n.type === "cell" && /^(God|Devotion)$/i.test(n.text));
  if (hdr === -1) return {};
  const rows = [];
  let cur = [];
  for (let j = hdr; j < nodes.length; j++) {
    const n = nodes[j];
    if (n.type === "rowEnd") {
      if (cur.length) rows.push(cur);
      cur = [];
      continue;
    }
    if (n.type !== "cell") {
      // Leaving the table (a heading or the trailing note ends it).
      if (n.type === "heading" || /^See the Devotions/i.test(n.text || "")) break;
      continue;
    }
    cur.push(n.text.trim());
  }
  if (cur.length) rows.push(cur);

  const map = {};
  for (const cells of rows) {
    const [name, locality, ...domains] = cells.filter(Boolean);
    if (!name || !known.has(normDevName(name))) continue; // skip header / stray rows
    map[normDevName(name)] = { name, locality: locality || null, domains: domains.filter(Boolean) };
  }
  return map;
}

function parseDevotions() {
  const divDomainsIdx = findHeading("Divine Domains", 1);

  // Collect all H1s between "Devotions & Divine Beings" and "Divine Domains"
  const devotionsStart = findHeading("Devotions & Divine Beings", 1);
  // First pass: gather the devotion names so the domain-table splitter knows the
  // row boundaries.
  const names = [];
  for (let j = devotionsStart + 1; j < divDomainsIdx; j++) {
    const n = nodes[j];
    if (n.type === "heading" && n.level === 1 && n.text) names.push(n.text.split(",")[0]);
  }
  const domainMap = parseDevotionDomains(names);
  const results = [];

  let i = devotionsStart + 1;
  while (i < divDomainsIdx) {
    const n = nodes[i];
    if (n.type !== "heading" || n.level !== 1 || !n.text) {
      i++;
      continue;
    }

    const name = n.text;
    const devEnd = nodes.findIndex((m, j) => j > i && m.type === "heading" && m.level === 1);
    const end = devEnd === -1 ? divDomainsIdx : Math.min(devEnd, divDomainsIdx);

    const bodyNodes = nodes.slice(i + 1, end);
    const tenets = [];
    const loreParts = [];
    let colorScheme = "",
      iconography = "";

    for (const bn of bodyNodes) {
      if (bn.type === "list") {
        tenets.push(...bn.items);
        continue;
      }
      if (bn.type !== "text") continue;
      const t = bn.text;
      const cs = t.match(/^Devotion Color Scheme:\s*(.+)/i);
      if (cs) {
        colorScheme = cs[1].trim();
        continue;
      }
      const ic = t.match(/^Common Iconography:\s*(.+)/i);
      if (ic) {
        iconography = ic[1].trim();
        continue;
      }
      if (
        /^(Example Sigil:|The Truth|Truths|Divine Truths|Divine Demands|Guiding Principles|Guiding Beliefs|Laws|Lessons|Edicts|Codex|Church Principles):/.test(
          t,
        )
      )
        continue;
      loreParts.push(t);
    }

    // Match this devotion to its row in the domain table by base name (the table
    // uses short names like "Senri"; the H1 may be "Senri, Voice of Mercy").
    const base = name.split(",")[0];
    const dm = domainMap[normDevName(base)] || domainMap[normDevName(name)] || {};
    results.push({
      name,
      epithet: "",
      lore: loreParts.join(" "),
      tenets,
      colorScheme,
      iconography,
      domains: dm.domains || [],
      locality: dm.locality || "",
    });
    i = end;
  }
  return results;
}

write("devotions.json", parseDevotions());

// ─── DIVINE DOMAINS ───────────────────────────────────────────────────────────
// H1: "Divine Domains" → H2s for each domain. Powers are H3 entries "Name - N BP".

console.log("\nParsing divine domains...");

// Opposed-domain pairs, from the "Opposed Domains:" table the Jun 26 MegaDoc added
// under the Divine Substitution power (Chaos↔Order, Death↔Life, …). Symmetric:
// returns { Chaos: 'Order', Order: 'Chaos', … }. Used to enforce Divine
// Substitution's "may not take a domain in direct opposition" rule — this data was
// previously absent (it pointed to an external doc), blocking that mechanic.
function parseOpposedDomains() {
  const opp = {};
  // The label sits in a text/cell node; the pairs follow as two-cell rows. Find it.
  const labelIdx = nodes.findIndex(
    (n) => (n.type === "text" || n.type === "cell") && /Opposed Domains:/i.test(n.text || ""),
  );
  if (labelIdx === -1) return opp;
  // Collect cell nodes after the label until a clear break (a heading); pair them up.
  const cells = [];
  for (let i = labelIdx; i < nodes.length && cells.length < 16; i++) {
    const n = nodes[i];
    if (n.type === "heading" && i > labelIdx) break;
    if (n.type === "cell") cells.push(n.text.replace(/Opposed Domains:\s*/i, "").trim());
  }
  const known = new Set([
    "Chaos",
    "Order",
    "Creation",
    "Destruction",
    "Expression",
    "Manipulation",
    "Life",
    "Death",
    "Light",
    "Shadow",
    "Peace",
    "War",
    "Energy",
    "Knowledge",
    "Nature",
    "Protection",
  ]);
  const clean = cells.filter((c) => known.has(c));
  for (let i = 0; i + 1 < clean.length; i += 2) {
    opp[clean[i]] = clean[i + 1];
    opp[clean[i + 1]] = clean[i]; // symmetric
  }
  return opp;
}

function parseDivineDomains() {
  const start = findHeading("Divine Domains", 1);
  const end = findHeading("Wellspring Economy Overview", 1, start);
  const opposed = parseOpposedDomains();

  const tree = buildTreeFromRange(start, end);
  const h1Node = tree.children.find((c) => c.type === "heading" && c.level === 1);
  if (!h1Node) return [];

  const accents = {};
  const accH2 = h1Node.children.find((c) => c.type === "heading" && c.level === 2 && c.text === "Devotion Accents");
  if (accH2) {
    const cells = accH2.children.filter((n) => n.type === "cell").map((n) => n.text);
    for (let i = 0; i + 1 < cells.length; i += 2) accents[cells[i]] = cells[i + 1];
  }

  const domains = [];

  for (const n of h1Node.children) {
    if (n.type !== "heading" || n.level !== 2 || !n.text || n.text === "Devotion Accents") continue;

    const rawName = n.text;
    const name = rawName.replace(/^Energy:.*$/, "Energy").trim();

    const DOMAIN_PWR = /-\s*\d+\s*BP\s*$/i;
    const isPwr = (x) =>
      (x.type === "heading" && x.level <= 4 && DOMAIN_PWR.test(x.text)) ||
      (x.type === "text" && DOMAIN_PWR.test(x.text) && x.text.length < 100);

    const powers = [];
    let j = 0;
    while (j < n.children.length) {
      const m = n.children[j];
      if (isPwr(m)) {
        const isHeading = m.type === "heading";
        let bodyNodes;
        let nextIndex;

        if (isHeading) {
          bodyNodes = m.children.filter((x) => x.type === "text" || x.type === "list");
          nextIndex = j + 1; // Since it's a heading, its body is inside its children array!
        } else {
          const pwrEnd = n.children.findIndex((x, k) => k > j && ((x.type === "heading" && x.level <= 2) || isPwr(x)));
          nextIndex = pwrEnd === -1 ? n.children.length : pwrEnd;
          bodyNodes = n.children.slice(j + 1, nextIndex).filter((x) => x.type === "text" || x.type === "list");
        }

        const header = m.text;
        const tierMatch = header.match(/\[(\w+)\]/);
        const costMatch = header.match(/-\s*(\d+)\s*BP\s*$/);
        const pwrName = header
          .replace(/\[\w+\]/, "")
          .replace(/-\s*\d+\s*BP\s*$/, "")
          .trim();

        const { fields, description } = parsePowerNodes(bodyNodes);

        powers.push({
          name: pwrName,
          type: "power",
          tier: tierMatch ? tierMatch[1] : null,
          cost: costMatch ? parseInt(costMatch[1]) : null,
          incantation: fields["incantation"] ?? null,
          call: fields["call"] ?? null,
          target: fields["target"] ?? null,
          duration: fields["duration"] ?? null,
          delivery: fields["delivery"] ?? null,
          refresh: fields["refresh"] ?? null,
          accent: fields["accent"] ?? null,
          effect: fields["effect"] ?? null,
          prerequisites: fields["prerequisite"] ?? fields["prerequisites"] ?? null,
          description,
        });

        j = nextIndex;
      } else {
        j++;
      }
    }

    domains.push({
      name,
      label: rawName,
      accent: accents[name] ?? accents[rawName] ?? null,
      opposedBy: opposed[name] ?? null,
      powers,
    });
  }

  return domains;
}

write("domains.json", parseDivineDomains());

// ─── LINEAGES ─────────────────────────────────────────────────────────────────
// Each lineage is an H1. Challenges and Advantages are H2s; sub-lineages are H3s;
// individual items are H4s.

console.log("\nParsing lineages...");

// Extract the structured costuming requirement from a lineage description's
// "Costuming Challenge: <difficulty> - <text>" sentence. Returns
// { difficulty, minRepped, mustInclude, mustIncludeIf, text } or null. The UI
// (costumeStatus + the budget-bar chip) reads minRepped/mustInclude live.
function parseCostume(description) {
  const m = (description || "").match(/Costuming Challenge:\s*(Easy|Medium|Hard)\s*[-–—]\s*([^]*?\.(?:\s*[^.]*\.)?)/i);
  if (!m) return null;
  const difficulty = m[1];
  const text = m[2].replace(/\s+/g, " ").trim();
  // "at least N [Repped]" → minimum; "do not require any" → 0.
  const numM = text.match(/at least (\d+)\s*\[?Repped/i);
  const minRepped = numM ? parseInt(numM[1], 10) : 0;
  // "one of which must be X" (unconditional) or "If <cond>, one … must be X".
  let mustInclude = null,
    mustIncludeIf = null;
  const condM = text.match(/If the character is ([^,]+),\s*one of these Challenges must be ([^.(]+)/i);
  const uncondM = text.match(/one of which must be ([^.(]+)/i);
  if (condM) {
    mustIncludeIf = condM[1].trim();
    mustInclude = condM[2].trim();
  } else if (uncondM) {
    mustInclude = uncondM[1].trim();
  }
  return { difficulty, minRepped, mustInclude, mustIncludeIf, text };
}

function parseLineages() {
  const start = findHeading("Lineages (All)", 1);
  const end = findHeading("Base Skills, Perks, and Flaws", 1, start);

  const lineages = [];
  let i = start + 1;

  while (i < end) {
    const n = nodes[i];
    if (n.type !== "heading" || n.level !== 1 || !n.text) {
      i++;
      continue;
    }

    const name = n.text;
    const linEnd = nodes.findIndex((m, j) => j > i && m.type === "heading" && m.level === 1);
    const lEnd = linEnd === -1 ? end : Math.min(linEnd, end);

    // Description: text under H2 "Description" before any H3
    const descH2 = nodes.findIndex(
      (m, j) => j > i && j < lEnd && m.type === "heading" && m.level === 2 && m.text === "Description",
    );
    const descEnd = descH2 === -1 ? i : nodes.findIndex((m, j) => j > descH2 && m.type === "heading" && m.level <= 2);
    const description = descH2 === -1 ? "" : textBetween(descH2 + 1, descEnd === -1 ? lEnd : Math.min(descEnd, lEnd));

    // Parse challenges/advantages from an H2 section.
    // Each entry is a single text node: "Name [Tag] [Tag] (Cost): Description"
    // Sublineage groups are H3 headings under the H2.
    const ITEM_LINE = /^(.+?)((?:\s*\[[^\]]+\])*)\s*\((\d+|Variable)\)\s*[:\-]\s*(.+)$/;
    const parseItems = (sectionName) => {
      const h2 = nodes.findIndex(
        (m, j) => j > i && j < lEnd && m.type === "heading" && m.level === 2 && m.text === sectionName,
      );
      if (h2 === -1) return [];
      const secEnd = nodes.findIndex((m, j) => j > h2 && m.type === "heading" && m.level <= 2);
      const sEnd = secEnd === -1 ? lEnd : Math.min(secEnd, lEnd);
      const items = [];
      let currentGroup = "General";
      for (let j = h2 + 1; j < sEnd; j++) {
        const m = nodes[j];
        if (m.type === "heading" && m.level === 3) {
          currentGroup = m.text;
          continue;
        }
        if (m.type !== "text") continue;
        const lm = m.text.match(ITEM_LINE);
        if (!lm) continue;
        const [, rawName, tagsStr, costStr, desc] = lm;
        const tags = [...tagsStr.matchAll(/\[([^\]]+)\]/g)].map((t) => t[1]);
        const required = tags.some((t) => /^required$/i.test(t));
        const repped = tags.some((t) => /^repped$/i.test(t));
        const lbp = costStr === "Variable" ? null : parseInt(costStr);
        let fullDesc = desc.trim();
        let k = j + 1;
        while (k < sEnd) {
          const nxt = nodes[k];
          if (nxt.type === "heading" && nxt.level <= 3) break;
          if (nxt.type === "text" && ITEM_LINE.test(nxt.text)) break;
          if (nxt.text) {
            let txt = nxt.text.trim();
            // Inject newlines before standard power fields to fix squashed text nodes
            txt = txt.replace(/(Call:|Target:|Delivery:|Accent:|Duration:|Refresh:|Effect:)/g, "\n$1");
            // Clean up missing space before Call if it got squashed
            txt = txt.replace(/\]Call:/g, "]\nCall:");
            // Remove huge blocks of spaces (like between Self and Duration)
            txt = txt.replace(/ {5,}/g, " ");
            fullDesc += "\n\n" + txt;
          }
          k++;
        }
        j = k - 1;

        items.push({
          name: rawName.trim(),
          lbp,
          required,
          repped,
          tags: tags.filter((t) => !/^(required|repped)$/i.test(t)),
          sublineage: currentGroup,
          description: fullDesc,
        });
      }
      return items;
    };

    const challenges = parseItems("Challenges");
    const advantages = parseItems("Advantages");
    // Enrich BOTH — challenges can carry permanent stat penalties too (e.g. Lost's
    // Fragile Form: "1 fewer maximum Life Point"), not just advantages.
    for (const it of [...challenges, ...advantages]) enrichMechanics(it);

    // Derive sub-lineages from distinct non-General groups
    const byName = new Map();
    for (const it of [...challenges, ...advantages]) {
      if (it.sublineage === "General") continue;
      const m = it.sublineage.match(/^([^(]+?)(?:\s*\((.+)\))?$/);
      const sub = { name: (m ? m[1] : it.sublineage).trim(), note: m?.[2]?.trim() ?? "" };
      if (!byName.has(sub.name) || (!byName.get(sub.name).note && sub.note)) byName.set(sub.name, sub);
    }

    lineages.push({
      name,
      description,
      costume: parseCostume(description),
      sublineages: [...byName.values()],
      challenges,
      advantages,
    });
    i = lEnd;
  }
  return lineages;
}

write("lineages.json", parseLineages());

// ─── LEVEL TABLE ──────────────────────────────────────────────────────────────

console.log("\nParsing level table...");

function parseLevelTable() {
  // Under "Advancement" H1 → "Level Progression Table" H2
  const advH1 = findHeading("Advancement", 1);
  const tableH = nodes.findIndex(
    (n, i) => i > advH1 && n.type === "heading" && n.level === 2 && n.text === "Level Progression Table",
  );
  if (tableH === -1) return [];
  const tableEnd = nodes.findIndex((n, i) => i > tableH && n.type === "heading" && n.level <= 2);
  // Real table: read the cell values (5 numeric columns per row).
  const cells = nodes
    .slice(tableH + 1, tableEnd === -1 ? nodes.length : tableEnd)
    .filter((n) => n.type === "cell")
    .map((n) => n.text);

  const HEADER = /^(Character Level|Total XP|Base BP|LP|Spikes|Level|XP|BP)$/i;
  const nums = cells.filter((v) => /^\d+$/.test(v) && !HEADER.test(v)).map(Number);
  const rows = [];
  for (let i = 0; i + 4 < nums.length; i += 5) {
    rows.push({ level: nums[i], xp: nums[i + 1], bp: nums[i + 2], lp: nums[i + 3], spikes: nums[i + 4] });
  }
  return rows;
}

write("level-table.json", parseLevelTable());

console.log("\nParsing events table...");

function parseEventsTable() {
  // Under "Advancement" H1 → "Level Floor" H2
  const advH1 = findHeading("Advancement", 1);
  const tableH = nodes.findIndex(
    (n, i) => i > advH1 && n.type === "heading" && n.level === 2 && n.text === "Level Floor",
  );
  if (tableH === -1) return [];
  const tableEnd = nodes.findIndex((n, i) => i > tableH && n.type === "heading" && n.level <= 2);
  const cells = nodes
    .slice(tableH + 1, tableEnd === -1 ? nodes.length : tableEnd)
    .filter((n) => n.type === "cell")
    .map((n) => n.text);

  const HEADER = /^(Event Number|Level Floor|Starting BP)$/i;
  const nums = cells.filter((v) => /^\d+$/.test(v) && !HEADER.test(v)).map(Number);
  const rows = [];
  for (let i = 0; i + 2 < nums.length; i += 3) {
    rows.push({ event: nums[i], level: nums[i + 1], bp: nums[i + 2] });
  }
  return rows;
}

write("events-table.json", parseEventsTable());

// ─── CRAFTING RECIPES ─────────────────────────────────────────────────────────
// Each recipe is an H3 "Name [Tier Discipline Recipe/Formula/Schematic]".
// Fields are text nodes following the heading.

console.log("\nParsing crafting recipes...");

const RECIPE_HEADER =
  /^(.+?)\s*\[(Apprentice|Journeyman|Greater)\s+(Alchemy|Enchanting|Tinkering)\s+(Recipe|Formula|Schematic)\]((?:\s*\[[^\]]+\])*)\s*$/;
const RECIPE_FIELD =
  /^(Crafting Materials(?: Needed)?|Uses per Batch|Expiration|Application|Type|Ritualists|Total Participants|Dark Territory Required|Dark Territory Suit|Reality Tear|Requirements|Crafting Process|Description|Effect|Note|IMPORTANT|Circle of Sacrifice|Circle of Empowerment|Circle of Assignment|Rune Circle):\s*(.*)$/;
const FIELD_KEY = {
  "Crafting Materials Needed": "materials",
  "Crafting Materials": "materials",
  "Uses per Batch": "usesPerBatch",
  Expiration: "expiration",
  Application: "application",
  Type: "type",
  "Crafting Process": "process",
  Description: "description",
  Effect: "effect",
};

function parseCraftingRecipes() {
  const craftingH1 = findHeading("Crafting (all)", 1);
  const ritualH1 = findHeading("Rituals", 1, craftingH1);
  const recipes = [];

  let i = craftingH1 + 1;
  while (i < ritualH1) {
    const n = nodes[i];
    if (n.type === "heading" && n.level === 3 && RECIPE_HEADER.test(n.text)) {
      const h = n.text.match(RECIPE_HEADER);
      const extraTags = [...(h[5] || "").matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim());
      const recipe = {
        name: h[1].trim(),
        discipline: h[3],
        tier: h[2],
        tags: extraTags,
        materials: null,
        usesPerBatch: null,
        expiration: null,
        application: null,
        type: null,
        process: "",
        description: "",
        effect: "",
        fields: {},
      };

      const recEnd = nodes.findIndex((m, j) => j > i && m.type === "heading" && m.level <= 3);
      const rEnd = recEnd === -1 ? ritualH1 : Math.min(recEnd, ritualH1);
      const bodyNodes = nodes.slice(i + 1, rEnd).filter((m) => m.type === "text");

      let curKey = null,
        curLabel = null,
        inProcess = false;
      const addTo = (key, text) => {
        recipe[key] = recipe[key] ? recipe[key] + " " + text : text;
      };
      const append = (label, text) => {
        recipe.fields[label] = (recipe.fields[label] ? recipe.fields[label] + " " : "") + text;
      };

      for (const bn of bodyNodes) {
        const m = bn.text.match(RECIPE_FIELD);
        if (m) {
          curLabel = m[1];
          curKey = FIELD_KEY[m[1]] ?? null;
          if (m[1] === "Crafting Process") inProcess = true;
          else if (m[1] === "Description" || m[1] === "Effect") inProcess = false;
          const val = m[2].trim();
          if (curKey && curKey in recipe) addTo(curKey, val);
          if (val) append(m[1], val);
        } else if (curLabel) {
          if (inProcess && curKey !== "process") addTo("process", bn.text);
          else if (curKey && curKey in recipe) addTo(curKey, bn.text);
          append(curLabel, bn.text);
        }
      }

      // Assemble Enchanting process from sub-steps when no explicit process field
      if (!recipe.process) {
        const steps = ["Circle of Sacrifice", "Circle of Empowerment", "Circle of Assignment", "Rune Circle"]
          .filter((k) => recipe.fields[k])
          .map((k) => `${k}: ${recipe.fields[k]}`);
        if (steps.length) recipe.process = steps.join(" ");
      }

      recipes.push(recipe);
      i = rEnd;
    } else {
      i++;
    }
  }
  return recipes;
}

write("crafting-recipes.json", parseCraftingRecipes());

// ─── RITUALS ──────────────────────────────────────────────────────────────────
// H1: "Rituals" (second occurrence — actual ritual list, not concepts preamble)
// Ritual entries are H3 "Name [Tier Ritual]".

console.log("\nParsing rituals...");

const RITUAL_HEADER = /^(.+?)\s*\[(Apprentice|Journeyman|Greater)\s+Ritual\]\s*$/;
const RITUAL_FIELD =
  /^(Summary|Required Components|Ritualists|Total Participants|Expiration|Targets?|Tools Used|Location|Other Requirements|Dark Territory Marshal Required|Dark Territory Suit|Category|Effect|Ritual Process|Note):\s*(.*)$/;
const RITUAL_KEY = {
  Summary: "summary",
  "Required Components": "components",
  Ritualists: "ritualists",
  "Total Participants": "totalParticipants",
  Expiration: "expiration",
  Target: "targets",
  Targets: "targets",
  "Tools Used": "tools",
  Location: "location",
  "Other Requirements": "otherRequirements",
  "Dark Territory Marshal Required": "darkTerritoryMarshal",
  "Dark Territory Suit": "darkTerritorySuit",
  Effect: "effect",
  "Ritual Process": "process",
};

function parseRituals() {
  // The actual ritual list is under "Ritual Magic" H1
  const ritualMagicH1 = findHeading("Ritual Magic", 1);
  const ritualEnd = nextHeadingAtOrAbove(1, ritualMagicH1);
  const end = ritualEnd === -1 ? nodes.length : ritualEnd;
  const rituals = [];

  let i = ritualMagicH1 + 1;
  while (i < end) {
    const n = nodes[i];
    if (n.type === "heading" && n.level === 3 && RITUAL_HEADER.test(n.text)) {
      const h = n.text.match(RITUAL_HEADER);
      const rec = {
        name: h[1].trim(),
        tier: h[2],
        summary: "",
        components: null,
        ritualists: null,
        totalParticipants: null,
        expiration: null,
        targets: null,
        tools: null,
        location: null,
        otherRequirements: null,
        darkTerritoryMarshal: null,
        darkTerritorySuit: null,
        effect: "",
        process: "",
      };

      const recEnd = nodes.findIndex((m, j) => j > i && m.type === "heading" && m.level <= 3);
      const rEnd = recEnd === -1 ? end : Math.min(recEnd, end);
      const bodyNodes = nodes.slice(i + 1, rEnd).filter((m) => m.type === "text");

      let curKey = null;
      for (const bn of bodyNodes) {
        const m = bn.text.match(RITUAL_FIELD);
        if (m) {
          curKey = RITUAL_KEY[m[1]] ?? null;
          if (curKey) rec[curKey] = rec[curKey] ? rec[curKey] + " " + m[2].trim() : m[2].trim();
        } else if (curKey) {
          rec[curKey] = rec[curKey] ? rec[curKey] + " " + bn.text : bn.text;
        }
      }
      rituals.push(rec);
      i = rEnd;
    } else {
      i++;
    }
  }
  return rituals;
}

write("ritual-recipes.json", parseRituals());

// ─── CORE RULES ───────────────────────────────────────────────────────────────
// The heading hierarchy directly encodes the section structure.
// We emit three things:
//   1. core-rules.json — flat list of H1 sections with their prose content
//   2. glossary.json   — term/definition pairs from the Glossary/Index H1
//   3. Per-concept files (combat-rules.json, death-and-dying.json, etc.)
//      derived recursively from each H1's named children at any depth. The
//      bucket name is derived from the parent H1 heading.

console.log("\nParsing core rules...");

// Sections to skip entirely (policy/etiquette, not navigable game mechanics).
const SKIP_SECTIONS = new Set([
  "Code of Conduct",
  "Wellspring Code of Conduct",
  "Consent and Calibration",
  "Combat Etiquette",
  "Roleplay Etiquette",
  "Wellspring Setting Start Guide",
]);

// Sections whose H2/H3 children are already extracted better elsewhere.
// Their concepts are not emitted as sub-concepts.
const ALREADY_EXTRACTED = new Set([
  "Effects",
  "Conditions",
  "Types",
  "Defense Calls",
  "Modifiers",
  "Stacking Effects",
  "Items",
]);

// Names that look like sub-concept headings but are actually stat-block field
// labels used inside crafting recipes ("Description:", "Effect:"). Skipping
// them prevents an "Effect" entity (255 false matches) and "Description"
// entity from clobbering real game terms.
const STATBLOCK_LABEL_NAMES = new Set([
  "Description",
  "Effect",
  "Recipes/Formulae/Schematics",
  "Crafting Resources List",
  "Auros Starting Wealth",
  "Typical Merchant Prices",
  "Item Cards",
]);

function parseCoreRules() {
  const crStart = findHeading("Wellspring Core Rules", 1);
  const glossaryH1 = findHeading("Glossary/Index", 1, crStart);
  const settingH1 = findHeading("Wellspring Setting Start Guide", 1, glossaryH1);
  const crEnd = settingH1 === -1 ? nodes.length : settingH1;

  // (1) Top-level sections: each H1 between crStart and glossaryH1
  const sections = [];
  let i = crStart + 1;
  while (i < glossaryH1) {
    const n = nodes[i];
    if (n.type !== "heading" || n.level !== 1) {
      i++;
      continue;
    }
    if (!n.text) {
      i++;
      continue;
    }

    const secEnd = nodes.findIndex((m, j) => j > i && m.type === "heading" && m.level === 1);
    const end = secEnd === -1 ? glossaryH1 : Math.min(secEnd, glossaryH1);

    sections.push({
      heading: n.text,
      content: bodyBetween(i + 1, end),
      nodeStart: i,
      nodeEnd: end,
    });
    i = end;
  }

  // (2) Glossary: text nodes under Glossary/Index H1, parsed as "Term: definition"
  const glossary = [];
  const glossEnd = crEnd;
  let j = glossaryH1 + 1;
  while (j < glossEnd) {
    const n = nodes[j];
    if (n.type === "heading") break;
    if (n.type === "text") {
      const m = n.text.match(/^([A-Z][A-Za-z '\/\-]{1,40}?):\s+(.+)$/);
      if (m) glossary.push({ term: m[1].trim(), definition: m[2].trim() });
      else if (glossary.length) glossary[glossary.length - 1].definition += " " + n.text;
    }
    j++;
  }

  return { sections, glossary };
}

const coreRules = parseCoreRules();
write(
  "core-rules.json",
  coreRules.sections.map((s) => ({ heading: s.heading, content: s.content })),
);
write("glossary.json", coreRules.glossary);

// Additional H1 blocks outside the Core Rules range whose H2/H3/H4/H5 children
// are referenced heavily from other entity bodies and so are worth extracting.
// (Audit found Wealth/Ashbin/Turn of the Hourglass/Dark Territory etc. each
// referenced 30+ times — extracting them turns those into graph edges.)
function collectExtraSections() {
  const extras = [];
  const tryRange = (startHeading, endHeading) => {
    const start = findHeading(startHeading, 1);
    if (start === -1) return;
    const end = findHeading(endHeading, 1, start);
    if (end === -1) return;
    extras.push({
      heading: startHeading,
      content: bodyBetween(start + 1, end),
      nodeStart: start,
      nodeEnd: end,
    });
  };
  // Wealth lives between "Wealth" H1 and the next "Crafting (all)" H1.
  tryRange("Wealth", "Crafting (all)");
  // The Crafting Introduction lives between "Crafting (all)" and the first
  // crafting-discipline H1 ("Alchemy").
  tryRange("Crafting (all)", "Alchemy");
  // Devotions & Divine Beings — the H1 intro (before the per-deity H1s) is
  // the only place "Devotion" as a concept is defined. We pull the intro prose
  // up to the first deity H1 ("The Mother").
  tryRange("Devotions & Divine Beings", "The Mother");
  return extras;
}
const extraSections = collectExtraSections();

// ─── CORE RULES SUB-CONCEPTS ──────────────────────────────────────────────────
// Walk each H1 section's node range, recursively emitting one entity per named
// heading at any depth. Deeper headings become `subConcepts` of their parent.
// The bucket (output file) is derived from the H1 section heading — no
// hardcoded section→type maps.
//
// Sections in SKIP_SECTIONS and ALREADY_EXTRACTED are ignored. Heading names in
// STATBLOCK_LABEL_NAMES (e.g. "Description", "Effect") are skipped as entries
// but still descended into.

console.log("\nParsing core rules sub-concepts...");

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Pick the lowest (smallest) heading level present in (start, end). Returns
// null if no headings exist. Used so recursion lands on the next existing
// deeper level rather than always assuming level+1 (the doc sometimes skips
// levels — e.g. Crafting Process H3 → Ashbin H5 with no H4 in between).
function nextHeadingLevel(start, end, above) {
  let lvl = null;
  for (let i = start; i < end; i++) {
    const n = nodes[i];
    if (n.type === "heading" && n.text && n.level > above) {
      if (lvl === null || n.level < lvl) lvl = n.level;
    }
  }
  return lvl;
}

// Walk the range [start, end) and emit one entry per heading at `level`. Each
// entry's own children at deeper levels become its `subConcepts` recursively.
// Prose between a heading and its first child becomes the entry's description.
function walkHeadings(start, end, level, sectionName) {
  const entries = [];
  let i = start;
  while (i < end) {
    const n = nodes[i];
    if (n.type !== "heading" || n.level !== level || !n.text) {
      i++;
      continue;
    }

    const headingEnd = nodes.findIndex((m, j) => j > i && m.type === "heading" && m.level <= level);
    const eEnd = headingEnd === -1 ? end : Math.min(headingEnd, end);

    if (STATBLOCK_LABEL_NAMES.has(n.text)) {
      // Skip this heading as an entry but harvest its sub-tree, descending to
      // the next deeper level that actually exists.
      const childLevel = nextHeadingLevel(i + 1, eEnd, level);
      if (childLevel !== null) entries.push(...walkHeadings(i + 1, eEnd, childLevel, sectionName));
      i = eEnd;
      continue;
    }

    // Description: prose nodes between this heading and the first deeper heading.
    const firstChild = nodes.findIndex((m, j) => j > i && j < eEnd && m.type === "heading" && m.level > level);
    const proseEnd = firstChild === -1 ? eEnd : firstChild;
    const description = bodyBetween(i + 1, proseEnd);

    // Recurse into the next existing deeper level (not necessarily level+1).
    const childLevel = nextHeadingLevel(i + 1, eEnd, level);
    const subConcepts = childLevel !== null ? walkHeadings(i + 1, eEnd, childLevel, n.text) : [];

    entries.push({
      name: n.text,
      section: sectionName,
      description,
      ...(subConcepts.length ? { subConcepts } : {}),
    });
    i = eEnd;
  }
  return entries;
}

function parseSubConcepts(sections) {
  const buckets = {};
  const push = (bucket, entry) => {
    (buckets[bucket] ??= []).push(entry);
  };

  for (const section of sections) {
    if (SKIP_SECTIONS.has(section.heading)) continue;
    if (ALREADY_EXTRACTED.has(section.heading)) continue;

    const { nodeStart, nodeEnd } = section;
    const bucket = slugify(section.heading);

    // Enter at the next existing deeper heading level (skips missing levels —
    // e.g. an H1 with H3 children but no H2).
    const childLevel = nextHeadingLevel(nodeStart, nodeEnd, 1);
    const entries = childLevel !== null ? walkHeadings(nodeStart + 1, nodeEnd, childLevel, section.heading) : [];
    if (entries.length) {
      entries.forEach((e) => push(bucket, e));
      continue;
    }
    // No child headings at all (e.g. Wealth, whose only H2s are stat-block
    // labels we skipped): emit the H1 itself as a single entry in its bucket,
    // provided it has meaningful body prose.
    const prose = bodyBetween(nodeStart + 1, nodeEnd);
    if (prose.trim()) {
      push(bucket, { name: section.heading, section: section.heading, description: prose });
    }
  }
  return buckets;
}

const subConcepts = parseSubConcepts([...coreRules.sections, ...extraSections]);

// Recover doc-defined concepts whose heading was demoted to body text during
// the Google Docs HTML export. The export pattern is "<Term> <Term> is a
// type of..." — the same word appearing twice in a row at the start of a
// sentence, because the original heading became a styled span instead of an
// <h2>/<h3> tag. We detect this and split off `<Term>` as its own sub-concept
// of whatever entry currently holds it.
//
// Known affected term so far: "Barrier" inside Combat Rules → Armor Points →
// Summoned Armor. See DOC_EDITS_WANTED #11e for the upstream fix.
const DEMOTED_HEADING_RE = /(?:^|\.\s+)([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+){0,2})\s+\1\s+(is|are|means|refers to)\b/;
function splitDemotedHeadings(entries) {
  return entries.map((e) => {
    const out = { ...e };
    if (typeof out.description === "string") {
      const m = out.description.match(DEMOTED_HEADING_RE);
      if (m) {
        const term = m[1];
        const dupStart = out.description.indexOf(`${term} ${term}`);
        if (dupStart >= 0) {
          const before = out.description.slice(0, dupStart).trim();
          const splitOff = out.description.slice(dupStart + term.length + 1).trim();
          out.description = before;
          out.subConcepts = [
            ...(out.subConcepts || []),
            {
              name: term,
              section: e.section,
              description: splitOff,
            },
          ];
        }
      }
    }
    if (out.subConcepts) out.subConcepts = splitDemotedHeadings(out.subConcepts);
    return out;
  });
}

for (const [bucket, entries] of Object.entries(subConcepts).sort(([a], [b]) => a.localeCompare(b))) {
  write(`${bucket}.json`, splitDemotedHeadings(entries));
}

// ─── EFFECTS / CONDITIONS / TYPES ─────────────────────────────────────────────
// H1 sections with no heading children. Content is keyword\nprose pairs.
// We parse the text nodes directly.

console.log("\nParsing effects / conditions / types...");

function parseKeywordSection(headingText, endHeadingText) {
  const crStart = findHeading("Wellspring Core Rules", 1);
  // Search without level restriction — Effects/Conditions/Types are H1,
  // Defense Calls/Modifiers are H2. Always search from within core rules.
  const start = nodes.findIndex((n, i) => i > crStart && n.type === "heading" && n.text === headingText);
  if (start === -1) return [];
  const startLevel = nodes[start].level;
  const endNode = endHeadingText ? findHeading(endHeadingText, null, start) : -1;
  const end =
    endNode !== -1 ? endNode : nodes.findIndex((n, i) => i > start && n.type === "heading" && n.level <= startLevel);

  const textNodes = nodes
    .slice(start + 1, end === -1 ? nodes.length : end)
    .filter((n) => n.type === "text" || n.type === "list");

  // Keyword line: short, title-case, no terminal punctuation.
  const isKeyword = (t) => t.length <= 50 && /^[A-Z\[]/.test(t) && !/[.!?,):]\s*$/.test(t) && !/^The\s/.test(t);

  const byName = new Map();
  let i = 0;
  // Skip intro sentence (ends with period)
  while (i < textNodes.length && textNodes[i].type === "text" && /[.!?]$/.test(textNodes[i].text)) i++;

  while (i < textNodes.length) {
    const n = textNodes[i];
    if (n.type === "list") {
      i++;
      continue;
    }
    const keyword = n.text;
    if (!isKeyword(keyword)) {
      i++;
      continue;
    }
    i++;

    // Definition: following text nodes until next keyword
    const def = [];
    while (i < textNodes.length) {
      const m = textNodes[i];
      if (m.type === "list") {
        def.push(m.items.join(" "));
        i++;
        continue;
      }
      if (isKeyword(m.text)) break;
      def.push(m.text);
      i++;
    }
    if (!def.length) continue;

    // Stem: strip leading/trailing bracketed params and connective words
    const stem =
      keyword
        .replace(/^\[[^\]]+\]\s*/, "")
        .replace(/\s*\[.*$/, "")
        .replace(/\s+(to|or|vs\.?|Plus)\s*$/i, "")
        .trim() || keyword;

    if (!byName.has(stem)) {
      byName.set(stem, { name: stem, variants: [], description: def.join(" ") });
    }
    const entry = byName.get(stem);
    if (keyword !== stem) entry.variants.push({ form: keyword, description: def.join(" ") });
  }

  for (const entry of byName.values()) {
    const m = entry.description.match(/(?:causes?|applies|grants?|inflicts?) the (\w[\w '-]*?) condition/i);
    if (m) entry.causesCondition = m[1].trim();
  }

  return [...byName.values()];
}

write("effects.json", parseKeywordSection("Effects", "Stacking Effects"));
write("conditions.json", parseKeywordSection("Conditions", "Types"));
write("types.json", parseKeywordSection("Types", "Items"));
// Defense Calls and Modifiers are H2s with H3 children — parse structurally.
function parseH3Concepts(headingText) {
  const crStart = findHeading("Wellspring Core Rules", 1);
  const h2 = nodes.findIndex((n, i) => i > crStart && n.type === "heading" && n.text === headingText);
  if (h2 === -1) return [];
  const h2Level = nodes[h2].level;
  const h2End = nodes.findIndex((n, i) => i > h2 && n.type === "heading" && n.level <= h2Level);
  const end = h2End === -1 ? nodes.length : h2End;
  const out = [];
  let i = h2 + 1;
  while (i < end) {
    const n = nodes[i];
    if (n.type !== "heading" || n.level !== h2Level + 1 || !n.text) {
      i++;
      continue;
    }
    const entryEnd = nodes.findIndex((m, j) => j > i && m.type === "heading" && m.level <= n.level);
    const eEnd = entryEnd === -1 ? end : Math.min(entryEnd, end);
    const description = bodyBetween(i + 1, eEnd);
    out.push({ name: n.text, variants: [], description });
    i = eEnd;
  }
  return out;
}
write("defense-calls.json", parseH3Concepts("Defense Calls"));
write("modifiers.json", parseH3Concepts("Modifiers"));

// ─── ACCENTS ─────────────────────────────────────────────────────────────────
// Under the "Accent" H2 within Core Rules. Each line: "Name [Elemental] - desc"

console.log("\nParsing accents...");

function parseAccents() {
  const crStart = findHeading("Wellspring Core Rules", 1);
  const accentH2 = nodes.findIndex(
    (n, i) => i > crStart && n.type === "heading" && n.level === 2 && n.text === "Accent",
  );
  if (accentH2 === -1) return [];
  const accentEnd = nodes.findIndex((n, i) => i > accentH2 && n.type === "heading" && n.level <= 2);
  const end = accentEnd === -1 ? nodes.length : accentEnd;

  const out = [];
  for (let i = accentH2 + 1; i < end; i++) {
    const n = nodes[i];
    if (n.type !== "text") continue;
    // "Agony - Wracking pain..." or "Acid [Elemental] - Caustic..."
    const m = n.text.match(/^(.+?)(?:\s*(\[Elemental\]))?\s+-\s+(.+)$/);
    if (!m) continue;
    out.push({ name: m[1].trim(), elemental: !!m[2], description: m[3].trim() });
  }
  return out;
}

write("accents.json", parseAccents());

// ─── CRAFTING RESOURCES ───────────────────────────────────────────────────────
// H2 "Crafting Resources List" under Crafting (all). Entries: H3 "Name (Tier)"
// or inline "Name (Tier)\nDescription" text.

console.log("\nParsing crafting resources...");

function parseResources() {
  const craftingH1 = findHeading("Crafting (all)", 1);
  const resourcesH2 = nodes.findIndex(
    (n, i) => i > craftingH1 && n.type === "heading" && n.level === 2 && n.text === "Crafting Resources List",
  );
  if (resourcesH2 === -1) return [];
  const resourcesEnd = nodes.findIndex((n, i) => i > resourcesH2 && n.type === "heading" && n.level <= 2);
  const end = resourcesEnd === -1 ? nodes.length : resourcesEnd;

  const out = [];
  for (let i = resourcesH2 + 1; i < end; i++) {
    const n = nodes[i];
    if (n.type !== "text") continue;
    // Resources export as "Name (Tier)Description" concatenated in one text node.
    // Split on the (Tier) boundary.
    const m = n.text.match(/^(.+?)\s*\((Basic|Uncommon|Advanced)\)\s*(.*)$/);
    if (!m) continue;
    const name = m[1].trim(),
      tier = m[2];
    let description = m[3].trim();
    // Continuation nodes follow until the next resource or heading
    let j = i + 1;
    while (j < end) {
      const next = nodes[j];
      if (next.type === "heading") break;
      if (next.type === "text") {
        if (/\((Basic|Uncommon|Advanced)\)/.test(next.text)) break;
        if (/^Named Resources/i.test(next.text)) break;
        description += (description ? " " : "") + next.text;
      }
      j++;
    }
    out.push({ name, tier, description });
    i = j - 1;
  }

  // Append Named Resources that are referenced by recipes
  out.push({
    name: "Mote of Power",
    tier: "Named",
    description: "A rare, unique named resource required for Greater Enchanting. May not be substituted.",
  });

  return out;
}

write("resources.json", parseResources());

// ─── CRAFTING CONCEPTS ────────────────────────────────────────────────────────
// H2 sections under each discipline H1 (Alchemy/Enchanting/Tinkering), before
// the recipe list H2s. The discipline name is the parent H1 text.

console.log("\nParsing crafting concepts...");

const RECIPE_SECTION_RE =
  /^(Apprentice|Journeyman|Greater)\s+(Alchemy Recipes|Enchanting Formulae|Tinkering Schematics)$/;
const RECIPE_FIELD_NOISE = new Set([
  "Application",
  "Quaff",
  "Topical",
  "Ingest",
  "Component",
  "Crafting Materials",
  "Uses Per Batch",
  "Expiration",
  "Crafting Process",
  "Description",
  "Effect",
  "Recipes/Formulae/Schematics",
  "Introduction",
  "Turn of the Hourglass",
  "Item Cards",
  "Ashbin",
  "Dark Territory",
  "Crafting Resources List",
  "Named Resources",
  "Alchemy",
  "Enchanting",
  "Tinkering",
]);

function parseCraftingConcepts() {
  const craftingH1 = findHeading("Crafting (all)", 1);
  const ritualH1 = findHeading("Rituals", 1, craftingH1);
  const out = [];

  const disciplines = ["Alchemy", "Enchanting", "Tinkering"];
  for (const disc of disciplines) {
    const discH1 = findHeading(disc, 1, craftingH1);
    if (discH1 === -1 || discH1 >= ritualH1) continue;
    const discEnd = nodes.findIndex((n, i) => i > discH1 && n.type === "heading" && n.level === 1);
    const dEnd = discEnd === -1 ? ritualH1 : Math.min(discEnd, ritualH1);

    // Concept H2s are those before the first recipe-list H2
    const firstRecipeH2 = nodes.findIndex(
      (n, i) => i > discH1 && i < dEnd && n.type === "heading" && n.level === 2 && RECIPE_SECTION_RE.test(n.text),
    );
    const conceptEnd = firstRecipeH2 === -1 ? dEnd : firstRecipeH2;

    let i = discH1 + 1;
    while (i < conceptEnd) {
      const n = nodes[i];
      if (n.type !== "heading" || n.level !== 2 || !n.text || RECIPE_FIELD_NOISE.has(n.text)) {
        i++;
        continue;
      }

      const conceptH2End = nodes.findIndex((m, j) => j > i && m.type === "heading" && m.level <= 2);
      const clampedConceptEnd = conceptH2End === -1 ? conceptEnd : Math.min(conceptH2End, conceptEnd);

      const subNodes = nodes.slice(i + 1, clampedConceptEnd);
      const prose = subNodes
        .filter((m) => m.type === "text")
        .map((m) => m.text)
        .join(" ");
      const tools = subNodes.filter((m) => m.type === "list").flatMap((m) => m.items);

      // Fold the list into the description so the detail pane reads complete (the
      // list usually follows a "…the following:" colon). Keep `tools` for structure.
      const description = tools.length ? `${prose} ${tools.map((t) => `• ${t}`).join(" ")}`.trim() : prose;
      const concept = { name: n.text, discipline: disc, description };
      if (tools.length) concept.tools = tools;
      out.push(concept);
      i = clampedConceptEnd;
    }
  }
  return out;
}

write("crafting-concepts.json", parseCraftingConcepts());

// ─── RITUAL CONCEPTS ──────────────────────────────────────────────────────────
// H3/H4 concepts under the "Rituals" H1 preamble (before "Ritual Magic" H1).

console.log("\nParsing ritual concepts...");

function parseRitualConcepts() {
  const ritualsH1 = findHeading("Rituals", 1);
  const ritualMagicH1 = findHeading("Ritual Magic", 1, ritualsH1);
  const end = ritualMagicH1 === -1 ? nodes.length : ritualMagicH1;

  const RITUAL_FIELD_NOISE = new Set([
    "Expiration",
    "Target",
    "Required Components",
    "Tools Used",
    "Other Requirements",
    "Location",
    "Effect",
    "Ritual Process",
    "Dark Territory",
    "Dark Territory Suit",
    "Dark Territory Marshal Required",
  ]);

  const out = [];
  let i = ritualsH1 + 1;
  while (i < end) {
    const n = nodes[i];
    if (n.type !== "heading" || (n.level !== 3 && n.level !== 4) || !n.text || RITUAL_FIELD_NOISE.has(n.text)) {
      i++;
      continue;
    }

    const conceptEnd = nodes.findIndex((m, j) => j > i && m.type === "heading" && m.level <= n.level);
    const clampedConceptEnd = conceptEnd === -1 ? end : Math.min(conceptEnd, end);

    // Description = prose between this heading and its first deeper child
    // (so children like H4 "Primary Ritualist" under H3 "Ritualists" aren't
    // swallowed into the parent's description).
    const firstChild = nodes.findIndex(
      (m, j) => j > i && j < clampedConceptEnd && m.type === "heading" && m.level > n.level,
    );
    const proseEnd = firstChild === -1 ? clampedConceptEnd : firstChild;
    const proseNodes = nodes.slice(i + 1, proseEnd);
    // A concept's body may include a small table (e.g. Ritual Point Options): fold
    // 'cell' text into the prose alongside 'text' nodes so it isn't lost.
    const prose = proseNodes
      .filter((m) => m.type === "text" || m.type === "cell")
      .map((m) => m.text)
      .join(" ");
    const bullets = proseNodes.filter((m) => m.type === "list").flatMap((m) => m.items);

    // Sub-concepts: deeper headings inside this concept's range.
    const subConcepts = [];
    let k = firstChild === -1 ? clampedConceptEnd : firstChild;
    while (k < clampedConceptEnd) {
      const m = nodes[k];
      if (m.type === "heading" && m.level > n.level && m.text && !RITUAL_FIELD_NOISE.has(m.text)) {
        const subEnd = nodes.findIndex((x, l) => l > k && x.type === "heading" && x.level <= m.level);
        const sEnd = subEnd === -1 ? clampedConceptEnd : Math.min(subEnd, clampedConceptEnd);
        subConcepts.push({
          name: m.text,
          description: nodes
            .slice(k + 1, sEnd)
            .filter((x) => x.type === "text" || x.type === "cell")
            .map((x) => x.text)
            .join(" "),
        });
        k = sEnd;
      } else {
        k++;
      }
    }

    // Fold the bullet list into the description so the detail pane reads complete
    // (the list often follows a "…below:" colon). Keep `bullets` too for any
    // structured use.
    const fullDesc = bullets.length ? `${prose} ${bullets.map((b) => `• ${b}`).join(" ")}`.trim() : prose;
    const concept = { name: n.text, description: fullDesc };
    if (bullets.length) concept.bullets = bullets;
    if (subConcepts.length) concept.subConcepts = subConcepts;
    out.push(concept);
    i = clampedConceptEnd;
  }
  return out;
}

write("ritual-concepts.json", parseRitualConcepts());

console.log("\nDone.");
