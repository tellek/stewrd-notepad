// Non-AI secret masking applied to a note before it is handed to the AI.
// Deliberately hand-rolled: gitleaks/secretlint can't be bundled into a
// Blob-loaded plugin. Errs toward redacting; the original is not kept.

const MASK = "[REDACTED]";

// Well-known token formats: the whole match is replaced.
const TOKEN_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g,
];

// Only the secret part is replaced (group 1 is kept).
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+(?=@)/gi;
const BEARER = /(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi;
const ASSIGNMENT =
  /(\b[\w.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)[\w.-]*["']?\s*[:=]\s*["']?)[^\s"',;]+/gi;

const ENTROPY_MIN_LENGTH = 24;
const ENTROPY_MIN_BITS = 4.0;

function entropy(token) {
  const counts = new Map();
  for (const ch of token) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / token.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

function looksRandom(token) {
  if (token.includes(MASK)) return false;
  if (token.length < ENTROPY_MIN_LENGTH) return false;
  if (!/\d/.test(token)) return false;
  if (/^[0-9a-f]+$/i.test(token)) return false; // git SHAs, UUID parts, hashes
  return entropy(token) >= ENTROPY_MIN_BITS;
}

/**
 * @param {string} text
 * @returns {{ text: string, count: number }}
 */
export function redactSecrets(text) {
  let count = 0;
  const mask = () => {
    count += 1;
    return MASK;
  };
  let out = text;
  for (const re of TOKEN_PATTERNS) out = out.replace(re, mask);
  out = out.replace(URL_CREDENTIALS, (_m, head) => head + mask());
  out = out.replace(BEARER, (_m, head) => head + mask());
  out = out.replace(ASSIGNMENT, (m, head) => (m.slice(head.length) === MASK ? m : head + mask()));
  // Skip tokens that look like paths or URLs (contain "/" or "\" or ":") by splitting on them.
  out = out.replace(/[A-Za-z0-9+_=-]+/g, (token) => (looksRandom(token) ? mask() : token));
  return { text: out, count };
}
