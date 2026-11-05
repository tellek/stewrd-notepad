// Pure helpers for the Harvest first-run wizard and the wiki-backed harvest.
// No Tauri/DOM imports so `node --test` can load this file.

export const DEFAULT_HARVEST_PROMPT =
  "Extract the durable lessons learned, facts, and decisions from the note above. " +
  "Save each one as a separate memory using whatever memory tools or files you have available. " +
  "If nothing is worth keeping, save nothing.";

/** Extraction guidance for the wiki harvest. It has no tool or save wording: the wrapper owns the output format. */
export const WIKI_BASE_PROMPT =
  "Extract the durable lessons learned, facts, and decisions from the note above. " +
  "Each one belongs on a wiki page: update the page for an existing topic, or create a new page. " +
  "If nothing is worth keeping, return no pages.";

const WIKI_SCHEMA_SUMMARY =
  "Wiki rules: raw notes are never edited. All knowledge lives as markdown pages under wiki/ (one topic per page, plain file names such as wiki/topic-name.md). " +
  "index.md is the catalog: one line per page in the form `- [Title](wiki/file.md) - one-line summary`. Keep every existing index line. " +
  "Link related pages with relative markdown links. When new information contradicts a page, note the contradiction on that page.";

export const WIKI_OUTPUT_INSTRUCTIONS =
  "Do not use any tools and do not try to save anything yourself. Your reply is the ONLY output channel; the host app writes the files for you.\n" +
  "Reply with zero or more blocks in exactly this form:\n" +
  "=== FILE: wiki/<name>.md ===\n<the full new content of that page>\n" +
  "For every page you change or create, also reply with `=== FILE: index.md ===` followed by the full updated index.\n" +
  "Then a block `=== LOG ===` followed by one or two lines describing what was added.\n" +
  "End with a final line `MEMORIES_CREATED: <n>` (the number of pages you created or changed). If nothing is worth keeping, reply with only that line set to 0 and one sentence explaining why.";

const WIKI_PROMPT_BUDGET = 24000;

/** The wizard opens whenever `launchWizard` is true; it sets it to false when finished. */
export function needsWizard(settings) {
  return settings.launchWizard === true;
}

/** Strips code fences and a leading "Here is..." line from an AI-generated prompt. Returns "" when nothing usable remains. */
export function cleanGeneratedPrompt(text) {
  let out = String(text ?? "").trim();
  const fenced = out.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
  if (fenced) out = fenced[1].trim();
  const lines = out.split("\n");
  if (lines.length > 1 && /^(here('s| is)|sure|certainly|okay)\b.*:\s*$/i.test(lines[0].trim())) {
    out = lines.slice(1).join("\n").trim();
  }
  return out;
}

export function isAbsoluteWinPath(path) {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

const norm = (p) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();

/** Relative path (forward slashes) of `folder` inside `root`, or null when it is outside. */
export function relativeToRoot(folder, root) {
  const f = norm(folder);
  const r = norm(root);
  if (f === r) return "";
  if (!f.startsWith(r + "\\")) return null;
  return folder.replace(/\//g, "\\").replace(/\\+$/, "").slice(r.length + 1).replace(/\\/g, "/");
}

export function defaultWikiFolder(root) {
  return `${root.replace(/[\\/]+$/, "")}\\wiki-memory`;
}

export function buildRulesText(folder) {
  const f = folder.replace(/[\\/]+$/, "");
  return (
    `Memory wiki: my long-term memory is the markdown wiki at ${f}.\n` +
    `- Before answering questions about prior decisions, lessons, or facts you are unsure of, read ${f}\\index.md and then the relevant pages under ${f}\\wiki\\.\n` +
    `- Follow the conventions in ${f}\\CLAUDE.md when you read or edit the wiki.\n` +
    `- When you learn something durable (a correction, a decision, a lesson that took effort), update or add a page under ${f}\\wiki\\, keep every line in ${f}\\index.md, and append a dated entry to ${f}\\log.md.\n` +
    `- Never edit files under ${f}\\raw\\.`
  );
}

const SAFE_PATH = /^(index\.md|wiki\/[A-Za-z0-9._ \-]+(\/[A-Za-z0-9._ \-]+)*)$/;

/** Parses `=== FILE: path ===` blocks and the `=== LOG ===` block out of an AI reply. Unsafe paths are reported in `rejected`. */
export function parseFileBlocks(reply) {
  const files = [];
  const rejected = [];
  let log = "";
  const re = /^=== (FILE: (.+?)|LOG) ===[ \t]*$/gm;
  const marks = [...String(reply ?? "").matchAll(re)];
  marks.forEach((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : String(reply).length;
    let body = String(reply).slice(start, end).replace(/^\r?\n/, "");
    if (m[1] === "LOG") {
      log = body.replace(/^MEMORIES_CREATED:\s*\d+\s*$/gim, "").trim();
      return;
    }
    const path = m[2].trim();
    const safe = SAFE_PATH.test(path) && !path.split("/").some((s) => s === ".." || s === "." || s === "" || s.endsWith(" ") || s.endsWith("."));
    if (!safe) {
      rejected.push(path);
      return;
    }
    body = body.replace(/^MEMORIES_CREATED:\s*\d+\s*$/gim, "").replace(/\s+$/, "");
    files.push({ path, content: body + "\n" });
  });
  return { files, log, rejected };
}

/** Link targets (`wiki/x.md`) referenced by index.md catalog lines. */
export function parseIndexPages(index) {
  return [...String(index ?? "").matchAll(/\]\((wiki\/[^)\s]+)\)/g)].map((m) => m[1]);
}

/** Guards against an AI shortening a file it was asked to return in full. */
export function checkOverwrite(path, oldText, newText) {
  if (path === "index.md") {
    const kept = new Set(parseIndexPages(newText));
    const dropped = parseIndexPages(oldText).filter((p) => !kept.has(p));
    return dropped.length ? { ok: false, reason: `index.md would drop ${dropped.length} existing page link(s)` } : { ok: true };
  }
  if (/\.\.\.|\bunchanged\b|\bremainder of\b|\brest of (the )?(page|file)\b/i.test(newText) && !/\.\.\.|\bunchanged\b/i.test(oldText)) {
    return { ok: false, reason: `${path} contains a placeholder instead of full text` };
  }
  if (oldText.length > 400 && newText.length < oldText.length * 0.6) {
    return { ok: false, reason: `${path} came back much shorter than the original` };
  }
  return { ok: true };
}

/**
 * Builds the wiki harvest prompt within a character budget. Fixed parts (note, rules, index) come first;
 * pages are added while they fit. Throws when the fixed parts alone exceed the budget.
 */
export function buildWikiPrompt({ header, note, harvestPrompt, index, pages, budget = WIKI_PROMPT_BUDGET }) {
  const head = `${header}\n\n--- NOTE CONTENT ---\n${note}\n--- END NOTE CONTENT ---\n\n${harvestPrompt}\n\n${WIKI_SCHEMA_SUMMARY}\n\n`;
  const tail = `\n${WIKI_OUTPUT_INSTRUCTIONS}\n`;
  const fixed = (idx) => head.length + tail.length + `--- CURRENT index.md ---\n${idx}\n--- END index.md ---\n\n`.length;
  let idx = index;
  if (fixed(idx) > budget) {
    idx = String(index).split("\n").filter((l) => /^\s*- \[/.test(l)).map((l) => l.replace(/\s+-\s+.*$/, "")).join("\n");
  }
  if (fixed(idx) > budget) throw new Error("The note and wiki index are too large for one AI prompt; shorten the note");
  let used = fixed(idx);
  let body = `--- CURRENT index.md ---\n${idx}\n--- END index.md ---\n\n`;
  const included = new Set(["index.md"]);
  const dropped = [];
  for (const p of pages) {
    const chunk = `--- CURRENT ${p.path} ---\n${p.content}\n--- END ${p.path} ---\n\n`;
    if (used + chunk.length > budget) {
      dropped.push(p.path);
      continue;
    }
    body += chunk;
    used += chunk.length;
    included.add(p.path);
  }
  return { prompt: head + body + tail, included, dropped, indexTrimmed: idx !== index };
}

/** Starter files for a new wiki folder. */
export function scaffoldIndex() {
  return "# Index\n\nOne line per wiki page: `- [Title](wiki/file.md) - one-line summary`.\n";
}

export function scaffoldLog() {
  return "# Log\n\nAppend-only. One dated entry per change.\n";
}
