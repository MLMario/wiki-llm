---
name: kb-query
description: Search the knowledge base wiki for information and synthesize an answer with wikilink citations. Use when the user asks to query, search, look up, or find information in the KB, or asks a question that the KB might answer.
---

# kb-query

Search the knowledge base wiki and return structured answers with citations. This skill is **read-only by default** -- it does not modify any files unless the user explicitly asks to file the answer as a permanent wiki page.

Sources are behind a **permission gate**: source-summary pages (`wiki/sources/`) and the provenance index (`knowledge-base/source_index.md`) are **never read by default**. The skill self-checks whether sources are load-bearing for the query and asks the user before reading them (Step 2).

## Input Parameters

- **query** (required): A question or topic to search for. Examples:
  - "What is the Karpathy LLM Wiki pattern?"
  - "How does RAG compare to compiled wikis?"
  - "Who is Andrej Karpathy?"
  - "What do we know about attention mechanisms?"

- **file_answer** (optional): If the user says "file this" or "save this answer", the skill will create a wiki page from the synthesized answer. Default: false.

## Workflow

### Step 1: Read the Index

1. Use **Read** to load `knowledge-base/index.md`.
2. Scan the index for entries relevant to the query:
   - Match against topic section headings (H3).
   - Match against page titles in the entry lines.
   - Match against tags in the `[type]` and `[confidence]` badges.
   - Match against the one-line summary text.
3. Build a list of candidate concept/entity/comparison pages ranked by apparent relevance.

**Do not read `source_index.md` here.** It is consulted only inside the source-mode path (Step 3, anchorless branch), after the gate in Step 2 resolves to `source_mode = true`.

### Step 2: Source-Mode Self-Check Gate

Default state: `source_mode = false`. Sources are not read unless this gate passes.

1. **Self-check.** Ask yourself: *"Given this query, do I need sources to answer it?"* Default answer: **no**.

   Judgment inputs (non-exhaustive; guidance only — not a hardcoded trigger list):
   - Did the user directly ask to use sources, search sources, or cite sources?
   - Can this question only be answered by retrieving sources (pure provenance / recency — e.g., "which articles did I read about X", "what did I ingest last week")?
   - Would source-level detail meaningfully extend, validate, or challenge what the concept/entity/comparison pages already say?
   - Any other judgment about whether sources are load-bearing for a good answer.

2. **If self-check → no:** set `source_mode = false` and proceed to Step 3. **No permission prompt.**

3. **If self-check → yes:** emit a single permission request stating the reason. Example:
   > *"This query would benefit from source summaries because [brief reason]. Want me to search them? [y/n]"*

4. **Interpret the user's reply:**
   - User replies yes → set `source_mode = true`, proceed to Step 3.
   - User replies no, "maybe", or any ambiguous / off-topic reply → set `source_mode = false`, proceed to Step 3. **Fail closed.**
   - Do not retry or nag on decline.

5. False positives (gate fires when sources aren't needed) are an acceptable cost — one extra y/n turn. False negatives (missing sources that were load-bearing) are strictly worse, so err toward asking when the judgment is close.

### Step 3: Identify Candidate Pages

From the Step 1 index scan, select concept/entity/comparison candidates:

1. **Strong matches:** page title contains query keywords, or topic section heading matches. These are read first.
2. **Weak matches:** summary text or tags overlap with query terms. These are read only if strong matches do not fully answer the question.
3. **Fallback search:** if the index does not surface obvious candidates, use **Grep** across `knowledge-base/wiki/concepts/`, `knowledge-base/wiki/entities/`, and `knowledge-base/wiki/comparisons/` for the query terms (exclude `knowledge-base/wiki/sources/` — source-summary pages are only read when `source_mode = true`).
   - Pattern: key terms from the query, separated by `|` for OR matching.
   - This catches pages where the relevant content is in the body but not reflected in the index entry.

**If `source_mode = true`**, additionally pick source-summary candidates via one of two paths:

- **Anchor-based (primary):** for each strong/weak concept/entity/comparison candidate identified above, read its `source_summaries:` frontmatter field. Collect those relative paths as source-summary candidates.
- **Anchorless fallback:** if Steps 1+3 surfaced no concept/entity/comparison anchor (pure provenance query — e.g., "what articles did I read last week?"), use **Read** to load `knowledge-base/source_index.md`. Scan chronologically (newest first). Pick source-summary candidates based on date cues, tags, and keyword matches against each entry's one-line summary.

If the anchor-based path yields an empty `source_summaries:` list when entries were expected, exercise judgment: either fall back to `source_index.md`, or report the gap and proceed content-only.

### Step 4: Read Candidate Pages

1. Start with the most promising 3-5 candidate pages.
2. For each page, use **Read** to load it.
3. Read the TLDR and Description/Overview sections first.
4. If the TLDR indicates the page is relevant, read the full content.
5. If the TLDR indicates the page is not relevant, skip to the next candidate.
6. If the first batch of candidates does not fully answer the question, read additional candidates from the weak match list.
7. Track which pages contributed to the answer and their confidence levels.

**If `source_mode = true`**, also `Read` the source-summary pages collected in Step 3. When judging whether a source challenges a wiki claim, the LLM may additionally **Grep** the source body (or the raw/ file the summary points to) against the concept/entity claim.

If a `source_summaries:` entry points to a nonexistent file: skip the missing one and record the path for the Gaps section (Step 6).

### Step 5: Synthesize Answer

Combine information from all relevant pages into a structured answer:

1. **Restate the question** clearly.
2. **Synthesize the answer** drawing from multiple pages where possible.
3. **Cite every claim** from the content layer with a `[[wikilink]]` to the concept/entity/comparison page.
4. **Note ingest-time contradictions:** if a contributing page has `has_contradiction: true` or an open `## Contradictions` section relevant to the query, present both views with their confidence levels and note the open dispute. (This is the existing kb-ingest-flagged mechanism; adjudicated via `/kb-resolve`.)
5. **Note confidence:** if the answer relies heavily on `low`-confidence pages, flag this.
6. **Identify gaps:** note what the wiki does NOT cover that would help answer the question more completely.

**If `source_mode = true`**, additionally:

- Synthesize the primary answer from concept/entity/comparison pages as usual (content layer).
- Add a `### Source corroboration` subsection summarizing what the source summaries added, validated, or challenged relative to the content-layer answer.
- **Query-time contradiction surfacing:** if any source disagrees with the wiki claim, flag it explicitly in the answer. **This is separate from the ingest-time `## Contradictions` mechanism.** It does not write to the wiki, does not create a contradiction entry anywhere, and does not set `has_contradiction:`. It is narrative-only, in this answer only. The user can choose to re-run `/kb-ingest` on the raw source if they want a persistent record.

### Step 6: Return Structured Result

Output the answer in this format:

```markdown
## Answer: [restated question]

[Synthesized answer with [[wikilink]] citations throughout]

### Source corroboration   ← only when source_mode = true

[What source summaries added, validated, or challenged. Flag any query-time contradictions here.]

### Sources Consulted

**Pages:**
- [[page-name-1]] (confidence: high) -- [what this page contributed to the answer]
- [[page-name-2]] (confidence: medium) -- [what this page contributed]

**Source summaries:**   ← only when source_mode = true
- wiki/sources/<stem>-summary.md -- [what this source contributed, or "validated X claim"]

### Gaps
- [Topics the wiki does not cover that would help answer the question]
- [Concepts referenced but without a wiki page]
- [Missing source-summary files referenced from `source_summaries:` — "wiki/sources/{path} referenced but not found — run /kb-lint."]
```

**Citation format** (per decision 6 of the sources-layer design):

- Concept / entity / comparison pages are cited as `[[page-name]]` wikilinks.
- Source summaries are cited as their **relative path** `wiki/sources/<stem>-summary.md` (not a wikilink). This keeps the conceptual distinction between the content layer and the provenance layer visible in every answer.

### Step 7: Optionally File the Answer

If the user requests filing the answer (says "file this", "save this", or "make a page"):

1. Determine the appropriate page type:
   - If the answer compares two things -> **comparison** page in `wiki/comparisons/`
   - If the answer defines a concept -> **concept** page in `wiki/concepts/`
   - Otherwise -> **concept** page (default)

2. Generate a filename: `kebab-case-topic.md`

3. Write the page using the appropriate template from `reference/CONTEXT.md` (Filing an Answer section, in this skill's folder), with:
   - `sources`: all raw/ files referenced by the consulted wiki pages
   - `source_summaries`: strict 1-to-1 mirror of `sources:`, derived via the `raw/<subdir>/<stem>.md ↔ wiki/sources/<stem>-summary.md` slug rule
   - `confidence`: based on the confidence of the contributing pages
   - `related`: wikilinks to all pages consulted
   - Content: the synthesized answer, reformatted to match the template structure

4. Update `knowledge-base/index.md` with the new entry.

5. Prepend a log entry to `knowledge-base/log.md`:

```markdown
## [YYYY-MM-DD] query | "[original question]"
- **Pages consulted:** [comma-separated list of wiki page paths]
- **Source summaries consulted:** [comma-separated list, or "none" if source_mode was false]
- **Answer filed as page:** wiki/[subdir]/[filename] (or "not filed")
- **Index updated:** [Yes/No]
```

**Important:** Only file the answer if the user explicitly requested it (Step 7). Otherwise, report the answer without writing any files.

## Error Handling

- **Index is empty or missing:** Report "The knowledge base index is empty. There are no wiki pages to search. Use kb-drop and kb-ingest to add content first."
- **No relevant pages found:** Report "No wiki pages matched your query for '[query]'. The knowledge base may not have information on this topic yet." Then list what topics ARE in the index so the user can refine.
- **All matching pages have low confidence:** Include a warning: "Note: The available information comes from low-confidence sources. Consider adding more authoritative sources via kb-drop."
- **Query is too broad:** If more than 10 pages match, ask the user to narrow the query. Suggest specific subtopics from the index.
- **User declines source permission (Step 2):** proceed content-only. Do not retry or nag.
- **User reply to the gate is ambiguous** (e.g., "maybe", unrelated comment): treat as no. Fail closed.
- **Self-check false positive** (gate fires, user says no): acceptable cost — proceed content-only.
- **Anchor page's `source_summaries:` entries point to nonexistent summary pages:** skip the missing ones; note each in the answer's "Gaps" section as *"wiki/sources/{path} referenced but not found — run /kb-lint."* Proceed with what's available.
- **Anchor page's `source_summaries:` is empty** when the self-check expected source material: degrade gracefully — either fall back to `source_index.md`, or report the gap and continue content-only. LLM's judgment.
- **`source_index.md` missing when falling back to it:** report *"Source index not found. Sources may not have been migrated — run /kb-lint."* Revert to content-only for this query.

## Constraints

- This skill is **read-only by default**. It only writes if the user explicitly asks to file the answer.
- It must always start from the index. Never blindly scan the entire wiki directory tree.
- **Sources are behind a permission gate.** Do not read `wiki/sources/*.md` or `source_index.md` unless Step 2 resolves to `source_mode = true` (self-check yes + user yes).
- It must cite every claim with the correct citation form — `[[wikilink]]` for concept/entity/comparison, relative path `wiki/sources/<stem>-summary.md` for source summaries. No unsourced statements in the answer.
- It does NOT read raw/ files unless `source_mode = true` and grepping a source body is needed for contradiction judgment. When citing, always prefer the source-summary page over the raw/ path.

## Frontmatter Schema Reference (for filed answers)

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
source_summaries:
  - wiki/sources/2026-04-15-example-summary.md
related:
  - "[[another-page-name]]"
---
```

**Parity invariant:** `source_summaries:` is a strict, order-preserving mirror of `sources:` on every concept/entity/comparison page. For every `raw/<subdir>/<stem>.md` entry in `sources:`, the matching `source_summaries:` entry is `wiki/sources/<stem>-summary.md`, at the same list index. `len(sources) == len(source_summaries)` must hold. Source-summary pages themselves do not carry `source_summaries:`.
