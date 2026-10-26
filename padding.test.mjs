import { test } from "node:test";
import assert from "node:assert/strict";
import { keepLength } from "./padding.mjs";

test("keepLength trims trailing blanks", () => {
  assert.equal(keepLength("abc\n\n\n", 0), 3);
});

test("keepLength never cuts before the caret", () => {
  assert.equal(keepLength("abc\n\n\n", 5), 5);
});

test("keepLength is a no-op on clean text", () => {
  assert.equal(keepLength("abc", 1), 3);
});
