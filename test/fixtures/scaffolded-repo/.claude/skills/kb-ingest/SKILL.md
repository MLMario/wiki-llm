---
name: kb-ingest
description: Compile pending items in the knowledge base raw/ inbox into structured wiki pages with wikilinks. Use when the user asks to ingest, compile, process, or build the wiki from pending raw/ items.
---

# kb-ingest

Process `pending` files in `knowledge-base/raw/` into structured wiki pages. This is the compilation step -- the core of the Karpathy LLM Wiki pattern.

## Input Parameters

- **None required.** Automatically finds all pending raw/ files.
- **Optional:** The user may specify a single file path to ingest only that file.

## Workflow

### Step 1: Read reference/CONTEXT.md

Read `reference/CONTEXT.md` (in this skill's folder) to confirm the current schema, templates, and conventions.

### Step 2: Find Pending Sources

1. Use **Grep** to search all files in `knowledge-base/raw/` for `status: pending` in frontmatter.

   Search pattern: `status: pending`
   Path: `knowledge-base/raw/`

2. If the user specified a single file, verify it exists and has `status: pending`.
3. If no pending files are found, report "Nothing to ingest. All raw/ files have been processed." and stop.
4. Sort the found files by their `dropped_date` (oldest first) to preserve chronological wiki growth.

### Step 3: Process Each Pending Source (One at a Time)

For each pending source file, perform steps 3a through 3i before moving to the next file.

#### Step 3a: Read the Source

Use **Read** to load the full content of the raw/ file. Parse the frontmatter to extract title, dropped_date, source URL, type, and tags.

#### Step 3b: Read the Current Index

Use **Read** to load `knowledge-base/index.md`. Understand what topics and pages already exist so you can avoid duplicates and add cross-references.

#### Step 3c: Extract Key Information

Carefully read the source content and extract:

1. **Main topics/concepts** -- abstract ideas, patterns, techniques, architectures (e.g., "LLM Knowledge Base", "retrieval-augmented generation", "attention mechanism").
2. **Entities** -- specific people, organizations, projects, products (e.g., "Andrej Karpathy", "OpenAI", "GPT-5").
3. **Claims and facts** -- specific assertions with evidence.
4. **Relationships** -- connections between concepts and entities.
5. **Definitions** -- clear explanations of terms.

For each extracted item, note:
- Whether it is a concept, entity, or relationship.
- What tags apply.
- The confidence level based on the source quality:
  - Established publication (major news, academic journal, official announcement) -> **high**
  - Blog post, tutorial, single-author analysis -> **medium**
  - Unverified claim, speculation, community rumor -> **low**

#### Step 3d: Create Source Summary Page

1. Create a source summary page at `knowledge-base/wiki/sources/YYYY-MM-DD-slug-summary.md`.
2. Use the Source Summary Page template from the Page Templates section at the bottom of this file.
3. The filename slug should match the raw file's slug with `-summary` appended.
4. Fill in all frontmatter fields:
   - `title`: "[Source Title] -- Summary"
   - `type`: source-summary
   - `tags`: extracted from the source content
   - `created`: today's date
   - `updated`: today's date
   - `confidence`: based on source quality assessment
   - `sources`: path to the raw/ file being ingested
   - `related`: wikilinks to concept and entity pages that will be created/updated
5. Write the TLDR (one sentence), Key Takeaways (3-7 bullet points), Extracted Concepts, and Extracted Entities sections.
6. Use **Write** to save the file.
7. **Append an entry to `knowledge-base/source_index.md`** at the top of the `## Sources by Date` list (newest-first position):
   - Format: `- wiki/sources/<stem>-summary.md [source-summary] [<confidence>] [<YYYY-MM-DD>] [<tag1, tag2>] -- <one-line summary>`
   - Path is a **relative path, not a wikilink**.
   - `[demoted]` badge is omitted on creation — new summaries are never demoted yet. kb-resolve inserts it later (between `[confidence]` and `[date]`) when a claim is demoted.
   - `[YYYY-MM-DD]` = the summary page's `created:` date.
   - Tags copied from summary frontmatter; one-liner derived from TLDR, truncated to ~80 chars.
8. **Update the `source_index.md` stats line** (line 4): bump `Total sources:` and the matching subtype counter. Subtype derived from the raw file's subdirectory (`raw/articles/` → Articles, `raw/papers/` → Papers, `raw/notes/` → Notes, `raw/misc/` → Misc).
9. **Update the `> Last updated:` line** at the top of `source_index.md` to today's date.

#### Step 3e: Create or Update Wiki Pages

For each extracted concept and entity:

1. Determine the expected filename: `kebab-case-name.md`
2. Determine the subdirectory: concepts/ for concepts, entities/ for entities.
3. Use **Grep** to check if a page with that name already exists in `knowledge-base/wiki/`:
   - Search for the filename in `knowledge-base/wiki/concepts/` and `knowledge-base/wiki/entities/`.

**If the page DOES NOT exist -- create it:**

1. Choose the correct template (Concept or Entity) from the Page Templates section at the bottom of this file.
2. Fill in all frontmatter fields. Set `created` and `updated` to today's date.
3. Set `confidence`:
   - If this is the only source mentioning this concept -> **medium** (or **low** if the source itself is low confidence).
   - If the index shows an existing page on a related topic that corroborates -> **high**.
4. **Write `source_summaries:` in frontmatter immediately after `sources:`**, one derived `wiki/sources/<stem>-summary.md` entry per raw path in `sources:`, in matching order. If `sources:` is empty, write `source_summaries: []`. Strict 1-to-1 parity — `len(sources) == len(source_summaries)`.
5. Write the full page content: TLDR, Description/Overview, Key Properties/Contributions, Counterarguments/Gaps, See Also.
6. Add `[[wikilinks]]` to related pages that exist (check the index).
7. Use **Write** to save the new file.

**If the page DOES exist -- update it:**

First classify each extracted claim for this page against its current body (sub-step 3e-i), then apply the route for each claim (sub-step 3e-ii). A single source may land multiple claims on the same page; route each one independently.

**Step 3e-i: Classify each claim.** Using LLM judgment against the page's current content, route each claim to one of four buckets:

| Bucket | Definition | Route |
|---|---|---|
| **Direct factual opposition** | "X is true" vs. "X is false" about the same thing. Resolvable in principle by deciding which is right. | Step 3e-contradict (below). |
| **Counterargument** | Different framing, critique, or competing perspective; not strictly factually opposed. Both views can coexist. | Append to `## Counterarguments / Gaps`. |
| **Gap** | Acknowledged unknown, open question, or explicitly missing data. No conflict, just absence. | Append to `## Counterarguments / Gaps`. |
| **Corroboration or additive detail** | Reinforces or extends existing content without conflict. | Merge into body (normal update path). |

If uncertain which bucket applies (especially opposition vs. counterargument), default to counterargument/gap. Conservative — don't over-flag. Contradiction entries clutter pages; a missed contradiction only means the same failure mode as today.

**Step 3e-ii: Apply the route.**

1. Use **Read** to load the existing page.
2. Use **Edit** to make targeted updates. Do NOT rewrite the entire page — surgical edits only.
3. **For corroborating / additive claims:**
   - Add the new raw/ file path to the `sources` list in frontmatter.
   - **Append the derived `wiki/sources/<stem>-summary.md` path to `source_summaries:` in the same position** — strict 1-to-1 mirror of `sources:`. Post-mutation invariant: `len(sources) == len(source_summaries)`.
   - Update the `updated` date to today.
   - Add the new information to the relevant body section.
   - If the new source corroborates existing claims and the page was `medium` confidence, consider upgrading to `high`.
   - Add any new `[[wikilinks]]` to the `related` list.
   - Add new tags if the source introduces new topic areas.
4. **For counterargument / gap claims:** append a bullet under `## Counterarguments / Gaps`. Then run the corroborating-claim updates above (sources, source_summaries, updated, wikilinks, tags) — the source is contributing a valid perspective, just not a factual overwrite.
5. **For direct factual opposition claims:** see Step 3e-contradict below.

#### Step 3e-contradict: Flag a Contradiction (never resolve)

Runs only for claims classified as direct factual opposition in Step 3e-i.

1. **Append an H3 entry** under the page's `## Contradictions` section using the Contradictions Section template at the bottom of this file. Fill in:
   - Heading: `### [YYYY-MM-DD] {short descriptor of what conflicts}`
   - `Status: open`
   - `Summary:` one line the user can scan to recall the conflict.
   - `Existing claim:` paraphrase or verbatim, with the raw/ source paths currently on the page.
   - `New claim:` paraphrase or verbatim, with the new source's raw/ path.
2. **Create the `## Contradictions` H2 if absent.** Placement: after `## Counterarguments / Gaps` if present, otherwise immediately before `## See Also`.
3. **Set `has_contradiction: true`** in the page's frontmatter if not already present.
4. **Do NOT add the new source's raw path to `sources:` on this page, AND do NOT add the derived `wiki/sources/<stem>-summary.md` to `source_summaries:` on this page.** This is the single case where the normal "always append the new source to `sources:` (and mirror to `source_summaries:`)" rule is suspended. Both lists are held out in lockstep until `kb-resolve` decides the source's fate; at Step 6a of kb-resolve both lift together. (The source summary page and `source_index.md` still record the source — only this page's `sources:` + `source_summaries:` pair is held out.)

   **The `source_summaries:` list mirrors `sources:` exactly.** When a contradiction suspends the new source's `sources:` append, the derived `source_summaries:` append is also suspended. Both lists lift together at Step 6a of kb-resolve. The strict 1-to-1 invariant (`len(sources) == len(source_summaries)`) holds even during the suspension, because both sides are held out symmetrically.
5. **Update `updated:` to today** — the page did change.
6. **Record the flag for Step 4 reporting** — note the page path and the one-line summary.

Ingest flags; it never resolves. Move on to the next claim / page / source.

**Multi-claim sources:** when one source contributes both contradicting and non-contradicting claims (possibly across different pages), route each claim independently. Contradicting claims follow 3e-contradict and are held out of `sources:` + `source_summaries:` only on the affected page(s); corroborating or counterargument claims follow the normal path on their pages, including the mirrored `sources:` + `source_summaries:` append.

#### Step 3f: Add Cross-References

For each page created or updated in Step 3e:
1. Check if the page references other existing pages that should link back.
2. If page A now mentions `[[page-B]]`, check if page B has a `related` entry for page A. If not, use **Edit** to add it.
3. Keep cross-references bidirectional where meaningful.

#### Step 3g: Update the Index

Use **Edit** on `knowledge-base/index.md` to add new entries:

1. For each new **concept, entity, or comparison** page created, add an entry in the appropriate topic section(s):
   - Format: `- [[page-name]] [type] [confidence] -- one-line summary`
   - Example: `- [[llm-knowledge-base]] [concept] [high] -- Plain-markdown wiki compiled by LLM from raw sources`
   - **Source-summary pages do NOT go in `index.md`.** They go in `source_index.md` via Step 3d above. `index.md` has no `### Source Summaries` subsection.
2. If a topic section does not exist for the page's tags, create a new H3 section.
3. Keep entries sorted alphabetically within each topic section.
4. Update the stats line at the top of the index:
   - `> Total pages: N | Concepts: N | Entities: N | Comparisons: N`
   - **No `Sources: N` field** — that belongs to `source_index.md`'s stats line.
5. Update the "Recent Activity" section with a one-line summary of this ingest operation.
   - Activity bullets may still mention source-summary counts as narrative (e.g., *"Created 3 concept pages, 1 entity page, 4 source summaries."*); those counts are cross-cutting records, not index entries. Never write wikilinks to summary pages in `index.md`.
6. Keep the "Recent Activity" section to the last 10 entries.

#### Step 3h: Mark Source as Ingested

Use **Edit** on the raw/ file to change `status: pending` to `status: ingested`.

#### Step 3i: Update the Log

1. Use **Read** to load `knowledge-base/log.md`.
2. Prepend a new log entry at the top (below the H1 heading):

```markdown
## [YYYY-MM-DD] ingest | "[source title]"
- **Source:** raw/[subdir]/[filename]
- **Pages created:** [comma-separated list of new wiki page paths]
- **Pages updated:** [comma-separated list of updated wiki page paths, with brief note of what changed]
- **Index updated:** Yes, added N entries under [topic sections]
- **Tags added:** [comma-separated list of all tags across all pages created/updated]
- **Contradictions flagged:** [list of affected wiki pages with one-line summary each]   # include this bullet only if this source triggered one or more contradictions; omit otherwise
```

3. Use **Write** to save the updated log.md.

### Step 4: Final Report

After all pending files have been processed, output a summary:

```
Ingest complete:
  Sources processed: N
  Pages created: N (concepts: N, entities: N, source-summaries: N, comparisons: N)
  Pages updated: N
  Total wiki pages: N
  Source summaries created: N
  Source index updated: yes/no

Contradictions flagged: N
  - wiki/concepts/foo.md: {one-line summary}
  - wiki/entities/bar.md: {one-line summary}
```

Omit the `Contradictions flagged:` section if N is 0. If N > 0, remind the user they can run `/kb-resolve` to work through the open entries.

## Error Handling

- **Raw file has malformed frontmatter:** Skip the file. Log an entry with operation `skip` and note the error. Report to the user.
- **Wiki directory does not exist:** Use Bash `mkdir -p` to create it before writing.
- **Filename collision in wiki/:** This should not happen if filenames follow the kebab-case convention. If it does, the existing page should be updated (not replaced).
- **Index.md is missing or empty:** Create it with the initial structure (see Section 4 of PLAN.md) before editing.
- **Log.md is missing:** Create it with the initial structure before prepending.
- **Source content is empty or very short (< 50 words):** Still process it, but set confidence to `low` and note in the source summary that content was limited.
- **Contradiction classification is ambiguous:** If a claim could plausibly read as direct factual opposition *or* as a counterargument/framing, default to the counterargument/gap route. Conservative bias — don't over-flag. A missed contradiction degrades to the same failure mode as today (silent merge); an over-flagged page clutters with `## Contradictions` entries that needed no resolution.
- **`source_index.md` missing when kb-ingest tries to append:** defensive — create the file with the standard header (`# Source Index`, `> Last updated:` line, `> Total sources: 0 | Articles: 0 | Papers: 0 | Notes: 0 | Misc: 0 | Demoted: 0`, the boilerplate paragraph about the permission-gate, an empty `## Sources by Date` section, and an empty `## Orphan Watch` section), then append. Should not happen post-Phase 0.
- **Summary slug collision with existing `source_index.md` entry:** report and skip the append; the existing entry is authoritative. The summary page on disk is the source of truth — if an entry already points to it, do not duplicate.
- **Contradiction-suspension parity:** when a `sources:` append is held out on a contradicting page (Step 3e-contradict), the `source_summaries:` append is held out in lockstep. `len(sources) == len(source_summaries)` holds throughout suspension. kb-lint's parity check (Phase 3) catches drift if the symmetry breaks.

## Frontmatter Schema Reference

### raw/ File Frontmatter

```yaml
---
title: "Descriptive title of the source"
source: "https://example.com/article-url"
type: article | paper | note | misc
status: pending | ingested | skipped
dropped_date: 2026-04-15
tags: [tag1, tag2]
---
```

### wiki/ Page Frontmatter

```yaml
---
title: "Page Title"
type: concept | entity | source-summary | comparison
tags: [tag1, tag2, tag3]
created: 2026-04-15
updated: 2026-04-15
confidence: high | medium | low
sources:
  - raw/articles/2026-04-15-example.md
source_summaries:                        # required on concept/entity/comparison pages; strict 1-to-1 mirror of sources:; not used on source-summary pages
  - wiki/sources/2026-04-15-example-summary.md
related:
  - "[[another-page-name]]"
has_contradiction: true            # optional; concept/entity pages only; present while >=1 open contradiction entry exists; once flipped to false on last resolve, stays as a soft reminder
has_demoted_or_debunk_claim: true  # optional; source-summary pages only; permanent once set (not cleared by future resolutions)
---
```

The `source_summaries:` field is a **derived index**: every entry in `sources:` has a matching entry in `source_summaries:` at the same position. Derivation rule: `raw/<subdir>/<stem>.md` → `wiki/sources/<stem>-summary.md`. Invariant: `len(sources) == len(source_summaries)` on every concept/entity/comparison page. Source-summary pages themselves do not carry this field — their `sources:` points to a single raw/ file.

## Page Templates

### Concept Page

```markdown
---
title: "[Concept Name]"
type: concept
tags: [tag1, tag2]
created: YYYY-MM-DD
updated: YYYY-MM-DD
confidence: medium
sources:
  - raw/path/to/source.md
source_summaries:
  - wiki/sources/source-summary.md
related:
  - "[[related-page]]"
has_contradiction: true  # optional; include only while >=1 open entry exists in the Contradictions Section (see template below)
---

# [Concept Name]

**TLDR:** [One sentence summary.]

## Description

[2-4 paragraphs explaining the concept.]

## Key Properties

- [Bullet point 1]
- [Bullet point 2]
- [Bullet point 3]

## Counterarguments / Gaps

- [Known limitations or open questions]

## See Also

- [[related-page]] -- [brief reason for relation]
```

### Entity Page

```markdown
---
title: "[Entity Name]"
type: entity
tags: [tag1, tag2]
created: YYYY-MM-DD
updated: YYYY-MM-DD
confidence: medium
sources:
  - raw/path/to/source.md
source_summaries:
  - wiki/sources/source-summary.md
related:
  - "[[related-page]]"
has_contradiction: true  # optional; include only while >=1 open entry exists in the Contradictions Section (see template below)
---

# [Entity Name]

**TLDR:** [One sentence identifying the entity and their significance.]

## Overview

[2-3 paragraphs.]

## Key Contributions / Products

- [Item 1]
- [Item 2]

## Connections

- [[related-entity-or-concept]] -- [relationship description]

## See Also

- [[related-page]] -- [brief reason]
```

### Source Summary Page

```markdown
---
title: "[Source Title] -- Summary"
type: source-summary
tags: [tag1, tag2]
created: YYYY-MM-DD
updated: YYYY-MM-DD
confidence: medium
sources:
  - raw/path/to/source.md
related:
  - "[[related-page]]"
has_demoted_or_debunk_claim: true  # optional; include once a claim from this source has been demoted/rejected via kb-resolve (see Amendment Preamble template below)
---

# [Source Title] -- Summary

**TLDR:** [One sentence summarizing the source.]

## Key Takeaways

- [Takeaway 1]
- [Takeaway 2]
- [Takeaway 3]

## Extracted Concepts

- [[concept-page]] -- [brief note]

## Extracted Entities

- [[entity-page]] -- [brief note]

## See Also

- [[related-page]] -- [brief reason]
```

### Comparison Page

```markdown
---
title: "[A] vs [B]"
type: comparison
tags: [tag1, tag2]
created: YYYY-MM-DD
updated: YYYY-MM-DD
confidence: medium
sources:
  - raw/path/to/source.md
source_summaries:
  - wiki/sources/source-summary.md
related:
  - "[[a-page]]"
  - "[[b-page]]"
---

# [A] vs [B]

**TLDR:** [One sentence summarizing the key trade-off.]

## Comparison

| Dimension | [A] | [B] |
|-----------|-----|-----|
| [Dim 1]   | ... | ... |
| [Dim 2]   | ... | ... |

## When to Choose [A]

- [Scenario 1]

## When to Choose [B]

- [Scenario 1]

## See Also

- [[a-page]] -- [brief note]
- [[b-page]] -- [brief note]
```

### Contradictions Section (appended to Concept/Entity pages when flagged)

```markdown
## Contradictions

### [YYYY-MM-DD] {short descriptor of what conflicts}
- **Status:** open
- **Summary:** {one line the user can scan to recall the conflict}
- **Existing claim:** {paraphrase or verbatim} -- sources: `raw/path/a.md`, `raw/path/b.md`
- **New claim:** {paraphrase or verbatim} -- source: `raw/path/new.md`
```

Notes on this section:

- The H3 heading is the entry delimiter. Multiple open entries stack under a single `## Contradictions` H2.
- Written by `kb-ingest` at flag time (Phase 2 of the contradiction-handling build); the H3 entry is deleted by `kb-resolve` at resolve time (Phase 3).
- When the last H3 entry is resolved, the `## Contradictions` H2 is removed and `has_contradiction:` is set to `false` (the key is kept as a soft reminder).
- Placement on the page: after `## Counterarguments / Gaps` if present, otherwise before `## See Also`. (Placement logic is implemented in Phase 2.)
- Pair invariant with `has_contradiction: true` in frontmatter — bidirectional (Phase 4 lint check).

### Amendment Preamble (prepended to a Source Summary when a claim is demoted)

```markdown
> **Amendment -- [YYYY-MM-DD]:** A claim from this source was demoted during contradiction resolution.
> - **Claim demoted/rejected:** {one-line paraphrase}
> - **Wiki page(s) affected:** [[affected-page]]
> - **Resolution favored:** `raw/path/winner.md` ({short why})
> - **Rationale:** {user's free-form reasoning, quoted or paraphrased}
```

Notes on this preamble:

- **Written by `kb-resolve`** (skill not yet implemented -- Phase 3 of the contradiction-handling build). Documented here so the full source-summary page shape is specified in one place.
- Prepended **above** the H1 `# [Source Title] -- Summary` and the `**TLDR:**` line; everything below the preamble is preserved verbatim.
- Stacking order when multiple amendments exist: **most-recent-on-top** (Phase 0 decision #1). The newest preamble sits immediately after the closing frontmatter `---`; older preambles shift down but remain above the H1.
- Detection pattern for lint's bidirectional check (Phase 4): blockquote line beginning with `> **Amendment -- `.
- Pair invariant with `has_demoted_or_debunk_claim: true` in frontmatter -- bidirectional.
