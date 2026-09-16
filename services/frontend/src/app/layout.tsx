import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Electrolize } from "next/font/google";

import { AuthProvider } from "@/lib/auth/AuthProvider";
import { LocaleProvider } from "@/locales/client";
import { getLocale } from "@/locales/server";

import "./globals.css";

// Electrolize — the single typeface across the whole product (display, body, mono). Self-hosted via
// next/font so there's no layout shift and no external <link>. It ships one weight (400); we disable
// font-synthesis in globals so faux bold/italic never render.
const electrolize = Electrolize({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--font-electrolize",
});

export const metadata: Metadata = {
  title: "Mova — rehabilitation after knee replacement",
  description:
    "Rehabilitation after total knee replacement, with exercises followed by three wearable motion sensors on the thigh, shin and foot.",
  // Served from services/frontend/public/icon.png so Chrome and other browsers show the Mova mark
  // in the tab/bookmark instead of the default globe.
  icons: {
    icon: "/icon.png",
    shortcut: "/icon.png",
    apple: "/icon.png",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const locale = getLocale();
  return (
    <html lang={locale} className={electrolize.variable}>
      <body>
        <LocaleProvider initialLocale={locale}>
          <AuthProvider>{children}</AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
