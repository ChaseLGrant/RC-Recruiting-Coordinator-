import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RC — Recruiting Coordinator",
    short_name: "RC",
    description: "Your recruiting staff in your pocket: find players, track stats and schedules, log contacts.",
    start_url: "/",
    display: "standalone",
    background_color: "#0f1722",
    theme_color: "#0f1722",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
