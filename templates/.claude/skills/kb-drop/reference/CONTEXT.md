# kb-drop — Scoped Context

> Scoped schema and conventions for the `kb-drop` skill. Travels with the skill; read at runtime via `reference/CONTEXT.md`.
> Shared-rule drift: if you edit a rule that also appears in sibling KB skills (`kb-ingest`, `kb-resolve`, `kb-lint`, `kb-query`), sync it across each skill's `reference/CONTEXT.md`.

The raw-file frontmatter schema, subdirectory routing, the `YYYY-MM-DD-slug.md` filename rule, the collision-suffix rule, and the drop log-entry body are all already inlined in this skill's `SKILL.md`. This file covers only the residual cross-cutting conventions.

## Filename Conventions

- Filenames: kebab-case, ASCII only.
- Slug rules: lowercase; letters, digits, and hyphens only; truncate to 60 characters; trim trailing hyphens.

## Log Conventions

- `log.md` is **prepend-only** — newest entries go at the top of the file, immediately below the H1 heading.
- Entry heading format: `## [YYYY-MM-DD] {operation} | {brief description}`
- Valid operations: `drop`, `ingest`, `query`, `lint`, `skip`.
- Body uses bullet points with bold field labels.

## Ingest-Ledger Convention

- `knowledge-base/ingested-urls.txt` is a newline-separated list of URLs already dropped.
- One URL per line. No leading/trailing whitespace. No blank lines between entries.
- Append-only; duplicates are tolerated (consumers dedupe).
- Only touched on successful URL drops — file-path and inline-text drops do not append.
