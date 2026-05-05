---
name: kb-draft-directed
description: Compile an input markdown file into a marked-up draft article through 4 passes (spark, outline, research-and-draft, verify) with human-in-the-loop direction at every creative juncture. Use when the user wants to direct angle, audience, anchor pages, and outline shape. Parallel to /kb-draft (autonomous); both coexist.
---

# kb-draft-directed (orchestrator)

You are the orchestrator for the directed article-drafting pipeline. The user
invokes you with a single input file path. You walk them through 4 passes,
gathering creative direction at the spark and outline passes, then run passes 3
and 4 mechanically. The pipeline ends with a single file written to
`<project-root>/<input-stem>.draft.md`.

Held constants in `reference/CONTEXT.md` (read at Step 0).
## Step 0 — Load reference + parse argument

1. **Read `reference/CONTEXT.md`** in this skill's folder. It holds the
   no-wikilinks-in-prose rule, the annotation taxonomy (2 surviving kinds + 1
   transient), the 13 principles, the compliance-fallback template, and the
   file-path resolution rules. You consult these constants throughout the run;
   do not re-derive them inline.

2. **Parse the argument.** The user invokes:
   ```
   /kb-draft-directed <input path>
   ```
   - One positional argument: the path to a markdown file.
   - Validate via `Bash: test -f <input path>`. If missing, emit:
     `Input file not found: <path>. /kb-draft-directed expects one argument: a markdown file path.`
     and stop.
   - Capture `<project-root>` = current working directory (`pwd` literally).
   - Capture `<input-stem>` = filename minus `.md`, directory part dropped.

3. **State the plan briefly to the user** (~2 sentences) so they know what's
   coming:
   ```
   Walking <input path> through directed drafting: spark (angle, anchors),
   outline (shape, gaps), then research + verify run automatically. Final draft
   lands at <project-root>/<input-stem>.draft.md.
   ```

═══════════════════════════════════════════════════════════════════════════════
## PASS 1 — SPARK (2 user-direction rounds)
═══════════════════════════════════════════════════════════════════════════════

### Step 1a — Spawn kb-search for Spark Round 1 (angle retrieval)

Spawn `kb-search` via the Task tool with this prompt verbatim (substitute the
bracketed values):

```
Task: Round 1 of kb-draft-directed spark step.

Step 1 — read & summarize. Read <input path> end-to-end. Return a 2–3 sentence
topic summary capturing the working thesis (or the central question if no
thesis exists yet). Then list 3 key claims or themes the input wants to make.

Step 2 — search. Using knowledge-base/index.md as entry point, identify
6–10 wiki pages most relevant to the topic. Follow [[wikilinks]] across pages
to surface adjacent material.

Output schema: single response with three labeled sections:
  ## Topic summary — 2–3 sentences.
  ## Key claims/themes — 3 bulleted items.
  ## Relevant pages — 6–10 entries, each `[[page-name]] — one-line why-relevant`.

Retrieval and summarization only.
```

### Step 1b — Compliance check (Round 1)

Validate the response:
- All three sections present (`## Topic summary`, `## Key claims/themes`,
  `## Relevant pages`).
- Each section non-empty.
- All `[[…]]` valid (per CONTEXT.md §Wikilink syntax).

**On failure:** apply fallback per `reference/CONTEXT.md` §Compliance-fallback template (Spark Round 1).

### Step 1c — Compose 4 angle candidates

Each candidate has four fields:
- **thesis** — single sentence stating what the article will argue or explain.
- **audience** — short phrase naming the target reader.
- **move** — rhetorical mode (compare-and-contrast, argue-from-premise,
  argue-from-incident, walkthrough, polemic, explainer, etc. — open list).
- **rationale** — one line covering "why this angle," typically referencing 1–2
  of the relevant pages it would lean on.

Coverage diversity: pick four meaningfully different angles. Avoid four polemics
or four explainers. Flag exactly one as `[Recommended]` based on best fit
between input thesis and KB coverage.

### Step 1d — Render Round 1 candidates

```
## Round 1 — Pick an angle

Based on your input + KB scan, here are 4 candidate angles:

### A. [Recommended] <thesis sentence>
- **Audience:** <…>
- **Move:** <…>
- **Why:** <one line, often referencing [[page-x]] / [[page-y]]>

### B. <thesis sentence>
- **Audience:** <…>  ·  **Move:** <…>  ·  **Why:** <…>

### C. <…>
### D. <…>

**Reply with a letter (A–D), or describe a different direction.**
```

### Step 1e — Parse Round 1 response

| Input | Action |
|---|---|
| Single letter (`B`) | Lock that angle; advance to Step 2a |
| Letter + qualifier (`B but tighten audience to KB tooling builders`) | Confirm with one follow-up: *"Locking B with audience: KB tooling builders. OK?"* — lock on confirmation, then Step 2a |
| Prose redirect (`none of these — argue against embeddings entirely`) | Re-spawn `kb-search` with Step-1 prompt amended: *"the topic has shifted to: `<user prose>`; re-summarize and re-scan."* Loop back to Step 1c with fresh candidates. (P8 — scope changed.) |
| Punt (`idk, what do you think?`) | Pick recommended (A); confirm: *"Going with A. Reply now if you want different."* |
| Out-of-range letter (`E`) | *"Only A–D in the list. Pick one of those, or describe a direction."* |

Lock state in context: `topic summary`, `3 key claims`, `locked angle` (thesis +
audience + move + rationale).

### Step 2a — Spawn kb-search for Spark Round 2 (anchor retrieval)

```
Task: Round 2 of kb-draft-directed spark step.

Locked angle: <thesis> for <audience>, move = <move>. Rationale: <rationale>.

Task: Surface 8–12 wiki pages that could serve as anchors for this angle. Use
knowledge-base/index.md as entry point and traverse [[wikilinks]] for adjacency.

Output schema: one labeled section:
  ## Anchor pages — 8–12 entries, each
                   `[[page-name]] — one-line "what it contributes if used as an anchor"`.

Retrieval and contribution-framing only.
```

### Step 2b — Compliance check (Round 2)

- `## Anchor pages` present.
- ≥ 8 entries.
- All `[[…]]` valid.

**On failure:** apply fallback per `reference/CONTEXT.md` §Compliance-fallback template (Spark Round 2).

### Step 2c — Render anchor candidates

```
## Round 2 — Pick the anchor working set

Locked angle: <thesis> · <audience> · <move>

### Pages
1. [Recommended] [[page-a]] — <contribution>
2. [Recommended] [[page-b]] — <contribution>
3. [Recommended] [[page-c]] — <contribution>
4. [[page-d]] — <contribution>
... up to 12

**Reply with the numbers you want in the working set (e.g. "1, 2, 3"),
or describe additions / removals / a redirect.**

My recommendation: 1, 2, 3 (3 anchors — keeps outline focused).
```

**Recommendation logic.** Flag 3–4 entries `[Recommended]` based on (a) agent's
return order (first entries presumed most relevant) AND (b) coverage diversity
(avoid recommending three pages that cover the same ground).

### Step 2d — Parse anchor response

| Input | Action |
|---|---|
| Number list (`1, 2, 7`) | Anchor set locked |
| Number list with edits (`1, 2, 7 plus [[some-other-page]]`) | Run `Glob "knowledge-base/wiki/**/<page>.md"`. If found, lock combined set. If not, ask: *"`[[some-other-page]]` not found in `knowledge-base/wiki/`. Did you mean `[[<closest-match>]]`? Or skip the addition?"* |
| Prose-only addition (`just give me whatever covers index-first retrieval`) | Pick matching numbers from the candidate list. Confirm: *"Locking 1 and 4 — those cover index-first retrieval. Reply now if you want different."* |
| Redirect (`none of these — anchors that argue against embeddings`) | Re-spawn `kb-search` with refined task; loop back to Step 2c |
| Punt (`you pick`) | Fall to recommended set; confirm |
| Out-of-range numbers (`13, 14`) | *"Only 1–<N> in the list. Did you mean different numbers, or want to add new candidates?"* |

Lock state in context: + `locked anchor set` (3–6 `[[page-name]]` references).

═══════════════════════════════════════════════════════════════════════════════
## PASS 2 — OUTLINE (1 or 2 user-direction rounds)
═══════════════════════════════════════════════════════════════════════════════

### Step 3a — Spawn kb-search for Outline Round 1 (anchor reads + 1-hop)

```
Task: Round 1 retrieval for /kb-draft-directed outline pass.

Locked angle: <thesis> for <audience>, move = <move>. Rationale: <rationale>.
Locked anchor set:
  - [[page-a]]
  - [[page-b]]
  - ... (3–6 entries)

Step 1 — anchor reading. For each locked anchor page, read it end-to-end and
return a 2–3 sentence summary of the **positions** the page commits to (not
just topics). Focus on what claims the page would support if cited — what
stances, definitions, or framings it bears on.

Step 2 — one-hop traversal. For each locked anchor page, list the [[wikilinks]]
it links out to. Read each linked page once and return a one-line position
summary per page. **HARD STOP at one hop** — do not traverse further.

Output schema: single response with two labeled sections:
  ## Anchor position-summaries — one entry per locked anchor:
      - [[page-a]] — 2–3 sentence position summary
      - ...
  ## One-hop adjacencies — flat list:
      - [[adjacent-page-1]] (linked from [[page-a]]) — one-line position summary
      - [[adjacent-page-2]] (linked from [[page-a]], [[page-b]]) — one-line position summary
      - ...

Retrieval and position-summarization only.
```

### Step 3b — Compliance check (Outline Round 1)

- `## Anchor position-summaries` present, exactly N entries (N = locked anchor count).
- `## One-hop adjacencies` present (may be empty if no anchors have outgoing
  wikilinks; structurally rare but allowed).
- All `[[…]]` valid.

**On failure:** apply fallback per `reference/CONTEXT.md` §Compliance-fallback template (Outline Round 1).

### Step 3c — Compose 3 candidate outlines

For each candidate:
- **Shape descriptor** — short label naming the rhetorical shape (e.g.,
  "didactic, definition-first," "polemical, attack-first," "story-shaped,
  incident-first").
- **Bullet count varies per candidate** — count fits the shape (e.g.,
  4-bullet polemical, 5-bullet didactic, 6-bullet narrative).
- **Per bullet annotated** (internal state, not yet shown to user):
  - `text`: orchestrator-written verbatim.
  - `stake: yes|no` — `yes` = bullet asserts a defendable position; `no` =
    descriptive/transitional/closer.
  - `binding`: zero or more `[[page-name]]` refs from the anchor + 1-hop pool,
    under strict direct-match rule (page must address the bullet's specific
    claim, not just the topic).
  - `confidence: high|medium|low|n/a` — based on how directly the binding pages
    support the bullet's claim.
- **`stake: yes` + empty binding** → flagged with `[gap]` in the candidate display.
- **`stake: no` + empty binding** → no marker.
- **Coverage diversity** — pick three meaningfully different shapes.

Also auto-derive a **pass-3 notes block** of contradictions to investigate
(e.g., where two anchors disagree on a definition or stance). Held in context
for pass 3a.

### Step 3d — Render Round 1 candidates

```
## Round 1 — Pick an outline shape

Locked angle: <thesis> · <audience> · <move>

### A. [Recommended] <Shape descriptor>
1. <bullet text>
2. <bullet text>
3. <bullet text> [gap]
4. <bullet text>
*(1 gap)*

### B. <Shape descriptor>
1. <bullet text>
... *(0 gaps)*

### C. <Shape descriptor>
... *(<n> gap[s])*

Reply with a letter (A–C), or describe a different direction. After you pick,
I'll show the anchor binding I derived for that variant and you can revise
before locking.
```

**Recommendation heuristic.** Flag exactly one candidate `[Recommended]`. Prefer
(a) zero or fewest gaps AND (b) shape aligning with the locked angle's `move`.
Tie-break by broader anchor coverage.

### Step 3e — Parse pick response

| Input | Action |
|---|---|
| Single letter (`B`) | Advance to Step 3f (binding-confirm) |
| Letter + structural qualifier (`B but drop bullet 4`) | Confirm; on confirmation, re-derive binding for the modified candidate before Step 3f |
| Prose redirect (`none of these — story-shaped opener`) | **Do NOT re-spawn `kb-search`** (anchor + 1-hop pool is still valid per P9). Re-compose 3 fresh candidates locally using the redirect as composition guidance. Loop to Step 3d |
| Punt (`idk, what do you think?`) | Pick recommended; confirm: *"Going with A. Reply now if you want different."* |
| Out-of-range letter (`E`) | *"Only A–C in the list. Pick one of those, or describe a direction."* |

### Step 3f — Binding-confirm render (P10)

For the picked candidate, render the binding explicitly:

```
**Locking B (<shape descriptor>). Here's the binding I derived:**

1. <bullet text>
   - bound to: [[page-x]] (anchor), [[page-y]] (1-hop)
   - stake: yes · confidence: high
2. <bullet text> [gap]
   - no direct anchor; closest is [[page-z]] but bullet asserts a generalization
     across cases that no anchor or 1-hop page directly supports.
   - stake: yes · confidence: low
3. <bullet text>
   - bound to: [[page-w]] (anchor)
   - stake: yes · confidence: medium
4. <bullet text>
   - no anchor needed (closing exhortation)
   - stake: no · confidence: n/a

Reply `ok` to lock and continue. Or revise:
- "rebind bullet 1 to [[page-q]]"
- "drop bullet 3"
- "swap bullets 2 and 3"
```

### Step 3g — Parse binding-confirm response

| Input | Action |
|---|---|
| `ok` | Outline locks; advance to Step 4 (Round 2 trigger check) |
| Rebind to page in anchor + 1-hop set | Pure orchestrator re-mapping (P9 composition-only); re-render Step 3f |
| Rebind to page outside anchor + 1-hop set | Run `Glob "knowledge-base/wiki/**/<page>.md"`. If found: spawn tight `kb-search` (read this one page, return position summary, no traversal — scope-change retrieval per P9); add to context; re-render Step 3f. If not found: *"`[[page-q]]` not found. Did you mean X? Or skip the rebind?"* |
| Drop bullet | Remove bullet, renumber, re-render Step 3f |
| Swap/reorder bullets | Re-render with new order |
| Reject candidate entirely (`actually, different shapes`) | Loop back to Step 3d (composition-only per P9) |
| Punt (`looks fine, you decide`) | *"Locking as shown. Reply now if you want different."* |

Lock state in context: + `locked outline` (each bullet with text/stake/binding/
confidence) + `pass-3 notes block` + `anchor + 1-hop position-summaries`.

### Step 4 — Round 2 trigger check

Count `stake: yes` bullets with empty `binding`.

- **Zero gaps** → Round 2 silently skipped. No announcement, no zero-gaps
  message. Advance to Pass 3 (Step 5).
- **One or more gaps** → fire Round 2 (Step 4a).

### Step 4a — Render gap triage prompt

```
## Round 2 — Gap triage

The locked outline has <N> gap<s>. Recommendation per gap is shown below;
reply `ok` to accept all, or override per gap.

### Gap 1 — Bullet 2: "<bullet text>"
- **Why a gap:** <one-line explanation lifted from Step 3f's binding-confirm
  render — describes which anchor or 1-hop page is closest and why it doesn't
  directly cover the bullet's specific claim>.
- **Recommendation:** keep-no-input (draft pass will write prose from general
  knowledge; final artifact will mark the section as LLM-generated, no wiki
  context).

### Gap 2 — Bullet 5: "<bullet text>"
- **Why a gap:** <…>
- **Recommendation:** keep-no-input

Reply `ok` to accept all recommendations, or per-gap override:
- `<n>: remove` — drop bullet n from the locked outline.
- `<n>: keep — <prose>` — keep bullet n with the prose you supply as guidance
  for the draft pass.
- `<n>: keep` — keep bullet n with no input; LLM generates and section is
  marked LLM-generated.
```

**Recommendation:** always `keep-no-input` for every gap (default).

**Do NOT spawn an agent at Round 2** — the "why a gap" explanation is already in
context from Step 3f.

### Step 4b — Parse gap-triage response

| Input | Action |
|---|---|
| `ok` | All gaps resolved as `keep-no-input` |
| Per-gap overrides (`1: remove, 2: keep — <prose>, 3: keep`) | Apply each override; gaps not mentioned use the default; the prose for `keep — <prose>` is stored verbatim |
| Reference to nonexistent gap (`9: remove` when only 1–2) | *"Only gaps 1–<N> in the list. Did you mean a different number, or want to ignore that override?"* |
| Unrecognized action verb (`1: rewrite`) | *"Valid actions: `remove`, `keep`, or `keep — <prose>`. What did you want for gap 1?"* |
| Structural redirect (`actually, give me different shapes`) | Loop back to Step 3d with 3 fresh candidates. Round 2 prompt re-fires after the new Round 1 locks if the new outline has gaps |
| Punt (`you decide`) | Equivalent to `ok` |

### Step 4c — Lock state per gap

For each gap:
- **`remove`** → bullet dropped from outline; subsequent bullets renumber.
  Bullet leaves state entirely.
- **`keep-with-guidance`** → bullet stays with empty binding +
  `resolution: keep-with-guidance`, `guidance: "<verbatim user prose>"`.
- **`keep-no-input`** → bullet stays with empty binding +
  `resolution: keep-no-input`. No prose attached.

Lock state in context (final outline-pass output):
- topic summary + 3 key claims (from Spark Round 1)
- locked angle
- locked anchor set
- locked outline (each bullet with stake/binding/confidence/resolution/guidance)
- pass-3 notes block
- anchor + 1-hop position-summaries (reusable substrate)

═══════════════════════════════════════════════════════════════════════════════
## PASS 3 — RESEARCH-AND-DRAFT (mechanical, 0 user rounds — P12)
═══════════════════════════════════════════════════════════════════════════════

No user checkpoint. Advance immediately from Pass 2's lock.

### Step 5 — Spawn kb-search for Pass 3a (research)

```
Task: Research retrieval for /kb-draft-directed pass 3.

Locked angle: <thesis> for <audience>, move = <move>. Rationale: <rationale>.

Locked outline:
  - Bullet 1: <text>
    stake=<yes|no> | binding=<comma-separated [[page]] refs or empty> |
    confidence=<high|medium|low|n/a> | resolution=<keep-with-guidance|keep-no-input|none>
    [if keep-with-guidance: guidance="<verbatim user prose>"]
  - Bullet 2: ...
  ...

Pre-flagged contradictions to investigate (from outline pass — may be empty):
  - <freeform note from outline §3c pass-3 notes block>
  - ...

Step 1 — anchor reads. For each bullet with non-empty binding, read each bound
anchor page end-to-end. Also read all source-summary files referenced in those
pages' `source_summaries:` frontmatter (broad scope opt-in for this pass; stated
purpose: anchor claims to evidence).

Step 2 — per-bullet research. For each bullet with non-empty binding, return:
  - **Supporting:** verbatim page text excerpts that bear on the bullet's claim.
    Lift sentence, paragraph, or list item — whatever captures the page's
    argument. Each excerpt followed by ` — [[page]]` or
    ` — wiki/sources/<filename>` attribution.
  - **Counterarguments:** verbatim page text that EITHER argues *for* the
    bullet's claim OR is diametrically opposed enough to be worth flagging as a
    caveat. Skip weak qualifications. Each excerpt followed by attribution.

Step 3 — bullets with no binding:
  - keep-with-guidance: traverse 1-hop from the locked anchor pages (read the
    [[wikilinks]] those pages link to, one hop only — same rule as outline pass).
    For any 1-hop page whose content supports the user's guidance prose, return
    verbatim excerpts with ` — [[page]]` attribution. May be empty.
  - keep-no-input: return literally "no research (LLM-generated, no wiki
    context allowed)." Do not retrieve.
  - stake:no: return literally "no research (descriptive bullet)."

Output schema: structured response with one section per bullet, in outline
order:

  ## Bullet 1: <text>
  **Supporting:**
  - <excerpt> — [[page]]
  - <excerpt> — wiki/sources/<filename>
  **Counterarguments:**
  - <excerpt> — [[page]]

  ## Bullet 2: <text>
  ...

Retrieval and excerpt-lift only — do not draft, synthesize, or score.
```

### Step 5b — Compliance check (Pass 3a)

- One `## Bullet <N>: <text>` section per bullet in locked outline (N entries
  total).
- Each bullet section non-empty (Supporting/Counterarguments excerpts, or the
  literal "no research (...)" string for non-binding bullets).
- Each `[[…]]` valid (per CONTEXT.md §Wikilink syntax).
- Each `wiki/sources/<filename>` matches `wiki/sources/[a-z0-9-]+\.md`.

**On failure:** apply fallback per `reference/CONTEXT.md` §Compliance-fallback template (Pass 3a).

### Step 5c — Compose draft inline (Pass 3b — no sub-agent)

You compose the draft prose yourself, in this orchestrator session. Per-bullet
rules:

| Bullet shape | Composition rule | Annotation rule |
|---|---|---|
| `binding`-having, `stake: yes` | Compose prose drawing on the page text excerpts. Lift verbatim where natural. Honor the locked angle's `move`. | Each fact-bearing sentence gets `<!-- kb-draft:claim-source:[[page]] -->`. Sentences with no page anchor get no annotation. |
| `keep-with-guidance` | Use the user's `guidance` prose as direction; extend/paraphrase. Lean on supplementary research excerpts where they fit. | Same as above. |
| `keep-no-input` | Compose using general knowledge only. Do not lean on any anchor or 1-hop page. | Every sentence: `<!-- kb-draft:llm-generated:no-wiki-context -->`. |
| `stake: no` | Compose freely (transitions, openers, closers). | None. Rare fact-bearing sentences follow the `binding`-having rule. |

**No prose wikilinks** — see `reference/CONTEXT.md` §Wikilinks never appear in prose body.

**Counterarguments.** When research surfaces a counterargument that bears on a
sentence, weave the caveat into the prose itself if the locked move calls for
it (polemic = often acknowledge and dismiss; didactic = often state both sides;
explainer = usually skip). Never tag with an HTML comment. The draft is a
polished article, not an annotated one.

**Fact-bearing sentence definition:** see `reference/CONTEXT.md`.

**Length.** Uncapped. Proportional to outline complexity + research depth.
Target prose density appropriate to the locked move (e.g., polemic = denser,
didactic = more spacious). No fixed word-count range.

**No banned-phrase enforcement.** No fixed-format requirement on lifted page
text. Faithful rendering of the page's argument matters; format pedantry does
not.

After composition, the marked-up draft prose lives in your context. No file
written. Advance immediately to Pass 4.

═══════════════════════════════════════════════════════════════════════════════
## PASS 4 — COLD-CONTEXT VERIFY (mechanical, 0 user rounds — P12, P13)
═══════════════════════════════════════════════════════════════════════════════

### Step 6 — Spawn kb-search cold-context (Pass 4)

The agent definition file is unchanged. Cold-context is enforced by what this
prompt does and doesn't include — not by a separate agent file (P13). The
prompt body contains the draft and only the draft. Strip angle, outline,
research findings, and your reasoning.

```
Task: Cold-context claim verification for /kb-draft-directed pass 4.

You have ONLY the marked-up draft below. You have NOT seen the angle, the
outline, the research findings, or any orchestrator reasoning. Your job is to
independently verify each [[page]] reference grounds the claim it's attached to.

Draft:
<<<DRAFT_PROSE_WITH_ANNOTATIONS>>>

For each <!-- kb-draft:claim-source:[[page]] --> annotation:
  1. Open knowledge-base/wiki/{concepts,entities,comparisons}/<page>.md
     (try concepts first, then entities, then comparisons).
  2. Scan the page for material that grounds the claim in the annotated
     sentence. "Grounds" means a careful reader of the page would agree the
     claim is supported by the page text.
  3. Return verdict: grounded | not-grounded-in-page | page-not-found.

For <!-- kb-draft:llm-generated:no-wiki-context --> annotations: return
literally "skip (LLM-generated section)."

Constraints:
  - Do not traverse [[wikilinks]].
  - Read only the pages named in claim-source annotations.

Output schema: per-annotation verdict list, in document order:

  ## Verdicts
  - sentence-1 (claim-source:[[page-x]]): grounded
  - sentence-2 (claim-source:[[page-y]]): not-grounded-in-page
  - sentence-3 (llm-generated:no-wiki-context): skip (LLM-generated section)
  - ...
```

Substitute `<<<DRAFT_PROSE_WITH_ANNOTATIONS>>>` with the draft body literally.

### Step 6b — Compliance check (Pass 4)

- One verdict per `claim-source:[[page]]` or `llm-generated:no-wiki-context`
  annotation in the draft.
- Each verdict is one of the 4 legal strings: `grounded`,
  `not-grounded-in-page`, `page-not-found`, `skip (LLM-generated section)`.
- Verdicts in document order.

**On failure:** apply fallback per `reference/CONTEXT.md` §Compliance-fallback template (Pass 4). Skip Step 6c; jump to Step 6d.

### Step 6c — Rewrite annotations inline

| Verdict | Original annotation | Action |
|---|---|---|
| `grounded` | `<!-- kb-draft:claim-source:[[page]] -->` | **Delete the annotation** (and any single space immediately preceding it). The sentence emerges as clean prose. |
| `not-grounded-in-page` | `<!-- kb-draft:claim-source:[[page]] -->` | Rewrite to `<!-- kb-draft:claim-flagged:no-grounding-in-[[page]] -->`. |
| `page-not-found` | `<!-- kb-draft:claim-source:[[page]] -->` | Rewrite to `<!-- kb-draft:claim-flagged:no-grounding-in-[[page]] -->`. |
| `skip (LLM-generated section)` | `<!-- kb-draft:llm-generated:no-wiki-context -->` | Unchanged. |

After Step 6c, the body honors the success-path invariant in `reference/CONTEXT.md` §Annotation taxonomy.

### Step 6d — Write final file

Path: `<project-root>/<input-stem>.draft.md`. Use the `Write` tool.

Frontmatter: use the template in `reference/CONTEXT.md` §Final-file frontmatter (substitute bracketed values from locked state).

Body: the marked-up draft prose with rewritten annotations.

If pass-4 fallback fired (Step 6b failure), append a `## Verify warnings` block
at the bottom listing un-rewritten annotations and the reason verify failed.

### Step 6e — Chat summary

After write, emit (substitute counts):

```
Draft written to <project-root>/<input-stem>.draft.md.
- Bullets: <N> total, <N-bound> bound, <N-guided> guided,
  <N-llm-generated> LLM-generated, <N-descriptive> descriptive.
- Verified claims: <N-grounded> grounded (annotations deleted),
  <N-flagged> flagged (no grounding in bound page),
  <N-llm-generated-sentences> LLM-generated sentences.
- [If verify fallback fired]: ⚠️ Verify pass partial — see Verify warnings
  block in the file.
```

Pass 4 done. Discard orchestrator context.

═══════════════════════════════════════════════════════════════════════════════
## Conventions

- **No new agent file.** All 5 spawns reuse `.claude/agents/kb-search.md`. Each
  per-invocation prompt differs; the agent file is unchanged.
- **Round 2 conditional firing is silent.** No "no gaps to triage, skipping
  Round 2" message. Outline transitions silently to pass 3 when no gaps exist.
- **Original bullet numbering preserved unless `remove` is applied.** Numbering
  shifts only when at least one bullet is dropped in Round 2.
- **Confirm-step redirects loop back to candidate-pick (Step 3d)**, not to
  candidate-generation or retrieval. Loop point = whichever step produces the
  artifact the user wanted to redirect on.

## Coexistence with /kb-draft

`/kb-draft-directed` and the autonomous `/kb-draft` prototype coexist. Both
write to different paths and follow different pass shapes:
- Auto: `.kb-draft-staging/<slug>/` (multiple intermediate files).
- Directed: `<project-root>/<input-stem>.draft.md` (single final file).

The user picks per article. If they want creative direction, they invoke
directed. If they want to compile a tight outline or brain-dump unattended,
they invoke auto. Neither replaces the other.
