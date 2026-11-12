import { describe, expect, it } from "vitest";
import { isParsed, parseFilename } from "./filename";

const cases: [string, string | null, string | null][] = [
  ["Any Man Of Mine - Shania Twain.pdf", "Any Man Of Mine", "Shania Twain"],
  ["(Absolutely) Story of A Girl - Nine Days.pdf", "(Absolutely) Story of A Girl", "Nine Days"],
  ["Please, Please, Please - Andrew Combs.pdf", "Please, Please, Please", "Andrew Combs"],
  ["Trying To Find Atlantis - Jamie O'Neal.pdf", "Trying To Find Atlantis", "Jamie O'Neal"],
  ["I Miss Us -Jeremiah Wheeler.pdf", "I Miss Us", "Jeremiah Wheeler"],
  [
    "Mama Don't Let Your Babies Grow Up To Be Cowboys - Waylon Jennings : Willie Nelson.pdf",
    "Mama Don't Let Your Babies Grow Up To Be Cowboys",
    "Waylon Jennings & Willie Nelson",
  ],
  ["Love in the First Degree - Alabama - Jan 14, 2014, 1-30 PM.pdf", "Love in the First Degree", "Alabama"],
  ["Never Grow Up - Taylor Swift - chords.pdf", "Never Grow Up", "Taylor Swift"],
  ["Copy of Heart Like Mine - Miranda Lambert.pdf", "Heart Like Mine", "Miranda Lambert"],
  ["Good Directions - Billy Currington (Tim Denbo's conflicted copy).pdf", "Good Directions", "Billy Currington"],
  ["Whatever It Is - Zac Brown Band (1).PDF", "Whatever It Is", "Zac Brown Band"],
  ["Ex-Girlfriend - No Doubt.pdf", "Ex-Girlfriend", "No Doubt"],
  ["Hell On the Heart - Eric Church 001.pdf", "Hell On the Heart", "Eric Church"],
  ["Pontoon - Little Big Town0001.pdf", "Pontoon", "Little Big Town"],
  ["You Belong With Me - Taylor Swift (chords).pdf", "You Belong With Me", "Taylor Swift"],
  ["Love Song - 311.pdf", "Love Song", "311"],
  ["The Bed You Made For Me - Highway 101.pdf", "The Bed You Made For Me", "Highway 101"],
  ["Brown Eyed Girl- Van Morrison.pdf", "Brown Eyed Girl", "Van Morrison"],
  ["Make You Feel My Love - Adele (Dylan tune).pdf", "Make You Feel My Love", "Adele (Dylan tune)"],
  // No artist: these go to the Unparsed list.
  ["BlueSky-AllmanBros (1).pdf", "BlueSky-AllmanBros", null],
  ["Exit 27 (2).pdf", "Exit 27", null],
  ["A Song (About a Song) Chart.pdf", "A Song (About a Song)", null],
  ["Are You Sure Hank Done It This Way Lyrics.pdf", "Are You Sure Hank Done It This Way", null],
  ["Anymore.pdf", "Anymore", null],
  ["Fell In Love With A Boy*.jpg.pdf", "Fell In Love With A Boy", null],
  ["Cupid (I Don't Care) -.pdf", "Cupid (I Don't Care)", null],
  ["Song Title - .pdf", "Song Title", null],
];

describe("parseFilename", () => {
  it.each(cases)("%s", (file, title, artist) => {
    expect(parseFilename(file)).toEqual({ title, artist });
  });

  it("marks names with no artist as unparsed", () => {
    expect(isParsed(parseFilename("Anymore.pdf"))).toBe(false);
    expect(isParsed(parseFilename("Chillin It - Cole Swindell.pdf"))).toBe(true);
  });
});
