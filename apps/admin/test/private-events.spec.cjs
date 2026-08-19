const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/private-events/page.tsx"), "utf8");

describe("private-event inquiry management", () => {
  it("uses authenticated API helpers for queue and CSV requests", () => {
    assert.match(source, /apiDownload, apiFetch, ApiRequestError/);
    assert.match(source, /await apiDownload\(/);
    assert.doesNotMatch(source, /await fetch\(/);
  });

  it("shows failures from loading, status updates, and exports", () => {
    assert.match(source, /Private-event inquiries could not be loaded/);
    assert.match(source, /The inquiry status could not be updated/);
    assert.match(source, /The inquiry export could not be downloaded/);
    assert.match(source, /className="error-banner" role="alert"/);
  });

  it("cancels stale queue requests when filters change", () => {
    assert.match(source, /const controller = new AbortController\(\)/);
    assert.match(source, /signal: controller\.signal/);
    assert.match(source, /reason\.name === "AbortError"/);
    assert.match(source, /controller\.abort\(\)/);
  });
});
