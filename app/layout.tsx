import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VodShelf",
  description: "Browse Twitch past broadcasts beyond standard limits, track your watch progress, and keep pinned creators in one feed.",
  keywords: ["Twitch VOD", "VOD library", "Stream Player", "Watch History"],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0e0e10",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://static-cdn.jtvnw.net" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://gql.twitch.tv" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
