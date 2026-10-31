import { api, inTelegram } from '../api.js';
import { openLogin } from '../login.js';
import { t } from '../i18n.js';
import { heard, settings, updateSettings } from '../store.js';
import { openControlPanel } from '../eq.js';
import { showStories } from '../stories.js';
import { CLASSIC_SWATCH, DECK_COLORS, RECORD_COLORS, THEMES } from '../themes.js';
import { clearAll as clearDownloads, offline, savingId, stopReason, usage as savedUsage } from '../offline.js';
import { brandMark, confirmSheet, esc, h, haptic, icon, promptName, sheet, tg, toast } from '../ui.js';

const NUMERIC = new Set(['vinylNoise', 'idleDelay']); // segmented controls that store numbers

/** Four flat stripes of a theme's colours. */
function swatchDots(key) {
  const colors = key === 'classic' ? CLASSIC_SWATCH : THEMES[key].swatch;
  return colors.map((c) => `<i style="background:${c}"></i>`).join('');
}

/** Colour themes as cards; a tap applies the theme at once, so the sheet itself is the preview. */
function openThemePicker() {
  const grid = h(`<div class="themes">${Object.keys(THEMES).map((key) => `
    <button class="theme-card ${key === (THEMES[settings.colorTheme] ? settings.colorTheme : 'classic') ? 'is-on' : ''}" data-key="${key}">
      <span class="theme-card__dots">${swatchDots(key)}</span>
      <span class="theme-card__text"><span class="theme-card__name">${esc(t('theme_' + key))}</span>
        ${key === 'classic' ? '' : `<span class="theme-card__desc">${esc(t('theme_desc_' + key))}</span>`}</span>${icon('check', 'theme-card__check')}
    </button>`).join('')}</div>`);
  grid.addEventListener('click', (e) => {
    const card = e.target.closest('[data-key]');
    if (!card) return;
    haptic('select');
    grid.querySelectorAll('.theme-card').forEach((c) => c.classList.toggle('is-on', c === card));
    updateSettings({ colorTheme: card.dataset.key });
  });
  return sheet({ title: esc(t('custom_theme')), content: grid, done: true });
}

function segmented(name, options, value) {
  return `<div class="segmented ${options.length >= 5 ? 'segmented--dense' : ''}" role="radiogroup" data-name="${name}">
    ${options.map(([v, label]) => `<button role="radio" aria-checked="${v === value}" data-value="${v}" class="${v === value ? 'is-on' : ''}">${esc(label)}</button>`).join('')}
  </div>`;
}

/** In an ordinary browser: who is listening here, and the way to sign in with Telegram (or out). */
function accountGroup() {
  const u = api.user || {};
  if (u.kind === 'guest') {
    return `<section class="group">
      <div class="group__label">${esc(t('account_title'))}</div>
      <div class="group__item group__item--stack">
        <span><span class="group__name">${esc(t('account_guest'))}</span><span class="group__hint">${esc(t('account_guest_hint'))}</span></span>
        <button class="btn btn--accent account__login" data-login>${esc(t('account_login'))}</button>
      </div>
    </section>`;
  }
  return `<section class="group">
    <div class="group__label">${esc(t('account_title'))}</div>
    <div class="group__item">
      <span><span class="group__name">${esc(t('account_tg', { name: u.first_name || u.username || '' }))}</span>
        ${u.username ? `<span class="group__hint">@${esc(u.username)}</span>` : ''}</span>
    </div>
    <button class="group__item group__item--danger" data-logout>${esc(t('account_logout'))}</button>
  </section>`;
}

export async function render() {
  const root = h(`<div class="view">
    <header class="view__head"><h1 class="view__title">${esc(t('nav_settings'))}</h1></header>
    ${inTelegram ? '' : accountGroup()}

    <section class="group">
      <div class="group__label">${esc(t('settings_profile'))}</div>
      <button class="group__item" data-name>
        <span><span class="group__name">${esc(t('settings_name'))}</span><span class="group__hint" data-name-state></span></span>${icon('right', 'group__chev')}
      </button>
    </section>

    <section class="group">
      <div class="group__label">${esc(t('settings_custom'))}</div>
      <button class="group__item" data-color-theme>
        <span class="theme-row"><span class="theme-dots" data-theme-dots></span>
          <span><span class="group__name">${esc(t('custom_theme'))}</span><span class="group__hint" data-theme-state></span></span></span>${icon('right', 'group__chev')}
      </button>
      <div class="group__item group__item--stack" data-mode-row>
        <span><span class="group__name">${esc(t('settings_theme'))}</span><span class="group__hint" data-mode-hint>${esc(t('theme_mode_hint'))}</span></span>
        ${segmented('theme', [['system', t('theme_system')], ['light', t('theme_light')], ['dark', t('theme_dark')]], settings.theme)}
      </div>
      <div class="group__item group__item--stack">
        <span class="group__name">${esc(t('custom_player'))}</span>
        ${segmented('playerMode', [['record', t('player_record')], ['turntable', t('player_turntable')]], settings.playerMode)}
      </div>
      <div class="group__item group__item--stack">
        <span><span class="group__name">${esc(t('custom_record'))}</span><span class="group__hint" data-record-state></span></span>
        <div class="swatches" role="radiogroup" aria-label="${esc(t('custom_record'))}">
          ${Object.entries(RECORD_COLORS).map(([k, c]) => `<button class="swatch ${k === settings.recordColor ? 'is-on' : ''}" role="radio"
            aria-checked="${k === settings.recordColor}" aria-label="${esc(t('rc_' + k))}" data-color="${k}" style="--c:${c}"></button>`).join('')}
        </div>
      </div>
      <div class="group__item group__item--stack" data-deck-row>
        <span><span class="group__name">${esc(t('custom_deck'))}</span><span class="group__hint" data-deck-state></span></span>
        <div class="swatches swatches--deck" role="radiogroup" aria-label="${esc(t('custom_deck'))}">
          ${Object.entries(DECK_COLORS).map(([k, [body, plate]]) => `<button class="swatch swatch--deck ${k === settings.deckColor ? 'is-on' : ''}" role="radio"
            aria-checked="${k === settings.deckColor}" aria-label="${esc(t('dc_' + k))}" data-deck="${k}" style="--c:${body};--c2:${plate}"></button>`).join('')}
        </div>
      </div>
      <div class="group__item group__item--stack">
        <span><span class="group__name">${esc(t('custom_idle'))}</span><span class="group__hint">${esc(t('custom_idle_hint'))}</span></span>
        ${segmented('idleDelay', [['0', t('idle_off')], ...[10, 20, 40, 60].map((n) => [String(n), t('idle_s', { n })])], String(settings.idleDelay))}
      </div>
      <label class="group__item">
        <span><span class="group__name">${esc(t('custom_haptic'))}</span><span class="group__hint">${esc(t('custom_haptic_hint'))}</span></span>
        <input type="checkbox" class="switch" data-haptic-seek ${settings.hapticSeek ? 'checked' : ''}>
      </label>
      <label class="group__item">
        <span><span class="group__name">${esc(t('custom_sleeve'))}</span><span class="group__hint">${esc(t('custom_sleeve_hint'))}</span></span>
        <input type="checkbox" class="switch" data-sleeve ${settings.sleeve ? 'checked' : ''}>
      </label>
    </section>

    <section class="group">
      <div class="group__label">${esc(t('settings_sound'))}</div>
      <button class="group__item" data-eq>
        <span><span class="group__name">${esc(t('panel_title'))}</span><span class="group__hint" data-eq-state></span></span>${icon('right', 'group__chev')}
      </button>
      <div class="group__item group__item--stack">
        <span><span class="group__name">${esc(t('settings_noise'))}</span><span class="group__hint">${esc(t('settings_noise_hint'))}</span></span>
        ${segmented('vinylNoise', [['0', t('noise_off')], ['4', t('noise_vlow')], ['1', t('noise_low')], ['2', t('noise_mid')], ['3', t('noise_high')]], String(settings.vinylNoise || 0))}
      </div>
      <label class="group__item">
        <span><span class="group__name">${esc(t('settings_sounds'))}</span><span class="group__hint">${esc(t('settings_sounds_hint'))}</span></span>
        <input type="checkbox" class="switch" data-sounds ${settings.sounds ? 'checked' : ''}>
      </label>
    </section>

    <section class="group">
      <div class="group__label">${esc(t('settings_offline'))}</div>
      <label class="group__item">
        <span><span class="group__name">${esc(t('offline_switch'))}</span><span class="group__hint" data-offline-state></span></span>
        <input type="checkbox" class="switch" data-offline ${settings.offlineLikes ? 'checked' : ''}>
      </label>
      <button class="group__item group__item--danger" data-offline-clear hidden>${esc(t('offline_clear'))}</button>
    </section>

    <section class="group">
      <div class="group__label">${esc(t('settings_data'))}</div>
      <button class="group__item group__item--danger" data-clear>${esc(t('clear_history'))}</button>
    </section>

    <section class="group">
      <div class="group__label">${esc(t('settings_about'))}</div>
      <div class="group__item group__item--text">
        <div class="about__brand">${brandMark()}<span class="brand__name">Musique</span></div>
        <p>${esc(t('about_text'))}</p>
        <ul class="about__features">
          ${[['search', 'about_f_search'], ['vinyl', 'about_f_vinyl'], ['shelf', 'about_f_library'], ['eq', 'about_f_sound'], ['palette', 'about_f_custom'], ['send', 'about_f_chat']]
            .map(([ic, key]) => `<li>${icon(ic)}<span>${esc(t(key))}</span></li>`).join('')}
        </ul>
      </div>
      <button class="group__item" data-stories>
        <span class="group__name">${esc(t('about_stories'))}</span>${icon('right', 'group__chev')}
      </button>
    </section>

    <section class="group group--lang">
      <div class="group__label">${esc(t('settings_language'))}</div>
      <div class="group__item">
        <span class="group__name">${settings.lang === 'ru' ? 'Русский' : 'English'}</span>
        <div class="segmented segmented--mini" role="radiogroup" data-name="lang">
          ${[['ru', 'RU'], ['en', 'EN']].map(([v, label]) => `<button role="radio" aria-checked="${v === settings.lang}" aria-label="${v === 'ru' ? 'Русский' : 'English'}"
            data-value="${v}" class="${v === settings.lang ? 'is-on' : ''}">${label}</button>`).join('')}
        </div>
      </div>
    </section>
  </div>`);

  root.querySelector('[data-login]')?.addEventListener('click', () => { haptic('light'); openLogin(); });
  root.querySelector('[data-logout]')?.addEventListener('click', async () => {
    if (!await confirmSheet({ title: t('account_logout'), text: t('logout_confirm'), action: t('account_logout') })) return;
    api.logout();
    try { localStorage.removeItem('musique.likes'); } catch {} // the kept list was the account's
    location.reload(); // a fresh guest library in this browser
  });

  root.querySelectorAll('.segmented').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      haptic('select');
      const value = NUMERIC.has(seg.dataset.name) ? Number(btn.dataset.value) : btn.dataset.value;
      seg.querySelectorAll('button').forEach((b) => { b.classList.toggle('is-on', b === btn); b.setAttribute('aria-checked', b === btn); });
      updateSettings({ [seg.dataset.name]: value });
      if (seg.dataset.name === 'playerMode') syncDeck();
    });
  });
  root.querySelector('[data-sounds]').addEventListener('change', (e) => {
    haptic('select');
    updateSettings({ sounds: e.target.checked });
  });
  root.querySelector('[data-sleeve]').addEventListener('change', (e) => {
    haptic('select');
    updateSettings({ sleeve: e.target.checked });
  });
  root.querySelector('[data-haptic-seek]').addEventListener('change', (e) => {
    updateSettings({ hapticSeek: e.target.checked });
    haptic('select');
  });

  // ---------- customization ----------
  const syncThemeRow = () => {
    const key = THEMES[settings.colorTheme] ? settings.colorTheme : 'classic';
    root.querySelector('[data-theme-state]').textContent = t('theme_' + key);
    root.querySelector('[data-theme-dots]').innerHTML = swatchDots(key);
    // Auto / Light / Dark only shapes the classic theme
    root.querySelector('[data-mode-row]').classList.toggle('is-muted', key !== 'classic');
  };
  syncThemeRow();
  root.querySelector('[data-color-theme]').addEventListener('click', async () => {
    haptic('light');
    await openThemePicker();
    syncThemeRow();
  });
  // the turntable colour matters only in the turntable view: dimmed otherwise
  const deckRow = root.querySelector('[data-deck-row]');
  const deckState = root.querySelector('[data-deck-state]');
  const syncDeck = () => {
    deckState.textContent = settings.playerMode === 'turntable' ? t('dc_' + settings.deckColor) : t('custom_deck_hint');
    deckRow.classList.toggle('is-muted', settings.playerMode !== 'turntable');
  };
  syncDeck();
  root.querySelector('.swatches--deck').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-deck]');
    if (!btn) return;
    haptic('select');
    root.querySelectorAll('.swatch--deck').forEach((b) => { b.classList.toggle('is-on', b === btn); b.setAttribute('aria-checked', b === btn); });
    updateSettings({ deckColor: btn.dataset.deck });
    syncDeck();
  });
  const recordState = root.querySelector('[data-record-state]');
  const syncRecord = () => { recordState.textContent = t('rc_' + settings.recordColor); };
  syncRecord();
  root.querySelector('.swatches').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-color]');
    if (!btn) return;
    haptic('select');
    root.querySelectorAll('.swatch').forEach((b) => { b.classList.toggle('is-on', b === btn); b.setAttribute('aria-checked', b === btn); });
    updateSettings({ recordColor: btn.dataset.color });
    syncRecord();
  });
  // optional name for the home greeting: empty means off
  const nameState = root.querySelector('[data-name-state]');
  const syncName = () => { nameState.textContent = settings.name ? settings.name : t('settings_name_off'); };
  syncName();
  root.querySelector('[data-name]').addEventListener('click', async () => {
    haptic('light');
    if (settings.name) {
      const i = await sheet({ title: esc(settings.name), items: [{ icon: 'edit', label: t('settings_name_edit') }, { icon: 'trash', label: t('settings_name_remove'), danger: true }] });
      if (i === null) return;
      if (i === 1) { updateSettings({ name: '' }); syncName(); return; }
    }
    const value = settings.name || tg?.initDataUnsafe?.user?.first_name || '';
    const name = await promptName({ title: t('settings_name'), value, action: t('save'), placeholder: t('settings_name_hint'), max: 24 });
    if (!name) return;
    updateSettings({ name: name.trim().slice(0, 24) });
    haptic('success');
    syncName();
  });

  const eqState = root.querySelector('[data-eq-state]');
  const syncEqState = () => {
    const sound = [settings.speed === 'slow' ? t('sound_slow_tag') : settings.speed === 'fast' ? t('sound_fast_tag') : '',
      settings.reverb !== 'off' ? t('sound_reverb_tag') : ''].filter(Boolean).join(' + ');
    const eq = settings.eq.on ? `${t("eq_title").toLowerCase()}: ${t("eq_" + settings.eq.preset)}` : t("panel_eq_off");
    eqState.textContent = sound ? `${sound} · ${eq}` : eq;
  };
  syncEqState();
  // the equalizer panel also sets the record noise: show what it left
  const syncNoise = () => root.querySelectorAll('[data-name="vinylNoise"] button').forEach((b) => {
    const on = b.dataset.value === String(settings.vinylNoise || 0);
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', on);
  });
  root.querySelector('[data-eq]').addEventListener('click', async () => { haptic('light'); await openControlPanel(); syncEqState(); syncNoise(); });
  root.querySelector('[data-stories]').addEventListener('click', () => { haptic('light'); showStories(); });
  // ---------- favourites without a network ----------
  const offState = root.querySelector('[data-offline-state]');
  const offSwitch = root.querySelector('[data-offline]');
  const offClear = root.querySelector('[data-offline-clear]');
  const mb = (bytes) => Math.max(bytes ? 1 : 0, Math.round(bytes / 1048576));
  const syncOffState = () => {
    const { count, bytes } = savedUsage();
    const parts = [count ? t('offline_usage', { n: count, mb: mb(bytes) }) : t('offline_hint')];
    if (settings.offlineLikes && savingId()) parts.push(t('offline_loading'));
    if (settings.offlineLikes && stopReason() === 'space') parts.push(t('offline_no_space'));
    offState.textContent = parts.join(' · ');
    offClear.hidden = !count;
  };
  syncOffState();
  offline.addEventListener('change', () => { if (root.isConnected) syncOffState(); });
  offSwitch.addEventListener('change', async () => {
    haptic('select');
    if (offSwitch.checked) { updateSettings({ offlineLikes: true }); syncOffState(); return; }
    const { count, bytes } = savedUsage();
    if (count && !await confirmSheet({ title: t('offline_switch'), text: t('offline_off_confirm', { n: count, mb: mb(bytes) }), action: t('offline_clear') })) {
      offSwitch.checked = true;
      return;
    }
    updateSettings({ offlineLikes: false });
    await clearDownloads();
    syncOffState();
  });
  offClear.addEventListener('click', async () => {
    const { count, bytes } = savedUsage();
    if (!await confirmSheet({ title: t('offline_clear'), text: t('offline_clear_confirm', { n: count, mb: mb(bytes) }), action: t('offline_clear') })) return;
    await clearDownloads();
    toast(t('offline_cleared'), 'done');
    syncOffState();
  });

  root.querySelector('[data-clear]').addEventListener('click', async () => {
    if (!await confirmSheet({ title: t('clear_history'), text: t('confirm_clear_history'), action: t('clear_history') })) return;
    await api.clearHistory();
    heard.clear(); // with the history gone every track is new again: each comes out of its sleeve once more
    haptic('success');
    toast(t('settings_cleared'), 'done');
  });
  return root;
}
