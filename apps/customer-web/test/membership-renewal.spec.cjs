const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const page = readFileSync(resolve(__dirname, "../app/membership/page.tsx"), "utf8");

test("the public membership flow clearly supports renewals", () => {
  assert.match(page, /Join or renew/);
  assert.match(page, /Existing members can renew/);
  assert.match(page, /Activate for/);
});
