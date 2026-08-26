import type { MetadataRoute } from "next";
import { customerSiteUrl } from "./lib/site-url";
const publicRoutes = [
  "",
  "/showtimes",
  "/coming-soon",
  "/film-series",
  "/dining-bar",
  "/afterglow",
  "/gift-cards",
  "/donate",
  "/membership",
  "/private-events",
  "/directions",
  "/about",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return publicRoutes.map((route) => ({
    url: `${customerSiteUrl}${route}`,
    changeFrequency: route === "/showtimes" || route === "/coming-soon" ? "daily" : "weekly",
    priority: route === "" ? 1 : route === "/showtimes" ? 0.9 : 0.7,
  }));
}
