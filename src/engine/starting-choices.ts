// Starting-choice model — a class's "Starting Skills" entry includes one or more
// named "Choose one of the following" blocks (the class's specialty choices).
// This module is the single source of truth for what those blocks are, plus the
// PURE logic that materializes the chosen skills and reconciles an existing build
// back onto the dropdowns. It deliberately holds no React so the validator and the
// test suite can import it; the UI (Builder.jsx) wires it to state.
//
// An archetype is just starting data: it ships a flat, pre-resolved startingSkills
// list, and reconcileStartingChoices() maps that list back onto these blocks so
// the implicit choice shows as selected and stays editable — the same control a
// from-scratch build gets.

import classesJson from "../data/classes.json";
import { lookupEntity, ALL_SKILLS } from "./data.js";
import { bareSkill, cleanItemName, getClasses } from "../engine/resolver.js";

import type { CharacterState } from "./types.js";
import type { CharacterChoice } from "./types.js";
import { Source, isStarting } from "./types.js";

// ─── Structured shapes for a class's starting-skill data ────────────────────
/** One parsed skill token from a starting-skills line: the skill name + its rank
 *  (default 1; "xN" multiplies). */
interface SkillToken {
  name: string;
  rank: number;
}

/** One option of a "Choose one of the following" block: its display text + the skills
 *  it would grant. */
interface ChoiceOption {
  label: string;
  skills: SkillToken[];
}
/** A CHOICE block: the player picks one option. `id` is the deterministic slug used
 *  to key the selection. */
interface ChoiceConfig {
  id: string;
  label: string;
  options: ChoiceOption[];
}
/** A materialized starting skill: name + rank + the choice-block label it came from
 *  (`specialty` null for the class's fixed base grants). */
interface ExpectedSkill {
  name: string;
  rank: number;
  specialty: string | null;
}

// ─── STARTING SKILLS, DERIVED FROM THE PARSED MEGADOC ──────────────────────────
// The MegaDoc is the single source of truth. The parser already captures each
// class's "Starting Skills" block as raw lines in classes.json[cls].startingSkills,
// e.g.:
//   "The Most Basic Training: Basic Martial Weapons (1), Basic Shields (4)"  (fixed)
//   "The Path of Combat - Choose one of the following:"                      (header)
//   "Projectile Weapons (3), Lore: Historical (2)"                           (option)
// We structure those lines here into the two shapes the builder consumes — rather
// than hand-maintaining a second copy that drifts (it did, for all 8 classes). No
// option list is stashed: category choices ("Choose a Gathering Skill", "Apprentice
// Crafting") expand from the skill list, and "Choose a Lore Skill" maps to the one
// parameterized Lore skill (its picker enumerates areas from the skill's own text).

// Deterministic, label-derived block id — no hand-typed ids (there are no saved
// characters, so id stability across edits doesn't matter).
const slugId = (label: string) =>
  "choice-" +
  String(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// A CHOICE HEADER asks the player to choose and ends with ":" (options follow on
// later lines). A mid-line "Choose a Lore Skill (2)" is an INLINE choice instead.
const isChoiceHeader = (line: string) => /\bchoose\b/i.test(line) && /:\s*$/.test(line.trim());
const hasInlineChoose = (line: string) => /\bchoose\b/i.test(line) && !/:\s*$/.test(line.trim());

// Human label from a header/inline line: text before " - Choose", "Title: Choose",
// or the leading "Title:" — whichever yields a title.
function choiceLabel(line: string) {
  let m = line.match(/^(.*?)\s*[-–]\s*choose\b/i);
  if (m) return m[1].trim();
  m = line.match(/^(.*?):\s*choose\b/i);
  if (m) return m[1].trim();
  m = line.match(/^([^:]+):/);
  if (m && !/\bchoose\b/i.test(m[1])) return m[1].trim();
  return "Choose";
}

// Parse SKILL TOKENS out of line text into [{ name, rank }]: drops "(cost)", reads
// "xN" rank multipliers, splits on commas / "&" / "and" / "or" / "either", strips
// bracketed params, and keeps only tokens that resolve to a real skill (via the
// alias layer) — prose noise ("A Good Defense") is dropped.
function parseSkillTokens(text: string) {
  const out: SkillToken[] = [];
  // Strip a leading "Block Title - " / "Block Title: " provenance prefix, but only
  // when doing so leaves a resolvable first skill (skill names also contain " - ",
  // e.g. "Extended Capacity - Novice", so a blind strip would corrupt them).
  // Distribute a shared skill base over "&"-joined tiers FIRST (before any prefix
  // strip), both orderings:
  //   "Apprentice & Journeyman Profession"   (base last)
  //   "Profession: Apprentice & Journeyman"  (base first, Socialite)
  // → "Apprentice Profession, Journeyman Profession" (each aliases to "Profession
  // - <Tier>").
  let body = text
    .replace(
      /\b(Apprentice|Journeyman|Greater|Master)\s*&\s*(Apprentice|Journeyman|Greater|Master)\s+(\w+)/gi,
      (_: string, a: string, b: string, base: string) => `${a} ${base}, ${b} ${base}`,
    )
    .replace(
      /\b(\w+):\s*(Apprentice|Journeyman|Greater|Master)\s*&\s*(Apprentice|Journeyman|Greater|Master)\b/gi,
      (_: string, base: string, a: string, b: string) => `${a} ${base}, ${b} ${base}`,
    );
  // Strip a leading "Block Title - " / "Block Title: " provenance prefix, but only
  // when doing so leaves a resolvable first skill (skill names also contain " - ").
  const pm = body.match(/^(.+?)\s*[-–:]\s+(.+)$/);
  if (pm) {
    const firstRaw = (s: string) =>
      s
        .split(/\s*,\s*|\s*&\s*/)[0]
        .replace(/x\s*\d+/gi, "")
        .replace(/\(\d+\)/g, "")
        .replace(/\[[^\]]*\]/g, "")
        .trim();
    if (resolveSkill(firstRaw(pm[2])) && !resolveSkill(firstRaw(body))) body = pm[2];
  }
  const parts = body
    .replace(/\band either\b/gi, ",")
    .replace(/\beither\b/gi, " ")
    .replace(/\bone of\b/gi, ",")
    // NB: do NOT split on bare "&" — tier-distribution ("Apprentice & Journeyman")
    // was already expanded to commas above, so a remaining "&" is part of a skill/
    // perk NAME ("Bits & Pieces"). Splitting it would shatter the name into nonsense.
    .split(/\s*,\s*|\s+\band\b\s+|\s+\bor\b\s+/i);
  for (const raw of parts) {
    const tok = canonicalSkill(raw);
    if (tok) out.push(tok);
  }
  return out;
}

// Resolve one raw skill token ("Lore: Nature (2)", "Two-Weapon Style (2)",
// "Bookcaster (1) x 2") to { name (canonical), rank } or null. Re-attaches a
// parameter captured from "Base: Param" / "Base (Param)" / "Base [Param]" so a
// parameterized skill (Lore) keeps its subject; normalizes dash spacing as a
// fallback. The one place a token becomes a canonical {name,rank}, shared by the
// token scanner and the option-line expander.
function canonicalSkill(raw: string) {
  if (!raw || !raw.trim()) return null;
  const xm = raw.match(/x\s*(\d+)/i);
  const rank = xm ? parseInt(xm[1], 10) : 1;
  const paramM = raw.match(/(?::\s*|\(|\[)\s*([A-Za-z][A-Za-z ]+?)\s*[)\]]?\s*(?:\(\d+\)|x\s*\d+|$)/);
  let name = raw
    .replace(/x\s*\d+/gi, "")
    .replace(/\(\d+\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\bAND\b/g, " ")
    .replace(/[()]/g, " ")
    .replace(/[:;]+\s*$/, "") // trailing "Journeyman Profession:" colon
    .replace(/\s+/g, " ")
    .trim();
  let ent = resolveSkill(name);
  if (!ent) {
    const normalized = name.replace(/\s*-\s*/g, " - ");
    if ((ent = resolveSkill(normalized))) name = normalized;
  }
  if (!ent) return null;
  const base = ent.baseName || ent.name;
  if (ent.parameter && paramM && paramM[1] && base.toLowerCase() !== paramM[1].trim().toLowerCase()) {
    // Parameter captured from the raw token ("Lore: Nature" → "Lore (Nature)").
    name = `${base} (${paramM[1].trim()})`;
  } else if (ent.parameter && /\(/.test(ent.name)) {
    // The alias already resolved to a fully-parameterized name ("Ritual Lore" →
    // "Lore (Ritual)") — use it verbatim.
    name = ent.name;
  } else if (!ent.parameter) {
    name = base;
  }
  return { name, rank };
}

// The suggested Lore areas, DERIVED from the Lore skill's own description prose
// ("Arcane Lore: …  Historical Lore: …"). Lore is a single parameterized skill;
// enumerating its areas here gives "Choose a Lore Skill" a real multi-option UI
// dropdown without stashing a hand-typed copy — the areas come from the doc.
let _loreOptions: ChoiceOption[] | null = null;
function loreAreaOptions() {
  if (_loreOptions) return _loreOptions;
  const lore = ALL_SKILLS.find((s) => s.name === "Lore");
  const areas = lore ? [...String(lore.desc || "").matchAll(/([A-Z][a-z]+)\s+Lore:/g)].map((m) => m[1]) : [];
  _loreOptions = [...new Set(areas)].map((a) => ({ label: a, skills: [{ name: `Lore (${a})`, rank: 1 }] }));
  return _loreOptions;
}

// Expand an INLINE "Choose a <category> Skill" into concrete options from the skill
// list. Returns { options, fixed } — fixed = non-choice skills sharing the line.
function expandInlineChoice(line: string) {
  const fixed: SkillToken[] = [];
  let options: ChoiceOption[] = [];
  if (/choose\s+a\s+lore\s+skill/i.test(line)) {
    // Lore areas enumerated from the Lore skill's description (see loreAreaOptions).
    options = loreAreaOptions();
  } else if (/choose\s+a\s+gathering\s+skill/i.test(line)) {
    options = ALL_SKILLS.filter((s) => s.category === "Gathering" && /\bI\b/.test(s.name)).map((s) => ({
      label: s.name,
      skills: [{ name: s.name, rank: 1 }],
    }));
  } else if (/apprentice\s+crafting/i.test(line)) {
    options = ALL_SKILLS.filter((s) => /^Apprentice /.test(s.name) && s.category === "Crafting").map((s) => ({
      label: s.name,
      skills: [{ name: s.name, rank: 1 }],
    }));
  }
  // Fixed skills riding along after the choice clause (Mage: "…Choose a Lore Skill
  // (2), Library Use (1), Bookcaster x2"). Drop the bracketed option list first.
  const tail = line.replace(/\[[^\]]*\]/g, "").replace(/.*choose\b[^,]*?(?:skill|crafting)?\s*(?::|,|$)/i, "");
  for (const tok of parseSkillTokens(tail)) {
    if (!options.some((o) => o.skills.some((s) => s.name === tok.name))) fixed.push(tok);
  }
  return { options, fixed };
}

// Pull an EMBEDDED choice out of an otherwise-fixed line. The doc states small
// either/or choices inline rather than as a header:
//   "…and either Forage I (3) or Scavenge I (3)"        (Druid)
//   "Basic Medicine (2) and one of [Bits & Pieces, …]"  (Artisan)
// Returns { fixedText, options } — fixedText is the line with the choice clause
// removed; options is the extracted alternatives (empty if none).
function extractEmbeddedChoice(line: string) {
  let m = line.match(/\b(?:and\s+)?one of\s*\[([^\]]*)\]/i);
  if (m) {
    const options = m[1]
      .split(/\s*,\s*|\bor\b/i)
      .map((s: string) => canonicalSkill(s))
      .filter((t): t is SkillToken => t !== null)
      .map((t: SkillToken) => ({ label: t.name, skills: [t] }));
    if (options.length) return { fixedText: line.replace(m[0], ""), options };
  }
  m = line.match(/\b(?:and\s+)?either\s+(.+?)\s+or\s+(.+?)(?:$|,)/i);
  if (m) {
    const options = [m[1], m[2]]
      .map((s: string) => canonicalSkill(s))
      .filter((t): t is SkillToken => t !== null)
      .map((t: SkillToken) => ({ label: t.name, skills: [t] }));
    if (options.length >= 2) return { fixedText: line.replace(m[0], ""), options };
  }
  return { fixedText: line, options: [] };
}

// Expand one OPTION line (under a "Choose…" header) into one or more flattened
// options. Most lines are a single option (their parsed tokens). But a line with a
// nested sub-choice — a tier-distributed bracket ("Apprentice Crafting: [Alchemy,
// Enchanting, …]") or "<fixed> and one of [a, b, c]" — becomes several options, one
// per alternative, each combining the line's fixed tokens with that alternative.
// `baseToks` are the already-parsed non-bracket tokens of the line.
function expandOptionLine(line: string, baseToks: SkillToken[]) {
  // Tier-distributed bracket: "Apprentice Crafting: [Alchemy, (Ritual Magic AND
  // Ritual Lore), Enchanting, or Tinkering]" → one option per crafting discipline.
  const br = line.match(/\b(Apprentice|Journeyman|Greater|Master)\b[^[]*\[([^\]]*)\]/i);
  if (br) {
    const tier = br[1];
    const opts: ChoiceOption[] = [];
    for (const raw of br[2].split(/\s*,\s*|\bor\b/i)) {
      const inner = raw.replace(/[()]/g, " ").replace(/\bAND\b/gi, ",");
      // An alternative may itself be a combo ("Ritual Magic AND Ritual Lore").
      const skills: SkillToken[] = [];
      for (const piece of inner.split(/\s*,\s*/)) {
        // Try the tier-prefixed form ("Apprentice Alchemy") first, then the bare
        // piece ("Ritual Lore" → Lore (Ritual)) — both via the canonical resolver.
        const tok = canonicalSkill(`${tier} ${piece.trim()}`) || canonicalSkill(piece.trim());
        if (tok) skills.push(tok);
      }
      if (skills.length) opts.push({ label: skills.map((s: SkillToken) => s.name).join(", "), skills });
    }
    if (opts.length) return opts;
  }
  // "<fixed> and one of [a, b, c]" → one option per bracket item, each plus fixed.
  const oneOf = line.match(/\bone of\s*\[([^\]]*)\]/i);
  if (oneOf) {
    const opts: ChoiceOption[] = [];
    for (const raw of oneOf[1].split(/\s*,\s*|\bor\b/i)) {
      const tok = canonicalSkill(raw);
      if (tok)
        opts.push({
          label: [...baseToks.map((t: SkillToken) => t.name), tok.name].join(", "),
          skills: [...baseToks, tok],
        });
    }
    if (opts.length) return opts;
  }
  // Inline "A or B, C" within an option line → "(A | B) + C": the doc's Rogue line
  // "Basic Lock Skill or Basic Trap Skill, Poisoner" is two options (Locks+Poisoner,
  // Traps+Poisoner), NOT one all-of. Split the alternatives from the shared rest.
  const orM = line.match(/^(.*?\S)\s+or\s+(\S.*)$/i);
  if (orM && !/\[/.test(line)) {
    // Left side's last skill + right side's first skill are the alternatives; any
    // remaining comma-separated skills are shared by both options.
    const leftToks = parseSkillTokens(orM[1]);
    const rightParts = orM[2].split(/\s*,\s*/);
    const altTok = canonicalSkill(rightParts[0]);
    const sharedToks = rightParts.slice(1).flatMap((p: string) => parseSkillTokens(p));
    if (leftToks.length && altTok) {
      const lastLeft = leftToks[leftToks.length - 1];
      const common = [...leftToks.slice(0, -1), ...sharedToks];
      const mk = (alt: SkillToken) => ({
        label: [...common, alt].map((t: SkillToken) => t.name).join(", "),
        skills: [...common, alt],
      });
      return [mk(lastLeft), mk(altTok)];
    }
  }
  // Plain option: its parsed tokens are the one option.
  return [{ label: baseToks.map((t: SkillToken) => t.name).join(", "), skills: baseToks }];
}

// Structure one class's raw startingSkills lines into { fixed, choices }.
function deriveStartingSkills(className: string) {
  const cls = classesJson.find((c) => c.name === className);
  const fixed: SkillToken[] = [];
  const choices: ChoiceConfig[] = [];
  if (!cls?.startingSkills) return { fixed, choices };
  // The Jun 26 MegaDoc reformatted choices to "X - Choose one of the following:"
  // headers followed by flat option lines (instead of inline "[a, b, c]"). But the
  // options carry NO structural indentation (every <li> is bullet level 0), so a
  // nested sub-choice — an OPTION that is itself a "…Choose one of the following:"
  // line — is indistinguishable from a new top-level block by structure alone. We
  // recover nesting by the ":" convention + the redundant flat lines the sub-header
  // re-lists: when a choice-header appears while a block is already open, treat it
  // as a nested sub-choice OPTION of the current block (expanded dynamically), and
  // SKIP the flat option lines that follow until the sub-choice's own skills are
  // exhausted or a delimiter (Note:, or a new same-block option) appears. See
  // PARSER_SOURCE_FEEDBACK.md #1/#2: real list indentation would delete this.
  let current: ChoiceConfig | null = null; // open choice block awaiting option lines
  let subChoice = false; // inside a NESTED sub-choice's literal option lines
  let subChoiceFixed: SkillToken[] = []; // fixed skills shared by every option of that sub-choice

  const lines = cls.startingSkills;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^Note:/i.test(line.trim())) {
      subChoice = false;
      continue;
    }

    // A choice header. Two shapes in the Jun 26 doc, told apart by the separator:
    //   TOP-LEVEL: "<Flavor> - Choose one of the following:"  (a " - " before Choose)
    //   NESTED:    "<Skill>: Choose…" / "<Skill>, Choose…"    (an option that is
    //              itself a sub-choice, e.g. Artisan "Apprentice Crafting: Choose…")
    // The dash is the only signal the flat (un-indented) list gives us. For a nested
    // sub-choice we consume the LITERAL following option lines as its options (each
    // becomes a top-level option of the current block, matching how the UI flattens
    // the tree). See PARSER_SOURCE_FEEDBACK.md #1/#2: real indentation would replace
    // this convention-based grouping with structural parsing.
    if (isChoiceHeader(line)) {
      const isTopLevel = /\s[-–]\s*Choose/i.test(line) || !current;
      if (!isTopLevel) {
        // Header line may carry its own fixed skill(s) before "Choose…" (e.g.
        // "Basic Medicine (2), Choose one of the following:"). Add those to EVERY
        // following option as shared skills.
        subChoice = true;
        subChoiceFixed = parseSkillTokens(line.replace(/,?\s*choose[^:]*:\s*$/i, ""));
        continue;
      }
      // A top-level header may carry FIXED skills before the "Choose…" clause, e.g.
      // Druid "Natural Survival: Basic Martial Weapons (1), Profession - Apprentice
      // (1), Choose one of the following:". Those are granted regardless of the pick.
      const headFixed = parseSkillTokens(line.replace(/,?\s*choose[^:]*:\s*$/i, ""));
      fixed.push(...headFixed);
      current = { id: slugId(choiceLabel(line)), label: choiceLabel(line), options: [] };
      choices.push(current);
      subChoice = false;
      subChoiceFixed = [];
      continue;
    }

    if (hasInlineChoose(line)) {
      const { options, fixed: tail } = expandInlineChoice(line);
      if (options.length) choices.push({ id: slugId(choiceLabel(line)), label: choiceLabel(line), options });
      fixed.push(...tail);
      current = null;
      subChoice = false;
      continue;
    }

    const { fixedText, options: embedded } = extractEmbeddedChoice(line);
    const toks = parseSkillTokens(fixedText);

    // A "Title: …" prefixed line is a NEW fixed/header entry, never an option of an
    // open choice — it terminates the current option run. The prefix is flavor PROSE
    // that does NOT resolve to a skill ("The Song of the Land:", "Materials,
    // Everywhere:"). An option whose text merely contains a skill-parameter colon
    // ("Apprentice & Journeyman Profession: [Your Choice]", "…, Lore: Nature (2)")
    // has a prefix that DOES resolve (or carries a "(cost)"), so it's not a title.
    const firstColon = line.indexOf(":");
    const prefix = firstColon > 0 ? line.slice(0, firstColon) : "";
    const isTitledLine =
      !!prefix && !isChoiceHeader(line) && !/\(\d+\)/.test(prefix) && parseSkillTokens(prefix).length === 0; // prose prefix → a fresh fixed line
    if (isTitledLine) {
      current = null;
      subChoice = false;
    }

    // A literal option line of an open nested sub-choice → one option of the current
    // block, carrying the sub-choice's shared fixed skills (if any).
    if (subChoice && current && toks.length && !isTitledLine) {
      const all = [...subChoiceFixed, ...toks];
      current.options.push({ label: all.map((t) => t.name).join(", "), skills: all });
      continue;
    }

    if (current) {
      // An option line may itself carry a nested sub-choice — a bracketed list or
      // "one of [perks]". Flatten each alternative into its own option.
      for (const opt of expandOptionLine(line, toks)) current.options.push(opt);
    } else {
      fixed.push(...toks);
      if (embedded.length) {
        const label = choiceLabel(line) === "Choose" ? "Gathering Choice" : choiceLabel(line);
        choices.push({ id: slugId(label), label, options: embedded });
      }
    }
  }
  return { fixed, choices };
}

const DERIVED = Object.fromEntries(
  classesJson.filter((c) => c.startingSkills).map((c) => [c.name, deriveStartingSkills(c.name)]),
);

// The class's fixed starting skills (granted regardless of choice blocks), derived
// from the parsed MegaDoc. Shape: [{ name, rank }].
export const BASE_STARTING_SKILLS = Object.fromEntries(Object.entries(DERIVED).map(([cls, d]) => [cls, d.fixed]));

// Per-class "choose one" blocks, derived from the parsed MegaDoc. Each block:
// { id, label, options:[{ label, skills:[{name,rank}] }] }.
export const STARTING_CHOICES_CONFIG = Object.fromEntries(Object.entries(DERIVED).map(([cls, d]) => [cls, d.choices]));

// Does this class have any starting-choice blocks?
export function hasStartingChoices(className: string) {
  return !!(STARTING_CHOICES_CONFIG[className] || []).length;
}

// Does a config skill name pin a CONCRETE parameter — a trailing "(value)" that
// names a real subject, as the Lore options do ("Lore (Arcane)")? Such a name must
// override a kept item's stale parameter when the choice changes. Placeholder
// parentheticals ("(your choice)", "(Specific Profession)") are NOT concrete — they
// mark a slot the player fills, so a player-chosen value must survive a rebuild. A
// bare " - " (e.g. "Extended Capacity - Novice") is part of the canonical name, not
// a parameter, so it never counts.
const PLACEHOLDER_PARAM = /\b(your|character'?s?|specific|a)\b.*\bchoice\b|\bspecific\b|\bcharacter'?s?\b/i;
function hasParameter(name: string) {
  const m = String(name).match(/\(([^()]*)\)\s*$/);
  return !!m && !PLACEHOLDER_PARAM.test(m[1]);
}

// Normalize an option's skills entry to { name, rank }.
export function optionSkills(opt: ChoiceOption | undefined | null) {
  return (opt?.skills || []).map((s: string | SkillToken) =>
    typeof s === "string" ? { name: s, rank: 1 } : { name: s.name, rank: s.rank || 1 },
  );
}

// Resolve a starting-skill name to its backing entity (skill / perk / power), or
// null. Knows the alias map (e.g. "Apprentice Profession" ⇄ "Profession -
// Apprentice", parameter stripping, rank suffixes) via lookupEntity. The single
// resolution path shared by reconciliation, match-keying, and the config-integrity
// test — so the test can't drift from how the runtime actually resolves names.
export function resolveSkill(name: string) {
  return (
    lookupEntity(`skills:${cleanItemName(name)}`) ||
    lookupEntity(`perks:${cleanItemName(name)}`) ||
    lookupEntity(`powers:${cleanItemName(name)}`) ||
    null
  );
}

// Canonical match-key for a skill name, used to compare a character's starting
// skill against a choice-config option regardless of surface form. Keys off the
// resolved BASE entity name; falls back to the bare cleaned name when nothing
// resolves. Lower-cased so case never matters.
function skillMatchKey(name: string) {
  const ent = resolveSkill(name);
  const base = ent ? ent.baseName || ent.name : bareSkill(cleanItemName(name));
  return base.toLowerCase();
}

// Parse a trailing rank off a skill name ("Extended Capacity - Novice x2" → 2).
// Only the explicit "xN" form bumps the count here; bare Roman/digit suffixes are
// left to the validator's richer parseTrailingRank. Lets reconciliation tell a
// shipped "Foo x2" apart from a single "Foo".
function parseStartingRank(name: string) {
  const m = String(name || "")
    .trim()
    .match(/\sx\s*(\d+)$/i);
  return m ? parseInt(m[1], 10) : 1;
}

// Reconcile a character's CURRENT starting skills against the choice config to
// infer which option each named choice block (Druid's "Budding Wisdom", Artisan's
// "Productive Equipment" / "The Land Provides" / "A Path Unfolds", …) implicitly
// took. Archetypes ship a flat, pre-resolved startingSkills list with no
// `startingChoices` sidecar — this maps that list back onto the dropdowns so an
// archetype's baked-in choices show as selected and stay editable, exactly like a
// from-scratch build.
//
// The blocks are NOT independent: a class with several choices (Artisan) may offer
// the SAME skill in two blocks, and an archetype that took it once must attribute
// it to exactly one block ("must be different from the choice made in …"). So this
// is a small assignment problem, not per-block greedy matching — we search over
// option combinations, CONSUMING each option's skills from a shared owned-skill
// pool, and keep the assignment that explains the most owned skills. Falls back to
// the default option for any block left unmatched. Pure: returns { [id]: label }.
export function reconcileStartingChoices(character: CharacterState, className: string) {
  const configs = STARTING_CHOICES_CONFIG[className] || [];
  if (!configs.length) return {};
  // Owned starting skills by canonical key, RANK-AWARE: a skill stored once with
  // rank 2 (e.g. "Extended Capacity - Novice") counts as two copies, so an option
  // asking for "x2" still matches. Rank comes off the CharacterChoice; falls back
  // to a trailing "xN" in the name. Starting skills are the Class:Starting entries
  // of the skills[] bucket.
  const ownedPool: Record<string, number> = {};
  const startingEntries = (character.skills || []).filter((s) => isStarting(s.source));
  startingEntries.forEach((choice: CharacterChoice) => {
    const b = skillMatchKey(choice.entityId);
    ownedPool[b] = (ownedPool[b] || 0) + (choice.ranks || parseStartingRank(choice.entityId) || 1);
  });

  // Need-counts for one option, keyed by canonical skill key.
  const optionNeed = (opt: ChoiceOption) => {
    const need: Record<string, number> = {};
    for (const s of optionSkills(opt)) {
      const b = skillMatchKey(s.name);
      need[b] = (need[b] || 0) + (s.rank || 1);
    }
    return need;
  };
  // Can `need` be drawn from the remaining `pool`? Returns the post-draw pool, or
  // null if not fully satisfiable.
  const draw = (pool: Record<string, number>, need: Record<string, number>) => {
    const next = { ...pool };
    for (const [b, n] of Object.entries(need)) {
      if ((next[b] || 0) < n) return null;
      next[b] -= n;
    }
    return next;
  };

  // DFS over blocks: for each, try every option that the remaining pool can still
  // satisfy (consuming its skills), plus an "unmatched" branch. Score = total
  // owned skills consumed; richer (more-specific) matches win, and shared skills
  // can only be claimed once. Best assignment across the whole search is kept.
  let bestAssign: Record<string, string | null> | null = null;
  let bestScore = -1;
  const search = (i: number, pool: Record<string, number>, assign: Record<string, string | null>, score: number) => {
    if (i === configs.length) {
      if (score > bestScore) {
        bestScore = score;
        bestAssign = { ...assign };
      }
      return;
    }
    const conf = configs[i];
    for (const opt of conf.options) {
      const after = draw(pool, optionNeed(opt));
      if (!after) continue;
      search(i + 1, after, { ...assign, [conf.id]: opt.label }, score + optionSkills(opt).length);
    }
    // Always allow leaving this block unmatched (its default) so a partial match
    // elsewhere isn't blocked by one unsatisfiable block.
    search(i + 1, pool, { ...assign, [conf.id]: null }, score);
  };
  search(0, ownedPool, {}, 0);

  const res: Record<string, string> = {};
  for (const conf of configs) {
    res[conf.id] = (bestAssign && bestAssign[conf.id]) || conf.options[0]?.label;
  }
  return res;
}

// The starting skills a class+choices grant, each tagged with { name, rank,
// specialty }: the class's fixed base grants first (specialty null), then each
// chosen option's skills tagged with their block label. The single source of truth
// for "what does this build's starting block produce", shared by rebuild (forward)
// and startingSkillGrants (derive-on-read).
function expectedStartingSkills(primaryClassName: string, choices?: Record<string, string>) {
  const fixed = (BASE_STARTING_SKILLS[primaryClassName] || []).map((s) =>
    typeof s === "string"
      ? { name: s, rank: 1, specialty: null }
      : { name: s.name, rank: s.rank || 1, specialty: null },
  );
  const out: ExpectedSkill[] = [...fixed];
  for (const conf of STARTING_CHOICES_CONFIG[primaryClassName] || []) {
    const chosenVal = choices?.[conf.id];
    const opt = chosenVal && conf.options.find((o) => o.label === chosenVal);
    if (!opt) continue;
    for (const s of optionSkills(opt)) out.push({ name: s.name, rank: s.rank, specialty: conf.label });
  }
  return out;
}

// Derive, for a character's CURRENT startingSkills array, which choice block
// granted each index and the free rank floor it grants — WITHOUT relying on a
// persisted sidecar. This is the read-side counterpart to rebuildStartingSkills:
// it matches each current skill to an expected template (same canonical-key /
// in-order logic), so provenance badges and floor-billing work on ANY character
// (freshly built, imported from a sheet, or loaded from a URL hash) rather than
// only on ones that just went through a rebuild. Returns
// { specialty: {idx→label}, floor: {idx→rank} } for indices that came from a grant.
export function startingSkillGrants(character: CharacterState): {
  specialty: Record<number, string>;
  floor: Record<number, number>;
} {
  const primary = getClasses(character)[0]?.name;
  const specialty: Record<number, string> = {};
  const floor: Record<number, number> = {};
  if (!primary || !hasStartingChoices(primary)) return { specialty, floor };
  const choices =
    character.startingChoices && Object.keys(character.startingChoices).length
      ? character.startingChoices
      : reconcileStartingChoices(character, primary);
  const expected = expectedStartingSkills(primary, choices);
  const byBase: Record<string, ExpectedSkill[]> = {};
  for (const t of expected) (byBase[skillMatchKey(t.name)] = byBase[skillMatchKey(t.name)] || []).push(t);
  const kept: Record<string, number> = {};
  // Key specialty/floor by the starting skill's index AMONG the Class:Starting
  // entries of the bucket — the same index the graph stamps as node.originalIndex,
  // so floor billing (startFloors[node.index]) lines up.
  const startingEntries = (character.skills || []).filter((s) => isStarting(s.source));
  startingEntries.forEach((choice, idx) => {
    const base = skillMatchKey(choice.entityId);
    const templates = byBase[base] || [];
    const k = kept[base] || 0;
    if (k < templates.length) {
      const t = templates[k];
      if (t.specialty) specialty[idx] = t.specialty;
      floor[idx] = t.rank || 1; // floor exists even for fixed grants (their full rank is free)
      kept[base] = k + 1;
    }
  });
  return { specialty, floor };
}

// Materialize a class's starting skills from its fixed grants + the chosen options.
// Drives both blank builds (choices from the dropdown) and archetype-loaded builds
// (choices reconciled from the shipped skill list). Existing parameters (e.g. a
// chosen Lore subject) are preserved when a kept skill still matches an expected
// one; skills unrelated to any choice block are preserved untouched (never silently
// deleted), and a previously-chosen option's skills drop when the choice changes.
// Provenance (which block granted each skill) and the free-rank floor are NOT
// persisted on the character — they're derived on read by startingSkillGrants, so
// they can't be lost on import / round-trip.
export function rebuildStartingSkills(
  character: CharacterState,
  primaryClassName: string,
  updatedChoices: Record<string, string> | null = null,
) {
  const choices = updatedChoices || character.startingChoices || {};

  const expectedList = expectedStartingSkills(primaryClassName, choices);
  const classConfigs = STARTING_CHOICES_CONFIG[primaryClassName] || [];

  // Group expected entries by canonical match-key so we can match current items
  // (which may carry a chosen parameter or an alias spelling) against the right
  // template in order.
  const expectedByBase: Record<string, ExpectedSkill[]> = {};
  for (const item of expectedList) {
    const base = skillMatchKey(item.name);
    (expectedByBase[base] = expectedByBase[base] || []).push(item);
  }

  // Every skill key that ANY option of ANY block for this class can grant. A
  // current starting skill whose key is in here but NOT in the expected list was
  // the PREVIOUSLY selected option — it must drop when the choice changes. A skill
  // whose key is NOT in here is unrelated to the choices (a manual add, or a skill
  // an archetype shipped that doesn't conform to the config, e.g. Blaster
  // Sourcerer's mislabeled Advanced Recharge) — preserve it untouched so a rebuild
  // never silently deletes build state it doesn't own.
  const choiceKeys = new Set();
  for (const conf of classConfigs) {
    for (const opt of conf.options) {
      for (const s of optionSkills(opt)) choiceKeys.add(skillMatchKey(s.name));
    }
  }

  // Starting skills are: CharacterChoice[] with a `starting` source in
  // character.skills. Purchased (and any other-source) entries are preserved
  // untouched; only the starting ones are rebuilt.
  const allSkills = character.skills || [];
  const currentStarting = allSkills.filter((s: CharacterChoice) => isStarting(s.source));
  const otherSkills = allSkills.filter((s: CharacterChoice) => !isStarting(s.source));

  const nextStarting: CharacterChoice[] = [];
  const keptCounts: Record<string, number> = {};
  const pushItem = (name: string, rank?: number) =>
    nextStarting.push({ entityId: name, source: Source.class(primaryClassName), ranks: rank || 1 });

  // Keep current starting items that still belong (matched to an expected
  // template), plus any unrelated to the choices.
  for (const choice of currentStarting) {
    const item = choice.entityId;
    const base = skillMatchKey(item);
    const templates = expectedByBase[base] || [];
    const kept = keptCounts[base] || 0;
    if (kept < templates.length) {
      const t = templates[kept];
      const floor = t.rank || 1;
      // Preserve any rank the user bought ABOVE the free floor; never below it.
      const total = Math.max(floor, choice.ranks || floor);
      // Name: when the chosen OPTION pins a specific parameter (e.g. the Lore
      // dropdown selects "Lore (Arcane)"), the template wins so switching the
      // choice actually changes the subject. When the template is parameter-less
      // (a generic grant the player later customized — "Profession - Apprentice
      // (Smith)"), keep the player's current name so their pick survives a rebuild.
      const name = hasParameter(t.name) ? t.name : item;
      pushItem(name, total);
      keptCounts[base] = kept + 1;
    } else if (!choiceKeys.has(base)) {
      // Unrelated to any choice block — preserve as-is (keeps its current rank).
      pushItem(item, choice.ranks || 1);
    }
    // else: a choice-block skill that's no longer expected → dropped (old choice).
  }

  // Add any still-missing expected skills.
  for (const [base, templates] of Object.entries(expectedByBase)) {
    for (let i = keptCounts[base] || 0; i < templates.length; i++) {
      pushItem(templates[i].name, templates[i].rank);
    }
  }

  // Provenance (which block granted each) + the free-rank floor are NOT persisted;
  // they're derived on read by startingSkillGrants, so they survive import/round-trip.
  return {
    ...character,
    skills: [...nextStarting, ...otherSkills],
    startingChoices: choices,
  };
}

// ─── SOURCE-DRIFT GUARD ────────────────────────────────────────────────────────
// STARTING_CHOICES_CONFIG is curated by hand because the MegaDoc's "Starting
// Skills" prose is too irregular to fully parse into the dropdown STRUCTURE (see
// DOC_EDITS_WANTED.md #12). But the SET of skills that prose references IS
// extractable, and that's the thing most likely to drift when the doc is edited.
// configSkillKeys() and sourceStartingSkillKeys() return comparable skill-key sets
// so a test can assert the curated config still covers exactly what the source
// grants — turning silent drift into a loud, located failure.

// Canonical key for a config-or-source skill name (shared with reconciliation).
function skillKey(name: string) {
  return skillMatchKey(name);
}

// The skill keys the curated config can grant for a class (across all blocks +
// options), each tagged so a diff can point at the offending block.
export function configSkillKeys(className: string) {
  const out = new Set();
  for (const block of STARTING_CHOICES_CONFIG[className] || []) {
    for (const s of block.options.flatMap(optionSkills)) out.add(skillKey(s.name));
  }
  return out;
}

// Every skill key a class's "Starting Skills" prose plausibly references. The
// prose structure is too irregular to segment reliably (the ` - ` inside names
// like "Extended Capacity - Novice", inline-vs-header choices, bracket params —
// see DOC_EDITS_WANTED.md #12), so instead of parsing structure we do a
// resolution-driven sweep: try every short contiguous word window and keep the
// ones that resolve to a real entity (via the alias layer). It's a SUPERSET — it
// also picks up fixed grants — which is exactly what the config-coverage guard
// needs ("every config skill is mentioned somewhere in the prose"). This can't be
// fooled by a typo'd config skill, and degrades gracefully (a window that doesn't
// resolve is simply ignored).
export function sourceStartingSkillKeys(className: string) {
  const cls = classesJson.find((c) => c.name === className);
  if (!cls) return new Set();
  const keys = new Set();
  for (const line of cls.startingSkills || []) {
    if (/^Note:/i.test(line)) continue;
    for (const k of resolvableWindows(line)) keys.add(k);

    // Also look for combinations of any tier word in the line with any other words in the line
    const tiers = [...line.matchAll(/\b(Apprentice|Journeyman|Greater|Master)\b/gi)].map((m) => m[1]);
    if (tiers.length > 0) {
      const cleanLine = line
        .replace(/\b(Apprentice|Journeyman|Greater|Master)\b/gi, " ")
        .replace(/\(\d+\)/g, " ")
        .replace(/x\s*\d+/gi, " ")
        .replace(/[,&:[\]()]/g, " ")
        .replace(/\bAND\b/g, " ");
      const words = cleanLine.split(/\s+/).filter(Boolean);
      for (let i = 0; i < words.length; i++) {
        for (let len = 1; len <= 3 && i + len <= words.length; len++) {
          const phrase = words.slice(i, i + len).join(" ");
          for (const tier of tiers) {
            for (const combo of [`${tier} ${phrase}`, `${phrase} ${tier}`]) {
              if (resolveSkill(combo)) keys.add(skillKey(combo));
            }
          }
        }
      }
    }

    // A "Choose … <Tier> [opt, opt]" label distributes its tier word across the
    // bracketed options: "Apprentice Crafting: [Alchemy, Enchanting]" grants
    // "Apprentice Alchemy", "Apprentice Enchanting", … General rule, not per-class.
    const br = line.match(/\b(Apprentice|Journeyman|Greater|Master)\b[^[]*\[([^\]]*)\]/i);
    if (br) {
      for (const opt of br[2].split(/,|\bor\b|\bAND\b/i)) {
        const o = opt.replace(/[()]/g, "").trim();
        for (const combo of [`${br[1]} ${o}`, `${o} ${br[1]}`]) {
          if (o && resolveSkill(combo)) keys.add(skillKey(combo));
        }
      }
    }
  }
  return keys;
}

// All resolvable 1–5-word windows in a prose line, as canonical skill keys. Cost
// "(n)" and rank "xN" markers are stripped; commas/&/AND/brackets become word
// breaks so neighbouring skills don't fuse.
function resolvableWindows(line: string) {
  const out = new Set();
  const words = line
    .replace(/\(\d+\)/g, "")
    .replace(/x\s*\d+/gi, "")
    .replace(/\s*&\s*/g, " and ")
    .replace(/[,:[\]()]/g, " ")
    .replace(/\bAND\b/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    for (let len = 1; len <= 5 && i + len <= words.length; len++) {
      const phrase = words.slice(i, i + len).join(" ");
      if (resolveSkill(phrase)) out.add(skillKey(phrase));
    }
  }
  return out;
}
