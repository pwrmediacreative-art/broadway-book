import "server-only";

/**
 * Dropbox, read-only, SERVER ONLY. Uses the app key/secret and a long-lived refresh
 * token (DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN) to get short-lived
 * access tokens. Never copies PDFs: viewing uses temporary links made on demand.
 */

export const DEFAULT_FOLDER = "/Nashville Number Charts 2";

export function chartFolder(): string {
  return process.env.DROPBOX_FOLDER_PATH?.trim() || DEFAULT_FOLDER;
}

export function dropboxConfigured(): boolean {
  return Boolean(
    process.env.DROPBOX_APP_KEY && process.env.DROPBOX_APP_SECRET && process.env.DROPBOX_REFRESH_TOKEN,
  );
}

let cached: { token: string; expires: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const key = process.env.DROPBOX_APP_KEY;
  const secret = process.env.DROPBOX_APP_SECRET;
  const refresh = process.env.DROPBOX_REFRESH_TOKEN;
  if (!key || !secret || !refresh) throw new Error("Dropbox isn't connected yet (missing DROPBOX_* env vars).");
  const res = await fetch("https://api.dropbox.com/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Dropbox sign-in failed (${res.status}). Check the DROPBOX_* env vars.`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  return cached.token;
}

async function rpc<T>(endpoint: string, args: unknown, attempt = 0): Promise<T> {
  const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    const wait = Number(res.headers.get("Retry-After")) || 2 ** attempt;
    await new Promise((r) => setTimeout(r, wait * 1000));
    return rpc(endpoint, args, attempt + 1);
  }
  if (res.status === 401 && attempt === 0) {
    cached = null;
    return rpc(endpoint, args, attempt + 1);
  }
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`Dropbox ${endpoint} failed (${res.status}): ${text}`);
  }
  return (await res.json()) as T;
}

export interface DropboxPdf {
  id: string; // "id:…", stable across renames and moves
  name: string;
  path: string; // path_display
  hash: string; // content_hash: changes when the PDF's bytes change
  size: number;
  modified: string; // server_modified, ISO 8601
}

interface Entry {
  ".tag": "file" | "folder" | "deleted";
  id: string;
  name: string;
  path_display: string;
  content_hash?: string;
  size?: number;
  server_modified?: string;
}
interface Page {
  entries: Entry[];
  cursor: string;
  has_more: boolean;
}

/** Every PDF under the folder, recursively. Follows list_folder/continue until has_more is false. */
export async function listPdfs(folder = chartFolder()): Promise<DropboxPdf[]> {
  const out: DropboxPdf[] = [];
  let page = await rpc<Page>("files/list_folder", { path: folder, recursive: true, limit: 2000 });
  for (;;) {
    for (const e of page.entries) {
      if (e[".tag"] !== "file" || !/\.pdf$/i.test(e.name)) continue;
      out.push({
        id: e.id,
        name: e.name,
        path: e.path_display,
        hash: e.content_hash ?? "",
        size: e.size ?? 0,
        modified: e.server_modified ?? new Date(0).toISOString(),
      });
    }
    if (!page.has_more) return out;
    page = await rpc<Page>("files/list_folder/continue", { cursor: page.cursor });
  }
}

/** A link to the PDF that Dropbox expires after 4 hours. `pathOrId` may be "id:…". */
export async function temporaryLink(pathOrId: string): Promise<string> {
  const { link } = await rpc<{ link: string }>("files/get_temporary_link", { path: pathOrId });
  return link;
}
