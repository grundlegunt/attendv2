import type { ReactNode } from "react";
import "./globals.css";
import { PlatformBrandProvider } from "./platform-brand";

export const metadata = {
  title: "Ringo Master",
  description: "Ringo company operations across cinema clients.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><PlatformBrandProvider>{children}</PlatformBrandProvider></body></html>;
}
