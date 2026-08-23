const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appRoot = path.join(__dirname, "..", "app");
const pages = [
  "page.tsx",
  "onboarding/page.tsx",
  "audit/page.tsx",
  "payments/page.tsx",
  "branding/page.tsx",
  "content/page.tsx",
  "team/page.tsx",
  "clients/clients-page.tsx",
];

test("platform sign-in responses cannot restore a superseded session", () => {
  for (const relativePath of pages) {
    const source = fs.readFileSync(path.join(appRoot, relativePath), "utf8");
    assert.match(source, /const authRequestRef = useRef\(0\)/, relativePath);
    assert.match(source, /const requestId = \+\+authRequestRef\.current/, relativePath);
    assert.match(source, /if \(requestId !== authRequestRef\.current\) return;/, relativePath);
    assert.match(source, /function signOut\(\)[\s\S]{0,80}authRequestRef\.current \+= 1;/, relativePath);
  }
});

