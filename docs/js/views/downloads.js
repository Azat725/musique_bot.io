import { t } from '../i18n.js';
import { settings } from '../store.js';
import { downloadList, initOffline, offline, pauseDownloads, removeDownload, retryDownloads, stopReason, syncOffline, usage } from '../offline.js';
import { viewScope } from '../lifecycle.js';
import { esc, h, haptic, icon, toast } from '../ui.js';

export async function render() {
  const root = h(`<div class="view"><header class="view__head"><h1 class="view__title">${esc(t('downloads_title'))}</h1><p data-usage role="status"></p></header>
    <div class="download-tools"><button class="btn btn--outline" data-pause></button><button class="btn btn--outline" data-retry>${esc(t('downloads_retry'))}</button></div>
    <div class="segmented" role="group">${['all','saved','pending','failed'].map((v) => `<button data-filter="${v}">${esc(t('downloads_' + v))}</button>`).join('')}</div>
    <div class="downloads-list"></div></div>`);
  const scope = viewScope(root), list = root.querySelector('.downloads-list');
  let filter = 'all';
  function draw() {
    const state = usage();
    root.querySelector('[data-usage]').textContent = t('offline_usage', { n: state.count, mb: Math.round(state.bytes / 1048576) }) + (stopReason() ? ' · ' + t('downloads_' + stopReason()) : '');
    root.querySelector('[data-pause]').textContent = t(settings.downloadsPaused ? 'downloads_resume' : 'downloads_pause');
    root.querySelectorAll('[data-filter]').forEach((b) => { b.classList.toggle('is-on', b.dataset.filter === filter); b.setAttribute('aria-pressed', b.dataset.filter === filter); });
    const tracks = downloadList().filter((tr) => filter === 'all' || tr.status === filter || (filter === 'pending' && ['pending','downloading'].includes(tr.status)));
    // Preserve focused controls while percentages tick.
    const focused = list.contains(document.activeElement) ? { id: document.activeElement.closest('[data-id]')?.dataset.id, action: document.activeElement.dataset.action } : null;
    list.replaceChildren(...tracks.map((tr) => h(`<div class="download-row" data-id="${esc(tr.id)}"><div class="download-row__meta"><b>${esc(tr.title)}</b><small>${esc(tr.artist)}</small><span>${esc(t('download_' + tr.status))}${tr.status === 'downloading' ? ` · ${tr.percent}%` : tr.bytes ? ` · ${(tr.bytes / 1048576).toFixed(1)} MB` : ''}</span></div>
      <button class="icon-btn" data-action="${tr.status === 'saved' || tr.status === 'downloading' ? 'remove' : 'retry'}" aria-label="${esc(t(tr.status === 'saved' || tr.status === 'downloading' ? 'downloads_remove' : 'retry'))}">${icon(tr.status === 'saved' || tr.status === 'downloading' ? 'trash' : 'repeat')}</button></div>`)));
    if (!tracks.length) list.append(h(`<p class="empty__text">${esc(t('downloads_empty'))}</p>`));
    if (focused?.id) list.querySelector(`[data-id="${CSS.escape(focused.id)}"] [data-action="${focused.action}"]`)?.focus({ preventScroll: true });
  }
  root.querySelector('[data-pause]').addEventListener('click', () => { haptic('select'); pauseDownloads(!settings.downloadsPaused); draw(); });
  root.querySelector('[data-retry]').addEventListener('click', () => { retryDownloads(); draw(); });
  root.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.filter; draw(); }));
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]'); if (!btn) return;
    const id = btn.closest('[data-id]').dataset.id;
    try { haptic('light'); if (btn.dataset.action === 'remove') await removeDownload(id); else retryDownloads(id); draw(); }
    catch { toast(t('toast_error'), 'error'); }
  });
  scope.listen(offline, 'change', draw);
  await initOffline(); syncOffline(); draw(); root.onShow = draw;
  return root;
}
