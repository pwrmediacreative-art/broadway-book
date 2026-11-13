import { SnapshotView } from "../DeviceSetlist";

export const metadata = { title: "Shared setlist · Broadway Book", robots: { index: false } };

/** Snapshot link: the setlist rides in the URL hash (never sent to the server). */
export default function SnapshotPage() {
  return <SnapshotView />;
}
