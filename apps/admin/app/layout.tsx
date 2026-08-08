import type { ReactNode } from "react";
import "@cinema/ui/theme.css";
import "./globals.css";
import { AdminNav } from "./admin-nav";
import { AdminSessionProvider } from "./admin-session";

export const metadata = {
  title: "Manager Dashboard — Ridgeline Dine-In Cinema",
  description: "Theater management, reporting, and audit tools.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="pos">
      <body><AdminSessionProvider><div className="admin-app-layout"><AdminNav /><div className="admin-content">{children}</div></div></AdminSessionProvider></body>
    </html>
  );
}
