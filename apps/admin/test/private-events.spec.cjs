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

  it("retains a stable retry identity for status updates", () => {
    assert.match(source, /statusAttemptRef = useRef/);
    assert.match(source, /"Idempotency-Key": statusAttemptRef\.current\.requestId/);
  });

  it("serializes inquiry status changes before React rerenders", () => {
    assert.match(source, /const statusActionRef = useRef\(false\)/);
    assert.match(source, /if \(statusActionRef\.current\) return;\s*statusActionRef\.current = true/);
    assert.match(source, /finally \{\s*statusActionRef\.current = false;\s*setStatusActionId\(null\)/);
    assert.match(source, /disabled=\{statusActionId !== null\}/);
  });

  it("shows preferred and received dates in the cinema timezone", () => {
    assert.match(source, /const \{ accessToken, employee \} = useAdminSession\(\)/);
    assert.match(source, /item\.preferredDate\)\.toLocaleDateString\(\[\], \{ timeZone \}\)/);
    assert.match(source, /item\.createdAt\)\.toLocaleString\(\[\], \{ timeZone \}\)/);
  });
});
