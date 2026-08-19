import type { MetadataRoute } from "next";
import { customerSiteUrl } from "./lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/account", "/signage"],
    },
    sitemap: `${customerSiteUrl}/sitemap.xml`,
  };
}
