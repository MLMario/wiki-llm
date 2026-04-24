---
name: kb-lint
description: Audit the knowledge base wiki for orphan pages, broken wikilinks, stale content, and schema violations. Use when the user asks to lint, audit, validate, health-check, or review the wiki.
---

# kb-lint

Scan the knowledge base wiki for structural problems and data quality issues. Produces a lint report, updates the index orphan watch section, and logs the results.

## Input Parameters

- **None required.** Audits the entire wiki.
- **Optional:** `--staleness-days N` to override the default 180-day staleness threshold.

## Workflow

### Step 1: Read reference/CONTEXT.md

Read `reference/CONTEXT.md` (in this skill's folder) to confirm the current conventions, especially the staleness threshold (default: 180 days).

### Step 2: Inventory All Wiki Pages

1. Use **Glob** to find all `.md` files in `knowledge-base/wiki/`:
   - Pattern: `knowledge-base/wiki/**/*.md`
2. For each file found, use **Read** to load the first 20 lines (frontmatter + first heading).
3. Parse the frontmatter and extract: title, type, tags, created, updated, confidence, sources, source_summaries, related.
4. Build an internal catalog of all wiki pages with their metadata.
5. Count totals: total pages, concepts, entities, source-summaries, comparisons.
6. Use **Read** to load `knowledge-base/source_index.md`. Parse each entry under `## Sources by Date` into `(relative_path, badges, date, tags, one_liner)`. A `[demoted]` token between `[<confidence>]` and `[<YYYY-MM-DD>]` means the summary is flagged demoted. Cache this catalog alongside the wiki inventory for integrity checks in Steps 6.6 and 6.7. If `source_index.md` is missing, record it as a critical finding (see Error Handling) and skip the source-index-scoped checks.

### Step 3: Check -- Orphan Pages (Scope Split)

Orphans live in two separate scopes now that source summaries are indexed in their own file.

**Concept / entity / comparison pages -- checked against `index.md`:**

1. Use **Read** to load `knowledge-base/index.md`.
2. Extract all `[[wikilink]]` references from the index.
3. Compare the list of `wiki/concepts/*.md`, `wiki/entities/*.md`, and `wiki/comparisons/*.md` files against those wikilinks.
4. A page is orphaned if its filename (without `.md`) does not appear as a `[[wikilink]]` in `index.md`.
5. Record all such orphan pages.
6. **Scope exclusion:** source-summary pages (`wiki/sources/*.md`) are **not** in scope for the `index.md` orphan check. Do not flag them here even if they are not referenced in `index.md`.

**Source-summary pages -- checked against `source_index.md`:**

1. Use the `source_index.md` catalog cached in Step 2.
2. For each entry, extract the `wiki/sources/<stem>-summary.md` relative path (entries cite relative paths, not `[[wikilinks]]`).
3. Compare the list of `wiki/sources/*.md` files against those entry paths.
4. Record two failure classes:
   - **Orphan summary page:** a `wiki/sources/*.md` file that has no matching entry in `source_index.md`.
   - **Dangling source-index entry:** an entry path that does not resolve to an existing `wiki/sources/*.md` file.
5. Both failure classes land in the same `Source Orphans` bucket reported in Step 8 and written to the parallel Orphan Watch in Step 9.

### Step 4: Check -- Missing Pages (Referenced but Don't Exist)

1. Use **Grep** to find all `[[wikilink]]` patterns across all wiki/ files:
   - Pattern: `\[\[[a-z0-9-]+\]\]`
   - Path: `knowledge-base/wiki/`
2. Also extract wikilinks from `knowledge-base/index.md`.
3. For each unique wikilink target, check if a matching `.md` file exists anywhere in `knowledge-base/wiki/`:
   - Use **Glob** with pattern: `knowledge-base/wiki/**/{target}.md`
4. Record all wikilinks that point to non-existent pages, along with which files reference them.

### Step 5: Check -- Stale Pages

Today's date is used as the reference point. The staleness threshold is 180 days by default.

1. For each wiki page, calculate the age: `today - updated_date`.
2. Flag pages where the age exceeds the staleness threshold.
3. Also check: if a page's `sources` list references raw/ files, check those raw file dates. If all sources are older than the threshold and no newer sources corroborate, flag as potentially stale.
4. Record all stale pages with their last updated date and age in days.

### Step 6: Check -- Broken Frontmatter

For each wiki page, verify:

1. **Required fields present:**
   - All pages: title, type, tags, created, updated, confidence, sources.
   - Concept / entity / comparison pages (additionally): `source_summaries:`. Source-summary pages do not carry `source_summaries:`.
   - Report any missing fields.
2. **Type matches subdirectory:**
   - `concept` -> must be in `wiki/concepts/`
   - `entity` -> must be in `wiki/entities/`
   - `source-summary` -> must be in `wiki/sources/`
   - `comparison` -> must be in `wiki/comparisons/`
   - Report any mismatches.
3. **Confidence is valid:** Must be one of: `high`, `medium`, `low`. Report invalid values.
4. **Sources exist:** For each path in the `sources` list, use **Glob** to verify the raw/ file exists. Report any broken source references.
5. **Tags not empty:** At least one tag must be present. Report pages with empty tag lists.
6. **Dates are valid:** `created` and `updated` must be valid YYYY-MM-DD dates. `updated` must be >= `created`.

### Step 6.5: Check -- Contradiction State Integrity

Two bidirectional invariants that pair frontmatter flags with body structure. Written by `kb-ingest` (flag time) and `kb-resolve` (clear time); lint's job is to detect drift.

**Block A -- concepts + entities (pair: `has_contradiction` ↔ `## Contradictions` section with >=1 open entry):**

1. For each file in `wiki/concepts/` and `wiki/entities/`:
   - Read frontmatter (already cached in Step 2). Note whether `has_contradiction` is present and its value.
   - Read the body and detect the `## Contradictions` H2. Under it, count H3 entries (`### [YYYY-MM-DD] ...`) whose body contains a line `- **Status:** open`.
2. **Direction 1 -- flag implies entry:** if `has_contradiction: true` but zero open H3 entries under `## Contradictions` (or the section is absent), record failure: `{path} -- has_contradiction: true but no open entries in body`.
3. **Direction 2 -- entry implies flag:** if >=1 open H3 entry exists but `has_contradiction: true` is not set, record failure: `{path} -- open contradiction entries but has_contradiction not set`.
4. Pages with `has_contradiction: false` (or key absent) and zero open entries are clean. The soft-reminder state (`has_contradiction: false` after a prior resolution) is intentional and not a failure.

**Block B -- sources (pair: `has_demoted_or_debunk_claim` ↔ >=1 amendment preamble):**

Detection pattern for an amendment preamble: a body line matching the regex `^> \*\*Amendment -- ` (blockquote, bold, literal "Amendment", double-dash, space). This matches the template written by `kb-resolve` and documented in `kb-ingest/SKILL.md` (Page Templates section).

1. For each file in `wiki/sources/`:
   - Read frontmatter. Note whether `has_demoted_or_debunk_claim` is present and its value.
   - Scan the body for >=1 line matching `^> \*\*Amendment -- `.
2. **Direction 1 -- flag implies preamble:** if `has_demoted_or_debunk_claim: true` but zero amendment preambles detected, record failure: `{path} -- has_demoted_or_debunk_claim: true but no amendment preamble`.
3. **Direction 2 -- preamble implies flag:** if >=1 preamble detected but `has_demoted_or_debunk_claim: true` is not set, record failure: `{path} -- amendment preamble present but flag not set`.

Both blocks are structural only. Do not parse entry content, validate claim text, or cross-check against raw sources -- that's out of scope.

### Step 6.6: Check -- Source Parity

Every concept/entity/comparison page must keep `source_summaries:` in strict 1-to-1 lockstep with `sources:`. Co-owned invariant: `kb-ingest` appends to both on creation/update; `kb-resolve` mutates both in lockstep on adjudication. Lint detects drift; it does not fix.

For each page in `wiki/concepts/*.md`, `wiki/entities/*.md`, and `wiki/comparisons/*.md`:

1. **Length parity:** verify `len(sources) == len(source_summaries)`. If not, record failure: `{path} -- sources/source_summaries length mismatch (N vs M)`.
2. **Slug-derivation coverage:** for each entry `raw/<subdir>/<stem>.md` in `sources:`, derive expected `wiki/sources/<stem>-summary.md` and verify it appears in `source_summaries:`. If not, record: `{path} -- missing source_summaries entry for {raw_path}`.
3. **Summary-page existence:** for each entry in `source_summaries:`, verify the referenced `wiki/sources/*.md` page exists on disk. If not, record: `{path} -- source_summaries points to nonexistent {summary_path}`.

Pages with empty `sources: []` and `source_summaries: []` are clean. Do not auto-fix any drift; report only.

### Step 6.7: Check -- Demoted-Marker Integrity

Bidirectional check paralleling Step 6.5 Block B. Co-owned invariant: `kb-resolve` Step 6b flips `has_demoted_or_debunk_claim: true` on the losing summary page **and** inserts `[demoted]` between `[<confidence>]` and `[<YYYY-MM-DD>]` in the matching `source_index.md` entry. Flag and marker are permanent once set; lint enforces that neither lags the other.

Using the `source_index.md` catalog cached in Step 2 and the source-summary frontmatter cached in Step 2:

1. **Direction 1 -- marker implies flag:** for each `source_index.md` entry whose badge sequence contains `[demoted]`, verify the linked summary page has `has_demoted_or_debunk_claim: true`. Failure: `{path} -- source_index.md entry marked [demoted] but summary flag not set`.
2. **Direction 2 -- flag implies marker:** for each summary page with `has_demoted_or_debunk_claim: true`, verify its `source_index.md` entry carries `[demoted]`. Failure: `{path} -- has_demoted_or_debunk_claim: true but source_index.md entry missing [demoted] marker`.

If `source_index.md` is missing entirely, skip this check and rely on the critical finding raised in Step 2 / Error Handling. Do not parse entry content beyond badge detection; full entry-shape validation is out of scope.

### Step 7: Check -- Unprocessed Raw Files

1. Use **Grep** to search all files in `knowledge-base/raw/` for `status: pending`.
   - Pattern: `status: pending`
   - Path: `knowledge-base/raw/`
2. Count the number of pending files.
3. List them by path.

### Step 8: Generate Lint Report

Compile all findings into a structured report. Output this to the user:

```markdown
## Knowledge Base Lint Report -- YYYY-MM-DD

### Summary
- Total wiki pages: N
- Orphan pages (not in index.md): N
- Source orphans (not in source_index.md): N
- Missing pages (broken wikilinks): N
- Stale pages (>180 days): N
- Broken frontmatter: N
- Contradiction integrity issues: N
- Source parity issues: N
- Demoted-marker issues: N
- Pending raw/ items: N

### Orphan Pages (not in index.md)
- wiki/[subdir]/[filename] -- not referenced in index.md

(or "None found." if clean)

### Source Orphans (source_index.md scope)
- wiki/sources/[filename] -- not listed in source_index.md
- source_index.md entry -- path does not resolve: wiki/sources/[filename]

(or "None found." if clean)

### Missing Pages (wikilinks to non-existent pages)
- [[page-name]] -- referenced by: [list of files that reference it]

(or "None found." if clean)

### Stale Pages
- wiki/[subdir]/[filename] -- last updated YYYY-MM-DD (N days ago)

(or "None found." if clean)

### Frontmatter Issues
- wiki/[subdir]/[filename] -- [description of the issue]

(or "None found." if clean)

### Contradiction State Integrity
- wiki/[subdir]/[filename] -- [description of the drift]

(or "None found." if clean)

### Source Parity
- wiki/[subdir]/[filename] -- [description of the parity drift]

(or "None found." if clean)

### Demoted-Marker Integrity
- wiki/sources/[filename] -- [description of the drift]

(or "None found." if clean)

### Pending Ingest
- N files in raw/ with status: pending
  - raw/[subdir]/[filename]

(or "No pending files." if clean)
```

### Step 9: Update Index Orphan Watch

Two parallel Orphan Watch sections, one per index scope.

1. **`knowledge-base/index.md` -- concept / entity / comparison orphans:**
   - Use **Edit** to replace the content under the `## Orphan Watch` heading.
   - Write the current list of concept/entity/comparison orphan pages (Step 3 first block).
   - Also list missing pages (wikilinks to non-existent pages) here.
   - Do **not** include source-summary pages in this section -- they are out of scope for `index.md`.
   - If no orphans or missing pages, write `- (none)`.
2. **`knowledge-base/source_index.md` -- source-summary orphans:**
   - Use **Edit** to replace the content under the `## Orphan Watch` heading at the bottom of `source_index.md` (created/seeded during Phase 0).
   - Write the current list of source-summary orphan pages and dangling source-index entries (Step 3 second block).
   - If `source_index.md` has no `## Orphan Watch` section, append one at the end of the file.
   - If no issues, write `- (none)`.

### Step 10: Update Log

1. Use **Read** to load `knowledge-base/log.md`.
2. Prepend a new log entry:

```markdown
## [YYYY-MM-DD] lint | Routine health check
- **Total wiki pages:** N
- **Orphan pages found:** N
- **Missing pages (broken wikilinks):** N
- **Stale pages flagged:** N
- **Broken frontmatter:** N
- **Contradiction integrity issues:** N
- **Source parity issues:** N
- **Demoted-marker issues:** N
- **Source orphans (source_index.md):** N
- **Pending raw/ items:** N
- **Action taken:** [brief description, e.g., "Updated orphan watch in index.md and source_index.md" or "No issues found"]
```

3. Use **Edit** or **Write** to save the updated log.md.

## Error Handling

- **No wiki pages found:** Report "The wiki is empty. No pages to lint. Use kb-drop and kb-ingest to add content first."
- **Index.md is missing:** Report "knowledge-base/index.md does not exist. Cannot check for orphans. Create the index first."
- **Log.md is missing:** Create it with the initial structure before prepending.
- **Frontmatter parse error:** Report the file as having broken frontmatter. Do not skip other checks for that file.
- **`source_index.md` missing entirely:** Report as a Phase 0 migration regression: *"knowledge-base/source_index.md not found; source-summary retrieval is broken until recreated."* Offer to recreate it by rerunning the Phase 0 migration. **Do not auto-fix.** Skip Steps 6.7 and the source-orphan half of Step 3; continue the rest of the run.
- **Source parity drift (Step 6.6 failure):** Report under the `Source Parity` section with the specific diagnostic. Do not auto-fix -- the writer skills (kb-ingest, kb-resolve) own these mutations.
- **Demoted-marker drift (Step 6.7 failure):** Report bidirectionally under `Demoted-Marker Integrity`. Do not auto-fix -- kb-resolve owns the flag ↔ marker pair.

## Configuration

- **Staleness threshold:** 180 days (default). Can be overridden by the user at invocation.
- **This value is also defined in `reference/CONTEXT.md`.** If the user changes it there, this skill should respect the scoped-file value unless overridden at invocation.

## Frontmatter Schema Reference

### wiki/ Page Frontmatter (expected)

```yaml
---
title: "Page Title"                              # Required, string
type: concept | entity | source-summary | comparison  # Required, enum
tags: [tag1, tag2, tag3]                         # Required, list, min 1 item
created: 2026-04-15                              # Required, YYYY-MM-DD
updated: 2026-04-15                              # Required, YYYY-MM-DD, >= created
confidence: high | medium | low                  # Required, enum
sources:                                         # Required, list, min 1 item
  - raw/articles/2026-04-15-example.md           # Must point to existing raw/ file
source_summaries:                                # Required on concept/entity/comparison pages; omitted on source-summary pages.
  - wiki/sources/2026-04-15-example-summary.md   # Strict 1-to-1 parity with sources:; slug-derived (raw/<subdir>/<stem>.md -> wiki/sources/<stem>-summary.md).
related:                                         # Optional, list
  - "[[another-page-name]]"                      # Must use [[wikilink]] syntax
has_contradiction: true                          # Optional, bool; concept/entity pages only.
                                                 #   true  -> pair with >=1 open H3 entry under `## Contradictions` (Phase 4 check A).
                                                 #   false -> soft reminder that the page once held a contradiction (kept after last resolve).
                                                 #   absent -> page has never held a contradiction.
has_demoted_or_debunk_claim: true                # Optional, bool; source-summary pages only.
                                                 #   true  -> pair with >=1 amendment preamble matching ^> \*\*Amendment -- (Phase 4 check B).
                                                 #   Permanent once set; not cleared by future resolutions.
---
```
