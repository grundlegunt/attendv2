const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");

const app = resolve(__dirname, "../app");
const read = (file) => readFileSync(resolve(app, file), "utf8");

describe("customer-site discovery", () => {
  it("publishes social metadata and an install manifest", () => {
    const layout = read("layout.tsx");
    assert.match(layout, /openGraph:/);
    assert.match(layout, /twitter:/);
    assert.match(layout, /manifest:\s*"\/manifest\.webmanifest"/);
    assert.doesNotMatch(layout, /canonical:/);
    assert.doesNotMatch(layout, /openGraph:\s*\{[^}]*url:/s);
    assert.match(read("manifest.ts"), /display:\s*"standalone"/);
  });

  it("publishes robots and a sitemap without indexing private utility pages", () => {
    const robots = read("robots.ts");
    const sitemap = read("sitemap.ts");
    assert.match(robots, /disallow:\s*\["\/account", "\/signage"\]/);
    assert.match(robots, /sitemap\.xml/);
    assert.match(sitemap, /"\/showtimes"/);
    assert.match(sitemap, /"\/coming-soon"/);
    assert.doesNotMatch(sitemap, /"\/account"/);
  });

  it("normalizes the configured public URL before building discovery links", () => {
    const siteUrl = read("lib/site-url.ts");
    assert.match(siteUrl, /configuredSiteUrl\.replace\(\/\\\/\+\$\//);
    assert.match(read("robots.ts"), /customerSiteUrl/);
    assert.match(read("sitemap.ts"), /customerSiteUrl/);
  });
});
