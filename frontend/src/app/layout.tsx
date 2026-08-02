import type { Metadata, Viewport } from "next";
import { LocalWebcamSessionHost } from "@/components/camera/local-webcam-session-host";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "BRAVE AI - Anti-Bullying CCTV Monitoring",
    template: "%s | BRAVE AI",
  },
  description:
    "Dashboard monitoring CCTV berbasis AI untuk deteksi dan pencegahan bullying di lingkungan sekolah.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "BRAVE AI",
  },
  icons: {
    icon: "/icons/icon-192x192.png",
    apple: "/icons/icon-192x192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#060a13",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning className="h-full antialiased">
      <body className="font-sans min-h-full flex flex-col bg-[#060a13]" suppressHydrationWarning>
        {children}
        <LocalWebcamSessionHost />
      </body>
    </html>
  );
}
