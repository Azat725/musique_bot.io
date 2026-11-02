import { t } from './i18n.js';
import { settings, updateSettings } from './store.js';
import { PLAYER_MODES } from './devices/index.js';
import { loadTypeface, TYPEFACES } from './fonts.js';
import { CD_COLORS, CLASSIC_SWATCH, DECK_COLORS, RECORD_COLORS, RECORDER_COLORS, REEL_COLORS, TAPE_COLORS, THEMES } from './themes.js';
import { esc, h, haptic, icon, promptName, sheet, toast } from './ui.js';

export const LOOK_KEYS = ['colorTheme','theme','themeFont','playerMode','recordColor','deckColor','tapeColor','recorderColor','cdColor','reelColor','lidColor','radioColor','radioCountry','radioDecade','radioProfileCar','radioProfileHome'];
const snapshot = () => Object.fromEntries(LOOK_KEYS.map((k) => [k, settings[k]]));
const select = (key, label, choices, value, artwork = () => '') => `<fieldset class="look-field"><legend>${esc(label)}</legend><div class="look-options" role="radiogroup" aria-label="${esc(label)}">${choices.map(([k, text]) => `<button type="button" class="look-option ${k === value ? 'is-selected' : ''}" role="radio" aria-checked="${k === value}" data-key="${esc(key)}" data-value="${esc(k)}">${artwork(k)}<span>${esc(text)}</span></button>`).join('')}</div></fieldset>`;
const swatches = (colours) => `<span class="look-option__swatches" aria-hidden="true">${colours.map((c) => `<i style="background:${esc(c)}"></i>`).join('')}</span>`;
function colourChoices(draft) {
  const mode = draft.playerMode;
  if (mode === 'phonograph') return [];
  if (mode === 'cd') return [['cdColor', CD_COLORS, 'body_']];
  if (mode === 'reel') return [['reelColor', REEL_COLORS, 'body_']];
  if (mode === 'cassette') return [['tapeColor', TAPE_COLORS, 'tc_'], ['recorderColor', RECORDER_COLORS, 'rcd_']];
  if (mode.startsWith('radio-')) return [['radioColor', REEL_COLORS, 'body_']];
  return [['recordColor', RECORD_COLORS, 'rc_'], ...(mode === 'turntable' ? [['deckColor', DECK_COLORS, 'dc_']] : [])];
}

/** A local draft: cancelling never changes playback or writes to account sync. */
export async function openLookEditor(initial = {}) {
  const draft = {...snapshot(), ...initial};
  const content = h(`<div class="look-editor"><div class="look-preview" aria-label="${esc(t('look_preview'))}"><div class="look-preview__art"></div><b>Musique</b><span>${esc(t('look_preview'))}</span></div>
    <div data-themes></div>
    ${select('theme', t('settings_theme'), ['system','light','dark'].map((k) => [k, t('theme_' + k)]), draft.theme, (k) => swatches(k === 'system' ? ['#EFE4CF','#1A1410'] : CLASSIC_SWATCH[k].slice(0,2)))}
    ${select('playerMode', t('custom_player'), PLAYER_MODES.map((k) => [k, t('player_' + k)]), draft.playerMode, (k) => `<span class="look-option__device" aria-hidden="true">${icon('pm_' + k)}</span>`)}
    <label class="group__item"><span>${esc(t('theme_font'))}</span><input type="checkbox" class="switch" data-font ${draft.themeFont ? 'checked' : ''}></label>
    <div data-colours></div><button class="btn btn--accent" data-apply>${esc(t('look_apply'))}</button></div>`);
  function colours() {
    content.querySelector('[data-colours]').innerHTML = colourChoices(draft).map(([key, table, prefix]) => select(key, t(key === 'tapeColor' ? 'custom_tape' : key === 'recordColor' ? 'custom_record' : key === 'deckColor' ? 'custom_deck' : 'radio_color'), Object.keys(table).map((k) => [k, t(prefix + k)]), draft[key], (k) => swatches(Array.isArray(table[k]) ? table[k] : [table[k]]))).join('') + (draft.playerMode === 'cd' ? select('lidColor', t('custom_lid'), [['clear',t('lid_clear')],['silver',t('lid_silver')]], draft.lidColor, (k) => swatches([k === 'clear' ? '#e8e4dc' : '#b5b8bd'])) : '');
  }
  function themes() {
    const mode = draft.theme === 'system' ? document.documentElement.dataset.mode || 'light' : draft.theme;
    content.querySelector('[data-themes]').innerHTML = select('colorTheme', t('custom_theme'), Object.keys(THEMES).map((k) => [k, t('theme_' + k)]), draft.colorTheme, (k) => swatches(k === 'classic' ? CLASSIC_SWATCH[mode] : THEMES[k][mode].swatch));
  }
  function preview() {
    const mode = draft.theme === 'system' ? document.documentElement.dataset.mode : draft.theme;
    const palette = draft.colorTheme === 'classic' ? CLASSIC_SWATCH[mode] : THEMES[draft.colorTheme]?.[mode]?.swatch;
    const box = content.querySelector('.look-preview');
    if(draft.themeFont) loadTypeface(draft.colorTheme);
    box.style.fontFamily=draft.themeFont && TYPEFACES[draft.colorTheme] ? `'${TYPEFACES[draft.colorTheme]}', Georgia, serif` : 'var(--font-serif)';
    box.style.background = palette?.[0] || '#EFE4CF'; box.style.color = palette?.[2] || '#7B1E2B';
    const [key, table] = colourChoices(draft)[0] || [];
    const selected = table?.[draft[key]];
    box.querySelector('.look-preview__art').innerHTML = icon('pm_' + draft.playerMode);
    box.querySelector('.look-preview__art').style.color = Array.isArray(selected) ? selected[0] : selected || box.style.color;
    box.querySelector('span').textContent = `${t('theme_' + draft.colorTheme)} · ${t('player_' + draft.playerMode)}`;
  }
  content.addEventListener('change', (e) => {
    if (e.target.matches('[data-font]')) draft.themeFont = e.target.checked;
    haptic('select'); preview();
  });
  content.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-key]');
    if (!button) return;
    const { key, value } = button.dataset;
    draft[key] = value;
    button.parentElement.querySelectorAll('[role="radio"]').forEach((item) => {
      const active = item === button; item.classList.toggle('is-selected', active); item.setAttribute('aria-checked', String(active));
    });
    if (key === 'playerMode') colours();
    if (key === 'theme') themes();
    haptic('select'); preview();
  });
  content.querySelector('[data-apply]').addEventListener('click', () => content.closest('.sheet').close('apply'));
  colours(); themes(); preview();
  if (await sheet({ title: esc(t('look_title')), content, swipe: true }) === 'apply') { updateSettings(draft); haptic('success'); return true; }
  return false;
}

export async function openPresets() {
  const presets = (Array.isArray(settings.lookPresets) ? settings.lookPresets : []).slice(0, 8);
  const i = await sheet({ title: esc(t('look_presets')), items: [{ icon:'plus', label:t('look_save') }, ...presets.map((p) => ({ icon:'palette', label:p.name }))] });
  if (i === null) return;
  if (i === 0) {
    if (presets.length >= 8) { toast(t('look_limit')); return; }
    const name = await promptName({ title:t('look_save'), placeholder:t('look_name'), action:t('save'), max:32 });
    if (name) updateSettings({ lookPresets: [...presets, { name, value:snapshot() }] });
    return;
  }
  const chosen = presets[i - 1];
  const action = await sheet({ title:esc(chosen.name), items:[{icon:'check',label:t('look_apply')},{icon:'trash',label:t('delete'),danger:true}] });
  if (action === 0) {
    const value = Object.fromEntries(LOOK_KEYS.filter((k) => k in chosen.value).map((k) => [k, chosen.value[k]]));
    if (PLAYER_MODES.includes(value.playerMode) && (value.colorTheme === 'classic' || THEMES[value.colorTheme])) await openLookEditor(value);
  }
  if (action === 1) updateSettings({ lookPresets:presets.filter((p) => p !== chosen) });
}
