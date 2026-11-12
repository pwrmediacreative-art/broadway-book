// One-time: get a long-lived Dropbox refresh token (read-only scopes) and save it to
// .env.local. The token is never printed.
// Usage: put DROPBOX_APP_KEY and DROPBOX_APP_SECRET in .env.local, then `npm run dropbox:token`.
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

const SCOPES = "files.metadata.read files.content.read";
const key = process.env.DROPBOX_APP_KEY;
const secret = process.env.DROPBOX_APP_SECRET;
const folder = process.env.DROPBOX_FOLDER_PATH || "/Nashville Number Charts 2";
if (!key || !secret) {
  console.error("Add DROPBOX_APP_KEY and DROPBOX_APP_SECRET to .env.local first.");
  process.exit(1);
}

const url = new URL("https://www.dropbox.com/oauth2/authorize");
url.search = new URLSearchParams({
  client_id: key,
  response_type: "code",
  token_access_type: "offline", // gives a refresh token
  scope: SCOPES,
}).toString();

console.log("\n1. Open this link, sign in to YOUR Dropbox, click Allow:\n\n   " + url + "\n");
const rl = createInterface({ input: process.stdin, output: process.stdout });
const code = (await rl.question("2. Paste the code Dropbox shows you: ")).trim();
rl.close();

const basic = "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
const res = await fetch("https://api.dropbox.com/oauth2/token", {
  method: "POST",
  headers: { Authorization: basic, "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ code, grant_type: "authorization_code" }),
});
const body = await res.json();
if (!res.ok || !body.refresh_token) {
  console.error("Dropbox said no:", body.error_description || body.error || res.status);
  process.exit(1);
}

const granted = String(body.scope || "").split(" ").filter(Boolean);
const extra = granted.filter((s) => !SCOPES.split(" ").includes(s) && s !== "account_info.read");
if (extra.length) console.warn("Warning: this app also has", extra.join(", "), "- remove them in the App Console.");

// Save to .env.local, replacing any earlier token.
const envPath = ".env.local";
const lines = readFileSync(envPath, "utf8").split("\n").filter((l) => !l.startsWith("DROPBOX_REFRESH_TOKEN="));
while (lines.length && lines[lines.length - 1] === "") lines.pop();
lines.push(`DROPBOX_REFRESH_TOKEN=${body.refresh_token}`, "");
writeFileSync(envPath, lines.join("\n"));

// Prove it works: list one entry of the chart folder.
const check = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
  method: "POST",
  headers: { Authorization: `Bearer ${body.access_token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ path: folder, limit: 1 }),
});
console.log(`\nSaved DROPBOX_REFRESH_TOKEN to .env.local (scopes: ${granted.join(", ")}).`);
console.log(check.ok ? `OK: can read "${folder}".` : `But reading "${folder}" failed (${check.status}). Check the folder name.`);
