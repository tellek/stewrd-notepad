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

/**
 * Blank lines to append on remount so a saved scroll offset past the end of the
 * (trimmed) document is reachable again.
 * @param {number} docLength
 * @param {number} scrollPos
 * @param {number} batch
 * @returns {number}
 */
export function restorePadLines(docLength, scrollPos, batch) {
  return Math.max(0, scrollPos - docLength) + batch;
}
