"use client";

import { useEffect, useState } from "react";
import { defaultPlatformBrand, type PlatformBrandSettings } from "../platform-brand";

export function PlatformBrandEditor({ accessToken, canEdit, request }: { accessToken: string; canEdit: boolean; request: <T>(path: string, init?: RequestInit, accessToken?: string) => Promise<T> }) {
  const [brand, setBrand] = useState<PlatformBrandSettings>(defaultPlatformBrand);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { request<PlatformBrandSettings>("/platform/branding/public").then(setBrand).catch(() => setMessage("Could not load company identity.")); }, [request]);
  const setMasterTheme = (key: keyof PlatformBrandSettings["masterTheme"], value: string) => setBrand((current) => ({ ...current, masterTheme: { ...current.masterTheme, [key]: value } }));
  const setMasterCopy = (key: keyof PlatformBrandSettings["masterSignIn"], value: string) => setBrand((current) => ({ ...current, masterSignIn: { ...current.masterSignIn, [key]: value } }));
  const setAdmin = (key: keyof PlatformBrandSettings["adminSignIn"], value: string) => setBrand((current) => ({ ...current, adminSignIn: { ...current.adminSignIn, [key]: value } }));
  async function save() {
    setMessage(null);
    try {
      const saved = await request<PlatformBrandSettings>("/platform/branding", { method: "PATCH", body: JSON.stringify(brand) }, accessToken);
      setBrand(saved); setMessage("Company identity saved. Refresh open sign-in tabs to preview it.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Could not save company identity."); }
  }
  return <section className="platform-brand-editor">
    <div className="panel-heading"><div><p className="eyebrow">COMPANY IDENTITY</p><h2>Master-controlled product brand</h2><p className="muted">Change Ringo’s name, Master theme, and the copy and colors shown before Master or cinema staff sign in.</p></div><span className="status good">Live configuration</span></div>
    <div className="platform-brand-fields">
      <label>Company name<input value={brand.companyName} disabled={!canEdit} onChange={(event) => setBrand({ ...brand, companyName: event.target.value })} /></label>
      <fieldset><legend>Master colors</legend>{Object.entries(brand.masterTheme).map(([key, value]) => <label key={key}>{key.replace(/Color$/, " color")}<span className="brand-color-control"><input type="color" value={value} disabled={!canEdit} onChange={(event) => setMasterTheme(key as keyof PlatformBrandSettings["masterTheme"], event.target.value)} /><input value={value} disabled={!canEdit} onChange={(event) => setMasterTheme(key as keyof PlatformBrandSettings["masterTheme"], event.target.value)} /></span></label>)}</fieldset>
      <fieldset><legend>Master sign-in copy</legend>{Object.entries(brand.masterSignIn).map(([key, value]) => <label key={key}>{key}<textarea rows={key === "description" ? 3 : 2} value={value} disabled={!canEdit} onChange={(event) => setMasterCopy(key as keyof PlatformBrandSettings["masterSignIn"], event.target.value)} /></label>)}</fieldset>
      <fieldset><legend>Admin sign-in colors</legend>{(["accentColor", "backgroundColor", "surfaceColor", "textColor", "mutedTextColor"] as const).map((key) => <label key={key}>{key.replace(/Color$/, " color")}<span className="brand-color-control"><input type="color" value={brand.adminSignIn[key]} disabled={!canEdit} onChange={(event) => setAdmin(key, event.target.value)} /><input value={brand.adminSignIn[key]} disabled={!canEdit} onChange={(event) => setAdmin(key, event.target.value)} /></span></label>)}</fieldset>
      <fieldset><legend>Admin sign-in copy</legend>{(["eyebrow", "title", "description", "formEyebrow", "formTitle", "formDescription", "securityNote"] as const).map((key) => <label key={key}>{key}<textarea rows={key === "description" || key === "formDescription" ? 3 : 2} value={brand.adminSignIn[key]} disabled={!canEdit} onChange={(event) => setAdmin(key, event.target.value)} /></label>)}</fieldset>
    </div>
    {message && <p className="brand-save-message" role="status">{message}</p>}
    {canEdit && <button onClick={() => void save()}>Save and publish company identity</button>}
  </section>;
}
