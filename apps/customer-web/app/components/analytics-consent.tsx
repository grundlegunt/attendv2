"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export type AnalyticsConsentChoice = "essential" | "analytics";
export const ANALYTICS_CONSENT_KEY = "attend.analytics-consent.v1";

function readChoice() {
  try { return window.localStorage.getItem(ANALYTICS_CONSENT_KEY); } catch { return null; }
}

function persistChoice(choice: AnalyticsConsentChoice) {
  try { window.localStorage.setItem(ANALYTICS_CONSENT_KEY, choice); } catch { /* Keep the in-memory choice for this visit. */ }
}

function applyChoice(choice: AnalyticsConsentChoice) {
  document.documentElement.dataset.analyticsConsent = choice;
  window.dispatchEvent(new CustomEvent("attend:analytics-consent", { detail: { choice } }));
}

export function AnalyticsConsent() {
  const [choice, setChoice] = useState<AnalyticsConsentChoice | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const saved = readChoice();
    if (saved === "essential" || saved === "analytics") {
      setChoice(saved);
      applyChoice(saved);
      return;
    }
    // Optional analytics always starts disabled. Merely viewing or dismissing
    // the page never constitutes consent.
    applyChoice("essential");
    setOpen(true);
  }, []);

  function save(next: AnalyticsConsentChoice) {
    persistChoice(next);
    setChoice(next);
    setOpen(false);
    applyChoice(next);
  }

  if (!open) return choice ? <button className="privacy-choices" type="button" onClick={() => setOpen(true)}>Privacy choices</button> : null;

  return (
    <aside className="analytics-consent" aria-label="Privacy choices" aria-live="polite">
      <div>
        <strong>Your privacy choices</strong>
        <p>Essential storage keeps ticketing and account features working. Optional analytics would help the cinema understand site usage, but stays off unless you choose it.</p>
        <Link href="/privacy">Read the privacy notice</Link>
      </div>
      <div className="analytics-consent__actions">
        <button type="button" onClick={() => save("essential")}>Essential only</button>
        <button className="primary" type="button" onClick={() => save("analytics")}>Allow optional analytics</button>
      </div>
    </aside>
  );
}
