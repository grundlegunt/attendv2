"use client";

import { adminUiDefaults, type AdminUiConfig } from "@cinema/shared";

export function AdminUiEditor({ value, onChange }: { value: AdminUiConfig; onChange: (value: AdminUiConfig) => void }) {
  const colors = [["onSaleColor", "On sale"], ["draftColor", "Draft"], ["pastColor", "Past"]] as const;
  const labels: Record<keyof AdminUiConfig["labels"], string> = {
    scheduleTitle: "Schedule title", scheduleInstructions: "Schedule instructions", day: "Day view", week: "Week view",
    export: "Export button", duplicateDay: "Duplicate day button", today: "Today button", onSale: "On sale label",
    draft: "Draft label", past: "Past label", room: "Room heading", filmLibrary: "Film library title",
    filmLibraryHelp: "Film library help", addMovie: "Add movie button", search: "Search placeholder",
  };
  const updateLabel = (key: keyof AdminUiConfig["labels"], text: string) => onChange({ ...value, labels: { ...value.labels, [key]: text } });
  return <section className="admin-ui-editor">
    <div className="editor-heading"><div><h4>Schedule appearance & wording</h4><p className="muted">Controls the Admin font, status colors, and visible schedule copy.</p></div><button type="button" className="quiet" onClick={() => onChange(adminUiDefaults)}>Restore defaults</button></div>
    <div className="form-grid"><label>Admin font<select value={value.fontFamily} onChange={(event) => onChange({ ...value, fontFamily: event.target.value as AdminUiConfig["fontFamily"] })}><option value="SYSTEM">System sans</option><option value="SERIF">Classic serif</option><option value="MODERN">Modern sans</option><option value="MONO">Monospace</option></select></label>{colors.map(([key, label]) => <label key={key}>{label} color<div className="color-input"><input type="color" value={value[key]} onChange={(event) => onChange({ ...value, [key]: event.target.value })} /><input value={value[key]} onChange={(event) => onChange({ ...value, [key]: event.target.value })} /></div></label>)}</div>
    <div className="live-brand-preview admin-live-preview"><strong style={{ color: value.onSaleColor }}>{value.labels.onSale}</strong><strong style={{ color: value.draftColor }}>{value.labels.draft}</strong><strong style={{ color: value.pastColor }}>{value.labels.past}</strong><small>{value.labels.scheduleTitle}</small></div>
    <div className="form-grid">{(Object.keys(labels) as Array<keyof AdminUiConfig["labels"]>).map((key) => <label key={key}>{labels[key]}<input required maxLength={key === "scheduleInstructions" || key === "filmLibraryHelp" ? 240 : 120} value={value.labels[key]} onChange={(event) => updateLabel(key, event.target.value)} /></label>)}</div>
  </section>;
}
