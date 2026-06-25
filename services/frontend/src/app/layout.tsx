import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Electrolize } from "next/font/google";

import { AuthProvider } from "@/lib/auth/AuthProvider";

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
  title: "Mova — Motion intelligence for movement rehabilitation",
  description:
    "The first camera-free platform turning everyday wearable motion into clinical-grade gait and freezing-of-gait insight that generalises across patients and devices.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={electrolize.variable}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
