# kb-ingest — Scoped Context

> Scoped reference for the **orchestrator** (`/kb-ingest` SKILL.md) and **kb-wiki-update**
> (Agent 3, the only writer in the multi-agent pipeline). Agents 1 (kb-extract-explore)
> and 2 (kb-analyzer) inline the narrow conventions they need into their own agent
> definition bodies under `.claude/agents/`.
>
> Shared-rule drift: if you edit a rule that also appears in sibling KB skills
> (`kb-drop`, `kb-resolve`, `kb-lint`, `kb-query`), sync it across each skill's
> `reference/CONTEXT.md`.

## Directory Structure

```
knowledge-base/
  raw/                        # Inbox (read from)
    articles/  papers/  notes/  misc/
  wiki/                       # Compiled output (write to)
    concepts/  entities/  sources/  comparisons/
  index.md                    # Master index for concept/entity/comparison pages (read + update)
  source_index.md             # Flat chronological index of source-summary pages (read + update)
  log.md                      # Processing log (prepend)
```

## Wiki Filename Convention

- Format: `kebab-case-topic-name.md` matching the concept/entity name.
- ASCII only. Lowercase. Letters, digits, and hyphens only.
- Examples:
  - `wiki/concepts/llm-knowledge-base.md`
  - `wiki/entities/andrej-karpathy.md`
  - `wiki/sources/2026-04-15-karpathy-llm-wiki-summary.md`
  - `wiki/comparisons/rag-vs-llm-wiki.md`
- Source-summary pages reuse the raw file's slug with a `-summary` suffix.

## Cross-References (`[[wikilink]]` Syntax)

Always use `[[page-name]]` wikilink syntax — **no subdirectory path, no `.md` extension**.

`page-name` matches the filename without `.md`.

Example: `[[llm-knowledge-base]]` resolves to `wiki/concepts/llm-knowledge-base.md`.

## Index Format

The master index (`knowledge-base/index.md`) is organized by tag/topic (H3 sections).

### Index Conventions

- Entry format: `- [[page-name]] [type] [confidence] -- one-line summary`
- Example: `- [[llm-knowledge-base]] [concept] [high] -- Plain-markdown wiki compiled by LLM from raw sources`
- Sorted alphabetically within each topic section.
- Every **concept, entity, and comparison** page must appear in at least one topic section. **Source-summary pages are not in `index.md`** — they are indexed in `source_index.md` (see Source Index Conventions below).
- A page tagged with multiple topics appears under each relevant section.
- The "Orphan Watch" section is owned by `kb-lint` — **do not overwrite it during ingest.**
- The "Recent Activity" section shows the last 10 operations in summary form — ingest prepends its entry and trims to 10. Activity bullets may mention source-summary counts narratively (e.g., "4 source summaries") but must never wikilink to summary pages.
- The stats line at the top takes the form:
  `> Total pages: N | Concepts: N | Entities: N | Comparisons: N`
  — **no `Sources: N` field**; that belongs to `source_index.md`'s stats line.

## Source Index Conventions

`knowledge-base/source_index.md` is the flat, chronological index of source-summary pages, separate from `index.md` by design (source summaries are a distinct retrieval layer behind kb-query's permission gate).

- Entry format: `- wiki/sources/<stem>-summary.md [source-summary] [<confidence>] [demoted?] [<YYYY-MM-DD>] [<tag1, tag2>] -- <one-line summary>`
- Path is a **relative path, not a wikilink**.
- `[demoted]` badge sits between `[<confidence>]` and `[<YYYY-MM-DD>]`; kb-ingest never writes it — only kb-resolve inserts it when a claim is demoted. Omit on creation.
- Sorted by `created:` descending (newest first); ties broken alphabetically by path.
- Stats line form: `> Total sources: N | Articles: N | Papers: N | Notes: N | Misc: N | Demoted: N`. Subtype derived from the raw file's subdirectory.
- `> Last updated:` line reflects the most recent append.
- `## Orphan Watch` at the bottom is owned by `kb-lint` — **do not overwrite during ingest.**

## Log Format

- `log.md` is prepend-only (newest entries at the top of the file).
- Ingest entry heading format: `## [YYYY-MM-DD] ingest | "{source title}"`

## Image Handling

- `raw/` may contain image files. Note their paths in the source-summary page but do not ingest images into wiki pages.

## Staging Directory Conventions

The orchestrator uses `knowledge-base/.kb-ingest-staging/<source-stem>/` as a
per-source scratchpad shared by the three subagents:

- Hidden (leading `.`) and gitignored.
- Created by orchestrator before the Agent 1 spawn.
- Per-source files: `01-extract.md` (Agent 1 output), `02-analysis.md` (Agent 2 output).
- Persists on every outcome (success and failure) for v1 quality inspection.
- Cleaned only via the pre-flight gate at the next run, with user confirmation.

## `source_summaries:` Writer Rule

`source_summaries:` is a **strict, order-preserving mirror** of `sources:` on every concept/entity/comparison page. Kb-ingest writes it:

- **On page create:** one `wiki/sources/<stem>-summary.md` entry per raw path in `sources:`, matching order. If `sources:` is empty, write `source_summaries: []`.
- **On page update (corroboration / counterargument / gap):** append the derived summary path in the same position as the new raw path; maintain list order. Post-mutation invariant: `len(sources) == len(source_summaries)`.
- **On contradiction suspension:** both `sources:` and `source_summaries:` appends are held out in lockstep; the invariant still holds. Both lift together at kb-resolve Step 6a.
- **Derivation rule:** `raw/<subdir>/<stem>.md` → `wiki/sources/<stem>-summary.md`. No alternate forms. Kb-lint enforces the parity invariant every run.

Source-summary pages themselves do not carry `source_summaries:` — their own `sources:` points to a single raw/ file and no mirror is needed.

## `source_index.md` Maintenance

Kb-ingest owns the **append** path on `source_index.md`:

- **On summary page creation (Step 3d):** append one entry at the top of `## Sources by Date` (newest-first position).
  - Entry format: `- wiki/sources/<stem>-summary.md [source-summary] [<confidence>] [<YYYY-MM-DD>] [<tag1, tag2>] -- <one-line summary>`.
  - `[demoted]` badge is **omitted on creation** — kb-resolve inserts it later between `[confidence]` and `[date]`.
- **Stats line update:** bump `Total sources:` and the matching subtype counter (Articles / Papers / Notes / Misc). Subtype is derived from the raw file's subdirectory — never self-reported by the summary page.
- **`> Last updated:` line:** set to today's date.
- **`## Orphan Watch`** is owned by kb-lint. Ingest does not touch it.
- Paths are **relative**, not wikilinks. Citations to summary pages in synthesized answers reuse the same relative form (kb-query convention).
