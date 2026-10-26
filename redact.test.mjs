import { test } from "node:test";
import assert from "node:assert/strict";
import { redactSecrets } from "./redact.mjs";

const redacts = (input, secret) => {
  const { text, count } = redactSecrets(input);
  assert.ok(!text.includes(secret), `leaked: ${text}`);
  assert.ok(text.includes("[REDACTED]"));
  assert.ok(count >= 1);
};

const untouched = (input) => {
  const { text, count } = redactSecrets(input);
  assert.equal(text, input);
  assert.equal(count, 0);
};

test("known token formats", () => {
  redacts("key AKIAIOSFODNN7EXAMPLE here", "AKIAIOSFODNN7EXAMPLE");
  redacts("ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8", "ghp_a1B2");
  redacts("sk-ant-api03-abcdefghijklmnopqrstuvwx", "sk-ant-api03");
  redacts("xoxb-123456789012-abcdefghij", "xoxb-1234");
  redacts("AIza" + "SyA-1234567890abcdefghijklmnopqrstuv", "AIzaSy");
  redacts("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123_-sig", "eyJhbGci");
});

test("private key block", () => {
  redacts("-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----\nafter", "MIIabc");
});

test("url credentials and bearer", () => {
  const { text } = redactSecrets("postgres://admin:hunter22@db.local/x");
  assert.equal(text, "postgres://admin:[REDACTED]@db.local/x");
  redacts("Authorization: Bearer abcdef1234567890", "abcdef1234567890");
});

test("assignment forms", () => {
  redacts("password=hunter2", "hunter2");
  redacts("password: hunter2", "hunter2");
  redacts('"token": "abc123xyz"', "abc123xyz");
  redacts("api_key: 0123456789abcdef0123456789abcdef01234567", "0123456789abcdef");
  redacts("MY_SECRET = 'shh'", "shh");
});

test("entropy fallback", () => {
  redacts("value Zk3qP9xW2mTr7LcV5nBd8YfHa1Gs", "Zk3qP9xW2mTr");
});

test("no false positives", () => {
  untouched("Lessons learned: always keep the settings file out of the deploy.");
  untouched("useSyncExternalStore and createPluginContextFromManifest");
  untouched("see C:\\Utilities\\stewrd\\plugins\\notepad\\settings.json");
  untouched("https://github.com/anthropics/claude-code/tree/main/mods");
  untouched("commit 0c8f8bc9d1e2a3b4c5d6e7f8091a2b3c4d5e6f70 fixed it");
  untouched("id 123e4567-e89b-12d3-a456-426614174000");
});

test("count reflects every redaction", () => {
  const { count } = redactSecrets("password=a\npassword=b");
  assert.equal(count, 2);
});
