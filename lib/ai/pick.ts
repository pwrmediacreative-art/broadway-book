// Pick a varied pilot set: spread across file sizes (a stand-in for page count and how
// busy the page is) and across the alphabet, at random within that. Pure.
export interface Candidate {
  id: string;
  file_name: string | null;
  size: number | null;
}

export function pickVaried<T extends Candidate>(all: T[], n: number, rand: () => number = Math.random): T[] {
  if (all.length <= n) return [...all];
  const bySize = [...all].sort((a, b) => (a.size ?? 0) - (b.size ?? 0));
  const picked: T[] = [];
  const letters = new Set<string>();
  for (let i = 0; i < n; i++) {
    // Bucket i of n by size rank.
    const bucket = bySize.slice(Math.floor((i * bySize.length) / n), Math.floor(((i + 1) * bySize.length) / n));
    const fresh = bucket.filter((c) => !letters.has(firstLetter(c)));
    const pool = fresh.length ? fresh : bucket;
    const c = pool[Math.floor(rand() * pool.length)];
    picked.push(c);
    letters.add(firstLetter(c));
  }
  return picked;
}

const firstLetter = (c: Candidate) => (c.file_name ?? "").trim().charAt(0).toLowerCase();
