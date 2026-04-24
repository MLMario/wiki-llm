// path-safety.test.mjs — unit tests for src/path-safety.mjs.
// Built on node:test + node:assert/strict. Zero external deps.
//
// The module implements Guards 2 and 3 from design §4 (allowlist + path
// traversal validation). Coverage focuses on:
//   - isPackageZonePath returns true ONLY for the four hardcoded prefixes.
//   - isPackageZonePath never throws (returns false on weird inputs).
//   - validateTargetPath throws on every documented unsafe shape.
//   - validateTargetPath returns a resolved absolute path on success.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import path from 'node:path';

import { isPackageZonePath, validateTargetPath } from '../src/path-safety.mjs';

// Use a virtual repo root. validateTargetPath does not touch the fs, so the
// directory does not need to exist.
const REPO_ROOT = path.resolve('/tmp/fake-repo');

// ---------------------------------------------------------------------------
// isPackageZonePath — positives (every Package-zone prefix from design §3)
// ---------------------------------------------------------------------------

test('isPackageZonePath: .claude/skills/ deep file is package zone', () => {
  assert.equal(isPackageZonePath('.claude/skills/kb-drop/SKILL.md'), true);
});

test('isPackageZonePath: .claude/skills/ nested reference is package zone', () => {
  assert.equal(
    isPackageZonePath('.claude/skills/kb-drop/reference/CONTEXT.md'),
    true,
  );
});

test('isPackageZonePath: every kb-* skill is package zone', () => {
  for (const skill of ['kb-drop', 'kb-ingest', 'kb-resolve', 'kb-lint', 'kb-query']) {
    assert.equal(
      isPackageZonePath(`.claude/skills/${skill}/SKILL.md`),
      true,
      `expected .claude/skills/${skill}/SKILL.md to be package zone`,
    );
  }
});

test('isPackageZonePath: utils/ files are package zone', () => {
  assert.equal(isPackageZonePath('utils/pdf_to_markdown.py'), true);
  assert.equal(isPackageZonePath('utils/nested/dir/foo.py'), true);
});

test('isPackageZonePath: requirements.txt (exact) is package zone', () => {
  assert.equal(isPackageZonePath('requirements.txt'), true);
});

test('isPackageZonePath: knowledge-base/CONTEXT.md (exact) is package zone', () => {
  assert.equal(isPackageZonePath('knowledge-base/CONTEXT.md'), true);
});

// ---------------------------------------------------------------------------
// isPackageZonePath — negatives (Seed + User zones)
// ---------------------------------------------------------------------------

test('isPackageZonePath: Seed-zone CLAUDE.md is NOT package zone', () => {
  assert.equal(isPackageZonePath('CLAUDE.md'), false);
});

test('isPackageZonePath: Seed-zone README.md is NOT package zone', () => {
  assert.equal(isPackageZonePath('README.md'), false);
});

test('isPackageZonePath: Seed-zone .gitignore is NOT package zone', () => {
  assert.equal(isPackageZonePath('.gitignore'), false);
});

test('isPackageZonePath: Seed-zone .claude/settings.json is NOT package zone', () => {
  // settings.json sits inside .claude/ but NOT inside .claude/skills/.
  assert.equal(isPackageZonePath('.claude/settings.json'), false);
});

test('isPackageZonePath: Seed-zone knowledge-base/index.md is NOT package zone', () => {
  assert.equal(isPackageZonePath('knowledge-base/index.md'), false);
});

test('isPackageZonePath: Seed-zone knowledge-base/source_index.md is NOT package zone', () => {
  assert.equal(isPackageZonePath('knowledge-base/source_index.md'), false);
});

test('isPackageZonePath: Seed-zone knowledge-base/curriculum.md is NOT package zone', () => {
  assert.equal(isPackageZonePath('knowledge-base/curriculum.md'), false);
});

test('isPackageZonePath: User-zone knowledge-base/log.md is NOT package zone', () => {
  assert.equal(isPackageZonePath('knowledge-base/log.md'), false);
});

test('isPackageZonePath: User-zone knowledge-base/raw/* is NOT package zone', () => {
  // The plan's safety-negative list explicitly mentions
  // knowledge-base/raw/evil.md as something the updater must skip.
  assert.equal(isPackageZonePath('knowledge-base/raw/evil.md'), false);
  assert.equal(
    isPackageZonePath('knowledge-base/raw/notes/something.md'),
    false,
  );
});

test('isPackageZonePath: User-zone knowledge-base/wiki/* is NOT package zone', () => {
  assert.equal(
    isPackageZonePath('knowledge-base/wiki/concepts/mine.md'),
    false,
  );
  assert.equal(
    isPackageZonePath('knowledge-base/wiki/sources/x.md'),
    false,
  );
});

test('isPackageZonePath: User-zone .wiki-llm/backups/ is NOT package zone', () => {
  assert.equal(
    isPackageZonePath('.wiki-llm/backups/2026-04-24-100000/foo'),
    false,
  );
});

// ---------------------------------------------------------------------------
// isPackageZonePath — defensive rejections (returns false; never throws)
// ---------------------------------------------------------------------------

test('isPackageZonePath: empty string returns false (no throw)', () => {
  assert.equal(isPackageZonePath(''), false);
});

test('isPackageZonePath: null/undefined returns false (no throw)', () => {
  assert.equal(isPackageZonePath(null), false);
  assert.equal(isPackageZonePath(undefined), false);
});

test('isPackageZonePath: number returns false (no throw)', () => {
  assert.equal(isPackageZonePath(42), false);
});

test('isPackageZonePath: absolute path /etc/passwd returns false', () => {
  assert.equal(isPackageZonePath('/etc/passwd'), false);
});

test('isPackageZonePath: absolute path /utils/x.py returns false', () => {
  // Even if the path nominally matches the utils/ prefix once you strip the
  // leading slash, the leading slash is rejected up-front.
  assert.equal(isPackageZonePath('/utils/x.py'), false);
});

test('isPackageZonePath: ".." returns false', () => {
  assert.equal(isPackageZonePath('..'), false);
});

test('isPackageZonePath: "../escape" returns false', () => {
  assert.equal(isPackageZonePath('../escape'), false);
});

test('isPackageZonePath: ".claude/skills/../../evil" rejected via normalize', () => {
  // path.posix.normalize collapses the .. segments; the result no longer
  // matches the .claude/skills/ prefix or any other Package-zone entry.
  assert.equal(isPackageZonePath('.claude/skills/../../evil'), false);
});

test('isPackageZonePath: bare ".claude/skills/" prefix (no file) returns false', () => {
  // The implementation requires the path to be strictly longer than the
  // prefix (i.e. contain at least one file segment). The bare directory
  // path is not a file the updater would write.
  assert.equal(isPackageZonePath('.claude/skills/'), false);
});

test('isPackageZonePath: bare "utils/" prefix returns false', () => {
  assert.equal(isPackageZonePath('utils/'), false);
});

test('isPackageZonePath: backslashes rejected outright', () => {
  // The API is forward-slash-only; a Windows-style path slips through the
  // posix normalize otherwise. Belt-and-braces.
  assert.equal(isPackageZonePath('.claude\\skills\\kb-drop\\SKILL.md'), false);
});

test('isPackageZonePath: similar-but-not-allowed prefixes are rejected', () => {
  // Defensive checks that the allowlist does not have prefix-bug variants.
  assert.equal(isPackageZonePath('.claude/skills'), false); // no trailing /
  assert.equal(isPackageZonePath('.claude/skills.evil/x'), false);
  assert.equal(isPackageZonePath('utilsjunk/x.py'), false);
  assert.equal(isPackageZonePath('xrequirements.txt'), false);
  assert.equal(isPackageZonePath('requirements.txt.bak'), false);
});

// ---------------------------------------------------------------------------
// validateTargetPath — happy path
// ---------------------------------------------------------------------------

test('validateTargetPath: accepts utils/x.py', () => {
  const got = validateTargetPath('utils/pdf_to_markdown.py', REPO_ROOT);
  assert.equal(got, path.resolve(REPO_ROOT, 'utils', 'pdf_to_markdown.py'));
});

test('validateTargetPath: accepts deeply nested .claude/skills path', () => {
  const got = validateTargetPath(
    '.claude/skills/kb-drop/reference/CONTEXT.md',
    REPO_ROOT,
  );
  assert.equal(
    got,
    path.resolve(
      REPO_ROOT,
      '.claude',
      'skills',
      'kb-drop',
      'reference',
      'CONTEXT.md',
    ),
  );
});

test('validateTargetPath: accepts an exact-file allowlist entry', () => {
  // requirements.txt — a Package-zone exact-match path.
  const got = validateTargetPath('requirements.txt', REPO_ROOT);
  assert.equal(got, path.resolve(REPO_ROOT, 'requirements.txt'));
});

test('validateTargetPath: accepts a Seed-zone path (zone-agnostic)', () => {
  // validateTargetPath checks ONLY traversal safety, NOT zone allowlist.
  // Seed-zone paths must not throw (the caller's allowlist gate handles
  // zone separately).
  const got = validateTargetPath('CLAUDE.md', REPO_ROOT);
  assert.equal(got, path.resolve(REPO_ROOT, 'CLAUDE.md'));
});

test('validateTargetPath: result is an absolute path inside repoRoot', () => {
  const got = validateTargetPath('utils/x.py', REPO_ROOT);
  assert.equal(path.isAbsolute(got), true);
  // The resolved path's prefix matches repoRoot (with native separator).
  const sep = path.sep;
  assert.equal(
    got.startsWith(REPO_ROOT + sep) || got === REPO_ROOT,
    true,
    `expected ${got} to start with ${REPO_ROOT}${sep}`,
  );
});

// ---------------------------------------------------------------------------
// validateTargetPath — error paths
// ---------------------------------------------------------------------------

test('validateTargetPath: empty relPath rejected', () => {
  assert.throws(
    () => validateTargetPath('', REPO_ROOT),
    /relPath must be a non-empty string/,
  );
});

test('validateTargetPath: null relPath rejected', () => {
  assert.throws(
    () => validateTargetPath(null, REPO_ROOT),
    /relPath must be a non-empty string/,
  );
});

test('validateTargetPath: undefined relPath rejected', () => {
  assert.throws(
    () => validateTargetPath(undefined, REPO_ROOT),
    /relPath must be a non-empty string/,
  );
});

test('validateTargetPath: empty repoRoot rejected', () => {
  assert.throws(
    () => validateTargetPath('utils/x.py', ''),
    /repoRoot must be a non-empty string/,
  );
});

test('validateTargetPath: relative repoRoot rejected', () => {
  assert.throws(
    () => validateTargetPath('utils/x.py', 'not/absolute'),
    /repoRoot must be an absolute path/,
  );
});

test('validateTargetPath: absolute POSIX path rejected', () => {
  assert.throws(
    () => validateTargetPath('/etc/passwd', REPO_ROOT),
    /absolute paths are not allowed/,
  );
});

test('validateTargetPath: Windows drive-letter path rejected (C:/...)', () => {
  assert.throws(
    () => validateTargetPath('C:/Windows/System32/cmd.exe', REPO_ROOT),
    /drive-letter paths are not allowed/,
  );
});

test('validateTargetPath: lowercase Windows drive-letter rejected (c:/...)', () => {
  assert.throws(
    () => validateTargetPath('c:/foo', REPO_ROOT),
    /drive-letter paths are not allowed/,
  );
});

test('validateTargetPath: backslash rejected (Windows-style absolute path slipped)', () => {
  assert.throws(
    () => validateTargetPath('utils\\x.py', REPO_ROOT),
    /backslashes are not allowed/,
  );
});

test('validateTargetPath: ".." prefix rejected', () => {
  assert.throws(
    () => validateTargetPath('../escape.md', REPO_ROOT),
    /path traversal/,
  );
});

test('validateTargetPath: ".." mid-path rejected (resolves outside repoRoot)', () => {
  // utils/../../escape normalizes to ../escape — caught by the `..`
  // detector OR by the post-resolve outside-root check.
  assert.throws(
    () => validateTargetPath('utils/../../escape', REPO_ROOT),
    /traversal|outside/,
  );
});

test('validateTargetPath: ".." suffix that traverses out is rejected', () => {
  // `a/b/../..` normalizes to `.` (still inside repoRoot), but `a/../..`
  // normalizes to `..` and is rejected. The validator's `..` detection runs
  // on the post-normalize result — pre-normalize `..` segments are only
  // unsafe when they actually escape the root (or sit at a "/../" position).
  // Note: a single trailing `/..` like `utils/..` collapses to `.` and is
  // accepted as a no-op path resolving to repoRoot itself; the allowlist
  // gate (isPackageZonePath) refuses it separately as "not a Package-zone
  // file." This is intentional. See path-safety.mjs and the test below.
  assert.throws(
    () => validateTargetPath('utils/foo/../../..', REPO_ROOT),
    /traversal|outside/,
  );
});

test('validateTargetPath: "utils/.." (collapses to ".") does NOT throw', () => {
  // Documents (and locks in) current behavior: `utils/..` post-normalize is
  // `.`, which resolves to repoRoot itself. validateTargetPath treats this
  // as inside-the-root and returns repoRoot. The allowlist gate stops this
  // path being written to (it is not a Package-zone file). Reported as a
  // potential strictening target for Phase 5b's safety.test.mjs to consider.
  const got = validateTargetPath('utils/..', REPO_ROOT);
  assert.equal(got, path.resolve(REPO_ROOT));
});

test('validateTargetPath: bare ".." rejected', () => {
  assert.throws(
    () => validateTargetPath('..', REPO_ROOT),
    /traversal/,
  );
});

test('validateTargetPath: leading "//double-slash" rejected', () => {
  // path.posix.normalize collapses // to / — leaving an absolute-looking
  // path that the post-normalize leading-slash check catches.
  assert.throws(
    () => validateTargetPath('//a/b', REPO_ROOT),
    /absolute|absolute path/,
  );
});

// ---------------------------------------------------------------------------
// Plan-mandated negative cases (subset; full safety.test.mjs is Phase 5b)
// ---------------------------------------------------------------------------

test('plan §5 step 6: ../../escape.md rejected by validateTargetPath', () => {
  assert.throws(
    () => validateTargetPath('../../escape.md', REPO_ROOT),
    /traversal/,
  );
});

test('plan §5 step 6: /etc/passwd rejected by validateTargetPath', () => {
  assert.throws(
    () => validateTargetPath('/etc/passwd', REPO_ROOT),
    /absolute/,
  );
});

test('plan §5 step 6: knowledge-base/raw/evil.md is NOT in package zone (allowlist gate)', () => {
  // Validation will not throw on the path shape (it's a clean relative
  // path), but the allowlist check would refuse it. Phase 5b will verify
  // the orchestrator's combined refusal; here we lock in the allowlist half.
  assert.equal(isPackageZonePath('knowledge-base/raw/evil.md'), false);
  // And the path is structurally safe per validateTargetPath:
  const got = validateTargetPath('knowledge-base/raw/evil.md', REPO_ROOT);
  assert.equal(
    got,
    path.resolve(REPO_ROOT, 'knowledge-base', 'raw', 'evil.md'),
  );
});
