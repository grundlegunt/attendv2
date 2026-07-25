import type { ReactNode } from "react";
import "@cinema/ui/theme.css";
import "./globals.css";

export const metadata = {
  title: "Ridgeline Dine-In Cinema",
  description: "Reserved seating, tickets, and dine-in service.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="cinematic">
      <body>{children}</body>
    </html>
  );
}
