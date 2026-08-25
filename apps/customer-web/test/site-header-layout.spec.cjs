const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");

const styles = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");

test("customer header shares the centered route-page structure", () => {
  const header = styles.match(/\.site-header__inner\s*\{([^}]+)\}/)?.[1] ?? "";
  const route = styles.match(/\.route-page\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(header, /max-width:\s*1320px/);
  assert.match(header, /margin:\s*0 auto/);
  assert.match(header, /padding:\s*14px clamp\(20px, 5vw, 72px\)/);
  assert.match(route, /max-width:\s*1320px/);
  assert.match(route, /margin:\s*0 auto/);
});
