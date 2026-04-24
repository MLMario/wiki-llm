// helpers-phase4b.smoke.mjs — smoke tests for Phase 4b update flow.
// Covers: src/update.mjs end-to-end, the three guards, --dry-run,
// --force, major-version gate, no-op update, and path-safety rejection.
//
// Run with: `node test/helpers-phase4b.smoke.mjs`. Exits 0 on success, 1 on
// any failed assertion. Phase 5 will absorb these into the real node:test
// suite; they are intentionally lean here so CI's placeholder `npm test`
// still passes (this file is not run by CI).
//
// Strategy:
//   - Build tarballs for fixture versions by copying templates/ to a scratch
//     dir, mutating files, regenerating its manifest, packaging via `npm pack`,
//     and feeding the resulting bytes into update() via `options.fetch`.
//   - All temp work is under os.tmpdir() and cleaned up at the end.
//   - Working tree must be clean after this script exits.

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
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { init } from '../src/init.mjs';
import { update } from '../src/update.mjs';
import { manifestPath, readManifest } from '../src/manifest.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const templatesDir = path.join(repoRoot, 'templates');

const TARGET_SKILL = '.claude/skills/kb-drop/SKILL.md';

// -- assertion plumbing ------------------------------------------------------

let failed = 0;
let passed = 0;

function assert(cond, message) {
  if (cond) {
    passed += 1;
    process.stdout.write(`  ok  ${message}\n`);
  } else {
    failed += 1;
    process.stdout.write(`  FAIL ${message}\n`);
  }
}

async function assertThrowsAsync(fn, predicate, message) {
  try {
    await fn();
    failed += 1;
    process.stdout.write(`  FAIL ${message} (expected throw)\n`);
  } catch (err) {
    if (predicate && !predicate(err)) {
      failed += 1;
      process.stdout.write(
        `  FAIL ${message} (predicate rejected; code=${err.code} msg=${err.message})\n`,
      );
      return;
    }
    passed += 1;
    process.stdout.write(`  ok  ${message}\n`);
  }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function readUtf8(p) {
  return readFileSync(p, 'utf8');
}

// -- fixture construction ----------------------------------------------------

/**
 * Walk a directory recursively, returning POSIX-relative path + abs path.
 * @param {string} root
 * @returns {Array<{ posixRel: string, abs: string }>}
 */
function walk(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    for (const name of readdirSync(cur)) {
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

const TEMPLATED_FILES = new Set([
  'CLAUDE.md',
  'README.md',
  'knowledge-base/index.md',
  'knowledge-base/curriculum.md',
]);

/**
 * Regenerate `<dir>/manifest.json` from disk, with `packageVersion` set as
 * given. Mirrors scripts/build-manifest.mjs but inlined so the smoke test
 * doesn't depend on that script's CWD/argv conventions.
 *
 * @param {string} dir   The "templates" dir whose manifest is being built.
 * @param {string} version
 */
function regenerateManifest(dir, version) {
  const found = walk(dir).filter((e) => e.posixRel !== 'manifest.json');
  const files = {};
  for (const { posixRel, abs } of found) {
    files[posixRel] = {
      sha256: sha256(readFileSync(abs)),
      templated: TEMPLATED_FILES.has(posixRel),
    };
  }
  const out = { manifestVersion: 1, packageVersion: version, files };
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
}

// -- minimal in-memory tar writer (USTAR) ------------------------------------
//
// Why not shell out to `npm pack`? Phase 4b builds many fixture variants and
// we want zero external mutation of `package.json` / `templates/`. The writer
// below produces archives that the project's parseTarball() in src/tarball.mjs
// can re-read. Limited to regular files (type '0') because that's all we
// need — npm tarballs don't contain links or special files.

const TAR_BLOCK = 512;

function strBlock(str, length) {
  const buf = Buffer.alloc(length, 0);
  buf.write(str, 0, Math.min(str.length, length), 'ascii');
  return buf;
}

function octalField(value, length) {
  // length includes the trailing NUL/space terminator; tar convention is
  // "<octal>\0" or "<octal> ". We use NUL.
  const oct = value.toString(8);
  if (oct.length > length - 1) {
    throw new Error(`octal value ${value} too large for field length ${length}`);
  }
  const padded = oct.padStart(length - 1, '0') + '\0';
  return Buffer.from(padded, 'ascii');
}

/**
 * Build a USTAR header + body for one regular-file entry. Body is null-padded
 * to TAR_BLOCK alignment.
 *
 * @param {string} name      Path inside the archive (e.g. `package/foo`).
 * @param {Buffer} body      File bytes.
 * @returns {Buffer}
 */
function buildTarEntry(name, body) {
  if (Buffer.byteLength(name, 'utf8') > 100) {
    throw new Error(
      `tar writer: name too long for USTAR 100-byte name field: ${JSON.stringify(name)}. ` +
        'Phase 4b smoke does not need long-name support.',
    );
  }
  const header = Buffer.alloc(TAR_BLOCK, 0);

  strBlock(name, 100).copy(header, 0);
  octalField(0o644, 8).copy(header, 100); // mode
  octalField(0, 8).copy(header, 108); // uid
  octalField(0, 8).copy(header, 116); // gid
  octalField(body.length, 12).copy(header, 124); // size
  octalField(0, 12).copy(header, 136); // mtime (epoch — deterministic)
  // checksum: spaces during compute
  for (let i = 0; i < 8; i++) header[148 + i] = 0x20;
  header[156] = 0x30; // type '0' (regular file)
  // linkname: 100 bytes of NUL (already)
  Buffer.from('ustar\0', 'ascii').copy(header, 257); // magic
  Buffer.from('00', 'ascii').copy(header, 263); // version
  // uname / gname / devmajor / devminor: empty NUL fields
  // prefix at 345 (155 bytes): empty

  // Compute checksum.
  let sum = 0;
  for (let i = 0; i < TAR_BLOCK; i++) sum += header[i];
  octalField(sum, 8).copy(header, 148);

  // Pad body to TAR_BLOCK alignment.
  const padded = Math.ceil(body.length / TAR_BLOCK) * TAR_BLOCK;
  const bodyBuf = Buffer.alloc(padded, 0);
  body.copy(bodyBuf, 0);

  return Buffer.concat([header, bodyBuf]);
}

/**
 * Pack a directory into an in-memory `.tgz` Buffer mimicking the layout of
 * an npm tarball: every file is prefixed with `package/` so the project's
 * `parseTarball` strips it cleanly. The package.json is synthesized inline.
 *
 * @param {object} options
 * @param {string} options.templatesDir   Absolute path to the templates dir
 *                                        whose contents should land at
 *                                        `package/templates/...` in the tarball.
 * @param {string} options.packageVersion Version that will appear in the
 *                                        synthesized package.json (also drives
 *                                        the registry-metadata fetch stub).
 * @param {object} [options.extra]        Map of additional `<rel>: Buffer`
 *                                        entries injected raw into the tarball
 *                                        (relative to `package/`). Used by the
 *                                        path-safety scenario to slip in a
 *                                        malicious `templates/<...>` entry.
 * @returns {Buffer} gzipped tar bytes
 */
function buildFixtureTarball({ templatesDir: tDir, packageVersion, extra }) {
  const entries = [];
  // Synthesize a tiny package.json. The updater never reads it; it only ever
  // touches `templates/manifest.json`. But npm-shaped tarballs have one, so we
  // include a minimal one for fidelity.
  const pkgJsonBytes = Buffer.from(
    JSON.stringify({ name: 'create-wiki-llm', version: packageVersion }, null, 2) + '\n',
    'utf8',
  );
  entries.push(buildTarEntry('package/package.json', pkgJsonBytes));

  // Pack every file under templatesDir as `package/templates/<relpath>`.
  const found = walk(tDir);
  for (const { posixRel, abs } of found) {
    const arcName = `package/templates/${posixRel}`;
    entries.push(buildTarEntry(arcName, readFileSync(abs)));
  }
  if (extra) {
    for (const [relInsidePackage, buf] of Object.entries(extra)) {
      entries.push(buildTarEntry(`package/${relInsidePackage}`, buf));
    }
  }
  // Two zero blocks = end-of-archive.
  entries.push(Buffer.alloc(TAR_BLOCK, 0));
  entries.push(Buffer.alloc(TAR_BLOCK, 0));

  const tar = Buffer.concat(entries);
  return gzipSync(tar);
}

/**
 * Build the registry-metadata JSON the updater requests at
 * `<registry>/<packageName>` before downloading the tarball. Only the bits
 * `fetchLatestTarball` actually reads matter: `dist-tags.latest` and
 * `versions[<version>].dist.tarball`.
 *
 * @param {string} packageName
 * @param {string} version
 * @param {string} tarballUrl
 * @returns {Buffer}
 */
function buildRegistryMetadata(packageName, version, tarballUrl) {
  const meta = {
    name: packageName,
    'dist-tags': { latest: version },
    versions: {
      [version]: {
        name: packageName,
        version,
        dist: { tarball: tarballUrl },
      },
    },
  };
  return Buffer.from(JSON.stringify(meta), 'utf8');
}

/**
 * Compose a `fetch` stub for the updater. First call: registry metadata.
 * Second call: tarball bytes. The stub asserts URL shape on each leg so a
 * regression in the updater's URL construction surfaces here.
 *
 * @param {object} args
 * @param {string} args.packageName
 * @param {string} args.version
 * @param {Buffer} args.tarballBuf
 * @returns {(url: string) => Promise<Buffer>}
 */
function makeFetchStub({ packageName, version, tarballBuf }) {
  const tarballUrl = `https://example.test/${packageName}-${version}.tgz`;
  const metaBuf = buildRegistryMetadata(packageName, version, tarballUrl);
  let calls = 0;
  return async (url) => {
    calls += 1;
    if (calls === 1) {
      if (!url.endsWith(`/${packageName}`)) {
        throw new Error(`fetch stub: unexpected metadata URL ${url}`);
      }
      return metaBuf;
    }
    if (calls === 2) {
      if (url !== tarballUrl) {
        throw new Error(`fetch stub: unexpected tarball URL ${url}`);
      }
      return tarballBuf;
    }
    throw new Error(`fetch stub: unexpected extra call (${calls}) for url=${url}`);
  };
}

// -- scenario helpers --------------------------------------------------------

let TMP_ROOT;

function mkTmp(name) {
  return mkdtempSync(path.join(TMP_ROOT, `${name}-`));
}

/**
 * Scaffold a fresh repo into a fresh tempdir. Returns the absolute path. The
 * scaffold uses fixed projectName/createdDate so its byte content is stable.
 *
 * @param {string} label
 * @returns {Promise<string>}
 */
async function scaffoldFresh(label) {
  const dir = mkTmp(`scaffold-${label}`);
  await init({
    targetDir: dir,
    projectName: 'test-kb',
    createdDate: '2026-04-24',
    log: () => {}, // silence banner in smoke
  });
  return dir;
}

/**
 * Build a scratch templates dir for fixture versions by copying the real
 * templates dir into a tempdir and optionally mutating files there. The caller
 * regenerates the manifest after mutation.
 *
 * @param {string} label
 * @param {(scratchTplDir: string) => void} mutator   Called before manifest regen.
 * @param {string} version
 * @returns {string} path to the scratch templates dir
 */
function buildScratchTemplates(label, mutator, version) {
  const sandbox = mkTmp(`fixture-${label}`);
  const scratchTpl = path.join(sandbox, 'templates');
  cpSync(templatesDir, scratchTpl, { recursive: true });
  // Rebuild the manifest from disk first so the baseline matches the bytes
  // we just copied (templates/manifest.json on disk reflects v0.0.0 already,
  // but mutator may change content).
  mutator(scratchTpl);
  regenerateManifest(scratchTpl, version);
  return scratchTpl;
}

/**
 * Helper: run update() with a fetch stub for a given fixture tarball.
 *
 * @param {object} args
 * @param {string} args.repoRoot
 * @param {Buffer} args.tarballBuf
 * @param {string} args.version
 * @param {object} [args.options]
 */
async function runUpdate({ repoRoot, tarballBuf, version, options = {} }) {
  const fetch = makeFetchStub({
    packageName: 'create-wiki-llm',
    version,
    tarballBuf,
  });
  const result = await update({
    repoRoot,
    fetch,
    log: options.log ?? (() => {}),
    ...options,
  });
  return result;
}

/**
 * Take a recursive sha256 fingerprint of a directory tree, keyed by POSIX
 * relative path. Used to assert "nothing was touched" between two points.
 *
 * @param {string} root
 * @returns {Map<string, string>}
 */
function fingerprintTree(root) {
  const out = new Map();
  for (const { posixRel, abs } of walk(root)) {
    out.set(posixRel, sha256(readFileSync(abs)));
  }
  return out;
}

function diffFingerprints(a, b) {
  const changed = [];
  const added = [];
  const removed = [];
  for (const [k, v] of a) {
    if (!b.has(k)) removed.push(k);
    else if (b.get(k) !== v) changed.push(k);
  }
  for (const k of b.keys()) {
    if (!a.has(k)) added.push(k);
  }
  return { added, removed, changed };
}

// -- scenarios ---------------------------------------------------------------

async function scenarioNormalUpdate() {
  process.stdout.write('\n== scenario 1: normal update (no customizations) ==\n');
  const repo = await scaffoldFresh('s1');
  const oldFp = fingerprintTree(repo);

  const scratchTpl = buildScratchTemplates(
    's1',
    (tpl) => {
      const target = path.join(tpl, ...TARGET_SKILL.split('/'));
      const original = readUtf8(target);
      writeFileSync(target, original + '\n<!-- v0.1.0 update marker -->\n', 'utf8');
    },
    '0.1.0',
  );
  const tarballBuf = buildFixtureTarball({
    templatesDir: scratchTpl,
    packageVersion: '0.1.0',
  });

  // Capture stdout for the apply path so we can show it in the report.
  const stdoutLines = [];
  const result = await runUpdate({
    repoRoot: repo,
    tarballBuf,
    version: '0.1.0',
    options: { log: (l) => stdoutLines.push(l) },
  });

  assert(result.version === '0.1.0', 'returned version is 0.1.0');
  assert(result.oldVersion === '0.0.0', 'old version was 0.0.0');
  assert(result.appliedCount === 1, `applied count is 1 (got ${result.appliedCount})`);
  assert(result.removedCount === 0, 'no files removed');
  assert(result.backup.count === 1, 'backup contains 1 file');
  assert(result.backup.path !== null && existsSync(result.backup.path), 'backup dir exists on disk');

  // Backup file must equal the ORIGINAL scaffolded bytes (not the new ones).
  const backupTarget = path.join(result.backup.path, ...TARGET_SKILL.split('/'));
  assert(existsSync(backupTarget), 'backup contains the customized skill file');
  const originalBytes = readFileSync(path.join(templatesDir, ...TARGET_SKILL.split('/')));
  assert(
    sha256(readFileSync(backupTarget)) === sha256(originalBytes),
    'backup file matches the pre-update on-disk bytes',
  );

  // Disk now contains the new content.
  const newDiskBytes = readFileSync(path.join(repo, ...TARGET_SKILL.split('/')), 'utf8');
  assert(newDiskBytes.includes('v0.1.0 update marker'), 'disk reflects new tarball bytes');

  // Manifest advanced.
  const mNew = readManifest(repo);
  assert(mNew.packageVersion === '0.1.0', 'runtime manifest packageVersion advanced to 0.1.0');
  assert(typeof mNew.lastUpdatedAt === 'string' && mNew.lastUpdatedAt.length > 0, 'lastUpdatedAt is set');
  assert(mNew.scaffoldedAt && mNew.scaffoldedAt !== mNew.lastUpdatedAt, 'scaffoldedAt preserved & distinct');

  // Update-report.json was written.
  const reportPath = path.join(repo, '.wiki-llm', 'update-report.json');
  assert(existsSync(reportPath), 'update-report.json written');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert(report.oldVersion === '0.0.0' && report.newVersion === '0.1.0', 'report has version transition');

  // User zone untouched.
  const userZonePaths = [
    'knowledge-base/log.md',
    'knowledge-base/raw/articles/.gitkeep',
    'knowledge-base/raw/notes/.gitkeep',
    'knowledge-base/wiki/concepts/.gitkeep',
    'CLAUDE.md',
    'README.md',
    '.gitignore',
    '.claude/settings.json',
    'knowledge-base/index.md',
    'knowledge-base/source_index.md',
    'knowledge-base/curriculum.md',
  ];
  let userZoneIntact = true;
  for (const p of userZonePaths) {
    if (oldFp.has(p)) {
      const cur = sha256(readFileSync(path.join(repo, ...p.split('/'))));
      if (oldFp.get(p) !== cur) {
        userZoneIntact = false;
        process.stdout.write(`     evidence: ${p} changed (Seed/User zone)\n`);
      }
    }
  }
  assert(userZoneIntact, 'all Seed/User-zone files unchanged across update');

  // Capture an example stdout snippet for the report.
  return { stdoutLines: stdoutLines.slice(0, 30) };
}

async function scenarioCustomizationRefusal() {
  process.stdout.write('\n== scenario 2: customization refusal (no --force) ==\n');
  const repo = await scaffoldFresh('s2');

  // User customizes the same skill file the new version touches.
  const skillAbs = path.join(repo, ...TARGET_SKILL.split('/'));
  const customizedBytes = readUtf8(skillAbs) + '\n<!-- user customization -->\n';
  writeFileSync(skillAbs, customizedBytes, 'utf8');

  const scratchTpl = buildScratchTemplates(
    's2',
    (tpl) => {
      const target = path.join(tpl, ...TARGET_SKILL.split('/'));
      const original = readUtf8(target);
      writeFileSync(target, original + '\n<!-- v0.1.0 update marker -->\n', 'utf8');
    },
    '0.1.0',
  );
  const tarballBuf = buildFixtureTarball({
    templatesDir: scratchTpl,
    packageVersion: '0.1.0',
  });

  // Snapshot disk for invariant check.
  const before = fingerprintTree(repo);

  await assertThrowsAsync(
    () =>
      runUpdate({
        repoRoot: repo,
        tarballBuf,
        version: '0.1.0',
      }),
    (err) =>
      err.code === 'EUSER' &&
      /customized/i.test(err.message) &&
      err.message.includes(TARGET_SKILL),
    'update without --force refuses with EUSER citing customized file',
  );

  const after = fingerprintTree(repo);
  const diff = diffFingerprints(before, after);
  assert(
    diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0,
    'no disk changes after refusal',
  );
  assert(
    !existsSync(path.join(repo, '.wiki-llm', 'backups')) ||
      readdirSync(path.join(repo, '.wiki-llm', 'backups')).length === 0,
    'no backup created on refusal',
  );

  return { repo, customizedBytes, scratchTpl, tarballBuf };
}

async function scenarioForceOverwrite(refusalCtx) {
  process.stdout.write('\n== scenario 3: --force overwrite ==\n');
  // Start from a fresh customized scaffold (independent from scenario 2 to
  // keep this test order-independent for future test reorgs).
  const repo = await scaffoldFresh('s3');

  const skillAbs = path.join(repo, ...TARGET_SKILL.split('/'));
  const userBytes = readUtf8(skillAbs) + '\n<!-- s3 user customization -->\n';
  writeFileSync(skillAbs, userBytes, 'utf8');

  const scratchTpl = buildScratchTemplates(
    's3',
    (tpl) => {
      const target = path.join(tpl, ...TARGET_SKILL.split('/'));
      const original = readUtf8(target);
      writeFileSync(target, original + '\n<!-- v0.1.0 update marker -->\n', 'utf8');
    },
    '0.1.0',
  );
  const tarballBuf = buildFixtureTarball({
    templatesDir: scratchTpl,
    packageVersion: '0.1.0',
  });

  const result = await runUpdate({
    repoRoot: repo,
    tarballBuf,
    version: '0.1.0',
    options: { force: true },
  });

  assert(result.appliedCount === 1, `--force overwrites 1 file (got ${result.appliedCount})`);
  assert(result.backup.count === 1, '--force backup contains 1 file');

  // Backup must contain the USER's customized bytes, not the scaffolded original.
  const backupTarget = path.join(result.backup.path, ...TARGET_SKILL.split('/'));
  const backupBytes = readUtf8(backupTarget);
  assert(
    backupBytes === userBytes,
    "backup preserves the user's customized bytes (not the original scaffold bytes)",
  );

  const newDisk = readUtf8(skillAbs);
  assert(newDisk.includes('v0.1.0 update marker'), 'disk reflects v0.1.0 bytes');
  assert(!newDisk.includes('s3 user customization'), 'user customization no longer on disk');

  const m = readManifest(repo);
  assert(m.packageVersion === '0.1.0', 'manifest advanced after --force');
}

async function scenarioDryRun() {
  process.stdout.write('\n== scenario 4: --dry-run (no fs writes) ==\n');
  const repo = await scaffoldFresh('s4');
  const before = fingerprintTree(repo);
  const beforeManifest = readUtf8(manifestPath(repo));

  const scratchTpl = buildScratchTemplates(
    's4',
    (tpl) => {
      const target = path.join(tpl, ...TARGET_SKILL.split('/'));
      writeFileSync(target, readUtf8(target) + '\n<!-- v0.1.0 dry run -->\n', 'utf8');
    },
    '0.1.0',
  );
  const tarballBuf = buildFixtureTarball({
    templatesDir: scratchTpl,
    packageVersion: '0.1.0',
  });

  const result = await runUpdate({
    repoRoot: repo,
    tarballBuf,
    version: '0.1.0',
    options: { dryRun: true },
  });

  assert(result.dryRun === true, 'returned dryRun: true');
  assert(result.plan.length > 0, 'plan is non-empty');
  const overwrite = result.plan.find((e) => e.relPath === TARGET_SKILL);
  assert(
    overwrite && overwrite.disposition === 'overwrite-clean',
    'plan classifies the changed skill as overwrite-clean',
  );
  assert(result.backup.count === 0, 'no backup count in dry-run');
  assert(result.appliedCount === 0, 'no files applied in dry-run');

  const after = fingerprintTree(repo);
  const diff = diffFingerprints(before, after);
  assert(
    diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0,
    'no disk changes after dry-run',
  );
  assert(
    !existsSync(path.join(repo, '.wiki-llm', 'backups')) ||
      readdirSync(path.join(repo, '.wiki-llm', 'backups')).length === 0,
    'no backup directory created on dry-run',
  );
  assert(readUtf8(manifestPath(repo)) === beforeManifest, 'manifest bytes unchanged');
}

async function scenarioMajorVersionGate() {
  process.stdout.write('\n== scenario 5: major-version gate ==\n');
  const repo = await scaffoldFresh('s5');

  const scratchTpl = buildScratchTemplates(
    's5',
    () => {
      // No content change needed; manifest version is what gates us.
    },
    '1.0.0',
  );
  const tarballBuf = buildFixtureTarball({
    templatesDir: scratchTpl,
    packageVersion: '1.0.0',
  });

  const before = fingerprintTree(repo);
  await assertThrowsAsync(
    () =>
      runUpdate({
        repoRoot: repo,
        tarballBuf,
        version: '1.0.0',
      }),
    (err) =>
      err.code === 'EENV' &&
      /major version/i.test(err.message) &&
      err.message.includes('MIGRATION'),
    'major bump throws EENV with migration link',
  );
  const after = fingerprintTree(repo);
  const diff = diffFingerprints(before, after);
  assert(
    diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0,
    'major-bump refusal leaves disk untouched',
  );
}

async function scenarioNoOpUpdate() {
  process.stdout.write('\n== scenario 6: no-op update (same content, version bump) ==\n');
  const repo = await scaffoldFresh('s6');
  const beforeFiles = fingerprintTree(repo);

  // Build a fixture with identical content but a higher patch version, so the
  // updater's plan should classify everything as 'unchanged'.
  const scratchTpl = buildScratchTemplates('s6', () => {}, '0.0.1');
  const tarballBuf = buildFixtureTarball({
    templatesDir: scratchTpl,
    packageVersion: '0.0.1',
  });

  const result = await runUpdate({
    repoRoot: repo,
    tarballBuf,
    version: '0.0.1',
  });

  const dispositions = new Map();
  for (const e of result.plan) {
    dispositions.set(e.disposition, (dispositions.get(e.disposition) ?? 0) + 1);
  }
  assert(
    !dispositions.has('overwrite-clean') &&
      !dispositions.has('overwrite-customized') &&
      !dispositions.has('added') &&
      !dispositions.has('removed'),
    'plan contains only `unchanged` entries',
  );
  assert(result.appliedCount === 0, 'no files applied');
  assert(result.backup.count === 0, 'no backup created when nothing to back up');

  // No backups at all on disk.
  const backupsDir = path.join(repo, '.wiki-llm', 'backups');
  if (existsSync(backupsDir)) {
    assert(readdirSync(backupsDir).length === 0, 'no backup directories on disk');
  } else {
    assert(true, 'backups dir not created (acceptable)');
  }

  // Manifest's lastUpdatedAt is now set (refreshed even if no file changed).
  const m = readManifest(repo);
  assert(typeof m.lastUpdatedAt === 'string' && m.lastUpdatedAt.length > 0, 'lastUpdatedAt set on no-op');
  assert(m.packageVersion === '0.0.1', 'packageVersion advanced even on no-op');

  // All Package-zone files byte-identical (and Seed/User as well).
  const afterFiles = fingerprintTree(repo);
  const diff = diffFingerprints(beforeFiles, afterFiles);
  // The manifest itself is expected to differ (lastUpdatedAt + version), and
  // .wiki-llm/update-report.json is new.
  const significantChanges = diff.changed.filter(
    (p) => p !== '.wiki-llm/manifest.json',
  );
  const significantAdded = diff.added.filter(
    (p) => p !== '.wiki-llm/update-report.json',
  );
  assert(
    significantChanges.length === 0 && significantAdded.length === 0 && diff.removed.length === 0,
    'only manifest+report changed; everything else byte-identical',
  );
}

async function scenarioPathSafetyRejection() {
  process.stdout.write('\n== scenario 7: path-safety rejection (Guard 3) ==\n');
  const repo = await scaffoldFresh('s7');

  // Build fixture: scratch templates with a manifest entry whose key is
  // `../escape.md`. The manifest's malicious entry triggers Guard 3 in the
  // planning loop's validateTargetPath call.
  const sandbox = mkTmp('fixture-s7');
  const scratchTpl = path.join(sandbox, 'templates');
  cpSync(templatesDir, scratchTpl, { recursive: true });
  // Hand-craft a manifest with a malicious entry. We deliberately keep
  // existing entries so the planner has to walk them (and would skip
  // most of them) but explicitly fail on the `..` entry.
  const evilSha = sha256(Buffer.from('evil', 'utf8'));
  const baseManifest = JSON.parse(
    readUtf8(path.join(scratchTpl, 'manifest.json')),
  );
  baseManifest.packageVersion = '0.0.1';
  baseManifest.files['../escape.md'] = { sha256: evilSha, templated: false };
  writeFileSync(
    path.join(scratchTpl, 'manifest.json'),
    JSON.stringify(baseManifest, null, 2) + '\n',
    'utf8',
  );

  const tarballBuf = buildFixtureTarball({
    templatesDir: scratchTpl,
    packageVersion: '0.0.1',
  });

  const before = fingerprintTree(repo);
  await assertThrowsAsync(
    () =>
      runUpdate({
        repoRoot: repo,
        tarballBuf,
        version: '0.0.1',
      }),
    (err) =>
      err.code === 'EENV' &&
      /unsafe|traversal/i.test(err.message),
    'unsafe `..` path triggers Guard 3 with EENV',
  );
  const after = fingerprintTree(repo);
  const diff = diffFingerprints(before, after);
  assert(
    diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0,
    'path-safety rejection leaves disk untouched',
  );
}

// -- driver ------------------------------------------------------------------

async function main() {
  TMP_ROOT = mkdtempSync(path.join(os.tmpdir(), 'wiki-llm-phase4b-'));
  process.stdout.write(`Smoke tmp root: ${TMP_ROOT}\n`);

  let stdoutSample = null;
  try {
    const r = await scenarioNormalUpdate();
    stdoutSample = r.stdoutLines;
    const refusalCtx = await scenarioCustomizationRefusal();
    await scenarioForceOverwrite(refusalCtx);
    await scenarioDryRun();
    await scenarioMajorVersionGate();
    await scenarioNoOpUpdate();
    await scenarioPathSafetyRejection();
  } finally {
    // Always clean up.
    try {
      rmSync(TMP_ROOT, { recursive: true, force: true });
    } catch (err) {
      process.stderr.write(`warn: failed to clean ${TMP_ROOT}: ${err.message}\n`);
    }
  }

  if (stdoutSample) {
    process.stdout.write('\n--- sample stdout from scenario 1 (successful update) ---\n');
    for (const line of stdoutSample) process.stdout.write(line + '\n');
    process.stdout.write('--- end sample ---\n');
  }
  process.stdout.write(`\nResults: ${passed} passed, ${failed} failed.\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err && err.stack ? err.stack : err}\n`);
  // Best-effort cleanup if we crashed mid-scenarios.
  if (TMP_ROOT) {
    try {
      rmSync(TMP_ROOT, { recursive: true, force: true });
    } catch (_e) {
      /* ignore */
    }
  }
  process.exit(2);
});
