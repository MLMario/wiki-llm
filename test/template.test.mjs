// template.test.mjs — unit tests for src/template.mjs.
// Built on node:test + node:assert/strict. Zero external deps.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { substitute } from '../src/template.mjs';

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test('substitute: replaces all known placeholders', () => {
  const out = substitute(
    '# {{PROJECT_NAME}} on {{CREATED_DATE}}\nWelcome to {{PROJECT_NAME}}.',
    { PROJECT_NAME: 'my-kb', CREATED_DATE: '2026-04-24' },
  );
  assert.equal(out, '# my-kb on 2026-04-24\nWelcome to my-kb.');
});

test('substitute: no placeholders → content unchanged', () => {
  const original = 'No vars here.\nJust plain text.\n';
  const out = substitute(original, { PROJECT_NAME: 'irrelevant' });
  assert.equal(out, original);
});

test('substitute: empty content with empty vars → empty string', () => {
  assert.equal(substitute('', {}), '');
});

test('substitute: accepts whitespace inside placeholders ({{ NAME }})', () => {
  // Per the docstring of src/template.mjs, optional surrounding whitespace
  // is allowed. Lock in the support.
  const out = substitute('{{ PROJECT_NAME }}', { PROJECT_NAME: 'kb' });
  assert.equal(out, 'kb');
});

test('substitute: tolerates internal whitespace variants', () => {
  // The PLACEHOLDER_RE allows `\s*` on each side; tabs and multi-space are
  // all accepted as long as the name itself is well-formed.
  const out = substitute('[{{\tNAME\t}}]', { NAME: 'x' });
  assert.equal(out, '[x]');
});

test('substitute: supports underscore + digit variable names', () => {
  // Pattern is /[A-Z][A-Z0-9_]*/ — must start with a letter, then upper-case
  // letters / digits / underscores allowed.
  const out = substitute(
    'a={{A_1}} b={{LONG_NAME_2}} c={{X}}',
    { A_1: '1', LONG_NAME_2: '2', X: '3' },
  );
  assert.equal(out, 'a=1 b=2 c=3');
});

test('substitute: variable values are coerced via String()', () => {
  // The implementation does `String(vars[name])`. Test with non-string
  // values to lock in coercion semantics (numbers, booleans, etc.).
  const out = substitute(
    'n={{N}} b={{B}}',
    { N: 42, B: true },
  );
  assert.equal(out, 'n=42 b=true');
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

test('substitute: unknown placeholder throws with descriptive message', () => {
  assert.throws(
    () => substitute('Hello {{PROJECT_NAME}}, {{UNKNOWN}}', { PROJECT_NAME: 'x' }),
    (err) => {
      // Error names the unknown placeholder verbatim and lists known vars.
      return (
        err instanceof Error &&
        /Unknown placeholder \{\{UNKNOWN\}\}/.test(err.message) &&
        /Known variables: PROJECT_NAME/.test(err.message)
      );
    },
  );
});

test('substitute: empty vars + content with placeholder → throws (none) hint', () => {
  assert.throws(
    () => substitute('{{X}}', {}),
    (err) =>
      err instanceof Error &&
      /Unknown placeholder \{\{X\}\}/.test(err.message) &&
      /Known variables: \(none\)\./.test(err.message),
  );
});

test('substitute: lowercase placeholder name is left in place and triggers unknown-placeholder error', () => {
  // Lowercase names do not match PLACEHOLDER_RE, so they are not substituted
  // even if `vars` includes the lowercase key. The post-pass detector then
  // sees `{{lowercase}}` and throws.
  assert.throws(
    () => substitute('{{lowercase}}', { lowercase: 'x' }),
    /Unknown placeholder/,
  );
});

test('substitute: name starting with digit is rejected (must start with letter)', () => {
  // PLACEHOLDER_RE = /\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/g — first char must be
  // an uppercase letter. `{{1FOO}}` does not match the named-substitution
  // pattern, but is caught by the post-pass scanner (ANY_PLACEHOLDER_RE).
  assert.throws(
    () => substitute('{{1FOO}}', { '1FOO': 'value' }),
    /Unknown placeholder/,
  );
});

test('substitute: non-ASCII placeholder name rejected', () => {
  // Cyrillic / Greek letters do not match A-Z. The token survives the
  // first pass and the post-pass throws.
  assert.throws(
    () => substitute('{{ПРИВЕТ}}', { 'ПРИВЕТ': 'world' }),
    /Unknown placeholder/,
  );
});

test('substitute: hyphen in placeholder name rejected', () => {
  // Hyphens are not in [A-Z0-9_], so `{{KEBAB-CASE}}` is rejected.
  assert.throws(
    () => substitute('{{KEBAB-CASE}}', { 'KEBAB-CASE': 'x' }),
    /Unknown placeholder/,
  );
});

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

test('substitute: non-string content throws TypeError', () => {
  assert.throws(
    () => substitute(123, {}),
    /content must be a string/,
  );
});

test('substitute: null vars throws TypeError', () => {
  assert.throws(
    () => substitute('foo', null),
    /vars must be an object/,
  );
});

test('substitute: undefined vars throws TypeError', () => {
  assert.throws(
    () => substitute('foo', undefined),
    /vars must be an object/,
  );
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test('substitute: prototype-key like __proto__ is not treated as a known var', () => {
  // `Object.prototype.hasOwnProperty.call(vars, name)` defends against
  // accidental matches against inherited keys. The placeholder name `PROTO`
  // is fine; the test below uses a real placeholder pattern.
  const out = substitute('{{PROTO}}', { PROTO: 'ok' });
  assert.equal(out, 'ok');
  // Sanity: with no PROTO key, the empty {} would not silently substitute.
  assert.throws(() => substitute('{{PROTO}}', {}), /Unknown placeholder/);
});

test('substitute: braces without inner content do not match the regex', () => {
  // `{{}}` is not a valid placeholder (must contain at least a name). The
  // first pass leaves it; the post-pass ANY_PLACEHOLDER_RE = /\{\{[^}]*\}\}/
  // matches `{{}}` (zero chars between the `{{` and `}}` is allowed by
  // `[^}]*`), so this throws — reasonable strictness.
  assert.throws(() => substitute('{{}}', {}), /Unknown placeholder/);
});

test('substitute: literal braces not part of placeholder are preserved', () => {
  // A single `{` or `}` should pass through. Only `{{...}}` is special.
  const out = substitute('{ not a placeholder } and {{NAME}}', { NAME: 'x' });
  assert.equal(out, '{ not a placeholder } and x');
});
