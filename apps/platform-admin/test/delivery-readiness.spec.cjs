const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../../..");

test("Master overview reports deployment ticket-delivery readiness", () => {
  const service = fs.readFileSync(path.join(root, "apps/api/src/platform/platform.service.ts"), "utf8");
  const page = fs.readFileSync(path.join(root, "apps/platform-admin/app/page.tsx"), "utf8");

  for (const provider of ["EMAIL_PROVIDER", "SMS_PROVIDER", "APPLE_WALLET_PROVIDER", "GOOGLE_WALLET_PROVIDER"]) {
    assert.match(service, new RegExp(`env\\.${provider}`));
  }
  assert.match(page, /Platform readiness/);
  assert.match(page, /Email tickets/);
  assert.match(page, /SMS tickets/);
  assert.match(page, /Apple Wallet/);
  assert.match(page, /Google Wallet/);
  assert.match(page, /Not configured/);
});
