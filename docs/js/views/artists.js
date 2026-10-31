import { t } from '../i18n.js';
import { favArtistsList, toggleFavArtist } from '../store.js';
import { artistRow, esc, h, haptic, icon, sheet, toast } from '../ui.js';

/** Favourite artists, newest first. A long press offers to remove one. */
export async function render() {
  const root = h(`<div class="view">
    <header class="view__head view__head--list">
      <div class="view__kicker">${esc(t('nav_library'))}</div>
      <h1 class="view__title">${esc(t('lib_artists'))}</h1>
    </header>
    <div class="artists"></div>
  </div>`);
  const list = root.querySelector('.artists');

  async function draw() {
    const artists = await favArtistsList();
    list.innerHTML = '';
    if (!artists.length) {
      list.append(h(`<div class="empty">${icon('micFav', 'empty__icon')}<div class="empty__text">${esc(t('artists_empty'))}</div></div>`));
      return;
    }
    artists.forEach((a) => {
      const row = artistRow(a);
      let timer = 0, held = false;
      row.addEventListener('pointerdown', () => {
        held = false;
        timer = setTimeout(async () => {
          held = true;
          haptic('medium');
          const i = await sheet({ title: esc(a.name), items: [{ icon: 'trash', label: t('artist_unfav_menu'), danger: true }] });
          if (i !== 0) return;
          try { await toggleFavArtist(a); toast(t('toast_artist_unfav'), 'unlike'); } catch { toast(t('toast_error'), 'error'); }
        }, 550);
      });
      const cancel = () => clearTimeout(timer);
      row.addEventListener('pointerup', cancel);
      row.addEventListener('pointerleave', cancel);
      row.addEventListener('pointercancel', cancel);
      // after a long press the release must not also open the card
      row.addEventListener('click', (e) => { if (held) { e.stopImmediatePropagation(); held = false; } }, true);
      list.append(row);
    });
  }

  let dirty = false;
  document.addEventListener('fav-artists-changed', () => { if (root.isConnected) draw(); else dirty = true; });
  root.onShow = () => { if (dirty) { dirty = false; draw(); } };
  await draw();
  return root;
}
