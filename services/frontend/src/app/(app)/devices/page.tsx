import type { Metadata } from "next";

import DevicesClient from "./DevicesClient";

export const metadata: Metadata = { title: "Devices · Mova" };

export default function DevicesPage() {
  return <DevicesClient />;
}
