import SettingsView from "../Settings";

export const metadata = { title: "Settings · Broadway Book" };

// A plain client page, so it is saved on the phone and works offline (SHELLS in lib/offline/routes.ts and public/sw.js).
export default function SettingsPage() {
  return <SettingsView />;
}
