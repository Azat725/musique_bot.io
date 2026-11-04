import { t } from './i18n.js';
import { settings, updateSettings } from './store.js';
import { PLAYER_MODES } from './devices/index.js';
import { THEMES } from './themes.js';
import { esc, haptic, promptName, sheet, toast } from './ui.js';

/** Everything that makes up a look: the theme and its mode, the typeface, the player and the colours of each one. */
export const LOOK_KEYS = ['colorTheme', 'theme', 'themeFont', 'playerMode', 'recordColor', 'deckColor', 'tapeColor', 'recorderColor',
  'cdColor', 'reelColor', 'lidColor', 'radioCar', 'radioHome'];
const MAX_LOOKS = 8;
const snapshot = () => Object.fromEntries(LOOK_KEYS.map((k) => [k, settings[k]]));

/** Saved looks: keep the current one under a name, put one back on in a single tap. */
export async function openPresets() {
  const presets = (Array.isArray(settings.lookPresets) ? settings.lookPresets : []).slice(0, MAX_LOOKS);
  const describe = (p) => [t('theme_' + p.value.colorTheme), t('player_' + p.value.playerMode)].join(' · ');
  const i = await sheet({ title: esc(t('look_presets')), items: [
    { icon: 'plus', label: t('look_save') },
    ...presets.map((p) => ({ icon: 'palette', label: `${p.name} — ${describe(p)}` })),
  ] });
  if (i === null) return;
  if (i === 0) {
    if (presets.length >= MAX_LOOKS) { toast(t('look_limit')); return; }
    const name = await promptName({ title: t('look_save'), placeholder: t('look_name'), action: t('save'), max: 32 });
    if (!name) return;
    updateSettings({ lookPresets: [...presets, { name: name.trim(), value: snapshot() }] });
    toast(t('look_saved'), 'done');
    return;
  }
  const chosen = presets[i - 1];
  const action = await sheet({ title: esc(chosen.name), items: [{ icon: 'check', label: t('look_apply') }, { icon: 'trash', label: t('delete'), danger: true }] });
  if (action === 0) {
    const value = Object.fromEntries(LOOK_KEYS.filter((k) => k in chosen.value).map((k) => [k, chosen.value[k]]));
    if (!PLAYER_MODES.includes(value.playerMode)) delete value.playerMode;
    if (value.colorTheme !== 'classic' && !THEMES[value.colorTheme]) delete value.colorTheme;
    updateSettings(value);
    haptic('success');
  }
  if (action === 1) updateSettings({ lookPresets: presets.filter((p) => p !== chosen) });
}
