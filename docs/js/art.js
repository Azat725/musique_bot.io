import { settings } from './store.js';

/** The picture of an empty "Playlists": the medium of the player in use, half out of the box it is kept in, waiting
 *  to be filled. Flat shapes in the theme's colours (css: .pl-empty__*), one gentle movement each. */

const BOX = (x, y, w, h) => `<rect class="pl-empty__box" x="${x}" y="${y}" width="${w}" height="${h}" rx="5"/>`
  + `<rect class="pl-empty__band" x="${x}" y="${y + 10}" width="${w}" height="7"/>`
  + `<rect class="pl-empty__line" x="${x + 12}" y="${y + h - 26}" width="${w * 0.5}" height="4" rx="2"/>`
  + `<rect class="pl-empty__line pl-empty__line--short" x="${x + 12}" y="${y + h - 17}" width="${w * 0.32}" height="4" rx="2"/>`;

const PLUS = (cx, cy) => `<g class="pl-empty__plus"><circle cx="${cx}" cy="${cy}" r="11"/><path d="M${cx - 5} ${cy}h10M${cx} ${cy - 5}v10"/></g>`;

const ART = {
  // a record sliding out of its sleeve
  record: `<g class="pl-empty__move pl-empty__move--slide"><circle class="pl-empty__vinyl" cx="96" cy="60" r="42"/>
    <circle class="pl-empty__groove" cx="96" cy="60" r="33"/><circle class="pl-empty__groove" cx="96" cy="60" r="25"/>
    <circle class="pl-empty__label" cx="96" cy="60" r="13"/><circle class="pl-empty__hole" cx="96" cy="60" r="2.4"/></g>
    ${BOX(16, 18, 84, 84)}${PLUS(58, 46)}`,
  // a cassette out of its case
  cassette: `<g class="pl-empty__move pl-empty__move--slide"><rect class="pl-empty__shell" x="58" y="32" width="88" height="56" rx="5"/>
    <rect class="pl-empty__sticker" x="65" y="37" width="74" height="32" rx="2"/><circle class="pl-empty__hole" cx="87" cy="56" r="6"/>
    <circle class="pl-empty__hole" cx="117" cy="56" r="6"/><rect class="pl-empty__label" x="65" y="44" width="74" height="3"/></g>
    ${BOX(16, 26, 82, 68)}${PLUS(57, 52)}`,
  // a reel of tape rising out of its cardboard box
  reel: `<g class="pl-empty__move pl-empty__move--rise"><circle class="pl-empty__reel" cx="80" cy="46" r="34"/><circle class="pl-empty__wound" cx="80" cy="46" r="21"/>
    <circle class="pl-empty__hole" cx="80" cy="32" r="5"/><circle class="pl-empty__hole" cx="68" cy="53" r="5"/><circle class="pl-empty__hole" cx="92" cy="53" r="5"/>
    <circle class="pl-empty__label" cx="80" cy="46" r="4"/></g>${BOX(32, 62, 96, 48)}${PLUS(80, 86)}`,
  // a disc out of its jewel case, its rainbow catching the light
  cd: `<g class="pl-empty__move pl-empty__move--slide"><circle class="pl-empty__cd" cx="98" cy="60" r="40"/>
    <path class="pl-empty__hue pl-empty__hue--1" d="M98 60 L98 20 A40 40 0 0 1 132.6 40 Z"/><path class="pl-empty__hue pl-empty__hue--2" d="M98 60 L132.6 80 A40 40 0 0 1 98 100 Z"/>
    <circle class="pl-empty__clamp" cx="98" cy="60" r="12"/><circle class="pl-empty__hole" cx="98" cy="60" r="4.5"/></g>
    <rect class="pl-empty__case" x="16" y="20" width="82" height="80" rx="4"/><rect class="pl-empty__hinge" x="16" y="20" width="9" height="80" rx="3"/>
    ${PLUS(61, 60)}`,
  // a wax cylinder rising out of its tube
  phonograph: `<g class="pl-empty__move pl-empty__move--rise"><rect class="pl-empty__wax" x="62" y="10" width="36" height="58" rx="6"/>
    <path class="pl-empty__wax-grooves" d="M66 22h28M66 30h28M66 38h28M66 46h28M66 54h28"/></g>
    <rect class="pl-empty__box" x="54" y="50" width="52" height="62" rx="9"/><rect class="pl-empty__band" x="54" y="62" width="52" height="7"/>
    <rect class="pl-empty__line" x="64" y="86" width="32" height="4" rx="2"/>${PLUS(118, 80)}`,
  // a little set with its needle still searching for a station
  radio: `<rect class="pl-empty__box" x="26" y="26" width="108" height="76" rx="12"/><rect class="pl-empty__dial" x="38" y="38" width="84" height="18" rx="3"/>
    <g class="pl-empty__move pl-empty__move--tune"><rect class="pl-empty__needle" x="46" y="40" width="3" height="14" rx="1"/></g>
    <rect class="pl-empty__cloth" x="38" y="64" width="50" height="28" rx="3"/><path class="pl-empty__bars" d="M43 70h40M43 76h40M43 82h40M43 88h40"/>
    ${PLUS(110, 78)}<path class="pl-empty__waves" d="M118 18a10 10 0 0 1 10 10M118 10a18 18 0 0 1 18 18"/>`,
};

export function emptyArt(mode = settings.playerMode) {
  const key = mode === 'turntable' ? 'record' : mode.startsWith('radio-') ? 'radio' : ART[mode] ? mode : 'record';
  return `<svg class="pl-empty__art" viewBox="0 0 160 120" aria-hidden="true">${ART[key]}</svg>`;
}
