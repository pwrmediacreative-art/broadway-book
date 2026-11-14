import { Suspense } from "react";
import SavedSetlistPage from "./SavedSetlistPage";

export const metadata = { title: "Setlist · Broadway Book", robots: { index: false } };

/** Account and shared setlists drawn from the phone's saved copy (reached when offline). */
export default function OfflineSetlistPage() {
  return (
    <Suspense fallback={null}>
      <SavedSetlistPage />
    </Suspense>
  );
}
