import { api } from './api.js';
import { plural, t } from './i18n.js';
import { invalidatePlaylists } from './store.js';
import { esc, h, haptic, sheet, toast, tg } from './ui.js';

/** A playlist shared by a link. The owner opens a link (the bot's t.me link when the server knows the bot, else the
 *  app's own address with ?pl=), sends or copies it, and can close it. Whoever opens the link is asked
 *  "add this playlist?" and gets a copy in their own library. */

const TOKEN_RE = /^[A-Za-z0-9_-]{8,40}$/;

/** The token a launch carries: ?pl=… (the bot's Open button, a browser link) or the Mini App's start parameter. */
export function pendingToken() {
  let token = '';
  try {
    const q = new URLSearchParams(location.search);
    token = q.get('pl') || '';
    if (token) { // spent: a reload must not ask again
      q.delete('pl');
      const rest = q.toString();
      history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
    }
  } catch { /* no history in this WebView: at worst it asks once more */ }
  if (!token) token = (tg?.initDataUnsafe?.start_param || '').replace(/^pl_/, '');
  return TOKEN_RE.test(token) ? token : '';
}

/** "Add this playlist?" for a link that was opened. */
export async function offerShared(token) {
  let info;
  try { info = await api.shared(token); } catch (err) { toast(t(err.message === 'http-404' ? 'shared_gone' : 'toast_error'), 'error'); return; }
  const content = h(`<div class="shared">
    <div class="shared__name">${esc(info.name)}</div>
    <div class="shared__sub">${esc(plural(info.count))}</div>
    <ul class="shared__titles">${info.titles.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
  </div>`);
  const i = await sheet({ title: esc(t('shared_title')), content, items: [{ icon: 'listPlus', label: t('shared_add') }] });
  if (i !== 0) return;
  try {
    const done = await api.importShared(token);
    invalidatePlaylists();
    haptic('success');
    toast(t('shared_added', { name: done.name }), 'done');
  } catch (err) { toast(t(err.message === 'http-404' ? 'shared_gone' : 'toast_error'), 'error'); }
}

const webLink = (token) => `${location.origin}${location.pathname}?pl=${token}`;

/** The owner's side: open the link, then send it, copy it, or close it. */
export async function sharePlaylist(id, name) {
  let link;
  try {
    const r = await api.sharePlaylist(id);
    link = r.url || webLink(r.token);
  } catch (err) { toast(t(err.message === 'http-409' ? 'share_many' : 'toast_error'), 'error'); return; }
  const content = h(`<p class="shared__note">${esc(t('share_note'))}</p>`);
  const i = await sheet({ title: esc(name), content, items: [
    { icon: 'send', label: t('share_send') },
    { icon: 'listPlus', label: t('share_copy') },
    { icon: 'close', label: t('share_stop'), danger: true },
  ] });
  if (i === 0) {
    const text = t('share_text', { name });
    if (tg?.initData && tg.openTelegramLink) tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
    else if (navigator.share) navigator.share({ title: name, text, url: link }).catch(() => {});
    else await copy(link);
  } else if (i === 1) {
    await copy(link);
  } else if (i === 2) {
    try { await api.unsharePlaylist(id); toast(t('share_stopped'), 'done'); } catch { toast(t('toast_error'), 'error'); }
  }
}

async function copy(link) {
  try { await navigator.clipboard.writeText(link); toast(t('share_copied'), 'done'); }
  catch { toast(link, 'error'); } // no clipboard here: the link itself is shown
}
