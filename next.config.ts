import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// When a parent folder (e.g. home) has its own lockfile, Turbopack can pick the wrong root and
// mis-resolve conventions (including showing middleware deprecation from the wrong tree).
// Pin root to this app directory. See: https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack#root-directory
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ["@supabase/supabase-js"],
  },
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
