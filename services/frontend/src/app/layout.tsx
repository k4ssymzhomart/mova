import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Mova — Motion intelligence for rehabilitation",
  description:
    "Camera-free, 50 Hz IMU gait and freezing-of-gait tracking that generalizes across patients and devices.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
