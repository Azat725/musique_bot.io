import { api } from './api.js';
import { t } from './i18n.js';
import { esc, h, haptic, sheet, toast } from './ui.js';

/** Sign in with Telegram from the site: the bot gets a one-time code and asks to confirm; this window keeps asking
 *  the server until it is confirmed (or the code expires), then the page reloads with the account's library. */

const POLL_MS = 2000;

export async function openLogin() {
  let start;
  try {
    start = await api.loginStart();
  } catch {
    toast(t('login_failed'), 'error');
    return;
  }
  const content = h(`<div class="login">
    <p class="login__text">${esc(t('login_text'))}</p>
    <a class="btn btn--accent login__open" href="${esc(start.url)}" target="_blank" rel="noopener">${esc(t('login_open'))}</a>
    <p class="login__state" aria-live="polite">${esc(t('login_wait'))}</p>
  </div>`);
  const state = content.querySelector('.login__state');
  const open = content.querySelector('.login__open');
  let alive = true, timer = 0;

  const poll = async () => {
    if (!alive) return;
    try {
      const r = await api.loginPoll(start.code);
      if (!alive) return;
      if (r.status === 'ok') {
        alive = false;
        haptic('success');
        toast(t('login_done', { name: r.user?.first_name || r.user?.username || 'Telegram' }), 'done');
        setTimeout(() => location.reload(), 900); // everything (likes, library, history) comes back as the account's
        return;
      }
      if (r.status === 'expired') {
        alive = false;
        state.textContent = t('login_expired');
        open.textContent = t('login_retry');
        open.removeAttribute('href');
        open.addEventListener('click', (e) => { e.preventDefault(); content.closest('.sheet')?.close?.(); openLogin(); }, { once: true });
        return;
      }
    } catch { /* a missed beat: ask again */ }
    timer = setTimeout(poll, POLL_MS);
  };
  timer = setTimeout(poll, POLL_MS);
  await sheet({ title: esc(t('login_title')), content });
  alive = false;
  clearTimeout(timer);
}
