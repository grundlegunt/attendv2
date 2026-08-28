const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const controller = readFileSync(resolve(__dirname, "../../api/src/platform/platform.controller.ts"), "utf8");
const service = readFileSync(resolve(__dirname, "../../api/src/platform/platform.service.ts"), "utf8");

test("collection owner-only updates preserve remittance payment state", () => {
  assert.match(controller, /status: z\.enum\(\["DUE", "PAID", "VOID"\]\)\.optional\(\)/);
  assert.match(service, /status\?: "DUE" \| "PAID" \| "VOID"/);
  assert.match(service, /const status = input\.status \?\? before\.status/);
  assert.match(service, /input\.status === undefined\s*\? before\.paidAt/);
});
