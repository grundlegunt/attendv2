"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { PublicBrandingResponse } from "@cinema/shared";
import { apiFetch } from "../lib/api-client";

const fallback: PublicBrandingResponse = {
  locationName: "Cinema",
  branding: {
    eyebrow: "ATTEND", displayName: "Cinema", logoUrl: null,
    accentColor: "#d4af37", accentMutedColor: "#8a7326",
    backgroundColor: "#0b0b0d", elevatedColor: "#16161a",
    textPrimaryColor: "#f5f3ee", textSecondaryColor: "#a8a49c", adminTheme: "NEUTRAL",
  },
};

const BrandingContext = createContext(fallback);
export const useCustomerBranding = () => useContext(BrandingContext);

export function CustomerBrandingProvider({ children }: { children: React.ReactNode }) {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    void apiFetch<PublicBrandingResponse>("/cinema/branding").then((response) => {
      setValue(response);
      const root = document.documentElement;
      root.style.setProperty("--color-accent", response.branding.accentColor);
      root.style.setProperty("--color-accent-muted", response.branding.accentMutedColor);
      root.style.setProperty("--color-bg", response.branding.backgroundColor);
      root.style.setProperty("--color-bg-elevated", response.branding.elevatedColor);
      root.style.setProperty("--color-text-primary", response.branding.textPrimaryColor);
      root.style.setProperty("--color-text-secondary", response.branding.textSecondaryColor);
    }).catch(() => undefined);
  }, []);
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}
