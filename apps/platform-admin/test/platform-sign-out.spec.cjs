const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "../app");

test("Attend Master sign out revokes the server session from every page", () => {
  const sessionSource = readFileSync(join(root, "platform-session.ts"), "utf8");
  assert.match(sessionSource, /export async function revokePlatformSession/);
  assert.match(sessionSource, /\/platform\/auth\/logout/);
  assert.match(sessionSource, /method: "POST"/);

  const pages = [
    "page.tsx",
    "payments/page.tsx",
    "audit/page.tsx",
    "onboarding/page.tsx",
    "branding/page.tsx",
    "content/page.tsx",
    "team/page.tsx",
    "clients/clients-page.tsx",
  ];
  for (const page of pages) {
    const source = readFileSync(join(root, page), "utf8");
    assert.match(source, /revokePlatformSession\(API_BASE_URL, session\?\.accessToken\)/, page);
    assert.match(source, /sessionStorage\.removeItem\(STORAGE_KEY\)/, page);
  }
});
