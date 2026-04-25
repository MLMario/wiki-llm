// scaffold-snapshot.test.mjs — golden-file test for the scaffold output.
//
// Runs the scaffolder with deterministic inputs, fingerprints the resulting
// tree, and compares against the persisted fixture under
// `test/fixtures/scaffolded-repo/`. The fixture is written by
// `npm run fixtures:update` (scripts/build-fixtures.mjs).
//
// Determinism rules:
//   - projectName  pinned to FIXTURE_PROJECT_NAME from build-fixtures.mjs.
//   - createdDate  pinned to FIXTURE_CREATED_DATE from build-fixtures.mjs.
//   - excludes     `.wiki-llm/manifest.json` is filtered from BOTH sides of
//                  the comparison; its `scaffoldedAt` field is wall-clock-
//                  dependent. The same exclusion is encoded in
//                  build-fixtures.mjs so the persisted fixture and the live
//                  scaffold compare apples-to-apples.
//
// Failure mode: when a templates/ change shifts a sha, this test fails with a
// per-file added/removed/changed list and the recovery instruction
// "run `npm run fixtures:update`".
//
// Node built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  diffFingerprints,
  fingerprintTree,
  makeTempDir,
} from './helpers.mjs';
import {
  FIXTURE_CREATED_DATE,
  FIXTURE_EXCLUDE_PATHS,
  FIXTURE_PROJECT_NAME,
  FIXTURE_REL_PATH,
  buildFixtureTree,
} from '../scripts/build-fixtures.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const fixtureDir = path.join(repoRoot, ...FIXTURE_REL_PATH.split('/'));

/**
 * Strip excluded paths from a fingerprint Map (mutates `fp` in place).
 *
 * @param {Map<string, string>} fp
 * @returns {Map<string, string>}
 */
function stripExclusions(fp) {
  for (const rel of FIXTURE_EXCLUDE_PATHS) {
    fp.delete(rel);
  }
  return fp;
}

test('scaffold-snapshot: exists at the documented relative path', () => {
  const got = fingerprintTree(fixtureDir);
  assert.ok(
    got.size > 0,
    `Fixture tree at ${fixtureDir} is empty or missing. ` +
      `Run \`npm run fixtures:update\` to regenerate it.`,
  );
});

test('scaffold-snapshot: matches a fresh deterministic scaffold', async () => {
  const tmp = makeTempDir('scaffold-snapshot');
  try {
    await buildFixtureTree(tmp.path);
    const live = stripExclusions(fingerprintTree(tmp.path));
    const baseline = stripExclusions(fingerprintTree(fixtureDir));

    const diff = diffFingerprints(baseline, live);
    const drift = diff.added.length + diff.removed.length + diff.changed.length;
    if (drift > 0) {
      const lines = [];
      lines.push(`Scaffold snapshot drift detected (${drift} file(s)).`);
      if (diff.added.length > 0) {
        lines.push(`  added (in live, not in fixture):`);
        for (const p of diff.added) lines.push(`    + ${p}`);
      }
      if (diff.removed.length > 0) {
        lines.push(`  removed (in fixture, not in live):`);
        for (const p of diff.removed) lines.push(`    - ${p}`);
      }
      if (diff.changed.length > 0) {
        lines.push(`  changed (sha differs):`);
        for (const p of diff.changed) lines.push(`    ~ ${p}`);
      }
      lines.push('');
      lines.push('  To regenerate the fixture, run:');
      lines.push('    npm run fixtures:update');
      lines.push(
        '  Then commit the resulting changes under ' +
          `${FIXTURE_REL_PATH}/`,
      );
      assert.fail(lines.join('\n'));
    }
  } finally {
    tmp.cleanup();
  }
});

test('scaffold-snapshot: substituted {{PROJECT_NAME}} appears in templated files', () => {
  const tmp = makeTempDir('scaffold-snapshot-vars');
  // Note: this test re-runs the scaffolder in a fresh tmpdir to verify
  // substitution end-to-end without relying on the fixture (defends against
  // regressions in template.mjs even if the fixture is stale).
  return (async () => {
    try {
      await buildFixtureTree(tmp.path);
      const fp = fingerprintTree(tmp.path);
      // Just spot-check that the templated files exist (their contents are
      // covered by the fingerprint comparison above).
      for (const rel of [
        'CLAUDE.md',
        'README.md',
        'knowledge-base/index.md',
        'knowledge-base/curriculum.md',
      ]) {
        assert.ok(fp.has(rel), `expected templated file ${rel} to be scaffolded`);
      }
      // And cross-check: NO file's content contains the literal
      // `{{PROJECT_NAME}}` placeholder after substitution. We do this with a
      // direct read on a templated file to keep the assertion sharp.
      const fs = await import('node:fs');
      const claudeMd = fs.readFileSync(path.join(tmp.path, 'CLAUDE.md'), 'utf8');
      assert.ok(
        !claudeMd.includes('{{PROJECT_NAME}}'),
        'CLAUDE.md still contains {{PROJECT_NAME}} placeholder after substitution',
      );
      assert.ok(
        claudeMd.includes(FIXTURE_PROJECT_NAME),
        `CLAUDE.md should mention the fixture project name (${FIXTURE_PROJECT_NAME})`,
      );
      const readmeMd = fs.readFileSync(path.join(tmp.path, 'README.md'), 'utf8');
      assert.ok(
        !readmeMd.includes('{{CREATED_DATE}}'),
        'README.md still contains {{CREATED_DATE}} placeholder after substitution',
      );
      assert.ok(
        readmeMd.includes(FIXTURE_CREATED_DATE),
        `README.md should mention the fixture created date (${FIXTURE_CREATED_DATE})`,
      );
    } finally {
      tmp.cleanup();
    }
  })();
});
