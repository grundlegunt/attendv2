const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/components/seat-picker.tsx"), "utf8");

test("the hold countdown does not recreate checkout seat arrays every second", () => {
  assert.match(source, /const checkoutSeats = useMemo\([\s\S]*?\[mySeats\]\);/);
  assert.match(source, /holdTokens=\{checkoutSeats\.holdTokens\}/);
  assert.match(source, /seats=\{checkoutSeats\.labels\}/);
  assert.doesNotMatch(source, /holdTokens=\{mySeats\.map/);
  assert.doesNotMatch(source, /seats=\{mySeats\.map/);
});
