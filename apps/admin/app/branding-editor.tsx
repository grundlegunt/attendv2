"use client";

import { adminBrandingDefaults, customerBrandingDefaults } from "@cinema/shared";

export type BrandingSettings = {
  name: string;
  customerLogoUrl: string | null;
  customerAccentColor: string | null;
  customerAccentMutedColor: string | null;
  customerBackgroundColor: string | null;
  customerSurfaceColor: string | null;
  customerTextColor: string | null;
  customerMutedTextColor: string | null;
  adminAccentColor: string | null;
  adminAccentMutedColor: string | null;
  adminBackgroundColor: string | null;
  adminSurfaceColor: string | null;
  adminTextColor: string | null;
  adminMutedTextColor: string | null;
};

function Palette({ title, colors }: { title: string; colors: Array<[string, string]> }) {
  return <section className="brand-summary-card">
    <p className="kicker">{title}</p>
    <div className="brand-swatches">{colors.map(([label, color]) => <div key={label}><i style={{ background: color }} /><span>{label}<small>{color}</small></span></div>)}</div>
  </section>;
}

export function BrandingSummary({ settings }: { settings: BrandingSettings }) {
  const customer = [
    ["Accent", settings.customerAccentColor ?? customerBrandingDefaults.accentColor],
    ["Muted accent", settings.customerAccentMutedColor ?? customerBrandingDefaults.accentMutedColor],
    ["Background", settings.customerBackgroundColor ?? customerBrandingDefaults.backgroundColor],
    ["Surface", settings.customerSurfaceColor ?? customerBrandingDefaults.surfaceColor],
    ["Text", settings.customerTextColor ?? customerBrandingDefaults.textColor],
    ["Muted text", settings.customerMutedTextColor ?? customerBrandingDefaults.mutedTextColor],
  ] as Array<[string, string]>;
  const admin = [
    ["Accent", settings.adminAccentColor ?? adminBrandingDefaults.accentColor],
    ["Muted accent", settings.adminAccentMutedColor ?? adminBrandingDefaults.accentMutedColor],
    ["Background", settings.adminBackgroundColor ?? adminBrandingDefaults.backgroundColor],
    ["Surface", settings.adminSurfaceColor ?? adminBrandingDefaults.surfaceColor],
    ["Text", settings.adminTextColor ?? adminBrandingDefaults.textColor],
    ["Muted text", settings.adminMutedTextColor ?? adminBrandingDefaults.mutedTextColor],
  ] as Array<[string, string]>;

  return <section className="panel branding-summary">
    <div className="management-heading"><div><p className="kicker">BRAND STATUS</p><h2>{settings.name}</h2><p className="muted">Customer and cinema-admin branding is published centrally by Attend Master.</p></div><span className="managed-badge">MANAGED BY ATTEND</span></div>
    {settings.customerLogoUrl && <div className="brand-logo-summary"><span>Customer logo</span><img src={settings.customerLogoUrl} alt={`${settings.name} logo`} /></div>}
    <div className="brand-summary-grid"><Palette title="CUSTOMER WEBSITE" colors={customer} /><Palette title="CINEMA ADMIN" colors={admin} /></div>
    <p className="brand-support-note">Need a brand change? Contact Attend support. Cinema staff can manage operations here without changing the public identity or admin theme.</p>
  </section>;
}
