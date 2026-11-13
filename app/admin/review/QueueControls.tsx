"use client";

import { useRouter } from "next/navigation";
import { FILTERS, ORDERS, PREFS_COOKIE, prefsCookie, prefsQuery, type Filter, type Order, type Prefs } from "@/lib/review/queue";

const sel = "min-h-11 rounded-lg border border-line bg-background px-2 text-lg";

/** Filter + order pickers. Remembered on this device (cookie) and kept in the URL. */
export default function QueueControls({ prefs, to }: { prefs: Prefs; to: "next" | "queue" }) {
  const router = useRouter();
  const go = (p: Prefs) => {
    document.cookie = `${PREFS_COOKIE}=${prefsCookie(p)}; path=/admin/review; max-age=31536000; samesite=lax`;
    router.push(`${to === "queue" ? "/admin/review/queue" : "/admin/review"}?${prefsQuery(p)}`);
  };
  return (
    <div className="flex flex-wrap gap-2">
      <label className="sr-only" htmlFor="rv-filter">Show</label>
      <select id="rv-filter" className={sel} value={prefs.filter} onChange={(e) => go({ ...prefs, filter: e.target.value as Filter })}>
        {Object.entries(FILTERS).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
      <label className="sr-only" htmlFor="rv-order">Order</label>
      <select id="rv-order" className={sel} value={prefs.order} onChange={(e) => go({ ...prefs, order: e.target.value as Order })}>
        {Object.entries(ORDERS).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
    </div>
  );
}
