import { api, inTelegram } from '../api.js';
import { openLogin } from '../login.js';
import { t } from '../i18n.js';
import { heard, onSettings, radioMode, settings, updateSettings } from '../store.js';
import { openControlPanel } from '../eq.js';
import { showStories } from '../stories.js';
import { openLookEditor, openPresets } from '../customization.js';
import { clearAll, offline, usage } from '../offline.js';
import { viewScope } from '../lifecycle.js';
import { showDeviceHelp } from '../device-help.js';
import { RADIO_PROFILES, radioSettings } from '../radio.js';
import { brandMark, confirmSheet, esc, h, haptic, icon, promptName, sheet, toast } from '../ui.js';

const row = (action, title, hint = '', ic = 'right') => `<button class="group__item" data-action="${action}"><span><span class="group__name">${esc(title)}</span>${hint ? `<span class="group__hint">${esc(hint)}</span>` : ''}</span>${icon(ic,'group__chev')}</button>`;
const toggle = (key, title, hint) => `<label class="group__item"><span><span class="group__name">${esc(title)}</span><span class="group__hint">${esc(hint)}</span></span><input type="checkbox" class="switch" data-toggle="${key}" ${settings[key] ? 'checked' : ''}></label>`;

export async function render(params = {}, nav) {
  const part = params.section || '';
  const title = part ? t('settings_section_' + part) : t('nav_settings');
  const user = api.user || {};
  let contents = '';
  if (!part) {
    contents = `<section class="group">${!inTelegram ? row('account', user.kind === 'guest' ? t('account_guest') : t('account_tg',{name:user.first_name || user.username || ''}), t(user.kind === 'guest' ? 'account_guest_hint' : 'account_logout')) : ''}${row('name',t('settings_name'),settings.name || t('settings_name_off'))}</section>
      <section class="group">${['appearance','device','sound','offline'].map((key) => row('section:' + key,t('settings_section_' + key), key === 'appearance' ? t('theme_' + settings.colorTheme) : key === 'device' ? t('player_' + settings.playerMode) : key === 'sound' ? t('panel_title') : t('offline_usage',{n:usage().count,mb:Math.round(usage().bytes / 1048576)}))).join('')}</section>
      <section class="group">${row('clear',t('clear_history'))}${row('about',t('settings_about'))}</section>
      <section class="group group--lang"><div class="group__label">${esc(t('settings_language'))}</div><div class="group__item"><span>${settings.lang === 'ru' ? 'Русский' : 'English'}</span><div class="segmented segmented--mini">${['ru','en'].map((lang) => `<button data-lang="${lang}" class="${settings.lang === lang ? 'is-on' : ''}" aria-pressed="${settings.lang === lang}">${lang.toUpperCase()}</button>`).join('')}</div></div></section>`;
  } else if (part === 'appearance') {
    contents = `<section class="group">${row('look',t('look_title'),t('look_draft_hint'),'palette')}${row('presets',t('look_presets'),t('look_presets_hint'))}</section>`;
  } else if (part === 'device') {
    contents = `<section class="group">${row('look',t('custom_player'),t('player_' + settings.playerMode))}${row('help',t('device_help'),'','pm_' + settings.playerMode)}
      ${toggle('bareDeck',t('custom_bare'),t('custom_bare_hint'))}${toggle('hapticSeek',t('custom_haptic'),t('custom_haptic_hint'))}${!radioMode() ? toggle('sleeve',t('custom_sleeve'),t('custom_sleeve_hint')) : ''}
      <label class="group__item"><span>${esc(t('custom_idle'))}</span><select class="field field--compact" data-idle>${[0,10,20,40,60].map((n)=>`<option value="${n}" ${settings.idleDelay === n ? 'selected' : ''}>${esc(n ? t('idle_s',{n}) : t('idle_off'))}</option>`).join('')}</select></label></section>${radioMode() ? radioSettings() : ''}`;
  } else if (part === 'sound') {
    contents = `<section class="group">${row('panel',t('panel_title'),t('settings_sound'))}${toggle('sounds',t('settings_sounds'),t('settings_sounds_hint'))}</section>`;
  } else if (part === 'offline') {
    contents = `<section class="group">${toggle('offlineLikes',t('offline_switch'),t('offline_hint'))}${row('downloads',t('downloads_title'),t('offline_usage',{n:usage().count,mb:Math.round(usage().bytes / 1048576)}))}${row('offline-clear',t('offline_clear'))}</section>`;
  } else if (part === 'about') {
    contents = `<section class="group"><div class="group__item group__item--text"><div class="about__brand">${brandMark()}<span class="brand__name">Musique</span></div><p>${esc(t('about_text'))}</p><ul class="about__features">${[['search','about_f_search'],['vinyl','about_f_vinyl'],['shelf','about_f_library'],['eq','about_f_sound'],['palette','about_f_custom'],['radio','about_f_radio'],['send','about_f_chat']].map(([ic,key])=>`<li>${icon(ic)}<span>${esc(t(key))}</span></li>`).join('')}</ul></div>${row('stories',t('about_stories'))}</section>`;
  }
  const root = h(`<div class="view settings-view"><header class="view__head"><h1 class="view__title">${esc(title)}</h1></header>${contents}</div>`);
  const scope = viewScope(root);
  const syncToggles = () => root.querySelectorAll('[data-toggle]').forEach((input) => { input.checked = !!settings[input.dataset.toggle]; });
  scope.keep(onSettings(syncToggles));
  scope.listen(offline,'change',()=>{ const hint=root.querySelector('[data-action="downloads"] .group__hint'); if(hint) hint.textContent=t('offline_usage',{n:usage().count,mb:Math.round(usage().bytes/1048576)}); });
  root.addEventListener('change',(e)=>{
    if (e.target.dataset.toggle) { haptic('select'); updateSettings({[e.target.dataset.toggle]:e.target.checked}); }
    if (e.target.matches('[data-idle]')) updateSettings({idleDelay:Number(e.target.value)});
    if (e.target.dataset.radioSetting) {
      const profile=RADIO_PROFILES.find((p)=>p.id===e.target.value);
      updateSettings({[e.target.dataset.radioSetting]:e.target.value,...(profile?{radioCountry:profile.country,radioDecade:profile.decade}:{})});
      if(profile) root.querySelectorAll('[data-radio-setting]').forEach((select)=>{ select.value=settings[select.dataset.radioSetting]; });
    }
  });
  root.addEventListener('click',async(e)=>{
    const button=e.target.closest('[data-action], [data-lang]'); if(!button)return;
    haptic('light');
    if(button.dataset.lang){updateSettings({lang:button.dataset.lang});return;}
    const action=button.dataset.action;
    try {
      if(action.startsWith('section:')) nav.push('settings',{section:action.split(':')[1]});
      else if(action==='about') nav.push('settings',{section:'about'});
      else if(action==='look') await openLookEditor();
      else if(action==='presets') await openPresets();
      else if(action==='help') showDeviceHelp();
      else if(action==='downloads') nav.push('downloads');
      else if(action==='panel') await openControlPanel();
      else if(action==='stories') showStories();
      else if(action==='account') {
        if(user.kind==='guest') openLogin();
        else if(await confirmSheet({title:t('account_logout'),text:t('logout_confirm'),action:t('account_logout')})){api.logout();localStorage.removeItem('musique.likes');location.reload();}
      } else if(action==='name') {
        if(settings.name) {
          const choice=await sheet({title:esc(settings.name),items:[{icon:'edit',label:t('settings_name_edit')},{icon:'trash',label:t('settings_name_remove')}]});
          if(choice===null)return;
          if(choice===1){updateSettings({name:''});button.querySelector('.group__hint').textContent=t('settings_name_off');return;}
        }
        const value=await promptName({title:t('settings_name'),value:settings.name,placeholder:t('settings_name_hint'),action:t('save'),max:24});
        if(value!==null){updateSettings({name:value});button.querySelector('.group__hint').textContent=value;}
      } else if(action==='offline-clear') {
        const {count,bytes}=usage();
        if(await confirmSheet({title:t('offline_clear'),text:t('offline_clear_confirm',{n:count,mb:Math.round(bytes/1048576)}),action:t('offline_clear')})){await clearAll();toast(t('offline_cleared'),'done');}
      } else if(action==='clear' && await confirmSheet({title:t('clear_history'),text:t('confirm_clear_history'),action:t('clear_history')})) {await api.clearHistory();heard.clear();toast(t('settings_cleared'),'done');}
    } catch {toast(t('toast_error'),'error');}
  });
  root.onShow = syncToggles;
  return root;
}
