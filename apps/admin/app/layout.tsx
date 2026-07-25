import type { ReactNode } from "react";
import "@cinema/ui/theme.css";
import "./globals.css";

export const metadata = {
  title: "Manager Dashboard — Ridgeline Dine-In Cinema",
  description: "Theater management, reporting, and audit tools.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="pos">
      <body>{children}</body>
    </html>
  );
}
