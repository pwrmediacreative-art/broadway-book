# Broadway Book chart format

A plain-text, ChordPro-style format for Nashville Number System charts.
One file = one song. The parser lives in `lib/chart/` and is the reference
implementation: if this document and the parser disagree, fix one of them.

**No lyrics.** Charts hold numbers, structure, dynamics and short cue words only.

## Example

```text
{title: Wagon Wheel}
{artist: Old Crow Medicine Show}
{key: A} {bpm: 140} {time: 4/4}
[Intro] 1 5 6- 4 | 1 5 4 4
[V] 1 5 6- 4 | 1 5 4 4
[C] 1 5 6- 4 | 1 5 4 4
```

*(Example only. Not a reviewed chart.)*

## Layout

- **Header tags** come first, one or more per line: `{name: value}`.
- **Sections** start with a label in brackets. Bars can follow on the same line
  and/or on the lines after it, until the next label.
- **Bars** are separated by spaces. Each bar token is one bar.
- **Lines** (the rows a player reads) are separated by `|`, or by starting a new text line.
- Blank lines are kept. Lines starting with `#` are comments for reviewers and are not shown.

## Header tags

| Tag | Example | Notes |
|---|---|---|
| `{title:}` | `{title: Wagon Wheel}` | Required |
| `{artist:}` | `{artist: Old Crow Medicine Show}` | |
| `{key:}` | `{key: A}` `{key: Bb}` `{key: F#m}` | The key the numbers count from. `m` = minor. Imported charts always have one; a player-made chart may leave it out (see below) |
| `{bpm:}` | `{bpm: 140}` | 2–3 digits |
| `{time:}` | `{time: 4/4}` `{time: 6/8}` | |
| `{feel:}` | `{feel: shuffle}` | Free text: shuffle, two-step, train beat... |
| `{tags:}` | `{tags: country, 90s}` | Comma separated |
| `{numbers:}` | `{numbers: relative}` | Minor keys only, see below |

A chart with **no `{key:}`** is allowed (a player making their own chart may not know it).
The numbers show as written; Chords view and the key picker ask the player to pick a key, and
chord names then follow that key. Nothing is written back into the chart.

## Minor keys

Handwritten charts vary, so each chart says which style it uses:

| Style | Header | Tonic chord | In Am: C / G / F |
|---|---|---|---|
| Minor (default) | `{key: Am}` | `1-` | `b3` / `b7` / `b6` |
| Relative major | `{key: Am} {numbers: relative}` | `6-` | `1` / `5` / `4` |

Numbers always count along the **major** scale of whatever "1" is, so in the minor style
the flat degrees are written explicitly (`b3`, `b6`, `b7`). The song page can flip
any minor chart between the two styles; chord names are identical either way.

## Sections

`[Intro] [V] [Pre] [C] [B] [Solo] [Turn] [Tag] [Outro]`

| Form | Meaning |
|---|---|
| `[V2]` | Numbered section (second verse) |
| `[C x2]` | Play this section twice |
| `[C2 x2]` | Both |
| `["Big ending"]` | Your own section name, in quotes (1–30 characters, 6 words or fewer, no `[ ] { } \| # "`) |
| `["Breakdown"2 x2]` | Own name, numbered and repeated (shown "Breakdown 2") |

Unquoted names must be one of the list above, so a typo like `[Chrous]` is still an error.

## Chords

A chord is `[accidental]degree[quality][/bass]`.

| Symbol | Meaning | Example (key of A) |
|---|---|---|
| `1`–`7` | Scale degree | `4` = D |
| `b` / `#` before the number | Flat / sharp degree | `b7` = G, `#4` = D# |
| `-` | Minor | `6-` = F#m |
| `7` | Dominant 7 | `57` = E7 |
| `maj7` | Major 7 | `1maj7` = Amaj7 |
| `-7` | Minor 7 | `2-7` = Bm7 |
| `sus` / `sus4` / `sus2` | Suspended | `5sus` = Esus |
| `dim` / `dim7` | Diminished | `#4dim` = D#dim |
| `-7b5` | Half-diminished | `7-7b5` = G#m7b5 |
| `aug` or `+` | Augmented | `5+` = E+ |
| `add9` | Added 9th (also add2, add4, add11, add13) | `1add9` = Aadd9 |
| `6` `9` `11` `13`, `b9` `#9` `b5` `#5` `#11` `b13` | Extensions / alterations | `57#9` = E7#9 |
| `/n` | Slash bass | `1/3` = A/C# |

Qualities combine in this order: `-`, `maj7|maj9|dim|dim7|aug|+`, extension number,
`sus`, `add`, alterations. Examples: `2-7`, `5-7`, `57sus`, `1maj9`, `7-7b5`.

## Bars and rhythm

| Symbol | Meaning | Example |
|---|---|---|
| `(1 4)` | Split bar: chords share one bar evenly | `(1 4)` `(1 1 4 5)` |
| `<1>` | Diamond: hit and let ring / hold the bar | `<4>` |
| `^1` | Push: anticipate (play an eighth early) | `^4` |
| `1!` | Stop / choke: hit and cut off | `5!` |
| `1~` | Fermata: hold until cued | `<1>~` |
| `NC` | No chord (shown as N.C.) | `NC` `^NC` |
| `%` | Repeat previous bar | `1 % 4 %` |
| `\|:` | Start repeat: drawn on the left edge of the next bar | `\|: 1 4 1 5 :\|` |
| `:\|` | End repeat: drawn on the right edge of the bar before | `1 5 :\|` |
| `:\|"repeat out"` | End repeat with a short note (6 words or fewer), no space before the quote | `1 5 :\|"repeat out"` |

A `|` that touches a `:` is always part of a repeat sign, never a line break, so
`|: 1 4 | 1 5 :|` is two lines inside one repeat.

Modifiers combine in the order `^` `<...>` then `~` or `!`: `^<b6>~`.
They work inside split bars too: `(^<5> NC)`.

## Dynamics, changes and cues

| Symbol | Meaning | Example |
|---|---|---|
| `<<` | Crescendo (build) from here | `<< 2- 3- 4 5` |
| `>>` | Decrescendo (back off) from here | `>> 4 5 <1>~` |
| `{bpm: 120}` | Tempo change | inline or on its own line |
| `{feel: half time}` | Feel change | |
| `{time: 3/4}` | Time signature change | |
| `{key: B}` | Key change to a named key | |
| `{mod: +1}` | Modulate by half steps (`+1` = up a half step, `-2` = down a whole step) | on its own line before the section |
| `"drums only"` | Cue note: short, 6 words or fewer, **never lyrics** | `"band out"` |
| `"[Band in]"` | Boxed note (drawn in a box, like a handwritten boxed note): square brackets inside the quotes, 6 words or fewer, never lyrics | `"[Mod ↑ P.4th (1 becomes 5)]"` |
| `{mod: +5} "[Mod ↑ P.4th (1 becomes 5)]"` | A key change right before a boxed note shows as that one box (with the new key in Chords view). Numbers after it stay as written, read in the new key | |

## Song details (uploaded charts)

The Song details card (lib/upload/structure.ts) is read from the chart text. It uses
ordinary cues and comments, so these are conventions, not extra syntax:

| Written as | Song details reads |
|---|---|
| `"count off"`, `"drum intro"`, `"guitar intro"`, `"band intro"` first in the first section | Starts |
| `"start: piano alone"` first in the first section (a player's own words) | Starts: Piano alone |
| `"cold stop"`, `"repeat and fade"`, `"ritard"`, `"tag"` last in the last section | Ends |
| `"end: big hold"` last in the last section | Ends: Big hold |
| a cue with the word solo (`"solo"`, `"fiddle solo"`) in a section, or a `[Solo]` section | Solos |
| `# UNCLEAR: …` comments | a detail still to fill in (owner and admin screens) |
| `# ADDED BY A PLAYER: start` directly above a section | that detail was filled in by a player (fields: `start`, `ending`, `solo`, `stop`, `key`) |

The server writes the `# ADDED BY A PLAYER:` lines when a save fills in a detail
(lib/upload/details.ts `markAdded`). Like every comment they are not shown in the chart.

## Canonical form

The parser accepts loose spacing (`{key:A}`, `1   5|6-  4`). Saved charts use the
canonical form the serializer writes: single spaces between bars, ` | ` between lines,
`{name: value}` tags, `[C x2]` / `["Name"2 x2]` labels, `|:` / `:|` / `:|"note"` repeat signs,
`"[note]"` boxed notes, `# comment`, and a trailing newline.
Canonical text round-trips exactly: text → JSON → text gives back the same text.

## Errors

The parser rejects unknown tags, unknown section names, bad custom section names, unreadable
chords, broken repeat signs, empty boxed notes, empty lines between `|`, single-chord or nested
split bars, and bars before the first section, with the line number. It warns (doesn't fail) on
long cues, boxed notes and repeat notes and on a missing title or key; `checkChart` (and the
database, which treats every quoted text as a cue) refuses to save anything quoted that is over
6 words.
