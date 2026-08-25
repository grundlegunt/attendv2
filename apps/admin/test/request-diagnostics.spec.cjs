const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const client = readFileSync(join(__dirname, "../app/lib/api-client.ts"), "utf8");
const recorder = readFileSync(join(__dirname, "../app/lib/request-diagnostics.ts"), "utf8");
const page = readFileSync(join(__dirname, "../app/diagnostics/page.tsx"), "utf8");

test("Admin records completed and failed requests without exposing request data", () => {
  assert.match(client, /finally \{\s*recordAdminRequestTiming/);
  assert.match(recorder, /path: path\.split\("\?"\)\[0\]/);
  assert.match(recorder, /page: window\.location\.pathname/);
  assert.match(recorder, /Content-Length/);
  assert.match(recorder, /timeToHeadersMs: headersAt === null/);
  assert.match(recorder, /bodyAndParseMs: headersAt === null/);
  assert.doesNotMatch(recorder, /accessToken|Authorization|body:/);
});

test("Admin diagnostics separate API latency from browser and transfer overhead", () => {
  assert.match(recorder, /Server-Timing/);
  assert.match(recorder, /db;dur=/);
  assert.match(page, /High database time or query count/);
  assert.match(page, /Average browser wait/);
  assert.match(page, /Average API time/);
  assert.match(page, /Outside API/);
  assert.match(page, /To headers/);
  assert.match(page, /Body\/parse/);
  assert.match(page, /Response size is shown when the server reports it/);
});

test("Admin diagnostics remain session-only and bounded", () => {
  assert.match(recorder, /window\.sessionStorage/);
  assert.match(recorder, /MAX_TIMINGS = 100/);
  assert.doesNotMatch(recorder, /localStorage/);
});
