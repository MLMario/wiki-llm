#!/usr/bin/env node
// build-fixtures.mjs — regenerate test/fixtures/scaffolded-repo/ from the
// current templates/ directory. Invoked by `npm run fixtures:update`.
//
// Determinism contract:
//   - projectName  pinned to FIXTURE_PROJECT_NAME ('test-kb').
//   - createdDate  pinned to FIXTURE_CREATED_DATE ('2026-01-01'). Used by the
//                  scaffolder to substitute {{CREATED_DATE}} in templated files.
//   - target       written to test/fixtures/scaffolded-repo/.
//   - excludes     `.wiki-llm/manifest.json` is intentionally NOT included in
//                  the persisted fixture because its `scaffoldedAt` field is
//                  wall-clock-dependent. The scaffold-snapshot test excludes
//                  the same path from its fingerprint comparison.
//
// Re-running this script with no template changes must produce a byte-identical
// fixture tree (acceptance check 5 of Phase 5b).
//
// Usage: `node scripts/build-fixtures.mjs` — overwrites the fixture in place.
// Node built-ins only.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { init } from '../src/init.mjs';

export const FIXTURE_PROJECT_NAME = 'test-kb';
export const FIXTURE_CREATED_DATE = '2026-01-01';
export const FIXTURE_REL_PATH = 'test/fixtures/scaffolded-repo';
// `.wiki-llm/manifest.json` is excluded from the fixture because its
// `scaffoldedAt` field embeds a wall-clock timestamp and is not deterministic.
// The matching exclusion lives in test/scaffold-snapshot.test.mjs.
export const FIXTURE_EXCLUDE_PATHS = Object.freeze(['.wiki-llm/manifest.json']);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot = path.join(repoRoot, ...FIXTURE_REL_PATH.split('/'));

/**
 * Scaffold a fresh repo at the fixture path with deterministic inputs and
 * strip non-deterministic artefacts before returning. Caller is responsible
 * for clearing the destination first.
 *
 * @param {string} targetDir  absolute path to scaffold into
 */
async function scaffoldDeterministic(targetDir) {
  await init({
    targetDir,
    projectName: FIXTURE_PROJECT_NAME,
    createdDate: FIXTURE_CREATED_DATE,
    log: () => {}, // silence banner
  });

  // Strip excluded paths post-scaffold (manifest.json is the only one).
  for (const rel of FIXTURE_EXCLUDE_PATHS) {
    const abs = path.join(targetDir, ...rel.split('/'));
    if (existsSync(abs)) {
      try {
        unlinkSync(abs);
      } catch (_e) {
        /* best-effort */
      }
    }
  }
  // If `.wiki-llm/` ends up empty after we strip the manifest, drop the dir.
  const wikiLlmDir = path.join(targetDir, '.wiki-llm');
  if (existsSync(wikiLlmDir)) {
    const entries = readdirSync(wikiLlmDir);
    if (entries.length === 0) {
      rmSync(wikiLlmDir, { recursive: true, force: true });
    }
  }
}

/**
 * Scaffold the deterministic fixture tree at `fixtureRoot`. Exposed so
 * `test/scaffold-snapshot.test.mjs` can re-use the same logic when generating
 * the in-memory comparison tree.
 *
 * @param {string} fixtureRoot  absolute path to scaffold into
 */
export async function buildFixtureTree(fixtureRoot) {
  await scaffoldDeterministic(fixtureRoot);
}

async function main() {
  // Wipe and recreate fixture root.
  if (existsSync(fixtureRoot)) {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
  mkdirSync(path.dirname(fixtureRoot), { recursive: true });

  // Scaffold into a sibling tempdir first so a partial failure cannot leave
  // a half-written fixture in place. On success, atomically swap.
  const tmp = fixtureRoot + '.tmp';
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  try {
    await scaffoldDeterministic(tmp);
    cpSync(tmp, fixtureRoot, { recursive: true });
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch (_e) {
      /* best-effort */
    }
  }

  process.stdout.write(`Wrote fixture at ${fixtureRoot}\n`);
}

// Run main() only when invoked as a script, not when imported.
function isMainEntry() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch (_err) {
    return false;
  }
}

if (isMainEntry()) {
  main().catch((err) => {
    process.stderr.write(`Fatal: ${err && err.stack ? err.stack : err}\n`);
    process.exit(2);
  });
}
