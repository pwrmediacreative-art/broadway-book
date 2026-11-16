// Browser helpers for the optional audio file: check type, size and length, then upload it
// straight to the private "audio" bucket with progress (the Supabase client has no progress
// events, so this uses the storage REST endpoint with the user's own session token).
import { browserClient } from "@/lib/supabase/browser";

export const MAX_AUDIO_SECONDS = 600; // 10 minutes
const TYPES: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav" };

export function audioExt(file: File): "mp3" | "m4a" | "wav" | null {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return ext === "mp3" || ext === "m4a" || ext === "wav" ? ext : null;
}

/** Length in seconds, read by the browser. Rejects when it can't be read. */
export function audioSeconds(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    a.preload = "metadata";
    const done = (fn: () => void) => {
      URL.revokeObjectURL(url);
      fn();
    };
    a.onloadedmetadata = () => done(() => (isFinite(a.duration) && a.duration > 0 ? resolve(a.duration) : reject(new Error("We couldn't read how long this audio is."))));
    a.onerror = () => done(() => reject(new Error("This browser can't open that audio file.")));
    a.src = url;
  });
}

/** Check an audio file before upload. Returns an error message or null. */
export async function checkAudio(file: File, maxMb: number): Promise<{ error: string } | { seconds: number }> {
  if (!audioExt(file)) return { error: "Audio must be MP3, M4A or WAV." };
  if (file.size > maxMb * 1024 * 1024)
    return { error: `That audio is over ${maxMb} MB. Use MP3 or M4A for long songs.` };
  try {
    const seconds = await audioSeconds(file);
    if (seconds > MAX_AUDIO_SECONDS) return { error: "Audio must be 10 minutes or shorter." };
    return { seconds };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Upload to audio/<user id>/<random>.<ext>. Calls onProgress with 0–1. Returns the path. */
export async function uploadAudio(file: File, onProgress: (p: number) => void): Promise<string> {
  const db = browserClient();
  const {
    data: { session },
  } = await db.auth.getSession();
  if (!session) throw new Error("Sign in first.");
  const ext = audioExt(file)!;
  const path = `${session.user.id}/${crypto.randomUUID()}.${ext}`;
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/audio/${path}`;
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("Content-Type", TYPES[ext]);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = `Upload failed (${xhr.status}).`;
      try {
        const body = JSON.parse(xhr.responseText);
        if (/row-level security|unauthorized|403/i.test(`${body.message} ${body.statusCode}`)) msg = "Uploading isn't open to your account.";
        else if (/size/i.test(body.message ?? "")) msg = "That audio file is too big.";
      } catch {
        // keep the plain message
      }
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error("The upload stopped. Check your connection and try again."));
    xhr.send(file);
  });
  onProgress(1);
  return path;
}
