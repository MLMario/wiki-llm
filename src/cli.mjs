#!/usr/bin/env node
// cli.mjs — entry point for `create-wiki-llm`. Parses argv with no library and
// dispatches to either the scaffold flow (default) or the update flow stub.
// Node built-ins only.

import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { init } from './init.mjs';

const HELP_TEXT = `Usage:
  create-wiki-llm [<dir>] [options]
  create-wiki-llm --update [options]

Scaffold a Karpathy-style LLM knowledge-base repo for Claude Code, driven by
the kb-* skills. Run --update from inside an existing scaffolded repo to pull
the latest package-owned skill files.

Arguments:
  <dir>                Target directory to scaffold into (defaults to ".").

Options:
  --name <name>        Project name. Defaults to the target dir's basename.
  --force              Overwrite a non-empty target dir (init) / overwrite
                       customized package files (update).
  --update             Run the update flow (Phase 4 — not yet implemented).
  -h, --help           Show this help and exit.

Exit codes:
  0  success
  1  user error (bad arguments, refused operation)
  2  validation error (invalid projectName, etc.)
  3  environment error (templates missing, fs errors, etc.)
`;

/**
 * Parse argv into a structured options object. No library; no surprise
 * coercions. Recognises:
 *   --name <value>   --name=<value>
 *   --force
 *   --update
 *   -h, --help
 * The first non-flag positional becomes `targetDir`; subsequent positionals
 * cause an error.
 *
 * @param {string[]} argv  process.argv.slice(2)
 * @returns {{ help: boolean, update: boolean, force: boolean, name: string|null, targetDir: string|null, error: string|null }}
 */
export function parseArgs(argv) {
  const out = {
    help: false,
    update: false,
    force: false,
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

  if (opts.update) {
    process.stdout.write('Update flow will be implemented in Phase 4.\n');
    return 0;
  }

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
