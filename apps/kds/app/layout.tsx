import type { ReactNode } from "react";
import "@cinema/ui/theme.css";
import "./globals.css";

export const metadata = {
  title: "Kitchen / Bar Display — Ridgeline Dine-In Cinema",
  description: "Kitchen and bar order display.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="pos">
      <body>{children}</body>
    </html>
  );
}
