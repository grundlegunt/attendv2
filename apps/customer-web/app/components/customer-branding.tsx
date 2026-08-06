"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { customerBrandingDefaults } from "@cinema/shared";
import { apiFetch } from "../lib/api-client";

type PublicBranding = {
  locationId: string;
  name: string;
  logoUrl: string | null;
  accentColor: string | null;
  accentMutedColor: string | null;
  backgroundColor: string | null;
  surfaceColor: string | null;
  textColor: string | null;
  mutedTextColor: string | null;
};

const BrandingContext = createContext<Pick<PublicBranding, "name" | "logoUrl">>({ name: "Cinema", logoUrl: null });
export const useCustomerBranding = () => useContext(BrandingContext);

export function CustomerBrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<PublicBranding | null>(null);
  useEffect(() => {
    const locationId = process.env.NEXT_PUBLIC_LOCATION_ID;
    const query = locationId ? `?locationId=${encodeURIComponent(locationId)}` : "";
    apiFetch<PublicBranding>(`/cinema/branding${query}`).then(setBranding).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!branding) return;
    const root = document.documentElement;
    const tokens = {
      "--color-accent": branding.accentColor ?? customerBrandingDefaults.accentColor,
      "--color-accent-muted": branding.accentMutedColor ?? customerBrandingDefaults.accentMutedColor,
      "--color-bg": branding.backgroundColor ?? customerBrandingDefaults.backgroundColor,
      "--color-bg-elevated": branding.surfaceColor ?? customerBrandingDefaults.surfaceColor,
      "--color-text-primary": branding.textColor ?? customerBrandingDefaults.textColor,
      "--color-text-secondary": branding.mutedTextColor ?? customerBrandingDefaults.mutedTextColor,
    };
    Object.entries(tokens).forEach(([property, value]) => root.style.setProperty(property, value));
  }, [branding]);
  const identity = useMemo(() => ({ name: branding?.name ?? "Cinema", logoUrl: branding?.logoUrl ?? null }), [branding]);
  return <BrandingContext.Provider value={identity}>{children}</BrandingContext.Provider>;
}
