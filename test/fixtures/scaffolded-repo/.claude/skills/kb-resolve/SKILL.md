---
name: kb-resolve
description: List and resolve open contradictions in the knowledge base wiki. Use when the user asks to resolve, reconcile, adjudicate, or decide on flagged contradictions.
---

# kb-resolve

Work through contradictions flagged by `kb-ingest`. Two invocation shapes: list mode (no args) surfaces every open contradiction across the wiki so the user can pick one; targeted mode (page slug) jumps straight to a specific page. On resolution, mutates the affected wiki page (including both `sources:` and `source_summaries:` in lockstep), amends the losing source summaries, inserts the `[demoted]` marker in `source_index.md`, and appends a log entry. Never writes until the resolution is unambiguous.

Ingest flags; resolve decides. This skill is the only writer of amendment preambles on `wiki/sources/` pages, the only writer of the `[demoted]` marker in `source_index.md`, and (alongside `kb-ingest`) the only writer of the `has_contradiction` and `has_demoted_or_debunk_claim` frontmatter keys.

## Input Parameters

- **No arguments** → list mode: surface every open contradiction across the wiki and ask the user which to resolve.
- **`<page-slug>`** → targeted mode: jump directly to the named page's open contradictions. Slug is the filename without `.md` (e.g., `attention-mechanism`, `andrej-karpathy`).

## Workflow

### Step 1: Read reference/CONTEXT.md

Read `reference/CONTEXT.md` (in this skill's folder) to confirm the current schema, contradiction templates, frontmatter lifecycles, and `sources:` mutation rules.

### Step 2: Dispatch on Input

**No arguments — list mode:**

1. Use **Grep** to find every page carrying an open contradiction:
   - Pattern: `has_contradiction: true`
   - Paths (run in parallel): `knowledge-base/wiki/concepts/` and `knowledge-base/wiki/entities/`
2. For each hit, use **Read** to load the page and extract every H3 entry under its `## Contradictions` section whose body contains the line `- **Status:** open`.
3. Emit a numbered list. One line per open entry:
   ```
   {N}. wiki/{concepts|entities}/{slug}.md -- [YYYY-MM-DD] {summary from the H3 entry}
   ```
4. If the list is empty, report `No open contradictions found.` and stop.
5. Ask the user which entry to resolve (by number, or by typing a page slug). Proceed to Step 3 once the user picks one.

**With a slug — targeted mode:**

1. Resolve the slug to an actual page:
   - Check `knowledge-base/wiki/concepts/{slug}.md` first.
   - Fall back to `knowledge-base/wiki/entities/{slug}.md`.
   - If neither exists, report `No page found for slug '{slug}'.` and stop.
2. Use **Read** to load the page. Extract every H3 entry under `## Contradictions` with `Status: open`.
3. If there are zero open entries, report `{path} has no open contradictions.` and stop.
4. If there is exactly one open entry, proceed to Step 3 with it.
5. If there is more than one open entry, list them (same format as list mode) and ask the user to pick one. Then proceed to Step 3.

### Step 3: Present the Contradiction

Display the selected H3 entry verbatim so the user can see both claims side-by-side with their raw/ source paths. Include the parent page path above the entry for orientation.

Offer to read either side's raw/ source using **Read** before the user commits. If the user says yes, fetch the requested raw/ file(s) and present their content, then ask again whether they are ready to decide.

### Step 4: Collect the User's Free-Form Decision

Prompt the user for their decision. **No menu. No pre-seeded outcome list.** They type whatever they want — a sentence, a paragraph, a quote from one of the raw sources. Capture their input verbatim.

Examples (illustrative only — the user is not limited to these):
- "B is right. The old wording overstates confidence."
- "Both are partially right. Keep A's framing but soften the claim and add B's caveat."
- "A is right. B misread the paper; reject B."
- "Neither — the resolution is actually a third framing I'll describe: ..."

### Step 5: Disambiguate Before Writing

Reason over the user's decision text against the H3 entry. **No wiki writes in this step.** If any of the following is unclear, ask a clarifying question and loop until the answer is concrete:

1. **Which claim wins.** If the user says "B is right," that's usually clear. If they say "both have a point," ask how the page body should read after resolution (do both claims survive, or does one get reworded?).
2. **How the page body should read.** A contradiction resolution almost always requires editing the prose of the page (not just deleting the H3 entry). Confirm the exact replacement wording, or paraphrase your planned edit back to the user for sign-off.
3. **`sources:` list mutation.** Which sources end up endorsed on this page? Default interpretation: the winner's raw path is added (if absent); any loser that was previously in `sources:` is removed. If the user's decision implies a different shape (e.g., both sources stay because they each contribute correct aspects), surface that and confirm. (`source_summaries:` mirrors `sources:` mechanically — same add/remove, derived via `raw/{subdir}/{stem}.md → wiki/sources/{stem}-summary.md`. Never ask the user about it.)
4. **Rationale wording for losing source summaries.** The amendment preamble records the user's rationale. If the user's decision is terse ("B is right"), ask them for one line explaining *why* that will sit permanently on the loser's source summary.

Loop the user until the resolution is expressible as a concrete mutation set: final wiki body edits, final `sources:` add/remove list, final preamble rationale text. Only then continue to Step 6.

If the user aborts mid-dialogue (types "cancel" / "nevermind" / similar), stop without writing anything.

### Step 6: Apply Mutations

Atomic, in the order below. If any sub-step fails, stop and report what was and was not written.

#### Step 6a: Edit the Affected Wiki Page

**Pre-flight — verify winner source summaries exist.** Before any writes in this sub-step, for every winner raw path that will be added to `sources:`, derive the summary path `knowledge-base/wiki/sources/{stem}-summary.md` and verify the file exists on disk. If any is missing, stop and report: `Winner source raw/{subdir}/{stem}.md has no summary page at wiki/sources/{stem}-summary.md — refusing to proceed. Run /kb-lint or reconcile manually.` No writes occur if this check fails. kb-resolve does not intentionally create a parity violation.

Once pre-flight passes, use **Read** to load the page fresh (in case it changed during the dialogue), then use **Edit** for surgical mutations:

1. **Delete the entire H3 contradiction entry** — heading and all bullet lines down to (but not including) the next H2 or H3.
2. **Contradictions section cleanup:**
   - If other open H3 entries remain under `## Contradictions`, leave the H2 in place and leave `has_contradiction: true` in frontmatter.
   - If that was the last H3 entry, remove the `## Contradictions` H2 heading entirely and set `has_contradiction: false` in the frontmatter. **Keep the key** as a soft reminder that the page once held a contradiction. Do not delete the key.
3. **Edit the page body to reflect the resolved truth.** Apply the exact prose edits the user confirmed in Step 5. Surgical — do not rewrite unchanged sections.
4. **Update the `sources:` and `source_summaries:` lists in frontmatter (mirror in lockstep):**
   - Add any winner raw paths that are not already present to `sources:`; for each such add, also append the derived `wiki/sources/{stem}-summary.md` to `source_summaries:` at the same position.
   - Remove any loser raw paths that are currently present from `sources:`; for each such removal, also remove the derived `wiki/sources/{stem}-summary.md` from `source_summaries:`.
   - Sources whose status did not change stay as-is on both lists.
   - Order-preserving. Post-mutation invariant: `len(sources) == len(source_summaries)`.

   **Every `sources:` mutation in this step mirrors onto `source_summaries:` exactly.** Add winner paths to both; remove loser paths from both. Strict 1-to-1 parity is invariant; `kb-lint` enforces. The derivation `raw/{subdir}/{stem}.md → wiki/sources/{stem}-summary.md` is mechanical — never ask the user about `source_summaries:`.
5. **Update `updated:`** to today's date.

#### Step 6b: Amend Each Losing Source Summary

For each raw/ source path whose claim was demoted or rejected in the resolution:

1. Derive the matching summary page path: `knowledge-base/wiki/sources/{slug}-summary.md` where `{slug}` is the raw filename minus `.md` (raw filenames follow `YYYY-MM-DD-slug.md`, so the full stem is reused).
2. Use **Read** to load the summary page.
3. **If the summary does not exist:** report `Source summary {path} missing — skipping preamble (run /kb-lint).` and continue to the next losing source. Do not block the resolution. Ingest should have created the summary; a missing summary is a lint concern, not a resolve concern.
4. **Prepend the amendment preamble** immediately below the frontmatter's closing `---`, **above any prior amendment preambles and above the H1**. Most-recent-on-top — newer preambles push older preambles down but stay above the original content. Use the Amendment Preamble template at the bottom of this file.
5. **Set `has_demoted_or_debunk_claim: true`** in the summary's frontmatter if not already present. The flag is permanent once set — do not clear it on future resolutions.
6. Use **Edit** to write both changes to the summary page.
7. **Insert the `[demoted]` marker in `knowledge-base/source_index.md`:**
   - Use **Read** to load `source_index.md`. Find the single entry whose path matches `wiki/sources/{slug}-summary.md`.
   - Entry shape: `- wiki/sources/{stem}-summary.md [source-summary] [<confidence>] [<YYYY-MM-DD>] [<tags>] -- <one-liner>`.
   - Insert `[demoted]` between the `[<confidence>]` and `[<YYYY-MM-DD>]` badges. New shape: `... [source-summary] [<confidence>] [demoted] [<YYYY-MM-DD>] [<tags>] -- ...`.
   - **Idempotent:** if the entry already carries `[demoted]` (the source was demoted on another page previously), do not re-insert. `has_demoted_or_debunk_claim:` is permanent — the marker is too. Preamble stacking in Step 6b sub-step 4 still records this resolution; the `source_index.md` entry only carries one `[demoted]` marker regardless of how many times the source has been demoted.
   - **Bump the `Demoted: N` counter** on line 4 (stats line) **only when the marker is newly inserted**, not when it was already present. Count pages, not demotions.
   - Update the `> Last updated:` line (line 3) to today's date.
   - Use **Edit** to write.
   - **If the entry is missing from `source_index.md`:** report `Source index entry for wiki/sources/{slug}-summary.md not found — skipping [demoted] marker (run /kb-lint).` and continue with the next losing source. Do not block the rest of the resolution. Parallel to the missing-summary handling above.
   - The summary page stays in `source_index.md` — mark-but-show. Demoted sources remain discoverable via the source index; the marker lets `kb-query` weight them appropriately.

#### Step 6c: Prepend the Log Entry

Use **Read** to load `knowledge-base/log.md`, then prepend a new entry immediately below the H1:

```markdown
## [YYYY-MM-DD] resolve | {affected page slug}
- **Page:** wiki/{subdir}/{slug}.md
- **Summary:** {short description of the contradiction}
- **Decision:** {one-line paraphrase of the user's decision}
- **Sources endorsed:** {comma-separated raw paths}
- **Sources demoted:** {comma-separated raw paths, or "none"}
```

Use **Write** to save the updated log.

### Step 7: Confirm and Exit

Report the mutation set back to the user:

```
Resolution applied:
  Page:               wiki/{subdir}/{slug}.md
  Contradictions remaining on this page: N
  Sources endorsed:   {paths}
  Sources demoted:    {paths, or "none"}
  Summaries amended:  {paths, or "none"}
  Summaries skipped:  {paths with reason, or "none"}
  Source index:       {N} [demoted] marker(s) added, {M} already present, {K} entries missing (see above)

Next: run /kb-lint to verify structural integrity.
```

## Error Handling

- **Flag/body state drift** — page has `has_contradiction: true` but no `## Contradictions` section with open entries, or vice versa. Refuse to proceed. Report `{path} has inconsistent contradiction state — run /kb-lint to surface and fix before resolving.` Do not attempt to repair. This is the lint/resolve boundary: lint detects drift; resolve refuses to operate on drifted state.
- **Losing source summary missing** — the raw/ source's `wiki/sources/{slug}-summary.md` file does not exist. Skip the preamble step for that source, report it to the user in Step 7, and proceed with the rest of the resolution. Do not block the page mutations on a missing summary.
- **Winner source summary missing** — a winner raw path has no derivable summary page on disk. Caught by the Step 6a pre-flight check. Refuse to proceed. Report `Winner source {raw_path} has no summary page at {derived_path} — refusing to proceed. Run /kb-lint or reconcile manually.` No writes occur. kb-resolve does not intentionally create a parity violation (`len(sources) == len(source_summaries)` would break, plus `source_summaries:` would point to a nonexistent file).
- **Losing source's `source_index.md` entry missing** — the source summary exists on disk and gets amended normally, but the matching entry in `source_index.md` is absent. Log the gap in Step 7 (`Source index entry for {path} not found — skipping [demoted] marker (run /kb-lint).`) and continue. Do not block the rest of the resolution. Parallel to the missing-summary-page handling.
- **Already-demoted source being demoted again on a different page** — `has_demoted_or_debunk_claim:` is permanent; the `[demoted]` marker in `source_index.md` is permanent too. Step 6a still mirrors the current page's `sources:` removal onto `source_summaries:`; Step 6b still prepends a fresh amendment preamble (preamble stacking is most-recent-on-top); the `source_index.md` entry is left unchanged and the `Demoted:` counter is not bumped again. One marker per entry regardless of demotion count.
- **`source_index.md` missing entirely** — treat as a Phase 0 migration regression. Report `source_index.md not found — refusing to update markers. Run /kb-lint to recreate.` Proceed with the rest of Step 6 (page + summary mutations) but skip all Step 6b sub-step 7 marker inserts; record the skip in the Step 7 report. Do not auto-recreate the file; recreation is `/kb-lint`'s job.
- **User aborts mid-dialogue** — cancel in any step before Step 6 writes nothing. Report `Resolution cancelled. No changes written.`
- **User's decision remains ambiguous after multiple clarifying passes** — keep looping. Do not guess. Do not write partial mutations.
- **log.md is missing** — create it with the initial `# Knowledge Base Log` heading before prepending.

## Explicitly Out of Scope for v1

- **Batch resolution.** v1 resolves one contradiction per dialogue. A page with multiple open H3 entries must be resolved one at a time — return to list/targeted mode after each. (Phase 0 decision #3 in `knowledge-base/CONTRADICTION-HANDLING-PLAN.md`.)
- **Semantic revalidation of already-resolved contradictions.** Once an H3 entry is deleted, it is gone. Historical provenance lives on the losing source's summary page via the amendment preamble — not on the wiki page body.
- **Cross-page contradiction scanning.** Resolve only touches the pages directly referenced by the selected H3 entry and the summary pages for the sources it names. It does not scan the rest of the wiki for related contradictions.

## Frontmatter Schema Reference

### Concept / Entity / Comparison Page — keys this skill touches

```yaml
---
updated: YYYY-MM-DD                  # bumped to today on every resolution
sources:                             # add winner paths, remove loser paths
  - raw/path/winner.md
source_summaries:                    # strict 1-to-1 mirror of sources:; add/remove in lockstep with sources:
  - wiki/sources/winner-summary.md   # derived: raw/{subdir}/{stem}.md → wiki/sources/{stem}-summary.md
has_contradiction: true | false      # true while >=1 open H3 entry remains; flipped to false on the last resolve (kept as soft reminder, not deleted)
---
```

Post-mutation invariant: `len(sources) == len(source_summaries)`. Comparison pages carry the same fields as concepts/entities — if a resolution ever affects one, mirror both lists identically.

### Source Summary Page — keys this skill touches

```yaml
---
has_demoted_or_debunk_claim: true    # set the first time any claim from this source is demoted; permanent once set
---
```

## Page Templates

### Contradictions H3 Entry (parsed by this skill; written by `kb-ingest`)

```markdown
### [YYYY-MM-DD] {short descriptor of what conflicts}
- **Status:** open
- **Summary:** {one line the user can scan to recall the conflict}
- **Existing claim:** {paraphrase or verbatim} -- sources: `raw/path/a.md`, `raw/path/b.md`
- **New claim:** {paraphrase or verbatim} -- source: `raw/path/new.md`
```

Notes:

- The H3 heading is the entry delimiter. Resolution deletes from the `### ` line through the last bullet, stopping at the next H2 or H3 (whichever comes first).
- Open-status detection: a bullet line matching `- **Status:** open` inside the entry body.
- When deleting the last open entry on a page, also remove the `## Contradictions` H2 heading and flip `has_contradiction:` to `false` (keep the key — it is a soft reminder).

### Amendment Preamble (written by this skill; prepended to losing source summaries)

```markdown
> **Amendment -- [YYYY-MM-DD]:** A claim from this source was demoted during contradiction resolution.
> - **Claim demoted/rejected:** {one-line paraphrase}
> - **Wiki page(s) affected:** [[affected-page]]
> - **Resolution favored:** `raw/path/winner.md` ({short why})
> - **Rationale:** {user's free-form reasoning, quoted or paraphrased}
```

Notes:

- Prepended immediately after the frontmatter's closing `---` and **above** both any prior amendment preambles and the H1 `# [Source Title] -- Summary`. Most-recent-on-top (Phase 0 decision #1 in `knowledge-base/CONTRADICTION-HANDLING-PLAN.md`).
- Everything below the preamble (H1, TLDR, Key Takeaways, Extracted Concepts, Extracted Entities, See Also) is preserved verbatim — the preamble only prepends.
- Detection pattern for the `kb-lint` bidirectional check: blockquote line starting `> **Amendment -- ` (literal double-dash). Do not use em-dash here; lint's regex expects `--`.
- Pair invariant with `has_demoted_or_debunk_claim: true` in frontmatter — bidirectional (enforced by `kb-lint` Step 6.5 Block B).
