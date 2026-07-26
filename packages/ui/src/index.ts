export type ThemeName = "cinematic" | "pos";

/** Which data-theme attribute value each app's root layout should set. */
export const APP_THEME: Record<string, ThemeName> = {
  "customer-web": "cinematic",
  "staff-pos": "pos",
  kds: "pos",
  admin: "pos",
};

export * from "./seat-map";
