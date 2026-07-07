import type { NextConfig } from "next";
import withPWAInit, { runtimeCaching } from "@ducanh2912/next-pwa";

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
  turbopack: {},
};

export default withPWA(nextConfig);