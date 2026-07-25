import type { ReactNode } from "react";
import "@cinema/ui/theme.css";
import "./globals.css";

export const metadata = {
  title: "Staff POS — Ridgeline Dine-In Cinema",
  description: "Box office and server ordering.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="pos">
      <body>{children}</body>
    </html>
  );
}
