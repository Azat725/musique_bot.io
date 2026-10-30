/** Colour themes and record colours (Settings → Customization). The palettes themselves live in css/tokens.css;
 *  here are what JS needs: light or dark, the background for Telegram's header and the swatches for the pickers.
 *  The early script in index.html keeps its own copy of THEME_BG — keep both in step. */

export const THEMES = {
  classic: null, // follows Auto / Light / Dark
  navy: { mode: 'dark', bg: '#0F1A2E', swatch: ['#0F1A2E', '#6B4A32', '#F1E6D2', '#A8394A'] },
  noir: { mode: 'dark', bg: '#121212', swatch: ['#121212', '#3A3A3A', '#F5F5F5', '#9E2B3C'] },
  bordo: { mode: 'dark', bg: '#4A121C', swatch: ['#4A121C', '#F3E7D3', '#1F2E4D', '#2C1B13'] },
  sky: { mode: 'light', bg: '#D6E7F3', swatch: ['#D6E7F3', '#F4EEE2', '#6B4A32', '#7B1E2B'] },
  green: { mode: 'dark', bg: '#12261D', swatch: ['#12261D', '#EFE4CF', '#9A2E3D', '#5C3F2A'] },
  oldmoney: { mode: 'light', bg: '#F4EFE3', swatch: ['#F4EFE3', '#2F4B3C', '#8A6A2F', '#7B1E2B'] },
};

export const CLASSIC_BG = { light: '#EFE4CF', dark: '#1A1410' };
export const CLASSIC_SWATCH = ['#EFE4CF', '#14213D', '#7B1E2B', '#1A1410'];

export const RECORD_COLORS = {
  black: '#101218', bordeaux: '#5A1420', brown: '#4A2E1E', beige: '#D5BF9B',
  navy: '#16243F', green: '#1E3A2C', grey: '#55565B', ivory: '#ECE4D4', gold: '#B08D57',
};
