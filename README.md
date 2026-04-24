# create-wiki-llm

Scaffold a Karpathy-style LLM knowledge-base repo for [Claude Code](https://www.anthropic.com/claude-code), driven by five `kb-*` skills.

**Status:** Pre-release (v0.0.0). Not yet published to npm.

## Quickstart

Once published, you will be able to scaffold a fresh knowledge-base repo with:

```bash
npm create wiki-llm@latest my-kb
cd my-kb
```

Open the scaffolded directory in Claude Code and try:

```
/kb-drop https://example.com/some-article
/kb-ingest
```

## Updating an existing scaffolded repo

From inside a scaffolded repo:

```bash
npx create-wiki-llm@latest --update
```

This overwrites the package-owned files (skill definitions under `.claude/skills/kb-*`, `utils/`, `requirements.txt`, `knowledge-base/CONTEXT.md`) with the latest published versions. It never touches your notes under `knowledge-base/raw/` or `knowledge-base/wiki/`.

## What's inside a scaffolded repo

The scaffolder produces:

- `.claude/skills/kb-{drop,ingest,resolve,lint,query}/` — five Claude Code skills that drive the KB workflow.
- `knowledge-base/raw/` — inbox for dropped URLs, papers, notes.
- `knowledge-base/wiki/` — LLM-compiled pages (concepts, entities, comparisons, sources).
- `utils/pdf_to_markdown.py` + `requirements.txt` — optional Python helper for local PDF drops.
- `CLAUDE.md` — architecture overview for Claude Code.

See the scaffolded repo's `CLAUDE.md` for details on the workflow and design.

## Optional dependencies

Local PDF drops require Python 3 and `pymupdf4llm`:

```bash
pip install -r requirements.txt
```

Everything else runs inside Claude Code with no additional setup.

## Development

This repo ships the `create-wiki-llm` npm package. Phase 0 is pure bootstrap — the CLI, templates, and test harness are not yet implemented.

```bash
npm test            # placeholder
npm pack --dry-run  # inspect the file list
```

Node >= 20 is required. The package has zero runtime or dev dependencies.

## License

[MIT](./LICENSE)
