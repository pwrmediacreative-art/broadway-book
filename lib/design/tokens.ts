/**
 * The few --bb-* colors that must be plain hex outside CSS (viewport themeColor, web manifest).
 * A test keeps these equal to app/globals.css; components use the CSS tokens, never these.
 */
export const HEX = {
  houseBlack: "#0a0a0b",
} as const;
