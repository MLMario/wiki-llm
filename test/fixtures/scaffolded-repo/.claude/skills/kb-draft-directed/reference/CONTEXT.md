# kb-draft-directed — Scoped Context

> Scoped reference for the **`/kb-draft-directed` orchestrator** (`SKILL.md` in
> the parent directory). Held constants the orchestrator consults during run:
> the annotation taxonomy, the 13 load-bearing principles, the
> compliance-fallback template, and the file-path resolution rules.
>
> The orchestrator reads this file at start of run before spawning Spark Round 1.
> Per-pass procedural logic lives in `SKILL.md`, not here. 

## Wikilinks never appear in prose body

`[[page-name]]` syntax appears in **two places only**: the YAML frontmatter
`anchors:` block, and inside HTML-comment annotations. Never in the prose body
of the draft. Concept, entity, and comparison page names appear as plain text
in prose — capitalize per English convention (`Claude Code`, `Anthropic`,
`agent loop`), never bracket. The draft is a publishable article, not internal
wiki text.

This applies to Pass 3b composition and to every worked example in this skill.

## Annotation taxonomy (2 surviving kinds + 1 transient)

| Annotation | Producing pass | Persistence | Meaning |
|---|---|---|---|
| `<!-- kb-draft:claim-source:[[page]] -->` | 3b | **transient** — Pass 4 deletes on success or rewrites on failure; never appears in final output | Fact-bearing sentence drawn from research on `[[page]]`. Bookkeeping for Pass 4 only. |
| `<!-- kb-draft:claim-flagged:no-grounding-in-[[page]] -->` | 4 | survives to final | Pass 4 failed to verify grounding (or page not found). The one fact-bearing flag the user sees. |
| `<!-- kb-draft:llm-generated:no-wiki-context -->` | 3b | survives to final | Sentence in a `keep-no-input` bullet section — LLM wrote it from general knowledge with no user binding and no wiki source. Verify skips. |

**Final-file invariant (success path).** Every surviving annotation matches one
of the two non-transient kinds. No `claim-source:[[page]]` annotations remain
after Pass 4 — they are deleted on `grounded` and rewritten to `claim-flagged:`
on `not-grounded-in-page` / `page-not-found`. `llm-generated:no-wiki-context`
is unchanged from Pass 3.

**Fallback path exception.** If the Pass 4 fallback fires, `claim-source:[[page]]`
annotations may persist un-rewritten. The `## Verify warnings` block at the file
tail makes this explicit. Only legitimate exception to the success-path invariant.

**No other tags.** Sentences without page anchors emit no annotation at all.
Counterarguments from research are not tagged inline — orchestrator may weave
caveats into prose if the move calls for it, but never with HTML comments.

## Fact-bearing sentence definition

A sentence is fact-bearing if it contains any of:

- A numeral (digit or written number above ten).
- A date or year.
- A proper-noun cluster (two or more capitalized words within 5 tokens of each
  other naming a person, organization, product, paper).
- An empirical-claim verb: shows, showed, found, finds, demonstrates, achieves,
  achieved, scored, outperforms, beats, fails, fail.

Pass 3b annotates only fact-bearing sentences in `binding`-having bullets with
the transient `claim-source:[[page]]`. Pass 4 verifies only `claim-source:`
annotations. Fact-bearing sentences with no page anchor get no annotation
(orchestrator should be reluctant to assert facts it can't anchor; if it does,
the sentence ships unflagged). Non-fact-bearing sentences (transitions, openers,
closers) carry no annotation.

## Load-bearing principles (P1–P13, short-form)

**P1 — Each pass decomposes into 0–N micro-rounds, one creative decision per round.**
Spark = 2, outline = 1 or 2 (Round 2 conditional), passes 3 + 4 = 0.

**P2 — The agent retrieves; the orchestrator composes.** `kb-search` never
proposes creative options. Synthesis is always the orchestrator's job.

**P3 — Orchestrator delegates work, not pre-digested context.** Pass paths +
instructions; agent reads/summarizes/searches as part of its task. Fall back to
direct reads only if the agent fails — and surface failures loudly, never
silently.

**P4 — Default agent scope is pages only; sources are opt-in with a stated purpose.**
Spark + outline = pages only. Pass 3a opts in (purpose: anchor claims to
evidence). Pass 4 = pages only.

**P5 — Each round's UI shape follows the decision shape.** Single-pick = lettered
(A–D). Set-pick = numbered (1–N). No `AskUserQuestion`.

**P6 — Decisions flow through context; no artifacts unless persistence is required.**
Spark, outline, pass 3 write nothing. Only pass 4's final file is written.

**P7 — Recommendations always offered; "you decide" is a valid response.** Every
option list flags a recommended pick.

**P8 — Re-spawn retrieval only when the redirect changes retrieval scope; re-compose locally when the redirect is composition-only.**
Decision rule: does the user's redirect ask for material the orchestrator doesn't
already have? Yes → re-spawn. No → re-compose locally.

**P9 — When a creative decision implies derived state the user might want to revise, surface that state in a confirm step before locking.**
Outline Round 1's binding-confirm is the canonical instance.

**P10 — A pass's user dialogue stays in its lane; cross-skill workflow detours don't belong inside the dialogue.**
No `/kb-drop` from inside the prompt. User cancels and runs `/kb-drop` themselves
if needed.

**P11 — Mechanical passes ride on locked upstream state, not new user direction.**
Passes 3 + 4 have zero user-direction rounds.

## Compliance-fallback template

Every `kb-search` spawn is followed by an orchestrator compliance check on the
response schema. If validation fails, emit this warning verbatim (substituting
the bracketed parts), then proceed with the degraded-scope read path:

```
⚠️  kb-search did not return [section name] for [pass / round]. Falling back
    to direct read of [degraded scope]. Consider revisiting the agent prompt —
    repeated failures suggest the prompt needs sharpening.
```

| Spawn | Compliance failure → degraded scope |
|---|---|
| Spark Round 1 | Orchestrator reads `<input path>` directly. No KB scan in fallback (skip the relevant-pages section); proceed to compose 4 angles from input alone. |
| Spark Round 2 | Orchestrator reads `knowledge-base/index.md` directly + globs candidate pages. Compose 8–12 anchor candidates from index entries alone. |
| Outline Round 1 | Orchestrator reads each locked anchor page directly. **No 1-hop traversal in fallback** — compose candidate outlines from anchor positions alone. |
| Pass 3a | Orchestrator reads each binding-having bullet's bound anchor pages directly. **No source summaries, no 1-hop in fallback.** Compose draft from anchor-only material. |
| Pass 4 | File still ships with un-rewritten `claim-source:[[page]]` annotations. Append `## Verify warnings` block at file tail listing the un-rewritten annotations and the failure reason. |

Silent fallback is forbidden. The warning is the user's signal to maintain the
agent prompt.

## File-path resolution rules

- **`<project-root>`** = the directory the user invoked `/kb-draft-directed`
  from (cwd at skill-invocation time). Do not search upward for a sentinel file
  (no `.git`, no `package.json` heuristic). Use `pwd` literally.
- **`<input-stem>`** = the input filename minus its `.md` extension. Drop the
  directory part. Example: `notes/voice-check.md` →
  `<project-root>/voice-check.draft.md`.
- **Final file path** = `<project-root>/<input-stem>.draft.md`. The single file
  written by the entire pipeline. No staging directory. No intermediate writes.

## Wikilink syntax (matches kb-* convention)

`[[page-name]]` — no subdirectory path, no `.md` extension. Page name matches
the filename without `.md`. The orchestrator validates all `[[…]]` references
in agent responses against the regex `\[\[[a-z0-9-]+\]\]`.

## Final-file frontmatter (pass 4 §9.4)

```yaml
---
pass: 4
created: <YYYY-MM-DD>
input: <input path>
angle: <locked thesis>
audience: <locked audience>
move: <locked move>
anchors:
  - [[page-a]]
  - [[page-b]]
  ...
---
```

Frontmatter is structural, not auditable. No mechanical check enforces validity.
The user is the audience.
