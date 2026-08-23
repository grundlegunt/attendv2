const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const account = readFileSync(resolve(__dirname, "../app/account/page.tsx"), "utf8");
const authService = readFileSync(resolve(__dirname, "../../api/src/auth/auth.service.ts"), "utf8");
const shared = readFileSync(resolve(__dirname, "../../../packages/shared/src/auth-schemas.ts"), "utf8");

test("customer ticket orders include their cinema timezone", () => {
  assert.match(shared, /locationTimezone: string/);
  assert.match(authService, /location: \{ select: \{ name: true, timezone: true \} \}/);
  assert.match(authService, /locationTimezone: order\.location\.timezone/);
});

test("account order and showtime dates use the order cinema timezone", () => {
  assert.match(account, /function dateTime\(value: string, timeZone: string\)/);
  assert.match(account, /dateTime\(order\.createdAt, order\.locationTimezone\)/);
  assert.match(account, /dateTime\(ticket\.startsAt, order\.locationTimezone\)/);
});
