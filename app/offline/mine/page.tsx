import { Suspense } from "react";
import SavedMinePage from "./SavedMinePage";

export const metadata = { title: "Broadway Book", robots: { index: false } };

/** Your own private charts drawn from this phone's copy (reached when offline). */
export default function OfflineMinePage() {
  return (
    <Suspense fallback={null}>
      <SavedMinePage />
    </Suspense>
  );
}
