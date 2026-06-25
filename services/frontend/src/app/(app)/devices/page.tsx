import type { Metadata } from "next";
import { Bluetooth } from "lucide-react";

import ComingSoon from "@/components/layout/ComingSoon";

export const metadata: Metadata = { title: "Devices · Mova" };

export default function DevicesPage() {
  return (
    <ComingSoon
      icon={Bluetooth}
      title="Devices"
      description="Pair an IMU over Web Bluetooth, check sensor battery and placement, select and calibrate your camera, and see the on-device privacy indicator."
    />
  );
}
