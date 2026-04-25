#!/usr/bin/env node
// scripts/version-check.mjs
//
// Pre-publish guard. Reads package.json's version, queries the npm registry,
// and refuses to proceed if that exact version is already published.
//
// Behavior:
//   - 404 from registry -> package not yet published -> exit 0 (new).
//   - 200 with version present in .versions -> exit 1 (republish blocked).
//   - 200 with version absent -> exit 0 (new version of an existing package).
//   - Any other status or network error -> exit 1 (fail closed; safer to block
//     publish than risk a clobber if we cannot tell the registry's state).
//
// Node built-ins only. No deps.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import https from 'node:https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

function readPkg() {
  const raw = readFileSync(join(repoRoot, 'package.json'), 'utf8');
  const pkg = JSON.parse(raw);
  if (typeof pkg.name !== 'string' || pkg.name.length === 0) {
    throw new Error('package.json is missing a "name" field.');
  }
  if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
    throw new Error('package.json is missing a "version" field.');
  }
  return { name: pkg.name, version: pkg.version };
}

function fetchRegistry(name) {
  // Encode the package name so scoped names (`@scope/foo`) survive the URL.
  const encoded = encodeURIComponent(name).replace(/%40/g, '@');
  const url = `https://registry.npmjs.org/${encoded}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { accept: 'application/json' } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error('registry request timed out after 15s'));
    });
  });
}

async function main() {
  const { name, version } = readPkg();
  let result;
  try {
    result = await fetchRegistry(name);
  } catch (err) {
    console.error(`version-check: network error contacting registry: ${err.message}`);
    process.exit(1);
  }

  if (result.status === 404) {
    console.log(`version-check: ${name} not yet published; ${version} is new.`);
    process.exit(0);
  }

  if (result.status !== 200) {
    console.error(`version-check: HTTP ${result.status} from registry; refusing to proceed.`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(result.body);
  } catch (err) {
    console.error(`version-check: registry returned non-JSON body: ${err.message}`);
    process.exit(1);
  }

  const versions = parsed && typeof parsed === 'object' ? parsed.versions : null;
  if (versions && Object.prototype.hasOwnProperty.call(versions, version)) {
    console.error(
      `version-check: ${name}@${version} is already published. Bump version before publishing.`,
    );
    process.exit(1);
  }

  console.log(`version-check: ${name}@${version} is new; safe to publish.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`version-check: unexpected error: ${err.stack || err.message || err}`);
  process.exit(1);
});
