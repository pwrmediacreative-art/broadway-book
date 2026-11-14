import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Geist, Geist_Mono, Inter, JetBrains_Mono } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import AuthBar from "./AuthBar";
import OfflineRoot from "./OfflineRoot";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Chart fonts players can pick in stage mode.
const atkinson = Atkinson_Hyperlegible({ variable: "--font-atkinson", subsets: ["latin"], weight: ["400", "700"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const jbMono = JetBrains_Mono({ variable: "--font-jbmono", subsets: ["latin"] });

// iPhone screens (points, pixel ratio) with a start-up image in public/icons (scripts/gen-icons.mjs).
const SPLASH = [
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

export const metadata: Metadata = {
  title: "Broadway Book",
  description: "Free Nashville number charts for musicians playing Lower Broadway.",
  applicationName: "Broadway Book",
  icons: { apple: "/icons/apple-touch-icon.png" },
  // iPhone "Add to Home Screen": opens without Safari's bars, with a start-up screen per phone size.
  appleWebApp: {
    capable: true,
    title: "Bway Book",
    statusBarStyle: "black",
    startupImage: SPLASH.map(([w, h, r]) => ({
      url: `/icons/splash-${w * r}x${h * r}.png`,
      media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)`,
    })),
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${atkinson.variable} ${inter.variable} ${jbMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Suspense fallback={<div className="h-11" />}>
          <AuthBar />
        </Suspense>
        <OfflineRoot />
        {children}
      </body>
    </html>
  );
}
