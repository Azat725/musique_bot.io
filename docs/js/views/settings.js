import { api } from '../api.js';
import { t } from '../i18n.js';
import { settings, updateSettings } from '../store.js';
import { openEqualizer } from '../eq.js';
import { brandMark, esc, h, haptic, icon, toast } from '../ui.js';

function segmented(name, options, value) {
  return `<div class="segmented" role="radiogroup" data-name="${name}">
    ${options.map(([v, label]) => `<button role="radio" aria-checked="${v === value}" data-value="${v}" class="${v === value ? 'is-on' : ''}">${esc(label)}</button>`).join('')}
  </div>`;
}

export async function render() {
  const root = h(`<div class="view">
    <header class="view__head"><h1 class="view__title">${esc(t('nav_settings'))}</h1></header>

    <section class="group">
      <div class="group__label">${esc(t('settings_appearance'))}</div>
      <div class="group__item group__item--stack">
        <span class="group__name">${esc(t('settings_theme'))}</span>
        ${segmented('theme', [['system', t('theme_system')], ['light', t('theme_light')], ['dark', t('theme_dark')]], settings.theme)}
      </div>
      <div class="group__item group__item--stack">
        <span class="group__name">${esc(t('settings_language'))}</span>
        ${segmented('lang', [['ru', 'Русский'], ['en', 'English']], settings.lang)}
      </div>
      <label class="group__item">
        <span><span class="group__name">${esc(t('settings_sounds'))}</span><span class="group__hint">${esc(t('settings_sounds_hint'))}</span></span>
        <input type="checkbox" class="switch" data-sounds ${settings.sounds ? 'checked' : ''}>
      </label>
    </section>

    <section class="group">
      <div class="group__label">${esc(t('settings_sound'))}</div>
      <button class="group__item" data-eq>
        <span><span class="group__name">${esc(t('eq_title'))}</span><span class="group__hint" data-eq-state></span></span>${icon('right', 'group__chev')}
      </button>
      <div class="group__item group__item--stack">
        <span><span class="group__name">${esc(t('settings_noise'))}</span><span class="group__hint">${esc(t('settings_noise_hint'))}</span></span>
        ${segmented('vinylNoise', [['0', t('noise_off')], ['1', t('noise_low')], ['2', t('noise_mid')], ['3', t('noise_high')]], String(settings.vinylNoise || 0))}
      </div>
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
      </div>
    </section>
  </div>`);

  root.querySelectorAll('.segmented').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      haptic('select');
      const value = seg.dataset.name === 'vinylNoise' ? Number(btn.dataset.value) : btn.dataset.value;
      seg.querySelectorAll('button').forEach((b) => { b.classList.toggle('is-on', b === btn); b.setAttribute('aria-checked', b === btn); });
      updateSettings({ [seg.dataset.name]: value });
    });
  });
  root.querySelector('[data-sounds]').addEventListener('change', (e) => {
    haptic('select');
    updateSettings({ sounds: e.target.checked });
  });
  const eqState = root.querySelector('[data-eq-state]');
  const syncEqState = () => { eqState.textContent = settings.eq.on ? t('eq_' + settings.eq.preset) : t('eq_off'); };
  syncEqState();
  root.querySelector('[data-eq]').addEventListener('click', async () => { haptic('light'); await openEqualizer(); syncEqState(); });
  root.querySelector('[data-clear]').addEventListener('click', async () => {
    await api.clearHistory();
    haptic('success');
    toast(t('settings_cleared'));
  });
  return root;
}
