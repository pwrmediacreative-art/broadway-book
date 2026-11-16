import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The AI reader puts the chart format spec in its prompt (lib/ai/reader.ts).
  outputFileTracingIncludes: { "/admin/import": ["./docs/CHART_FORMAT.md"] },
  partialPrefetching: true,
  // /upload sends a MusicXML file (up to 2 MB) to a server action; the default cap is 1 MB.
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
  // The service worker must always be re-checked, or phones could stay on an old one.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
