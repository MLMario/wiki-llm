// manifest.test.mjs — unit tests for src/manifest.mjs.
// Built on node:test + node:assert/strict. Zero external deps.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  manifestPath,
  readManifest,
  sha256,
  writeManifest,
} from '../src/manifest.mjs';

import { makeTempDir, sha256 as helperSha256 } from './helpers.mjs';

// ---------------------------------------------------------------------------
// sha256
// ---------------------------------------------------------------------------

test('sha256: empty buffer hashes to the canonical NIST vector', () => {
  // Per FIPS 180-4 / RFC 4634: SHA-256 of an empty input is
  // e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.
  assert.equal(
    sha256(Buffer.alloc(0)),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
});

test('sha256: known short input hashes correctly', () => {
  // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad.
  assert.equal(
    sha256(Buffer.from('abc', 'utf8')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('sha256: accepts a string directly (not just Buffer)', () => {
  // The Node createHash().update() API accepts strings, so production
  // callers may pass either. Lock in the equivalence.
  const stringHash = sha256('abc');
  const bufferHash = sha256(Buffer.from('abc', 'utf8'));
  assert.equal(stringHash, bufferHash);
});

test('sha256: matches the helper implementation byte-for-byte', () => {
  // Cross-check against the test helper (independent re-implementation).
  const sample = Buffer.from('a quick brown fox jumps over the lazy dog\n', 'utf8');
  assert.equal(sha256(sample), helperSha256(sample));
});

test('sha256: returns lowercase hex', () => {
  const out = sha256(Buffer.from('ABC', 'utf8'));
  assert.match(out, /^[0-9a-f]+$/);
  assert.equal(out.length, 64);
});

// ---------------------------------------------------------------------------
// manifestPath
// ---------------------------------------------------------------------------

test('manifestPath: joins repoRoot + .wiki-llm/manifest.json', () => {
  const root = path.resolve('/some/root');
  const expected = path.join(root, '.wiki-llm', 'manifest.json');
  assert.equal(manifestPath(root), expected);
});

test('manifestPath: returns a platform-native separator path', () => {
  // The implementation uses path.join (not path.posix.join), so the result
  // uses the platform's separator. We verify the basename irrespective of
  // platform.
  const result = manifestPath(path.resolve('/repo'));
  assert.equal(path.basename(result), 'manifest.json');
  assert.equal(path.basename(path.dirname(result)), '.wiki-llm');
});

// ---------------------------------------------------------------------------
// readManifest — happy path
// ---------------------------------------------------------------------------

test('readManifest: parses a well-formed manifest', () => {
  const tmp = makeTempDir('readManifest-happy');
  try {
    const content = {
      manifestVersion: 1,
      packageVersion: '0.0.0',
      files: {
        'a.md': { sha256: 'aaa', templated: false },
      },
    };
    const dir = path.join(tmp.path, '.wiki-llm');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify(content, null, 2) + '\n',
      'utf8',
    );
    const got = readManifest(tmp.path);
    assert.deepEqual(got, content);
  } finally {
    tmp.cleanup();
  }
});

// ---------------------------------------------------------------------------
// readManifest — error paths
// ---------------------------------------------------------------------------

test('readManifest: missing file throws "Manifest not found"', () => {
  const tmp = makeTempDir('readManifest-missing');
  try {
    assert.throws(
      () => readManifest(tmp.path),
      /Manifest not found at .*manifest\.json — this does not look like a wiki-llm repo\./,
    );
  } finally {
    tmp.cleanup();
  }
});

test('readManifest: malformed JSON throws "is not valid JSON"', () => {
  const tmp = makeTempDir('readManifest-badjson');
  try {
    const dir = path.join(tmp.path, '.wiki-llm');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'manifest.json'), '{ this is not json', 'utf8');
    assert.throws(
      () => readManifest(tmp.path),
      /is not valid JSON/,
    );
  } finally {
    tmp.cleanup();
  }
});

test('readManifest: array root rejected (object required)', () => {
  const tmp = makeTempDir('readManifest-array');
  try {
    const dir = path.join(tmp.path, '.wiki-llm');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'manifest.json'), '[1, 2, 3]\n', 'utf8');
    assert.throws(
      () => readManifest(tmp.path),
      /is not a JSON object/,
    );
  } finally {
    tmp.cleanup();
  }
});

test('readManifest: null root rejected', () => {
  const tmp = makeTempDir('readManifest-null');
  try {
    const dir = path.join(tmp.path, '.wiki-llm');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'manifest.json'), 'null\n', 'utf8');
    assert.throws(
      () => readManifest(tmp.path),
      /is not a JSON object/,
    );
  } finally {
    tmp.cleanup();
  }
});

test('readManifest: missing manifestVersion rejected (treated as unsupported)', () => {
  const tmp = makeTempDir('readManifest-noversion');
  try {
    const dir = path.join(tmp.path, '.wiki-llm');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ packageVersion: '0.0.0', files: {} }) + '\n',
      'utf8',
    );
    // manifestVersion is undefined → JSON.stringify(undefined) = 'undefined'
    // in the error message. The reader checks `parsed.manifestVersion !== 1`.
    assert.throws(
      () => readManifest(tmp.path),
      /Unsupported manifestVersion/,
    );
  } finally {
    tmp.cleanup();
  }
});

test('readManifest: manifestVersion=2 rejected with version-aware message', () => {
  const tmp = makeTempDir('readManifest-v2');
  try {
    const dir = path.join(tmp.path, '.wiki-llm');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ manifestVersion: 2, packageVersion: '0.0.0', files: {} }) + '\n',
      'utf8',
    );
    assert.throws(
      () => readManifest(tmp.path),
      /Unsupported manifestVersion 2.*This CLI understands manifestVersion 1\./s,
    );
  } finally {
    tmp.cleanup();
  }
});

test('readManifest: manifestVersion as a string ("1") rejected (strict equality)', () => {
  // Sanity check: the validator uses strict equality. A stringly-typed "1"
  // must not be accepted; the manifest schema is integer-typed.
  const tmp = makeTempDir('readManifest-strversion');
  try {
    const dir = path.join(tmp.path, '.wiki-llm');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ manifestVersion: '1', packageVersion: '0.0.0', files: {} }) + '\n',
      'utf8',
    );
    assert.throws(
      () => readManifest(tmp.path),
      /Unsupported manifestVersion/,
    );
  } finally {
    tmp.cleanup();
  }
});

// ---------------------------------------------------------------------------
// writeManifest
// ---------------------------------------------------------------------------

test('writeManifest: writes valid JSON with 2-space indent and trailing LF', () => {
  const tmp = makeTempDir('writeManifest-indent');
  try {
    const m = {
      manifestVersion: 1,
      packageVersion: '0.0.0',
      files: { 'a.md': { sha256: 'aaa', templated: false } },
    };
    writeManifest(tmp.path, m);
    const raw = readFileSync(manifestPath(tmp.path), 'utf8');
    assert.equal(raw.endsWith('\n'), true, 'trailing newline');
    assert.equal(raw.includes('\r'), false, 'no CR (LF-only)');
    // Indent check: every nested key starts on a line beginning with 2 spaces.
    assert.match(raw, /\n  "manifestVersion": 1,/);
    assert.match(raw, /\n  "files": \{/);
    assert.match(raw, /\n    "a\.md": \{/);
  } finally {
    tmp.cleanup();
  }
});

test('writeManifest: round-trips through readManifest', () => {
  const tmp = makeTempDir('writeManifest-roundtrip');
  try {
    const m = {
      manifestVersion: 1,
      packageVersion: '1.2.3',
      scaffoldedAt: '2026-04-24T00:00:00.000Z',
      lastUpdatedAt: null,
      files: {
        'utils/x.py': { sha256: 'a'.repeat(64), templated: false },
        'requirements.txt': { sha256: 'b'.repeat(64), templated: false },
      },
    };
    writeManifest(tmp.path, m);
    const got = readManifest(tmp.path);
    assert.deepEqual(got, m);
  } finally {
    tmp.cleanup();
  }
});

test('writeManifest: leaves no `.tmp` file behind (rename, not copy)', () => {
  const tmp = makeTempDir('writeManifest-tmp');
  try {
    writeManifest(tmp.path, { manifestVersion: 1, packageVersion: '0', files: {} });
    const dir = path.join(tmp.path, '.wiki-llm');
    const entries = readdirSync(dir);
    assert.deepEqual(entries.sort(), ['manifest.json']);
    assert.equal(existsSync(path.join(dir, 'manifest.json.tmp')), false);
  } finally {
    tmp.cleanup();
  }
});

test('writeManifest: creates .wiki-llm/ directory if absent', () => {
  const tmp = makeTempDir('writeManifest-mkdir');
  try {
    // Confirm the dir does not pre-exist.
    assert.equal(existsSync(path.join(tmp.path, '.wiki-llm')), false);
    writeManifest(tmp.path, { manifestVersion: 1, packageVersion: '0', files: {} });
    assert.equal(existsSync(path.join(tmp.path, '.wiki-llm', 'manifest.json')), true);
  } finally {
    tmp.cleanup();
  }
});

test('writeManifest: overwrites an existing manifest atomically', () => {
  const tmp = makeTempDir('writeManifest-overwrite');
  try {
    writeManifest(tmp.path, { manifestVersion: 1, packageVersion: '0', files: {} });
    const m2 = {
      manifestVersion: 1,
      packageVersion: '1.0.0',
      files: { 'a.md': { sha256: 'a'.repeat(64), templated: false } },
    };
    writeManifest(tmp.path, m2);
    const got = readManifest(tmp.path);
    assert.deepEqual(got, m2);
  } finally {
    tmp.cleanup();
  }
});
