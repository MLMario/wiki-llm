// helpers.mjs — shared test utilities for the wiki-llm test suite.
// Used by both unit tests under test/*.test.mjs (Phase 5a) and integration
// tests Phase 5b will add. Node built-ins only.
//
// Exports (see per-function docs below):
//   - makeTempDir(prefix?)            -> { path, cleanup }
//   - loadFixture(relPath)            -> Buffer (test/fixtures/<relPath>)
//   - sha256(buffer)                  -> hex string
//   - writeTreeOfFiles(root, tree)    -> void  (string -> Buffer | string)
//   - fingerprintTree(root)           -> Map<posixRel, sha256>
//   - diffFingerprints(a, b)          -> { added, removed, changed }
//   - buildTarball({ files, name?, version?, gzip? }) -> Buffer
//   - fakeFetch(urlToBuffer)          -> async (url) => Buffer
//
// All path-keyed APIs use POSIX (forward-slash) keys to mirror production
// code conventions (manifest keys, tarball entries).

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

// ---------------------------------------------------------------------------
// Tempdirs.
// ---------------------------------------------------------------------------

/**
 * Create a fresh temporary directory under `os.tmpdir()` with a stable prefix
 * (`wiki-llm-test-<prefix>-`). Returns the absolute `path` and a `cleanup`
 * function that idempotently `rm -rf`s the directory.
 *
 * Use in `try / finally` or `before / after` hooks so leaked dirs cannot
 * accumulate. Cleanup swallows ENOENT (idempotent) but rethrows other errors.
 *
 * @param {string} [prefix='generic']
 * @returns {{ path: string, cleanup: () => void }}
 */
export function makeTempDir(prefix = 'generic') {
  const safePrefix = String(prefix).replace(/[^A-Za-z0-9._-]/g, '_');
  const root = mkdtempSync(path.join(os.tmpdir(), `wiki-llm-test-${safePrefix}-`));
  let cleaned = false;
  return {
    path: root,
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      try {
        rmSync(root, { recursive: true, force: true });
      } catch (err) {
        if (err && err.code === 'ENOENT') return;
        throw err;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

/**
 * Read a fixture file from `test/fixtures/<relPath>` as a Buffer. Throws if
 * the file is missing — fixtures are checked into the repo, so absence is a
 * test bug, not a runtime condition.
 *
 * Phase 5a does not introduce any fixtures (pure-function unit tests do not
 * need them); this helper exists so Phase 5b's integration suite can use it
 * without re-inventing the path math.
 *
 * @param {string} relPath  POSIX-style path under `test/fixtures/`.
 * @returns {Buffer}
 */
export function loadFixture(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new Error('loadFixture: relPath must be a non-empty string');
  }
  if (relPath.startsWith('/') || relPath.includes('..')) {
    throw new Error(`loadFixture: refusing unsafe relPath ${JSON.stringify(relPath)}`);
  }
  const abs = path.join(FIXTURES_DIR, ...relPath.split('/'));
  return readFileSync(abs);
}

// ---------------------------------------------------------------------------
// Hashing + tree fingerprints.
// ---------------------------------------------------------------------------

/**
 * Lowercase-hex sha256 of a Buffer or string. Mirrors the production helper
 * in src/manifest.mjs but is duplicated here so unit tests of that module
 * have an independent reference implementation.
 *
 * @param {Buffer|string} buffer
 * @returns {string}
 */
export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Walk `root` recursively and return entries sorted by POSIX-relative path.
 * Used internally by fingerprintTree and exported indirectly via that.
 *
 * @param {string} root
 * @returns {Array<{ posixRel: string, abs: string }>}
 */
function walkTree(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur);
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      throw err;
    }
    for (const name of entries) {
      const abs = path.join(cur, name);
      const st = statSync(abs);
      if (st.isDirectory()) stack.push(abs);
      else if (st.isFile()) {
        const rel = path.relative(root, abs).split(path.sep).join('/');
        out.push({ posixRel: rel, abs });
      }
    }
  }
  out.sort((a, b) => (a.posixRel < b.posixRel ? -1 : a.posixRel > b.posixRel ? 1 : 0));
  return out;
}

/**
 * Materialize an in-memory tree of files at `root`. The `tree` argument maps
 * POSIX-style relative paths to either Buffers (raw bytes) or strings
 * (written as UTF-8). Parent directories are created on demand.
 *
 * Useful for unit tests that need a real on-disk file (e.g., manifest write
 * round-trips, sha256 of a known file). Path safety is enforced — relative
 * keys only, no `..`.
 *
 * @param {string} root
 * @param {Record<string, Buffer|string>} tree
 */
export function writeTreeOfFiles(root, tree) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw new Error('writeTreeOfFiles: root must be an absolute path');
  }
  if (!tree || typeof tree !== 'object') {
    throw new Error('writeTreeOfFiles: tree must be a Record<string, Buffer|string>');
  }
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }
  for (const [relPath, value] of Object.entries(tree)) {
    if (relPath.startsWith('/') || relPath.includes('..') || relPath.includes('\\')) {
      throw new Error(
        `writeTreeOfFiles: refusing unsafe key ${JSON.stringify(relPath)} (must be POSIX relative)`,
      );
    }
    const abs = path.join(root, ...relPath.split('/'));
    mkdirSync(path.dirname(abs), { recursive: true });
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
    writeFileSync(abs, bytes);
  }
}

/**
 * Compute a sha256 fingerprint for every file under `root`, keyed by POSIX
 * relative path. Use to assert that two states of the disk differ in (or
 * agree on) exactly the expected files.
 *
 * @param {string} root
 * @returns {Map<string, string>}
 */
export function fingerprintTree(root) {
  const out = new Map();
  for (const { posixRel, abs } of walkTree(root)) {
    out.set(posixRel, sha256(readFileSync(abs)));
  }
  return out;
}

/**
 * Compare two fingerprints. Returns the keys that were added in `b`, removed
 * from `a`, or whose sha changed.
 *
 * @param {Map<string, string>} a   "before" fingerprint.
 * @param {Map<string, string>} b   "after" fingerprint.
 * @returns {{ added: string[], removed: string[], changed: string[] }}
 */
export function diffFingerprints(a, b) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const [k, v] of a) {
    if (!b.has(k)) removed.push(k);
    else if (b.get(k) !== v) changed.push(k);
  }
  for (const k of b.keys()) {
    if (!a.has(k)) added.push(k);
  }
  added.sort();
  removed.sort();
  changed.sort();
  return { added, removed, changed };
}

/**
 * Recursively copy `src` into `dst`. Thin wrapper over `fs.cpSync` so callers
 * have a single import surface. `dst` is created if absent.
 *
 * @param {string} src
 * @param {string} dst
 */
export function copyTree(src, dst) {
  mkdirSync(path.dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true });
}

// ---------------------------------------------------------------------------
// USTAR tarball writer (in-memory).
// ---------------------------------------------------------------------------
//
// Factored out of test/helpers-phase4b.smoke.mjs. Produces archives the
// project's parseTarball() in src/tarball.mjs reads. Limited to regular
// files (type '0') because that's all npm tarballs contain. Each entry is
// prefixed with `<name>/` (default `package/`) so parseTarball strips the
// prefix correctly.

const TAR_BLOCK = 512;

/**
 * Pad / truncate `str` to `length` bytes (ASCII only). Returns a Buffer.
 *
 * @param {string} str
 * @param {number} length
 * @returns {Buffer}
 */
function tarStrField(str, length) {
  const buf = Buffer.alloc(length, 0);
  buf.write(str, 0, Math.min(str.length, length), 'ascii');
  return buf;
}

/**
 * Encode `value` as zero-padded octal of total length `length` (last byte
 * NUL terminator), per the USTAR convention.
 *
 * @param {number} value
 * @param {number} length
 * @returns {Buffer}
 */
function tarOctalField(value, length) {
  const oct = value.toString(8);
  if (oct.length > length - 1) {
    throw new Error(`tar octal field overflow: ${value} > ${length - 1} digits`);
  }
  const padded = oct.padStart(length - 1, '0') + '\0';
  return Buffer.from(padded, 'ascii');
}

/**
 * Build one USTAR header+body pair for a regular file.
 *
 * @param {string} archivePath  Path inside the archive (no leading slash).
 * @param {Buffer} body         File bytes.
 * @returns {Buffer}            header (512) + padded body.
 */
function buildTarEntry(archivePath, body) {
  if (Buffer.byteLength(archivePath, 'utf8') > 100) {
    throw new Error(
      `tar writer: archive path too long for USTAR 100-byte name field: ` +
        JSON.stringify(archivePath),
    );
  }

  const header = Buffer.alloc(TAR_BLOCK, 0);
  tarStrField(archivePath, 100).copy(header, 0);
  tarOctalField(0o644, 8).copy(header, 100); // mode
  tarOctalField(0, 8).copy(header, 108); // uid
  tarOctalField(0, 8).copy(header, 116); // gid
  tarOctalField(body.length, 12).copy(header, 124); // size
  tarOctalField(0, 12).copy(header, 136); // mtime — epoch for determinism
  // checksum field starts as 8 spaces while we sum the header
  for (let i = 0; i < 8; i++) header[148 + i] = 0x20;
  header[156] = 0x30; // type '0' = regular file
  Buffer.from('ustar\0', 'ascii').copy(header, 257); // magic
  Buffer.from('00', 'ascii').copy(header, 263); // version

  // Compute checksum.
  let sum = 0;
  for (let i = 0; i < TAR_BLOCK; i++) sum += header[i];
  tarOctalField(sum, 8).copy(header, 148);

  // Pad body to 512-byte boundary.
  const padded = Math.ceil(body.length / TAR_BLOCK) * TAR_BLOCK;
  const bodyBuf = Buffer.alloc(padded, 0);
  body.copy(bodyBuf, 0);

  return Buffer.concat([header, bodyBuf]);
}

/**
 * Pack an in-memory file map into a tarball mimicking the layout of an npm
 * tarball.
 *
 * Inputs:
 *   - `files`    Map<posixRel, Buffer | string>. Required. Keys are paths
 *                inside the package (e.g. `templates/foo.md`); each is
 *                emitted at `<name>/<key>` in the archive.
 *   - `name`     Archive top-level dir. Default `'package'` (npm convention).
 *   - `version`  When present, a synthetic `<name>/package.json` entry is
 *                included containing `{ name, version }`. Useful so
 *                fixture-built tarballs round-trip through parseTarball with
 *                a non-empty package.json. Pass `null`/`undefined` to skip.
 *   - `gzip`     If true (default), the result is gzipped (`.tgz` shape).
 *                Set to false for raw tar bytes.
 *
 * Returns a Buffer containing the encoded archive.
 *
 * @param {object} options
 * @param {Record<string, Buffer|string> | Map<string, Buffer|string>} options.files
 * @param {string} [options.name='package']
 * @param {string|null} [options.version=null]
 * @param {boolean} [options.gzip=true]
 * @returns {Buffer}
 */
export function buildTarball(options) {
  if (!options || typeof options !== 'object') {
    throw new Error('buildTarball: options object is required');
  }
  const name = options.name ?? 'package';
  const gzip = options.gzip !== false;
  const version = options.version ?? null;

  let entries;
  if (options.files instanceof Map) {
    entries = Array.from(options.files.entries());
  } else if (options.files && typeof options.files === 'object') {
    entries = Object.entries(options.files);
  } else {
    throw new Error('buildTarball: options.files must be a Map or plain object');
  }

  const out = [];

  if (typeof version === 'string' && version.length > 0) {
    const pkgBytes = Buffer.from(
      JSON.stringify({ name: 'create-wiki-llm', version }, null, 2) + '\n',
      'utf8',
    );
    out.push(buildTarEntry(`${name}/package.json`, pkgBytes));
  }

  // Sort by archive path for deterministic output.
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  for (const [relKey, value] of entries) {
    if (typeof relKey !== 'string' || relKey.length === 0) {
      throw new Error(`buildTarball: file keys must be non-empty strings (got ${typeof relKey})`);
    }
    if (relKey.includes('\\')) {
      throw new Error(
        `buildTarball: file key ${JSON.stringify(relKey)} contains a backslash; use POSIX paths.`,
      );
    }
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
    out.push(buildTarEntry(`${name}/${relKey}`, bytes));
  }

  // Two zero blocks = end-of-archive.
  out.push(Buffer.alloc(TAR_BLOCK, 0));
  out.push(Buffer.alloc(TAR_BLOCK, 0));

  const tar = Buffer.concat(out);
  return gzip ? gzipSync(tar) : tar;
}

// ---------------------------------------------------------------------------
// Fake fetch.
// ---------------------------------------------------------------------------

/**
 * Build a `fetch`-shaped function for tarball.fetchLatestTarball's
 * `options.fetch` injection point. Takes a Map (or plain object) of
 * `url -> Buffer` and returns an async function that resolves the body
 * for known URLs and throws a descriptive error otherwise.
 *
 * Order of lookup: exact-match first, then suffix-match (so callers can stub
 * just the last segment of a URL without having to know the registry root).
 *
 * @param {Map<string, Buffer> | Record<string, Buffer>} urlToBuffer
 * @returns {(url: string) => Promise<Buffer>}
 */
export function fakeFetch(urlToBuffer) {
  let table;
  if (urlToBuffer instanceof Map) {
    table = new Map(urlToBuffer);
  } else if (urlToBuffer && typeof urlToBuffer === 'object') {
    table = new Map(Object.entries(urlToBuffer));
  } else {
    throw new Error('fakeFetch: urlToBuffer must be a Map or plain object');
  }
  return async function fakeFetchImpl(url) {
    if (typeof url !== 'string') {
      throw new Error(`fakeFetch: url must be a string (got ${typeof url})`);
    }
    if (table.has(url)) return table.get(url);
    // Suffix match — useful when the caller only stubs `/<pkg>` and accepts
    // any registry origin.
    for (const [key, value] of table) {
      if (url.endsWith(key)) return value;
    }
    const known = Array.from(table.keys()).map((k) => `  - ${k}`).join('\n');
    throw new Error(
      `fakeFetch: no stub for ${JSON.stringify(url)}.\nKnown URLs/suffixes:\n${known || '  (none)'}`,
    );
  };
}
