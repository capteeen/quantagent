import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { tokensCss } from "@quantagent/ui/tokens";
import { Providers } from "./providers";
import "@quantagent/ui/fonts.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "quantagent",
  description: "Connect your project's X account. Connect your wallet. Type one line. Tap. Eight workers launch a coin on pump.fun in parallel.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#06080A",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <style dangerouslySetInnerHTML={{ __html: tokensCss }} />
      </head>
      <body className="min-h-screen bg-void font-mono text-text antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
