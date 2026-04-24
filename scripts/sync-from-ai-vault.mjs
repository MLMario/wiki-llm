#!/usr/bin/env node
// Sync source-of-truth files from the local ai_vault checkout into templates/.
//
// Source of truth (read-only, sibling checkout):
//   ../ai_vault/.claude/skills/kb-{drop,ingest,resolve,lint,query}/**
//   ../ai_vault/utils/pdf_to_markdown.py
//   ../ai_vault/requirements.txt
//
// Destination (overwritten byte-for-byte):
//   templates/.claude/skills/kb-*/**
//   templates/utils/pdf_to_markdown.py
//   templates/requirements.txt
//
// Idempotent: re-running with no upstream changes produces zero writes and
// logs "no changes". Logs every changed path on the first run after an
// upstream edit. Uses Node built-ins only; no dependencies.
//
// Invoked manually by the maintainer; not wired into CI.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = dirname(SCRIPT_DIR);
const AI_VAULT_ROOT = join(PACKAGE_ROOT, '..', 'ai_vault');
const TEMPLATES_ROOT = join(PACKAGE_ROOT, 'templates');

const SKILLS = ['kb-drop', 'kb-ingest', 'kb-resolve', 'kb-lint', 'kb-query'];

function listFilesRecursive(rootDir) {
  const out = [];
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (st.isFile()) {
        out.push(full);
      }
    }
  }
  if (existsSync(rootDir)) walk(rootDir);
  return out;
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function relPosix(from, to) {
  return relative(from, to).split('\\').join('/');
}

// Returns true if the file was written (created or content differed),
// false if it was already byte-identical on disk.
function copyIfDifferent(srcPath, dstPath) {
  const srcBuf = readFileSync(srcPath);
  if (existsSync(dstPath)) {
    const dstBuf = readFileSync(dstPath);
    if (srcBuf.equals(dstBuf)) {
      return false;
    }
  }
  ensureDir(dirname(dstPath));
  writeFileSync(dstPath, srcBuf);
  return true;
}

function syncTree(srcRoot, dstRoot, label) {
  if (!existsSync(srcRoot)) {
    throw new Error(`Source path does not exist: ${srcRoot}`);
  }
  const srcFiles = listFilesRecursive(srcRoot);
  const changed = [];
  for (const srcFile of srcFiles) {
    const rel = relPosix(srcRoot, srcFile);
    const dstFile = join(dstRoot, rel);
    if (copyIfDifferent(srcFile, dstFile)) {
      changed.push(`${label}/${rel}`);
    }
  }
  return { count: srcFiles.length, changed };
}

function syncFile(srcPath, dstPath, label) {
  if (!existsSync(srcPath)) {
    throw new Error(`Source file does not exist: ${srcPath}`);
  }
  const wrote = copyIfDifferent(srcPath, dstPath);
  return { changed: wrote ? [label] : [] };
}

function main() {
  const allChanged = [];
  let totalFiles = 0;

  // 1. Skill folders.
  for (const skill of SKILLS) {
    const src = join(AI_VAULT_ROOT, '.claude', 'skills', skill);
    const dst = join(TEMPLATES_ROOT, '.claude', 'skills', skill);
    const result = syncTree(src, dst, posix.join('.claude/skills', skill));
    totalFiles += result.count;
    allChanged.push(...result.changed);
  }

  // 2. utils/pdf_to_markdown.py
  {
    const src = join(AI_VAULT_ROOT, 'utils', 'pdf_to_markdown.py');
    const dst = join(TEMPLATES_ROOT, 'utils', 'pdf_to_markdown.py');
    const result = syncFile(src, dst, 'utils/pdf_to_markdown.py');
    totalFiles += 1;
    allChanged.push(...result.changed);
  }

  // 3. requirements.txt
  {
    const src = join(AI_VAULT_ROOT, 'requirements.txt');
    const dst = join(TEMPLATES_ROOT, 'requirements.txt');
    const result = syncFile(src, dst, 'requirements.txt');
    totalFiles += 1;
    allChanged.push(...result.changed);
  }

  console.log(`sync-from-ai-vault: scanned ${totalFiles} source files.`);
  if (allChanged.length === 0) {
    console.log('sync-from-ai-vault: no changes.');
  } else {
    console.log(`sync-from-ai-vault: wrote ${allChanged.length} file(s):`);
    for (const path of allChanged) {
      console.log(`  ${path}`);
    }
  }
}

main();
