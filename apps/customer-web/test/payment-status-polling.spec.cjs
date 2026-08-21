const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const checkout = readFileSync(join(__dirname, "../app/components/ticket-checkout.tsx"), "utf8");
const giftCards = readFileSync(join(__dirname, "../app/gift-cards/page.tsx"), "utf8");

test("ticket checkout stops polling a perpetually processing payment", () => {
  assert.match(checkout, /PAYMENT_STATUS_POLL_LIMIT = 10/);
  assert.match(checkout, /processingPolls >= PAYMENT_STATUS_POLL_LIMIT/);
  assert.match(checkout, /setCheckout\(resumed\)/);
  assert.match(checkout, /Payment is still processing\. Please wait a moment, then refresh this page\./);
});

test("gift-card checkout stops polling while preserving the resumable purchase", () => {
  assert.match(giftCards, /PAYMENT_STATUS_POLL_LIMIT = 10/);
  assert.match(giftCards, /processingPolls >= PAYMENT_STATUS_POLL_LIMIT/);
  assert.match(giftCards, /setPurchase\(resumed\)/);
  assert.match(giftCards, /Payment is still processing\. Please wait a moment, then refresh this page\./);
});
