#!/usr/bin/env python3
"""PDF -> markdown converter for kb-drop.

Usage:
    python utils/pdf_to_markdown.py <input.pdf> <output.md> <images_dir>

Contract:
- Writes verbatim PDF text as markdown to <output.md>.
- Writes extracted images into <images_dir> only if the PDF contains any;
  the directory is removed if empty on success.
- Markdown image references are rewritten to the relative form
  `../images/<basename(images_dir)>/<filename>` so kb-drop can place the
  markdown under raw/papers/ while images live under raw/images/<slug>/.
- Exits 0 on success and prints a one-line status to stderr
  (e.g. "OK: 42KB, 12 images" or "OK: 8KB, no images").
- Exits nonzero with a stderr warning if the PDF yields <100 bytes of text
  (likely a scanned/image-only PDF; OCR is out of scope).
- Produces nothing on stdout.
"""

import sys
from pathlib import Path


USAGE = "Usage: pdf_to_markdown.py <input.pdf> <output.md> <images_dir>"
MIN_TEXT_BYTES = 100


def main() -> int:
    if len(sys.argv) != 4:
        print(USAGE, file=sys.stderr)
        return 2

    input_pdf = Path(sys.argv[1])
    output_md = Path(sys.argv[2])
    images_dir = Path(sys.argv[3])

    if not input_pdf.is_file():
        print(f"ERROR: input file not found: {input_pdf}", file=sys.stderr)
        return 2

    try:
        import pymupdf4llm
    except ImportError:
        print(
            "ERROR: pymupdf4llm not installed. Run: pip install -r requirements.txt",
            file=sys.stderr,
        )
        return 3

    images_dir.mkdir(parents=True, exist_ok=True)

    try:
        md = pymupdf4llm.to_markdown(
            str(input_pdf),
            write_images=True,
            image_path=str(images_dir),
            image_format="png",
        )
    except Exception as exc:
        _rmdir_if_empty(images_dir)
        print(f"ERROR: pymupdf4llm failed: {exc}", file=sys.stderr)
        return 1

    image_files = [p for p in images_dir.iterdir() if p.is_file()]
    num_images = len(image_files)

    if len(md.encode("utf-8")) < MIN_TEXT_BYTES:
        if num_images == 0:
            _rmdir_if_empty(images_dir)
        print(
            "ERROR: PDF yielded <100 bytes of text -- likely scanned/image-only. "
            "OCR is out of scope.",
            file=sys.stderr,
        )
        return 1

    slug = images_dir.name
    md = _rewrite_image_paths(md, images_dir, slug)

    output_md.parent.mkdir(parents=True, exist_ok=True)
    output_md.write_text(md, encoding="utf-8")

    if num_images == 0:
        _rmdir_if_empty(images_dir)

    size_kb = max(1, output_md.stat().st_size // 1024)
    if num_images > 0:
        print(f"OK: {size_kb}KB, {num_images} images", file=sys.stderr)
    else:
        print(f"OK: {size_kb}KB, no images", file=sys.stderr)
    return 0


def _rewrite_image_paths(md: str, images_dir: Path, slug: str) -> str:
    """Replace any path-prefix pointing at images_dir with `../images/<slug>`.

    pymupdf4llm emits image refs using `image_path` as the prefix. kb-drop places
    the markdown under `raw/papers/` and images under `raw/images/<slug>/`, so the
    markdown needs to reach images via `../images/<slug>/<filename>`.
    """
    abs_posix = images_dir.resolve().as_posix()
    abs_native = str(images_dir.resolve())
    raw_posix = str(images_dir).replace("\\", "/")
    raw_native = str(images_dir)
    target = f"../images/{slug}"
    for prefix in (abs_posix, abs_native, raw_posix, raw_native):
        md = md.replace(prefix, target)
    return md


def _rmdir_if_empty(path: Path) -> None:
    try:
        path.rmdir()
    except OSError:
        pass


if __name__ == "__main__":
    sys.exit(main())
