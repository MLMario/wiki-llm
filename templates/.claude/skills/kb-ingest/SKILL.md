---
name: kb-ingest
description: Compile pending items in the knowledge base raw/ inbox into structured wiki pages with wikilinks. Use when the user asks to ingest, compile, process, or build the wiki from pending raw/ items.
---

# kb-ingest (orchestrator)

Multi-agent ingest pipeline. For each `status: pending` raw/ source, spawns three
custom subagents in sequence:

1. `kb-extract-explore` (Agent 1) — read-only extraction with semantic dedup.
2. `kb-analyzer` (Agent 2) — claim routing, prose authoring, source-summary draft.
3. `kb-wiki-update` (Agent 3) — mechanical schema-aware writer.

Per-source loop. N pending sources = 3N agent spawns.

## Input parameters

- **None required.** Automatically finds all pending raw/ files.
- **Optional:** The user may specify a single file path to ingest only that file.

## Step 1 — Read reference/CONTEXT.md

Read `reference/CONTEXT.md` (in this skill's folder) for the schema, parity
invariants, index/log/source_index formats. Agent 3 reads this same file at spawn
time; the orchestrator reads it for sanity-check predicates and final-report
formatting.

## Step 2 — Find pending sources

1. Use **Grep** for `status: pending` in `knowledge-base/raw/`.
2. If the user specified a single file, verify it exists and has `status: pending`.
3. If no pending files: report "Nothing to ingest. All raw/ files have been
   processed." and stop.
4. Sort by `dropped_date` (oldest first) — preserves chronological wiki growth so
   source N+1's Agent 1 sees source N's freshly-created pages.

## Step 2.5 — Pre-flight staging gate

Inspect `knowledge-base/.kb-ingest-staging/`. If it exists and contains anything:

```
AskUserQuestion:
  "Existing staging artifacts from prior run(s):
    - 2026-04-23-foo/   (3 files)
    - 2026-04-24-bar/   (2 files)

  Delete all and continue, stop and clean staging, or stop?"
  Options: ["Delete all and continue", "Stop and clean staging", "Stop"]
```

Behavior:
- "Delete all and continue" → `Bash: rm -rf knowledge-base/.kb-ingest-staging/*` → proceed to Step 3.
- "Stop and clean staging" → wipe AND exit. Report wipe; do not process sources.
- "Stop" → exit without wiping; user investigates manually.

If `.kb-ingest-staging/` is empty or absent, skip the prompt and proceed to Step 3.

## Step 3 — Per-source pipeline

For each pending source (oldest first):

> **Spawn-prompt guardrail.** The Agent 1 / Agent 2 spawn prompts below tell each
> agent to "write `0N-extract.md` / `0N-analysis.md` per your agent body" — do
> NOT add a text-return fallback clause (e.g., *"if your tool permissions do not
> include Write, return the contents as text"*). It teaches the subagent that
> text return is acceptable, and they will take that path even when Write is
> available. Each agent body's "Delivery rule" already mandates Write; treat a
> missing Write grant as a setup bug (commit `.claude/agents/*.md` changes) and
> stop, not a fallback condition.

### 3a. Create staging dir
```
Bash: mkdir -p knowledge-base/.kb-ingest-staging/<stem>/
```

### 3b. Spawn kb-extract-explore (Agent 1)
```
Agent({
  subagent_type: "kb-extract-explore",
  description: "Extract concepts/entities from <stem>",
  prompt: "Source: <raw_path>\nStaging dir: knowledge-base/.kb-ingest-staging/<stem>/\nRead the source, extract dedup'd concepts and entities against the existing wiki, write 01-extract.md per your agent body."
})
```
On failure: log to in-memory failure list `{path: <raw_path>, agent: "kb-extract-explore", error: <captured>}`; keep staging; **continue to next source.**

### 3c. Sanity-check `01-extract.md`
```
Bash:
  test -f knowledge-base/.kb-ingest-staging/<stem>/01-extract.md \
  && [ "$(grep -c '^---$' knowledge-base/.kb-ingest-staging/<stem>/01-extract.md)" -ge 2 ] \
  && grep -q '^## Concepts$' knowledge-base/.kb-ingest-staging/<stem>/01-extract.md
```
If any predicate fails: treat as Agent 1 failure (3b path) — log, keep staging, skip to next source.

### 3d. Spawn kb-analyzer (Agent 2)
```
Agent({
  subagent_type: "kb-analyzer",
  description: "Analyze and route claims for <stem>",
  prompt: "Source: <raw_path>\nStaging dir: knowledge-base/.kb-ingest-staging/<stem>/\nRead 01-extract.md, route claims per your agent body, write 02-analysis.md."
})
```
On failure: log to failure list `{path, agent: "kb-analyzer", error}`; keep staging; continue to next source.

### 3e. Sanity-check `02-analysis.md`
```
Bash:
  test -f knowledge-base/.kb-ingest-staging/<stem>/02-analysis.md \
  && [ "$(grep -c '^---$' knowledge-base/.kb-ingest-staging/<stem>/02-analysis.md)" -ge 2 ] \
  && grep -q '^## Page Edits$' knowledge-base/.kb-ingest-staging/<stem>/02-analysis.md \
  && grep -q '^## Source Summary$' knowledge-base/.kb-ingest-staging/<stem>/02-analysis.md
```
If any predicate fails: treat as Agent 2 failure — log, keep staging, skip to next source.

### 3f. Tally bucket counts (soft-surfacing data flow)

Read `02-analysis.md`. For every entry under `## Page Edits` with a `routes:`
subsection, count routes by `bucket:` value. Accumulate into the in-memory
aggregate keyed by `<page_path, bucket, prose_one_liner>` — used by the final
report's "Counterarguments / gaps surfaced" block.

```
Bash: grep -c "^      bucket: counterargument$" 02-analysis.md
```
(Same for `gap`, `contradict`, `corroborate`. Pair with the surrounding `claim:` /
`prose:` field to extract a one-liner per route — `head -c 80` truncate.)

### 3g. Spawn kb-wiki-update (Agent 3)
```
Agent({
  subagent_type: "kb-wiki-update",
  description: "Apply edits to wiki for <stem>",
  prompt: "Source: <raw_path>\nStaging dir: knowledge-base/.kb-ingest-staging/<stem>/\nRead 01-extract.md, 02-analysis.md, and reference/CONTEXT.md; apply the planned edits per your agent body."
})
```
On failure: log to failure list `{path, agent: "kb-wiki-update", error}`; keep
staging; **HALT THE RUN.** Do not process any further sources. Skip to Step 4
with halted=true.

### 3h. Verify raw status flip
```
Bash: grep "^status: ingested$" <raw_path>
```
If the flip didn't happen, treat as Agent 3 failure (3g path) — HALT.

(NO step 3i — staging dir is kept on success in v1.)

## Step 4 — Final report

Always emit (preserves today's report shape):

```
Ingest complete:
  Sources processed: N
  Pages created: N (concepts: N, entities: N, source-summaries: N, comparisons: N)
  Pages updated: N
  Total wiki pages: N
  Source summaries created: N
  Source index updated: yes/no
```

Conditional, when contradictions > 0:
```
Contradictions flagged: N
  - wiki/concepts/foo.md: <one-line summary>
```

**New, always-on** (per spec §9.2):
```
Counterarguments / gaps surfaced: N
  - wiki/concepts/foo.md (counterargument): <one-line summary>
  - wiki/concepts/bar.md (gap): <one-line summary>
```

Conditional, when at least one source was skipped:
```
Skipped due to failure: N
  - raw/articles/2026-04-25-foo.md (kb-analyzer: malformed 02-analysis.md)
```

Conditional, when Agent 3 HALTed:
```
HALTED: kb-wiki-update failed mid-run.
  Failed source: raw/articles/2026-04-25-foo.md
  Staging dir: knowledge-base/.kb-ingest-staging/2026-04-25-foo/
  Error: <captured>
  Recovery: inspect staging + log + git diff; revert or fix manually.
```

## Failure modes (recap)

| Failure point | Policy |
|---|---|
| Agent 1 fails or output malformed | Skip source, keep staging, continue. Raw stays `pending`. |
| Agent 2 fails or output malformed | Skip source, keep staging, continue. Raw stays `pending`. |
| Agent 3 fails midway | Keep staging, HALT the run. Wiki may be partial. User investigates manually (no auto-rollback). |
| Agent never returns (deadlock) | Manual interrupt (Ctrl-C). Staging is intact; orchestrator state is "Agent N spawned but did not return." Recovery: inspect staging, manually flip raw status if needed, retry. v1 has no per-agent timeout. |

Spec §8 has the full failure rationale. Recovery is always manual in v1; no
transactional rollback.
