# create-wiki-llm

*Scaffold a Karpathy-style LLM wiki for Claude Code, driven by five `kb-*` skills.*

## What is this?

`create-wiki-llm` is an npm scaffolder for a personal markdown knowledge base that Claude Code maintains for you. It is a productized take on Andrej Karpathy's April 2026 LLM wiki idea, the one that drew about 41,000 bookmarks in a week: folders of raw sources, AI-compiled markdown pages, viewed in Obsidian or any markdown editor. Karpathy described his own version as *"a hacky collection of scripts"* with *"room here for an incredible new product."* This package is one attempt at that productization.

If you already know the Karpathy LLM wiki pattern, skip ahead to **Installation**. If not, here is the short version. Ingest is where the thinking happens, not query. The LLM reads each new source once and compiles it into structured markdown pages, instead of leaving everything in a searchable pile that you have to re-derive answers from on every question. The wiki compounds across years. Queries read pages that were already synthesized at write time, which is cheap.

### What this version adds on top of the basic pattern

- **Contradictions are first-class artifacts**, not edge cases. When a new source disagrees with the wiki, ingest flags it in place and `/kb-resolve` adjudicates one contradiction at a time. The losing source summary gets an amendment preamble and `source_index.md` marks it `[demoted]`. Disagreements survive the decision instead of being averaged away.
- **Verbatim raw capture**. HTML drops are fetched through Jina Reader, local PDFs are converted via `pymupdf4llm`, and PDF URLs are hard-rejected at drop time. The LLM never paraphrases your source on the way into the inbox.
- **Permission-gated source reading**. `/kb-query` reads compiled wiki pages by default and only opens source summaries when a permission gate fires, so provenance lives in its own layer instead of leaking into every answer.

### The philosophy

This is a knowledge base for purposeful curation, not for dumping articles you might read later. You decide what belongs in. The LLM decides where to file it. Contradictions get surfaced, connections get written down, and nothing gets quietly overwritten. The deeper lineage runs through Niklas Luhmann's Zettelkasten (90,000 hand-written index cards across forty years, the system behind seventy books) and the bet that knowledge can compound in a single mind if the cards are atomic and the cross-references are authored. What an LLM wiki changes is who writes the cards.

## Installation

The scaffolder is published as `create-wiki-llm` on npm. Stand up a new wiki:

```bash
npm create wiki-llm@latest my-kb
cd my-kb
```

You can use `npx create-wiki-llm my-kb` if you prefer. Both produce the same result.

Open the directory in Claude Code and capture your first source:

```
/kb-drop https://example.com/some-article
/kb-ingest
/kb-query what does this article say about X?
```

### Requirements

- Node.js 20 or newer.
- [Claude Code](https://www.anthropic.com/claude-code), where the five skills run.
- Python 3 and `pymupdf4llm` if you want to drop local PDFs (`pip install -r requirements.txt`). Skip this and `/kb-drop` will still handle URLs and typed notes.

The npm package itself has no runtime dependencies. It uses Node built-ins only.

## Design

A scaffolded wiki is plain markdown and git, organized into three layers with strict ownership boundaries:

```
my-kb/
  .claude/skills/kb-{drop,ingest,resolve,lint,query}/   # Five Claude Code skills (the writers)
  knowledge-base/
    raw/{articles,papers,notes,misc,images}/            # Inbox: immutable source documents
    wiki/{concepts,entities,comparisons,sources}/       # LLM-compiled pages (the wiki proper)
    index.md                                            # Topic entry point for queries
    source_index.md                                     # Provenance index (chronological)
    CONTEXT.md                                          # Schema overview
  utils/pdf_to_markdown.py                              # Optional Python helper for local PDFs
  requirements.txt
  CLAUDE.md                                             # Architecture overview for Claude Code
```

### The three layers

- **Raw** is immutable. Sources go in via `/kb-drop` and never get edited after that. The LLM reads them but does not modify them. They are the audit trail and the ground truth.
- **Wiki** is LLM-owned. The five skills are the only things that write to it. Humans read it but do not edit it directly, because that is what protects the artifact from drift over time.
- **Schema** is the instruction layer. `CLAUDE.md` and the per-skill `CONTEXT.md` files tell Claude Code how the wiki is organized, what page types exist, and what the conventions are.

### The four page types

`/kb-ingest` writes pages that fall into one of four shapes:

- **Concept pages** accumulate depth on ideas, patterns, and techniques. Multiple entities can show up inside a concept page as examples or implementations.
- **Entity pages** accumulate breadth on named things: people, organizations, products. Each new source that mentions an entity appends to the same page.
- **Comparison pages** hold side-by-side analyses (A vs B), used sparingly when two things are useful to contrast directly.
- **Source summaries** live in their own subdirectory and exist as a provenance layer: one summary per ingested document, demoted at query time so they surface only when a query is explicitly about provenance.

### The five skills

| Skill | Purpose | Writes to |
|---|---|---|
| `/kb-drop` | Fetch a URL via Jina Reader, copy a PDF via `pymupdf4llm`, or accept a typed note into `knowledge-base/raw/`. PDF URLs are rejected; download and drop the local path instead. | `raw/`, `log.md`, `ingested-urls.txt` |
| `/kb-ingest` | Compile pending `raw/` items into `wiki/` pages. Creates new pages, performs additive edits to existing ones, updates the index, flags contradictions inline. Never resolves them. | `wiki/`, `index.md`, `source_index.md`, `log.md` |
| `/kb-resolve` | Adjudicate one flagged contradiction per dialogue. Mutates the affected page, amends the losing source summary, marks `[demoted]` in `source_index.md`, logs the decision. Run when ingest reports contradictions. | `wiki/`, `source_index.md`, `log.md` |
| `/kb-lint` | Audit the wiki for orphans, broken wikilinks, stale content, contradiction-state drift, and `sources:` / `source_summaries:` parity violations. | `index.md` orphan-watch section, `log.md` |
| `/kb-query` | Answer questions by reading `index.md` and the relevant wiki pages, with wikilink citations. Reads source summaries only behind a permission gate. | Read-only by default |

### Design choices worth knowing

- **Index-first retrieval**. `/kb-query` opens `index.md` first and ranks entries by keyword overlap. Vector search has its place in planned future work, but the index, curated by the same skill that wrote the pages, is unusually high-signal and stays the entry point.
- **Additive surgical edits**. When a source touches an existing page, ingest appends to the right section, adds the source to the frontmatter list, and upgrades confidence on corroboration. It does not rewrite. This is the discipline that protects the wiki from LLM regenerative drift over hundreds of ingest operations.
- **Markdown over databases**. No schema migrations, no rigidity, grep-able by default. Plain markdown is the right substrate at personal scale.
- **No background processes**. The scaffolder ships no daemons, no watchers, no schedulers. Every action is a slash command you ran on purpose.

## Intended user flows

### Day one: capture your first source

You read something interesting. You drop it into the wiki:

```
/kb-drop https://example.com/some-article
```

`/kb-drop` fetches the page through Jina Reader, gives it a kebab-case filename, and writes it to `knowledge-base/raw/articles/YYYY-MM-DD-slug.md` with proper YAML frontmatter and `status: pending`. The article body lands verbatim. The LLM never paraphrases it on the way in.

Have a local PDF? Drop the file path:

```
/kb-drop ~/Downloads/some-paper.pdf
```

`/kb-drop` runs the local PDF through `pymupdf4llm` and writes it to `raw/papers/`. A typed note works too:

```
/kb-drop My takeaways from today's reading: ...
```

### Compile what you have captured

When one or more pending sources are sitting in `raw/`, you run:

```
/kb-ingest
```

`/kb-ingest` reads each pending source once, extracts concepts and entities, decides which need new pages and which extend existing ones, writes wikilinks across them, and updates `index.md`. Updates to existing pages are additive: new claims land in the right section, the new source appends to the frontmatter list, and confidence is upgraded only on corroboration. If a new source disagrees with something already in the wiki, ingest flags the contradiction in place under a `## Contradictions` section and reports it in the run summary. It does not pick a winner.

### Adjudicate contradictions

When ingest reports `Contradictions flagged: N > 0`, you run:

```
/kb-resolve
```

`/kb-resolve` lists open contradictions across the wiki and walks you through them one at a time. For each contradiction, the skill shows you both claims with their sources, asks you to decide, mutates the affected page accordingly, amends the losing source summary with a preamble noting the demotion, and marks `[demoted]` in `source_index.md`. The disagreement survives the decision: you can always trace what was claimed, by whom, and why it lost.

### Query the wiki

Ask a question:

```
/kb-query What have I read about agent memory?
```

`/kb-query` opens `index.md`, finds candidate concept and entity pages, reads them, and synthesizes an answer with `[[wikilink]]` citations. If the question benefits from source-level detail (provenance questions, source-level validation, recency questions), the skill asks before reading source summaries. The default is to answer from the compiled wiki layer.

### Periodic health check

Once in a while, run:

```
/kb-lint
```

`/kb-lint` walks the wiki and reports orphan pages, broken wikilinks, stale content, contradiction-state drift, and parity violations between `sources:` and `source_summaries:` frontmatter. It writes findings to the orphan-watch section of `index.md` and to `log.md`. It does not fix anything by itself; you decide what to act on.

## Updating a scaffolded repo

From inside any scaffolded repo:

```bash
npx create-wiki-llm@latest --update
```

This pulls the latest version of the package and overwrites only the files the package owns: skill definitions under `.claude/skills/kb-*`, `utils/`, `requirements.txt`, and `knowledge-base/CONTEXT.md`. Anything under `knowledge-base/raw/` and `knowledge-base/wiki/` is left alone.

Useful flags:

- `--dry-run`: print the update plan without writing anything.
- `--force`: overwrite files you have customized.

## The frontier

Three things the current version does not do. These are known gaps, not "coming soon":

- **Query-intent routing**. `/kb-query` runs one retrieval pipeline against every question, but real queries fall into distinct shapes (*what is X?*, *how does Y work?*, *how does A differ from B?*, *what have I read about Z?*) and each has a best strategy. A planned classifier picks an intent and routes to a strategy tuned for it. Semantic-similarity ranking is one of the strategies it will route to, for queries that phrase a concept differently than the wiki does. Almost no implementation in circulation does this; it is the highest-leverage retrieval upgrade available to LLM wikis today.
- **Near-duplicate matching at ingest**. `/kb-ingest` checks for existing pages by filename, which catches exact matches and misses semantic twins. Planned: an embedding-backed similarity check before a new page is created, so a "model context protocol" article does not end up creating a sibling to an existing "MCP" page.
- **Per-claim confidence scoring**. Trust is currently binary: a claim is in the wiki, or in a demoted source summary. A future version may score claims by corroboration, age, and source type.

## License

[MIT](./LICENSE)
