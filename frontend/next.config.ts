import type { NextConfig } from "next";
import withPWAInit, { runtimeCaching } from "@ducanh2912/next-pwa";

const backendOrigin = process.env.BACKEND_ORIGIN || "http://127.0.0.1:8000";
const lanHost = process.env.LAN_HOST || "192.168.110.211";

const recordingNetworkOnly = {
  urlPattern: ({ url }: { url: URL }) => {
    const path = url.pathname;
    return (
      path.startsWith("/api/recordings") ||
      path.startsWith("/api/cameras") ||
      path.startsWith("/media/") ||
      /\.(?:m3u8|ts|mp4|webm)$/i.test(path)
    );
  },
  handler: "NetworkOnly" as const,
  options: {
    cacheName: "recording-playback-network-only",
  },
};

const withPWA = withPWAInit({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    disableDevLogs: true,
    runtimeCaching: [recordingNetworkOnly, ...runtimeCaching],
  },
});

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost", lanHost],
  turbopack: {},
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