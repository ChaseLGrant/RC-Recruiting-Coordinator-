import type { Metadata, Viewport } from "next";
import "@fontsource-variable/libre-franklin";
import "@fontsource/big-shoulders-display/700";
import "@fontsource/big-shoulders-display/800";
import "./globals.css";

export const metadata: Metadata = {
  title: "RC — Recruiting Coordinator",
  description: "Your standards. Your evaluations. Your recruiting decisions. RC does the legwork.",
  appleWebApp: { capable: true, title: "RC", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0f1722", viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
