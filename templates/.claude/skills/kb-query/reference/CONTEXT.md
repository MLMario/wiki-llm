# kb-query — Scoped Context

> Scoped schema and conventions for the `kb-query` skill. Travels with the skill; read at runtime via `reference/CONTEXT.md`.
> Shared-rule drift: if you edit a rule that also appears in sibling KB skills (`kb-drop`, `kb-ingest`, `kb-resolve`, `kb-lint`), sync it across each skill's `reference/CONTEXT.md`.

The wiki/ frontmatter schema (used when filing an answer) is already inlined in this skill's `SKILL.md`. This file covers the index/wikilink conventions used on every query, the raw-source material needed when a query reaches into `raw/`, and the page templates used only if the user files an answer.

## Directory Structure

```
knowledge-base/
  raw/                        # Source inbox (READ-ONLY from kb-query; gated)
    articles/  papers/  notes/  misc/
  wiki/
    concepts/  entities/  comparisons/    # Content layer — default query surface
    sources/                              # Provenance layer — READ ONLY when source_mode = true
  index.md                    # Main index — entry point, read first on every query
  source_index.md             # Flat chronological index of source-summary pages; READ ONLY when source_mode = true
  log.md                      # Processing log (prepend only if filing)
```

## Access Control (kb-query)

- kb-query is **read-only by default.** It only writes when the user explicitly asks to file the answer.
- **Sources are behind a permission gate.** `wiki/sources/*.md` and `knowledge-base/source_index.md` are **never** read unless the Step 2 gate resolves to `source_mode = true` (LLM self-check says yes AND user confirms). See "Source-Mode Self-Check Gate" below.
- kb-query **may read `raw/`** only when `source_mode = true` and the LLM needs to grep a source body for contradiction judgment. It must NEVER write to `raw/`. Only `kb-drop` writes there.
- When surfacing content originating in a raw/ file, always cite the associated source-summary page (`wiki/sources/{slug}-summary.md`) — never the raw path. The source-summary page is the only citable form of a source in a query answer.

## Wiki Page `sources:` / `source_summaries:` Semantics

Every `wiki/concepts/*.md`, `wiki/entities/*.md`, and `wiki/comparisons/*.md` page carries two parallel frontmatter lists: `sources:` (raw paths) and `source_summaries:` (derived summary-page paths). Both reflect **currently endorsed** provenance — not full history.

**Parity invariant** (co-owned by `kb-ingest` and `kb-resolve`; enforced by `kb-lint`):

- Length: `len(sources) == len(source_summaries)` on every concept/entity/comparison page.
- Slug-derivation: for every `raw/<subdir>/<stem>.md` in `sources:`, the matching `source_summaries:` entry is `wiki/sources/<stem>-summary.md`, at the same list index.
- Empty lists are valid (`sources: []` + `source_summaries: []`) but must match.
- Source-summary pages themselves do not carry `source_summaries:` — their own `sources:` points to a single raw/ file and no mirror is needed.

Writer activity the reader should be aware of:

- `kb-ingest` appends new raw paths on update (with one exception: a raw path is held out of `sources:` — AND its derived summary path is held out of `source_summaries:` in lockstep — on a page where the source's claim is the flagged contradiction).
- `kb-resolve` may add winner paths or remove loser paths when adjudicating a contradiction; each mutation mirrors across both lists.

Implications for query answering:

- Treat `sources:` / `source_summaries:` as the live endorsement list. Cite from them freely.
- **Anchor-based retrieval** (Step 3, `source_mode = true`): when the user opts in, follow the concept/entity/comparison page's `source_summaries:` to reach the relevant summary pages directly — no scan of `source_index.md` needed.
- If a source was demoted during resolution, its raw path may be absent from `sources:` even though the source once contributed to the page. The source-summary page in `wiki/sources/` will carry one or more `> **Amendment -- ...**` preambles recording the demotion, and its `source_index.md` entry carries a `[demoted]` badge.
- If the user asks about historical provenance ("what did we used to think?", "which source got overruled?"), consult `log.md` resolve entries and the amendment preambles on source-summary pages — not just `sources:`. Reading these still requires `source_mode = true`.
- A page whose frontmatter has `has_contradiction: true` has ≥1 unresolved contradiction; any answer drawing from that page should flag the open dispute. This is the **ingest-time** contradiction mechanism, distinct from query-time contradiction surfacing (see below).

## Cross-References (`[[wikilink]]` Syntax)

- Use `[[page-name]]` — no subdirectory path, no `.md` extension.
- `page-name` matches the filename without `.md`. Example: `[[llm-knowledge-base]]` resolves to `wiki/concepts/llm-knowledge-base.md`.
- **Every claim in a query answer must be cited.** Concept, entity, and comparison pages use `[[wikilink]]` form. Source summaries are the one exception: they use their **relative path** `wiki/sources/<stem>-summary.md` (not a wikilink) — see the "Citation format" subsection under Query-Relevant Conventions below.

## Index Format

Two indexes, two scopes, two access modes.

### `index.md` (main — read on every query)

The master index (`knowledge-base/index.md`) is the entry point for every query.

- Organized by tag/topic in H3 sections.
- Entry format: `- [[page-name]] [type] [confidence] -- one-line summary`
- Stats line at top summarizes totals (concepts / entities / comparisons). **Source summaries are not counted here.**
- Pages sorted alphabetically within each topic section.
- Pages tagged with multiple topics appear under each relevant section.
- **Scope:** concept / entity / comparison pages only. Source-summary pages are not listed here.

When scanning the index, match the query against:
- Topic section headings (H3).
- Page titles in entry lines.
- `[type]` and `[confidence]` badges.
- One-line summary text.

### `source_index.md` (provenance — read only when `source_mode = true`)

Flat, chronological (newest first) index of every source-summary page. Lives at `knowledge-base/source_index.md`. **Do not read this file unless Step 2's gate resolves to `source_mode = true`.**

- Header: `> Last updated: YYYY-MM-DD` and `> Total sources: N | Articles: N | Papers: N | Notes: N | Misc: N | Demoted: N`
- Entry format: `- <path> [source-summary] [<confidence>] [demoted?] [<YYYY-MM-DD>] [<tag1, tag2>] -- <one-line summary>`
- `<path>` is a relative path `wiki/sources/<stem>-summary.md`, **not** a wikilink — per decision 6 of the sources-layer design.
- `[demoted]` badge is inserted between `[confidence]` and `[date]` when the summary's frontmatter has `has_demoted_or_debunk_claim: true`. Omitted otherwise.
- Sort: `created:` descending. Ties broken alphabetically by path.
- Bottom may contain a `## Orphan Watch` section written by `kb-lint` — treat as informational.

When scanning `source_index.md` for the anchorless fallback path, match the query against:
- Dates in each entry (for "last week", "in 2026", "after April" queries).
- Tags.
- One-line summary text.
- The `[demoted]` badge (for historical-provenance queries).

## Raw File Format

Every file in `raw/` has this YAML frontmatter:

```yaml
---
title: "Descriptive title of the source"
source: "https://example.com/article-url"
type: article | paper | note | misc
status: pending | ingested | skipped
dropped_date: 2026-04-15
tags: [tag1, tag2]
---
```

### Field Definitions

| Field | Description |
|---|---|
| title | Human-readable title. |
| source | Original URL, `"local"` (file), or `"manual"` (typed note). |
| type | One of: `article`, `paper`, `note`, `misc`. Determines subdirectory. |
| status | `pending` = awaiting ingest. `ingested` = compiled into wiki. `skipped` = intentionally excluded. |
| dropped_date | Date the file was added to raw/ (YYYY-MM-DD). The schema carries only this one date field; publication-date extraction is out of scope. |
| tags | Optional list of user-provided tags. |

### Raw Filename Convention

Format: `YYYY-MM-DD-slug.md`
- `YYYY-MM-DD` = drop date.
- `slug` = title in kebab-case, ≤60 chars, ASCII only.
- The slug is reused with a `-summary` suffix for the corresponding source-summary wiki page: `wiki/sources/{slug}-summary.md`. This is how kb-query correlates a raw file with its wiki source-summary.

### Status Awareness

- `status: pending` raw files are **not yet compiled** into the wiki. If a query would be better answered by material in a pending raw file, surface that to the user as a gap ("content exists in `raw/...` but has not been ingested yet") rather than silently ignoring. Do not read the raw file.
- `status: skipped` raw files were intentionally excluded. Do not cite.
- `status: ingested` raw files have a corresponding `wiki/sources/` summary page. When `source_mode = true` and a source needs to be cited, **always cite the summary page**, never the raw path. When `source_mode = false`, do not read the raw file or the summary page at all.

## Confidence Levels

- `high` = multiple corroborating sources.
- `medium` = single authoritative source.
- `low` = inferred or speculative.

If an answer relies heavily on `low`-confidence pages, flag that in the response. Raw files have no confidence field — if citing raw material directly, infer from the source type (established publication → high; blog/single-author → medium; unverified → low).

## Image Handling (v1)

`raw/` may contain image files. These are **not** compiled into wiki pages — only noted in source summaries. If kb-query encounters an image file in `raw/`, reference the path but do not attempt to extract content from it.

## Query-Relevant Conventions

### Source-Mode Self-Check Gate

kb-query's Step 2 is a two-signal gate that controls whether source-summary pages and `source_index.md` are read for this query.

- **Default state:** `source_mode = false`. Sources are not touched.
- **Signal 1 — LLM self-check.** Default answer: no. Ask: *"Given this query, do I need sources to answer it?"* The inputs to that judgment are documentation guidance only — there is no hardcoded trigger list, no intent classifier, no keyword table. Typical reasons to say yes: user explicitly asked for sources; the question is pure provenance/recency ("what did I read last week"); source-level detail would meaningfully extend / validate / challenge the wiki content.
- **Signal 2 — user confirmation.** If the self-check says yes, emit a permission prompt that **states the reason** (so the user can see whether the judgment is sound and decline if not): *"This query would benefit from source summaries because [reason]. Want me to search them? [y/n]"*
- **Both signals required.** `source_mode = true` iff (self-check yes) AND (user replies yes). Ambiguous replies ("maybe", off-topic text) count as no. **Fail closed.**
- **Do not retry or nag** on decline. Answer content-only.
- **False positives are acceptable** (gate fires unnecessarily — one extra y/n turn). False negatives (skipped sources that were load-bearing) are worse — err toward asking when the judgment is close.
- **Shared-rule drift note:** the gate principle ("sources are never read without an explicit user yes") is the governing invariant for the sources-layer design — mirrored in the design spec Section 4.1 and in `knowledge-base/CONTEXT.md`. If the wording changes, sync all three.

### Two Retrieval Paths Behind One Gate

When `source_mode = true`, source-summary candidates are selected via exactly one of two paths. Both reuse the same Step 2 gate — there is no second permission prompt and no parallel retrieval machinery.

- **Anchor-based (primary).** If Step 1+3 identified concept/entity/comparison anchors, collect the `source_summaries:` frontmatter entries from those anchor pages. These are the relevant source-summary pages by construction — no scan of `source_index.md` is needed or performed.
- **Anchorless fallback.** If no concept/entity/comparison anchor exists (pure provenance query — e.g., "which articles did I read last week about X"), read `source_index.md` and scan chronologically. Pick top candidates by date cues, tags, and keyword matches against each entry's one-line summary.
- **Degradation:** if the anchor-based path finds an anchor but its `source_summaries:` list is empty (where entries were expected), the LLM judges whether to fall back to `source_index.md` or report the gap and proceed content-only.
- **Scope:** neither path is ever triggered with `source_mode = false`. Do not peek at `source_index.md` or any `wiki/sources/` file before the gate resolves.

### Query-Time Contradiction Surfacing

kb-query has **two distinct** contradiction mechanisms; they must not be conflated.

- **Ingest-time contradictions** (written): flagged by `kb-ingest` when a new source disagrees with an existing page. Materialize as an H3 entry under `## Contradictions` on the affected page plus `has_contradiction: true` in frontmatter. Adjudicated via `/kb-resolve`. kb-query **reads** these and presents both views when they touch the query.
- **Query-time contradictions** (narrative): surfaced by kb-query only when `source_mode = true` and a source summary disagrees with the content-layer claim on the page. Rendered in the answer's `### Source corroboration` subsection.
  - **Never written anywhere.** kb-query does not modify any page body or frontmatter, does not append to any `## Contradictions` section, does not set `has_contradiction:`, does not touch `log.md`, does not update `source_summaries:`.
  - **Narrative only, this answer only.** The user can choose to re-run `/kb-ingest` on the raw source if they want a persistent record.
  - This separation preserves kb-query's read-only-by-default principle while still letting the user see disagreements the ingest pass may have missed.

### Citation Format

Every claim in a query answer carries a citation. Two forms, applied by page type (per decision 6 of the sources-layer design):

- **Concept / entity / comparison pages:** `[[page-name]]` wikilink. No subdirectory path, no `.md` extension. Example: `[[llm-knowledge-base]]`.
- **Source-summary pages:** relative path `wiki/sources/<stem>-summary.md`. **Not** a wikilink. Example: `wiki/sources/2026-04-22-building-knowledge-bases-llms-maintain-summary.md`.

The relative-path form for sources is deliberate: it keeps the conceptual distinction between the content layer (concepts/entities/comparisons) and the provenance layer (source summaries) visible in every answer.

The "Sources Consulted" output section is split into two sub-lists accordingly:

```markdown
**Pages:**
- [[concept-name]]
- [[entity-name]]

**Source summaries:**   ← only when source_mode = true
- wiki/sources/<stem>-summary.md
```

Never cite `raw/` paths directly in a query answer — always cite the derived source-summary page.

---

## Filing an Answer (only when user explicitly asks)

When the user says "file this", "save this", or "make a page", kb-query writes a new wiki page. Use the wiki/ frontmatter schema at the bottom of this skill's `SKILL.md` and one of the page-body templates below.

### Concept Page Template

```markdown
# [Concept Name]

**TLDR:** [One sentence summary.]

## Description

[2-4 paragraphs explaining the concept.]

## Key Properties

- [Bullet]

## Counterarguments / Gaps

- [Known limitations or open questions]

## See Also

- [[related-page]] -- [brief reason for relation]
```

### Comparison Page Template

```markdown
# [A] vs [B]

**TLDR:** [One sentence summarizing the key trade-off.]

## Comparison

| Dimension | [A] | [B] |
|-----------|-----|-----|
| [Dim 1]   | ... | ... |
| [Dim 2]   | ... | ... |

## When to Choose [A]

- [Scenario]

## When to Choose [B]

- [Scenario]

## See Also

- [[a-page]] -- [brief note]
- [[b-page]] -- [brief note]
```

### Log Entry on Filing

Prepend to `log.md` (which is prepend-only, newest at top):

```markdown
## [YYYY-MM-DD] query | "{original question}"
- **Pages consulted:** {comma-separated list}
- **Answer filed as page:** wiki/{subdir}/{filename} (or "not filed")
- **Index updated:** Yes/No
```
