"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { trackOptionalPageview } from "../lib/optional-analytics";
import { apiFetch } from "../lib/api-client";

const SCRIPT_ID = "attend-optional-analytics";
const PLAUSIBLE_SCRIPT_URL = "https://plausible.io/js/script.manual.js";

type PublicAnalyticsSettings = { analytics?: { enabled?: boolean; provider?: string } };

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
  const scriptUrlRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    apiFetch<PublicAnalyticsSettings>("/platform/branding/public")
      .then((settings) => {
        if (cancelled) return;
        const masterEnabled = settings.analytics?.enabled === true && settings.analytics.provider === "PLAUSIBLE";
        scriptUrlRef.current = configuredScriptUrl() ?? (masterEnabled ? PLAUSIBLE_SCRIPT_URL : null);
        document.documentElement.dataset.analyticsEnabled = scriptUrlRef.current ? "true" : "false";
        window.dispatchEvent(new CustomEvent("attend:analytics-configuration-ready"));
      })
      .catch(() => {
        if (cancelled) return;
        scriptUrlRef.current = configuredScriptUrl();
        document.documentElement.dataset.analyticsEnabled = scriptUrlRef.current ? "true" : "false";
        window.dispatchEvent(new CustomEvent("attend:analytics-configuration-ready"));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {

    const track = () => {
      if (lastTrackedPath.current === pathname) return;
      trackOptionalPageview(pathname);
      if (document.documentElement.dataset.analyticsConsent === "analytics") {
        lastTrackedPath.current = pathname;
      }
    };
    const handleConsent = (event: Event) => {
      const choice = (event as CustomEvent<{ choice?: string }>).detail?.choice;
      const scriptUrl = scriptUrlRef.current;
      if (choice === "analytics" && scriptUrl) {
        installPlausible(scriptUrl, () => undefined);
        track();
      }
      else lastTrackedPath.current = null;
    };
    const handleConfiguration = () => {
      const scriptUrl = scriptUrlRef.current;
      if (scriptUrl && document.documentElement.dataset.analyticsConsent === "analytics") {
        installPlausible(scriptUrl, () => undefined);
        track();
      }
    };

    window.addEventListener("attend:analytics-consent", handleConsent);
    window.addEventListener("attend:analytics-configuration-ready", handleConfiguration);
    handleConfiguration();
    return () => {
      window.removeEventListener("attend:analytics-consent", handleConsent);
      window.removeEventListener("attend:analytics-configuration-ready", handleConfiguration);
    };
  }, [pathname]);

  return null;
}
