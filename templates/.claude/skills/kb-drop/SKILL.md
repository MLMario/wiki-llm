---
name: kb-drop
description: Add a URL, file, or inline note to the knowledge base raw/ inbox with proper YAML frontmatter. Use when the user asks to save, drop, add, capture, or archive a source (URL, file, article, paper, or typed note) to the KB.
---

# kb-drop

Drop a file or URL into the knowledge base `raw/` inbox with proper frontmatter. This is the intake gate for all new knowledge base content.

**Core invariant — verbatim ingress.** The source body must never enter Claude's context during a drop. HTML URLs are streamed verbatim from Jina Reader to disk by `curl`; local PDFs are converted by `utils/pdf_to_markdown.py`. Only small metadata lines (title, stderr status, filename) flow through Claude. This makes `raw/` the true source of truth — later ingest/query passes operate on verbatim content, not on a paraphrase.

## Input Parameters

The user provides ONE of the following:
- **A URL** — an HTML web page to fetch and save as markdown. **PDF URLs are rejected** (user must download and drop the local path).
- **A file path** — a local file to copy into raw/. PDFs are converted via `utils/pdf_to_markdown.py`.
- **Inline text** — content pasted or typed directly (treated as a note).

Optional user-provided parameters:
- **tags** — comma-separated tags to apply (e.g., "llm, karpathy, knowledge-management")
- **type override** — force a specific type (article, paper, note, misc) instead of auto-detection

## Workflow

### Step 1: Read reference/CONTEXT.md

Read `reference/CONTEXT.md` (in this skill's folder) to confirm the current schema and conventions are understood.

### Step 2: Route by input type

#### Branch A — URL input (starts with `http://` or `https://`)

**A.1 Reject PDF URLs (two-stage hard gate; no auto-download, no silent fallback).**

1. **Suffix check.** Strip any `?query` or `#fragment`. If the remaining URL path ends in `.pdf` (case-insensitive), abort before any network call and report:
   > "PDF URLs are not supported. Please download the PDF and drop the local path instead: `/kb-drop /path/to/file.pdf`."
2. **HEAD fallback.** Otherwise, issue a HEAD request:
   ```bash
   ctype=$(curl -sIL --max-time 30 -o /dev/null -w "%{content_type}" "<URL>")
   ```
   If `$ctype` begins with `application/pdf` (allow for trailing `; charset=...`), reject with the same message. If the HEAD request itself fails (network error, non-2xx final status), report the error and abort rather than proceeding without the gate.

**A.2 Classify and create target folder.**

URLs route to `raw/articles/` by default; use `raw/misc/` for non-content pages (tool homepages, repo READMEs, landing pages). Respect a user-supplied `type` override when given. **Papers are never auto-routed from URLs** — research PDFs reach the KB only via the local-file path.

```bash
mkdir -p knowledge-base/raw/articles
```

**A.3 Fetch via Jina Reader (direct-to-file; body never enters Claude's context).**

1. Pick a temp path inside the target folder:
   ```bash
   TMP="knowledge-base/raw/articles/.tmp-drop-$$.md"
   ```
2. Stream the Jina Reader response straight to disk:
   ```bash
   curl -sSL --fail --max-time 60 "https://r.jina.ai/<URL>" -o "$TMP"
   ```
3. If `curl` exits non-zero, or the file is smaller than 100 bytes, delete `$TMP` and abort with the Jina-failure message (see Error Handling).

Do not use the **Read** tool on `$TMP`. Do not use **WebFetch**. The body stays on disk until Step A.6 pipes it through Bash.

**A.4 Extract the title (Bash-only; one line to context).**

Jina Reader's response starts with a metadata preamble — line 1 is always `Title: <title>`, followed by `URL Source:`, `Published Time:`, an optional `Warning:` line (cached-snapshot advisory), then a `Markdown Content:` marker, then the actual page markdown (which may have its own H1).

```bash
head -1 "$TMP" | sed -E 's/^Title:[[:space:]]*//' | head -c 200
```
- If non-empty: that is the title.
- If line 1 did not start with `Title:` (Jina format drift or error page slipped past the size guard), try `head -20 "$TMP" | grep -m1 '^# '` to recover an H1 from the page body.
- If still empty: fall back to the URL's last non-empty path segment (prettified to spaces/title-case). Last resort: the URL hostname.

Keep the preamble in the raw file — it is verbatim Jina output and the `URL Source` / `Published Time` lines are useful provenance that downstream ingest can mine without re-fetching. Do not strip or reformat.

**A.5 Slug and rename.**

Apply the shared slug rule (see `reference/CONTEXT.md`): lowercase; letters, digits, and hyphens only; truncate to 60 chars; trim trailing hyphens.

Compose `YYYY-MM-DD-<slug>.md` where the date is today. Use **Glob** on `knowledge-base/raw/**/YYYY-MM-DD-<slug>.md` to check for collision; on collision append `-2`, then `-3`, etc.

```bash
FINAL="knowledge-base/raw/articles/YYYY-MM-DD-<slug>.md"
mv "$TMP" "$FINAL"
```

**A.6 Prepend frontmatter (Bash heredoc; body still never loaded).**

```bash
{
  printf -- '---\n'
  printf 'title: "%s"\n'          "$TITLE"
  printf 'source: "%s"\n'         "$URL"
  printf 'type: article\n'
  printf 'status: pending\n'
  printf 'dropped_date: %s\n'     "$TODAY"
  printf 'tags: %s\n'             "$TAGS_YAML"
  printf -- '---\n\n'
  cat "$FINAL"
} > "$FINAL.tmp" && mv "$FINAL.tmp" "$FINAL"
```
- `$TAGS_YAML` is `[]` when no tags, or `[tag1, tag2]` otherwise.
- Double-quote `$TITLE` and escape embedded double quotes (replace `"` with `\"`). Strip control characters if present.
- `cat "$FINAL"` streams the body through the shell pipe — it is never loaded into Claude's context.

#### Branch B — Local file path

Detection: input contains `/` or `\` and does not start with `http`. Verify the file exists; if not, report: "File not found at [path]. Please check the path and try again."

**B.1 PDFs (path ends in `.pdf`, case-insensitive).**

1. Derive slug from the PDF filename stem (shared slug rule). Compose:
   - `OUT_MD=knowledge-base/raw/papers/YYYY-MM-DD-<slug>.md`
   - `IMG_DIR=knowledge-base/raw/images/YYYY-MM-DD-<slug>`
2. Collision-check `OUT_MD` via Glob; append `-2`, `-3`, etc. as needed, and update `IMG_DIR` in lockstep so the image-subfolder slug always matches the markdown stem.
3. Ensure the target directory exists: `mkdir -p knowledge-base/raw/papers`.
4. Convert via the helper (Claude never Reads the PDF or the output markdown):
   ```bash
   python utils/pdf_to_markdown.py "<input.pdf>" "$OUT_MD" "$IMG_DIR"
   ```
   - The script writes the markdown to `$OUT_MD` and, if the PDF contains images, writes them under `$IMG_DIR` and rewrites markdown refs to `../images/<slug>/<file>.png`. If there are no images, the script removes the empty `$IMG_DIR`.
   - On non-zero exit: surface the script's stderr message to the user (e.g. "PDF yielded <100 bytes — likely scanned/image-only. OCR is out of scope."), delete `$OUT_MD` if partially written, and abort.
   - On success the script prints one stderr line (e.g. `OK: 42KB, 12 images`) and nothing on stdout. Quote the stderr line to the user in Step 5.
5. Extract title via Bash: `head -20 "$OUT_MD" | grep -m1 '^#\+ ' | sed -E 's/^#+[[:space:]]+//'`. (Matches H1, H2, or H3 — pymupdf4llm sometimes chooses H2 for the document title based on font-size heuristics.) If empty, fall back to the PDF filename stem (prettified to spaces/title-case).
6. Prepend frontmatter the same way as A.6, with `type: paper` and `source: "local"`.

**B.2 Non-PDF local files.**

The local file is already the source of truth; Read-based flow is acceptable here.

1. Use **Read** to load the file content.
2. Derive the title from the first `# heading`, or the filename stem if no heading exists.
3. Classify type: `note` for plain text/markdown, `misc` otherwise. Respect user overrides.
4. Set `source` to `"local"`.
5. Use **Write** to create `raw/<subdir>/YYYY-MM-DD-<slug>.md` with frontmatter + body in a single call.

#### Branch C — Inline text

Unchanged from prior behavior.

1. Use the text as-is for the content body.
2. Ask the user for a title, or derive one from the first line.
3. Set `source` to `"manual"`, `type` to `note`.
4. Use **Write** to create `raw/notes/YYYY-MM-DD-<slug>.md` with frontmatter + body in a single call.

### Step 3: Update log.md

1. Use **Read** to load `knowledge-base/log.md`.
2. Prepend a new entry immediately below the H1 heading:
   ```markdown
   ## [YYYY-MM-DD] drop | "[title]"
   - **File created:** raw/[subdir]/[filename]
   - **Source:** [URL or local or manual]
   - **Type:** [article|paper|note|misc]
   - **Status:** pending
   - **Tags:** [comma-separated tags or "none"]
   ```
3. Use **Write** to save the updated log.md.

### Step 4: Append to the KB ingest ledger (URL drops only)

If the input was a URL (`source` in frontmatter is the URL, not `"local"` or `"manual"`), append one line to `knowledge-base/ingested-urls.txt` containing only that URL followed by a newline.

1. Use **Read** to load `knowledge-base/ingested-urls.txt`. If the file does not exist, treat current contents as empty.
2. Append the URL as a new trailing line (ensure exactly one trailing newline; do not rewrite existing lines).
3. Use **Write** to save the updated ledger.

Rules:
- One URL per line, no leading/trailing whitespace, no blank lines between entries.
- Only write after the final raw file exists at the target path.
- Skip for local-file and inline-text drops.
- Do not deduplicate within this step — duplicates are tolerated by consumers.

### Step 5: Report to user

```
Dropped to knowledge base:
  File: knowledge-base/raw/[subdir]/[filename]
  Title: [title]
  Type: [type]
  Status: pending (run kb-ingest to process)
  Tags: [tags or none]
```

For local PDFs, also include the pymupdf4llm stderr status on its own line (e.g. `Converted: 42KB, 12 images`).

## Error Handling

- **PDF URL detected (suffix or HEAD).** Report: "PDF URLs are not supported. Please download the PDF and drop the local path instead: `/kb-drop /path/to/file.pdf`." No file written.
- **HEAD request fails (network error, timeout).** Treat as indeterminate — do NOT proceed without the gate. Report the error and abort.
- **Jina Reader fetch fails (curl non-zero) OR response <100 bytes.** Delete any partial temp file. Report: "Jina Reader could not extract content from that URL. Likely a JS-heavy/SPA page, rate limiting, or a dead link. Try again, or save the page as HTML/PDF locally and drop the local path."
- **`utils/pdf_to_markdown.py` exits non-zero.** Surface the script's stderr to the user and abort. Delete any partially written markdown.
- **`pymupdf4llm` not installed (script exit 3).** The script prints "ERROR: pymupdf4llm not installed. Run: pip install -r requirements.txt". Relay that to the user.
- **File path does not exist.** Report "File not found at [path]. Please check the path and try again."
- **log.md does not exist.** Create it with the initial H1 heading before prepending the first entry.
- **Title cannot be determined.** Fall back to URL last path segment → hostname → filename stem. Never leave the title empty.

## Frontmatter Schema Reference

### raw/ File Frontmatter

```yaml
---
title: "Descriptive title of the source"       # Required, string, quoted
source: "https://example.com/article-url"       # Required, string (URL, "local", or "manual")
type: article | paper | note | misc             # Required, enum
status: pending | ingested | skipped            # Required, enum (always "pending" on drop)
dropped_date: 2026-04-24                        # Required, YYYY-MM-DD (today)
tags: [tag1, tag2]                              # Optional, list of strings
---
```

The schema carries a single date field: `dropped_date` — the day kb-drop created the file. Publication-date extraction is deliberately out of scope because Jina output is not inspected by Claude and PDF conversion does not mine for a pub date.
