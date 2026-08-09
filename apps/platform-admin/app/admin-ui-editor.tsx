"use client";

import { adminUiDefaults, type AdminUiConfig } from "@cinema/shared";

type SavedPalette = AdminUiConfig["colorHistory"][number];

export function AdminUiEditor({ value, onChange, onRestore }: { value: AdminUiConfig; onChange: (value: AdminUiConfig) => void; onRestore: (palette: SavedPalette) => void }) {
  const colors = [["onSaleColor", "On sale"], ["draftColor", "Draft"], ["pastColor", "Past"], ["removeControlColor", "Remove (×)"], ["duplicateControlColor", "Duplicate (+)"]] as const;
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
    <div className="live-brand-preview admin-live-preview"><strong style={{ color: value.onSaleColor }}>{value.labels.onSale}</strong><strong style={{ color: value.draftColor }}>{value.labels.draft}</strong><strong style={{ color: value.pastColor }}>{value.labels.past}</strong><strong style={{ color: value.removeControlColor }}>× Remove</strong><strong style={{ color: value.duplicateControlColor }}>+ Duplicate</strong><small>{value.labels.scheduleTitle}</small></div>
    <div className="palette-history"><h4>Past color palettes</h4><p className="muted">Master keeps the last 20 published combinations. Restore one, adjust it, then save when ready.</p>{value.colorHistory.length ? <div className="palette-history-list">{value.colorHistory.map((palette) => <button type="button" key={palette.savedAt} className="palette-history-item" onClick={() => onRestore(palette)} title="Restore this palette"><span>{[palette.accentColor, palette.accentMutedColor, palette.backgroundColor, palette.surfaceColor, palette.textColor, palette.mutedTextColor, palette.onSaleColor, palette.draftColor, palette.pastColor, palette.removeControlColor, palette.duplicateControlColor].map((color, index) => <i key={`${color}-${index}`} style={{ background: color }} />)}</span><small>{new Date(palette.savedAt).toLocaleString()}</small></button>)}</div> : <p className="muted">Previous palettes will appear here after the next color change is published.</p>}</div>
    <div className="form-grid">{(Object.keys(labels) as Array<keyof AdminUiConfig["labels"]>).map((key) => <label key={key}>{labels[key]}<input required maxLength={key === "scheduleInstructions" || key === "filmLibraryHelp" ? 240 : 120} value={value.labels[key]} onChange={(event) => updateLabel(key, event.target.value)} /></label>)}</div>
  </section>;
}
