const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const appRoot = join(__dirname, "../app");
const sessionSource = readFileSync(join(appRoot, "platform-session.ts"), "utf8");
const diagnosticsSource = readFileSync(join(appRoot, "diagnostics/page.tsx"), "utf8");

test("Master records bounded, privacy-safe request timing diagnostics", () => {
  assert.match(sessionSource, /Server-Timing/);
  assert.match(sessionSource, /path\.split\("\?"\)\[0\]/);
  assert.match(sessionSource, /\.slice\(0, 100\)/);
  assert.doesNotMatch(sessionSource, /body: init/);
  assert.match(sessionSource, /Diagnostics must never interrupt an operational request/);
});

test("Master exposes browser and API latency separately", () => {
  assert.match(diagnosticsSource, /Request diagnostics/);
  assert.match(diagnosticsSource, /Browser wait/);
  assert.match(diagnosticsSource, /API time/);
  assert.match(diagnosticsSource, /Outside API/);
  assert.match(diagnosticsSource, /timing\.totalMs >= 1_000/);
  assert.match(diagnosticsSource, /Clear session data/);
});
