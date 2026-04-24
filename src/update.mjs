// update.mjs — overwrite-based updater for a scaffolded wiki-llm repo.
// Node built-ins only.
//
// Implements design §3 "Updater" flow plus the three guards in §4:
//   - Guard 1 — `--force` is the only way past a customization conflict.
//   - Guard 2 — Package-zone allowlist (path-safety.isPackageZonePath).
//   - Guard 3 — path traversal validation (path-safety.validateTargetPath).
//
// All three guards live behind separate code paths; bypassing one does not
// bypass the others. Manifest is data, allowlist is code.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { manifestPath, readManifest, sha256, writeManifest } from './manifest.mjs';
import { isPackageZonePath, validateTargetPath } from './path-safety.mjs';
import { classifyFile } from './customization-check.mjs';
import { fetchLatestTarball } from './tarball.mjs';

const DEFAULT_PACKAGE_NAME = 'create-wiki-llm';
const DEFAULT_KEEP_BACKUPS = 10;
const MIGRATION_DOC_URL =
  'https://github.com/MLMario/wiki-llm/blob/main/MIGRATION.md';
const TEMPLATE_MANIFEST_KEY = 'templates/manifest.json';
const TEMPLATE_PREFIX = 'templates/';

/**
 * Wrap an Error with a code tag (`EUSER` / `EVALIDATION` / `EENV`).
 * @param {string} code
 * @param {string} message
 * @returns {Error}
 */
function tagged(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Extract semver-major as integer. Tolerates pre-release suffixes
 * ("1.2.3-beta.1") because we only need the leading integer. Throws on
 * malformed inputs (no digits before the first separator).
 * @param {string} version
 * @returns {number}
 */
function semverMajor(version) {
  if (typeof version !== 'string' || version.length === 0) {
    throw tagged('EENV', `Invalid semver string: ${JSON.stringify(version)}`);
  }
  const head = version.split('.')[0];
  const major = parseInt(head, 10);
  if (!Number.isFinite(major) || major < 0 || String(major) !== head.replace(/^v/, '')) {
    // The String(major) === head check rejects things like "1abc" while still
    // allowing the `v`-prefix that some package versions carry historically.
    if (!/^v?\d+$/.test(head)) {
      throw tagged('EENV', `Invalid semver string: ${JSON.stringify(version)}`);
    }
  }
  if (!Number.isFinite(major) || major < 0) {
    throw tagged('EENV', `Invalid semver string: ${JSON.stringify(version)}`);
  }
  return major;
}

/**
 * Format a Date as `YYYYMMDD-HHMMSS` in UTC. Filesystem-safe and sortable.
 * @param {Date} date
 * @returns {string}
 */
function formatBackupTimestamp(date) {
  const yyyy = String(date.getUTCFullYear()).padStart(4, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const HH = String(date.getUTCHours()).padStart(2, '0');
  const MM = String(date.getUTCMinutes()).padStart(2, '0');
  const SS = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${HH}${MM}${SS}`;
}

/**
 * Atomic write helper: write to `<target>.tmp`, then rename. Creates parent
 * dirs as needed.
 * @param {string} target
 * @param {Buffer} bytes
 */
function atomicWrite(target, bytes) {
  mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + '.tmp';
  writeFileSync(tmp, bytes);
  renameSync(tmp, target);
}

/**
 * Parse the new package's `templates/manifest.json` from the in-memory tarball
 * file map.
 * @param {Map<string, Buffer>} files
 * @returns {{ files: Record<string, { sha256: string, templated: boolean }>, packageVersion: string, manifestVersion: number }}
 */
function readNewManifestFromTarball(files) {
  const buf = files.get(TEMPLATE_MANIFEST_KEY);
  if (!Buffer.isBuffer(buf)) {
    throw tagged(
      'EENV',
      `Tarball is missing ${TEMPLATE_MANIFEST_KEY}; cannot determine new file shas.`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(buf.toString('utf8'));
  } catch (err) {
    throw tagged(
      'EENV',
      `Tarball ${TEMPLATE_MANIFEST_KEY} is not valid JSON: ${err.message}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw tagged('EENV', `Tarball ${TEMPLATE_MANIFEST_KEY} is not a JSON object.`);
  }
  if (parsed.manifestVersion !== 1) {
    throw tagged(
      'EENV',
      `Tarball ${TEMPLATE_MANIFEST_KEY} has unsupported manifestVersion ` +
        `${JSON.stringify(parsed.manifestVersion)}. This CLI understands manifestVersion 1.`,
    );
  }
  if (typeof parsed.packageVersion !== 'string' || parsed.packageVersion.length === 0) {
    throw tagged(
      'EENV',
      `Tarball ${TEMPLATE_MANIFEST_KEY} is missing a string packageVersion.`,
    );
  }
  if (!parsed.files || typeof parsed.files !== 'object') {
    throw tagged('EENV', `Tarball ${TEMPLATE_MANIFEST_KEY} has no .files map.`);
  }
  return parsed;
}

/**
 * Recursively copy `srcAbs` into `dstAbs`. Used during backup, file-by-file.
 * @param {string} srcAbs
 * @param {string} dstAbs
 */
function backupFile(srcAbs, dstAbs) {
  mkdirSync(path.dirname(dstAbs), { recursive: true });
  copyFileSync(srcAbs, dstAbs);
}

/**
 * List backup directories under `.wiki-llm/backups/`. Returns the names
 * (basenames) sorted lexicographically descending (newest first, given our
 * timestamp format).
 * @param {string} repoRoot
 * @returns {string[]}
 */
function listBackups(repoRoot) {
  const dir = path.join(repoRoot, '.wiki-llm', 'backups');
  if (!existsSync(dir)) return [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (_err) {
    return [];
  }
  const named = [];
  for (const name of entries) {
    try {
      const st = statSync(path.join(dir, name));
      if (st.isDirectory()) named.push(name);
    } catch (_err) {
      // Ignore stale entries.
    }
  }
  named.sort();
  named.reverse();
  return named;
}

/**
 * Run the update flow.
 *
 * Options:
 *   - `repoRoot`        Absolute path to the scaffolded repo (target).
 *   - `packageName`     Package to update from. Default `'create-wiki-llm'`.
 *   - `force`           Bypass Guard 1 customization refusal. Default false.
 *   - `dryRun`          Print plan and return without touching disk. Default false.
 *   - `keepBackups`     Backup retention count. Default 10.
 *   - `fetch`           Injectable fetch (forwarded to fetchLatestTarball).
 *   - `registry`        Registry URL override (forwarded to fetchLatestTarball).
 *   - `now`             Date override for testability. Default `new Date()`.
 *   - `log`             Logger. Default writes to stdout.
 *
 * Throws:
 *   - `err.code === 'EUSER'`        — bad input or refusal (customization gate).
 *   - `err.code === 'EVALIDATION'`  — schema/option validation failure.
 *   - `err.code === 'EENV'`         — environment-class failure (corrupt manifest,
 *                                     tarball errors, major version, IO failure).
 *
 * Returns on success:
 *   { version, oldVersion, plan, backup: { path, count }, appliedCount,
 *     removedCount, skippedCount, report, dryRun? }
 *
 * @param {object} options
 */
export async function update(options) {
  if (!options || typeof options !== 'object') {
    throw tagged('EVALIDATION', 'update(): options object is required');
  }
  if (typeof options.repoRoot !== 'string' || options.repoRoot.length === 0) {
    throw tagged('EVALIDATION', 'update(): repoRoot is required');
  }
  if (!path.isAbsolute(options.repoRoot)) {
    throw tagged('EVALIDATION', `update(): repoRoot must be absolute (got ${options.repoRoot})`);
  }

  const repoRoot = path.resolve(options.repoRoot);
  const packageName = options.packageName ?? DEFAULT_PACKAGE_NAME;
  const force = Boolean(options.force);
  const dryRun = Boolean(options.dryRun);
  const keepBackupsRaw = options.keepBackups ?? DEFAULT_KEEP_BACKUPS;
  if (
    !Number.isInteger(keepBackupsRaw) ||
    keepBackupsRaw < 0 ||
    keepBackupsRaw > 10000
  ) {
    throw tagged(
      'EVALIDATION',
      `update(): keepBackups must be a non-negative integer (got ${JSON.stringify(keepBackupsRaw)})`,
    );
  }
  const keepBackups = keepBackupsRaw;
  const now = options.now ?? new Date();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw tagged('EVALIDATION', 'update(): now must be a valid Date');
  }
  const log = options.log ?? ((line) => process.stdout.write(line + '\n'));

  // ------------------------------------------------------------------------
  // Step 1 — Preflight.
  // ------------------------------------------------------------------------
  if (!existsSync(repoRoot)) {
    throw tagged('EENV', `repoRoot does not exist: ${repoRoot}`);
  }
  let st;
  try {
    st = statSync(repoRoot);
  } catch (err) {
    throw tagged('EENV', `repoRoot is unreadable: ${err.message}`);
  }
  if (!st.isDirectory()) {
    throw tagged('EENV', `repoRoot is not a directory: ${repoRoot}`);
  }

  let oldManifest;
  try {
    oldManifest = readManifest(repoRoot); // throws on missing/invalid/unknown ver
  } catch (err) {
    err.code = err.code ?? 'EENV';
    throw err;
  }
  if (typeof oldManifest.packageVersion !== 'string' || oldManifest.packageVersion.length === 0) {
    throw tagged(
      'EENV',
      `Manifest at ${manifestPath(repoRoot)} has no packageVersion; cannot update.`,
    );
  }
  if (!oldManifest.files || typeof oldManifest.files !== 'object') {
    throw tagged(
      'EENV',
      `Manifest at ${manifestPath(repoRoot)} has no .files map; cannot update.`,
    );
  }

  // ------------------------------------------------------------------------
  // Step 2 — Fetch latest tarball + new manifest.
  // ------------------------------------------------------------------------
  const fetched = await fetchLatestTarball(packageName, {
    fetch: options.fetch,
    registry: options.registry,
  });
  const tarFiles = fetched.files;
  const newPackageVersion = fetched.version;
  const newManifest = readNewManifestFromTarball(tarFiles);
  if (newManifest.packageVersion !== newPackageVersion) {
    // Soft warning: tarball self-reported version disagrees with registry's
    // dist-tag. We trust the tarball's manifest entries (they hash the actual
    // bytes) but still note the mismatch.
    log(
      `warn: tarball version (${newManifest.packageVersion}) differs from registry latest (${newPackageVersion}); using tarball value.`,
    );
  }
  const effectiveNewVersion = newManifest.packageVersion;

  // ------------------------------------------------------------------------
  // Step 3 — Major-version gate.
  // ------------------------------------------------------------------------
  const oldMajor = semverMajor(oldManifest.packageVersion);
  const newMajor = semverMajor(effectiveNewVersion);
  if (newMajor > oldMajor) {
    throw tagged(
      'EENV',
      `Major version bump v${oldMajor} → v${newMajor}. Manual migration required. ` +
        `See ${MIGRATION_DOC_URL}`,
    );
  }

  // ------------------------------------------------------------------------
  // Step 4 — Plan.
  // ------------------------------------------------------------------------
  const plan = [];
  const skipped = []; // non-Package-zone entries we silently skip
  const allKeys = new Set([
    ...Object.keys(oldManifest.files),
    ...Object.keys(newManifest.files),
  ]);
  // Deterministic order for plan + report.
  const sortedKeys = Array.from(allKeys).sort();

  for (const relPath of sortedKeys) {
    // Guard 3 — path-traversal validation. Hard fail on any dangerous entry.
    let resolvedAbs;
    try {
      resolvedAbs = validateTargetPath(relPath, repoRoot);
    } catch (err) {
      throw tagged(
        'EENV',
        `Refusing to proceed: tarball or old manifest contains an unsafe path. ${err.message}`,
      );
    }

    // Guard 2 — Package-zone allowlist. Silently skip; design §4 says
    // "log and skip" for non-Package-zone entries.
    if (!isPackageZonePath(relPath)) {
      skipped.push(relPath);
      log(`skip ${relPath} (outside Package zone)`);
      continue;
    }

    // Compute disposition.
    const inOld = Object.prototype.hasOwnProperty.call(oldManifest.files, relPath);
    const inNew = Object.prototype.hasOwnProperty.call(newManifest.files, relPath);
    const oldEntry = inOld ? oldManifest.files[relPath] : null;
    const newEntry = inNew ? newManifest.files[relPath] : null;

    let diskSha = null;
    if (existsSync(resolvedAbs)) {
      try {
        const buf = readFileSync(resolvedAbs);
        diskSha = sha256(buf);
      } catch (err) {
        throw tagged(
          'EENV',
          `Failed to read disk file for planning ${relPath}: ${err.message}`,
        );
      }
    }

    let disposition;
    if (!inOld && !inNew) {
      // Cannot happen — relPath came from the union — but be explicit.
      throw tagged('EENV', `Internal: planner saw a path in neither manifest: ${relPath}`);
    } else if (!inOld && inNew) {
      disposition = 'added';
    } else if (inOld && !inNew) {
      // Removed entry. If file is missing on disk already, treat as no-op
      // unchanged for backup purposes (we still mark removed in the plan so
      // apply step is consistent — but we won't try to backup a missing file).
      disposition = 'removed';
    } else if (oldEntry.sha256 === newEntry.sha256) {
      disposition = 'unchanged';
    } else if (diskSha === null) {
      // File missing on disk but listed in old manifest with new bytes
      // available. Treat as overwrite-clean so we recreate it; nothing for
      // the user to have customized.
      disposition = 'overwrite-clean';
    } else {
      disposition = classifyFile(relPath, oldManifest, newManifest, diskSha);
    }

    plan.push({
      relPath,
      disposition,
      oldSha: oldEntry ? oldEntry.sha256 : null,
      newSha: newEntry ? newEntry.sha256 : null,
      diskSha,
      resolvedAbs,
    });
  }

  // ------------------------------------------------------------------------
  // Step 5 — Customization gate (Guard 1).
  // ------------------------------------------------------------------------
  const customized = plan.filter((e) => e.disposition === 'overwrite-customized');
  if (customized.length > 0 && !force) {
    const list = customized.map((e) => `  - ${e.relPath}`).join('\n');
    throw tagged(
      'EUSER',
      `Refusing to overwrite ${customized.length} customized Package-zone file(s):\n${list}\n\n` +
        'Re-run with --force to overwrite. Backups will preserve your current bytes.',
    );
  }

  // ------------------------------------------------------------------------
  // Counts and a tidy summary used by both dry-run and apply paths.
  // ------------------------------------------------------------------------
  const counts = {
    added: 0,
    removed: 0,
    unchanged: 0,
    'overwrite-clean': 0,
    'overwrite-customized': 0,
  };
  for (const e of plan) {
    counts[e.disposition] += 1;
  }
  const summary = {
    oldVersion: oldManifest.packageVersion,
    newVersion: effectiveNewVersion,
    counts,
    plan,
    skipped,
  };

  function logPlanSummary() {
    log('');
    log(`Update plan: ${oldManifest.packageVersion} → ${effectiveNewVersion}`);
    log(`  added:                ${counts.added}`);
    log(`  removed:              ${counts.removed}`);
    log(`  unchanged:            ${counts.unchanged}`);
    log(`  overwrite-clean:      ${counts['overwrite-clean']}`);
    log(`  overwrite-customized: ${counts['overwrite-customized']}`);
    if (skipped.length > 0) {
      log(`  skipped (out-of-zone): ${skipped.length}`);
    }
  }

  // ------------------------------------------------------------------------
  // Step 6 — Dry-run short-circuit.
  // ------------------------------------------------------------------------
  if (dryRun) {
    logPlanSummary();
    log('');
    log('Dry run — no files written.');
    return {
      version: effectiveNewVersion,
      oldVersion: oldManifest.packageVersion,
      plan,
      skipped,
      counts,
      backup: { path: null, count: 0 },
      appliedCount: 0,
      removedCount: 0,
      skippedCount: skipped.length,
      report: null,
      dryRun: true,
    };
  }

  // ------------------------------------------------------------------------
  // Step 7 — Backup.
  // ------------------------------------------------------------------------
  // Only files that exist on disk are backed up. We back up everything we're
  // about to *change* (overwrite-clean, overwrite-customized, removed) — but
  // never `added` (no prior bytes to preserve).
  const backupTimestamp = formatBackupTimestamp(now);
  const backupRoot = path.join(repoRoot, '.wiki-llm', 'backups', backupTimestamp);
  const backupTargets = plan.filter(
    (e) =>
      (e.disposition === 'overwrite-clean' ||
        e.disposition === 'overwrite-customized' ||
        e.disposition === 'removed') &&
      e.diskSha !== null,
  );

  let backedUp = 0;
  if (backupTargets.length > 0) {
    try {
      mkdirSync(backupRoot, { recursive: true });
      for (const e of backupTargets) {
        const dstAbs = path.join(backupRoot, ...e.relPath.split('/'));
        backupFile(e.resolvedAbs, dstAbs);
        backedUp += 1;
      }
    } catch (err) {
      // Best-effort cleanup of the partial backup dir, then refuse.
      try {
        rmSync(backupRoot, { recursive: true, force: true });
      } catch (_e) {
        /* ignore */
      }
      throw tagged('EENV', `Backup failed; refusing to update. ${err.message}`);
    }
  }

  // ------------------------------------------------------------------------
  // Step 8 — Apply.
  // ------------------------------------------------------------------------
  let applied = 0;
  let removedApplied = 0;
  for (const e of plan) {
    try {
      if (
        e.disposition === 'added' ||
        e.disposition === 'overwrite-clean' ||
        e.disposition === 'overwrite-customized'
      ) {
        const tarKey = TEMPLATE_PREFIX + e.relPath;
        const bytes = tarFiles.get(tarKey);
        if (!Buffer.isBuffer(bytes)) {
          throw new Error(`tarball missing expected entry ${tarKey}`);
        }
        atomicWrite(e.resolvedAbs, bytes);
        applied += 1;
      } else if (e.disposition === 'removed') {
        if (existsSync(e.resolvedAbs)) {
          unlinkSync(e.resolvedAbs);
          removedApplied += 1;
        }
      }
      // 'unchanged' → no-op.
    } catch (err) {
      throw tagged(
        'EENV',
        `Apply failed at ${e.relPath}: ${err.message}\n` +
          `Update partially applied. Manifest NOT updated. ` +
          `Backup available at ${backupRoot}. Re-running --update will retry.`,
      );
    }
  }

  // ------------------------------------------------------------------------
  // Step 9 — Finalize manifest.
  // ------------------------------------------------------------------------
  // Recompute Package-zone files from disk; preserve non-Package-zone entries
  // from the old manifest (they were never touched).
  const newRuntimeFiles = {};
  for (const [relPath, oldEntry] of Object.entries(oldManifest.files)) {
    if (!isPackageZonePath(relPath)) {
      newRuntimeFiles[relPath] = oldEntry;
    }
  }
  for (const e of plan) {
    if (e.disposition === 'removed') continue; // gone from disk
    if (e.disposition === 'unchanged') {
      // Preserve old entry verbatim.
      newRuntimeFiles[e.relPath] = oldManifest.files[e.relPath];
      continue;
    }
    // added / overwrite-clean / overwrite-customized — recompute from disk.
    let bytes;
    try {
      bytes = readFileSync(e.resolvedAbs);
    } catch (err) {
      throw tagged(
        'EENV',
        `Manifest rebuild failed reading ${e.relPath}: ${err.message}`,
      );
    }
    const tarKey = TEMPLATE_PREFIX + e.relPath;
    const newEntry = newManifest.files[e.relPath];
    newRuntimeFiles[e.relPath] = {
      sha256: sha256(bytes),
      templated: newEntry?.templated === true,
    };
    void tarKey; // referenced for clarity; not used directly
  }

  const newRuntimeManifest = {
    manifestVersion: 1,
    packageVersion: effectiveNewVersion,
    scaffoldedAt: oldManifest.scaffoldedAt ?? null,
    lastUpdatedAt: now.toISOString(),
    files: sortKeys(newRuntimeFiles),
  };
  writeManifest(repoRoot, newRuntimeManifest);

  // ------------------------------------------------------------------------
  // Step 10 — Prune backups.
  // ------------------------------------------------------------------------
  const backups = listBackups(repoRoot);
  if (backups.length > keepBackups) {
    const toDelete = backups.slice(keepBackups);
    for (const name of toDelete) {
      const p = path.join(repoRoot, '.wiki-llm', 'backups', name);
      try {
        rmSync(p, { recursive: true, force: true });
      } catch (_err) {
        // Non-fatal: report but don't roll back the update.
        log(`warn: failed to prune old backup ${name}`);
      }
    }
  }

  // ------------------------------------------------------------------------
  // Step 11 — Report.
  // ------------------------------------------------------------------------
  const reportObj = {
    timestamp: now.toISOString(),
    oldVersion: oldManifest.packageVersion,
    newVersion: effectiveNewVersion,
    counts,
    plan: plan.map((e) => ({
      relPath: e.relPath,
      disposition: e.disposition,
      oldSha: e.oldSha,
      newSha: e.newSha,
      diskSha: e.diskSha,
    })),
    skipped,
    backup:
      backedUp > 0
        ? { path: path.relative(repoRoot, backupRoot).split(path.sep).join('/'), count: backedUp }
        : { path: null, count: 0 },
  };
  const reportPath = path.join(repoRoot, '.wiki-llm', 'update-report.json');
  try {
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(reportObj, null, 2) + '\n', 'utf8');
  } catch (err) {
    // Non-fatal: the update succeeded; failing to write the report file is
    // a logging issue, not a state corruption.
    log(`warn: failed to write update-report.json: ${err.message}`);
  }

  // Stdout summary.
  logPlanSummary();
  log('');
  log(`Updated ${oldManifest.packageVersion} → ${effectiveNewVersion}`);
  log(`  applied:    ${applied} file(s)`);
  log(`  removed:    ${removedApplied} file(s)`);
  log(`  unchanged:  ${counts.unchanged} file(s)`);
  if (backedUp > 0) {
    log(`  backup:     ${path.relative(repoRoot, backupRoot)} (${backedUp} file(s))`);
  } else {
    log('  backup:     (none — nothing to back up)');
  }
  log(`  report:     .wiki-llm/update-report.json`);
  log('');

  return {
    version: effectiveNewVersion,
    oldVersion: oldManifest.packageVersion,
    plan,
    skipped,
    counts,
    backup: {
      path: backedUp > 0 ? backupRoot : null,
      count: backedUp,
    },
    appliedCount: applied,
    removedCount: removedApplied,
    skippedCount: skipped.length,
    report: reportPath,
  };
}

/**
 * Sort an object's keys lexicographically. Mirrors init.mjs's helper.
 * @param {Record<string, unknown>} obj
 * @returns {Record<string, unknown>}
 */
function sortKeys(obj) {
  const keys = Object.keys(obj).sort();
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}
