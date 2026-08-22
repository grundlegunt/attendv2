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

test("expense deletion retries retain one request identity", () => {
  assert.match(source, /deleteExpenseAttemptRef = useRef/);
  assert.match(source, /"Idempotency-Key": deleteExpenseAttemptRef\.current\.requestId/);
});

test("expense mutations share an immediate action lock", () => {
  assert.match(source, /const mutationPendingRef = useRef\(false\)/);
  assert.match(source, /async function createExpense[\s\S]*?if \(mutationPendingRef\.current\) return;\s*mutationPendingRef\.current = true/);
  assert.match(source, /async function removeExpense[\s\S]*?if \(mutationPendingRef\.current\) return;[\s\S]*?mutationPendingRef\.current = true/);
  assert.match(source, /deletingExpenseId === expense\.id \? "Deleting…" : "Delete"/);
});
