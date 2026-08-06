import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Attend Master",
  description: "Attend company operations across cinema clients.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
