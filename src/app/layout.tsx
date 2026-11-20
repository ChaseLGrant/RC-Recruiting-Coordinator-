import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "RC — Recruiting Coordinator",
  description: "Your standards. Your evaluations. Your recruiting decisions. RC does the legwork.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b1730" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={GeistSans.variable}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
