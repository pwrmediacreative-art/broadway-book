// Draws the app icons and iPhone start-up screens into public/icons (run: npm run icons).
// One simple mark: bold amber "BB" on the app's near-black. Swap the PNGs to rebrand.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ImageResponse } from "next/og.js";

const BG = "#0a0a0b";
const AMBER = "#fbbf24";
const OUT = new URL("../public/icons/", import.meta.url);
// A bold face for the mark (a macOS system font; without it the default regular face is used).
const bold = await readFile("/System/Library/Fonts/Supplemental/Arial Bold.ttf").catch(() => null);
const fonts = bold ? [{ name: "Mark", data: bold, weight: 700, style: "normal" }] : undefined;

/** iPhone screens (points and pixel ratio); iOS only shows a start-up image that matches exactly. */
export const SPLASH = [
  [440, 956, 3],
  [430, 932, 3],
  [428, 926, 3],
  [414, 896, 3],
  [414, 896, 2],
  [402, 874, 3],
  [393, 852, 3],
  [390, 844, 3],
  [375, 812, 3],
  [375, 667, 2],
];

const mark = (size) => ({
  type: "div",
  props: {
    style: { fontSize: size, fontWeight: 700, color: AMBER, letterSpacing: -size * 0.04, lineHeight: 1 },
    children: "BB",
  },
});

const canvas = (children) => ({
  type: "div",
  props: {
    style: { width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: BG },
    children,
  },
});

async function png(name, width, height, tree) {
  const res = new ImageResponse(tree, { width, height, fonts });
  await writeFile(new URL(name, OUT), Buffer.from(await res.arrayBuffer()));
  console.log(name, `${width}x${height}`);
}

await mkdir(OUT, { recursive: true });
await png("icon-192.png", 192, 192, canvas(mark(104)));
await png("icon-512.png", 512, 512, canvas(mark(280)));
// Maskable: Android may crop to a circle, so the mark stays inside the middle 80%.
await png("icon-maskable-512.png", 512, 512, canvas(mark(210)));
await png("apple-touch-icon.png", 180, 180, canvas(mark(98)));
for (const [w, h, r] of SPLASH) {
  await png(`splash-${w * r}x${h * r}.png`, w * r, h * r, canvas([
    mark(96 * r),
    { type: "div", props: { style: { marginTop: 14 * r, fontSize: 22 * r, color: "#a8a29e" }, children: "Broadway Book" } },
  ]));
}
