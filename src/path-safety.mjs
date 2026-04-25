// path-safety.mjs — zone allowlist + path-traversal validation.
// Pure functions, no fs, no side effects. Node built-ins only.
//
// Implements Guards 2 and 3 from the design spec's §4 "Safety guarantees":
//   - Guard 2: hardcoded Package-zone allowlist (this module is the code; the
//     manifest is data — a malicious manifest cannot reach past this list).
//   - Guard 3: path-traversal validation (reject absolute / `..`-escaping /
//     outside-root paths).
//
// All public interfaces use POSIX-style relative paths (forward slashes).

import path from 'node:path';

/**
 * Hardcoded Package-zone prefixes per design §3 "File zones". These are the
 * ONLY paths the updater is permitted to write to inside a scaffolded repo.
 * Anything outside this list is silently skipped during planning.
 *
 * Two prefix shapes exist:
 *   - Directory-prefix entries end with `/` and match any descendant path.
 *   - Exact-file entries have no trailing slash and must match the whole path.
 *
 * Paths must already be normalized POSIX-style (forward slashes) before this
 * list is consulted. Callers should pass `validateTargetPath` output or
 * manifest keys directly.
 */
const PACKAGE_ZONE_PREFIXES = Object.freeze([
  '.claude/skills/',
  'utils/',
]);

const PACKAGE_ZONE_EXACT_FILES = Object.freeze([
  'requirements.txt',
  'knowledge-base/CONTEXT.md',
]);

/**
 * Return true iff `relPath` (a POSIX-style relative path) lies within the
 * hardcoded Package zone.
 *
 * Defense-in-depth: the path is normalized via `path.posix.normalize` before
 * the allowlist check, then rejected if normalization introduces any leading
 * `..` segment, any absolute anchor, or otherwise fails to remain a simple
 * relative path. This prevents clever inputs like `.claude/skills/../../evil`
 * or `.claude/skills/` with a Windows-style `\\` separator from slipping
 * through.
 *
 * Returns a strict boolean. Never throws.
 *
 * @param {string} relPath - POSIX-style relative path (forward slashes only).
 * @returns {boolean}
 */
export function isPackageZonePath(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) return false;

  // Reject backslashes outright — API contract is forward-slash-only. A
  // caller passing `C:\foo\bar` should not accidentally slip through.
  if (relPath.includes('\\')) return false;

  // Normalize using the POSIX flavor so the check is platform-independent.
  const normalized = path.posix.normalize(relPath);

  // Reject absolute paths (leading `/`), root-escaping (`..` segment after
  // normalize), and empty / dot-only results.
  if (normalized.startsWith('/')) return false;
  if (normalized === '' || normalized === '.' || normalized === '..') return false;
  if (normalized.startsWith('../') || normalized === '..') return false;

  for (const prefix of PACKAGE_ZONE_PREFIXES) {
    if (normalized.startsWith(prefix) && normalized.length > prefix.length) {
      return true;
    }
  }
  for (const exact of PACKAGE_ZONE_EXACT_FILES) {
    if (normalized === exact) return true;
  }
  return false;
}

/**
 * Validate that `relPath` is a safe target inside `repoRoot`. Throws with a
 * descriptive message on any violation; returns the resolved absolute path on
 * success. This is Guard 3.
 *
 * Rejects:
 *   - absolute paths (POSIX `/foo`, Windows `C:\foo` or `\\server\share`)
 *   - paths containing `..` after normalization (POSIX-style check)
 *   - paths that resolve outside `repoRoot` (final belt-and-braces check)
 *
 * The caller passes a POSIX-style relative path and an absolute `repoRoot`
 * (native path separators are fine for `repoRoot`). The returned absolute
 * path uses the platform's native separators and is safe to pass to fs.
 *
 * @param {string} relPath   POSIX-style relative path (forward slashes).
 * @param {string} repoRoot  Absolute path to the scaffolded repo root.
 * @returns {string}         Absolute path of `relPath` inside `repoRoot`.
 * @throws {Error}           If any safety rule fails.
 */
export function validateTargetPath(relPath, repoRoot) {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new Error('validateTargetPath: relPath must be a non-empty string');
  }
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
    throw new Error('validateTargetPath: repoRoot must be a non-empty string');
  }
  if (!path.isAbsolute(repoRoot)) {
    throw new Error(
      `validateTargetPath: repoRoot must be an absolute path (got ${JSON.stringify(repoRoot)})`,
    );
  }

  // Contract: relPath is POSIX-style. A backslash implies either a Windows
  // absolute path or a caller that ignored the contract — either way we
  // refuse.
  if (relPath.includes('\\')) {
    throw new Error(
      `Unsafe path ${JSON.stringify(relPath)}: backslashes are not allowed in target paths (use forward slashes).`,
    );
  }

  // Reject absolute POSIX paths.
  if (relPath.startsWith('/')) {
    throw new Error(
      `Unsafe path ${JSON.stringify(relPath)}: absolute paths are not allowed.`,
    );
  }

  // Reject Windows-style drive-letter absolutes like `C:/foo` that would slip
  // past the leading-slash check (e.g. `C:/Windows/System32/...`).
  if (/^[A-Za-z]:/.test(relPath)) {
    throw new Error(
      `Unsafe path ${JSON.stringify(relPath)}: drive-letter paths are not allowed.`,
    );
  }

  // Normalize POSIX-style and reject if any `..` survives.
  const normalized = path.posix.normalize(relPath);
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    normalized.endsWith('/..')
  ) {
    throw new Error(
      `Unsafe path ${JSON.stringify(relPath)}: path traversal ("..") is not allowed.`,
    );
  }

  // Defense-in-depth (Phase 5b strengthening). Inputs like `utils/..`, `.`,
  // or `./` collapse to repo root after normalization (`path.posix.normalize`
  // yields `'.'` or `'./'` respectively). Without this check,
  // validateTargetPath would happily return the repoRoot as a writable path.
  // The Package-zone allowlist (Guard 2) is the real gate — none of these
  // collapse-to-root paths sit inside it — but surface-level rejection is
  // cheaper than relying on a downstream guard. See test/path-safety.test.mjs
  // for the locked-in negatives.
  if (normalized === '' || normalized === '.' || normalized === './') {
    throw new Error(
      `Unsafe path ${JSON.stringify(relPath)}: collapses to repository root after normalization.`,
    );
  }

  // Reject leading-slash after normalize (shouldn't happen after earlier
  // check, but belt-and-braces for cases like `//a/b`).
  if (normalized.startsWith('/')) {
    throw new Error(
      `Unsafe path ${JSON.stringify(relPath)}: resolved to an absolute path after normalization.`,
    );
  }

  // Final check: resolved absolute path must sit inside repoRoot.
  const resolvedRoot = path.resolve(repoRoot);
  const resolvedTarget = path.resolve(resolvedRoot, ...normalized.split('/'));
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;

  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(rootWithSep)) {
    throw new Error(
      `Unsafe path ${JSON.stringify(relPath)}: resolves outside repoRoot ${JSON.stringify(repoRoot)}.`,
    );
  }

  return resolvedTarget;
}
