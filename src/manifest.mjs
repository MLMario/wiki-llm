// manifest.mjs — read/write `.wiki-llm/manifest.json` and compute sha256 hashes.
// Node built-ins only.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Compute sha256 (hex, lowercase) of a Buffer or string.
 * @param {Buffer|string} buffer
 * @returns {string}
 */
export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Resolve the runtime manifest path inside a scaffolded repo.
 * @param {string} repoRoot
 * @returns {string}
 */
export function manifestPath(repoRoot) {
  return path.join(repoRoot, '.wiki-llm', 'manifest.json');
}

/**
 * Read `.wiki-llm/manifest.json` from a scaffolded repo. Validates that
 * `manifestVersion === 1`. Throws clear errors on missing file, parse failure,
 * or unsupported manifest version.
 * @param {string} repoRoot
 * @returns {object}
 */
export function readManifest(repoRoot) {
  const p = manifestPath(repoRoot);
  if (!existsSync(p)) {
    throw new Error(`Manifest not found at ${p} — this does not look like a wiki-llm repo.`);
  }
  let raw;
  try {
    raw = readFileSync(p, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read manifest at ${p}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Manifest at ${p} is not valid JSON: ${err.message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Manifest at ${p} is not a JSON object.`);
  }
  if (parsed.manifestVersion !== 1) {
    throw new Error(
      `Unsupported manifestVersion ${JSON.stringify(parsed.manifestVersion)} at ${p}. ` +
        `This CLI understands manifestVersion 1.`,
    );
  }
  return parsed;
}

/**
 * Atomically write `.wiki-llm/manifest.json`. Writes to `manifest.json.tmp`,
 * then renames into place. Creates the `.wiki-llm/` directory if absent.
 * Output is JSON with 2-space indent and trailing newline (LF).
 * @param {string} repoRoot
 * @param {object} manifest
 */
export function writeManifest(repoRoot, manifest) {
  const p = manifestPath(repoRoot);
  const dir = path.dirname(p);
  mkdirSync(dir, { recursive: true });
  const tmp = p + '.tmp';
  const body = JSON.stringify(manifest, null, 2) + '\n';
  writeFileSync(tmp, body, { encoding: 'utf8' });
  renameSync(tmp, p);
}
