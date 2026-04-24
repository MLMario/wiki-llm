// template.mjs — minimal `{{VAR}}` placeholder substitution.
// Node built-ins only.

const PLACEHOLDER_RE = /\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/g;
const ANY_PLACEHOLDER_RE = /\{\{[^}]*\}\}/;

/**
 * Replace every `{{VAR}}` token in `content` using the keys in `vars`.
 * After substitution, if any `{{...}}` pattern remains, throw — unknown
 * placeholder error. Token names are uppercase ASCII letters / digits /
 * underscores, must start with a letter, and may have surrounding whitespace
 * (e.g. `{{ PROJECT_NAME }}` is also accepted).
 *
 * @param {string} content
 * @param {Record<string, string>} vars
 * @returns {string}
 */
export function substitute(content, vars) {
  if (typeof content !== 'string') {
    throw new TypeError('substitute(): content must be a string');
  }
  if (vars === null || typeof vars !== 'object') {
    throw new TypeError('substitute(): vars must be an object');
  }
  const replaced = content.replace(PLACEHOLDER_RE, (match, name) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      return String(vars[name]);
    }
    // Leave unknown placeholders in place; the post-pass will raise.
    return match;
  });
  const leftover = ANY_PLACEHOLDER_RE.exec(replaced);
  if (leftover) {
    const known = Object.keys(vars).sort();
    throw new Error(
      `Unknown placeholder ${leftover[0]} after substitution. ` +
        `Known variables: ${known.length ? known.join(', ') : '(none)'}.`,
    );
  }
  return replaced;
}
