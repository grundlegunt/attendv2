const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const helper = readFileSync(resolve(__dirname, "../app/lib/checkout-customer.ts"), "utf8");
const route = readFileSync(
  resolve(__dirname, "../app/api/v1/ticketing/checkouts/route.ts"),
  "utf8",
);

test("checkout trusts the signed-in customer identity instead of submitted email", () => {
  assert.match(helper, /verifyAccessToken\(token, secret\)/);
  assert.match(helper, /actor\.actorType !== "CUSTOMER"/);
  assert.match(helper, /Number\.isInteger\(actor\.tokenVersion\)/);
  assert.match(helper, /refreshTokenVersion: actor\.tokenVersion/);
  assert.match(route, /trustedCheckoutCustomer\(request, body\.email\)/);
  assert.match(route, /authenticatedCustomerId: customer\.customerId/);
  assert.match(route, /\.\.\.body,\s+email: customer\.email,/);
});

test("an invalid presented account session cannot fall back to guest checkout", () => {
  assert.match(helper, /if \(!token\) return \{ email: requestedEmail \}/);
  assert.match(helper, /verifyAccessToken\(token, secret\);\s+\} catch \{\s+throw new CheckoutSessionError\(\)/);
  assert.match(route, /error instanceof CheckoutSessionError/);
  assert.match(route, /status: 401/);
});
