const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const source = readFileSync(resolve(__dirname, "../app/branding-editor.tsx"), "utf8");

test("branding and website-copy publishers lock before React rerenders", () => {
  assert.equal(source.match(/const savingRef = useRef\(false\)/g)?.length, 2);
  assert.equal(source.match(/if \(savingRef\.current\) return;\s*savingRef\.current = true/g)?.length, 2);
  assert.equal(source.match(/finally \{ savingRef\.current = false; setSaving\(false\); \}/g)?.length, 2);
});
