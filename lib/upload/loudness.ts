// "Cold stop or fade?" from the song's own audio, measured in the browser (free).
// The result is only a suggestion: the player confirms it before it goes in the chart.

/** Loudness (RMS) per window of `hop` seconds for mono samples. */
export function rmsWindows(samples: Float32Array, rate: number, hop = 0.25): number[] {
  const n = Math.max(1, Math.round(rate * hop));
  const out: number[] = [];
  for (let i = 0; i < samples.length; i += n) {
    let sum = 0;
    const end = Math.min(samples.length, i + n);
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    out.push(Math.sqrt(sum / Math.max(1, end - i)));
  }
  return out;
}

export type EndingGuess = { cue: "cold stop" | "repeat and fade"; why: string } | { cue: null; why: string };

/**
 * Look at the last 20 seconds. Fade: loudness falls steadily over 6+ seconds to near
 * silence. Cold stop: still loud within 2 seconds of the music ending, then silence.
 */
export function endingFromLoudness(rms: number[], hop = 0.25): EndingGuess {
  if (rms.length < 8 / hop) return { cue: null, why: "The audio is too short to tell." };
  const peak = Math.max(...rms);
  if (peak <= 0) return { cue: null, why: "The audio is silent." };
  const db = rms.map((r) => 20 * Math.log10(Math.max(r, 1e-6) / peak));
  // where the music ends: last window louder than -40 dB
  let end = db.length - 1;
  while (end > 0 && db[end] < -40) end--;
  const win = (sec: number) => Math.round(sec / hop);
  const body = db.slice(Math.max(0, end - win(30)), Math.max(1, end - win(12)));
  const level = body.length ? body.reduce((a, b) => a + b, 0) / body.length : -10;
  const at = (sec: number) => db[Math.max(0, end - win(sec))];
  const avg = (from: number, to: number) => {
    const s = db.slice(Math.max(0, end - win(from)), Math.max(1, end - win(to)));
    return s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
  };
  const last2 = avg(2, 0);
  const sixAgo = avg(8, 6);
  if (last2 > level - 8 && at(0.5) > level - 12) return { cue: "cold stop", why: "The music is still full volume right up to the end." };
  if (sixAgo - last2 > 12 && sixAgo > level - 8) return { cue: "repeat and fade", why: "The volume drops steadily over the last few seconds." };
  return { cue: null, why: "The ending doesn't sound clearly like a cold stop or a fade." };
}
