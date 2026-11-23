import type { Metadata, Viewport } from "next";
import type { CSSProperties, ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "./os.css";
import ElyraThemeProvider from "@/components/ui/elyra/ElyraThemeProvider";
import UrlTokenSanitizer from "@/components/security/UrlTokenSanitizer";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Elyra Core",
  description: "Elyra Core Workspace",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1f4f88",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const fontVars = {
    ["--ec-font-heading" as string]: "var(--font-inter), Inter, system-ui, sans-serif",
    ["--ec-font-body" as string]: "var(--font-inter), Inter, system-ui, sans-serif",
    ["--ec-font-mono" as string]: "var(--font-jetbrains-mono), 'JetBrains Mono', monospace",
  } as CSSProperties;

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${jetbrainsMono.variable} antialiased`} style={fontVars}>
        <UrlTokenSanitizer />
        <ElyraThemeProvider>{children}</ElyraThemeProvider>
      </body>
    </html>
  );
}
