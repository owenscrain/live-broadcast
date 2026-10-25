import { LiveCams } from "@/components/LiveCams";

/** The live cam, full screen. ?cam=midway picks a cam from lib/cams.ts; ?debug=1 shows diagnostics. */
export default function Home() {
  return (
    <main className="app-shell">
      <LiveCams />
    </main>
  );
}
