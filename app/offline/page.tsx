import { Suspense } from "react";
import NeedsConnection from "./NeedsConnection";

export const metadata = { title: "Offline · Broadway Book", robots: { index: false } };

/** Shown (by the service worker) for pages that only exist on the server. */
export default function OfflinePage() {
  return (
    <Suspense fallback={null}>
      <NeedsConnection />
    </Suspense>
  );
}
