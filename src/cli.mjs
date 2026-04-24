#!/usr/bin/env node
// cli.mjs — entry point for `create-wiki-llm`. Parses argv with no library and
// dispatches to either the scaffold flow (default) or the update flow.
// Node built-ins only.

import process from 'node:process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { init } from './init.mjs';
import { update } from './update.mjs';

const HELP_TEXT = `Usage:
  create-wiki-llm [<dir>] [options]
  create-wiki-llm --update [<dir>] [options]

Scaffold a Karpathy-style LLM knowledge-base repo for Claude Code, driven by
the kb-* skills. Run --update from inside an existing scaffolded repo to pull
the latest package-owned skill files. The updater overwrites only Package-zone
files (.claude/skills/, utils/, requirements.txt, knowledge-base/CONTEXT.md);
your knowledge-base/raw/, knowledge-base/wiki/, and seed files are never
touched.

Arguments:
  <dir>                 Init: target directory to scaffold into (defaults to ".").
                        --update: target directory of an existing scaffolded
                        repo (defaults to current working directory).

Options:
  --name <name>         Project name (init only). Defaults to the target
                        directory's basename.
  --force               Init: overwrite a non-empty target dir.
                        --update: overwrite customized Package-zone files
                        (their previous bytes are preserved in the backup).
  --update              Run the update flow against an existing scaffolded
                        repo.
  --dry-run             --update only: print the update plan and exit
                        without touching disk.
  --keep-backups <N>    --update only: keep the N most-recent backup
                        directories under .wiki-llm/backups/. Default: 10.
                        Older backups are pruned after a successful update.
  -h, --help            Show this help and exit.

Exit codes:
  0  success
  1  user error (bad arguments, refused operation, customizations without --force)
  2  validation error (invalid projectName, invalid --keep-backups value)
  3  environment error (corrupt manifest, tarball failure, IO failure,
     major-version bump)
`;

/**
 * Parse argv into a structured options object. No library; no surprise
 * coercions.
 *
 * Recognises:
 *   --name <value>          --name=<value>
 *   --force
 *   --update
 *   --dry-run
 *   --keep-backups <N>      --keep-backups=<N>
 *   -h, --help
 *
 * The first non-flag positional becomes `targetDir`; subsequent positionals
 * cause an error.
 *
 * Cross-flag validation (e.g., --dry-run requires --update) is deferred to
 * `main()` so callers can inspect the parsed shape directly in tests.
 *
 * @param {string[]} argv  process.argv.slice(2)
 * @returns {{
 *   help: boolean,
 *   update: boolean,
 *   force: boolean,
 *   dryRun: boolean,
 *   keepBackups: number|null,
 *   name: string|null,
 *   targetDir: string|null,
 *   error: string|null,
 * }}
 */
export function parseArgs(argv) {
  const out = {
    help: false,
    update: false,
    force: false,
    dryRun: false,
    keepBackups: null,
    name: null,
    targetDir: null,
    error: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      out.help = true;
      continue;
    }
    if (arg === '--update') {
      out.update = true;
      continue;
    }
    if (arg === '--force') {
      out.force = true;
      continue;
    }
    if (arg === '--dry-run') {
      out.dryRun = true;
      continue;
    }
    if (arg === '--name') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('-')) {
        out.error = '--name requires a value';
        return out;
      }
      out.name = v;
      i += 1;
      continue;
    }
    if (arg.startsWith('--name=')) {
      out.name = arg.slice('--name='.length);
      if (out.name.length === 0) {
        out.error = '--name requires a value';
        return out;
      }
      continue;
    }
    if (arg === '--keep-backups') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('-')) {
        out.error = '--keep-backups requires a value';
        return out;
      }
      const parsed = parseKeepBackups(v);
      if (parsed === null) {
        out.error = `--keep-backups must be a non-negative integer (got ${JSON.stringify(v)})`;
        return out;
      }
      out.keepBackups = parsed;
      i += 1;
      continue;
    }
    if (arg.startsWith('--keep-backups=')) {
      const v = arg.slice('--keep-backups='.length);
      if (v.length === 0) {
        out.error = '--keep-backups requires a value';
        return out;
      }
      const parsed = parseKeepBackups(v);
      if (parsed === null) {
        out.error = `--keep-backups must be a non-negative integer (got ${JSON.stringify(v)})`;
        return out;
      }
      out.keepBackups = parsed;
      continue;
    }
    if (arg.startsWith('-')) {
      out.error = `Unknown option: ${arg}`;
      return out;
    }
    if (out.targetDir !== null) {
      out.error = `Unexpected extra positional argument: ${arg}`;
      return out;
    }
    out.targetDir = arg;
  }
  return out;
}

/**
 * Parse a --keep-backups value. Returns the integer or null if invalid.
 * @param {string} raw
 * @returns {number|null}
 */
function parseKeepBackups(raw) {
  if (!/^\d+$/.test(raw)) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Map a thrown Error to a CLI exit code.
 * @param {Error} err
 * @returns {number}
 */
function errCode(err) {
  switch (err.code) {
    case 'EUSER':
      return 1;
    case 'EVALIDATION':
      return 2;
    case 'EENV':
      return 3;
    default:
      return 3;
  }
}

/**
 * Main entry. Returns the desired exit code; the caller invokes process.exit.
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const opts = parseArgs(argv);

  if (opts.error) {
    process.stderr.write(`Error: ${opts.error}\n\n${HELP_TEXT}`);
    return 1;
  }

  if (opts.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  // Cross-flag validation.
  if (!opts.update) {
    if (opts.dryRun) {
      process.stderr.write(
        `Error: --dry-run is only valid with --update\n\n${HELP_TEXT}`,
      );
      return 1;
    }
    if (opts.keepBackups !== null) {
      process.stderr.write(
        `Error: --keep-backups is only valid with --update\n\n${HELP_TEXT}`,
      );
      return 1;
    }
    if (opts.name !== null && opts.name.length === 0) {
      // parseArgs already catches empty --name; double-check for safety.
      process.stderr.write(`Error: --name requires a value\n\n${HELP_TEXT}`);
      return 1;
    }
  }

  if (opts.update) {
    if (opts.name !== null) {
      process.stderr.write(
        `Error: --name is only valid for the init flow (omit when using --update)\n\n${HELP_TEXT}`,
      );
      return 1;
    }
    const repoRoot = path.resolve(opts.targetDir ?? process.cwd());
    try {
      await update({
        repoRoot,
        force: opts.force,
        dryRun: opts.dryRun,
        keepBackups: opts.keepBackups ?? undefined,
      });
      return 0;
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      return errCode(err);
    }
  }

  // Default: init.
  const targetDir = opts.targetDir ?? '.';
  try {
    await init({
      targetDir,
      projectName: opts.name ?? undefined,
      force: opts.force,
    });
    return 0;
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    return errCode(err);
  }
}

// Run only when invoked as the entry point (not when imported by tests).
function isMainEntry() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch (_err) {
    return false;
  }
}

if (isMainEntry()) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`Fatal: ${err && err.stack ? err.stack : err}\n`);
      process.exit(3);
    },
  );
}
