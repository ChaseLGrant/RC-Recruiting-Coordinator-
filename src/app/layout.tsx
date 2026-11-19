import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RC — Recruiting Coordinator",
  description: "Your standards. Your evaluations. Your recruiting decisions. RC does the legwork.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
