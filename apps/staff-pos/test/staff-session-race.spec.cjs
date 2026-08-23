const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/page.tsx"), "utf8");

test("staff authentication ignores responses superseded by sign out", () => {
  assert.match(source, /async function handleSubmit[\s\S]*?const requestId = \+\+refreshRequestRef\.current/);
  assert.match(source, /async function changePassword[\s\S]*?const requestId = \+\+refreshRequestRef\.current/);
  assert.match(source, /if \(requestId !== refreshRequestRef\.current\) return/);
  assert.match(source, /function signOut\(\)[\s\S]*?refreshRequestRef\.current \+= 1/);
});
