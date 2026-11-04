import { api, inTelegram } from '../api.js';
import { openLogin } from '../login.js';
import { t } from '../i18n.js';
import { heard, onSettings, phonoMode, radioMode, settings, updateSettings } from '../store.js';
import { PLAYER_MODES } from '../devices/index.js';
import { openControlPanel } from '../eq.js';
import { openSupport, showStories } from '../stories.js';
import { openPresets } from '../customization.js';
import { clearAll, offline, savingId, stopReason, usage } from '../offline.js';
import { viewScope } from '../lifecycle.js';
import { showDeviceHelp } from '../device-help.js';
import { openReceivers, receiver, receiverArt } from '../radio.js';
import { CD_COLORS, CLASSIC_SWATCH, DECK_COLORS, RECORDER_COLORS, RECORD_COLORS, REEL_COLORS, TAPE_COLORS, THEMES } from '../themes.js';
import { brandMark, confirmSheet, esc, h, haptic, icon, promptName, sheet, tg, toast } from '../ui.js';

/** Settings: one page, everything on it applies the moment it is touched (the app around it is the preview).
 *  Only "About" opens a page of its own. */

const NUMERIC = new Set(['vinylNoise', 'idleDelay']);
let playerScroll = 0; // the strip of players keeps its place when choosing one re-renders the screen

const hint = (text, attr = '') => `<span class="group__hint" ${attr}>${esc(text)}</span>`;
const text = (name, sub = '', attr = '') => `<span class="group__text"><span class="group__name">${esc(name)}</span>${sub || attr ? hint(sub, attr) : ''}</span>`;
const row = (action, name, sub = '', extra = '', attr = '') =>
  `<button class="group__item" data-action="${action}">${extra}${text(name, sub, attr)}${icon('right', 'group__chev')}</button>`;
const toggle = (key, name, sub) =>
  `<label class="group__item">${text(name, sub)}<input type="checkbox" class="switch" data-toggle="${key}" ${settings[key] ? 'checked' : ''}></label>`;
const danger = (action, name) => `<button class="group__item group__item--danger" data-action="${action}">${esc(name)}</button>`;
const group = (label, body, note = '') =>
  `<section class="group">${label ? `<h2 class="group__label">${esc(label)}</h2>` : ''}<div class="group__card">${body}</div>${note ? `<p class="group__note">${esc(note)}</p>` : ''}</section>`;

function segmented(name, options, value) {
  const dense = options.length >= 5 || options.reduce((n, [, label]) => n + label.length, 0) > 30;
  return `<div class="segmented ${dense ? 'segmented--dense' : ''}" role="radiogroup" aria-label="${esc(t('settings_' + name) || name)}" data-name="${name}">
    ${options.map(([v, label]) => `<button role="radio" aria-checked="${v === value}" data-value="${v}" class="${v === value ? 'is-on' : ''}">${esc(label)}</button>`).join('')}
  </div>`;
}
const stacked = (name, sub, control) => `<div class="group__item group__item--stack">${text(name, sub)}${control}</div>`;

const mode = () => (document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light');
const dots = (key) => (key === 'classic' ? CLASSIC_SWATCH[mode()] : THEMES[key][mode()].swatch).map((c) => `<i style="background:${c}"></i>`).join('');

/** The players, as a strip of cards: a picture, the name and what it is, chosen in one tap. */
function playerStrip() {
  return `<div class="picks" role="radiogroup" aria-label="${esc(t('custom_player'))}" data-picks="playerMode">
    ${PLAYER_MODES.map((m) => `<button class="pick ${m === settings.playerMode ? 'is-on' : ''}" role="radio" aria-checked="${m === settings.playerMode}" data-value="${m}">
      <span class="pick__art">${icon('pm_' + m)}</span><span class="pick__name">${esc(t('player_' + m))}</span>
      <span class="pick__desc">${esc(t('pm_desc_' + m))}</span></button>`).join('')}
  </div>`;
}

/** Colour swatches of one setting: `colors` maps a key to one colour (a record) or [body, detail]. */
function swatches(key, colors, prefix, name, kind = '') {
  const value = settings[key];
  return `<div class="group__item group__item--stack">${text(name, t(prefix + value), `data-state="${key}"`)}
    <div class="swatches ${kind ? 'swatches--' + kind : ''}" role="radiogroup" aria-label="${esc(name)}" data-swatches="${key}" data-prefix="${prefix}">
      ${Object.entries(colors).map(([k, c]) => { const [a, b] = Array.isArray(c) ? c : [c, c];
        return `<button class="swatch ${kind ? 'swatch--' + kind : ''} ${k === value ? 'is-on' : ''}" role="radio" aria-checked="${k === value}"
          aria-label="${esc(t(prefix + k))}" data-value="${k}" style="--c:${a};--c2:${b}"></button>`; }).join('')}
    </div></div>`;
}

/** What can be coloured on the player in use (the phonograph comes as it is; a radio is chosen as a whole model). */
function playerColours() {
  const m = settings.playerMode;
  if (radioMode()) {
    const r = receiver();
    return `<button class="group__item" data-action="receiver" data-id="${r.id}"><span class="receiver-thumb">${receiverArt(r)}</span>
      ${text(t(m === 'radio-car' ? 'radio_garage' : 'radio_room'), `${r.name} · ${r.year} · ${t('country_' + r.country)}`)}${icon('right', 'group__chev')}</button>`;
  }
  if (m === 'phonograph') return '';
  if (m === 'cassette') return swatches('tapeColor', TAPE_COLORS, 'tc_', t('custom_tape'), 'tape') + swatches('recorderColor', RECORDER_COLORS, 'rcd_', t('custom_recorder'), 'recorder');
  if (m === 'reel') return swatches('reelColor', REEL_COLORS, 'body_', t('custom_reel_body'), 'recorder');
  if (m === 'cd') return swatches('cdColor', CD_COLORS, 'body_', t('custom_cd_body'), 'recorder')
    + stacked(t('custom_lid'), '', segmented('lidColor', [['clear', t('lid_clear')], ['silver', t('lid_silver')]], settings.lidColor));
  return swatches('recordColor', RECORD_COLORS, 'rc_', t('custom_record'))
    + (m === 'turntable' ? swatches('deckColor', DECK_COLORS, 'dc_', t('custom_deck'), 'deck') : '');
}

function themeGrid() {
  const current = THEMES[settings.colorTheme] ? settings.colorTheme : 'classic';
  return `<div class="group__item group__item--stack">${text(t('custom_theme'), current === 'classic' ? t('theme_desc_classic') : t('theme_desc_' + current), 'data-state="colorTheme"')}
    <div class="theme-grid" role="radiogroup" aria-label="${esc(t('custom_theme'))}" data-picks="colorTheme">
      ${Object.keys(THEMES).map((k) => `<button class="theme-tile ${k === current ? 'is-on' : ''}" role="radio" aria-checked="${k === current}" data-value="${k}">
        <span class="theme-card__dots">${dots(k)}</span><span class="theme-tile__name">${esc(t('theme_' + k))}</span></button>`).join('')}
    </div></div>`;
}

function soundHint() {
  if (phonoMode()) return t('panel_phono');
  const sound = radioMode() ? '' : [settings.speed === 'slow' ? t('sound_slow_tag') : settings.speed === 'fast' ? t('sound_fast_tag') : '',
    settings.reverb !== 'off' ? t('sound_reverb_tag') : ''].filter(Boolean).join(' + ');
  const eq = settings.eq.on ? `${t('eq_title')}: ${t('eq_' + settings.eq.preset)}` : t('panel_eq_off');
  return sound ? `${sound} · ${eq}` : eq;
}

function offlineHint() {
  const { count, bytes } = usage();
  const parts = [count ? t('offline_usage', { n: count, mb: Math.max(1, Math.round(bytes / 1048576)) }) : t('offline_hint')];
  if (settings.offlineLikes && savingId()) parts.push(t('offline_loading'));
  if (settings.offlineLikes && stopReason() === 'space') parts.push(t('offline_no_space'));
  return parts.join(' · ');
}

function accountRows() {
  if (inTelegram) return '';
  const u = api.user || {};
  return u.kind === 'guest'
    ? `<div class="group__item group__item--stack">${text(t('account_guest'), t('account_guest_hint'))}<button class="btn btn--accent" data-action="login">${esc(t('account_login'))}</button></div>`
    : `<div class="group__item">${text(t('account_tg', { name: u.first_name || u.username || '' }), u.username ? '@' + u.username : '')}</div>${danger('logout', t('account_logout'))}`;
}

function mainPage() {
  const { count } = usage();
  return `
    ${group(t('custom_player'), playerStrip() + playerColours(), t(radioMode() ? 'radio_settings_note' : 'custom_player_note'))}
    ${group(t('settings_look'), themeGrid()
      + stacked(t('settings_theme'), '', segmented('theme', [['system', t('theme_system')], ['light', t('theme_light')], ['dark', t('theme_dark')]], settings.theme))
      + toggle('themeFont', t('theme_font'), t('theme_font_hint'))
      + row('presets', t('look_presets'), t('look_presets_hint')))}
    ${group(t('settings_player'), toggle('bareDeck', t('custom_bare'), t('custom_bare_hint'))
      + stacked(t('custom_idle'), t('custom_idle_hint'), segmented('idleDelay', [['0', t('idle_off')], ...[10, 20, 40, 60].map((n) => [String(n), t('idle_s', { n })])], String(settings.idleDelay)))
      + toggle('hapticSeek', t('custom_haptic'), t('custom_haptic_hint'))
      + (radioMode() ? '' : toggle('sleeve', t('custom_sleeve'), t('custom_sleeve_hint')))
      + row('help', t('device_help'), t('device_help_hint')))}
    ${radioMode() ? group(t('radio_settings'), toggle('radioEra', t('radio_era'), t('radio_era_hint'))
      + (settings.playerMode === 'radio-car' ? toggle('radioRain', t('radio_rain'), t('radio_rain_hint')) + toggle('radioRoad', t('radio_road'), t('radio_road_hint')) : '')) : ''}
    ${group(t('settings_sound'), row('panel', t('panel_title'), soundHint(), '', 'data-state="panel"')
      + (settings.playerMode === 'cd' || phonoMode() ? '' : stacked(t('settings_noise'), t('settings_noise_hint'),
        segmented('vinylNoise', [['0', t('noise_off')], ['4', t('noise_vlow')], ['1', t('noise_low')], ['2', t('noise_mid')], ['3', t('noise_high')]], String(settings.vinylNoise || 0))))
      + toggle('sounds', t('settings_sounds'), t('settings_sounds_hint')))}
    ${group(t('settings_offline'), `<label class="group__item">${text(t('offline_switch'), offlineHint(), 'data-state="offline"')}<input type="checkbox" class="switch" data-offline ${settings.offlineLikes ? 'checked' : ''}></label>`
      + row('downloads', t('downloads_title'), t('downloads_hint'))
      + (count ? danger('offline-clear', t('offline_clear')) : ''))}
    ${group(t('settings_profile'), accountRows() + row('name', t('settings_name'), settings.name || t('settings_name_off'), '', 'data-state="name"') + danger('clear', t('clear_history')))}
    ${group(t('settings_language'), `<div class="group__item">${text(settings.lang === 'ru' ? 'Русский' : 'English')}
      <div class="segmented segmented--mini" role="radiogroup" aria-label="${esc(t('settings_language'))}" data-name="lang">
        ${[['ru', 'RU'], ['en', 'EN']].map(([v, l]) => `<button role="radio" aria-checked="${v === settings.lang}" aria-label="${v === 'ru' ? 'Русский' : 'English'}" data-value="${v}" class="${v === settings.lang ? 'is-on' : ''}">${l}</button>`).join('')}
      </div></div>`)}
    ${group('', row('about', t('settings_about'), t('settings_about_hint'), `<span class="group__mark">${brandMark()}</span>`))}`;
}

function aboutPage() {
  const features = [['vinyl', 'about_f_vinyl'], ['radio', 'about_f_radio'], ['steering', 'about_f_drive'], ['eq', 'about_f_sound'], ['palette', 'about_f_custom'],
    ['search', 'about_f_search'], ['shelf', 'about_f_library'], ['offline', 'about_f_offline'], ['send', 'about_f_chat']];
  return `<section class="group"><div class="group__card"><div class="group__item group__item--text">
      <div class="about__brand">${brandMark()}<span class="brand__name">Musique</span></div>
      <p>${esc(t('about_text'))}</p>
      <ul class="about__features">${features.map(([ic, key]) => `<li>${icon(ic)}<span>${esc(t(key))}</span></li>`).join('')}</ul>
      <p class="about__credit">${esc(t('about_credits'))}</p>
    </div>${row('stories', t('about_stories'))}${row('support', t('about_support'))}</div></section>`;
}

export async function render(params = {}, nav) {
  const about = params.section === 'about';
  const root = h(`<div class="view settings-view"><header class="view__head"><h1 class="view__title">${esc(t(about ? 'settings_about' : 'nav_settings'))}</h1></header>
    ${about ? aboutPage() : mainPage()}</div>`);
  const scope = viewScope(root);
  const $ = (s) => root.querySelector(s);
  const setState = (key, value) => { const el = root.querySelector(`[data-state="${key}"]`); if (el) el.textContent = value; };
  const choose = (box, btn) => box.querySelectorAll('[role="radio"]').forEach((b) => {
    const on = b === btn; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on));
  });

  const strip = $('[data-picks="playerMode"]');
  if (strip) {
    requestAnimationFrame(() => {
      strip.scrollLeft = playerScroll;
      const on = strip.querySelector('.is-on'); // never hidden off the edge
      if (on && (on.offsetLeft < strip.scrollLeft || on.offsetLeft + on.offsetWidth > strip.scrollLeft + strip.clientWidth)) strip.scrollLeft = on.offsetLeft - 16;
    });
    strip.addEventListener('scroll', () => { playerScroll = strip.scrollLeft; }, { passive: true });
  }

  // keep what another place changed (the control panel, the player's menu, another device) in sight
  const sync = () => {
    root.querySelectorAll('[data-toggle]').forEach((input) => { input.checked = !!settings[input.dataset.toggle]; });
    root.querySelectorAll('.segmented[data-name]').forEach((seg) => {
      const v = String(settings[seg.dataset.name] ?? '');
      seg.querySelectorAll('button').forEach((b) => { const on = b.dataset.value === v; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); });
    });
    const rb = $('[data-action="receiver"]'); // the receiver chosen in the garage shows at once
    if (rb && radioMode() && rb.dataset.id !== receiver().id) rb.replaceWith(h(playerColours()));
    setState('panel', soundHint());
    setState('offline', offlineHint());
    const off = $('[data-offline]'); if (off) off.checked = !!settings.offlineLikes;
  };
  scope.keep(onSettings(sync));
  scope.listen(offline, 'change', () => setState('offline', offlineHint()));

  root.addEventListener('change', async (e) => {
    const key = e.target.dataset.toggle;
    if (key) { haptic('select'); updateSettings({ [key]: e.target.checked }); return; }
    if (e.target.matches('[data-offline]')) {
      haptic('select');
      if (e.target.checked) { updateSettings({ offlineLikes: true }); return; }
      const { count, bytes } = usage();
      if (count && !await confirmSheet({ title: t('offline_switch'), text: t('offline_off_confirm', { n: count, mb: Math.round(bytes / 1048576) }), action: t('offline_clear') })) {
        e.target.checked = true; return;
      }
      updateSettings({ offlineLikes: false });
      await clearAll();
    }
  });

  root.addEventListener('click', async (e) => {
    const seg = e.target.closest('.segmented[data-name] button');
    if (seg) {
      const box = seg.parentElement, name = box.dataset.name;
      haptic('select');
      choose(box, seg);
      updateSettings({ [name]: NUMERIC.has(name) ? Number(seg.dataset.value) : seg.dataset.value });
      if (name === 'theme') root.querySelectorAll('.theme-tile').forEach((b) => { b.querySelector('.theme-card__dots').innerHTML = dots(b.dataset.value); });
      return;
    }
    const pick = e.target.closest('[data-picks] [data-value]');
    if (pick) {
      const box = pick.closest('[data-picks]'), key = box.dataset.picks;
      if (settings[key] === pick.dataset.value) return;
      haptic('select');
      choose(box, pick);
      if (key === 'colorTheme') setState('colorTheme', t(pick.dataset.value === 'classic' ? 'theme_desc_classic' : 'theme_desc_' + pick.dataset.value));
      updateSettings({ [key]: pick.dataset.value }); // a new player re-renders this screen (app.js), with its own colours
      return;
    }
    const sw = e.target.closest('[data-swatches] [data-value]');
    if (sw) {
      const box = sw.closest('[data-swatches]'), key = box.dataset.swatches;
      haptic('select');
      choose(box, sw);
      setState(key, t(box.dataset.prefix + sw.dataset.value));
      updateSettings({ [key]: sw.dataset.value });
      return;
    }
    const button = e.target.closest('[data-action]');
    if (!button) return;
    haptic('light');
    const action = button.dataset.action;
    try {
      if (action === 'about') nav.push('settings', { section: 'about' });
      else if (action === 'receiver') await openReceivers();
      else if (action === 'presets') await openPresets();
      else if (action === 'help') showDeviceHelp();
      else if (action === 'downloads') nav.push('downloads');
      else if (action === 'panel') { await openControlPanel(); sync(); }
      else if (action === 'stories') showStories();
      else if (action === 'support') openSupport();
      else if (action === 'login') openLogin();
      else if (action === 'logout') {
        if (!await confirmSheet({ title: t('account_logout'), text: t('logout_confirm'), action: t('account_logout') })) return;
        api.logout();
        try { localStorage.removeItem('musique.likes'); } catch {} // the kept list was the account's
        location.reload(); // a fresh guest library in this browser
      } else if (action === 'name') {
        if (settings.name) {
          const i = await sheet({ title: esc(settings.name), items: [{ icon: 'edit', label: t('settings_name_edit') }, { icon: 'trash', label: t('settings_name_remove'), danger: true }] });
          if (i === null) return;
          if (i === 1) { updateSettings({ name: '' }); setState('name', t('settings_name_off')); return; }
        }
        const value = await promptName({ title: t('settings_name'), value: settings.name || tg?.initDataUnsafe?.user?.first_name || '',
          placeholder: t('settings_name_hint'), action: t('save'), max: 24 });
        if (value) { updateSettings({ name: value.trim().slice(0, 24) }); setState('name', settings.name); haptic('success'); }
      } else if (action === 'offline-clear') {
        const { count, bytes } = usage();
        if (await confirmSheet({ title: t('offline_clear'), text: t('offline_clear_confirm', { n: count, mb: Math.round(bytes / 1048576) }), action: t('offline_clear') })) {
          await clearAll(); button.remove(); toast(t('offline_cleared'), 'done');
        }
      } else if (action === 'clear' && await confirmSheet({ title: t('clear_history'), text: t('confirm_clear_history'), action: t('clear_history') })) {
        await api.clearHistory();
        heard.clear(); // with the history gone every track is new again
        toast(t('settings_cleared'), 'done');
      }
    } catch { toast(t('toast_error'), 'error'); }
  });
  root.onShow = sync;
  return root;
}
