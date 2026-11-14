import { Suspense } from "react";
import SavedSongPage from "./SavedSongPage";

export const metadata = { title: "Broadway Book", robots: { index: false } };

/** Song and stage pages drawn from the phone's saved charts (reached when offline). */
export default function OfflineSongPage() {
  return (
    <Suspense fallback={null}>
      <SavedSongPage />
    </Suspense>
  );
}
