# Knowledge Base — Schema & Conventions (Overview)

> This file is a human-facing overview. The per-skill scoped conventions live inside each skill's folder at `.claude/skills/kb-{drop,ingest,resolve,lint,query}/reference/CONTEXT.md` and are read at runtime by the skill that owns them. This file is not read at runtime — it exists so humans browsing `knowledge-base/` have an entry point.

## Purpose

Personal knowledge vault following the Karpathy LLM Wiki pattern. All content is plain markdown. The LLM compiles raw sources into a structured, interlinked wiki. No databases, no embeddings — just markdown files navigated via an index. Python is used in one narrow place only: `utils/pdf_to_markdown.py` converts local PDFs to markdown during `kb-drop`; everything else (ingest, resolve, lint, query) remains pure-markdown + built-in Claude tools.

## Skill-to-Reference Map

| Skill purpose | Scoped reference (travels with the skill) |
|---|---|
| Dropping a URL / file / note into `raw/` | `.claude/skills/kb-drop/reference/CONTEXT.md` |
| Compiling `raw/` → `wiki/` | `.claude/skills/kb-ingest/reference/CONTEXT.md` |
| Resolving flagged contradictions in the wiki | `.claude/skills/kb-resolve/reference/CONTEXT.md` |
| Auditing wiki health (orphans, stale, broken links) | `.claude/skills/kb-lint/reference/CONTEXT.md` |
| Querying the wiki (and, optionally, `raw/`) | `.claude/skills/kb-query/reference/CONTEXT.md` |

Because each scoped reference lives inside its skill folder, the skills are self-contained and portable — they do not depend on this file or on the `knowledge-base/` tree being co-installed. Full frontmatter schemas and the four page templates are duplicated inside each `.claude/skills/kb-*/SKILL.md`.

### Shared-rule drift warning

Rules that appear in more than one scoped reference:

- `[[wikilink]]` syntax — in `kb-ingest`, `kb-resolve`, `kb-lint`, `kb-query`.
- Index Format + entry conventions (both `index.md` and `source_index.md`) — in `kb-ingest`, `kb-lint`, `kb-query`.
- Confidence-level definitions — in `kb-ingest`, `kb-lint`, `kb-query`.
- Image-handling exception — in `kb-ingest`, `kb-lint`, `kb-query`.
- Directory Structure — in all five (each scoped to that skill's working set).
- Contradiction entry / amendment-preamble templates + `has_contradiction` / `has_demoted_or_debunk_claim` frontmatter keys — in `kb-ingest`, `kb-resolve`, `kb-lint`.
- `sources:` list semantics ("currently endorsed," not historical) — in `kb-ingest`, `kb-resolve`, `kb-lint`, `kb-query`.
- `source_summaries:` frontmatter field, strict 1-to-1 parity with `sources:`, and slug-derivation rule (`raw/<subdir>/<stem>.md` ↔ `wiki/sources/<stem>-summary.md`) — in `kb-ingest`, `kb-resolve`, `kb-lint`, `kb-query`.
- `source_index.md` format + `[demoted]` marker + Orphan Watch — in `kb-ingest`, `kb-resolve`, `kb-lint`, `kb-query`.
- kb-query permission-gate principle ("sources are never read without an explicit user yes") — in `kb-query` only (but referenced from the sources-layer section below).

When you edit a shared rule, sync it across each skill's `reference/CONTEXT.md`.

## Directory Structure

```
knowledge-base/
  raw/                        # Inbox (immutable after creation)
    articles/                 # Web articles (verbatim Jina Reader output)
    papers/                   # Research papers, converted from local PDFs
    notes/                    # Manual notes
    misc/                     # Anything else
    images/                   # Figures extracted from local PDF drops (one subdir per paper)
  wiki/                       # LLM-compiled structured pages (two layers inside)
    concepts/                 # Content layer: concept pages
    entities/                 # Content layer: people, orgs, projects
    comparisons/              # Content layer: side-by-side comparison pages
    sources/                  # Provenance layer: one summary page per raw/ item
  index.md                    # Main topic index (content layer only)
  source_index.md             # Flat chronological index of source-summary pages (provenance layer)
  log.md                      # Processing log (prepend-only)
  ingested-urls.txt           # URL dedupe ledger
  CONTEXT.md                  # This file (overview only)
```

See "The Sources Layer" section below for what separates the content layer from the provenance layer and why kb-query treats them differently.

## Access Control

Only these skills write to `knowledge-base/`:

- **kb-drop** → writes to `raw/`, `log.md`, `ingested-urls.txt`.
- **kb-ingest** → writes to `wiki/`, `index.md`, `source_index.md` (append on new summary), `log.md`; edits the `status` field in `raw/` frontmatter. Appends to `sources:` AND `source_summaries:` frontmatter on concept/entity/comparison pages in lockstep (with a per-page suspension on contradicting claims — see `kb-ingest/reference/CONTEXT.md`).
- **kb-resolve** → writes to `wiki/concepts/`, `wiki/entities/`, and `wiki/comparisons/` page bodies (deleting resolved contradiction entries, editing body to reflect the decision); prepends amendment preambles to `wiki/sources/` summary pages; mutates `sources:` AND `source_summaries:` frontmatter in lockstep (adds winners, removes losers); inserts the `[demoted]` marker into `source_index.md` entries for demoted sources; prepends `log.md`. Co-owns `has_contradiction` and `has_demoted_or_debunk_claim` frontmatter keys with `kb-ingest`.
- **kb-lint** → edits `index.md` (Orphan Watch — content-layer scope), `source_index.md` (parallel Orphan Watch — provenance-layer scope); writes `log.md`. Detects `sources:` / `source_summaries:` parity drift and `[demoted]`-marker drift; never auto-fixes.
- **kb-query** → read-only by default. Writes only when the user explicitly asks to file an answer (creates a `wiki/` page, updates `index.md`, prepends `log.md`). Reads `wiki/sources/` and `source_index.md` **only** when the Step 2 permission gate resolves to `source_mode = true` (LLM self-check yes AND user confirms). May read `raw/` under the same gate for contradiction judgment; never writes there.

**`sources:` / `source_summaries:` frontmatter is co-owned.** Ingest appends on update; resolve may add or remove on adjudication. Both lists mutate in lockstep with strict 1-to-1 parity. The lists reflect currently endorsed provenance, not full history. kb-query and kb-lint both assume this semantics.

All other agents have **read-only** access by convention.

### Cross-Workspace Read Pattern

Any agent in the repo can read KB content using this pattern:

1. Read `knowledge-base/index.md`.
2. Find relevant page references.
3. Read the specific `wiki/` page(s) — concept/entity/comparison only.
4. Use the information, citing `[[wikilinks]]` and confidence levels.
5. Never write to `knowledge-base/`.
6. **Do not read `wiki/sources/` or `source_index.md` from other agents.** Those layers are kb-query's gated provenance surface; a general-purpose agent reading them bypasses the permission-gate principle. If a non-KB agent needs source-level detail, invoke `/kb-query` and let the gate fire.

## The Sources Layer

The wiki has two conceptually distinct layers that happen to sit under the same `wiki/` directory. Readers (especially non-KB agents) should treat them differently.

### Content layer

`wiki/concepts/`, `wiki/entities/`, `wiki/comparisons/`. Indexed by `knowledge-base/index.md`. This is the primary query surface — the compiled wiki.

- Cited via `[[wikilink]]` form.
- Always available to `/kb-query`; no permission gate.

### Provenance layer

`wiki/sources/` + `knowledge-base/source_index.md`. One summary page per ingested raw/ item; a flat chronological catalogue of those summaries.

- Structurally inside `wiki/`, but conceptually a **distinct retrieval layer** — it answers provenance questions ("which article did I read about X", "what did I ingest last week"), not conceptual questions.
- Cited via relative path `wiki/sources/<stem>-summary.md` — **not** a wikilink. This deliberately makes the content/provenance distinction visible in every answer.
- **Read only behind `/kb-query`'s permission gate.** kb-query self-checks whether a query needs sources; if yes, it asks the user with a stated reason; only on user confirmation does it read source summaries or `source_index.md`.

### `source_index.md` — purpose + format

Provenance fallback surface. Flat, chronological (newest first), relative paths (not wikilinks). Written by `kb-ingest` (append on summary creation), `kb-resolve` (insert `[demoted]` marker on demoted sources), and `kb-lint` (parallel Orphan Watch section). Never written by any other skill or agent.

```markdown
# Source Index

> Last updated: YYYY-MM-DD
> Total sources: N | Articles: N | Papers: N | Notes: N | Misc: N | Demoted: N

## Sources by Date

- wiki/sources/<stem>-summary.md [source-summary] [<confidence>] [demoted?] [<YYYY-MM-DD>] [<tags>] -- <one-liner>
- ... (newest first)

## Orphan Watch

(Populated by kb-lint.)
```

The `[demoted]` badge sits between `[<confidence>]` and `[<YYYY-MM-DD>]` on any entry whose summary page has `has_demoted_or_debunk_claim: true`. Co-owned kb-resolve (writer) ↔ kb-lint (detector).

### `source_summaries:` frontmatter field

Every `wiki/concepts/*.md`, `wiki/entities/*.md`, and `wiki/comparisons/*.md` page carries both `sources:` (raw paths) and `source_summaries:` (derived summary-page paths) in its frontmatter.

- **Strict 1-to-1 parity.** `len(sources) == len(source_summaries)` on every such page; empty lists are valid but must match.
- **Slug-derivation rule.** For every `raw/<subdir>/<stem>.md` entry in `sources:`, the matching `source_summaries:` entry is `wiki/sources/<stem>-summary.md`, at the same list index.
- **Lockstep mutation.** Every writer (kb-ingest append, kb-resolve add/remove, contradiction suspension) touches both lists identically. `kb-lint` detects parity drift but never auto-fixes.
- Source-summary pages themselves do not carry `source_summaries:` (they have no mirrored content to point at).

### kb-query's permission-gate principle

Sources are never read without an explicit user yes. `/kb-query`'s Step 2 gate combines an LLM self-check ("do I need sources for this?", default no) with a user confirmation prompt that states the reason. Both must resolve to yes; ambiguous replies fail closed.

This is the governing invariant for the entire sources layer — it is why the content/provenance split exists, why citation forms differ, and why `source_index.md` is structurally separate from `index.md`. The full flow is documented in `.claude/skills/kb-query/reference/CONTEXT.md` under "Query-Relevant Conventions".
