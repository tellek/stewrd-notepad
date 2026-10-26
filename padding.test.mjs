import { test } from "node:test";
import assert from "node:assert/strict";
import { keepLength, restorePadLines } from "./padding.mjs";

test("keepLength trims trailing blanks", () => {
  assert.equal(keepLength("abc\n\n\n", 0), 3);
});

test("keepLength never cuts before the caret", () => {
  assert.equal(keepLength("abc\n\n\n", 5), 5);
});

test("keepLength is a no-op on clean text", () => {
  assert.equal(keepLength("abc", 1), 3);
});

test("restorePadLines covers an offset past the doc end", () => {
  assert.equal(restorePadLines(10, 100, 40), 130);
});

test("restorePadLines adds only the batch when offset is inside the doc", () => {
  assert.equal(restorePadLines(100, 10, 40), 40);
});
