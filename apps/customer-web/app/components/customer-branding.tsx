"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { cinemaContentDefaults, customerBrandingDefaults, type CinemaContent } from "@cinema/shared";
import { apiFetch } from "../lib/api-client";

type PublicBranding = {
  locationId: string;
  name: string;
  logoUrl: string | null;
  accentColor: string | null;
  accentMutedColor: string | null;
  backgroundColor: string | null;
  backgroundGlowColor: string | null;
  surfaceColor: string | null;
  textColor: string | null;
  mutedTextColor: string | null;
};

const BrandingContext = createContext<Pick<PublicBranding, "name" | "logoUrl">>({ name: "Cinema", logoUrl: null });
export const useCustomerBranding = () => useContext(BrandingContext);
const ContentContext = createContext<CinemaContent>(cinemaContentDefaults);
export const useCinemaContent = () => useContext(ContentContext);

export function CustomerBrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<PublicBranding | null>(null);
  const [content, setContent] = useState<CinemaContent>(cinemaContentDefaults);
  useEffect(() => {
    apiFetch<PublicBranding>("/cinema/branding").then(setBranding).catch(() => undefined);
    apiFetch<{ content: CinemaContent }>("/cinema/content").then((response) => setContent(response.content)).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!branding) return;
    const root = document.documentElement;
    const tokens = {
      "--color-accent": branding.accentColor ?? customerBrandingDefaults.accentColor,
      "--color-accent-muted": branding.accentMutedColor ?? customerBrandingDefaults.accentMutedColor,
      "--color-bg": branding.backgroundColor ?? customerBrandingDefaults.backgroundColor,
      "--color-bg-glow": branding.backgroundGlowColor ?? customerBrandingDefaults.backgroundGlowColor,
      "--color-bg-elevated": branding.surfaceColor ?? customerBrandingDefaults.surfaceColor,
      "--color-text-primary": branding.textColor ?? customerBrandingDefaults.textColor,
      "--color-text-secondary": branding.mutedTextColor ?? customerBrandingDefaults.mutedTextColor,
    };
    Object.entries(tokens).forEach(([property, value]) => root.style.setProperty(property, value));
    const headingFonts = { EDITORIAL: 'Georgia, "Times New Roman", serif', CLASSIC: 'Baskerville, Georgia, serif', MODERN: 'Arial Black, Arial, sans-serif' };
    const bodyFonts = { SANS: 'Inter, Arial, sans-serif', HUMANIST: 'Optima, Candara, sans-serif', SERIF: 'Georgia, "Times New Roman", serif' };
    const headingSizes = {
      COMPACT: "clamp(2.5rem, 6vw, 5rem)",
      STANDARD: "clamp(3rem, 8vw, 6.5rem)",
      LARGE: "clamp(3.5rem, 9vw, 7.5rem)",
    };
    const bodySizes = { COMPACT: "0.9rem", STANDARD: "1rem", LARGE: "1.1rem" };
    root.style.setProperty("--font-family-display", headingFonts[content.typography.headingFont]);
    root.style.setProperty("--font-family-body", bodyFonts[content.typography.bodyFont]);
    root.style.setProperty("--font-size-page-title", headingSizes[content.typography.headingSize]);
    root.style.setProperty("--font-size-body", bodySizes[content.typography.bodySize]);
  }, [branding, content]);
  const identity = useMemo(() => ({ name: branding?.name ?? "Cinema", logoUrl: branding?.logoUrl ?? null }), [branding]);
  return <BrandingContext.Provider value={identity}><ContentContext.Provider value={content}>{children}</ContentContext.Provider></BrandingContext.Provider>;
}
