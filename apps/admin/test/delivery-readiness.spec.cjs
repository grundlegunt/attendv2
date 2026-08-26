const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const page = readFileSync(resolve(__dirname, "../app/diagnostics/page.tsx"), "utf8");
const controller = readFileSync(resolve(__dirname, "../../api/src/cinema/cinema.controller.ts"), "utf8");
const service = readFileSync(resolve(__dirname, "../../api/src/cinema/cinema.service.ts"), "utf8");

test("Admin diagnostics disclose customer ticket-delivery readiness", () => {
  assert.match(controller, /admin\/delivery-readiness/);
  assert.match(service, /APPLE_WALLET_PROVIDER === "passkit"/);
  assert.match(service, /GOOGLE_WALLET_PROVIDER === "google"/);
  assert.match(service, /SMS_PROVIDER === "twilio"/);
  assert.match(page, /Ticket delivery readiness/);
  assert.match(page, /Apple Wallet/);
  assert.match(page, /Google Wallet/);
  assert.match(page, /SMS tickets/);
});
