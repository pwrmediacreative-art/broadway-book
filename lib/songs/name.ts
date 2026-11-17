// A song's name lives on the song row. Once a song is renamed, publishing no longer copies
// the chart's {title:}/{artist:} lines onto it, so the editor shows the current name instead.

const TITLE = /^\{title:[^}\n]*\}$/m;
const ARTIST = /^\{artist:[^}\n]*\}$/m;

/** The chart text with its {title:} and {artist:} lines set to the song's current name. */
export function withName(chart: string, title: string, artist: string | null): string {
  let out = TITLE.test(chart) ? chart.replace(TITLE, () => `{title: ${title}}`) : chart;
  if (artist) {
    out = ARTIST.test(out)
      ? out.replace(ARTIST, () => `{artist: ${artist}}`)
      : out.replace(TITLE, (m) => `${m}\n{artist: ${artist}}`);
  }
  return out;
}
