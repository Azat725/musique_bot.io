/** Colour themes and record colours (Settings → Customization). The palettes themselves live in css/tokens.css;
 *  here are what JS needs: light or dark, the background for Telegram's header and the swatches for the pickers.
 *  The early script in index.html keeps its own copy of THEME_BG — keep both in step. */

export const THEMES = {
  classic: null, // follows Auto / Light / Dark
  navy: { mode: 'dark', bg: '#0F1A2E', swatch: ['#0F1A2E', '#6B4A32', '#F1E6D2', '#A8394A'] },
  noir: { mode: 'dark', bg: '#121212', swatch: ['#121212', '#3A3A3A', '#F5F5F5', '#9E2B3C'] },
  bordo: { mode: 'dark', bg: '#4A121C', swatch: ['#4A121C', '#F3E7D3', '#1F2E4D', '#2C1B13'] },
  green: { mode: 'dark', bg: '#12261D', swatch: ['#12261D', '#EFE4CF', '#9A2E3D', '#5C3F2A'] },
  richesse: { mode: 'light', bg: '#F4EFE3', swatch: ['#F4EFE3', '#2F4B3C', '#8A6A2F', '#7B1E2B'] },
  obsidian: { mode: 'dark', bg: '#0D1110', swatch: ['#0D1110', '#19211E', '#E6ECE7', '#548C75'] },
  terracotta: { mode: 'dark', bg: '#211714', swatch: ['#211714', '#8E493D', '#F0E1D2', '#C4775E'] },
  tuscan: { mode: 'light', bg: '#F2E8D6', swatch: ['#F2E8D6', '#344638', '#E8D8BE', '#A65F43'] },
};

export const CLASSIC_BG = { light: '#EFE4CF', dark: '#1A1410' };
export const CLASSIC_SWATCH = ['#EFE4CF', '#14213D', '#7B1E2B', '#1A1410'];

export const RECORD_COLORS = {
  black: '#101218', bordeaux: '#5A1420', brown: '#4A2E1E', beige: '#D5BF9B',
  navy: '#16243F', green: '#1E3A2C', grey: '#55565B', ivory: '#ECE4D4', gold: '#B08D57',
  emerald: '#1D5944', terracotta: '#A15A45', plum: '#4A2748', red: '#A12331', sky: '#9FBCD4',
};

/** Turntable colourways: [plinth, plate], for the swatches; the whole set of colours is in css/tokens.css. */
export const DECK_COLORS = {
  walnut: ['#4A3426', '#2A2320'], oak: ['#BF9A6B', '#A67C4F'], cherry: ['#6A2B20', '#47190F'], black: ['#1C1C1E', '#121213'],
  silver: ['#B5B8BD', '#979BA2'], white: ['#ECE8DF', '#D7D2C5'], red: ['#A8242B', '#7B1A20'], cream: ['#E3D1A5', '#C9B685'],
};
