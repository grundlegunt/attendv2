const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/components/seat-picker.tsx"), "utf8");

test("general-admission quantity changes invalidate stale availability polls", () => {
  const changeQuantity = source.match(/async function changeGeneralAdmissionQuantity[\s\S]*?async function closeAndRelease/);
  assert.ok(changeQuantity);
  assert.match(
    changeQuantity[0],
    /pendingSeatIdsRef\.current\.size > 0\) return;\s*refreshRequestRef\.current \+= 1;\s*refreshPendingRef\.current = false;[\s\S]*?await refresh\(\)/,
  );
});
