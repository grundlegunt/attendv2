export const OPTIONAL_ANALYTICS_EVENTS = [
  "Checkout Started",
  "Checkout Completed",
  "Account Created",
  "Gift Card Started",
  "Membership Checkout Started",
  "Membership Activated",
  "Donation Checkout Started",
  "Donation Completed",
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
  return typeof document !== "undefined" && document.documentElement.dataset.analyticsConsent === "analytics";
}

export function trackOptionalAnalyticsEvent(event: OptionalAnalyticsEvent) {
  if (!analyticsAllowed()) return;
  window.plausible?.(event);
}

export function trackOptionalPageview(pathname: string) {
  if (!analyticsAllowed()) return;
  window.plausible?.("pageview", { url: `${window.location.origin}${analyticsPath(pathname)}` });
}
