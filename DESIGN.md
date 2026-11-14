---
name: Broadway Book
description: Nashville number charts for the stage. Read at arm's length, in the dark, in seconds.
colors:
  stage-black: "#000000"
  house-black: "#0a0a0b"
  chart-white: "#f5f5f4"
  cue-gray: "#a8a29e"
  case-charcoal: "#18181b"
  rule-gray: "#3f3f46"
  downbeat-amber: "#fbbf24"
  stop-red: "#fca5a5"
  key-change-blue: "#7dd3fc"
  chart-stop-red: "#f87171"
  stage-light-paper: "#ffffff"
  stage-light-ink: "#0a0a0b"
  stage-light-muted: "#44403c"
  stage-light-amber: "#b45309"
  stage-light-panel: "#f5f5f4"
  stage-light-line: "#a8a29e"
  stage-light-key-change: "#0369a1"
typography:
  display:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: "36px"
  headline:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: "32px"
  title:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "28px"
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "20px"
  data:
    fontFamily: "Geist Mono, ui-monospace, monospace"
  chart:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "clamp(1.6rem, 7vw, 2.4rem)"
    fontWeight: 700
    lineHeight: 1
    fontFeature: "\"tnum\""
rounded:
  none: "0px"
  control: "4px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
  "12": "48px"
  tap: "44px"
components:
  button-primary:
    backgroundColor: "{colors.downbeat-amber}"
    textColor: "{colors.stage-black}"
    rounded: "{rounded.control}"
    height: "{spacing.tap}"
  button-primary-pressed:
    backgroundColor: "{colors.case-charcoal}"
    textColor: "{colors.chart-white}"
  button-secondary:
    textColor: "{colors.chart-white}"
    rounded: "{rounded.control}"
    height: "{spacing.tap}"
  button-secondary-pressed:
    backgroundColor: "{colors.case-charcoal}"
  input:
    textColor: "{colors.chart-white}"
    rounded: "{rounded.control}"
    height: "{spacing.tap}"
  panel:
    backgroundColor: "{colors.case-charcoal}"
    rounded: "{rounded.none}"
  badge-verified:
    textColor: "{colors.chart-white}"
    typography: "{typography.label}"
  chart-section-label:
    textColor: "{colors.downbeat-amber}"
  chart-cue:
    textColor: "{colors.downbeat-amber}"
  chart-key-change:
    textColor: "{colors.key-change-blue}"
---

# Design System: Broadway Book

<!-- Tokens live in app/globals.css as --bb-* variables (Tailwind classes: bg-bb-*, text-bb-*, rounded-bb-*, font-bb-*).
     As of this file's first version, screens still use the older tokens (--background, --accent, ...);
     the restyle step moves them onto --bb-* and retires the old names. -->

## Overview

**Creative North Star: "The Session Chart"**

The app looks and reads like a paper chart on a music stand. Black ground, white numbers, nothing
between the player and the next bar. The players use it mid-set on a dark, loud stage, one hand
on the phone, reading at arm's length (see PRODUCT.md). Every decision answers one question:
does this help them read the next bar faster?

Mood: **sharp, quiet, certain.** Nothing on screen competes with the numbers. The app is dark
everywhere. The only light surface is stage mode's "Light" paper look for daylight gigs. Color is
rare and means something: amber marks what is live right now, red marks an error, and inside a
chart, color is notation.

**Key Characteristics:**
- Black and white first; one accent (Downbeat Amber) used sparingly.
- Flat: no shadows, gradients or blur. Separation by 1px lines and space.
- Two corner radii: square (0px) for surfaces, 4px for controls.
- Big, bold, legible chart type with tabular figures.
- Tap targets of 44px or larger everywhere.
- Plain, short words.

## Colors

A near-monochrome stage palette: two blacks, one white, two grays, one amber, one red. The
stage-light palette is its daylight mirror.

### Primary
- **Downbeat Amber** (`downbeat-amber`): the one accent. It marks only what is live right now: the
  current bar, the main button on a screen, active toggles, the selected beat and the stage beat
  light. Text on amber is Stage Black (12.6:1). Amber on House Black is 11.9:1.

### Neutral
- **Stage Black** (`stage-black`): the stage mode ground (pure black, so the phone glows as little
  as possible) and the text color on amber.
- **House Black** (`house-black`): the app ground everywhere outside stage mode.
- **Chart White** (`chart-white`): chart numbers, body text, headings (18.1:1 on House Black).
- **Cue Gray** (`cue-gray`): secondary text, hints, metadata, dynamics in charts
  (7.8:1 on House Black, 7.0:1 on Case Charcoal).
- **Case Charcoal** (`case-charcoal`): panels, grouped controls, the pressed state of buttons.
- **Rule Gray** (`rule-gray`): 1px dividers and control borders. Never text (1.9:1).

### Status
- **Stop Red** (`stop-red`): errors and destructive actions only (10.4:1 on House Black).
- **Key-Change Blue** (`key-change-blue`): key changes inside charts only. Not a UI color.

### Chart notation
Inside a chart, color is notation, not UI state:
- Section labels ("Intro", "V", "C"), cue words, push carets and fermatas are **Downbeat Amber**:
  "read this, it's an instruction".
- The stop mark at the end of a song is a **Chart Stop Red** dot (`chart-stop-red`, 7.2:1).
- Key changes are a **Key-Change Blue** box.
- Dynamics are **Cue Gray** italics.

### Stage light ("Light" in stage mode)
A high-contrast paper look for daylight and patio gigs. It exists only in stage mode.
- **Paper** (`stage-light-paper`) ground, **Ink** (`stage-light-ink`) numbers (19.8:1).
- **Muted** (`stage-light-muted`, 10.3:1), **Amber** (`stage-light-amber`, 5.0:1),
  **Panel** (`stage-light-panel`), **Line** (`stage-light-line`),
  **Key change** (`stage-light-key-change`, 5.9:1).

### Named Rules
**The Downbeat Rule.** In the app's UI, amber means "live right now" and nothing else. If an element
is not the current bar, the main action, an active toggle or the beat light, it is not amber.
Chart notation is the one named exception (see above).

**The Stop Rule.** Red appears only for errors and destructive actions, plus the stop mark inside
charts. Never for emphasis.

**The No-Purple Rule.** No purple, violet or indigo anywhere. A personal flag on a chord is a solid
Chart White dot with a Stage Black ring.

**The Word-First Status Rule.** Status reads from the word, not the color. Verified is Chart White
text with a check mark. Unverified is a Cue Gray outline dot. Neither uses green or amber.

## Typography

**UI Font:** Geist Sans (with system-ui, sans-serif)
**Chart Font:** Atkinson Hyperlegible Bold (with system-ui, sans-serif)
**Data Font:** Geist Mono (with ui-monospace, monospace)

**Character:** Geist is a plain, sharp workhorse for the app around the chart. Atkinson
Hyperlegible was built for low vision: 1, l and I, and 6 and 8, are hard to mix up at arm's length.
That is the whole job of chart text.

### Hierarchy
- **Display** (700, 30px, 36px line): the page title (song title, app name).
- **Headline** (700, 24px, 32px line): section headings on long pages.
- **Title** (600, 20px, 28px line): list row titles, dialog titles.
- **Body** (400, 18px, 1.4 line height): default text. 18px, not 16px, because it is read at arm's length.
- **Label** (600, 14px, 20px line): small labels, badges, helper lines. The smallest text in the app.
- **Data** (Geist Mono): short measurements only — keys, bar counts, tempos, times. Never for prose.

### Chart text
- Atkinson Hyperlegible 700, line height 1, tabular figures (so bar lines stay aligned).
- Song page size: `clamp(1.6rem, 7vw, 2.4rem)`.
- Stage mode: fits the whole chart between 30px and 75px (`MAX_STAGE_SIZE` in `lib/chart/layout.ts`),
  scrolling at 40px when it can't fit.
- Sizes inside a chart are relative to the chart size: section labels 0.55em, cue words 0.45em
  semibold italic in quotes, dynamics 0.45em italic, key-change box 0.45em semibold.
- Four bars to a line.
- The stage font picker (Legible, Sans, Mono, Bold) stays: it is the player's choice. Legible
  (Atkinson) is the default.

### Named Rules
**The Arm's-Length Rule.** No UI text below 14px. Chart text never below 30px in stage mode.

**The Two-Voice Rule.** Geist speaks for the app, Atkinson speaks for the chart. Don't swap them.

## Layout

- Phone first: one column, 16px side margins, built for a 375px-wide screen and up.
- Spacing on a 4px grid: 4, 8, 12, 16, 24, 32, 48px. Tight inside a group, wide between groups.
- Every tap target is 44px or larger in both directions.
- Left-aligned text and content by default.
- Lists are full-width rows separated by 1px Rule Gray lines, not stacks of cards.
- Stage mode hides everything except the chart; controls appear on tap and hide after 3.5 seconds.

## Elevation & Depth

Flat. No shadows, no gradients, no blur, no glass. Depth is shown by ground color only:
House Black (page) → Case Charcoal (panel). Separation comes from 1px Rule Gray lines and spacing.

### Named Rules
**The Flat Stage Rule.** Nothing floats. If a surface needs to stand apart, it changes ground color
or gets a 1px line, never a shadow.

## Shapes

- **Square (0px)** for surfaces: panels, sections, lists, rows, sheets.
- **Slightly rounded (4px)** for controls: buttons, inputs, selects, toggles.
- No pill shapes. No fully round buttons.
- Chart notation keeps its own small, chart-relative rounding (section labels, key-change box);
  it is part of the notation, not the UI.

## Components

Character: tools on a music stand — plain, firm, obvious.

### Buttons
- **Shape:** slightly rounded (4px), at least 44px tall.
- **Primary:** Downbeat Amber ground, Stage Black text. One per screen at most (the Downbeat Rule).
- **Secondary:** Chart White text, 1px Rule Gray border.
- **Pressed:** the ground goes to Case Charcoal. No scaling, no bounce.
- **Focus:** 2px solid Downbeat Amber outline, 2px offset.
- **Disabled (and offline):** the control says why in words (offline: `OFFLINE_MSG`). The visual treatment is settled in the restyle step.

### Inputs / Fields
- **Style:** 1px Rule Gray border, 4px corners, 44px tall, body-size text.
- **Focus:** 2px solid Downbeat Amber outline, 2px offset.
- **Error:** a Stop Red message naming the problem and the fix.

### Panels
- Case Charcoal ground, square corners, no shadow.
- Never a panel inside a panel.

### Badges and status
- **Verified:** Chart White label-size text with a check mark. No green.
- **Unverified:** Cue Gray outline dot.
- **Flag (personal):** solid Chart White dot with a Stage Black ring.

### Chart (signature component)
- Chart White numbers on black; notation colors as listed in Colors → Chart notation.
- The selected beat (press-and-hold) gets a Downbeat Amber outline and a light amber wash.
- The stage beat light pulses Downbeat Amber; it is the one animated element besides autoscroll.

### Motion
- State changes: 150ms ease-out. Nothing else animates.
- No bounce, no slide-ins, no entrance animations.
- Exceptions: the beat light and autoscroll.
- Everything honors reduced motion.

## Do's and Don'ts

### Do:
- **Do** use the `--bb-*` tokens from `app/globals.css` for every color, font, radius and spacing value.
- **Do** keep amber for what is live right now (the Downbeat Rule).
- **Do** keep every tap target at 44px or larger and UI text at 14px or larger.
- **Do** separate with 1px Rule Gray lines and space, not boxes.
- **Do** say status in words.

### Don't:
- **Don't** use gradient heroes or gradient text.
- **Don't** use emoji as icons.
- **Don't** put rounded cards everywhere; lists are rows, surfaces are square.
- **Don't** use generic purple accents (the No-Purple Rule).
- **Don't** center everything; text is left-aligned.
- **Don't** add a kicker or eyebrow label above a heading.
- **Don't** nest a card or panel inside another.
- **Don't** use same-size icon + heading + text cards as page structure.
- **Don't** use the hero-metric template (big number, small label, supporting stats).
- **Don't** use glass, blur or shadows, including hard offset shadows.
- **Don't** put a colored border thicker than 1px on one side of a card, row or alert.
- **Don't** use monospace as a costume; Geist Mono is for keys, bar counts, tempos and times.
- **Don't** add a light mode outside stage mode.
- **Don't** hard-code colors or fonts in components.
