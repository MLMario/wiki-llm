# test-kb

> Scaffolded by `create-wiki-llm` on 2026-01-01.

Personal knowledge base in plain markdown, driven by five Claude Code skills. URLs, papers, and notes go into `knowledge-base/raw/`; an LLM compiles them into interlinked wiki pages under `knowledge-base/wiki/`. No databases, no embeddings — just markdown and a master `index.md`.

## Quickstart

Open this directory in [Claude Code](https://www.anthropic.com/claude-code), then:

```
/kb-drop https://example.com/some-article
/kb-ingest
```

`/kb-drop` fetches the URL verbatim into `knowledge-base/raw/articles/`. `/kb-ingest` compiles every `status: pending` raw item into structured pages under `knowledge-base/wiki/` and updates `knowledge-base/index.md`.

Other useful commands once you have content:

- `/kb-query <question>` — search the wiki and answer with citations.
- `/kb-resolve` — adjudicate any contradictions `/kb-ingest` flagged.
- `/kb-lint` — audit the wiki for orphans, broken wikilinks, stale pages.

See `CLAUDE.md` for the full architecture, schema, and design constraints.

## Updating the package-owned files

The five `kb-*` skills, `utils/pdf_to_markdown.py`, `requirements.txt`, and `knowledge-base/CONTEXT.md` come from the `create-wiki-llm` npm package. To pull the latest versions:

```bash
npx create-wiki-llm@latest --update
```

The updater overwrites only those package-owned files. Your raw/ inbox, your wiki/ pages, your `log.md`, and your seed files (this `README.md`, `CLAUDE.md`, `knowledge-base/index.md`, etc.) are never touched.

If you have customised any of the package-owned files, the updater will refuse and list them. Pass `--force` to overwrite anyway; your prior versions are saved to `.wiki-llm/backups/<timestamp>/` first.

## Optional: PDF support

Local PDF drops (`/kb-drop /path/to/paper.pdf`) require Python 3 and `pymupdf4llm`:

```bash
pip install -r requirements.txt
```

URL drops do not need Python — only `curl`, which Claude Code already uses through `kb-drop`'s permissions allowlist. PDF URLs are hard-rejected; download the file and drop the local path instead.

## Layout

```
knowledge-base/
  raw/           # Inbox: articles/, papers/, notes/, misc/, images/
  wiki/          # Compiled pages: concepts/, entities/, comparisons/, sources/
  index.md       # Topic index — entry point for /kb-query
  source_index.md# Provenance index — read by /kb-query behind a permission gate
  log.md         # Append-only processing log
  CONTEXT.md     # Schema overview
  curriculum.md  # Topic depth targets (yours to edit)
.claude/skills/  # Five kb-* skills (package-owned)
utils/           # pdf_to_markdown.py (package-owned)
CLAUDE.md        # Architecture overview for Claude Code
.wiki-llm/       # Manifest + update backups (gitignored)
```

For the long-form architecture overview, see [`CLAUDE.md`](./CLAUDE.md).
