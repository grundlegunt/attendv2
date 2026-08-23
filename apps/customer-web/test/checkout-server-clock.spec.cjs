const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/components/seat-picker.tsx"), "utf8");

test("ticket hold countdowns use the availability server clock", () => {
  assert.match(source, /Date\.parse\(nextAvailability\.serverTime\)/);
  assert.match(source, /serverTimestamp - Date\.now\(\)/);
  assert.match(source, /expiresAt - \(now \+ serverClockOffsetMs\)/);
});

test("invalid server timestamps safely fall back to the device clock", () => {
  assert.match(
    source,
    /setServerClockOffsetMs\(Number\.isFinite\(serverTimestamp\) \? serverTimestamp - Date\.now\(\) : 0\)/,
  );
});
