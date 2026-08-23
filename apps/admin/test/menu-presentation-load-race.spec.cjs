const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "../app/menu-manager.tsx"), "utf8");

test("published menu loading preserves edits made while the request is pending", () => {
  assert.match(source, /const menuPresentationDirtyRef = useRef\(false\)/);
  assert.match(source, /const requestId = \+\+menuPresentationRequestRef\.current/);
  assert.match(source, /if \(!menuPresentationDirtyRef\.current\) \{/);
  assert.match(source, /menuPresentationDirtyRef\.current = true; setMenuAssetUrl/);
  assert.match(source, /menuPresentationDirtyRef\.current = true; setMenuAssetType/);
  assert.match(source, /return \(\) => \{ menuPresentationRequestRef\.current \+= 1; \}/);
});
