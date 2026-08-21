const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/gift-cards/page.tsx"), "utf8");

test("gift-card setup cancels stale requests", () => {
  assert.match(source, /apiFetch<Config>\("\/gift-card-purchases\/config", \{ signal: controller\.signal \}\)/);
  assert.match(source, /if \(!controller\.signal\.aborted\) setConfigError/);
  assert.match(source, /return \(\) => controller\.abort\(\)/);
});

test("gift-card balance checks block duplicates and ignore stale results", () => {
  assert.match(source, /if \(balanceRequestRef\.current\) return/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /if \(balanceRequestRef\.current === controller\) setBalance\(next\)/);
  assert.match(source, /balanceRequestRef\.current\?\.abort\(\)/);
  assert.match(source, /disabled=\{balancePending\}/);
});
