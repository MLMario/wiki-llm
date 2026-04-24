// helpers-phase4a.smoke.mjs — smoke tests for Phase 4a helper modules.
// Covers: path-safety, customization-check, tarball.
//
// Run with: `node test/helpers-phase4a.smoke.mjs`. Exits 0 on success, 1 on
// any failed assertion. Phase 5 will absorb these into the real node:test
// suite; they are intentionally lean here so CI's placeholder `npm test`
// still passes (this file is not run by CI).

import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { isPackageZonePath, validateTargetPath } from '../src/path-safety.mjs';
import { classifyFile } from '../src/customization-check.mjs';
import { parseTarball, fetchLatestTarball } from '../src/tarball.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

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

function assertThrows(fn, re, message) {
  try {
    fn();
    failed += 1;
    process.stdout.write(`  FAIL ${message} (expected throw)\n`);
  } catch (err) {
    if (re && !re.test(err.message)) {
      failed += 1;
      process.stdout.write(`  FAIL ${message} (wrong message: ${err.message})\n`);
      return;
    }
    passed += 1;
    process.stdout.write(`  ok  ${message}\n`);
  }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function testPathSafety() {
  process.stdout.write('\n== path-safety ==\n');

  // Package zone positives.
  assert(isPackageZonePath('.claude/skills/kb-drop/SKILL.md'), 'skill file is package zone');
  assert(
    isPackageZonePath('.claude/skills/kb-drop/reference/CONTEXT.md'),
    'skill reference is package zone',
  );
  assert(isPackageZonePath('utils/pdf_to_markdown.py'), 'utils file is package zone');
  assert(isPackageZonePath('requirements.txt'), 'requirements.txt is package zone');
  assert(isPackageZonePath('knowledge-base/CONTEXT.md'), 'knowledge-base/CONTEXT.md is package zone');

  // Seed + User zone negatives.
  assert(!isPackageZonePath('CLAUDE.md'), 'CLAUDE.md is seed (not package zone)');
  assert(!isPackageZonePath('README.md'), 'README.md is seed');
  assert(!isPackageZonePath('.gitignore'), '.gitignore is seed');
  assert(!isPackageZonePath('.claude/settings.json'), 'settings.json is seed');
  assert(!isPackageZonePath('knowledge-base/index.md'), 'index.md is seed');
  assert(!isPackageZonePath('knowledge-base/source_index.md'), 'source_index.md is seed');
  assert(!isPackageZonePath('knowledge-base/curriculum.md'), 'curriculum.md is seed');
  assert(!isPackageZonePath('knowledge-base/log.md'), 'log.md is user');
  assert(!isPackageZonePath('knowledge-base/raw/notes/mine.md'), 'raw/ content is user');
  assert(!isPackageZonePath('knowledge-base/wiki/concepts/mine.md'), 'wiki/ content is user');
  assert(
    !isPackageZonePath('.wiki-llm/backups/2026-04-24T10:00:00Z/foo'),
    'backups are user',
  );

  // Defensive rejections.
  assert(!isPackageZonePath(''), 'empty string rejected');
  assert(!isPackageZonePath('/absolute'), 'absolute path rejected');
  assert(!isPackageZonePath('..'), '`..` rejected');
  assert(!isPackageZonePath('../escape'), '`../escape` rejected');
  assert(
    !isPackageZonePath('.claude/skills/../../evil'),
    '`.claude/skills/../../evil` rejected (normalize escapes)',
  );
  assert(!isPackageZonePath('.claude/skills/'), 'bare skills/ prefix (no file) rejected');
  assert(!isPackageZonePath('.claude\\skills\\kb-drop\\SKILL.md'), 'backslashes rejected');

  // validateTargetPath — success cases.
  const root = path.resolve('/tmp/fake-repo'); // virtual root; no fs ops happen.
  const ok = validateTargetPath('utils/pdf_to_markdown.py', root);
  assert(
    ok === path.resolve(root, 'utils', 'pdf_to_markdown.py'),
    `validateTargetPath resolves inside root: got ${ok}`,
  );

  // validateTargetPath — failure cases.
  assertThrows(
    () => validateTargetPath('/etc/passwd', root),
    /absolute/,
    'absolute POSIX path rejected',
  );
  assertThrows(
    () => validateTargetPath('C:/Windows/System32/foo', root),
    /drive-letter/,
    'drive-letter path rejected',
  );
  assertThrows(
    () => validateTargetPath('../escape.md', root),
    /traversal/,
    '`..` prefix rejected',
  );
  assertThrows(
    () => validateTargetPath('utils/../../escape', root),
    /traversal|outside/,
    'mid-path `..` rejected',
  );
  assertThrows(
    () => validateTargetPath('utils\\x.py', root),
    /backslash/,
    'backslash input rejected',
  );
  assertThrows(
    () => validateTargetPath('', root),
    /non-empty/,
    'empty path rejected',
  );
  assertThrows(
    () => validateTargetPath('utils/x.py', 'not/absolute'),
    /absolute/,
    'non-absolute repoRoot rejected',
  );
}

async function testCustomizationCheck() {
  process.stdout.write('\n== customization-check ==\n');

  const oldM = {
    files: {
      'a.md': { sha256: 'aaa', templated: false },
      'b.md': { sha256: 'bbb', templated: false },
      'c.md': { sha256: 'ccc', templated: false },
      'd.md': { sha256: 'ddd', templated: false },
    },
  };
  const newM = {
    files: {
      // a.md: removed (present in old, absent in new)
      'b.md': { sha256: 'bbb', templated: false }, // unchanged
      'c.md': { sha256: 'ccc2', templated: false }, // changed + user clean
      'd.md': { sha256: 'ddd2', templated: false }, // changed + user modified
      'e.md': { sha256: 'eee', templated: false }, // added
    },
  };

  assert(
    classifyFile('a.md', oldM, newM, undefined) === 'removed',
    'file only in old is removed',
  );
  assert(
    classifyFile('b.md', oldM, newM, 'bbb') === 'unchanged',
    'file with same sha in both manifests is unchanged',
  );
  assert(
    classifyFile('c.md', oldM, newM, 'ccc') === 'overwrite-clean',
    'disk sha matches old manifest → overwrite-clean',
  );
  assert(
    classifyFile('d.md', oldM, newM, 'xyz') === 'overwrite-customized',
    'disk sha differs from old manifest → overwrite-customized',
  );
  assert(
    classifyFile('e.md', oldM, newM, undefined) === 'added',
    'file only in new is added (no diskSha needed)',
  );

  // Unreachable case.
  assertThrows(
    () => classifyFile('z.md', oldM, newM, undefined),
    /unreachable/,
    'file in neither manifest throws unreachable',
  );
}

async function testTarballLocal() {
  process.stdout.write('\n== tarball (local npm pack) ==\n');

  // Build a local tarball and feed its bytes into our parser.
  // Read the expected entry count from `npm pack --dry-run` so this test is
  // robust to new source files being added in later phases.
  const dryRunOut = execSync('npm pack --dry-run --json', { cwd: repoRoot }).toString();
  const dryRun = JSON.parse(dryRunOut);
  const expectedCount = dryRun[0].entryCount ?? dryRun[0].files.length;
  const tgz = execSync('npm pack --silent', { cwd: repoRoot }).toString().trim();
  const tgzPath = path.join(repoRoot, tgz);
  try {
    const buf = readFileSync(tgzPath);
    const files = parseTarball(buf);
    process.stdout.write(`  info parser extracted ${files.size} files (npm reported ${expectedCount})\n`);
    assert(
      files.size === expectedCount,
      `parser entry count matches npm pack (got ${files.size}, expected ${expectedCount})`,
    );

    // Spot-check 3 known file shas against on-disk values.
    const checks = [
      'templates/manifest.json',
      'templates/requirements.txt',
      'templates/knowledge-base/curriculum.md',
    ];
    for (const rel of checks) {
      const tarBuf = files.get(rel);
      assert(Buffer.isBuffer(tarBuf), `files.get(${rel}) is a Buffer`);
      // Compare with on-disk bytes.
      const diskBuf = readFileSync(path.join(repoRoot, rel));
      assert(
        sha256(tarBuf) === sha256(diskBuf),
        `${rel} sha256 matches on-disk bytes`,
      );
    }

    // Confirm there are no `package/` prefix keys — strip should have worked.
    let anyPkgPrefix = false;
    for (const k of files.keys()) {
      if (k.startsWith('package/')) {
        anyPkgPrefix = true;
        break;
      }
    }
    assert(!anyPkgPrefix, 'no keys retain `package/` prefix');

    // Confirm a known Package-zone file parsed cleanly.
    const skillBuf = files.get('templates/.claude/skills/kb-drop/SKILL.md');
    assert(Buffer.isBuffer(skillBuf) && skillBuf.length > 0, 'kb-drop SKILL.md extracted');
  } finally {
    if (existsSync(tgzPath)) unlinkSync(tgzPath);
  }
}

async function testTarballRemote() {
  process.stdout.write('\n== tarball (remote registry) ==\n');
  // Tiny public package for a mechanism check: `is-number` (~1KB).
  try {
    const { version, files } = await fetchLatestTarball('is-number');
    process.stdout.write(`  info is-number@${version} → ${files.size} files\n`);
    assert(typeof version === 'string' && /^\d+\.\d+\.\d+/.test(version), 'version is semver');
    assert(files.size > 0, 'files map non-empty');
    assert(files.has('package.json'), 'package.json extracted (prefix stripped)');
    const pkgBuf = files.get('package.json');
    const pkg = JSON.parse(pkgBuf.toString('utf8'));
    assert(pkg.name === 'is-number', 'package.json contents look correct');
  } catch (err) {
    process.stdout.write(`  SKIP remote test: ${err.message}\n`);
    // Network failures should not fail this smoke run; they're environmental.
  }
}

async function main() {
  await testPathSafety();
  await testCustomizationCheck();
  await testTarballLocal();
  await testTarballRemote();

  process.stdout.write(`\nResults: ${passed} passed, ${failed} failed.\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err && err.stack ? err.stack : err}\n`);
  process.exit(2);
});
