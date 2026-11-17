// Rack's colour tokens (DESIGN.md "Tokens", frontend/src/index.css), as native colours.
// They follow the system's light/dark setting. Semantic names only, like the web.

export interface Palette {
  /** page */
  background: string;
  /** grouped sections, inputs, sheets */
  surface: string;
  /** rows inside grouped sections, menus */
  elevated: string;
  /** primary text */
  foreground: string;
  /** secondary text */
  muted: string;
  /** tertiary text, placeholders */
  subtle: string;
  /** separators */
  border: string;
  /** chips, icon buttons */
  fill: string;
  fillStrong: string;
  /** the one accent: match score, "good for you" signals */
  accent: string;
  /** destructive actions only */
  danger: string;
  /** estimates and caveats */
  warning: string;
}

export const light: Palette = {
  background: '#FFFFFF',
  surface: '#F2F2F7',
  elevated: '#FFFFFF',
  foreground: '#111113',
  muted: 'rgba(60, 60, 67, 0.62)',
  subtle: 'rgba(60, 60, 67, 0.32)',
  border: 'rgba(60, 60, 67, 0.18)',
  fill: 'rgba(120, 120, 128, 0.12)',
  fillStrong: 'rgba(120, 120, 128, 0.2)',
  accent: '#248A3D',
  danger: '#D70015',
  warning: '#B25000',
};

export const dark: Palette = {
  background: '#000000', // deliberate: OLED black, like the web
  surface: '#1C1C1E',
  elevated: '#2C2C2E',
  foreground: '#FFFFFF',
  muted: 'rgba(235, 235, 245, 0.6)',
  subtle: 'rgba(235, 235, 245, 0.3)',
  border: 'rgba(84, 84, 88, 0.5)',
  fill: 'rgba(120, 120, 128, 0.24)',
  fillStrong: 'rgba(120, 120, 128, 0.36)',
  accent: '#30D158',
  danger: '#FF453A',
  warning: '#FFB340',
};

export function palette(scheme: 'light' | 'dark' | null | undefined): Palette {
  return scheme === 'dark' ? dark : light;
}
