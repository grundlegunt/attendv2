const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");
const source = readFileSync(resolve(__dirname, "../app/platform-nav.tsx"), "utf8");

test("shared Master navigation includes every operating workspace", () => {
  for (const path of ["/clients", "/benchmarks", "/films", "/distributors", "/analytics", "/onboarding", "/payments", "/operations", "/content", "/branding", "/team", "/audit", "/diagnostics"]) assert.match(source, new RegExp(path));
});

test("shared Master navigation derives active state and protects Team visibility", () => {
  assert.match(source, /usePathname/);
  assert.match(source, /pathname\.startsWith/);
  assert.match(source, /role === "OWNER"/);
});

test("migrated Master workspaces use the shared navigation", () => {
  for (const workspace of ["analytics", "audit", "branding", "diagnostics", "distributors", "films", "onboarding", "payments", "team"]) {
    const page = readFileSync(resolve(__dirname, `../app/${workspace}/page.tsx`), "utf8");
    assert.match(page, /import \{ PlatformNav \} from "\.\.\/platform-nav"/);
    assert.match(page, /<PlatformNav role=\{session\.user\.role\} \/>/);
    assert.doesNotMatch(page, /<nav className="platform-nav"/);
  }
});

test("Master drill-down workspaces use the shared navigation", () => {
  const pages = [
    ["../app/films/[id]/page.tsx", /import \{ PlatformNav \} from "\.\.\/\.\.\/platform-nav"/],
    ["../app/clients/clients-page.tsx", /import \{ PlatformNav \} from "\.\.\/platform-nav"/],
  ];

  for (const [path, importPattern] of pages) {
    const page = readFileSync(resolve(__dirname, path), "utf8");
    assert.match(page, importPattern);
    assert.match(page, /<PlatformNav role=\{session\.user\.role\} \/>/);
    assert.doesNotMatch(page, /<nav className="platform-nav"/);
  }
});
