const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const source = readFileSync(resolve(__dirname, "../app/admin-dashboard.tsx"), "utf8");
const css = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");

test("dashboard preferences are loaded and saved for the signed-in employee", () => {
  assert.match(source, /apiFetch<DashboardPreferences>\("\/management\/dashboard-preferences"/);
  assert.match(source, /method: "PATCH"/);
  assert.match(source, /"Idempotency-Key": preferenceAttemptRef\.current\.requestId/);
  assert.match(source, /These settings apply only to your account\./);
});

test("dashboard customization preserves permission gates", () => {
  assert.match(source, /canCinema && visible\("schedule"\)/);
  assert.match(source, /canFinancial && visible\("topFilms"\)/);
  assert.match(source, /canAudit && visible\("activity"\)/);
});

test("quick actions stack directly beneath cinema setup", () => {
  assert.match(source, /visible\("setup"\)[\s\S]+visible\("quickActions"\)/);
  assert.match(css, /\.dashboard-top-widgets, \.dashboard-column \{ display: flex; flex-direction: column; gap: 18px; \}/);
});
