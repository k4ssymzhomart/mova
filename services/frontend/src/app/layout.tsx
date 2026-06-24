import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, Instrument_Serif } from "next/font/google";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["300", "400", "500", "600", "700"],
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-serif",
});

export const metadata: Metadata = {
  title: "Mova — Motion intelligence for rehabilitation",
  description:
    "Camera-free, 50 Hz IMU gait and freezing-of-gait tracking that generalizes across patients and devices.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${instrumentSerif.variable} h-full`}>
      <body className="bg-gray-50 text-gray-900 antialiased min-h-full">
        {children}
      </body>
    </html>
  );
}
