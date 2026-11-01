/** Colour themes and record colours (Settings → Customization). The palettes themselves live in css/tokens.css;
 *  here are what JS needs, for each of the two modes: the background for Telegram's header and the swatches for the
 *  pickers. The early script in index.html keeps its own copy of the backgrounds — keep both in step. Both tables are
 *  written by a generator from the palettes, so change a palette there and not by hand in three places. */

export const THEMES = {
  classic: null, // follows Auto / Light / Dark with the palettes of tokens.css (:root and :root[data-theme="dark"])
  navy: { light: { bg: '#F3EBDA', swatch: ['#F3EBDA', '#14213D', '#A8394A', '#6B4A32'] },
    dark: { bg: '#0F1A2E', swatch: ['#0F1A2E', '#6B4A32', '#F1E6D2', '#A8394A'] } },
  noir: { light: { bg: '#F2F2F0', swatch: ['#F2F2F0', '#1A1A1A', '#9E2B3C', '#3A3A3A'] },
    dark: { bg: '#121212', swatch: ['#121212', '#3A3A3A', '#F5F5F5', '#9E2B3C'] } },
  bordo: { light: { bg: '#F6ECE6', swatch: ['#F6ECE6', '#4A121C', '#6E1A27', '#1F2E4D'] },
    dark: { bg: '#4A121C', swatch: ['#4A121C', '#F3E7D3', '#1F2E4D', '#2C1B13'] } },
  green: { light: { bg: '#F1EDDD', swatch: ['#F1EDDD', '#1F3D30', '#9A2E3D', '#5C3F2A'] },
    dark: { bg: '#12261D', swatch: ['#12261D', '#EFE4CF', '#9A2E3D', '#5C3F2A'] } },
  richesse: { light: { bg: '#F4EFE3', swatch: ['#F4EFE3', '#2F4B3C', '#8A6A2F', '#7B1E2B'] },
    dark: { bg: '#0F1A14', swatch: ['#0F1A14', '#2F4B3C', '#D9B567', '#F0E8D0'] } },
  obsidian: { light: { bg: '#EEF3F0', swatch: ['#EEF3F0', '#19211E', '#2F7A5E', '#1F3B30'] },
    dark: { bg: '#0D1110', swatch: ['#0D1110', '#19211E', '#E6ECE7', '#548C75'] } },
  terracotta: { light: { bg: '#F6EBDD', swatch: ['#F6EBDD', '#432C25', '#B4553A', '#8E493D'] },
    dark: { bg: '#211714', swatch: ['#211714', '#8E493D', '#F0E1D2', '#C4775E'] } },
  tuscan: { light: { bg: '#F2E8D6', swatch: ['#F2E8D6', '#344638', '#E8D8BE', '#A65F43'] },
    dark: { bg: '#1C231C', swatch: ['#1C231C', '#344638', '#EFE5D0', '#C77A5A'] } },
  ussr: { light: { bg: '#F1E6CC', swatch: ['#F1E6CC', '#B3141C', '#D9A21B', '#3B1012'] },
    dark: { bg: '#2A0F10', swatch: ['#2A0F10', '#B3141C', '#F0C24A', '#F6E7C6'] } },
  ddr: { light: { bg: '#EDE8DC', swatch: ['#EDE8DC', '#1A1A1A', '#C4161C', '#FFCE00'] },
    dark: { bg: '#151515', swatch: ['#151515', '#D91E24', '#FFCE00', '#F2EDE0'] } },
  eighties: { light: { bg: '#FFEFF6', swatch: ['#FFEFF6', '#2A1245', '#D6246E', '#2DE2E6'] },
    dark: { bg: '#1A1033', swatch: ['#1A1033', '#FF2E93', '#2DE2E6', '#FFE45E'] } },
};

/** The mode each theme was first drawn in. Before light and dark came to every theme a person's Auto / Light / Dark
 *  did not apply to it, so on the first run of this version their Theme is set to this and their look stays as it was. */
export const NATIVE_MODE = { navy: 'dark', noir: 'dark', bordo: 'dark', green: 'dark', richesse: 'light', obsidian: 'dark', terracotta: 'dark', tuscan: 'light', ussr: 'light' };

export const CLASSIC_BG = { light: '#EFE4CF', dark: '#1A1410' };
export const CLASSIC_SWATCH = { light: ['#EFE4CF', '#14213D', '#7B1E2B', '#1A1410'], dark: ['#1A1410', '#2E241C', '#F1E6D2', '#A8394A'] };

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

/** Cassette shells (the "Магнитофон" view): [shell, label stripe]; the full set is in css/tokens.css. */
export const TAPE_COLORS = {
  black: ['#1E1E20', '#B3141C'], grey: ['#6C6E72', '#E0B33A'], cream: ['#E4D6B6', '#2F5E9E'], red: ['#A3191F', '#F1E6CC'],
  blue: ['#1F3D74', '#E0B33A'], clear: ['#BFCACD', '#B3141C'],
};

/** Tape recorders: [body, cassette bay]. Silver and black like the stereo decks of the 80s, beige like a portable. */
export const RECORDER_COLORS = {
  silver: ['#BDC0C4', '#2B2B2E'], black: ['#1E1E20', '#0F0F10'], beige: ['#CBB58F', '#3A2E22'], red: ['#9C1E24', '#2B0D0F'],
};
