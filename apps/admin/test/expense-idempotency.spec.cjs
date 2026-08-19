const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/expenses/page.tsx"), "utf8");

test("expense retries retain one request identity for unchanged details", () => {
  assert.match(source, /expenseAttemptRef = useRef/);
  assert.match(source, /fingerprint !== fingerprint/);
  assert.match(source, /"Idempotency-Key": expenseAttemptRef\.current\.requestId/);
  assert.match(source, /reason\.status < 500/);
});
