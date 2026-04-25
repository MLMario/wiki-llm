# kb-resolve — Scoped Context

> Scoped schema and conventions for the `kb-resolve` skill. Travels with the skill; read at runtime via `reference/CONTEXT.md`.
> Shared-rule drift: if you edit a rule that also appears in sibling KB skills (`kb-drop`, `kb-ingest`, `kb-lint`, `kb-query`), sync it across each skill's `reference/CONTEXT.md`.

The concept/entity/comparison and source-summary frontmatter keys this skill touches, the two page templates (Contradictions H3 entry, Amendment Preamble), and the full Step 6 mutation sequence (including the Step 6a pre-flight and Step 6b `[demoted]` marker insertion) are already inlined in this skill's `SKILL.md`. This file covers the cross-page conventions resolve must respect and the lifecycle rules that span skills.

## Directory Structure

```
knowledge-base/
  raw/                        # Source of truth (READ-ONLY from kb-resolve)
    articles/  papers/  notes/  misc/
  wiki/                       # Compiled pages
    concepts/                 # kb-resolve: read + edit body + frontmatter (sources: + source_summaries: in lockstep)
    entities/                 # kb-resolve: read + edit body + frontmatter (sources: + source_summaries: in lockstep)
    sources/                  # kb-resolve: prepend amendment preambles + flip has_demoted_or_debunk_claim
    comparisons/              # kb-resolve: edit body + frontmatter (same shape as concepts/entities) when resolution touches a comparison page
  index.md                    # kb-resolve does not touch this file (no new entries created, no stats change)
  source_index.md             # kb-resolve: insert [demoted] marker + bump Demoted counter + bump Last updated on the matching entry
  log.md                      # Processing log (prepend resolve entry)
```

## Access Control (kb-resolve)

- **Read-only on `raw/`.** Only `kb-drop` writes there. Resolve reads raw/ sources when the user wants to inspect the opposing claims before deciding.
- **Writes on `wiki/concepts/`, `wiki/entities/`, and `wiki/comparisons/`** are limited to: deleting the resolved H3 contradiction entry, editing the page body to reflect the resolved truth, mutating the `sources:` **and** `source_summaries:` frontmatter lists (add winners to both, remove losers from both, always in lockstep), flipping `has_contradiction:` to `false` when the last entry is resolved, and bumping `updated:`.
- **Writes on `wiki/sources/`** are limited to: prepending a new amendment preamble above prior preambles and above the H1, and setting `has_demoted_or_debunk_claim: true` if not already present.
- **Writes on `source_index.md`** are limited to: inserting the `[demoted]` marker between the `[<confidence>]` and `[<YYYY-MM-DD>]` badges of the matching entry (idempotent — at most one marker per entry), bumping the `Demoted: N` counter on the stats line when the marker is newly added, and bumping the `> Last updated:` line. kb-resolve never adds or removes `source_index.md` entries; that is kb-ingest's job (append on summary creation) and kb-lint's report scope (never auto-fixed).
- **`sources:` and `source_summaries:` frontmatter lists** are mutated by both `kb-ingest` (appends on normal updates, held-out in lockstep on contradicting claims) and `kb-resolve` (endorses winners / removes losers on resolution, always in lockstep). Other skills only read them.
- **Does not write to `index.md`.** Resolution does not change the page inventory or stats. If the resolution substantially changes a page's summary line, the user can update the index manually; resolve does not touch it automatically.

## Wiki Filename Convention

- Format: `kebab-case-topic-name.md` matching the concept/entity name.
- ASCII only. Lowercase. Letters, digits, and hyphens only.
- Source-summary filename reuses the raw file's stem with a `-summary` suffix: `raw/articles/2026-04-15-foo.md` → `wiki/sources/2026-04-15-foo-summary.md`. This is how resolve derives the summary path from a losing raw/ path.

## Cross-References (`[[wikilink]]` Syntax)

- Always `[[page-name]]` — no subdirectory path, no `.md` extension.
- `page-name` matches the filename without `.md`. Example: `[[attention-mechanism]]` resolves to `wiki/concepts/attention-mechanism.md`.
- Used inside the amendment preamble's `Wiki page(s) affected:` bullet to link back to the page where the contradiction was resolved.

## Contradiction Entry Format (parsed, not written)

Written by `kb-ingest` at flag time; parsed by `kb-resolve` during list mode and Step 3 presentation; deleted by `kb-resolve` at resolution time.

```markdown
### [YYYY-MM-DD] {short descriptor of what conflicts}
- **Status:** open
- **Summary:** {one line the user can scan to recall the conflict}
- **Existing claim:** {paraphrase or verbatim} -- sources: `raw/path/a.md`, `raw/path/b.md`
- **New claim:** {paraphrase or verbatim} -- source: `raw/path/new.md`
```

- The H3 heading is the entry delimiter. Multiple open entries stack under a single `## Contradictions` H2.
- Open-status detection: bullet line `- **Status:** open` inside the entry body.
- Deletion span: from the `### ` line through the last bullet, stopping at the next H2 or H3 (whichever comes first).
- When the deleted entry was the last H3 under `## Contradictions`, also delete the H2 and flip `has_contradiction:` to `false`.

## Amendment Preamble Format (written)

Written by `kb-resolve` at resolution time — prepended to each losing source's summary page. Template documented in `kb-resolve/SKILL.md` and in `kb-ingest/SKILL.md` (both files must stay in sync).

```markdown
> **Amendment -- [YYYY-MM-DD]:** A claim from this source was demoted during contradiction resolution.
> - **Claim demoted/rejected:** {one-line paraphrase}
> - **Wiki page(s) affected:** [[affected-page]]
> - **Resolution favored:** `raw/path/winner.md` ({short why})
> - **Rationale:** {user's free-form reasoning, quoted or paraphrased}
```

- Placement: immediately after the frontmatter's closing `---`, above any prior amendment preambles and above the H1 `# [Source Title] -- Summary`.
- Stacking order: **most-recent-on-top** (Phase 0 decision #1 of the contradiction-handling build). A summary that accumulates multiple amendments shows the newest first.
- Use literal double-hyphens (`--`) in the prefix `> **Amendment -- `. This matches the regex `kb-lint` uses to detect preambles (`^> \*\*Amendment -- `). Em-dashes (`—`) will break the lint pair check.
- The body of the summary page below the preambles (H1, TLDR, Key Takeaways, Extracted Concepts, Extracted Entities, See Also) is never rewritten — preamble only prepends.

## `source_index.md` Entry Format (parsed and mutated)

Written by `kb-ingest` on summary creation (newest-first append); mutated by `kb-resolve` to insert the `[demoted]` marker at resolution time; parsed by `kb-lint` for the demoted-marker integrity check.

```
- wiki/sources/{stem}-summary.md [source-summary] [<confidence>] [<YYYY-MM-DD>] [<tag1, tag2>] -- <one-line summary>
```

After a demotion:

```
- wiki/sources/{stem}-summary.md [source-summary] [<confidence>] [demoted] [<YYYY-MM-DD>] [<tag1, tag2>] -- <one-line summary>
```

- Path is a **relative path, not a wikilink** (per sources-layer design decision 6).
- `[demoted]` marker sits **between `[<confidence>]` and `[<YYYY-MM-DD>]`** — never elsewhere. Idempotent: at most one marker per entry regardless of how many times the source has been demoted.
- Stats line format (line 4): `> Total sources: N | Articles: N | Papers: N | Notes: N | Misc: N | Demoted: N`. kb-resolve bumps `Demoted: N` only when inserting a new marker, not when the marker was already present.
- `> Last updated:` line (line 3) bumped to today's date on any mutation.
- Sort order of entries: `created:` descending (newest first); ties broken alphabetically by path. kb-resolve does not resort — it only mutates the existing entry in place.

## Frontmatter Key Lifecycles

### `has_contradiction` (concept + entity pages)

| State | Meaning | Set by | Cleared by |
|---|---|---|---|
| **absent** | Page has never held a contradiction. | — | — |
| `true` | At least one open H3 entry exists under `## Contradictions`. | `kb-ingest` (at flag time) | `kb-resolve` flips it to `false` on the last resolve — key stays. |
| `false` | Soft reminder: the page once held a contradiction, all entries now resolved. | `kb-resolve` | Key is kept indefinitely. Never delete it. |

Pair invariant (enforced by `kb-lint` Step 6.5 Block A): `has_contradiction: true` ↔ at least one H3 entry under `## Contradictions` with `- **Status:** open`.

### `has_demoted_or_debunk_claim` (source-summary pages)

| State | Meaning | Set by | Cleared by |
|---|---|---|---|
| **absent** | No claim from this source has ever been demoted. | — | — |
| `true` | At least one amendment preamble is present in the body **and** the matching `source_index.md` entry carries a `[demoted]` marker. | `kb-resolve` (first time a claim from this source loses a resolution; same step that inserts the `[demoted]` marker). | Never — permanent once set. Additional demotions stack additional preambles but leave the flag and the marker as-is. |

Pair invariants:

- **Preamble pairing** (enforced by `kb-lint` Step 6.5 Block B): `has_demoted_or_debunk_claim: true` ↔ at least one body line matching `^> \*\*Amendment -- `.
- **`source_index.md` marker pairing** (enforced by `kb-lint` Step 6.7 — introduced in Phase 3 of the sources-layer refactor): `has_demoted_or_debunk_claim: true` ↔ the matching entry in `source_index.md` carries a `[demoted]` marker between `[<confidence>]` and `[<YYYY-MM-DD>]`. Bidirectional — neither side stands alone.

## `sources:` + `source_summaries:` Mutation Rules

The `sources:` frontmatter list on a concept/entity/comparison page is the **currently-endorsed source set** for that page's content — not the historical list of every source that has ever touched it. `source_summaries:` is a strict 1-to-1 mirror of `sources:`, derived by slug rule `raw/{subdir}/{stem}.md → wiki/sources/{stem}-summary.md`. Resolve mutates both lists in lockstep:

- **Add winner paths (both lists).** For each winner raw path not already present in `sources:`, append to `sources:` AND append the derived `wiki/sources/{stem}-summary.md` to `source_summaries:` at the matching position.
- **Remove loser paths (both lists).** For each loser raw path currently in `sources:`, remove from `sources:` AND remove the matching derived entry from `source_summaries:`.
- **Unchanged sources stay as-is on both lists.** Resolution is scoped to the paths named in the H3 entry; do not touch other entries.
- **Order-preserving.** Matching indices stay aligned across both lists.
- **Invariant.** Post-mutation `len(sources) == len(source_summaries)` — enforced by `kb-lint` Step 6.6. kb-resolve's Step 6a pre-flight refuses to proceed if any winner raw path has no summary page on disk (would violate the invariant after mutation).

A demoted source path is never lost from the system — its raw/ file is untouched, its summary page is flagged with `has_demoted_or_debunk_claim: true` and carries an amendment preamble, **and** the matching `source_index.md` entry gets the `[demoted]` marker inserted between `[<confidence>]` and `[<YYYY-MM-DD>]`. Discoverable via grep on the flag, via the preamble's `Wiki page(s) affected:` backlink, or via scanning `source_index.md` for `[demoted]`.

Shared-rule drift: the `source_summaries:` mirror rule is new with Phase 2 of the sources-layer refactor. `kb-drop` does not mutate either list. `kb-ingest` still appends to both on normal updates but holds both held-out symmetrically when the claim is contradicting (see `kb-ingest/reference/CONTEXT.md`). `kb-lint` enforces the parity invariant in Step 6.6 (Phase 3). `kb-query` reads `sources:` as "currently endorsed," not historical — when the user asks about history of a page, refer to the amendment preambles on the linked source summaries.

## Log Format

- `log.md` is **prepend-only** — newest entries at the top, immediately below the H1.
- Resolve entry heading format: `## [YYYY-MM-DD] resolve | {affected page slug}`
- Valid log operations across the KB: `drop`, `ingest`, `query`, `lint`, `resolve`, `skip`.
- Resolve entry body (prescribed):
  ```markdown
  - **Page:** wiki/{subdir}/{slug}.md
  - **Summary:** {short description of the contradiction}
  - **Decision:** {one-line paraphrase of the user's decision}
  - **Sources endorsed:** {comma-separated raw paths}
  - **Sources demoted:** {comma-separated raw paths, or "none"}
  ```

## Resolve-Relevant Conventions

- **One contradiction per dialogue (v1).** If a page has multiple open H3 entries, resolve them one at a time. Batch resolution is deferred (Phase 0 decision #3).
- **No writes until the resolution is unambiguous.** Step 5 loops clarifying questions until the mutation set is concrete. Never write partial mutations on an ambiguous decision.
- **Refuse to operate on drifted state.** If the flag/body invariant is broken on the target page (e.g., `has_contradiction: true` with no open entry, or vice versa), stop and direct the user to `/kb-lint`. Resolve does not repair — that's the lint boundary.
- **Missing losing source summary is non-blocking.** If a losing raw/ source's `wiki/sources/{slug}-summary.md` does not exist, skip the preamble step and the `[demoted]` marker insertion for that source, report it, and continue. Do not abort the resolution.
- **Missing `source_index.md` entry is non-blocking.** If the summary page exists but its entry is absent from `source_index.md`, skip the `[demoted]` marker insertion for that source, report it, and continue. Parallel to the missing-summary-page handling.
- **Missing winner summary page is blocking.** The Step 6a pre-flight refuses to proceed if any winner raw path lacks a summary page on disk (would violate the `len(sources) == len(source_summaries)` invariant after mutation). Report and direct the user to `/kb-lint`.
- **User abort is safe.** If the user cancels before Step 6 writes, no mutations have occurred. Report cleanly.

### `source_summaries:` mirror rule (Phase 2 sources-layer refactor)

Every `sources:` mutation in Step 6a mirrors onto `source_summaries:` exactly. Winners are added to both at the same position; losers are removed from both. The derived summary path is computed mechanically via the slug rule `raw/{subdir}/{stem}.md → wiki/sources/{stem}-summary.md` — never ask the user about `source_summaries:`. Post-mutation, `len(sources) == len(source_summaries)` must hold. `kb-lint` Step 6.6 (Phase 3) enforces this invariant on every run.

Applies to concept, entity, and comparison pages identically. Contradiction hold-outs by `kb-ingest` also apply to both lists in lockstep (see `kb-ingest/reference/CONTEXT.md`), so the parity invariant holds throughout the ingest → flag → resolve lifecycle.

### `source_index.md` demoted-marker update (Phase 2 sources-layer refactor)

After Step 6b flips `has_demoted_or_debunk_claim:` to true on a losing source summary, kb-resolve inserts the `[demoted]` marker into that source's `source_index.md` entry between `[<confidence>]` and `[<YYYY-MM-DD>]`. Idempotent: if the marker is already present (source demoted on a prior page), do not re-insert. Bump `Demoted: N` on the stats line only when the marker is newly added — count pages, not demotions. Always bump `> Last updated:` to today's date.

The summary page remains in `source_index.md` (mark-but-show). Demoted sources stay discoverable via the source index; the marker lets `kb-query` weight them appropriately (Phase 4). `kb-lint` Step 6.7 (Phase 3) enforces the bidirectional invariant: flag set ↔ marker present.
