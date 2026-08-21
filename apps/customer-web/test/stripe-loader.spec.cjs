const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const loader = readFileSync(join(__dirname, "../app/lib/stripe-loader.ts"), "utf8");
const checkout = readFileSync(join(__dirname, "../app/components/ticket-checkout.tsx"), "utf8");
const giftCards = readFileSync(join(__dirname, "../app/gift-cards/page.tsx"), "utf8");

test("ticket and gift-card checkout share one in-flight Stripe loader", () => {
  assert.match(loader, /let stripeLoadPromise: Promise<void> \| null = null/);
  assert.match(loader, /if \(stripeLoadPromise\) return stripeLoadPromise/);
  assert.match(checkout, /await loadStripeScript\(\)/);
  assert.match(giftCards, /await loadStripeScript\(\)/);
});

test("Stripe loading times out cleanly and permits a later retry", () => {
  assert.match(loader, /STRIPE_LOAD_TIMEOUT_MS = 10_000/);
  assert.match(loader, /script\?\.remove\(\)/);
  assert.match(loader, /stripeLoadPromise = null/);
});
