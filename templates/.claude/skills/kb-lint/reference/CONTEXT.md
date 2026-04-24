# kb-lint — Scoped Context

> Scoped schema and conventions for the `kb-lint` skill. Travels with the skill; read at runtime via `reference/CONTEXT.md`.
> Shared-rule drift: if you edit a rule that also appears in sibling KB skills (`kb-drop`, `kb-ingest`, `kb-resolve`, `kb-query`), sync it across each skill's `reference/CONTEXT.md`.

The wiki/ frontmatter schema with validation annotations is already inlined in this skill's `SKILL.md`. This file covers the conventions lint enforces and the structural rules it validates against.

## Directory Structure

```
knowledge-base/
  raw/                        # Source inbox (lint checks status: pending)
    articles/  papers/  notes/  misc/
  wiki/                       # Compiled pages (lint walks every file)
    concepts/  entities/  sources/  comparisons/
  index.md                    # Concept/entity/comparison index (read; lint updates Orphan Watch)
  source_index.md             # Source-summary index (read; lint updates parallel Orphan Watch)
  log.md                      # Processing log (prepend lint entry)
```

## Wiki Filename Convention

- Format: `kebab-case-topic-name.md` matching the concept/entity name.
- ASCII only. Lowercase. Letters, digits, and hyphens only.
- Any wiki file not matching this convention is a lint failure.

## Type ↔ Subdirectory Mapping

Each wiki page's frontmatter `type` must match its subdirectory. Mismatches are lint failures.

| type | subdirectory |
|---|---|
| concept | `wiki/concepts/` |
| entity | `wiki/entities/` |
| source-summary | `wiki/sources/` |
| comparison | `wiki/comparisons/` |

## Cross-References (`[[wikilink]]` Syntax)

- Always `[[page-name]]` — no subdirectory path, no `.md` extension.
- Detection pattern: `\[\[[a-z0-9-]+\]\]`
- A wikilink is **broken** if `page-name` does not match any `.md` file under `knowledge-base/wiki/`.
- A wiki page is **orphan** if its filename (without `.md`) does not appear as a `[[wikilink]]` anywhere in `knowledge-base/index.md`.

## Index Format

Two indexes, two scopes. Keep them distinct.

**`index.md` (concepts / entities / comparisons):**

- Entry format: `- [[page-name]] [type] [confidence] -- one-line summary`
- Every concept, entity, and comparison page must appear as an entry in at least one topic section.
- Source-summary pages are **not** listed here — they live in `source_index.md`.
- The `## Orphan Watch` section is owned by `kb-lint` — lint **replaces** its content on each run.
- Stats line at top: `> Total pages: N | Concepts: N | Entities: N | Comparisons: N` (no `Sources:` field post-Phase 0).

**`source_index.md` (source-summary layer):**

- Entry format: `- wiki/sources/<stem>-summary.md [source-summary] [<confidence>] [demoted?] [<YYYY-MM-DD>] [<tag1, tag2>] -- <one-line summary>`
- Relative path, **not** a wikilink (design decision 6).
- Every `wiki/sources/*.md` page must have exactly one entry; every entry must resolve to an existing page.
- `[demoted]` badge appears between `[<confidence>]` and `[<YYYY-MM-DD>]` iff the linked summary has `has_demoted_or_debunk_claim: true`.
- Sorted newest-first by `[<YYYY-MM-DD>]`; ties broken alphabetically by path.
- Header: `> Last updated: YYYY-MM-DD` + stats line `> Total sources: N | Articles: N | Papers: N | Notes: N | Misc: N | Demoted: N`.
- A `## Orphan Watch` section at the bottom mirrors `index.md`'s — owned by `kb-lint`, replaced each run.

## Log Format

- `log.md` is prepend-only (newest entries at top of file).
- Lint entry heading format: `## [YYYY-MM-DD] lint | {brief description}`

## Lint-Relevant Conventions

- **Filenames:** kebab-case, ASCII only. Applies to every wiki and raw file.
- **Staleness threshold:** 180 days since `updated` date. Default; overridable at invocation via `--staleness-days N`. If the user overrides at invocation, the override wins over this file.
- **Confidence levels:** must be exactly one of `high`, `medium`, `low`. Any other value is a lint failure.
  - `high` = multiple corroborating sources.
  - `medium` = single authoritative source.
  - `low` = inferred or speculative.
- **Date format:** `YYYY-MM-DD` for `created`, `updated`, `dropped_date`. `updated` must be `>= created`. Invalid dates are a lint failure. (Legacy raw files carrying `date:` or `dropped:` were migrated; the current schema emits only `dropped_date`.)
- **Tags:** at least one tag per wiki page. Empty tag list is a lint failure.
- **Sources:** every entry in a page's `sources` list must point to an existing raw/ file. Broken source references are a lint failure. The `sources:` list is co-owned: `kb-ingest` appends on update, `kb-resolve` may add winner paths or remove loser paths on adjudication. Lint only verifies every listed path exists in `raw/`; it does not care which skill wrote the entry and does not expect `sources:` to reflect full historical provenance.
- **TLDR:** one TLDR sentence per page, immediately after the H1 heading. (Optional check.)
- **Image handling (v1):** `raw/` may contain image files. Lint should not flag image files as "unprocessed raw" nor demand a wiki page for them.

### Contradiction State Integrity

Two bidirectional flag ↔ body invariants. Co-owned convention: `kb-ingest` writes the flag + H3 entry at flag time; `kb-resolve` (Phase 3) writes the preamble + clears the entry at resolve time. Lint only detects drift; it does not fix.

**Concepts + entities (`wiki/concepts/*.md`, `wiki/entities/*.md`):**

- Pair: `has_contradiction: true` in frontmatter ↔ at least one open H3 entry under a `## Contradictions` section in the body.
- Open-entry detection: an H3 under `## Contradictions` whose body includes a bullet line exactly matching `- **Status:** open`.
- Failure modes (both reported):
  - `has_contradiction: true` but no open entries in body.
  - Open contradiction entries but `has_contradiction` not set to `true`.
- Intentional steady state (not a failure): `has_contradiction: false` with zero open entries. The key is kept as a soft reminder after the last resolve.

**Sources (`wiki/sources/*.md`):**

- Pair: `has_demoted_or_debunk_claim: true` in frontmatter ↔ at least one amendment preamble in the body.
- Preamble detection: a line matching the regex `^> \*\*Amendment -- ` (blockquote + bold + literal "Amendment" + double-dash + space). Template is defined in `kb-ingest/SKILL.md` under "Amendment Preamble (prepended to a Source Summary when a claim is demoted)".
- Failure modes (both reported):
  - `has_demoted_or_debunk_claim: true` but no amendment preamble present.
  - Amendment preamble present but flag not set.
- The flag is permanent once set; lint does not care how many preambles are stacked, only that at least one exists when the flag is true.

**Shared-rule drift note:** if the H3 entry template, the `- **Status:** open` marker, or the preamble blockquote prefix changes, sync both lint (this file + `kb-lint/SKILL.md` Step 6.5) and the writer skills (`kb-ingest/SKILL.md` templates; the Phase 3 `kb-resolve` writer when it lands).

### Source Parity Invariant

Every concept/entity/comparison page carries two parallel frontmatter lists: `sources:` (raw paths) and `source_summaries:` (derived summary-page paths). Strict 1-to-1 parity is the invariant; co-owned by `kb-ingest` (creation / update append) and `kb-resolve` (Step 6a mutations). Lint only detects drift — it does not fix.

- **Length invariant:** `len(sources) == len(source_summaries)` on every concept, entity, and comparison page. Empty lists are fine (`sources: []` + `source_summaries: []`) but must match.
- **Slug-derivation rule:** for every entry `raw/<subdir>/<stem>.md` in `sources:`, the matching `source_summaries:` entry is `wiki/sources/<stem>-summary.md`. Same order, same index across both lists.
- **Existence rule:** every `source_summaries:` path must resolve to an existing `wiki/sources/*.md` file.
- **Failure reporting shape** (Step 6.6):
  - `{path} -- sources/source_summaries length mismatch (N vs M)`
  - `{path} -- missing source_summaries entry for {raw_path}`
  - `{path} -- source_summaries points to nonexistent {summary_path}`
- **Shared-rule drift note:** if the slug-derivation rule or the `source_summaries:` field name changes, sync `kb-ingest/reference/CONTEXT.md`, `kb-resolve/reference/CONTEXT.md`, this file, and `kb-lint/SKILL.md` Step 6.6.

### Demoted-Marker Integrity

Bidirectional flag ↔ badge pair that mirrors Block B of Contradiction State Integrity, but crosses the frontmatter boundary: the source-summary page carries the flag, `source_index.md` carries the badge. Co-owned writer is `kb-resolve` Step 6b; lint detects drift only.

- **Pair:** `has_demoted_or_debunk_claim: true` on `wiki/sources/<stem>-summary.md` ↔ `[demoted]` token between `[<confidence>]` and `[<YYYY-MM-DD>]` in the matching `source_index.md` entry.
- **Detection pattern:** a `[demoted]` bracket-token appearing after the confidence bracket and before the date bracket on an entry line under `## Sources by Date`. Do not validate full entry shape — scope is bracket-token presence only.
- **Failure modes (both reported):**
  - `{path} -- source_index.md entry marked [demoted] but summary flag not set`
  - `{path} -- has_demoted_or_debunk_claim: true but source_index.md entry missing [demoted] marker`
- **Permanence:** the flag is permanent once set (non-goal: re-endorsement). Lint does not enforce one-marker-per-page — re-demoting the same source from another page is idempotent on both sides; the flag stays true and the badge stays present.
- **Shared-rule drift note:** if the marker token, its position, or the entry badge layout changes, sync `kb-resolve/reference/CONTEXT.md` (Step 6b writer rules), this file, and `kb-lint/SKILL.md` Step 6.7.

### Orphan Scope Split

Post-Phase 0, orphan detection lives in two separate scopes. Do not cross-pollute.

- **`index.md` scope:** concept, entity, and comparison pages. Orphan = filename (without `.md`) not present as a `[[wikilink]]` anywhere in `index.md`. Source-summary pages are **out of scope** here; do not flag them as orphans against `index.md`, even if they appear in no topic section.
- **`source_index.md` scope:** source-summary pages only. Matched by relative path, **not** wikilink. Two failure classes:
  - Orphan summary page: `wiki/sources/*.md` file with no entry in `source_index.md`.
  - Dangling index entry: an entry path that does not resolve to an existing file.
- Both scopes feed their own `## Orphan Watch` section (Step 9): `index.md` for concept/entity/comparison orphans, `source_index.md` for source-summary orphans. Never write source-summary orphans into `index.md`'s Orphan Watch, and vice-versa.

## Scale Limits

- **Wiki target:** up to 200 pages. Over this, recommend splitting `index.md` into sub-indexes by topic.
- **Index size:** if `index.md` exceeds 500 lines, flag for split.
- **Page size:** single wiki page exceeding 300 lines should be flagged for split into sub-pages.
- **Log size:** if `log.md` exceeds 200 entries, recommend archiving older entries to `knowledge-base/archive/log-YYYY.md`.
