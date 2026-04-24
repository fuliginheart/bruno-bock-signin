import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow each kiosk instance to use its own build cache directory so
  // multiple dev servers on the same machine don't corrupt each other's
  // webpack chunk files.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  serverExternalPackages: ["better-sqlite3"],
  // Kiosks are LAN-only; allow image origins from peers if ever needed.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
