---
name: kb-draft
description: Compile a markdown input (outline, partial draft, brain-dump, or spark) into an annotated draft via 5 autonomous passes (spark, outline, priors, draft, claim-check + voice-pass) grounded in the personal wiki and cold-context-checked against a static voice profile. Use when the user wants unattended drafting with no creative direction mid-pipeline. Parallel to /kb-draft-directed; both coexist.
---

# /kb-draft (orchestrator)

## Mission (one sentence)

Take a markdown input (outline, partial draft, or spark), run it through five sequential passes that consult the personal wiki for grounding and voice, and emit an annotated draft whose every fact-bearing sentence is wikilink-grounded and whose voice has been cold-context-checked against the writer's own past prose.

## Inputs

- A single markdown file path (e.g., `experimental/prototypes/kb-draft/examples/worked-example-input.md`).
- Optional mode override; if absent, pass 1 detects mode from the input.
- The static voice profile at `.claude/skills/kb-draft/voice-profile.md`.
- Read-only access to `knowledge-base/index.md`, `knowledge-base/source_index.md`, and `knowledge-base/wiki/**/*.md`.

## Outputs

All outputs go under `.kb-draft-staging/<slug>/` where `<slug>` is the kebab-case of the input filename (drop the `.md` extension; if the filename is already kebab-case, keep it as-is).

Six staging files plus one final draft copy:

```
.kb-draft-staging/<slug>/
  01-spark.md
  02-outline.md
  03-priors.md
  04-draft.md
  05a-claim-check.md
  05b-voice-pass.md
  <slug>.draft.md         # exact byte-for-byte copy of 05b-voice-pass.md
```

File names are exact. Do not pluralize. Do not invent new files.

## Operating constraints

- **Write only inside `.kb-draft-staging/<slug>/`.** Read elsewhere as needed; do not write outside the staging dir.
- **Do not modify** `.claude/`, `knowledge-base/`, or any settings. The wiki is read-only.
- **Schema is locked.** Use only the 11 annotation kinds in the taxonomy below; do not invent new annotation kinds, new wiki page types, or new staging files.
- **No mid-draft retrieval in pass 4.** Retrieval happens in passes 2 and 3 only; pass 4 has the wiki dormant.
- **No new claims in pass 4.** Every `<!-- kb-draft:claim-source:[[page]] -->` annotation in `04-draft.md` MUST reference a wikilink that appeared in `03-priors.md`. If you want to assert something not surfaced in priors, mark it `<!-- kb-draft:claim-source:none -->`.
- **Body-prose byte-equality across passes 4 → 5a → 5b.** When all `<!-- kb-draft:* -->` HTML comments are stripped (regex `<!-- kb-draft:[^>]*-->`) and whitespace normalized, the prose body of `04-draft.md`, `05a-claim-check.md`, and `05b-voice-pass.md` MUST be byte-identical. Passes 5a and 5b only add or rewrite annotations; they never edit prose.
- **Cold-context property in pass 5b.** Pass 5b's prompt MUST include only `voice-profile.md`, the 3 runtime-sample source-summary files, and `05a-claim-check.md`. It MUST NOT include `01-spark.md`, `02-outline.md`, `03-priors.md`, or `04-draft.md`. This is structural, not advisory.
- **No literal `<<<` tokens in any output.** All prompt placeholders must be substituted before writing.

## Mode detection rules

Apply in order; first match wins. Detection runs in pass 1 and is recorded in pass 1's frontmatter `mode:` field, which all subsequent passes carry forward unchanged.

1. **brain-dump** — input frontmatter contains `mode: brain-dump`, OR body contains a literal `[brain dump]` / `[transcribed]` marker, OR has obvious dictation artifacts (filler words, no headings, lines like "ok so the thing is...").
2. **partial** — body contains any `[claim TODO]`, `[TODO]`, or `(search ...)` marker, OR contains paragraphs of prose (any single line longer than 120 characters that does not begin with a bullet or heading marker).
3. **outline** — body contains at least one `## ` heading AND at least one bulleted line under a heading, AND no qualifying partial-mode prose.
4. **spark** — fallback: single paragraph, single sentence, or unstructured note that does not match the above.

If the input frontmatter has an explicit `mode:` field that names one of the four, prefer that over the heuristic but record both in pass 1's `## Detected mode` section so a mismatch is visible.

---

## Pass 1: Spark

**Trigger.** First pass; runs unconditionally on every invocation.

**Reads.**
- The input markdown file (entire contents).
- `knowledge-base/source_index.md` — top 20 entries only (newest 20 sources). If the file has a frontmatter or preamble before the chronological list, count the first 20 list entries after that.

**Prompt scaffold.** Construct this prompt and run it as the pass-1 work; substitute `<<<...>>>` placeholders with file contents before the LLM call.

```
You are pass 1 of /kb-draft (Spark). Your job is to (a) classify the input mode
and (b) surface 3-5 recently-ingested sources that bear on this topic.

Input file (path: <<<INPUT_PATH>>>):
<<<INPUT_CONTENT>>>

Recent sources (top 20 from knowledge-base/source_index.md, newest first):
<<<SOURCE_INDEX_TOP_20>>>

Instructions:

1. Detect mode using these rules in order, first match wins:
   - brain-dump: input frontmatter says brain-dump, OR body has [brain dump] /
     [transcribed] markers, OR clear dictation artifacts.
   - partial: body has [claim TODO] / [TODO] / (search ...) markers, OR contains
     paragraphs of prose (any line >120 chars with no bullet/heading prefix).
   - outline: body has at least one `## ` heading AND at least one bulleted
     line, AND none of the partial signals.
   - spark: single sentence, single paragraph, or unstructured note.

2. Extract the working thesis. If the input states one explicitly, lift it
   verbatim. If not, propose one in a single sentence.

3. From the 20 recent sources listed above, pick 3-5 whose tags or one-liners
   overlap the input's topic. For each: state the relative path under
   wiki/sources/, the date, and one sentence on why it bears on the input.

4. Add notes for pass 2: anything pass 2 should know (ambiguous topic, missing
   thesis, mode uncertainty, etc.).

Return a markdown file with this EXACT structure (frontmatter then headings):

---
pass: 1
created: <YYYY-MM-DD>
mode: <detected mode>
input: <input path>
---

# Spark

## Thesis (working)
<one sentence>

## Detected mode
<mode> - <one-line justification, including which rule fired>

## Adjacent recent reading
- wiki/sources/<filename> [YYYY-MM-DD] - <why relevant>
- wiki/sources/<filename> [YYYY-MM-DD] - <why relevant>
- ...

## Notes for pass 2
<free-form, can be empty if nothing>
```

**Output.** Write to `.kb-draft-staging/<slug>/01-spark.md`.

---

## Pass 2: Outline

**Trigger.** Pass 1 complete (`01-spark.md` exists).

**Reads.**
- `01-spark.md` (just written).
- The original input file.
- `knowledge-base/index.md` — entire file, end-to-end.

**Prompt scaffold.**

```
You are pass 2 of /kb-draft (Outline). Map outline bullets to existing wiki
pages and flag stake-bearing bullets that have no wiki anchor.

Pass 1 spark:
<<<01-spark.md>>>

Original input:
<<<INPUT_CONTENT>>>

Wiki index (knowledge-base/index.md, entire file):
<<<INDEX_MD>>>

Instructions:

1. If mode is spark or brain-dump, synthesize a 5-bullet outline from the
   thesis. Otherwise use the outline already in the input verbatim (one entry
   per existing bullet; do not collapse or split).

2. For each outline bullet:
   a. Annotate `stake: yes` if the bullet asserts a position the writer would
      defend (e.g., "X compounds, Y decays"). Annotate `stake: no` if the
      bullet describes or operationalizes (e.g., "X is a managed harness").
   b. List up to 3 wikilinks from index.md that bear on this bullet. Match by
      page title, topic-section heading, and one-line summary in the index.
      Use exact `[[page-name]]` syntax (kebab-case slug, no path prefix).
   c. Note `confidence: high|medium|low`. Set to the lowest confidence among
      the wikilinks listed (high if all three look strongly relevant; low if
      any feel like a stretch).
   d. If `stake: yes` AND no wikilink matches, treat the bullet as a GAP and
      list it under `## Gaps to address before drafting` with the annotation
      `<!-- kb-draft:gap:no-wiki-page -->`.

   **Wikilink validity (REQUIRED — direct match only):**
   A `[[page-name]]` wikilink is valid for a bullet ONLY if the named wiki
   page contains content **directly addressing the bullet's specific claim**
   — not merely the topic surrounding the claim. Topic adjacency does NOT
   qualify. Test: if the wiki page were the only source you had, could you
   write a sentence supporting the bullet's specific claim using that page?
   If yes, the wikilink is valid. If you'd be reaching, the wikilink is NOT
   valid.

   **Gap detection rule (REQUIRED):**
   If, after scanning, NO wiki page directly addresses the bullet's specific
   claim:
   - Leave the bullet's `wikilinks:` line **empty** (literally:
     `   - wikilinks:` with nothing after the colon).
   - Set `confidence: low`.
   - Add the bullet to `## Gaps to address before drafting` with the format:
     `- Bullet <N> "<text>" — no wiki anchor; <one-line explanation>; consider /kb-drop or /kb-ingest first. <!-- kb-draft:gap:no-wiki-page -->`

   A bullet that introduces a **novel reframe, definition, or specific
   operationalization** that does not exist in the wiki yet is the canonical
   gap case. Do not paper over it with topically-adjacent wikilinks just to
   keep the bullet "covered."

3. Bullet count must equal input bullet count exactly when mode is `outline`
   or `partial`. In `spark` or `brain-dump` mode, synthesized count is 5
   (allow one bullet of slack synthesis).

Return a markdown file with this EXACT structure:

---
pass: 2
created: <YYYY-MM-DD>
mode: <from pass 1>
input: <input path>
---

# Outline

## Bullets
1. <bullet text verbatim if outline mode, else synthesized>
   - stake: yes|no
   - wikilinks: [[page1]], [[page2]], [[page3]]
   - confidence: high|medium|low
2. ...

## Gaps to address before drafting
- Bullet <N> "<text excerpt>" - no wiki anchor; consider /kb-drop or /kb-ingest first. <!-- kb-draft:gap:no-wiki-page -->
- ...
(or "None" if no gaps)

## Notes for pass 3
<anything pass 3 should know>
```

**Output.** Write `02-outline.md`.

**Self-consistency rule (enforce before writing).** Every bullet under `## Bullets` with `stake: yes` AND empty wikilinks list MUST appear in `## Gaps to address before drafting`. Every wikilink in `## Bullets` MUST match the regex `\[\[[a-z0-9-]+\]\]`.

---

## Pass 3: Retrieve priors

**Trigger.** Pass 2 complete.

**Reads.**
- `02-outline.md`.
- For every wikilink listed in any pass-2 bullet: read the corresponding wiki page directly via `Read` (path: `knowledge-base/wiki/concepts/<page>.md` or `knowledge-base/wiki/entities/<page>.md` or `knowledge-base/wiki/comparisons/<page>.md`; try concepts first, then entities, then comparisons; if none exists, log a note and skip).

**Prompt scaffold.** Run once with all wikilinked page contents loaded, OR per-bullet if the page set is large; either way, the output file is a single `03-priors.md`.

```
You are pass 3 of /kb-draft (Retrieve priors). For each stake-bearing bullet
from pass 2, return supporting evidence, contradiction-against-self flags,
and Mario-authored sources adjacent to the bullet.

Outline (from pass 2):
<<<02-outline.md>>>

Wiki page contents (concatenated; each page preceded by its [[page-name]]):
<<<WIKI_PAGE_CONTENTS>>>

Instructions:

1. For every bullet from pass 2 with `stake: yes`, produce a `## Bullet <N>:`
   block. For bullets with `stake: no`, produce a one-line entry that says
   "no priors retrieved (descriptive)."

2. In each stake-bearing bullet block:

   **Supporting:** Extract 1-2 sentences from the wiki page bodies that
   DIRECTLY support the bullet. Each sentence MUST be a verbatim double-quoted
   quote followed by " — [[page-name]]" attribution (em-dash, U+2014, flanked
   by single spaces — NOT a hyphen). No paraphrase. No citation without a
   quote.

   **Attribution format (REQUIRED):** Every supporting quote and
   counterargument quote MUST be followed by ` — [[page]]` using an
   **em-dash** (`—`, U+2014), not a hyphen (`-`). Bullets that use a hyphen
   will be rejected by `[Beh3.1]`.

   **Supporting quote count (REQUIRED):** Limit `**Supporting:**` to **1 or 2
   verbatim quotes per bullet**, not 2-3. Pick the strongest one or two; do
   not pad. Total supporting quotes across all bullets should land in the
   5-10 range. Over-quoting will fail `[S3.1]`.

   **Counterarguments / contradictions-against-self:** Scan each loaded
   page's `## Counterarguments / Gaps` and `## Contradictions` sections
   when those sections exist, AND scan the entire page body regardless. If
   any counterargument bears on this bullet, surface it as a verbatim quote
   followed by ` — [[page]]` (em-dash attribution, same rule as Supporting)
   and an "(open contradiction: yes|no)" marker. Also run a
   contradiction-against-self check: ask whether any page body implies the
   OPPOSITE of the bullet. If yes, flag it.

   **Counterargument scanning (REQUIRED):**
   For each stake-bearing bullet, you MUST explicitly scan the named wiki
   pages for opposing material. Specifically:

   1. **Read the entire page body**, not just sections labelled
      `## Counterarguments` or `## Contradictions`. Counterarguments and
      qualifications appear inline in main-body prose more often than in
      dedicated sections.
   2. **Look for any claim that opposes, weakens, qualifies, or limits the
      bullet's claim** — not just direct logical opposites. Phrases like
      "however," "but in some cases," "the empirical finding contradicts,"
      "this does not hold when," "the open question is," "an exception is"
      are counterargument cues.
   3. The `**Counterarguments / contradictions-against-self:**` subsection
      MUST contain **at least one entry** for every stake-bearing bullet
      whose named wiki pages have *any* qualification, hedge, or competing
      claim. An empty counterargument block on a stake-bearing bullet is a
      signal of insufficient scanning — re-scan the wiki pages before
      declaring the bullet has no counterarguments.
   4. **`(open contradiction: yes|no)` annotation:** mark `yes` only when
      the counterargument **directly contradicts** the bullet's claim (the
      wiki page asserts the *opposite* of the bullet, not just "weakens"
      or "limits"). Mark `no` for qualifications, hedges, or scope limits.
      **For a stake-rich opinion piece running through a curated wiki of
      position-bearing pages, expect at least 1 `open contradiction: yes`
      across all bullets.** If pass-3 finds zero, the runner is being too
      conservative — re-scan with a lower threshold for what counts as
      direct contradiction.

   **Open-contradiction-yes ceiling (REQUIRED):**
   The total count of `(open contradiction: yes)` across all bullet blocks
   must be **at most 2** for a stake-rich opinion piece (5+ stake-yes
   bullets). If your scanning identifies 3+ candidates that look like direct
   contradictions, **rank them by strength** (clarity of opposition, depth
   of argument in the wiki page), keep the top 1-2 as `yes`, and **downgrade
   the rest to `no`** (still recording the counterargument prose, but
   flagging it as `(open contradiction: no)` because it qualifies/limits
   rather than directly opposes).

   Calibration: 0 yeses on a stake-rich piece is too few; 3+ is too many;
   **1-2 is the target**. Prefer 1 high-confidence yes over multiple
   ambiguous ones.

   **Mario-authored sources adjacent (for voice-pass later):** From the
   `source_summaries:` frontmatter of each loaded page, list any
   Mario-authored summaries (those whose corresponding raw/ files were
   authored by Mario - typically `raw/notes/`, or `raw/articles/` from the
   user's own Substack). List them as `wiki/sources/<filename>` paths only;
   pass 5b will read them later.

3. **Voice-pass source list constraint (REQUIRED):** The
   `## Voice-pass source list (consolidated; pass 5b reads these)` block at
   the bottom of `03-priors.md` MUST be **the union of paths that appear in
   at least one per-bullet `**Mario-authored sources adjacent (for voice-pass
   later):**` entry above**. Do NOT introduce sources that do not appear in
   any per-bullet entry. If a source from `voice-profile.md`'s
   `runtime-samples-from:` list is not adjacent to any bullet, omit it from
   the consolidated list rather than smuggling it in.

4. After all bullet blocks, produce a `## Voice-pass source list (consolidated;
   pass 5b reads these)` section listing 2-4 Mario-authored
   `wiki/sources/*-summary.md` paths drawn from the per-bullet enumerations.
   This list is the union (or a curated subset) of bullet-level Mario sources,
   subject to the strict-subset constraint in step 3.

Return a markdown file with this EXACT structure:

---
pass: 3
created: <YYYY-MM-DD>
mode: <from pass 1>
input: <input path>
---

# Priors

## Bullet 1: <bullet text>
**Supporting:**
- "<verbatim sentence>" — [[page]]
**Counterarguments / contradictions-against-self:**
- "<verbatim sentence>" — [[page]] (open contradiction: yes|no)
**Mario-authored sources adjacent (for voice-pass later):**
- wiki/sources/<filename>

## Bullet 2: ...
(repeat per stake-bearing bullet)

## Bullet N: <descriptive bullet text>
no priors retrieved (descriptive)

## Voice-pass source list (consolidated; pass 5b reads these)
- wiki/sources/<filename>
- wiki/sources/<filename>
- wiki/sources/<filename>
```

**Output.** Write `03-priors.md`.

**Invariants.** Every quote in a `**Supporting:**` line is double-quoted and followed by ` — [[page]]` (em-dash, U+2014; not a hyphen). The voice-pass source list is a strict subset of the union of per-bullet Mario-authored enumerations (no surprise sources at the bottom). Supporting quotes are limited to 1-2 per bullet; total across all bullets lands in 5-10.

---

## Pass 4: Draft

**Trigger.** Pass 3 complete.

**Reads.**
- `02-outline.md`.
- `03-priors.md`.
- The original input (in case the writer added prose between passes).

**Wiki is dormant.** Do NOT open any wiki page during pass 4. All page-grounded claims must come from the verbatim quotes already in `03-priors.md`.

**Mode-specific behavior.**
- `outline`: LLM drafts prose from the outline + priors.
- `partial`: copy the writer's prose from the input verbatim into `04-draft.md` body, then add `<!-- kb-draft:claim-source:* -->` annotations on fact-bearing sentences (sourcing from priors where applicable, `none` otherwise). Do not rewrite prose.
- `spark` / `brain-dump`: LLM drafts prose from the synthesized outline + priors, treating the input thesis as the lede.

**Prompt scaffold.**

```
You are pass 4 of /kb-draft (Draft). Produce a working draft from the outline
and priors. Stay close to the writer's lexical and syntactic choices in the
input. Do NOT introduce new claims; do NOT cite pages that were not surfaced
in pass 3. Use the verbatim supporting quotes from pass 3 where natural; lift
the writer's existing prose without rephrasing.

Outline (pass 2):
<<<02-outline.md>>>

Priors (pass 3):
<<<03-priors.md>>>

Original input:
<<<INPUT_CONTENT>>>

Style and annotation rules:

- Word count target: 400-800 words of prose body.
- Do not invent statistics, dates, or named entities.
- For every fact-bearing sentence (a sentence that contains a numeral, a year,
  a proper-noun cluster, a [[wikilink]], or an empirical-claim verb like
  "shows / found / demonstrates / achieves / scored / outperforms"), append
  ONE of:
    <!-- kb-draft:claim-source:[[page]] -->
      where [[page]] is a wikilink that appeared in 03-priors.md
      (the claim came from a pass-3 quote attributed to that page);
    <!-- kb-draft:claim-source:none -->
      if the sentence is fact-bearing but you are stating something not
      grounded by pass 3.
- HARD RULE: every [[page]] you use in a `claim-source:[[page]]` annotation
  MUST appear as a wikilink somewhere in 03-priors.md. If a page is not in
  priors, you cannot cite it; either rephrase or use `claim-source:none`.

Banned phrases - do not use any of these in the draft:
- "in today's fast-paced world"
- "delve into" / "delve"
- "tapestry"
- "ever-evolving landscape"
- "embark on a journey"
- "leverage" (as a verb when "use" works)
- "harness" (as a verb)
- "vibrant"
- "crucial"
- "compelling"
- "not just X, but Y"
- "in conclusion"
- "organizations must embrace innovation"

Output: prose only. No preamble, no "Here is the draft:" intro, no triple
backticks wrapping the whole draft. Frontmatter at the top per the format
below; then prose body; nothing after.

Format:

---
pass: 4
created: <YYYY-MM-DD>
mode: <from pass 1>
input: <input path>
---

<draft prose with inline <!-- kb-draft:claim-source:* --> comments>
```

**Output.** Write `04-draft.md`.

**Invariants.**
- Every page in any `claim-source:[[page]]` annotation must appear as a wikilink in `03-priors.md`. (Provenance chain unbroken.)
- No mid-draft retrieval. The pass 4 prompt receives only the three reads named above; do not open wiki pages here.
- Word-count target 400-800 in `outline` / `spark` / `brain-dump` modes. In `partial` mode, the writer's prose word count carries over (do not rewrite to fit the target).

---

## Pass 5a: Claim-check

**Trigger.** Pass 4 complete (or `04-draft.md` exists from a writer-supplied draft).

**Mode.** Default `claim-check-mode: conservative`. The runner may set `strict` if explicitly invoked with that mode; otherwise leave conservative.

**Reads.**
- `04-draft.md`.
- `03-priors.md`.
- For each `<!-- kb-draft:claim-source:[[page]] -->` annotation in the draft: re-open the named page from `knowledge-base/wiki/` and verify the claim grounds in the page text.

**Prompt scaffold.**

```
You are pass 5a of /kb-draft (Claim-check). For each fact-bearing sentence in
the draft, verify the claim grounds in the named page. Annotate inline. Do
NOT change the prose itself - annotations only.

Draft (from pass 4):
<<<04-draft.md>>>

Priors (from pass 3):
<<<03-priors.md>>>

Page contents for every page named in a claim-source annotation:
<<<PAGE_CONTENTS>>>

Mode: <conservative | strict>

Instructions:

1. Identify fact-bearing sentences. A sentence is fact-bearing if any of:
   - Contains a numeral (digit or written number above ten).
   - Contains a date or year.
   - Contains a proper-noun cluster (two or more capitalized words within
     5 tokens of each other naming a person, organization, product, paper).
   - Cites a [[wikilink]].
   - Uses an empirical-claim verb: shows, showed, found, finds, demonstrates,
     achieves, achieved, scored, outperforms, beats, fails, fail.

2. For each fact-bearing sentence:
   a. If it carries `<!-- kb-draft:claim-source:[[page]] -->`: open the page,
      verify the claim grounds in the page text. If yes, REPLACE the
      annotation with `<!-- kb-draft:claim-grounded:[[page]] -->`. If no,
      REPLACE with `<!-- kb-draft:claim-flagged:no-grounding-in-[[page]] -->`.
   b. If it carries `<!-- kb-draft:claim-source:none -->`:
      - In conservative mode: leave as-is, UNLESS the sentence cites a
        [[wikilink]] inline; in that case verify-and-annotate as in (a).
      - In strict mode: REPLACE with
        `<!-- kb-draft:claim-flagged:fact-bearing-no-source -->`.

3. Contradiction-against-self sub-pass: read the
   "Counterarguments / contradictions-against-self" subsections of pass 3.
   For each draft sentence whose claim opposes a counterargument quote,
   APPEND `<!-- kb-draft:contradicts-self:[[page]] -->` to that sentence.
   Pass 5a does not synthesize new contradictions; the page must already
   appear as a counterargument in 03-priors.md.

4. After all annotations, append:

   ## Claim-check summary
   - claim-grounded: <count>
   - claim-flagged: <count>
   - claim-source:none retained: <count>
   - contradicts-self: <count>

5. INVARIANT: the prose body, when all `<!-- kb-draft:* -->` HTML comments
   are stripped (regex `<!-- kb-draft:[^>]*-->`) and whitespace normalized,
   MUST be byte-identical to 04-draft.md's body. Do not edit prose.

Format:

---
pass: 5a
created: <YYYY-MM-DD>
mode: <from pass 1>
input: <input path>
claim-check-mode: <conservative|strict>
---

<draft prose with annotations updated per instructions>

## Claim-check summary
- claim-grounded: <N>
- claim-flagged: <N>
- claim-source:none retained: <N>
- contradicts-self: <N>
```

**Output.** Write `05a-claim-check.md`.

**Invariants.**
- Body-prose byte-equality with `04-draft.md` after stripping `<!-- kb-draft:[^>]*-->` and normalizing whitespace.
- No `claim-source:[[page]]` annotations remain — every one is resolved to `claim-grounded:[[page]]` or `claim-flagged:no-grounding-in-[[page]]`. (`claim-source:none` may remain in conservative mode; in strict mode it must be replaced by `claim-flagged:fact-bearing-no-source`.)
- Every `contradicts-self:[[page]]` refers to a page that appeared in `03-priors.md`'s counterarguments subsection.
- Every `claim-grounded:[[page]]` refers to a page named in pass 4's `claim-source:[[page]]`.

---

## Pass 5b: Voice-pass (cold context — fresh prompt invocation)

**Trigger.** Pass 5a complete.

**Cold-context property.** This pass is a STRUCTURALLY FRESH prompt invocation. The prompt MUST contain ONLY:
1. `.claude/skills/kb-draft/voice-profile.md`.
2. The 3 source-summary files listed in `voice-profile.md`'s `runtime-samples-from:` frontmatter (read each verbatim).
3. `05a-claim-check.md`.

The prompt MUST NOT contain `01-spark.md`, `02-outline.md`, `03-priors.md`, or `04-draft.md`. Do not summarize them; do not reference them. The voice critic has no upstream context by construction.

**Reads.**
- `.claude/skills/kb-draft/voice-profile.md`.
- The 3 source-summary files in `voice-profile.md`'s `runtime-samples-from:` frontmatter list. From each, extract the `## TL;DR` block and the first 3 bullets of `## Key takeaways` verbatim. These become numbered `sample-1`, `sample-2`, `sample-3`, … in concatenation order: source-A TL;DR + 3 takeaways are samples 1–4 (or 1–3 if you prefer one sample per source — pick a consistent rule and apply it; the rubric counts but does not enforce a specific N).
- `05a-claim-check.md`.

**Prompt scaffold (cold context — no upstream pass content allowed).**

```
You are the voice critic for /kb-draft. You have NOT seen the spark, the
outline, the priors, or the drafting history. You have ONLY:

1. The voice profile (banned phrases, idiosyncratic moves, sample sentences).
2. The 3 runtime-sample source-summary files, concatenated as numbered
   sample-N entries.
3. The claim-checked draft to critique.

Voice profile:
<<<voice-profile.md>>>

Verbatim sample sentences from past Mario-authored work
(numbered sample-1 .. sample-N; concatenated TL;DRs and Key Takeaways from
the runtime-samples-from sources):
<<<SAMPLES>>>

Draft to critique (this is 05a-claim-check.md):
<<<05a-claim-check.md>>>

Instructions:

1. For each sentence in the draft body:
   a. Banned-phrase check: if the sentence contains any phrase from the
      banned list in the voice profile, append
      <!-- kb-draft:voice-violation:banned-phrase:"<phrase>" -->.
   b. Idiosyncratic-move check: if the sentence CLEARLY AND UNAMBIGUOUSLY
      matches one of the idiosyncratic moves enumerated in the voice profile
      (specificity-compounds, the-wiki-shouldn't-be-X-it-should-be-Y, claim-
      then-counter-immediately, concrete-anecdote-as-evidence, naming-the-
      architecture-pattern), append <!-- kb-draft:voice-match:move-<N> -->
      where N is the move's 1-based index in the voice profile. Subject to
      the ceilings in step 2 below.
   c. Sample-similarity check: if the sentence's rhythm AND claim-shape
      strongly mirror a numbered sample-N from the runtime samples (not
      merely shared topic or vocabulary), append
      <!-- kb-draft:voice-match:sample-<N> -->. Subject to the ceilings in
      step 2 below.
   d. Slop check: if the sentence reads as generic AI prose (vague subject,
      hedged verb, abstract object, no concrete referent, no numeral, no
      proper noun, no idiosyncratic move), append
      <!-- kb-draft:voice-flag:generic -->.

2. **Annotation ceiling — idiosyncratic moves (REQUIRED):**
   - Maximum **1 `voice-match:move-N` annotation per sentence**. If a
     sentence plausibly matches two moves, pick the strongest one and
     annotate only that.
   - Total `voice-match:move-N` annotations across the whole draft must
     fall in **3-8 (target ~6)**. Be conservative; flag only **clear,
     unambiguous matches** to a move from the voice profile, not weak
     resemblances. If you find yourself approaching 9+ matches, you are
     over-annotating — drop the weakest until you land in 3-8.

   **Annotation ceiling — sample similarity (REQUIRED):**
   - Maximum **1 `voice-match:sample-N` annotation per sentence**.
   - Total `voice-match:sample-N` annotations across the whole draft must
     fall in **2-4 (target ~3)**. The closing self-quote and 2-3 other
     strong rhythm matches; not 6+. Sample similarity is a *high-bar*
     signal — only flag sentences whose rhythm and claim-shape strongly
     mirror a verbatim sample line, not sentences that share a topic or
     vocabulary.

   **When in doubt, omit (REQUIRED).** For both move-matching and
   sample-similarity, prefer fewer high-confidence annotations over many
   speculative ones. Over-annotation will fail rubric checks `[S5b.2]`
   and `[S5b.3]`. The voice-pass is a critic, not a cheerleader — it
   should be sparing with positive signals so they retain meaning.

3. Do NOT change the prose itself. Do NOT touch existing claim-grounded /
   claim-flagged / contradicts-self annotations - only append voice
   annotations.

4. After all annotations, append a `## Voice-pass summary` block with EXACTLY
   these 5 lines:

   ## Voice-pass summary
   - Banned-phrase violations: <count>
   - Idiosyncratic-move matches: <count>
   - Sample-similarity matches: <count>
   - Generic-prose flags: <count>
   - Verdict: <pass|revise|fail>

   Verdict rubric:
   - pass: 0 banned-phrase violations AND generic-prose flags <= 10% of
     fact-bearing sentences AND >= 1 sample-similarity match.
   - revise: 1+ banned-phrase, OR generic-prose flags 10-30%, OR 0
     sample-similarity matches with no other failure.
   - fail: generic-prose flags > 30%, OR (0 sample-similarity AND 1+
     banned-phrase).

5. INVARIANT: the prose body, after stripping all `<!-- kb-draft:* -->`
   comments and normalizing whitespace, MUST be byte-identical to
   05a-claim-check.md's body.

Format:

---
pass: 5b
created: <YYYY-MM-DD>
mode: <from pass 1>
input: <input path>
voice-profile: .claude/skills/kb-draft/voice-profile.md
runtime-samples-from:
  - <path1>
  - <path2>
  - <path3>
---

<draft prose with all 5a annotations preserved AND new 5b voice annotations appended>

## Voice-pass summary
- Banned-phrase violations: <N>
- Idiosyncratic-move matches: <N>
- Sample-similarity matches: <N>
- Generic-prose flags: <N>
- Verdict: <pass|revise|fail>
```

**Output.** Write `05b-voice-pass.md`.

**Invariants.**
- Cold-context prompt construction: ONLY voice-profile + 3 runtime-sample files + 05a-claim-check.md. NEVER include 01-spark / 02-outline / 03-priors / 04-draft.
- Body-prose byte-equality with `05a-claim-check.md` after stripping `<!-- kb-draft:[^>]*-->` and normalizing whitespace.

---

## Annotation taxonomy (11 kinds — use only these)

Every `<!-- kb-draft:* -->` HTML comment in any staging file MUST match one of these 11 forms. Inventing new kinds is a hard fail.

| Annotation | Meaning | Producing pass |
|---|---|---|
| `<!-- kb-draft:claim-source:[[page]] -->` | Pass 4 says: this claim came from page X | 4 |
| `<!-- kb-draft:claim-source:none -->` | Pass 4 says: this fact-bearing sentence has no wiki anchor | 4 |
| `<!-- kb-draft:claim-grounded:[[page]] -->` | Pass 5a verified the claim grounds in the page | 5a |
| `<!-- kb-draft:claim-flagged:no-grounding-in-[[page]] -->` | Pass 5a verified the claim does NOT ground | 5a |
| `<!-- kb-draft:claim-flagged:fact-bearing-no-source -->` | Pass 5a (strict mode) flagged a fact-bearing sentence with no source | 5a |
| `<!-- kb-draft:contradicts-self:[[page]] -->` | Pass 5a found a contradiction with a Mario position | 5a |
| `<!-- kb-draft:gap:no-wiki-page -->` | Pass 2 flagged a stake-bearing bullet with no wiki anchor | 2 |
| `<!-- kb-draft:voice-violation:banned-phrase:"<p>" -->` | Pass 5b found a banned phrase | 5b |
| `<!-- kb-draft:voice-match:move-<N> -->` | Pass 5b matched idiosyncratic move N | 5b |
| `<!-- kb-draft:voice-match:sample-<N> -->` | Pass 5b matched verbatim sample N | 5b |
| `<!-- kb-draft:voice-flag:generic -->` | Pass 5b flagged the sentence as slop-shaped | 5b |

---

## Frontmatter requirements per file (shared format)

Every staging file begins with a YAML frontmatter block delimited by `---` lines.

**All six files require these keys:**
- `pass:` — the literal pass number/name (`1`, `2`, `3`, `4`, `5a`, `5b`).
- `created:` — `YYYY-MM-DD` of the run.
- `mode:` — `outline | partial | spark | brain-dump`. Detected in pass 1; identical across all six files.
- `input:` — the input file path the runner received. Identical across all six files.

**Pass 5a additionally requires:**
- `claim-check-mode: conservative` (default) or `claim-check-mode: strict`.

**Pass 5b additionally requires:**
- `voice-profile: .claude/skills/kb-draft/voice-profile.md`.
- `runtime-samples-from:` — a YAML list of the 3 source-summary paths (lifted verbatim from `voice-profile.md`'s frontmatter).

The `pass:` field must be monotonically increasing 1 → 2 → 3 → 4 → 5a → 5b across the six files. The `mode:` and `input:` fields must be identical across all six.

---

## Final step: copy `05b-voice-pass.md` → `<slug>.draft.md`

After `05b-voice-pass.md` is written, copy it byte-for-byte (no edits, no re-frontmatter) to `.kb-draft-staging/<slug>/<slug>.draft.md`. This is the canonical final artifact. The two files MUST be byte-identical.

---

## Sanity gates before declaring done

Before returning the final summary to the orchestrator, verify:

1. All seven files exist under `.kb-draft-staging/<slug>/`: the six numbered staging files plus `<slug>.draft.md`.
2. No file contains a literal `<<<` token (un-substituted prompt placeholder).
3. Every `<!-- kb-draft:* -->` annotation in any staging file matches one of the 11 taxonomy kinds.
4. `04-draft.md`, `05a-claim-check.md`, `05b-voice-pass.md` body prose (HTML-comments stripped, whitespace normalized) are pairwise byte-identical.
5. Every `[[page]]` referenced in a `claim-source:` annotation in `04-draft.md` appears as a wikilink in `03-priors.md`.
6. `<slug>.draft.md` is byte-identical to `05b-voice-pass.md`.

If any gate fails, halt and write a `## Errors` section in the final-pass output describing the failure rather than silently shipping a broken artifact.

---

## Future primitives (sketch only — do not extract for this MVP)

These are reusable shapes that will be extracted after `/kb-triage` and `/kb-decide` exist. Listed here so the next prototype's author sees them:

- `outline-retrieval` — pass 2's "map bullets to wiki pages via index.md" prompt.
- `claim-by-claim retrieval` — pass 3's per-bullet supporting + counterargument extraction.
- `voice-pass` — pass 5b's cold-context critique against a static profile + runtime samples.
- `contradiction-pass` — pass 3 + pass 5a's contradiction-against-self detection.

Do not factor these out yet. The MVP is single-workflow.
