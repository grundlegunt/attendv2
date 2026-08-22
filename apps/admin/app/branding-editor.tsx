"use client";

import { adminBrandingDefaults, customerBrandingDefaults } from "@cinema/shared";
import { FormEvent, useEffect, useRef, useState } from "react";

export type BrandingSettings = {
  name: string;
  customerLogoUrl: string | null;
  customerAccentColor: string | null;
  customerAccentMutedColor: string | null;
  customerBackgroundColor: string | null;
  customerBackgroundGlowColor: string | null;
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

export type SiteHeadingCopy = { eyebrow: string; title: string; intro: string };
export type CustomerSiteCopy = {
  showtimes: SiteHeadingCopy;
  comingSoon: SiteHeadingCopy;
  filmSeries: SiteHeadingCopy;
  dining: SiteHeadingCopy;
  about: SiteHeadingCopy & { body: string[] };
};

function Palette({ title, colors }: { title: string; colors: Array<[string, string]> }) {
  return <section className="brand-summary-card">
    <p className="kicker">{title}</p>
    <div className="brand-swatches">{colors.map(([label, color]) => <div key={label}><i style={{ background: color }} /><span>{label}<small>{color}</small></span></div>)}</div>
  </section>;
}

export type BrandingDraft = {
  name: string; logoUrl: string;
  accentColor: string; accentMutedColor: string; backgroundColor: string; backgroundGlowColor: string; surfaceColor: string; textColor: string; mutedTextColor: string;
  adminAccentColor: string; adminAccentMutedColor: string; adminBackgroundColor: string; adminSurfaceColor: string; adminTextColor: string; adminMutedTextColor: string;
};

function draftFrom(settings: BrandingSettings): BrandingDraft {
  return {
    name: settings.name, logoUrl: settings.customerLogoUrl ?? "",
    accentColor: settings.customerAccentColor ?? customerBrandingDefaults.accentColor,
    accentMutedColor: settings.customerAccentMutedColor ?? customerBrandingDefaults.accentMutedColor,
    backgroundColor: settings.customerBackgroundColor ?? customerBrandingDefaults.backgroundColor,
    backgroundGlowColor: settings.customerBackgroundGlowColor ?? customerBrandingDefaults.backgroundGlowColor,
    surfaceColor: settings.customerSurfaceColor ?? customerBrandingDefaults.surfaceColor,
    textColor: settings.customerTextColor ?? customerBrandingDefaults.textColor,
    mutedTextColor: settings.customerMutedTextColor ?? customerBrandingDefaults.mutedTextColor,
    adminAccentColor: settings.adminAccentColor ?? adminBrandingDefaults.accentColor,
    adminAccentMutedColor: settings.adminAccentMutedColor ?? adminBrandingDefaults.accentMutedColor,
    adminBackgroundColor: settings.adminBackgroundColor ?? adminBrandingDefaults.backgroundColor,
    adminSurfaceColor: settings.adminSurfaceColor ?? adminBrandingDefaults.surfaceColor,
    adminTextColor: settings.adminTextColor ?? adminBrandingDefaults.textColor,
    adminMutedTextColor: settings.adminMutedTextColor ?? adminBrandingDefaults.mutedTextColor,
  };
}

function ColorField({ label, field, draft, setDraft }: { label: string; field: keyof BrandingDraft; draft: BrandingDraft; setDraft: (draft: BrandingDraft) => void }) {
  const value = draft[field];
  return <label>{label}<span className="brand-color-input"><input type="color" value={value} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} /><input required pattern="#[0-9a-fA-F]{6}" value={value} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} /></span></label>;
}

export function BrandingSummary({ settings, onSave }: { settings: BrandingSettings; onSave: (draft: BrandingDraft) => Promise<void> }) {
  const [draft, setDraft] = useState(() => draftFrom(settings));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  useEffect(() => setDraft(draftFrom(settings)), [settings]);
  const customer = [
    ["Accent", settings.customerAccentColor ?? customerBrandingDefaults.accentColor],
    ["Muted accent", settings.customerAccentMutedColor ?? customerBrandingDefaults.accentMutedColor],
    ["Background", settings.customerBackgroundColor ?? customerBrandingDefaults.backgroundColor],
    ["Background glow", settings.customerBackgroundGlowColor ?? customerBrandingDefaults.backgroundGlowColor],
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try { await onSave(draft); } finally { savingRef.current = false; setSaving(false); }
  }

  return <form className="panel branding-summary brand-editor" onSubmit={(event) => void submit(event)}>
    <div className="management-heading"><div><p className="kicker">BRAND EDITOR</p><h2>{settings.name}</h2><p className="muted">Changes apply only to this cinema’s customer website and staff admin.</p></div><span className="managed-badge">LOCATION SCOPED</span></div>
    {settings.customerLogoUrl && <div className="brand-logo-summary"><span>Customer logo</span><img src={settings.customerLogoUrl} alt={`${settings.name} logo`} /></div>}
    <div className="brand-summary-grid"><Palette title="CUSTOMER WEBSITE" colors={customer} /><Palette title="CINEMA ADMIN" colors={admin} /></div>
    <div className="brand-editor-fields"><label>Public cinema name<input required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label>Logo URL<input value={draft.logoUrl} placeholder="https://… or /logo.svg" onChange={(event) => setDraft({ ...draft, logoUrl: event.target.value })} /></label></div>
    <h3>Customer website colors</h3><div className="brand-editor-fields">{([['Accent','accentColor'],['Muted accent','accentMutedColor'],['Background','backgroundColor'],['Background glow','backgroundGlowColor'],['Surface','surfaceColor'],['Text','textColor'],['Muted text','mutedTextColor']] as Array<[string, keyof BrandingDraft]>).map(([label, field]) => <ColorField key={field} label={label} field={field} draft={draft} setDraft={setDraft} />)}</div>
    <h3>Cinema admin colors</h3><div className="brand-editor-fields">{([['Accent','adminAccentColor'],['Muted accent','adminAccentMutedColor'],['Background','adminBackgroundColor'],['Surface','adminSurfaceColor'],['Text','adminTextColor'],['Muted text','adminMutedTextColor']] as Array<[string, keyof BrandingDraft]>).map(([label, field]) => <ColorField key={field} label={label} field={field} draft={draft} setDraft={setDraft} />)}</div>
    <button className="primary" disabled={saving}>{saving ? "Saving brand…" : "Save brand"}</button>
  </form>;
}

const siteCopySections = [
  ["showtimes", "Showtimes"],
  ["comingSoon", "Coming soon"],
  ["filmSeries", "Film series"],
  ["dining", "Dining"],
] as const;

export function CustomerSiteCopyEditor({ copy, onSave }: { copy: CustomerSiteCopy; onSave: (copy: CustomerSiteCopy) => Promise<void> }) {
  const [draft, setDraft] = useState(copy);
  const [aboutBody, setAboutBody] = useState(copy.about.body.join("\n\n"));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  useEffect(() => { setDraft(copy); setAboutBody(copy.about.body.join("\n\n")); }, [copy]);

  function updateHeading(section: keyof Omit<CustomerSiteCopy, "about">, field: keyof SiteHeadingCopy, value: string) {
    setDraft((current) => ({ ...current, [section]: { ...current[section], [field]: value } }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await onSave({
        ...draft,
        about: {
          ...draft.about,
          body: aboutBody.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean),
        },
      });
    } finally { savingRef.current = false; setSaving(false); }
  }

  return <form className="panel site-copy-editor" onSubmit={(event) => void submit(event)}>
    <div className="management-heading"><div><p className="kicker">CUSTOMER WEBSITE</p><h2>Page language</h2><p className="muted">Edit headings and introductions without changing code. Saving publishes these words immediately.</p></div><span className="managed-badge">PUBLISHES LIVE</span></div>
    <div className="site-copy-sections">
      {siteCopySections.map(([key, label]) => <section className="site-copy-section" key={key}>
        <h3>{label}</h3>
        <label>Eyebrow<input required maxLength={80} value={draft[key].eyebrow} onChange={(event) => updateHeading(key, "eyebrow", event.target.value)} /></label>
        <label>Page title<input required maxLength={120} value={draft[key].title} onChange={(event) => updateHeading(key, "title", event.target.value)} /></label>
        <label>Introduction<textarea required maxLength={300} value={draft[key].intro} onChange={(event) => updateHeading(key, "intro", event.target.value)} /></label>
      </section>)}
      <section className="site-copy-section site-copy-section-wide">
        <h3>About</h3>
        <label>Eyebrow<input required maxLength={80} value={draft.about.eyebrow} onChange={(event) => setDraft({ ...draft, about: { ...draft.about, eyebrow: event.target.value } })} /></label>
        <label>Page title<input required maxLength={120} value={draft.about.title} onChange={(event) => setDraft({ ...draft, about: { ...draft.about, title: event.target.value } })} /></label>
        <label>Introduction<textarea required maxLength={300} value={draft.about.intro} onChange={(event) => setDraft({ ...draft, about: { ...draft.about, intro: event.target.value } })} /></label>
        <label>About paragraphs<textarea required maxLength={8000} value={aboutBody} onChange={(event) => setAboutBody(event.target.value)} /><span className="muted">Separate paragraphs with a blank line.</span></label>
      </section>
    </div>
    <button className="primary" disabled={saving}>{saving ? "Publishing…" : "Publish website copy"}</button>
  </form>;
}
