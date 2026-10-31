import { api } from '../api.js';
import { t } from '../i18n.js';
import { player } from '../player.js';
import { onSettings, settings } from '../store.js';
import { brandMark, cover, esc, h, haptic, icon, loader, openArtist } from '../ui.js';

/** "Good morning", or "Good morning, Azat" when a name is set in Settings. */
function greeting() {
  const hr = new Date().getHours();
  const hello = t(hr < 5 ? 'greet_night' : hr < 12 ? 'greet_morning' : hr < 18 ? 'greet_day' : hr < 23 ? 'greet_evening' : 'greet_night');
  const name = (settings.name || '').trim().slice(0, 24);
  return name ? `${hello}, ${name}` : hello;
}

function cards(tracks) {
  const row = h('<div class="cards"></div>');
  tracks.forEach((tr, i) => {
    const card = h(`<button class="card">
      ${cover(tr.cover, 'card__cover', 400)}
      <span class="card__title">${esc(tr.title)}</span>
      <span class="card__artist">${esc(tr.artist)}</span>
    </button>`);
    card.addEventListener('click', (e) => {
      if (e.target.closest('.card__artist')) { openArtist(tr); return; }
      haptic('light');
      player.playQueue(tracks, i);
    });
    row.append(card);
  });
  return row;
}

function sectionHead(title, onAll) {
  const head = h(`<div class="section__head"><h2 class="section__title">${esc(title)}</h2></div>`);
  if (onAll) {
    const btn = h(`<button class="link">${esc(t('see_all'))}${icon('right')}</button>`);
    btn.addEventListener('click', onAll);
    head.append(btn);
  }
  return head;
}

export async function render(_, nav) {
  const root = h(`<div class="view">
    <header class="hero">
      <div class="brand">${brandMark()}<span class="brand__name">Musique</span></div>
      <h1 class="hero__title">${esc(greeting())}</h1>
    </header>
    <div class="home__body"></div>
  </div>`);
  const body = root.querySelector('.home__body');
  const title = root.querySelector('.hero__title');
  onSettings(() => { if (title.textContent !== greeting()) title.textContent = greeting(); });
  body.append(h(loader()));

  const data = await api.home();
  body.innerHTML = '';
  const openList = (title, tracks) => () => nav.push('playlist', { kind: 'tracks', title, tracks });

  if (data.recent?.length) {
    const s = h('<section class="section"></section>');
    s.append(sectionHead(t('home_recent'), openList(t('home_recent'), data.recent)), cards(data.recent));
    body.append(s);
  }

  // 'For you' comes in its own request so the page never waits for it
  const forYou = h('<section class="section section--later" hidden></section>');
  body.append(forYou);
  api.recommend().then(({ tracks }) => {
    if (!tracks?.length) return;
    forYou.append(sectionHead(t('home_for_you'), openList(t('home_for_you'), tracks)), cards(tracks.slice(0, 15)));
    forYou.hidden = false;
  }).catch(() => {});

  if (data.genres?.length) {
    const s = h('<section class="section"></section>');
    s.append(sectionHead(t('home_genres')));
    const grid = h('<div class="genres"></div>');
    data.genres.forEach((g, i) => {
      const title = t('genre_' + g.key);
      const tile = h(`<button class="genre genre--${i % 3}"><span>${esc(title)}</span></button>`);
      tile.addEventListener('click', () => nav.push('playlist', { kind: 'yt', id: g.id, title }));
      grid.append(tile);
    });
    s.append(grid);
    body.append(s);
  }

  if (!body.children.length || [...body.children].every((c) => c.hidden)) {
    // nothing came back: say so instead of leaving an empty page
    const empty = h(`<div class="empty">${icon('vinyl', 'empty__icon')}
      <div class="empty__title">${esc(t('home_empty'))}</div><div class="empty__text">${esc(t('home_empty_text'))}</div>
      <button class="btn btn--accent">${esc(t('nav_search'))}</button></div>`);
    empty.querySelector('button').addEventListener('click', () => document.querySelector('[data-tab="search"]')?.click());
    body.append(empty);
  }
  return root;
}
