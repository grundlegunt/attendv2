"use client";

import { useEffect } from "react";
import type { LocationBranding, PublicBrandingResponse } from "@cinema/shared";
import { useAdminSession } from "./admin-session";
import { apiFetch } from "./lib/api-client";

function applyAdminBranding(branding: LocationBranding) {
  const root = document.documentElement;
  if (branding.adminTheme !== "MATCH_CUSTOMER") {
    ["--color-accent", "--color-bg", "--color-bg-elevated", "--color-text-primary", "--color-text-secondary"].forEach((key) => root.style.removeProperty(key));
    return;
  }
  root.style.setProperty("--color-accent", branding.accentColor);
  root.style.setProperty("--color-bg", branding.backgroundColor);
  root.style.setProperty("--color-bg-elevated", branding.elevatedColor);
  root.style.setProperty("--color-text-primary", branding.textPrimaryColor);
  root.style.setProperty("--color-text-secondary", branding.textSecondaryColor);
}

export function AdminBrandingTheme() {
  const { employee } = useAdminSession();
  useEffect(() => {
    void apiFetch<PublicBrandingResponse>(`/cinema/branding?locationId=${encodeURIComponent(employee.locationId)}`).then((response) => applyAdminBranding(response.branding)).catch(() => undefined);
    const listener = (event: Event) => applyAdminBranding((event as CustomEvent<LocationBranding>).detail);
    window.addEventListener("attend-branding-updated", listener);
    return () => window.removeEventListener("attend-branding-updated", listener);
  }, [employee.locationId]);
  return null;
}
