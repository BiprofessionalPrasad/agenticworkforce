import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  turbopack: {
    resolveAlias: {
      // Conditional alias: only for browser/client builds to prevent node builtins (e.g. child_process from nodemailer etc).
      // Server (node) builds use the real modules via dynamic import + guards.
      child_process: { browser: './lib/shims/empty.ts' },
      fs: { browser: './lib/shims/empty.ts' },
      net: { browser: './lib/shims/empty.ts' },
      tls: { browser: './lib/shims/empty.ts' },
      dns: { browser: './lib/shims/empty.ts' },
    },
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        child_process: false,
        fs: false,
        net: false,
        tls: false,
        dns: false,
        http: false,
        https: false,
        stream: false,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;
