import { t } from './i18n.js';
import { settings, updateSettings } from './store.js';
import { esc, h, haptic, icon, sheet } from './ui.js';

export function showDeviceHelp() {
  const mode = settings.playerMode;
  const keys = mode === 'radio-car' ? ['help_radio', 'help_radio_tune', 'help_car', 'help_like', 'help_exit']
    : mode === 'radio-home' ? ['help_radio', 'help_radio_tune', 'help_like', 'help_exit'] : ['help_play', 'help_seek', 'help_like', 'help_exit'];
  return sheet({ title:esc(t('device_help')), content:h(`<div class="device-help">${icon('pm_' + settings.playerMode)}<ol>${keys.map((key)=>`<li>${esc(t(key))}</li>`).join('')}</ol></div>`),done:true,swipe:true });
}

export function maybeDeviceHint(root) {
  const mode = settings.playerMode;
  if (settings.deviceHints?.[mode] || root.querySelector('.device-hint')) return;
  const hint = h(`<aside class="device-hint" role="status"><span>${esc(t(mode.startsWith('radio-') ? 'help_radio' : 'help_play'))}</span><button class="link" data-help>${esc(t('device_help'))}</button><button class="icon-btn" data-dismiss aria-label="${esc(t('close'))}">${icon('close')}</button></aside>`);
  const dismiss = () => { hint.remove(); updateSettings({deviceHints:{...settings.deviceHints,[mode]:true}}); };
  hint.querySelector('[data-dismiss]').addEventListener('click',()=>{haptic('select');dismiss();});
  hint.querySelector('[data-help]').addEventListener('click',()=>{dismiss();showDeviceHelp();});
  root.append(hint);
}
