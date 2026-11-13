import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The AI reader puts the chart format spec in its prompt (lib/ai/reader.ts).
  outputFileTracingIncludes: { "/admin/import": ["./docs/CHART_FORMAT.md"] },
  partialPrefetching: true,
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
