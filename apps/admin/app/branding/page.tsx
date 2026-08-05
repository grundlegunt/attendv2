"use client";

import { FormEvent, useEffect, useState } from "react";
import type { LocationBranding, PublicBrandingResponse } from "@cinema/shared";
import { useAdminSession } from "../admin-session";
import { apiFetch, ApiRequestError } from "../lib/api-client";

const colorFields: Array<[keyof LocationBranding, string]> = [
  ["accentColor", "Accent"], ["accentMutedColor", "Muted accent"],
  ["backgroundColor", "Page background"], ["elevatedColor", "Card background"],
  ["textPrimaryColor", "Primary text"], ["textSecondaryColor", "Secondary text"],
];

export default function BrandingPage() {
  const { employee, accessToken } = useAdminSession();
  const [locationName, setLocationName] = useState("");
  const [branding, setBranding] = useState<LocationBranding | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const allowed = employee.permissions.includes("branding.manage");

  useEffect(() => {
    if (!allowed) return;
    apiFetch<PublicBrandingResponse>("/management/branding", { accessToken })
      .then((response) => { setLocationName(response.locationName); setBranding(response.branding); })
      .catch((reason) => setError(reason instanceof ApiRequestError ? reason.body.message : "Branding could not be loaded."));
  }, [accessToken, allowed]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!branding) return;
    setError(null); setSaved(false);
    try {
      const response = await apiFetch<PublicBrandingResponse>("/management/branding", { accessToken, method: "PATCH", body: JSON.stringify(branding) });
      setBranding(response.branding); setSaved(true);
      window.dispatchEvent(new CustomEvent("attend-branding-updated", { detail: response.branding }));
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "Branding could not be saved."); }
  }

  if (!allowed) return <main className="admin-route-page"><div className="error-banner">You do not have permission to manage branding.</div></main>;
  if (!branding) return <main className="admin-route-page"><p>{error ?? "Loading branding…"}</p></main>;

  const previewStyle = {
    "--preview-accent": branding.accentColor, "--preview-muted": branding.accentMutedColor,
    "--preview-bg": branding.backgroundColor, "--preview-elevated": branding.elevatedColor,
    "--preview-primary": branding.textPrimaryColor, "--preview-secondary": branding.textSecondaryColor,
  } as React.CSSProperties;

  return <main className="admin-route-page branding-workspace">
    <form className="panel branding-form" onSubmit={save}>
      <p className="kicker">BRANDING & APPEARANCE</p><h1>{locationName}</h1>
      <p>These settings apply only to this theater. The platform-owner interface remains independent.</p>
      {error && <div className="error-banner">{error}</div>}{saved && <div className="success-banner">Branding saved and published.</div>}
      <div className="two-fields"><label>Small brand label<input required maxLength={40} value={branding.eyebrow} onChange={(event) => setBranding({ ...branding, eyebrow: event.target.value })} /></label><label>Display name<input required maxLength={100} value={branding.displayName} onChange={(event) => setBranding({ ...branding, displayName: event.target.value })} /></label></div>
      <label>Logo URL (optional)<input type="url" value={branding.logoUrl ?? ""} onChange={(event) => setBranding({ ...branding, logoUrl: event.target.value || null })} placeholder="https://…" /></label>
      <div className="branding-colors">{colorFields.map(([key, label]) => <label key={key}>{label}<span className="color-control"><input type="color" value={String(branding[key])} onChange={(event) => setBranding({ ...branding, [key]: event.target.value })} /><input required pattern="#[0-9A-Fa-f]{6}" value={String(branding[key])} onChange={(event) => setBranding({ ...branding, [key]: event.target.value })} /></span></label>)}</div>
      <label>Admin appearance<select value={branding.adminTheme} onChange={(event) => setBranding({ ...branding, adminTheme: event.target.value as LocationBranding["adminTheme"] })}><option value="NEUTRAL">Neutral operational theme</option><option value="MATCH_CUSTOMER">Match customer colors</option></select></label>
      <button className="primary">Save and publish</button>
    </form>
    <section className="branding-preview" style={previewStyle} aria-label="Customer branding preview">
      <header>{branding.logoUrl ? <img src={branding.logoUrl} alt="" /> : <div><span>{branding.eyebrow}</span><strong>{branding.displayName}</strong></div>}<nav>Showtimes · Film Series · Account</nav></header>
      <div className="branding-preview__hero"><span>NOW PLAYING</span><h2>{locationName}</h2><p>Choose a showtime and reserve your seats.</p><button>7:30 PM</button></div>
    </section>
  </main>;
}
