import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root so Next ignores the stray lockfile in the home dir.
  turbopack: {
    root: __dirname,
  },
  // Native image libs must stay external (Turbopack cannot place their bindings).
  serverExternalPackages: ["sharp", "@napi-rs/canvas"],
};

export default nextConfig;
