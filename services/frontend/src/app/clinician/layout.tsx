import { Inter } from "next/font/google";
import type { ReactNode } from "react";

import RequireAuth from "@/components/auth/RequireAuth";
import ClinicHeader from "@/components/clinician/ClinicHeader";

// The same face the patient app loads in (app)/layout.tsx. Electrolize has no Cyrillic, so without this wrapper
// every Russian word in the clinician portal fell back to whatever the operating system offered — which is why the
// two halves of the product did not look like one product.
const inter = Inter({
  subsets: ["latin", "latin-ext", "cyrillic", "cyrillic-ext"],
  display: "swap",
  variable: "--font-inter-face",
});

export default function ClinicianLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <div className={`${inter.variable} app-type min-h-screen bg-paper text-ink`}>
        <ClinicHeader />
        {children}
      </div>
    </RequireAuth>
  );
}
