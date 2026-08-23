const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/components/ticket-checkout.tsx"), "utf8");

test("signed-in checkout keeps the purchase attached to the restored account email", () => {
  assert.doesNotMatch(source, /emailDirtyRef/);
  assert.match(source, /if \(account\.customer\.email\) setEmail\(account\.customer\.email\)/);
  assert.match(source, /readOnly=\{accountRecognized\}/);
  assert.match(source, /Sign out from Account to purchase under a different email\./);
});
