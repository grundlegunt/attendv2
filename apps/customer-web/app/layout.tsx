import type { ReactNode } from "react";
import "@cinema/ui/theme.css";
import "./globals.css";
import { SiteHeader } from "./components/site-header";
import { CustomerBrandingProvider } from "./components/customer-branding";

export const metadata = {
  title: "Cinema",
  description: "Reserved seating, tickets, and dine-in service.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="cinematic">
      <body>
        <CustomerBrandingProvider><SiteHeader />{children}</CustomerBrandingProvider>
      </body>
    </html>
  );
}
