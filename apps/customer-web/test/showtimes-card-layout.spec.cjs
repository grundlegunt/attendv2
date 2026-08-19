const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { describe, it } = require("node:test");

const styles = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");

describe("showtimes card layout", () => {
  it("keeps three columns and uses the live-reference 5:3 artwork ratio", () => {
    assert.match(styles, /\.movie-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s);
    assert.match(styles, /\.program-tile__image\s*\{[^}]*aspect-ratio:\s*5 \/ 3;/s);
  });
});
