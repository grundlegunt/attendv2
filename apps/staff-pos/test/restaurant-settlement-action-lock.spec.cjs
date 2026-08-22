const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/restaurant-pos.tsx"), "utf8");

test("check-level restaurant actions wait for every active POS operation", () => {
  for (const key of ["drop", "finalize", "guest-link"]) {
    const action = `const actionKey = \`${key}:\${tabId}\`;`;
    const start = source.indexOf(action);
    assert.notEqual(start, -1);
    assert.match(
      source.slice(start, start + 220),
      /if \(!tabId \|\| actionLocks\.current\.size > 0 \|\| !beginAction\(actionKey\)\) return/,
    );
  }
  assert.doesNotMatch(source, /hasPendingSettlementAction/);
});
