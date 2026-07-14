import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Coastline",
    short_name: "Coastline",
    description: "San Diego → Vancouver → San Diego. Our coast, our plan.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0f13",
    theme_color: "#0e9488",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
