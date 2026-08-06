"use client";

import { FormEvent, useEffect, useState } from "react";
import { customerBrandingDefaults } from "@cinema/shared";
import { apiFetch, ApiRequestError } from "./lib/api-client";

export type BrandingSettings = {
  name: string;
  customerLogoUrl: string | null;
  customerAccentColor: string | null;
  customerAccentMutedColor: string | null;
  customerBackgroundColor: string | null;
  customerSurfaceColor: string | null;
  customerTextColor: string | null;
  customerMutedTextColor: string | null;
};

type BrandingForm = { name: string; logoUrl: string; accentColor: string; accentMutedColor: string; backgroundColor: string; surfaceColor: string; textColor: string; mutedTextColor: string };

const fromSettings = (settings: BrandingSettings): BrandingForm => ({
  name: settings.name,
  logoUrl: settings.customerLogoUrl ?? "",
  accentColor: settings.customerAccentColor ?? customerBrandingDefaults.accentColor,
  accentMutedColor: settings.customerAccentMutedColor ?? customerBrandingDefaults.accentMutedColor,
  backgroundColor: settings.customerBackgroundColor ?? customerBrandingDefaults.backgroundColor,
  surfaceColor: settings.customerSurfaceColor ?? customerBrandingDefaults.surfaceColor,
  textColor: settings.customerTextColor ?? customerBrandingDefaults.textColor,
  mutedTextColor: settings.customerMutedTextColor ?? customerBrandingDefaults.mutedTextColor,
});

function contrastRatio(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255).map((value) => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    const [red = 0, green = 0, blue = 0] = channels;
    return .2126 * red + .7152 * green + .0722 * blue;
  };
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  const light = Math.max(foregroundLuminance, backgroundLuminance);
  const dark = Math.min(foregroundLuminance, backgroundLuminance);
  return (light + .05) / (dark + .05);
}

const colorFields: Array<[keyof BrandingForm, string]> = [
  ["accentColor", "Primary accent"], ["accentMutedColor", "Muted accent"],
  ["backgroundColor", "Page background"], ["surfaceColor", "Cards and panels"],
  ["textColor", "Primary text"], ["mutedTextColor", "Secondary text"],
];

export function BrandingEditor({ accessToken, settings, onSaved }: { accessToken: string; settings: BrandingSettings; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<BrandingForm>(() => fromSettings(settings));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setForm(fromSettings(settings)), [settings]);

  const textContrast = contrastRatio(form.textColor, form.backgroundColor);
  const mutedContrast = contrastRatio(form.mutedTextColor, form.backgroundColor);

  async function save(event: FormEvent) {
    event.preventDefault(); setError(null); setMessage(null);
    try {
      await apiFetch("/management/settings/location", { accessToken, method: "PATCH", body: JSON.stringify({ ...form, logoUrl: form.logoUrl || null }) });
      setMessage("Customer-site branding saved. New visits will load it automatically.");
      await onSaved();
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "Branding could not be saved."); }
  }

  async function reset() {
    setError(null); setMessage(null);
    try {
      await apiFetch("/management/settings/location", { accessToken, method: "PATCH", body: JSON.stringify({ logoUrl: null, accentColor: null, accentMutedColor: null, backgroundColor: null, surfaceColor: null, textColor: null, mutedTextColor: null }) });
      setMessage("Customer-site branding reset to Attend defaults.");
      await onSaved();
    } catch (reason) { setError(reason instanceof ApiRequestError ? reason.body.message : "Branding could not be reset."); }
  }

  return <form className="panel branding-editor" onSubmit={(event) => void save(event)}>
    <div className="management-heading"><div><p className="kicker">CUSTOMER WEBSITE</p><h2>Branding</h2><p className="muted">Control this cinema’s identity without changing Attend Admin.</p></div><button type="button" className="secondary" onClick={() => void reset()}>Reset Attend defaults</button></div>
    {error && <div className="error-banner">{error}</div>}{message && <div className="success-banner">{message}</div>}
    <div className="branding-layout">
      <div className="branding-fields">
        <label>Cinema display name<input required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label>Logo URL or site path (optional)<input placeholder="https://… or /logo.svg" value={form.logoUrl} onChange={(event) => setForm({ ...form, logoUrl: event.target.value })} /></label>
        <div className="branding-colors">{colorFields.map(([key, label]) => <label key={key}>{label}<span className="color-control"><input type="color" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /><input pattern="#[0-9a-fA-F]{6}" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></span></label>)}</div>
        {(textContrast < 4.5 || mutedContrast < 4.5) && <p className="contrast-warning">Contrast warning: primary and secondary text should each reach at least 4.5:1 against the page background.</p>}
        <button className="primary">Save customer-site branding</button>
      </div>
      <div className="branding-preview" style={{ background: form.backgroundColor, color: form.textColor, borderColor: form.accentMutedColor }}>
        <header style={{ borderColor: form.accentMutedColor }}>{form.logoUrl ? <img src={form.logoUrl} alt="Brand preview" /> : <div><small style={{ color: form.accentColor }}>CINEMA</small><strong>{form.name}</strong></div>}</header>
        <main><small style={{ color: form.accentColor }}>NOW PLAYING</small><h3>Tonight at the movies</h3><p style={{ color: form.mutedTextColor }}>Preview customer-facing headings, panels, and calls to action.</p><div style={{ background: form.surfaceColor, borderColor: form.accentMutedColor }}><strong>Featured showtime</strong><button type="button" style={{ background: form.accentColor, color: form.backgroundColor }}>7:30 PM</button></div></main>
      </div>
    </div>
  </form>;
}
