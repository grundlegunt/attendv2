"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { trackOptionalPageview } from "../lib/optional-analytics";

const SCRIPT_ID = "attend-optional-analytics";

function configuredScriptUrl() {
  const value = process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function installPlausible(scriptUrl: string, onReady: () => void) {
  window.plausible ??= Object.assign(
    (...args: unknown[]) => { window.plausible?.q?.push(args); },
    {
      q: [] as unknown[][],
      init: (options = {}) => { if (window.plausible) window.plausible.o = options; },
    },
  );

  const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
  if (existing?.dataset.ready === "true") {
    onReady();
    return;
  }
  if (existing) {
    existing.addEventListener("load", onReady, { once: true });
    return;
  }

  const script = document.createElement("script");
  script.id = SCRIPT_ID;
  script.async = true;
  script.src = scriptUrl;
  script.addEventListener("load", () => {
    script.dataset.ready = "true";
    window.plausible?.init?.({ autoCapturePageviews: false });
    onReady();
  }, { once: true });
  document.head.appendChild(script);
}

export function OptionalAnalytics() {
  const pathname = usePathname();
  const lastTrackedPath = useRef<string | null>(null);

  useEffect(() => {
    const scriptUrl = configuredScriptUrl();
    if (!scriptUrl) return;

    const track = () => {
      if (lastTrackedPath.current === pathname) return;
      trackOptionalPageview(pathname);
      if (document.documentElement.dataset.analyticsConsent === "analytics") {
        lastTrackedPath.current = pathname;
      }
    };
    const handleConsent = (event: Event) => {
      const choice = (event as CustomEvent<{ choice?: string }>).detail?.choice;
      if (choice === "analytics") installPlausible(scriptUrl, track);
      else lastTrackedPath.current = null;
    };

    window.addEventListener("attend:analytics-consent", handleConsent);
    if (document.documentElement.dataset.analyticsConsent === "analytics") {
      installPlausible(scriptUrl, track);
    }
    return () => window.removeEventListener("attend:analytics-consent", handleConsent);
  }, [pathname]);

  return null;
}
