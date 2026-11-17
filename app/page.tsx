import { preload } from "react-dom";
import { INDEX_URL } from "@/lib/search/pack";
import { HomeFooter, InstallCard } from "./Install";
import SongSearch from "./SongSearch";

export default function Home() {
  // Start downloading the song index with the page, before the search code runs.
  preload(INDEX_URL, { as: "fetch", crossOrigin: "anonymous" });
  return (
    // Desktop (lg): search, tabs and filters in a left column, results beside them. Wrappers
    // are `contents` below lg, so the phone layout is unchanged.
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-4 lg:grid lg:max-w-7xl lg:grid-cols-[22rem_minmax(0,1fr)] lg:grid-rows-[auto_auto_1fr_auto] lg:items-start lg:gap-x-10 lg:px-8">
      <header className="mb-2 lg:col-start-1 lg:row-start-1">
        <h1 className="text-bb-display">Broadway Book</h1>
        <p className="text-bb-cue-gray">Nashville number charts. Free, no login to view.</p>
      </header>
      <div className="contents lg:col-start-1 lg:row-start-2 lg:block">
        <InstallCard />
      </div>
      <SongSearch />
      <div className="contents lg:col-start-2 lg:row-start-4 lg:block">
        <HomeFooter />
      </div>
    </main>
  );
}
