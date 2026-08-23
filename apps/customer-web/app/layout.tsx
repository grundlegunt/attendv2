import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import "@cinema/ui/theme.css";
import "./globals.css";
import { SiteHeader } from "./components/site-header";
import { CustomerBrandingProvider } from "./components/customer-branding";
import { customerSiteUrl } from "./lib/site-url";
import { AnalyticsConsent } from "./components/analytics-consent";

export const metadata: Metadata = {
  metadataBase: new URL(customerSiteUrl),
  title: {
    default: "Cinema",
    template: "%s | Cinema",
  },
  description: "Browse showtimes, reserve tickets, and plan your dine-in cinema visit.",
  applicationName: "Cinema",
  openGraph: {
    type: "website",
    siteName: "Cinema",
    title: "Cinema",
    description: "Browse showtimes, reserve tickets, and plan your dine-in cinema visit.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Cinema",
    description: "Browse showtimes, reserve tickets, and plan your dine-in cinema visit.",
  },
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="cinematic" data-branding-status="loading">
      <body>
        <CustomerBrandingProvider>
          <Suspense fallback={null}>
            <SiteHeader />
          </Suspense>
          {children}
          <AnalyticsConsent />
        </CustomerBrandingProvider>
      </body>
    </html>
  );
}
