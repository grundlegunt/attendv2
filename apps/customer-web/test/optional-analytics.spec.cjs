const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const component = fs.readFileSync(path.join(__dirname, "../app/components/optional-analytics.tsx"), "utf8");
const tracker = fs.readFileSync(path.join(__dirname, "../app/lib/optional-analytics.ts"), "utf8");
const ticketCheckout = fs.readFileSync(path.join(__dirname, "../app/components/ticket-checkout.tsx"), "utf8");
const account = fs.readFileSync(path.join(__dirname, "../app/account/page.tsx"), "utf8");
const giftCards = fs.readFileSync(path.join(__dirname, "../app/gift-cards/page.tsx"), "utf8");
const membership = fs.readFileSync(path.join(__dirname, "../app/membership/page.tsx"), "utf8");
const donations = fs.readFileSync(path.join(__dirname, "../app/donate/page.tsx"), "utf8");
const privateEvents = fs.readFileSync(path.join(__dirname, "../app/private-events/page.tsx"), "utf8");
const seatPicker = fs.readFileSync(path.join(__dirname, "../app/components/seat-picker.tsx"), "utf8");

test("optional analytics is disabled without configuration and explicit consent", () => {
  assert.match(component, /masterEnabled \? PLAUSIBLE_SCRIPT_URL : null/);
  assert.match(component, /analyticsConsent === "analytics"/);
  assert.match(tracker, /dataset\.analyticsConsent === "analytics"/);
});

test("Master can enable a fixed trusted analytics provider at runtime", () => {
  assert.match(component, /platform\/branding\/public/);
  assert.match(component, /https:\/\/plausible\.io\/js\/script\.manual\.js/);
  assert.doesNotMatch(component, /settings\.analytics\?\.scriptUrl/);
});

test("consented activity is also recorded as privacy-safe first-party aggregates", () => {
  assert.match(component, /dataset\.analyticsEnabled/);
  assert.match(tracker, /cinema\/analytics\/events/);
  assert.match(tracker, /recordFirstParty\("Pageview", path\)/);
  assert.match(tracker, /JSON\.stringify\(\{ event, \.\.\.\(path \? \{ path \} : \{\}\) \}\)/);
});

test("analytics uses manual pageviews so withdrawing consent stops future tracking", () => {
  assert.match(component, /autoCapturePageviews: false/);
  assert.match(component, /attend:analytics-consent/);
});

test("first-party aggregates do not wait for the third-party script", () => {
  assert.match(component, /installPlausible\(scriptUrl, \(\) => undefined\);\s*track\(\);/);
  assert.match(tracker, /keepalive: true/);
});

test("identifier-bearing customer routes are redacted and query strings are excluded", () => {
  assert.match(tracker, /\/movie\/:movieId/);
  assert.match(tracker, /\/film-series\/:seriesId/);
  assert.match(tracker, /\/tickets\/:orderId/);
  assert.doesNotMatch(tracker, /location\.search/);
});

test("anonymous conversion events are connected to successful customer actions", () => {
  assert.match(ticketCheckout, /trackOptionalAnalyticsEvent\("Checkout Started"\)/);
  assert.match(ticketCheckout, /trackOptionalAnalyticsEvent\("Checkout Completed"\)/);
  assert.match(ticketCheckout, /checkoutCompletedTrackedRef/);
  assert.match(account, /trackOptionalAnalyticsEvent\("Account Created"\)/);
  assert.match(giftCards, /trackOptionalAnalyticsEvent\("Gift Card Started"\)/);
  assert.match(giftCards, /trackOptionalAnalyticsEvent\("Gift Card Purchased"\)/);
  assert.match(giftCards, /purchaseCompletedTrackedRef/);
  assert.match(membership, /trackOptionalAnalyticsEvent\("Membership Checkout Started"\)/);
  assert.match(membership, /trackOptionalAnalyticsEvent\("Membership Activated"\)/);
  assert.match(donations, /trackOptionalAnalyticsEvent\("Donation Checkout Started"\)/);
  assert.match(donations, /trackOptionalAnalyticsEvent\("Donation Completed"\)/);
  assert.match(privateEvents, /trackOptionalAnalyticsEvent\("Private Event Inquiry Submitted"\)/);
  assert.match(seatPicker, /trackOptionalAnalyticsEvent\("Waitlist Joined"\)/);
});

test("conversion tracking does not send customer or order properties", () => {
  for (const source of [ticketCheckout, account, giftCards, membership, donations, privateEvents, seatPicker]) {
    assert.doesNotMatch(source, /trackOptionalAnalyticsEvent\([^\n]+,\s*\{/);
  }
});
