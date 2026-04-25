// update-integration.test.mjs — end-to-end tests for src/update.mjs.
//
// Strategy:
//   - Scaffold a fresh repo into a tempdir via init().
//   - Build a v0.1/v0.2-shaped tarball in memory using the helpers' shared
//     `buildTarball` factory.
//   - Drive update() with `fakeFetch` injecting registry-metadata + tarball
//     responses.
//   - Assert disposition counts, applied bytes, backup contents, manifest
//     mutations, and the User/Seed-zone invariant.
//
// These tests port the seven scenarios in test/helpers-phase4b.smoke.mjs into
// the node:test framework and add the Phase 5b user-data-survival test plus
// a `--keep-backups` pruning test and a disk-equals-new edge case.
//
// Node built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

import { init } from '../src/init.mjs';
import { update } from '../src/update.mjs';
import { manifestPath, readManifest, sha256 } from '../src/manifest.mjs';
import {
  buildTarball,
  diffFingerprints,
  fakeFetch,
  fingerprintTree,
  makeTempDir,
  sha256 as helperSha,
} from './helpers.mjs';

// ---------------------------------------------------------------------------
// Shared constants.
// ---------------------------------------------------------------------------

// One Package-zone file we will mutate across versions in most scenarios.
const TARGET_SKILL = '.claude/skills/kb-drop/SKILL.md';

// Hardcoded list of files that receive {{VAR}} substitution at scaffold time
// (mirrors scripts/build-manifest.mjs's TEMPLATED_FILES). Used when
// constructing fake-tarball manifests.
const TEMPLATED_FILES = new Set([
  'CLAUDE.md',
  'README.md',
  'knowledge-base/index.md',
  'knowledge-base/curriculum.md',
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(repoRoot, 'templates');

// ---------------------------------------------------------------------------
// Fixture helpers.
// ---------------------------------------------------------------------------

/**
 * ESM-safe recursive walk; returns POSIX-keyed { posixRel, abs } entries
 * sorted by `posixRel`.
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
 * Build an in-memory `templates/...` map from the real templates dir, with
 * caller-supplied overrides applied on top.
 *
 * @param {Record<string, Buffer|string|null>} overrides   POSIX-keyed
 *   overrides relative to `templates/`. Values fully replace the underlying
 *   file's bytes. Pass `null` to remove an entry.
 * @returns {Map<string, Buffer>}                          tarball-shaped file
 *   map keyed by `templates/<rel>`.
 */
function buildTemplateMap(overrides = {}) {
  const out = new Map();
  for (const { posixRel, abs } of walkTree(TEMPLATES_DIR)) {
    if (posixRel === 'manifest.json') continue;
    out.set(`templates/${posixRel}`, readFileSync(abs));
  }
  for (const [key, value] of Object.entries(overrides)) {
    const tarKey = `templates/${key}`;
    if (value === null) {
      out.delete(tarKey);
      continue;
    }
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
    out.set(tarKey, buf);
  }
  return out;
}

/**
 * Build a `templates/manifest.json` payload that hashes each entry in
 * `templateMap`. The output is the bytes of the JSON manifest, ready to be
 * inserted into the tarball under the `templates/manifest.json` key.
 *
 * @param {Map<string, Buffer>} templateMap   keys `templates/<rel>`.
 * @param {string} packageVersion
 * @returns {Buffer}
 */
function buildTemplateManifest(templateMap, packageVersion) {
  const files = {};
  const sorted = Array.from(templateMap.keys()).sort();
  for (const tarKey of sorted) {
    if (!tarKey.startsWith('templates/')) continue;
    if (tarKey === 'templates/manifest.json') continue;
    const rel = tarKey.slice('templates/'.length);
    files[rel] = {
      sha256: helperSha(templateMap.get(tarKey)),
      templated: TEMPLATED_FILES.has(rel),
    };
  }
  const manifest = { manifestVersion: 1, packageVersion, files };
  return Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

/**
 * Compose a complete tarball-file map for fixture v* releases. Combines the
 * (possibly-overridden) templates map with a `templates/manifest.json`. The
 * synthetic `package.json` is added by helpers.buildTarball when a version
 * is supplied.
 *
 * @param {object} args
 * @param {string} args.packageVersion
 * @param {Record<string, Buffer|string|null>} [args.overrides]
 * @returns {Map<string, Buffer>}
 */
function buildFixtureFileMap({ packageVersion, overrides }) {
  const tpl = buildTemplateMap(overrides);
  const manifest = buildTemplateManifest(tpl, packageVersion);
  tpl.set('templates/manifest.json', manifest);
  return tpl;
}

/**
 * Pack an in-memory tarball Buffer suitable for the updater's tarball parser.
 *
 * @param {Map<string, Buffer>} fileMap
 * @param {string} packageVersion
 * @returns {Buffer}
 */
function packTarball(fileMap, packageVersion) {
  return buildTarball({
    files: fileMap,
    name: 'package',
    version: packageVersion,
    gzip: true,
  });
}

/**
 * Compose a `fakeFetch`-compatible URL→Buffer table for one tarball release.
 * The updater calls `fetchLatestTarball`, which performs:
 *   1. GET <registry>/<package>          → registry metadata JSON
 *   2. GET <tarballUrl from metadata>    → tarball bytes
 * Both are stubbed. The tarball URL is synthetic (under `https://example.test/`)
 * so accidental network egress is impossible.
 *
 * @param {object} args
 * @param {string} args.packageName
 * @param {string} args.version
 * @param {Buffer} args.tarballBuf
 * @returns {(url: string) => Promise<Buffer>}
 */
function makeFetchStub({ packageName, version, tarballBuf }) {
  const tarballUrl = `https://example.test/${packageName}-${version}.tgz`;
  const metadata = {
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
  const metaBuf = Buffer.from(JSON.stringify(metadata), 'utf8');
  return fakeFetch({
    [`/${packageName}`]: metaBuf,
    [tarballUrl]: tarballBuf,
  });
}

/**
 * Scaffold a fresh repo into a tempdir with deterministic inputs. The
 * cleanup() function is idempotent.
 *
 * @param {string} label
 * @returns {Promise<{ root: string, cleanup: () => void }>}
 */
async function scaffold(label) {
  const tmp = makeTempDir(`update-int-${label}`);
  await init({
    targetDir: tmp.path,
    projectName: 'test-kb',
    createdDate: '2026-01-01',
    log: () => {},
  });
  return { root: tmp.path, cleanup: tmp.cleanup };
}

/**
 * Read the bytes of a baseline templates/<rel> file (used as the v0 starting
 * point for "version-bumps changed file" overrides).
 *
 * @param {string} relPath  POSIX path relative to `templates/`.
 * @returns {string}        UTF-8 contents.
 */
function templateBytes(relPath) {
  return readFileSync(path.join(TEMPLATES_DIR, ...relPath.split('/')), 'utf8');
}

// ---------------------------------------------------------------------------
// Scenario 1 — no-op update (same content, version bump only).
// ---------------------------------------------------------------------------

test('update: no-op (same content) — all unchanged, lastUpdatedAt set, no backups', async () => {
  const sc = await scaffold('s1');
  try {
    const before = fingerprintTree(sc.root);
    const fileMap = buildFixtureFileMap({ packageVersion: '0.0.1', overrides: {} });
    const tarballBuf = packTarball(fileMap, '0.0.1');
    const fetch = makeFetchStub({
      packageName: 'create-wiki-llm',
      version: '0.0.1',
      tarballBuf,
    });

    const result = await update({
      repoRoot: sc.root,
      fetch,
      log: () => {},
    });

    // Every Package-zone file should classify as 'unchanged'.
    const dispositions = new Map();
    for (const e of result.plan) {
      dispositions.set(e.disposition, (dispositions.get(e.disposition) ?? 0) + 1);
    }
    assert.equal(dispositions.has('overwrite-clean'), false);
    assert.equal(dispositions.has('overwrite-customized'), false);
    assert.equal(dispositions.has('added'), false);
    assert.equal(dispositions.has('removed'), false);
    assert.ok((dispositions.get('unchanged') ?? 0) > 0);
    assert.equal(result.appliedCount, 0);
    assert.equal(result.backup.count, 0);

    // Manifest moved forward.
    const m = readManifest(sc.root);
    assert.equal(m.packageVersion, '0.0.1');
    assert.equal(typeof m.lastUpdatedAt, 'string');
    assert.ok(m.lastUpdatedAt.length > 0);

    // Disk: only manifest + report changed.
    const after = fingerprintTree(sc.root);
    const diff = diffFingerprints(before, after);
    const significantChanges = diff.changed.filter(
      (p) => p !== '.wiki-llm/manifest.json',
    );
    const significantAdded = diff.added.filter(
      (p) => p !== '.wiki-llm/update-report.json',
    );
    assert.deepEqual(significantChanges, []);
    assert.deepEqual(significantAdded, []);
    assert.deepEqual(diff.removed, []);
  } finally {
    sc.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Scenario 2 — clean v0.0.0 → v0.1.0 update.
// ---------------------------------------------------------------------------

test('update: clean v0.0.0 → v0.1.0 — applies, backup contains old bytes', async () => {
  const sc = await scaffold('s2');
  try {
    const before = fingerprintTree(sc.root);
    const fileMap = buildFixtureFileMap({
      packageVersion: '0.1.0',
      overrides: {
        [TARGET_SKILL]: templateBytes(TARGET_SKILL) + '\n<!-- v0.1.0 update marker -->\n',
      },
    });
    const tarballBuf = packTarball(fileMap, '0.1.0');
    const fetch = makeFetchStub({
      packageName: 'create-wiki-llm',
      version: '0.1.0',
      tarballBuf,
    });

    const result = await update({ repoRoot: sc.root, fetch, log: () => {} });

    assert.equal(result.version, '0.1.0');
    assert.equal(result.oldVersion, '0.0.0');
    assert.equal(result.appliedCount, 1);
    assert.equal(result.backup.count, 1);
    assert.ok(result.backup.path !== null);
    assert.ok(existsSync(result.backup.path));

    // Backup file matches the OLD on-disk bytes (the scaffolded ones).
    const backupTarget = path.join(result.backup.path, ...TARGET_SKILL.split('/'));
    assert.ok(existsSync(backupTarget));
    const originalBytes = readFileSync(
      path.join(TEMPLATES_DIR, ...TARGET_SKILL.split('/')),
    );
    assert.equal(sha256(readFileSync(backupTarget)), sha256(originalBytes));

    // Disk now reflects the new bytes.
    const updatedBytes = readFileSync(
      path.join(sc.root, ...TARGET_SKILL.split('/')),
      'utf8',
    );
    assert.match(updatedBytes, /v0\.1\.0 update marker/);

    // Seed/User zone integrity check.
    for (const rel of [
      'CLAUDE.md',
      'README.md',
      '.gitignore',
      '.claude/settings.json',
      'knowledge-base/index.md',
      'knowledge-base/source_index.md',
      'knowledge-base/curriculum.md',
      'knowledge-base/log.md',
    ]) {
      if (!before.has(rel)) continue;
      const cur = sha256(readFileSync(path.join(sc.root, ...rel.split('/'))));
      assert.equal(before.get(rel), cur, `Seed/User-zone file ${rel} unexpectedly changed`);
    }
  } finally {
    sc.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Scenario 3 — customized refusal (Guard 1 without --force).
// ---------------------------------------------------------------------------

test('update: customized file refused without --force; no disk changes', async () => {
  const sc = await scaffold('s3');
  try {
    const skillAbs = path.join(sc.root, ...TARGET_SKILL.split('/'));
    const customized = readFileSync(skillAbs, 'utf8') + '\n<!-- user customization -->\n';
    writeFileSync(skillAbs, customized, 'utf8');

    const fileMap = buildFixtureFileMap({
      packageVersion: '0.1.0',
      overrides: {
        [TARGET_SKILL]: templateBytes(TARGET_SKILL) + '\n<!-- v0.1.0 update marker -->\n',
      },
    });
    const tarballBuf = packTarball(fileMap, '0.1.0');
    const fetch = makeFetchStub({
      packageName: 'create-wiki-llm',
      version: '0.1.0',
      tarballBuf,
    });

    const before = fingerprintTree(sc.root);
    await assert.rejects(
      () => update({ repoRoot: sc.root, fetch, log: () => {} }),
      (err) =>
        err.code === 'EUSER' &&
        /customized/i.test(err.message) &&
        err.message.includes(TARGET_SKILL),
      'expected EUSER citing the customized file',
    );
    const after = fingerprintTree(sc.root);
    const diff = diffFingerprints(before, after);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.removed, []);
    assert.deepEqual(diff.changed, []);

    // No backup directory created on refusal.
    const backupsDir = path.join(sc.root, '.wiki-llm', 'backups');
    if (existsSync(backupsDir)) {
      assert.equal(readdirSync(backupsDir).length, 0);
    }
  } finally {
    sc.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Scenario 4 — --force overwrite (backup contains user bytes).
// ---------------------------------------------------------------------------

test('update: --force overwrites customized file; backup contains user bytes', async () => {
  const sc = await scaffold('s4');
  try {
    const skillAbs = path.join(sc.root, ...TARGET_SKILL.split('/'));
    const userBytes = readFileSync(skillAbs, 'utf8') + '\n<!-- s4 user customization -->\n';
    writeFileSync(skillAbs, userBytes, 'utf8');

    const fileMap = buildFixtureFileMap({
      packageVersion: '0.1.0',
      overrides: {
        [TARGET_SKILL]: templateBytes(TARGET_SKILL) + '\n<!-- v0.1.0 update marker -->\n',
      },
    });
    const tarballBuf = packTarball(fileMap, '0.1.0');
    const fetch = makeFetchStub({
      packageName: 'create-wiki-llm',
      version: '0.1.0',
      tarballBuf,
    });

    const result = await update({
      repoRoot: sc.root,
      fetch,
      force: true,
      log: () => {},
    });

    assert.equal(result.appliedCount, 1);
    assert.equal(result.backup.count, 1);

    const backupTarget = path.join(result.backup.path, ...TARGET_SKILL.split('/'));
    assert.equal(readFileSync(backupTarget, 'utf8'), userBytes);

    const newDisk = readFileSync(skillAbs, 'utf8');
    assert.match(newDisk, /v0\.1\.0 update marker/);
    assert.doesNotMatch(newDisk, /s4 user customization/);

    const m = readManifest(sc.root);
    assert.equal(m.packageVersion, '0.1.0');
  } finally {
    sc.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Scenario 5 — --dry-run.
// ---------------------------------------------------------------------------

test('update: --dry-run prints plan, makes zero disk changes', async () => {
  const sc = await scaffold('s5');
  try {
    const before = fingerprintTree(sc.root);
    const beforeManifestBytes = readFileSync(manifestPath(sc.root), 'utf8');
    const fileMap = buildFixtureFileMap({
      packageVersion: '0.1.0',
      overrides: {
        [TARGET_SKILL]: templateBytes(TARGET_SKILL) + '\n<!-- v0.1.0 dry run -->\n',
      },
    });
    const tarballBuf = packTarball(fileMap, '0.1.0');
    const fetch = makeFetchStub({
      packageName: 'create-wiki-llm',
      version: '0.1.0',
      tarballBuf,
    });

    const result = await update({
      repoRoot: sc.root,
      fetch,
      dryRun: true,
      log: () => {},
    });

    assert.equal(result.dryRun, true);
    assert.ok(result.plan.length > 0);
    const overwrite = result.plan.find((e) => e.relPath === TARGET_SKILL);
    assert.ok(overwrite, 'plan should include the changed skill');
    assert.equal(overwrite.disposition, 'overwrite-clean');
    assert.equal(result.backup.count, 0);
    assert.equal(result.appliedCount, 0);

    const after = fingerprintTree(sc.root);
    const diff = diffFingerprints(before, after);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.removed, []);
    assert.deepEqual(diff.changed, []);

    // Manifest bytes are byte-identical to before the dry-run.
    assert.equal(readFileSync(manifestPath(sc.root), 'utf8'), beforeManifestBytes);

    // No backup directory.
    const backupsDir = path.join(sc.root, '.wiki-llm', 'backups');
    if (existsSync(backupsDir)) {
      assert.equal(readdirSync(backupsDir).length, 0);
    }
  } finally {
    sc.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Scenario 6 — disk === new edge case (Phase 5a option-A locked in).
// ---------------------------------------------------------------------------

test('update: disk === new — classifies as unchanged, no overwrite, no backup', async () => {
  const sc = await scaffold('s6');
  try {
    // Simulate a hand-edit that happens to land on the new shipped bytes:
    // overwrite the disk file with v0.1.0 bytes BEFORE the updater runs.
    // The new shipped content IS those exact bytes, so disk === new.
    const newSkillBytes =
      templateBytes(TARGET_SKILL) + '\n<!-- v0.1.0 update marker -->\n';
    writeFileSync(
      path.join(sc.root, ...TARGET_SKILL.split('/')),
      newSkillBytes,
      'utf8',
    );

    const fileMap = buildFixtureFileMap({
      packageVersion: '0.1.0',
      overrides: { [TARGET_SKILL]: newSkillBytes },
    });
    const tarballBuf = packTarball(fileMap, '0.1.0');
    const fetch = makeFetchStub({
      packageName: 'create-wiki-llm',
      version: '0.1.0',
      tarballBuf,
    });

    // Without --force, the update should succeed (because the file is
    // classified `unchanged`, not `overwrite-customized`).
    const result = await update({ repoRoot: sc.root, fetch, log: () => {} });

    const skillEntry = result.plan.find((e) => e.relPath === TARGET_SKILL);
    assert.ok(skillEntry, 'plan should include the skill file');
    assert.equal(
      skillEntry.disposition,
      'unchanged',
      'disk === new should classify as unchanged (Phase 5a option A)',
    );
    // Updater should not have written or backed up the file.
    assert.equal(result.appliedCount, 0);
    assert.equal(result.backup.count, 0);

    // Disk is still the new bytes (unchanged from our pre-update write).
    assert.equal(
      readFileSync(path.join(sc.root, ...TARGET_SKILL.split('/')), 'utf8'),
      newSkillBytes,
    );
  } finally {
    sc.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Scenario 7 — --keep-backups pruning.
// ---------------------------------------------------------------------------

test('update: --keep-backups prunes older directories beyond N', async () => {
  const sc = await scaffold('s7');
  try {
    const KEEP = 2;
    // Run KEEP+2 updates, each at a different `now` Date so backup dirs get
    // distinct timestamps and sort cleanly.
    const baseStamp = new Date('2026-01-01T00:00:00Z').getTime();
    const totalRuns = KEEP + 2; // produce > KEEP backup dirs

    for (let i = 0; i < totalRuns; i++) {
      const newVersion = `0.0.${i + 1}`;
      // Mutate a Package-zone file every run so the updater performs an
      // actual overwrite (otherwise it'd skip and create no backup).
      const newBytes =
        templateBytes(TARGET_SKILL) + `\n<!-- iter ${i} marker -->\n`;
      const fileMap = buildFixtureFileMap({
        packageVersion: newVersion,
        overrides: { [TARGET_SKILL]: newBytes },
      });
      const tarballBuf = packTarball(fileMap, newVersion);
      const fetch = makeFetchStub({
        packageName: 'create-wiki-llm',
        version: newVersion,
        tarballBuf,
      });
      // Stagger the timestamp so backup dir names sort uniquely.
      const now = new Date(baseStamp + i * 1000);
      await update({
        repoRoot: sc.root,
        fetch,
        keepBackups: KEEP,
        now,
        log: () => {},
      });
    }

    // After totalRuns updates, only KEEP backup dirs remain.
    const backupsDir = path.join(sc.root, '.wiki-llm', 'backups');
    assert.ok(existsSync(backupsDir), 'backups dir should exist');
    const dirs = readdirSync(backupsDir).sort();
    assert.equal(
      dirs.length,
      KEEP,
      `expected ${KEEP} backup dirs after pruning (got ${dirs.length}: ${dirs.join(', ')})`,
    );
  } finally {
    sc.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Scenario 8 — USER-DATA SURVIVAL (the strongest invariant the package offers).
// ---------------------------------------------------------------------------

test('update: USER-DATA SURVIVAL — knowledge-base/raw + wiki content untouched', async () => {
  const sc = await scaffold('s8-user-data');
  try {
    // Write two User-zone files with distinctive bytes.
    const SECRET_PATH = 'knowledge-base/raw/notes/secret.md';
    const MINE_PATH = 'knowledge-base/wiki/concepts/mine.md';
    const secretBytes = Buffer.from(
      '# Secret notes\n\nThis content MUST survive every update.\n',
      'utf8',
    );
    const mineBytes = Buffer.from(
      '# Mine\n\nA concept page authored by the user. Never touched by updates.\n',
      'utf8',
    );
    const secretAbs = path.join(sc.root, ...SECRET_PATH.split('/'));
    const mineAbs = path.join(sc.root, ...MINE_PATH.split('/'));
    mkdirSync(path.dirname(secretAbs), { recursive: true });
    mkdirSync(path.dirname(mineAbs), { recursive: true });
    writeFileSync(secretAbs, secretBytes);
    writeFileSync(mineAbs, mineBytes);

    const secretShaBefore = sha256(readFileSync(secretAbs));
    const mineShaBefore = sha256(readFileSync(mineAbs));

    // Run a v0.1.0 update with a Package-zone file change.
    const newSkillBytes =
      templateBytes(TARGET_SKILL) + '\n<!-- v0.1.0 update marker -->\n';
    const fileMap = buildFixtureFileMap({
      packageVersion: '0.1.0',
      overrides: { [TARGET_SKILL]: newSkillBytes },
    });
    const tarballBuf = packTarball(fileMap, '0.1.0');
    const fetch = makeFetchStub({
      packageName: 'create-wiki-llm',
      version: '0.1.0',
      tarballBuf,
    });

    const result = await update({ repoRoot: sc.root, fetch, log: () => {} });
    assert.equal(result.appliedCount, 1, 'expected the package update to actually apply something');

    // Both User-zone files must still exist.
    assert.ok(existsSync(secretAbs), 'secret.md must still exist after update');
    assert.ok(existsSync(mineAbs), 'mine.md must still exist after update');

    // Byte-identical (sha256 match).
    const secretShaAfter = sha256(readFileSync(secretAbs));
    const mineShaAfter = sha256(readFileSync(mineAbs));
    assert.equal(
      secretShaAfter,
      secretShaBefore,
      'CRITICAL: knowledge-base/raw/notes/secret.md was modified by the updater',
    );
    assert.equal(
      mineShaAfter,
      mineShaBefore,
      'CRITICAL: knowledge-base/wiki/concepts/mine.md was modified by the updater',
    );

    // UTF-8 content matches verbatim.
    assert.equal(readFileSync(secretAbs, 'utf8'), secretBytes.toString('utf8'));
    assert.equal(readFileSync(mineAbs, 'utf8'), mineBytes.toString('utf8'));

    // Also verify the Package-zone file actually moved (so the test is
    // exercising a real update, not a no-op).
    const updated = readFileSync(path.join(sc.root, ...TARGET_SKILL.split('/')), 'utf8');
    assert.match(updated, /v0\.1\.0 update marker/);
  } finally {
    sc.cleanup();
  }
});
