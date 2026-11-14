import { preload } from "react-dom";
import { INDEX_URL } from "@/lib/search/pack";
import { HomeFooter, InstallCard } from "./Install";
import SongSearch from "./SongSearch";

export default function Home() {
  // Start downloading the song index with the page, before the search code runs.
  preload(INDEX_URL, { as: "fetch", crossOrigin: "anonymous" });
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-4">
      <header className="mb-2">
        <h1 className="text-bb-display">Broadway Book</h1>
        <p className="text-bb-cue-gray">Nashville number charts. Free, no login to view.</p>
      </header>
      <InstallCard />
      <SongSearch />
      <HomeFooter />
    </main>
  );
}
