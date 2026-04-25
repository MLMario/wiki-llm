# create-wiki-llm

Scaffold a Karpathy-style LLM knowledge-base repo for [Claude Code](https://www.anthropic.com/claude-code), driven by five `kb-*` skills.

A wiki-llm repo is plain markdown: URLs and PDFs land in `knowledge-base/raw/`, and Claude Code skills compile them into interlinked `knowledge-base/wiki/` pages. No databases, no embeddings, no scheduled jobs.

## Quickstart

```bash
npm create wiki-llm@latest my-kb
cd my-kb
```

Open the directory in Claude Code and capture your first source:

```
/kb-drop https://example.com/some-article
/kb-ingest
```

`npx create-wiki-llm my-kb` is an equivalent invocation if you prefer it.

## Updating an existing scaffolded repo

From inside any scaffolded repo:

```bash
npx create-wiki-llm@latest --update
```

This pulls the latest published version of the package and overwrites the package-owned files (skill definitions under `.claude/skills/kb-*`, `utils/`, `requirements.txt`, `knowledge-base/CONTEXT.md`).

Useful flags:

- `--dry-run` — print the update plan without writing anything.
- `--force` — overwrite files you have customized (backup is still made).
- `--keep-backups=N` — keep the N most recent backup snapshots (default 10).

## Safety guarantees

The updater enforces three independent guards so your notes survive every update:

- **Three-zone classification.** Files are sorted into Package, Seed, and User zones. Only Package-zone files (skills, utils, `requirements.txt`, `knowledge-base/CONTEXT.md`) are ever overwritten.
- **Customization refusal.** If you have edited a Package-zone file, the updater refuses without `--force` and prints the list of conflicts.
- **User-data-survival.** Anything under `knowledge-base/raw/` and `knowledge-base/wiki/` — your notes, your compiled wiki pages — is never touched by the updater. Same for `knowledge-base/log.md` and `.wiki-llm/backups/`.
- **Path-safety hard-fail.** Tarball entries with absolute paths, `..` traversal, or paths outside the repo root are rejected before any write.
- **Backup before overwrite.** Every changed file is snapshotted to `.wiki-llm/backups/<timestamp>/` before the new version is written.
- **Refuses major-version bumps.** Cross-major updates require manual migration; the updater refuses and prints a doc link rather than guessing.

## What's inside a scaffolded repo

```
my-kb/
  .claude/skills/kb-{drop,ingest,resolve,lint,query}/   # 5 Claude Code skills
  knowledge-base/
    raw/{articles,papers,notes,misc,images}/            # inbox for sources
    wiki/{concepts,entities,comparisons,sources}/       # compiled pages
    index.md                                            # topic entry point
    source_index.md                                     # provenance index
    CONTEXT.md                                          # schema overview
  utils/pdf_to_markdown.py                              # optional Python helper
  requirements.txt
  CLAUDE.md                                             # architecture overview for Claude Code
```

See the scaffolded repo's `CLAUDE.md` for the full workflow.

## Optional: Python for local PDFs

Local PDF drops are converted to markdown with `pymupdf4llm`. This is the only optional dependency:

```bash
pip install -r requirements.txt
```

Skip it if you only ingest URLs and typed notes; `kb-drop` fails gracefully with a pointing message when Python is missing.

## Requirements

- Node.js >= 20 (for `npm create` / `npx`).
- [Claude Code](https://www.anthropic.com/claude-code) — the skills run inside it.
- Optional: Python 3 + `pymupdf4llm` for local PDF support.

The npm package itself has zero runtime dependencies; it uses Node built-ins only.

## License

[MIT](./LICENSE)
