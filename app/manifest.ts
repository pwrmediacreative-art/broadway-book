import type { MetadataRoute } from "next";
import { HEX } from "@/lib/design/tokens";

/** Makes the site installable ("Add to Home Screen"). Icons come from scripts/gen-icons.mjs. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Broadway Book",
    short_name: "Bway Book",
    description: "Free Nashville number charts for musicians playing Lower Broadway.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: HEX.houseBlack,
    theme_color: HEX.houseBlack,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
