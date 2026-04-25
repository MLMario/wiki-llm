// safety.test.mjs — negative-case tests for the updater.
//
// Covers every scenario from design §4 "Update-time failure modes" plus the
// path-safety edge cases. These tests intentionally try to break the updater
// with malformed inputs, malicious tarballs, traversal attempts, and missing
// state. The expected outcome in every case is a clear refusal — never a
// partial overwrite, never a write to disk, never a write outside the
// scaffolded repo root.
//
// Strategy:
//   - Reuse helpers from test/helpers.mjs (`buildTarball`, `fakeFetch`,
//     `makeTempDir`, `fingerprintTree`, `diffFingerprints`).
//   - Build a "valid v0.1.0 fixture" tarball using the real templates dir,
//     then mutate the manifest or file map to introduce one specific failure
//     per test.
//   - Capture a fingerprint before the update attempt and assert no disk
//     mutation after the failure.
//
// Node built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

import { init } from '../src/init.mjs';
import { update } from '../src/update.mjs';
import { manifestPath } from '../src/manifest.mjs';
import {
  buildTarball,
  diffFingerprints,
  fakeFetch,
  fingerprintTree,
  makeTempDir,
  sha256 as helperSha,
} from './helpers.mjs';
import {
  isPackageZonePath,
  validateTargetPath,
} from '../src/path-safety.mjs';

// ---------------------------------------------------------------------------
// Shared setup helpers (cousins of the ones in update-integration.test.mjs;
// kept here verbatim so each test file can be read in isolation).
// ---------------------------------------------------------------------------

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

function buildTemplateManifest(templateMap, packageVersion, extraEntries = {}) {
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
  for (const [k, v] of Object.entries(extraEntries)) {
    files[k] = v;
  }
  return Buffer.from(
    JSON.stringify({ manifestVersion: 1, packageVersion, files }, null, 2) + '\n',
    'utf8',
  );
}

function buildFixtureFileMap({ packageVersion, overrides, extraManifestEntries }) {
  const tpl = buildTemplateMap(overrides);
  const manifest = buildTemplateManifest(tpl, packageVersion, extraManifestEntries);
  tpl.set('templates/manifest.json', manifest);
  return tpl;
}

function packTarball(fileMap, packageVersion) {
  return buildTarball({
    files: fileMap,
    name: 'package',
    version: packageVersion,
    gzip: true,
  });
}

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

async function scaffold(label) {
  const tmp = makeTempDir(`safety-${label}`);
  await init({
    targetDir: tmp.path,
    projectName: 'test-kb',
    createdDate: '2026-01-01',
    log: () => {},
  });
  return { root: tmp.path, cleanup: tmp.cleanup };
}

// ---------------------------------------------------------------------------
// Scenario 1 — corrupt manifest.
// ---------------------------------------------------------------------------

test('safety: corrupt manifest (invalid JSON) → EENV, no disk changes', async () => {
  const sc = await scaffold('s1-corrupt');
  try {
    // Replace .wiki-llm/manifest.json with garbage bytes.
    writeFileSync(manifestPath(sc.root), '{{not valid json::', 'utf8');
    const before = fingerprintTree(sc.root);

    const fileMap = buildFixtureFileMap({ packageVersion: '0.1.0' });
    const tarballBuf = packTarball(fileMap, '0.1.0');
    const fetch = makeFetchStub({
      packageName: 'create-wiki-llm',
      version: '0.1.0',
      tarballBuf,
    });

    await assert.rejects(
      () => update({ repoRoot: sc.root, fetch, log: () => {} }),
      (err) => err.code === 'EENV' && /not valid JSON|JSON/i.test(err.message),
      'expected EENV citing JSON parse failure',
    );

    const after = fingerprintTree(sc.root);
    const diff = diffFingerprints(before, after);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.removed, []);
    assert.deepEqual(diff.changed, []);
  } finally {
    sc.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Scenario 2 — missing manifest.
// ---------------------------------------------------------------------------

test('safety: missing manifest → EENV, no disk changes', async () => {
  const sc = await scaffold('s2-missing');
  try {
    unlinkSync(manifestPath(sc.root));
    const before = fingerprintTree(sc.root);

    const fileMap = buildFixtureFileMap({ packageVersion: '0.1.0' });
    const tarballBuf = packTarball(fileMap, '0.1.0');
    const fetch = makeFetchStub({
      packageName: 'create-wiki-llm',
      version: '0.1.0',
      tarballBuf,
    });

    await assert.rejects(
      () => update({ repoRoot: sc.root, fetch, log: () => {} }),
      (err) => err.code === 'EENV' && /not found|wiki-llm repo|Manifest/i.test(err.message),
      'expected EENV citing missing manifest',
    );

    const after = fingerprintTree(sc.root);
    const diff = diffFingerprints(before, after);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.removed, []);
    assert.deepEqual(diff.changed, []);
  } finally {
    sc.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Scenario 3 — Tarball with Seed-zone entry (Guard 2 silently skips).
// ---------------------------------------------------------------------------

test('safety: tarball entry in Seed/User zone is silently skipped (Guard 2)', async () => {
  const sc = await scaffold('s3-seed-zone');
  try {
    // Add a malicious entry under knowledge-base/raw/. The Package-zone
    // allowlist (Guard 2) is hardcoded — this should be classified as
    // "outside Package zone" and skipped (per design §4: log and skip).
    const evilContent = Buffer.from('# evil seed-zone overwrite\n', 'utf8');
    const fileMap = buildFixtureFileMap({
      packageVersion: '0.0.1',
      overrides: { 'knowledge-base/raw/evil.md': evilContent },
    });
    const tarballBuf = packTarball(fileMap, '0.0.1');
    const fetch = makeFetchStub({
      packageName: 'create-wiki-llm',
      version: '0.0.1',
      tarballBuf,
    });

    const before = fingerprintTree(sc.root);
    const result = await update({ repoRoot: sc.root, fetch, log: () => {} });

    // The tarball entry must NOT have been written to disk.
    const evilAbs = path.join(sc.root, 'knowledge-base', 'raw', 'evil.md');
    assert.equal(
      existsSync(evilAbs),
      false,
      'CRITICAL: Seed-zone tarball entry was written to disk despite Guard 2',
    );

    // The plan should not include the evil entry (skipped silently).
    const evilInPlan = result.plan.find((e) => e.relPath === 'knowledge-base/raw/evil.md');
    assert.equal(
      evilInPlan,
      undefined,
      'Seed-zone entries should be skipped during planning, not classified',
    );
    // It should appear in the skipped list.
    assert.ok(
      result.skipped.includes('knowledge-base/raw/evil.md'),
      `expected 'knowledge-base/raw/evil.md' in skipped list (got ${JSON.stringify(result.skipped)})`,
    );

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

    // Sanity check: the Guard 2 helper would have rejected the path itself.
    assert.equal(
      isPackageZonePath('knowledge-base/raw/evil.md'),
      false,
      'isPackageZonePath should never accept knowledge-base/raw/* paths',
    );
  } finally {
    sc.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Scenario 4 — Tarball with traversal entry (Guard 3 hard-fails).
// ---------------------------------------------------------------------------

test('safety: tarball entry with `../` traversal → EENV, no disk changes', async () => {
  const sc = await scaffold('s4-traversal');
  try {
    // The malicious manifest entry's key uses `..` to escape repoRoot.
    // Guard 3 (validateTargetPath) hard-fails on these.
    const evilSha = helperSha(Buffer.from('evil', 'utf8'));
    const tpl = buildTemplateMap();
    // Drop in a manifest with the malicious entry, but DON'T drop in a
    // matching tarball file -- the planner sees the manifest entry via the
    // unioned key list and validates the path before any read.
    const manifest = buildTemplateManifest(tpl, '0.0.1', {
      '../escape.md': { sha256: evilSha, templated: false },
    });
    tpl.set('templates/manifest.json', manifest);
    const tarballBuf = packTarball(tpl, '0.0.1');
    const fetch = makeFetchStub({
      packageName: 'create-wiki-llm',
      version: '0.0.1',
      tarballBuf,
    });

    const before = fingerprintTree(sc.root);
    await assert.rejects(
      () => update({ repoRoot: sc.root, fetch, log: () => {} }),
      (err) => err.code === 'EENV' && /unsafe|traversal/i.test(err.message),
      'expected EENV citing path traversal',
    );

    const after = fingerprintTree(sc.root);
    const diff = diffFingerprints(before, after);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.removed, []);
    assert.deepEqual(diff.changed, []);

    // Sanity check Guard 3 isolated.
    assert.throws(
      () => validateTargetPath('../escape.md', sc.root),
      /traversal/,
      'validateTargetPath should reject ../escape.md outright',
    );
  } finally {
    sc.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Scenario 5 — Tarball with absolute path (Guard 3 hard-fails).
// ---------------------------------------------------------------------------

test('safety: tarball entry with absolute /etc/passwd path → EENV, no disk changes', async () => {
  const sc = await scaffold('s5-absolute');
  try {
    const evilSha = helperSha(Buffer.from('evil', 'utf8'));
    const tpl = buildTemplateMap();
    const manifest = buildTemplateManifest(tpl, '0.0.1', {
      '/etc/passwd': { sha256: evilSha, templated: false },
    });
    tpl.set('templates/manifest.json', manifest);
    const tarballBuf = packTarball(tpl, '0.0.1');
    const fetch = makeFetchStub({
      packageName: 'create-wiki-llm',
      version: '0.0.1',
      tarballBuf,
    });

    const before = fingerprintTree(sc.root);
    await assert.rejects(
      () => update({ repoRoot: sc.root, fetch, log: () => {} }),
      (err) =>
        err.code === 'EENV' &&
        /unsafe|absolute|traversal/i.test(err.message),
      'expected EENV citing absolute path rejection',
    );

    const after = fingerprintTree(sc.root);
    const diff = diffFingerprints(before, after);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.removed, []);
    assert.deepEqual(diff.changed, []);

    // Sanity check Guard 3 isolated.
    assert.throws(
      () => validateTargetPath('/etc/passwd', sc.root),
      /absolute|absolute path/,
      'validateTargetPath should reject /etc/passwd outright',
    );

    // Sanity: the file does not exist on disk anywhere we could detect.
    // (We deliberately don't attempt `fs.existsSync('/etc/passwd')` since
    // it's a real file on Unix; instead, we trust the no-disk-changes
    // assertion above to cover scaffolded-repo state.)
  } finally {
    sc.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Scenario 6 — running --update outside a scaffolded repo.
// ---------------------------------------------------------------------------

test('safety: --update outside a wiki-llm repo → EENV (no .wiki-llm/manifest.json)', async () => {
  const tmp = makeTempDir('safety-s6-no-repo');
  try {
    // Empty dir, no .wiki-llm/ at all.
    const fileMap = buildFixtureFileMap({ packageVersion: '0.1.0' });
    const tarballBuf = packTarball(fileMap, '0.1.0');
    const fetch = makeFetchStub({
      packageName: 'create-wiki-llm',
      version: '0.1.0',
      tarballBuf,
    });

    const before = fingerprintTree(tmp.path);
    await assert.rejects(
      () => update({ repoRoot: tmp.path, fetch, log: () => {} }),
      (err) =>
        err.code === 'EENV' &&
        /not found|wiki-llm repo|Manifest/i.test(err.message),
      'expected EENV citing missing manifest / not-a-wiki-llm-repo',
    );

    const after = fingerprintTree(tmp.path);
    const diff = diffFingerprints(before, after);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.removed, []);
    assert.deepEqual(diff.changed, []);
  } finally {
    tmp.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Scenario 7 — major version bump.
// ---------------------------------------------------------------------------

test('safety: major version bump (0.x → 1.0.0) → EENV with migration link', async () => {
  const sc = await scaffold('s7-major');
  try {
    const fileMap = buildFixtureFileMap({ packageVersion: '1.0.0' });
    const tarballBuf = packTarball(fileMap, '1.0.0');
    const fetch = makeFetchStub({
      packageName: 'create-wiki-llm',
      version: '1.0.0',
      tarballBuf,
    });

    const before = fingerprintTree(sc.root);
    await assert.rejects(
      () => update({ repoRoot: sc.root, fetch, log: () => {} }),
      (err) =>
        err.code === 'EENV' &&
        /major version/i.test(err.message) &&
        /MIGRATION/i.test(err.message),
      'expected EENV citing major version bump and migration doc',
    );

    const after = fingerprintTree(sc.root);
    const diff = diffFingerprints(before, after);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.removed, []);
    assert.deepEqual(diff.changed, []);
  } finally {
    sc.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Scenario 8 — `utils/..` edge case.
//
// Decision (Phase 5b): TIGHTEN. validateTargetPath now rejects any path that
// normalizes to '' / '.' / './' (collapse-to-repo-root). The downstream
// allowlist gate (Guard 2) would also have stopped a write, but rejecting
// at Guard 3 is defense-in-depth and catches the case where Guard 2 is ever
// weakened in the future. See src/path-safety.mjs comment for the locked-in
// behavior.
// ---------------------------------------------------------------------------

test('safety: utils/.. (collapses to .) is rejected by validateTargetPath', () => {
  assert.throws(
    () => validateTargetPath('utils/..', repoRoot),
    /collapses to repository root|traversal/,
    'expected utils/.. to be rejected (Phase 5b strengthening)',
  );
});

test('safety: bare "." is rejected by validateTargetPath', () => {
  assert.throws(
    () => validateTargetPath('.', repoRoot),
    /collapses to repository root/,
  );
});

test('safety: tarball with utils/.. manifest entry → EENV, no disk changes', async () => {
  const sc = await scaffold('s8-utils-dotdot');
  try {
    const evilSha = helperSha(Buffer.from('evil', 'utf8'));
    const tpl = buildTemplateMap();
    const manifest = buildTemplateManifest(tpl, '0.0.1', {
      'utils/..': { sha256: evilSha, templated: false },
    });
    tpl.set('templates/manifest.json', manifest);
    const tarballBuf = packTarball(tpl, '0.0.1');
    const fetch = makeFetchStub({
      packageName: 'create-wiki-llm',
      version: '0.0.1',
      tarballBuf,
    });

    const before = fingerprintTree(sc.root);
    await assert.rejects(
      () => update({ repoRoot: sc.root, fetch, log: () => {} }),
      (err) =>
        err.code === 'EENV' &&
        /collapses to repository root|unsafe|traversal/i.test(err.message),
      'expected EENV citing collapse-to-root rejection',
    );

    const after = fingerprintTree(sc.root);
    const diff = diffFingerprints(before, after);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.removed, []);
    assert.deepEqual(diff.changed, []);
  } finally {
    sc.cleanup();
  }
});
