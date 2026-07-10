# scripts/linker/

The **reference-graph / mechanics-extraction pipeline** and its audits. These are
not "debug" scripts — they build and validate the data layer the app reads.

| Script                   | What it does                                                                                                                                        | Run                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `link-audit.js`          | Surfaces likely-missed references in the reference graph (near-miss prereqs, fuzzy matches) so curation gaps in the linker are visible, not silent. | `npm run link:audit`                                                             |
| `link-coverage-audit.js` | Finds capitalized phrases in entity bodies that the matcher did NOT link — candidate game-terms missing from the registry / CURATED aliases.        | `node scripts/linker/link-coverage-audit.js`                                     |
| `extract-mechanics.mjs`  | PROSE → MECHANICS extraction. Surfaces mechanical rules stated in descriptions that the parser/refs don't structure (the audit blind spot).         | `node --import ./scripts/register-json.mjs scripts/linker/extract-mechanics.mjs` |
| `doc-feedback.js`        | Generates `DOC_FEEDBACK.md` — doc-side issues (case/spelling/compounds) for the people who write the MegaDoc.                                       | `npm run doc:feedback`                                                           |

The linker proper is `scripts/link-refs.js` (writes `src/data/refs.json`); the parser
is `scripts/parse-megadoc.js`. These audits run alongside them.

> Keep this directory for the linker pipeline. One-off codemods, screenshot helpers,
> and interactive probes live in `scripts/debug/`; throwaway scripts shouldn't be
> dropped into `scripts/` root (it's the curated tooling surface).
