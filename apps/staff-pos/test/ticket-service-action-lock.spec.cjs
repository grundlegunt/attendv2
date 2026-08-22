const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/ticket-service.tsx"), "utf8");

test("staff ticket-service operations share an immediate busy lock", () => {
  assert.equal((source.match(/if \(busyRef\.current\) return/g) ?? []).length, 5);
  assert.equal((source.match(/busyRef\.current = true/g) ?? []).length, 5);
  assert.equal((source.match(/busyRef\.current = false/g) ?? []).length, 5);
});

test("ticket exchanges acquire the lock before holding a replacement seat", () => {
  const exchange = source.match(/async function completeExchange[\s\S]*?return \(/);
  assert.ok(exchange);
  assert.match(exchange[0], /if \(busyRef\.current\) return;\s*busyRef\.current = true[\s\S]*?\/holds/);
});
