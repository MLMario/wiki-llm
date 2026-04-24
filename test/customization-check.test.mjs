// customization-check.test.mjs — unit tests for src/customization-check.mjs.
// Built on node:test + node:assert/strict. Zero external deps.
//
// The classifier is the heart of Guard 1 ("--force only bypasses the
// customization conflict refusal, nothing else"). Every branch is covered.
//
// Edge-case decision (Phase 5a — option A, "short-circuit disk===new"):
//   When old !== new but disk === new, the on-disk bytes already match the
//   target. Returning 'unchanged' lets the updater skip the file silently
//   without requiring --force. Rationale: design §3 step 4 spells out the
//   classifier's purpose as preserving user customizations; a byte-match
//   against the new version is a no-op overwrite, not a customization that
//   needs preserving. Locked in by the dedicated edge-case test below.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyFile } from '../src/customization-check.mjs';

// ---------------------------------------------------------------------------
// Manifest fixtures used across most tests.
// ---------------------------------------------------------------------------

/** Old manifest with four entries: a/b/c/d. */
const OLD = Object.freeze({
  files: {
    'a.md': { sha256: 'aaa', templated: false },
    'b.md': { sha256: 'bbb', templated: false },
    'c.md': { sha256: 'ccc', templated: false },
    'd.md': { sha256: 'ddd', templated: false },
  },
});

/** New manifest: a removed; b unchanged; c content-changed; d content-changed; e added. */
const NEW = Object.freeze({
  files: {
    // a.md absent (removed)
    'b.md': { sha256: 'bbb', templated: false },
    'c.md': { sha256: 'ccc2', templated: false },
    'd.md': { sha256: 'ddd2', templated: false },
    'e.md': { sha256: 'eee', templated: false },
  },
});

// ---------------------------------------------------------------------------
// Five canonical return values (one test per disposition).
// ---------------------------------------------------------------------------

test('classifyFile: file only in NEW manifest → "added"', () => {
  // No diskSha is required for added — caller has nothing to compare.
  assert.equal(classifyFile('e.md', OLD, NEW, undefined), 'added');
});

test('classifyFile: file only in OLD manifest → "removed"', () => {
  assert.equal(classifyFile('a.md', OLD, NEW, undefined), 'removed');
});

test('classifyFile: file in both with same sha → "unchanged"', () => {
  assert.equal(classifyFile('b.md', OLD, NEW, 'bbb'), 'unchanged');
});

test('classifyFile: file in both, sha differs, disk matches old → "overwrite-clean"', () => {
  // User has not touched the file — the on-disk bytes match what was
  // shipped at scaffold time. Safe to overwrite without --force.
  assert.equal(classifyFile('c.md', OLD, NEW, 'ccc'), 'overwrite-clean');
});

test('classifyFile: file in both, sha differs, disk differs from old AND new → "overwrite-customized"', () => {
  // Classic customization: user edited the file, and their bytes match
  // neither the original nor the new shipped version. Requires --force.
  assert.equal(classifyFile('d.md', OLD, NEW, 'user-bytes'), 'overwrite-customized');
});

// ---------------------------------------------------------------------------
// Edge case — the carryover decision (option A: short-circuit disk===new).
// ---------------------------------------------------------------------------

test('classifyFile: edge case "disk === new" → "unchanged" (option A, design §3 step 4)', () => {
  // Decision (Phase 5a, option A — see report):
  //   When old !== new but the on-disk bytes already match the new shipped
  //   sha, the file is at its target state. Nothing for the updater to do;
  //   nothing for the user to preserve. The classifier returns 'unchanged'
  //   to skip cleanly. This avoids forcing the user to pass --force for a
  //   byte-level no-op overwrite.
  //
  // The opposing option (B, "codify current behavior") would return
  //   'overwrite-customized' here. We rejected it because the design intent
  //   of Guard 1 is "don't overwrite user edits"; with disk === new, there
  //   is no user edit being preserved. See the inline comment in
  //   src/customization-check.mjs near the decision site.
  //
  // Lock-in: any future regression that flips this back to
  //   'overwrite-customized' (or any other value) will fail this test.
  assert.equal(
    classifyFile('d.md', OLD, NEW, 'ddd2'),
    'unchanged',
    'disk matches new → unchanged (option A short-circuit)',
  );
});

// ---------------------------------------------------------------------------
// `removed` / `added` short-circuit before sha checks.
// ---------------------------------------------------------------------------

test('classifyFile: `removed` does not require diskSha or string sha entries', () => {
  // The path is in OLD only; no sha comparison happens.
  // Pass null diskSha and verify we do not throw.
  assert.equal(classifyFile('a.md', OLD, NEW, null), 'removed');
});

test('classifyFile: `added` does not require diskSha', () => {
  assert.equal(classifyFile('e.md', OLD, NEW, null), 'added');
});

// ---------------------------------------------------------------------------
// Throw paths.
// ---------------------------------------------------------------------------

test('classifyFile: path in NEITHER manifest throws "unreachable"', () => {
  // The caller's union-of-manifests walk should never hand us a path that
  // is in neither manifest. If it does, that's a bug — fail loudly.
  assert.throws(
    () => classifyFile('z.md', OLD, NEW, undefined),
    /unreachable.*classifyFile called with path in neither manifest/,
  );
});

test('classifyFile: diskSha missing when old/new shas differ throws (required)', () => {
  // c.md has differing shas in OLD vs NEW; without diskSha the classifier
  // cannot decide between overwrite-clean / overwrite-customized.
  assert.throws(
    () => classifyFile('c.md', OLD, NEW, undefined),
    /diskSha required when old\/new shas differ for "c\.md"/,
  );
});

test('classifyFile: diskSha empty string is treated as missing → throws', () => {
  assert.throws(
    () => classifyFile('c.md', OLD, NEW, ''),
    /diskSha required/,
  );
});

test('classifyFile: diskSha non-string (number) treated as missing → throws', () => {
  assert.throws(
    () => classifyFile('c.md', OLD, NEW, 0),
    /diskSha required/,
  );
});

// ---------------------------------------------------------------------------
// Argument validation (relPath, manifest shape).
// ---------------------------------------------------------------------------

test('classifyFile: empty relPath rejected', () => {
  assert.throws(
    () => classifyFile('', OLD, NEW, undefined),
    /relPath must be a non-empty string/,
  );
});

test('classifyFile: null relPath rejected', () => {
  assert.throws(
    () => classifyFile(null, OLD, NEW, undefined),
    /relPath must be a non-empty string/,
  );
});

test('classifyFile: non-string relPath (number) rejected', () => {
  assert.throws(
    () => classifyFile(123, OLD, NEW, undefined),
    /relPath must be a non-empty string/,
  );
});

test('classifyFile: missing oldManifest rejected', () => {
  assert.throws(
    () => classifyFile('a.md', null, NEW, undefined),
    /oldManifest must be an object with a \.files map/,
  );
});

test('classifyFile: oldManifest without .files rejected', () => {
  assert.throws(
    () => classifyFile('a.md', { manifestVersion: 1 }, NEW, undefined),
    /oldManifest must be an object with a \.files map/,
  );
});

test('classifyFile: missing newManifest rejected', () => {
  assert.throws(
    () => classifyFile('a.md', OLD, null, undefined),
    /newManifest must be an object with a \.files map/,
  );
});

test('classifyFile: newManifest without .files rejected', () => {
  assert.throws(
    () => classifyFile('a.md', OLD, { manifestVersion: 1 }, undefined),
    /newManifest must be an object with a \.files map/,
  );
});

// ---------------------------------------------------------------------------
// Manifest entry shape violations.
// ---------------------------------------------------------------------------

test('classifyFile: non-string old.sha256 rejected (when both manifests have entry)', () => {
  const badOld = {
    files: {
      'x.md': { sha256: 12345, templated: false },
    },
  };
  const goodNew = {
    files: {
      'x.md': { sha256: 'newsha', templated: false },
    },
  };
  assert.throws(
    () => classifyFile('x.md', badOld, goodNew, 'something'),
    /must have string \.sha256 fields/,
  );
});

test('classifyFile: non-string new.sha256 rejected', () => {
  const goodOld = {
    files: { 'x.md': { sha256: 'oldsha', templated: false } },
  };
  const badNew = {
    files: { 'x.md': { sha256: null, templated: false } },
  };
  assert.throws(
    () => classifyFile('x.md', goodOld, badNew, 'something'),
    /must have string \.sha256 fields/,
  );
});

test('classifyFile: missing sha256 field on shared entry rejected', () => {
  const oldNo = {
    files: { 'x.md': { templated: false } },
  };
  const newOk = {
    files: { 'x.md': { sha256: 'newsha', templated: false } },
  };
  assert.throws(
    () => classifyFile('x.md', oldNo, newOk, 'whatever'),
    /must have string \.sha256 fields/,
  );
});

// ---------------------------------------------------------------------------
// Sanity: `unchanged` short-circuits BEFORE the diskSha requirement check.
// ---------------------------------------------------------------------------

test('classifyFile: `unchanged` returns even if diskSha is missing (no requirement)', () => {
  // When old.sha === new.sha, the diskSha argument is irrelevant; passing
  // undefined must not throw because the classifier short-circuits before
  // the diskSha check.
  assert.equal(classifyFile('b.md', OLD, NEW, undefined), 'unchanged');
});
