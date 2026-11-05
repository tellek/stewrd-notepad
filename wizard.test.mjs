import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_HARVEST_PROMPT,
  buildRulesText,
  buildWikiPrompt,
  checkOverwrite,
  cleanGeneratedPrompt,
  defaultWikiFolder,
  isAbsoluteWinPath,
  needsWizard,
  parseFileBlocks,
  parseIndexPages,
  relativeToRoot,
} from "./wizard.mjs";

test("needsWizard follows launchWizard only", () => {
  assert.equal(needsWizard({ launchWizard: true, harvestPrompt: DEFAULT_HARVEST_PROMPT }), true);
  assert.equal(needsWizard({ launchWizard: true, harvestPrompt: "custom" }), true);
  assert.equal(needsWizard({ launchWizard: false, harvestPrompt: DEFAULT_HARVEST_PROMPT }), false);
});

test("cleanGeneratedPrompt strips fences, preamble and rejects empty", () => {
  assert.equal(cleanGeneratedPrompt("```\nDo it\n```"), "Do it");
  assert.equal(cleanGeneratedPrompt("Here is the prompt:\nDo it"), "Do it");
  assert.equal(cleanGeneratedPrompt("  Do it  "), "Do it");
  assert.equal(cleanGeneratedPrompt("   "), "");
});

test("isAbsoluteWinPath", () => {
  assert.equal(isAbsoluteWinPath("C:\\a\\b"), true);
  assert.equal(isAbsoluteWinPath("\\\\srv\\share"), true);
  assert.equal(isAbsoluteWinPath("%USERPROFILE%\\x"), false);
  assert.equal(isAbsoluteWinPath("wiki"), false);
});

test("defaultWikiFolder and relativeToRoot", () => {
  const root = "C:\\p\\notepad\\data";
  assert.equal(defaultWikiFolder(root + "\\"), "C:\\p\\notepad\\data\\wiki-memory");
  assert.equal(relativeToRoot("C:\\p\\notepad\\data\\wiki-memory", root), "wiki-memory");
  assert.equal(relativeToRoot("c:/P/notepad/data/a/b", root), "a/b");
  assert.equal(relativeToRoot("C:\\other", root), null);
  assert.equal(relativeToRoot("C:\\p\\notepad\\database", root), null);
});

test("buildRulesText names the folder", () => {
  const t = buildRulesText("D:\\mem\\");
  assert.match(t, /D:\\mem\\index\.md/);
  assert.match(t, /D:\\mem\\CLAUDE\.md/);
});

test("parseFileBlocks accepts safe paths and a log", () => {
  const r = parseFileBlocks(
    "=== FILE: wiki/topic one.md ===\nBody\n=== FILE: index.md ===\n- [T](wiki/topic one.md) - s\n=== LOG ===\nAdded one\nMEMORIES_CREATED: 1",
  );
  assert.deepEqual(r.files.map((f) => f.path), ["wiki/topic one.md", "index.md"]);
  assert.equal(r.files[0].content, "Body\n");
  assert.equal(r.log, "Added one");
  assert.equal(r.rejected.length, 0);
});

test("parseFileBlocks rejects unsafe paths", () => {
  const bad = ["../x.md", "/abs.md", "C:/x.md", "wiki/../../x.md", "wiki/a:b.md", "raw/x.md", "wiki/a?.md", "wiki/", "other.md", "wiki/x.md:stream"];
  const reply = bad.map((p) => `=== FILE: ${p} ===\nx\n`).join("");
  const r = parseFileBlocks(reply);
  assert.equal(r.files.length, 0);
  assert.equal(r.rejected.length, bad.length);
});

test("parseFileBlocks returns nothing for a reply without blocks", () => {
  assert.equal(parseFileBlocks("Nothing to keep.\nMEMORIES_CREATED: 0").files.length, 0);
});

test("checkOverwrite protects index links and page size", () => {
  const oldIndex = "- [A](wiki/a.md) - x\n- [B](wiki/b.md) - y\n";
  assert.equal(checkOverwrite("index.md", oldIndex, oldIndex + "- [C](wiki/c.md) - z\n").ok, true);
  assert.equal(checkOverwrite("index.md", oldIndex, "- [A](wiki/a.md) - x\n").ok, false);
  const page = "x".repeat(1000);
  assert.equal(checkOverwrite("wiki/a.md", page, page + "more").ok, true);
  assert.equal(checkOverwrite("wiki/a.md", page, "short").ok, false);
  assert.equal(checkOverwrite("wiki/a.md", "old", "...rest unchanged...").ok, false);
});

test("parseIndexPages lists linked pages", () => {
  assert.deepEqual(parseIndexPages("- [A](wiki/a.md) - x\n- [B](wiki/b b.md)"), ["wiki/a.md"]);
});

test("buildWikiPrompt tracks included pages and throws when fixed parts overflow", () => {
  const args = { header: "H", note: "note", harvestPrompt: "P", index: "- [A](wiki/a.md) - x", pages: [{ path: "wiki/a.md", content: "A body" }] };
  const r = buildWikiPrompt(args);
  assert.ok(r.included.has("wiki/a.md"));
  assert.ok(r.prompt.includes("A body"));
  const small = buildWikiPrompt({ ...args, budget: r.prompt.length - 3 });
  assert.equal(small.included.has("wiki/a.md"), false);
  assert.deepEqual(small.dropped, ["wiki/a.md"]);
  assert.throws(() => buildWikiPrompt({ ...args, budget: 100 }));
});
