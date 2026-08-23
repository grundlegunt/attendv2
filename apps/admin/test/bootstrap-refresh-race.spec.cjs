const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

for (const page of ["cinema-setup/page.tsx", "film-series/page.tsx"]) {
  test(`${page} ignores superseded bootstrap responses`, () => {
    const source = readFileSync(join(__dirname, "../app", page), "utf8");
    assert.match(source, /const refreshRequestRef = useRef\(0\)/);
    assert.match(source, /const requestId = \+\+refreshRequestRef\.current/);
    assert.match(source, /requestId === refreshRequestRef\.current\) setData\(nextData\)/);
    assert.match(source, /requestId === refreshRequestRef\.current\) showError\(reason\)/);
    assert.match(source, /return \(\) => \{ refreshRequestRef\.current \+= 1; \}/);
  });
}
