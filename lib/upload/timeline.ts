// The chord timeline every upload source is turned into before we build a chart.
// MusicXML now; Music.AI audio analysis later. Stored in uploads.analysis so the chart can
// be rebuilt without reading the file again. Never holds lyrics: only chords and timing.

/** One chord as the source gave it. Pitch classes are 0–11 (C = 0). */
export interface TimelineChord {
  beat: number; // where it starts in the bar, in beats from the downbeat (0-based, may be fractional)
  root: number | null; // null = no chord (N.C.)
  quality: string; // our chart quality ("", "-", "7", "maj7", "-7", "sus4", ...)
  bass: number | null; // slash bass pitch class, null = root position
  dropped?: string; // parts of the source chord we couldn't write (shown in an UNCLEAR note)
  confidence?: number; // 0–1 when the source gives one
}

export interface TimelineBar {
  beats: number; // beats in this bar
  chords: TimelineChord[]; // in order; an empty bar holds the chord before it
  tempo?: number; // a tempo marking that starts in this bar
  key?: { pc: number; minor: boolean }; // a key signature change that starts in this bar
}

export interface Timeline {
  version: 1;
  source: "musicxml" | "audio";
  title: string | null;
  key: { pc: number; minor: boolean } | null;
  bpm: number | null;
  time: { beats: number; unit: number };
  bars: TimelineBar[];
}
