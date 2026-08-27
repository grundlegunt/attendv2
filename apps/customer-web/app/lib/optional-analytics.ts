import { apiFetch } from "./api-client";

export const OPTIONAL_ANALYTICS_EVENTS = [
  "Seat Selection Continued",
  "Checkout Started",
  "Payment Form Ready",
  "Checkout Completed",
  "Account Created",
  "Gift Card Started",
  "Gift Card Purchased",
  "Membership Checkout Started",
  "Membership Activated",
  "Donation Checkout Started",
  "Donation Completed",
  "Private Event Inquiry Submitted",
  "Waitlist Joined",
] as const;

export type OptionalAnalyticsEvent = (typeof OPTIONAL_ANALYTICS_EVENTS)[number];

type PlausibleFunction = {
  (event: string, options?: { props?: Record<string, string | number | boolean>; url?: string }): void;
  init?: (options?: { autoCapturePageviews?: boolean }) => void;
  q?: unknown[][];
  o?: { autoCapturePageviews?: boolean };
};

declare global {
  interface Window {
    plausible?: PlausibleFunction;
  }
}

/**
 * Collapse identifier-bearing customer routes before they leave the browser.
 * Query strings, order IDs, film IDs, and showtime IDs are never analytics data.
 */
export function analyticsPath(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "movie" && segments.length > 1) return "/movie/:movieId";
  if (segments[0] === "film-series" && segments.length > 1) return "/film-series/:seriesId";
  if (segments[0] === "tickets" && segments.length > 1) return "/tickets/:orderId";
  return `/${segments.join("/")}`;
}

function analyticsAllowed() {
  return typeof document !== "undefined" && document.documentElement.dataset.analyticsConsent === "analytics" && document.documentElement.dataset.analyticsEnabled === "true";
}

function recordFirstParty(event: OptionalAnalyticsEvent | "Pageview" | "Acquisition Source", path?: string) {
  void apiFetch<{ accepted: boolean }>("/cinema/analytics/events", {
    method: "POST",
    body: JSON.stringify({ event, ...(path ? { path } : {}) }),
    keepalive: true,
  }).catch(() => undefined);
}

export function analyticsAcquisitionSource(search: string, referrer: string): string {
  const campaign = new URLSearchParams(search).get("utm_source")?.trim().toLowerCase() ?? "";
  const source = campaign || (() => { try { return new URL(referrer).hostname.toLowerCase(); } catch { return ""; } })();
  if (!source) return "Direct";
  if (source.includes("google")) return "Google";
  if (source.includes("bing")) return "Bing";
  if (source.includes("facebook") || source === "fb" || source.includes("fb.com")) return "Facebook";
  if (source.includes("instagram")) return "Instagram";
  if (source === "x" || source.includes("x.com") || source.includes("twitter")) return "X";
  if (source.includes("email") || source.includes("newsletter") || source.includes("mail")) return "Email";
  return campaign ? "Other campaign" : "Other referral";
}

export function trackOptionalAnalyticsEvent(event: OptionalAnalyticsEvent) {
  if (!analyticsAllowed()) return;
  window.plausible?.(event);
  recordFirstParty(event);
}

export function trackOptionalPageview(pathname: string) {
  if (!analyticsAllowed()) return;
  const path = analyticsPath(pathname);
  window.plausible?.("pageview", { url: `${window.location.origin}${path}` });
  recordFirstParty("Pageview", path);
  const acquisitionKey = "ringo.analytics-acquisition.v1";
  if (window.sessionStorage.getItem(acquisitionKey) !== "recorded") {
    recordFirstParty("Acquisition Source", analyticsAcquisitionSource(window.location.search, document.referrer));
    window.sessionStorage.setItem(acquisitionKey, "recorded");
  }
}
