# {{PROJECT_NAME}} — Knowledge Base

## Project Overview

This repo is a personal knowledge base built around the [Karpathy LLM Wiki](https://github.com/karpathy/karpathy.github.io) pattern. URLs, papers, articles, and notes are dropped into `knowledge-base/raw/`, then compiled by an LLM into interlinked wiki pages under `knowledge-base/wiki/`. There are no databases, no embeddings, and no scheduled jobs — just plain markdown files navigated via a master `index.md` and driven by five Claude Code skills.

This repo was scaffolded by `create-wiki-llm`. The five `kb-*` skills, the Python PDF helper, and `knowledge-base/CONTEXT.md` are kept in sync with upstream via `npx create-wiki-llm@latest --update`. Everything else — your raw inbox, your compiled wiki pages, your seed files (this `CLAUDE.md`, `README.md`, `knowledge-base/index.md`, etc.) — is yours to edit freely.

## Repo Layout

```
.
  knowledge-base/              # The knowledge base
    raw/                       # Inbox for unprocessed drops (immutable after creation)
      articles/                # Web articles fetched verbatim via Jina Reader
      papers/                  # Research papers converted from local PDFs (pymupdf4llm)
      notes/                   # Manual notes, typed content
      misc/                    # Anything else
      images/                  # Figures extracted from local PDF drops (one subdir per paper)
    wiki/                      # LLM-compiled structured pages
      concepts/                # Concept pages (content layer)
      entities/                # People, orgs, projects (content layer)
      comparisons/             # Side-by-side comparison pages (content layer)
      sources/                 # One summary page per raw/ item (provenance layer)
    index.md                   # Main topic index -- content layer only; entry point for queries
    source_index.md            # Provenance index -- flat chronological list of source summaries; read by kb-query only behind a permission gate
    log.md                     # Append-only processing log
    ingested-urls.txt          # Dedupe ledger (appended by kb-drop)
    CONTEXT.md                 # Human-facing schema overview; per-skill references live with each skill
    curriculum.md              # Topic depth targets (reference)
  .claude/
    skills/
      kb-drop/                 # Drop a URL/file/note into raw/
        SKILL.md
        reference/CONTEXT.md   # Scoped schema/conventions read by kb-drop
      kb-ingest/                # Compile raw/ -> wiki/ (orchestrator, spawns agents below)
        SKILL.md
        reference/CONTEXT.md   # Scoped schema/conventions read by kb-ingest orchestrator + Agent 3
      kb-resolve/               # Adjudicate contradictions flagged by kb-ingest
        SKILL.md
        reference/CONTEXT.md   # Scoped schema/conventions read by kb-resolve
      kb-lint/                  # Audit wiki health
        SKILL.md
        reference/CONTEXT.md   # Scoped schema/conventions read by kb-lint
      kb-query/                 # Search wiki, synthesize answers with citations
        SKILL.md
        reference/CONTEXT.md   # Scoped schema/conventions read by kb-query
    agents/                     # Custom subagents spawned by /kb-ingest (orchestrator-only)
      kb-extract-explore.md     # Agent 1 -- read-only extraction with semantic dedup
      kb-analyzer.md            # Agent 2 -- claim routing + prose authoring + summary draft
      kb-wiki-update.md         # Agent 3 -- mechanical schema-aware writer (only writer)
    settings.json
  utils/
    pdf_to_markdown.py         # Local PDF -> markdown helper used by kb-drop
  requirements.txt             # Python deps (pymupdf4llm)
  CLAUDE.md                    # This file
  README.md                    # User-facing readme
  .gitignore
  .wiki-llm/
    manifest.json              # Tracks package-owned files for safe `--update`
    backups/                   # Pre-update snapshots (gitignored)
```

## Skills

Each KB skill reads its own scoped reference file (`.claude/skills/kb-{drop,ingest,resolve,lint,query}/reference/CONTEXT.md`) at runtime for the subset of schema and conventions it actually needs. Because the reference travels with each skill, skills are self-contained and portable across installs. They run inline in the main Claude session — invoked via slash command or auto-triggered when the user uses an explicit action verb (save, ingest, resolve, query, lint, etc.). `knowledge-base/CONTEXT.md` is a human-facing schema overview and is not read at runtime.

| Skill | Purpose | Writes to |
|---|---|---|
| `/kb-drop` | Fetch a URL (or copy a file / accept inline text) into `knowledge-base/raw/` with proper YAML frontmatter | `raw/`, `log.md`, `ingested-urls.txt` |
| `/kb-ingest` | Compile `status: pending` items from `raw/` into structured `wiki/` pages with wikilinks; flag (but never resolve) contradictions | `wiki/` (incl. `source_summaries:` frontmatter on concept/entity/comparison pages, mirrored to `sources:`), `index.md`, `source_index.md` (append on new summary), `log.md`, and the `status` field of processed `raw/` files |
| `/kb-resolve` | List and adjudicate open contradictions flagged by kb-ingest | `wiki/` (page bodies, `sources:` + `source_summaries:` frontmatter in lockstep, source-summary amendment preambles), `source_index.md` (insert `[demoted]` marker on demoted sources), `log.md` |
| `/kb-lint` | Audit the wiki for orphans, stale pages, broken wikilinks, schema violations, contradiction-state integrity, `sources:`/`source_summaries:` parity, demoted-marker integrity | `index.md` (orphan-watch section), `source_index.md` (parallel orphan-watch section), `log.md` |
| `/kb-query` | Answer questions by reading `index.md` and relevant wiki pages; reads source summaries (`wiki/sources/`) and `source_index.md` only when a permission gate opens (LLM self-check says yes AND user confirms) | Read-only by default |

### Typical workflow

1. **Drop a URL** — `/kb-drop https://example.com/article` (or pass tags: `https://... tags: llm, memory`). The skill fetches, applies frontmatter, and writes `raw/articles/YYYY-MM-DD-slug.md`.
2. **Compile** — `/kb-ingest`. Finds all `status: pending` items in `raw/`, compiles each into one or more wiki pages, updates `index.md`, and flips the raw/ status to `ingested`. Contradictions against existing pages are flagged in-place under `## Contradictions`; ingest never resolves them.
3. **Resolve (when flagged)** — `/kb-resolve`. Lists open contradictions across the wiki; adjudicates one per dialogue, mutating the affected page, amending losing source summaries, and logging the decision. Run whenever ingest reports `Contradictions flagged: N > 0`.
4. **Query** — `/kb-query What have I read about <topic>?`. Reads `index.md`, opens the relevant concept/entity/comparison pages, and answers with wikilink citations. If the query benefits from sources (provenance questions, source-level validation, "what did I read last week"), kb-query asks permission before reading `wiki/sources/` summaries or `source_index.md`.
5. **Health check (periodic)** — `/kb-lint`. Surfaces orphan pages, broken links, stale content, drift in contradiction-state flags, and `sources:` / `source_summaries:` parity violations.

`/kb-ingest` is **orchestrator-shaped**. The skill itself is a thin orchestrator that, for each pending raw/ source, spawns three custom subagents in sequence: `kb-extract-explore` (read-only extraction with semantic dedup), `kb-analyzer` (claim routing + prose authoring + source-summary draft), and `kb-wiki-update` (the only writer — mechanical schema mechanic). The agent definitions live under `.claude/agents/` and are spawned only by the orchestrator (not invokable directly). Per-source artifacts persist under `knowledge-base/.kb-ingest-staging/<stem>/` for inspection; that directory is gitignored and wiped via a pre-flight prompt on the next run.

## Design Constraints

- **No Python in the KB skill loop.** Skill logic (`kb-drop`, `kb-ingest`, `kb-resolve`, `kb-lint`, `kb-query`) stays in `.claude/skills/kb-*/SKILL.md` using built-in tools (`Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`). Python is permitted only for format-conversion helpers in `utils/` — currently just PDF -> markdown via `pymupdf4llm`. Ingest, resolve, lint, and query remain pure-markdown + built-in tools.
- **Verbatim raw/ content.** kb-drop fetches HTML URLs via Jina Reader (`curl` direct-to-file) and converts local PDFs via `utils/pdf_to_markdown.py`. The source body never enters Claude's context during a drop — raw/ files are the source of truth, not a paraphrase. PDF URLs are hard-rejected (download and drop the local path).
- **Wiki is append/compile only via the KB skills.** Other agents or skills (if added later) should read the KB but not write to it — the five KB skills above are the only authorized writers.
- **Filenames:** kebab-case, ASCII. Raw files use `YYYY-MM-DD-slug.md`.
- **Cross-references:** `[[page-name]]` wikilink syntax, no subdirectory path.

## Dependencies

- **Python 3.x** + `pymupdf4llm` (install: `pip install -r requirements.txt`).
- Used only by `utils/pdf_to_markdown.py`, which kb-drop invokes when the user drops a local PDF path. Nothing else in the repo imports Python.
- External fetch: HTML URL drops rely on the public **Jina Reader** endpoint (`https://r.jina.ai/<URL>`) via `curl`. No API key required at normal personal-use rates.

## Updating the package-owned files

The five `kb-*` skills, the kb-ingest agents under `.claude/agents/`, `utils/pdf_to_markdown.py`, `requirements.txt`, and `knowledge-base/CONTEXT.md` are owned by the `create-wiki-llm` package. To pull the latest versions:

```bash
npx create-wiki-llm@latest --update
```

The updater never touches your notes (`knowledge-base/raw/**`, `knowledge-base/wiki/**`, `log.md`) or your seed files (`CLAUDE.md`, `README.md`, `knowledge-base/index.md`, etc.). If you have customised any of the package-owned files, the updater will refuse and list them; pass `--force` to overwrite (your prior versions land in `.wiki-llm/backups/`).

See `knowledge-base/CONTEXT.md` for the high-level schema overview, or go to `.claude/skills/kb-{drop,ingest,resolve,lint,query}/reference/CONTEXT.md` for a specific skill's scoped schema and conventions. Frontmatter schemas and page templates are also duplicated inside each `.claude/skills/kb-*/SKILL.md`.
