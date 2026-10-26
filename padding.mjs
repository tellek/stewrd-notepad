// Pure helpers for the blank-line padding the editor adds for free scrolling.

/**
 * Length of text to keep when stripping trailing padding: everything up to the
 * last non-blank character, but never cutting before the caret.
 * @param {string} text
 * @param {number} head caret position
 * @returns {number}
 */
export function keepLength(text, head) {
  return Math.max(text.trimEnd().length, head);
}
