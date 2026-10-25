import type { Metadata } from "next";
import { Controller } from "./Controller";

export const metadata: Metadata = { title: "Chicago Live controller", robots: { index: false } };

/** Pick which live cams the screen shows. Open to anyone with the link (no passcode). */
export default function ControllerPage() {
  return <Controller />;
}
