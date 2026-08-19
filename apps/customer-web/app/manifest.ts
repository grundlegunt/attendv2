import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cinema",
    short_name: "Cinema",
    description: "Showtimes, tickets, and dine-in cinema service.",
    start_url: "/showtimes",
    display: "standalone",
    background_color: "#080608",
    theme_color: "#35b972",
  };
}
