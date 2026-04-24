// init.mjs — scaffold a new wiki-llm repo into a target directory.
// Node built-ins only.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sha256, writeManifest } from './manifest.mjs';
import { substitute } from './template.mjs';

const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

/**
 * Validate a project-name candidate. Returns null if valid; otherwise an
 * error string explaining why it was rejected.
 * @param {string} name
 * @returns {string|null}
 */
export function validateProjectName(name) {
  if (typeof name !== 'string') return 'projectName must be a string';
  if (name.length === 0) return 'projectName must not be empty';
  if (name !== name.trim()) {
    return 'projectName must not start or end with whitespace';
  }
  if (name.startsWith('.') || name.endsWith('.')) {
    return 'projectName must not start or end with a dot';
  }
  if (name.includes('/') || name.includes('\\')) {
    return 'projectName must not contain path separators';
  }
  // Reject NUL byte and control characters that some file systems forbid.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(name)) {
    return 'projectName must not contain control characters';
  }
  // Windows-reserved device names (case-insensitive, ignoring trailing extension).
  const baseUpper = name.split('.')[0].toUpperCase();
  if (WINDOWS_RESERVED_NAMES.has(baseUpper)) {
    return `projectName "${name}" is a reserved name on Windows`;
  }
  return null;
}

/**
 * Locate the templates directory bundled with this package. Resolves relative
 * to this module's URL so it works whether invoked via `node src/cli.mjs`
 * locally or via `npx create-wiki-llm`.
 * @returns {string} absolute path to the templates dir
 */
export function resolveTemplatesDir() {
  const here = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(here), '..');
  return path.join(packageRoot, 'templates');
}

/**
 * Recursively list every regular file under `dir` (relative to `baseDir`).
 * Returns POSIX-keyed relative paths. Excludes the manifest.json at the
 * templates root since the runtime manifest is generated from disk shas, not
 * copied verbatim.
 * @param {string} dir
 * @param {string} baseDir
 * @returns {Array<{ posixRel: string, abs: string }>}
 */
function walkTemplates(dir, baseDir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const entries = readdirSync(current);
    entries.sort();
    for (const name of entries) {
      const abs = path.join(current, name);
      const st = statSync(abs);
      if (st.isDirectory()) {
        stack.push(abs);
      } else if (st.isFile()) {
        const rel = path.relative(baseDir, abs);
        const posixRel = rel.split(path.sep).join('/');
        if (posixRel === 'manifest.json') continue;
        out.push({ posixRel, abs });
      }
    }
  }
  out.sort((a, b) => (a.posixRel < b.posixRel ? -1 : a.posixRel > b.posixRel ? 1 : 0));
  return out;
}

/**
 * Read the template manifest (`templates/manifest.json`) so we can:
 *   - look up which files are templated (require `{{VAR}}` substitution),
 *   - record `packageVersion` in the runtime manifest.
 * @param {string} templatesDir
 * @returns {{ packageVersion: string, templated: Set<string> }}
 */
function readTemplateManifest(templatesDir) {
  const p = path.join(templatesDir, 'manifest.json');
  if (!existsSync(p)) {
    throw new Error(
      `Template manifest missing at ${p}. The package may be corrupted; ` +
        'try reinstalling create-wiki-llm.',
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(p, 'utf8'));
  } catch (err) {
    throw new Error(`Template manifest at ${p} is not valid JSON: ${err.message}`);
  }
  const templated = new Set();
  for (const [key, entry] of Object.entries(parsed.files || {})) {
    if (entry && entry.templated === true) templated.add(key);
  }
  return { packageVersion: parsed.packageVersion, templated };
}

/**
 * Determine whether a directory is "non-empty" for the scaffolder's purposes.
 * Returns true if the dir exists and contains at least one entry.
 * @param {string} dir
 * @returns {boolean}
 */
function dirIsNonEmpty(dir) {
  if (!existsSync(dir)) return false;
  const entries = readdirSync(dir);
  return entries.length > 0;
}

/**
 * Print the post-scaffold banner. Short, no emoji.
 * @param {string} targetDir
 * @param {string} projectName
 * @param {(line: string) => void} log
 */
function printBanner(targetDir, projectName, log) {
  log('');
  log(`Scaffolded ${projectName} at ${targetDir}`);
  log('');
  log('Next steps:');
  log(`  cd ${targetDir}`);
  log('  pip install -r requirements.txt   # optional, for local PDF drops');
  log('  git init && git add . && git commit -m "initial"   # optional');
  log('  Open in Claude Code, then try /kb-drop <url> followed by /kb-ingest');
  log('  See CLAUDE.md for the full architecture.');
  log('');
}

/**
 * Run the scaffold flow.
 * @param {object} options
 * @param {string} options.targetDir   Absolute or CWD-relative path to scaffold into.
 * @param {string} [options.projectName]   Defaults to basename(targetDir).
 * @param {boolean} [options.force]   Overwrite a non-empty target dir.
 * @param {string} [options.createdDate]   YYYY-MM-DD; defaults to today's UTC date.
 * @param {string} [options.cwd]   Defaults to process.cwd().
 * @param {(line: string) => void} [options.log]   Defaults to console.log.
 * @returns {Promise<{ targetDir: string, written: number }>}
 */
export async function init(options) {
  const cwd = options.cwd ?? process.cwd();
  const log = options.log ?? ((line) => process.stdout.write(line + '\n'));

  if (!options.targetDir || typeof options.targetDir !== 'string') {
    const err = new Error('init(): targetDir is required');
    err.code = 'EUSER';
    throw err;
  }

  const targetDir = path.resolve(cwd, options.targetDir);
  const targetBasename = path.basename(targetDir);

  const projectName = (options.projectName ?? targetBasename).trim();
  const projectNameError = validateProjectName(projectName);
  if (projectNameError) {
    const err = new Error(`Invalid projectName: ${projectNameError}`);
    err.code = 'EVALIDATION';
    throw err;
  }

  const force = Boolean(options.force);
  const createdDate = options.createdDate ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(createdDate)) {
    const err = new Error(`Invalid createdDate: ${createdDate} (expected YYYY-MM-DD).`);
    err.code = 'EVALIDATION';
    throw err;
  }

  const templatesDir = resolveTemplatesDir();
  if (!existsSync(templatesDir)) {
    const err = new Error(
      `Templates directory missing at ${templatesDir}. The package may be corrupted.`,
    );
    err.code = 'EENV';
    throw err;
  }
  const { packageVersion, templated } = readTemplateManifest(templatesDir);

  // Decide whether we created the target dir (rollback rule).
  const preExisted = existsSync(targetDir);
  if (preExisted) {
    const st = statSync(targetDir);
    if (!st.isDirectory()) {
      const err = new Error(`Target path ${targetDir} exists and is not a directory.`);
      err.code = 'EUSER';
      throw err;
    }
    if (dirIsNonEmpty(targetDir) && !force) {
      const err = new Error(
        `Target directory ${targetDir} is not empty. Pass --force to overwrite.`,
      );
      err.code = 'EUSER';
      throw err;
    }
  } else {
    mkdirSync(targetDir, { recursive: true });
  }

  const vars = {
    PROJECT_NAME: projectName,
    CREATED_DATE: createdDate,
  };

  const files = walkTemplates(templatesDir, templatesDir);
  const runtimeFiles = {};
  const writtenPaths = []; // for rollback when we did NOT create the dir

  try {
    for (const { posixRel, abs } of files) {
      const targetAbs = path.join(targetDir, ...posixRel.split('/'));
      const targetParent = path.dirname(targetAbs);
      mkdirSync(targetParent, { recursive: true });

      let writtenBytes;
      if (templated.has(posixRel)) {
        const source = readFileSync(abs, 'utf8');
        const rendered = substitute(source, vars);
        writeFileSync(targetAbs, rendered, { encoding: 'utf8' });
        writtenBytes = Buffer.from(rendered, 'utf8');
      } else {
        // Stream byte-for-byte; we still need the bytes to compute sha.
        copyFileSync(abs, targetAbs);
        writtenBytes = readFileSync(targetAbs);
      }

      runtimeFiles[posixRel] = {
        sha256: sha256(writtenBytes),
        templated: templated.has(posixRel),
      };
      writtenPaths.push(targetAbs);
    }

    const now = new Date().toISOString();
    const runtimeManifest = {
      manifestVersion: 1,
      packageVersion,
      scaffoldedAt: now,
      lastUpdatedAt: null,
      files: sortKeys(runtimeFiles),
    };
    writeManifest(targetDir, runtimeManifest);
  } catch (err) {
    // Rollback per the design spec.
    if (!preExisted) {
      try {
        rmSync(targetDir, { recursive: true, force: true });
      } catch (rollbackErr) {
        // Surface both errors.
        err.message =
          err.message +
          ` (rollback also failed while removing ${targetDir}: ${rollbackErr.message})`;
      }
    } else {
      // Pre-existing dir: only remove files we wrote. Do not delete files that
      // were there before. Empty dirs we created are left as-is to keep this
      // path conservative.
      for (const p of writtenPaths.slice().reverse()) {
        try {
          rmSync(p, { force: true });
        } catch (_e) {
          /* best-effort */
        }
      }
      // Also try to clean up the manifest tmp file if it lingered.
      try {
        rmSync(path.join(targetDir, '.wiki-llm', 'manifest.json.tmp'), { force: true });
      } catch (_e) {
        /* best-effort */
      }
    }
    throw err;
  }

  printBanner(targetDir, projectName, log);
  return { targetDir, written: files.length };
}

/**
 * Sort an object's keys lexicographically. Used to keep the runtime manifest
 * deterministic.
 * @param {Record<string, unknown>} obj
 * @returns {Record<string, unknown>}
 */
function sortKeys(obj) {
  const keys = Object.keys(obj).sort();
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}
