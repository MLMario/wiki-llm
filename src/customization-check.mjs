// customization-check.mjs — classify how each manifest-listed file should be
// handled during `--update`. Pure function, no fs, no side effects.
//
// Implements the five-way classifier described in design §3 step 4 and the
// customization gate (Guard 1) in §4. The caller is responsible for
// computing the on-disk sha256; this module only decides the verdict given
// the three shas.

/**
 * Classify a file's update-time disposition.
 *
 * Inputs:
 *   - `relPath`      POSIX-style path relative to the scaffolded repo root.
 *   - `oldManifest`  The on-disk `.wiki-llm/manifest.json` parsed JSON. Must
 *                    have a `files: { [path]: { sha256, ... } }` shape.
 *   - `newManifest`  The fetched tarball's `templates/manifest.json` parsed
 *                    JSON. Same shape.
 *   - `diskSha`      Lowercase hex sha256 of the file's current on-disk
 *                    bytes. Pass `undefined`/`null` when the file is not on
 *                    disk (or does not need to be, e.g. for `'added'`).
 *
 * Return values (exactly one of these five strings):
 *   - `'added'`                 in new, not in old
 *   - `'removed'`               in old, not in new
 *   - `'unchanged'`             in both, old sha === new sha
 *   - `'overwrite-clean'`       in both, old sha !== new sha, diskSha === old sha
 *   - `'overwrite-customized'`  in both, old sha !== new sha, diskSha !== old sha
 *
 * Edge cases:
 *   - If `relPath` is in neither manifest → throws `unreachable` error. Caller
 *     should never invoke the classifier for such a path (it would indicate a
 *     bug in the caller's union-of-manifests walk).
 *   - When `relPath` is in both manifests and shas differ, `diskSha` is
 *     required; passing `undefined`/`null` throws so the caller cannot
 *     silently produce a wrong verdict. (A missing file on disk is a separate
 *     condition the caller must detect before calling classifyFile.)
 *
 * This function is total on valid inputs and deterministic. No normalization
 * of `relPath` is performed — the caller passes the same path key used in the
 * manifests.
 *
 * @param {string}  relPath
 * @param {{ files: Record<string, { sha256: string }> }} oldManifest
 * @param {{ files: Record<string, { sha256: string }> }} newManifest
 * @param {string|null|undefined} diskSha
 * @returns {'added'|'removed'|'unchanged'|'overwrite-clean'|'overwrite-customized'}
 */
export function classifyFile(relPath, oldManifest, newManifest, diskSha) {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new Error('classifyFile: relPath must be a non-empty string');
  }
  if (!oldManifest || typeof oldManifest !== 'object' || !oldManifest.files) {
    throw new Error('classifyFile: oldManifest must be an object with a .files map');
  }
  if (!newManifest || typeof newManifest !== 'object' || !newManifest.files) {
    throw new Error('classifyFile: newManifest must be an object with a .files map');
  }

  const oldEntry = oldManifest.files[relPath];
  const newEntry = newManifest.files[relPath];
  const inOld = oldEntry !== undefined;
  const inNew = newEntry !== undefined;

  if (!inOld && !inNew) {
    throw new Error(
      `unreachable: classifyFile called with path in neither manifest: ${JSON.stringify(relPath)}`,
    );
  }

  if (!inOld && inNew) return 'added';
  if (inOld && !inNew) return 'removed';

  // In both manifests — compare shas.
  if (typeof oldEntry.sha256 !== 'string' || typeof newEntry.sha256 !== 'string') {
    throw new Error(
      `classifyFile: manifest entries for ${JSON.stringify(relPath)} must have string .sha256 fields`,
    );
  }

  if (oldEntry.sha256 === newEntry.sha256) return 'unchanged';

  // Shas differ → caller must supply diskSha so we can decide clean vs.
  // customized. If they forgot, fail loudly rather than guess.
  if (typeof diskSha !== 'string' || diskSha.length === 0) {
    throw new Error(
      `classifyFile: diskSha required when old/new shas differ for ${JSON.stringify(relPath)}`,
    );
  }

  // Edge case (Phase 5a decision, option A — see Phase 5a report and design
  // §3 step 4): if the on-disk bytes already match the new shipped sha, the
  // file is at its target state and there is nothing to overwrite. Treat as
  // 'unchanged' so the planner skips it and `--force` is not required.
  // Rationale: design intent of Guard 1 is "don't overwrite user edits."
  // When disk === new there is no user edit being preserved and no work to
  // do. Without this short-circuit a user whose edits happened to match the
  // upcoming version would be told to pass --force for a byte-level no-op.
  if (diskSha === newEntry.sha256) return 'unchanged';

  if (diskSha === oldEntry.sha256) return 'overwrite-clean';
  return 'overwrite-customized';
}
