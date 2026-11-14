"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useOffline } from "@/lib/offline/status";

export default function NeedsConnection() {
  const from = useSearchParams().get("from");
  const offline = useOffline();
  // Only ever link back to a page on this site.
  const back = from && from.startsWith("/") && !from.startsWith("//") ? from : null;
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-8 text-center">
      <h1 className="mb-2 text-bb-display">You&apos;re offline</h1>
      <p className="mb-6 text-xl text-bb-cue-gray">This page needs a connection. Your saved charts and setlists still work.</p>
      <Link href="/" className="bb-btn bb-btn-primary h-14 px-6 text-xl">
        Back to search
      </Link>
      {back && !offline && (
        <p className="mt-6 text-lg">
          You&apos;re back online.{" "}
          <a href={back} className="text-bb-chart-white underline">
            Open the page
          </a>
        </p>
      )}
    </main>
  );
}
