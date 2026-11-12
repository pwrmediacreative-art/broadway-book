// Example charts used for seeding and tests. All are marked as examples.
// Wagon Wheel uses only its well-known 4-chord loop; the other two are made-up demos.

export const EXAMPLE_CHARTS: { slug: string; text: string }[] = [
  {
    slug: "wagon-wheel",
    text: `{title: Wagon Wheel}
{artist: Old Crow Medicine Show}
{key: A} {bpm: 140} {time: 4/4}
{tags: example}

[Intro] 1 5 6- 4 | 1 5 4 4
[V] 1 5 6- 4 | 1 5 4 4
[C] 1 5 6- 4 | 1 5 4 4
`,
  },
  {
    slug: "lower-broadway-shuffle",
    text: `{title: Lower Broadway Shuffle}
{artist: Broadway Book (demo)}
{key: E} {bpm: 124} {time: 4/4}
{feel: shuffle}
{tags: example, demo}

# Made-up demo song that shows off the chart format.
[Intro] "guitar pickup" ^1 % 4 1 | (4 5) 1 5! NC
[V] 1 % 4 1 | 4 4 1 1/3 | 2- 5 1 (6- 5)
[Pre] 4 5/7 6- <4> | << 2- 3- ^4 5
[C x2] 1 5 6- 4 | 1 5 (4 5) 1
[Solo] {feel: half time} 1 % 4 % | 5 4 1 5
[B] b7 4 1 % | b6 b7 <5>~ "band out"
{mod: +1}
[C] 1 5 6- 4 | 1 5 (4 5) 1
[Outro] >> 4 5 <1>~
`,
  },
  {
    slug: "printers-alley-blues",
    text: `{title: Printers Alley Blues}
{artist: Broadway Book (demo)}
{key: Am} {bpm: 72} {time: 6/8}
{tags: example, demo, minor}

# Made-up minor-key demo. 1 is the minor tonic; switch to relative to see 6-.
[Intro] 1- b6 b7 1-
[V] 1- 4- b7 b3 | b6 4- 5 5!
[C] b6 b7 b3 b3/5 | b6 b7 1- %
[Turn] (1- b7) (b6 5)
[Outro] b6 b7 <1->~
`,
  },
];
