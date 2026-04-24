# kb-ingest — Scoped Context

> Scoped schema and conventions for the `kb-ingest` skill. Travels with the skill; read at runtime via `reference/CONTEXT.md`.
> Shared-rule drift: if you edit a rule that also appears in sibling KB skills (`kb-drop`, `kb-resolve`, `kb-lint`, `kb-query`), sync it across each skill's `reference/CONTEXT.md`.

The raw/ frontmatter schema, wiki/ frontmatter schema, and all four page templates (Concept, Entity, Source Summary, Comparison) are already inlined in this skill's `SKILL.md`. This file covers the cross-page conventions ingest must respect when writing into the wiki.

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

### Source Index Conventions

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

## Ingest-Relevant Conventions

- **Batch ordering:** process oldest first, by `dropped_date`. Preserves chronological wiki growth.
- **Confidence levels:**
  - `high` = multiple corroborating sources.
  - `medium` = single authoritative source.
  - `low` = inferred or speculative.
  - On update, a `medium` page with a new corroborating source may be upgraded to `high`.
- **Page length cap:** single wiki page max 300 lines. If a page would exceed this, split into sub-pages.
- **Image handling (v1):** `raw/` may contain image files. Note their paths in the source-summary page but do not ingest images into wiki pages.
- **Filename and slug encoding:** kebab-case, ASCII only, across all wiki page filenames.

### Contradiction Routing

When updating an existing concept/entity page, classify each extracted claim against the page's current body and route accordingly. Three-way distinction (plus corroboration):

| Classification | Definition | Route |
|---|---|---|
| Direct factual opposition | "X is true" vs. "X is false" about the same thing; resolvable by deciding which is right. | Append H3 entry under `## Contradictions`; set `has_contradiction: true`; **hold the new source's raw path out of `sources:` AND the derived summary path out of `source_summaries:` on this page** (single exception to the normal mirrored append rule; both lists held out in lockstep). |
| Counterargument | Different framing, critique, competing perspective; not strictly factually opposed. | Append to `## Counterarguments / Gaps`; normal mirrored `sources:` + `source_summaries:` append applies. |
| Gap | Acknowledged unknown / missing data. | Append to `## Counterarguments / Gaps`; normal mirrored `sources:` + `source_summaries:` append applies. |
| Corroboration / additive | Reinforces or extends existing content. | Normal update path: merge into body, append to `sources:`, mirror to `source_summaries:`. |

**Conservative default:** when the opposition-vs-counterargument call is unclear, route to counterargument/gap. Don't over-flag.

**Multi-claim sources:** when one source contributes both contradicting and non-contradicting claims (possibly spanning different pages), route each claim independently. The `sources:` + `source_summaries:` suspension is per-page and applies only to pages where the source's claim is the contradicting one.

**Ingest flags; it never resolves.** Resolution is `kb-resolve` territory. Ingest's reporting duty: surface `Contradictions flagged:` in both the final user-facing summary and (conditionally) the `log.md` entry.

**`sources:` is co-owned.** Ingest appends new raw paths on update (with the per-page suspension above for contradicting claims). `kb-resolve` may later add winner paths or remove loser paths on adjudication. The list reflects currently endorsed provenance, not full history — kb-query and kb-lint both assume this semantics.

Full templates (`## Contradictions` H3 entry, amendment preamble) and the frontmatter keys (`has_contradiction`, `has_demoted_or_debunk_claim`) live in `kb-ingest/SKILL.md` — this subsection is the routing rule, not the shapes.

### `source_summaries:` Writer Rule

`source_summaries:` is a **strict, order-preserving mirror** of `sources:` on every concept/entity/comparison page. Kb-ingest writes it:

- **On page create:** one `wiki/sources/<stem>-summary.md` entry per raw path in `sources:`, matching order. If `sources:` is empty, write `source_summaries: []`.
- **On page update (corroboration / counterargument / gap):** append the derived summary path in the same position as the new raw path; maintain list order. Post-mutation invariant: `len(sources) == len(source_summaries)`.
- **On contradiction suspension:** both `sources:` and `source_summaries:` appends are held out in lockstep; the invariant still holds. Both lift together at kb-resolve Step 6a.
- **Derivation rule:** `raw/<subdir>/<stem>.md` → `wiki/sources/<stem>-summary.md`. No alternate forms. Kb-lint enforces the parity invariant every run.

Source-summary pages themselves do not carry `source_summaries:` — their own `sources:` points to a single raw/ file and no mirror is needed.

### `source_index.md` Maintenance

Kb-ingest owns the **append** path on `source_index.md`:

- **On summary page creation (Step 3d):** append one entry at the top of `## Sources by Date` (newest-first position).
  - Entry format: `- wiki/sources/<stem>-summary.md [source-summary] [<confidence>] [<YYYY-MM-DD>] [<tag1, tag2>] -- <one-line summary>`.
  - `[demoted]` badge is **omitted on creation** — kb-resolve inserts it later between `[confidence]` and `[date]`.
- **Stats line update:** bump `Total sources:` and the matching subtype counter (Articles / Papers / Notes / Misc). Subtype is derived from the raw file's subdirectory — never self-reported by the summary page.
- **`> Last updated:` line:** set to today's date.
- **`## Orphan Watch`** is owned by kb-lint. Ingest does not touch it.
- Paths are **relative**, not wikilinks. Citations to summary pages in synthesized answers reuse the same relative form (kb-query convention).
