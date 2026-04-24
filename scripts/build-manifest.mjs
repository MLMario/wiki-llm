#!/usr/bin/env node
// Generate templates/manifest.json: deterministic, sorted, with sha256 + templated flag.
// Node built-ins only.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const templatesDir = path.join(repoRoot, 'templates');
const manifestPath = path.join(templatesDir, 'manifest.json');
const packageJsonPath = path.join(repoRoot, 'package.json');

// Files that receive {{VAR}} substitution at scaffold time.
// Keys are POSIX-style paths relative to templates/.
const TEMPLATED_FILES = new Set([
  'CLAUDE.md',
  'README.md',
  'knowledge-base/index.md',
  'knowledge-base/curriculum.md',
]);

function walk(dir, baseDir, acc) {
  const entries = readdirSync(dir);
  for (const name of entries) {
    const abs = path.join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      walk(abs, baseDir, acc);
    } else if (st.isFile()) {
      const rel = path.relative(baseDir, abs);
      const posixRel = rel.split(path.sep).join('/');
      // Skip the manifest itself.
      if (posixRel === 'manifest.json') continue;
      acc.push({ posixRel, abs });
    }
  }
  return acc;
}

function sha256OfFile(absPath) {
  const buf = readFileSync(absPath);
  return createHash('sha256').update(buf).digest('hex');
}

function main() {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const packageVersion = pkg.version;

  const found = walk(templatesDir, templatesDir, []);
  // Lexicographic byte order on the posix path string.
  found.sort((a, b) => (a.posixRel < b.posixRel ? -1 : a.posixRel > b.posixRel ? 1 : 0));

  const files = {};
  for (const { posixRel, abs } of found) {
    files[posixRel] = {
      sha256: sha256OfFile(abs),
      templated: TEMPLATED_FILES.has(posixRel),
    };
  }

  const manifest = {
    manifestVersion: 1,
    packageVersion,
    files,
  };

  // 2-space indent, trailing newline, LF line endings.
  const out = JSON.stringify(manifest, null, 2) + '\n';
  writeFileSync(manifestPath, out, { encoding: 'utf8' });
  process.stdout.write(`Wrote ${manifestPath} (${found.length} files)\n`);
}

main();
