# Changelog

All notable changes to `create-wiki-llm` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-05-05

Adds two article-drafting skills, `/kb-draft` (autonomous, 5-pass) and `/kb-draft-directed` (interactive, 4-pass with user direction at spark and outline). Both ground claims in the wiki via a shared retrieval agent.

### Added

- `.claude/skills/kb-draft/` — compile a markdown input (outline, partial draft, brain-dump, or spark) into an annotated draft via 5 autonomous passes (spark → outline → priors → draft → claim-check + voice-pass). Voice-checked against a static `voice-profile.md` shipped with the skill. Writes a `<slug>.draft.md` plus 6 staging files under `.kb-draft-staging/<slug>/`.
- `.claude/skills/kb-draft-directed/` — compile an input markdown file via 4 passes (spark → outline → research-and-draft → verify) with human-in-the-loop direction at every creative juncture (angle, audience, anchor pages, outline shape). Passes 3 and 4 run mechanically once direction is set. Writes a single `<input-stem>.draft.md` next to the input.
- `.claude/agents/kb-search.md` — shared retrieval agent used by both draft skills (and reusable by `/kb-query`) for wiki traversal. Read-only; returns structured findings without proposing creative options.
- `scripts/sync-from-ai-vault.mjs` extended to include the two new skills and a tree sync of `.claude/agents/`. Future kb-* and agent additions in the canonical `ai_vault` checkout now flow through `npm run` automatically.

### Changed

- `.claude/skills/kb-ingest/SKILL.md` — picks up the post-0.1.1 spawn-prompt guardrail telling future runs not to add a text-return fallback clause to the Agent 1 / Agent 2 spawn prompts (drift fix from `ai_vault@f4932c3`).

### Migration notes

- Existing scaffolded repos pick up the new skills via `npx create-wiki-llm@latest --update`. The updater writes the two new skill directories and the new `kb-search` agent file. The Path-safety allowlist already includes `.claude/agents/` from 0.1.1, so no allowlist changes are required.
- The autonomous `/kb-draft` ships with `voice-profile.md` populated from the canonical `ai_vault` voice. Tune it to your own writing voice if you want the voice-pass to validate against your style instead.

## [0.1.1] - 2026-04-25

`/kb-ingest` is now an orchestrator that spawns three custom subagents per pending raw/ source instead of running a single-pass routine.

### Added

- `.claude/agents/` Package zone, with three subagents shipped under it:
  - `kb-extract-explore` (Agent 1) — read-only extraction with semantic dedup against the existing wiki.
  - `kb-analyzer` (Agent 2) — claim routing, prose authoring, source-summary drafting; no writes.
  - `kb-wiki-update` (Agent 3) — the only writer; mechanical schema-aware applier of Agent 2's output.
- Per-source intermediate artifacts (`01-extract.md`, `02-analysis.md`) are persisted under `knowledge-base/.kb-ingest-staging/<stem>/` for inspection — gitignored, kept on every outcome (success and failure), wiped via a pre-flight prompt on the next run.
- Path-safety allowlist now includes `.claude/agents/` so `--update` recognises the new agent files as Package-zone writable targets.

### Changed

- `.claude/skills/kb-ingest/SKILL.md` rewritten as a thin orchestrator: it loads `reference/CONTEXT.md`, locates pending raw/ items, and spawns the three agents in sequence per source. Output schema (wiki/, index.md, source_index.md, log.md, raw status flip) is unchanged.
- `.claude/skills/kb-ingest/reference/CONTEXT.md` pruned to the orchestrator + Agent 3 scope; Agents 1 and 2 read their own reasoning out of their agent definition files.
- Scaffolded `CLAUDE.md` and `knowledge-base/CONTEXT.md` document the multi-agent architecture and the new `.claude/agents/` directory.

### Migration notes

- Existing scaffolded repos pick up the change via `npx create-wiki-llm@latest --update`. The updater will write the three new agent files into `.claude/agents/` and overwrite `kb-ingest/SKILL.md` + `kb-ingest/reference/CONTEXT.md` with backups under `.wiki-llm/backups/<timestamp>/`.
- If you customised the prior single-pass `kb-ingest/SKILL.md`, the updater will refuse without `--force`. Diff your customisation against the new orchestrator before reapplying — the call shape changed (skill -> spawn agents) and a hand-edited single-pass body cannot be merged in mechanically.
- `knowledge-base/.kb-ingest-staging/` is gitignored on fresh scaffolds. Existing repos should add that line to their `.gitignore` manually if they want to keep the staging dir out of source control.



Initial public release.

### Added

- Scaffolder: `npm create wiki-llm@latest <dir>` (also reachable as `npx create-wiki-llm <dir>`) produces a working knowledge-base repo with five `kb-*` Claude Code skills, the optional Python PDF helper, and a templated `CLAUDE.md` / `README.md`.
- Updater: `npx create-wiki-llm@latest --update` overwrites Package-zone files (skills, utils, `requirements.txt`, `knowledge-base/CONTEXT.md`) in an existing scaffolded repo. Supports `--dry-run`, `--force`, and `--keep-backups=N`.
- Five bundled Claude Code skills:
  - `kb-drop` — fetch URLs (Jina Reader) or local PDFs into `knowledge-base/raw/`.
  - `kb-ingest` — compile `raw/` items into structured `knowledge-base/wiki/` pages with wikilinks.
  - `kb-resolve` — adjudicate contradictions flagged during ingest.
  - `kb-lint` — audit the wiki for orphans, broken wikilinks, and schema drift.
  - `kb-query` — answer questions over the wiki with citations.
- Three independent user-data safety guards in the updater:
  - Hardcoded Package-zone allowlist (manifest cannot escape it).
  - Customization gate (refuses to overwrite hand-edited files without `--force`).
  - Path-safety validation (rejects absolute paths, `..` traversal, paths outside the repo root).
- Backup-before-overwrite: every changed file is snapshotted to `.wiki-llm/backups/<timestamp>/` before the new bytes are written.
- Major-version bump refusal with migration-doc pointer.
- Deterministic `templates/manifest.json` (sha256 per file) generated by `scripts/build-manifest.mjs`; CI gate fails any PR whose manifest is out of sync.
- Cross-platform CI matrix: `{ubuntu-latest, macos-latest, windows-latest} × {node 20, node 22}`. 137 tests across unit, integration, snapshot, and safety layers.
- Zero runtime npm dependencies (Node 20+ built-ins only).

### Known limits

- Major-version updates are not yet automated. The updater refuses cross-major bumps and links to a `MIGRATION.md` placeholder; manual migration is required until the migration tooling lands.
- The updater requires network access to `https://registry.npmjs.org` to fetch the latest tarball.
- No `--merge` option for skill customizations in v0.1; the only choices are "refuse" (default) or "overwrite with backup" (`--force`).

[Unreleased]: https://github.com/MLMario/wiki-llm/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/MLMario/wiki-llm/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/MLMario/wiki-llm/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/MLMario/wiki-llm/releases/tag/v0.1.0
