import type { NextConfig } from "next";
import withPWAInit, { runtimeCaching } from "@ducanh2912/next-pwa";

const backendOrigin = process.env.BACKEND_ORIGIN || "http://127.0.0.1:8000";
const lanHost = process.env.LAN_HOST || "192.168.110.211";

const privateDataNetworkOnly = {
  urlPattern: ({ url }: { url: URL }) => {
    const path = url.pathname;
    return (
      path.startsWith("/api/") ||
      path.startsWith("/media/") ||
      path.startsWith("/playback/") ||
      path.startsWith("/hls/") ||
      path.startsWith("/webrtc/") ||
      /\.(?:m3u8|ts|mp4|webm)$/i.test(path)
    );
  },
  handler: "NetworkOnly" as const,
  options: {
    cacheName: "brave-private-data-network-only-v2",
  },
};

const withPWA = withPWAInit({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    cleanupOutdatedCaches: true,
    disableDevLogs: true,
    runtimeCaching: [privateDataNetworkOnly, ...runtimeCaching],
  },
});

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost", lanHost],
  turbopack: {
    root: process.cwd(),
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendOrigin}/api/:path*`,
      },
      {
        source: "/media/:path*",
        destination: `${backendOrigin}/media/:path*`,
      },
      {
        source: "/ws/:path*",
        destination: `${backendOrigin}/ws/:path*`,
      },
    ];
  },
};

export default withPWA(nextConfig);
