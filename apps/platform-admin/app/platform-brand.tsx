"use client";

import { createContext, useContext, useEffect, useState, type CSSProperties, type ReactNode } from "react";

export interface PlatformBrandSettings {
  companyName: string;
  masterTheme: { accentColor: string; backgroundColor: string; surfaceColor: string; textColor: string; mutedTextColor: string };
  masterSignIn: { eyebrow: string; title: string; description: string; formTitle: string; formDescription: string };
  adminSignIn: { accentColor: string; backgroundColor: string; surfaceColor: string; textColor: string; mutedTextColor: string; eyebrow: string; title: string; description: string; formEyebrow: string; formTitle: string; formDescription: string; securityNote: string };
  analytics: { enabled: boolean; provider: "PLAUSIBLE" };
}

export const defaultPlatformBrand: PlatformBrandSettings = {
  companyName: "Ringo",
  masterTheme: { accentColor: "#7c9cff", backgroundColor: "#0a0b0d", surfaceColor: "#13151a", textColor: "#f5f2ea", mutedTextColor: "#989faa" },
  masterSignIn: { eyebrow: "PLATFORM OPERATIONS", title: "Run every cinema from one place.", description: "Oversee clients, revenue, onboarding, payments, and access before entering a cinema workspace.", formTitle: "Company sign in", formDescription: "Use your Ringo company credentials." },
  adminSignIn: { accentColor: "#ffbf00", backgroundColor: "#080808", surfaceColor: "#1a1a1a", textColor: "#f7f4ed", mutedTextColor: "#aaa7a0", eyebrow: "RINGO ADMIN", title: "Cinema operations", description: "Programming, ticketing, restaurant, staff, and reporting tools in one secure workspace.", formEyebrow: "MANAGER ACCESS", formTitle: "Sign in", formDescription: "Use the staff credentials issued by your manager.", securityNote: "Authorized staff only · Sessions expire automatically" },
  analytics: { enabled: false, provider: "PLAUSIBLE" },
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://zealous-connection-production-0896.up.railway.app/api/v1" : "http://localhost:4000/api/v1");
const PlatformBrandContext = createContext(defaultPlatformBrand);

export function PlatformBrandProvider({ children }: { children: ReactNode }) {
  const [brand, setBrand] = useState(defaultPlatformBrand);
  useEffect(() => {
    fetch(`${API_BASE_URL}/platform/branding/public`)
      .then((response) => response.ok ? response.json() as Promise<PlatformBrandSettings> : Promise.reject())
      .then(setBrand)
      .catch(() => undefined);
  }, []);
  const style = { "--bg": brand.masterTheme.backgroundColor, "--surface": brand.masterTheme.surfaceColor, "--surface-2": brand.masterTheme.surfaceColor, "--text": brand.masterTheme.textColor, "--muted": brand.masterTheme.mutedTextColor, "--accent": brand.masterTheme.accentColor, "--platform-master-label": `"${brand.companyName.toUpperCase()} MASTER"` } as CSSProperties;
  return <PlatformBrandContext.Provider value={brand}><div className="platform-brand-root" style={style}>{children}</div></PlatformBrandContext.Provider>;
}

export function usePlatformBrand() { return useContext(PlatformBrandContext); }
