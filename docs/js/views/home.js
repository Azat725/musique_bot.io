import { api } from '../api.js';
import { viewScope } from '../lifecycle.js';
import { countryName, decadeOf, frequency, onAir, openReceivers, receiver, receiverArt, stations, tune } from '../radio.js';
import { t } from '../i18n.js';
import { player } from '../player.js';
import { onSettings, phonoMode, radioMode, settings } from '../store.js';
import { brandMark, cover, esc, h, haptic, icon, loader, openArtist, toast } from '../ui.js';

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
  const scope = viewScope(root);
  scope.keep(onSettings(() => { if (title.textContent !== greeting()) title.textContent = greeting(); }));
  body.append(h(loader()));

  let data; try { data = await api.home(); } catch(error) { root.dispose(); throw error; }
  body.innerHTML = '';
  const openList = (title, tracks) => () => nav.push('playlist', { kind: 'tracks', title, tracks });

  // the phonograph's own shelf: what it can play
  if (phonoMode()) {
    const shelf = h('<section class="section shelf--phono"></section>');
    body.append(shelf);
    api.phonograph().then(({ tracks }) => {
      if (!tracks?.length) return;
      const all = h(`<button class="btn btn--accent shelf__play">${icon('play')}<span>${esc(t('phono_play_all'))}</span></button>`);
      all.addEventListener('click', () => { haptic('light'); player.playQueue(tracks, 0, { shuffle: true }); });
      const sub = h(`<p class="shelf__sub">${esc(t('phono_count', { n: tracks.length }))}</p>`);
      shelf.append(sectionHead(t('phono_shelf'), openList(t('phono_shelf'), tracks)), sub, all, cards(tracks));
    }).catch(() => {});
  }

  if (radioMode()) {
    // the radio: the receiver itself, its era, and its stations as buttons; one tap tunes in.
    // It is painted again whenever the chosen receiver changes, so Home always shows the current one
    const card = h('<section class="section radio-card"></section>');
    const current = () => `${settings.playerMode}|${settings.radioCar}|${settings.radioHome}`;
    let shown = '';
    const mark = () => { const r = receiver(); card.querySelectorAll('[data-station]').forEach((b) => b.classList.toggle('is-on', b.dataset.station === (onAir() || settings.radioStation || r.country))); };
    const paint = () => {
      if (!radioMode()) return;
      shown = current();
      const r = receiver();
      card.innerHTML = `<button class="radio-card__art" data-change aria-label="${esc(t(r.kind === 'car' ? 'radio_garage' : 'radio_room'))}">${receiverArt(r)}</button>
      <div class="radio-card__meta"><span class="view__kicker">${esc(t('radio_era_of', { d: decadeOf(r) }))}</span>
        <h2 class="section__title">${esc(r.name)}</h2><p class="shelf__sub">${r.year} · ${esc(countryName(r.country, r))} · ${esc(r.unit)}</p></div>
      <div class="radio-card__stations" role="group" aria-label="${esc(t('radio_stations'))}">${stations(r).map((id) => `<button class="chip radio-chip" data-station="${id}">
        <b>${esc(id === 'mine' ? t('station_mine_short') : countryName(id, r))}</b><small>${esc(frequency(id, r).text)}</small></button>`).join('')}</div>
      <div class="radio-card__actions"><button class="btn btn--accent" data-tune>${icon('play')}<span>${esc(t('radio_start'))}</span></button>
        <button class="btn btn--outline" data-change>${esc(t('radio_change'))}</button></div>`;
      mark();
    };
    paint();
    scope.keep(onSettings(() => { if (current() !== shown) paint(); else mark(); }));
    card.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-station], [data-tune], [data-change]');
      if (!b) return;
      haptic('light');
      if (b.hasAttribute('data-change')) { await openReceivers(); return; }
      b.disabled = true;
      try { await tune(b.dataset.station || settings.radioStation || receiver().country); } finally { b.disabled = false; mark(); }
    });
    body.append(card);
  }

  if (data.recent?.length) {
    const s = h('<section class="section"></section>');
    s.append(sectionHead(t('home_recent'), openList(t('home_recent'), data.recent)), cards(data.recent));
    body.append(s);
  }

  // 'For you' comes in its own request so the page never waits for it
  const forYou = h(`<section class="section section--later">${loader()}</section>`);
  body.append(forYou);
  async function loadRecommendations() {
    forYou.setAttribute('aria-busy','true');
    try {
      const {tracks}=await api.recommend(); if(root.disposed)return;
      forYou.replaceChildren();
      if(tracks?.length) forYou.append(sectionHead(t('home_for_you'),openList(t('home_for_you'),tracks)),cards(tracks.slice(0,15)));
      else { forYou.hidden = true; maybeEmpty(); } // nothing played yet: the page's own empty state speaks instead
    } catch {
      if(root.disposed)return;
      const retry=h(`<button class="btn btn--outline">${esc(t('retry'))}</button>`);
      retry.addEventListener('click',()=>{retry.disabled=true;loadRecommendations();});
      forYou.replaceChildren(h(`<div class="empty empty--inline"><p class="empty__text">${esc(t('search_failed'))}</p></div>`),retry);
    } finally {forYou.removeAttribute('aria-busy');}
  }
  loadRecommendations();

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

  maybeEmpty();
  return root;

  function maybeEmpty() {
    if ([...body.children].some((c) => !c.hidden && !c.classList.contains('empty'))) return;
    if (body.querySelector('.empty--home')) return;
    // nothing came back (or nothing played yet): say so instead of leaving an empty page
    const empty = h(`<div class="empty empty--home">${icon('vinyl', 'empty__icon')}
      <div class="empty__title">${esc(t('home_empty'))}</div><div class="empty__text">${esc(t('home_empty_text'))}</div>
      <button class="btn btn--accent">${esc(t('nav_search'))}</button></div>`);
    empty.querySelector('button').addEventListener('click', () => document.querySelector('[data-tab="search"]')?.click());
    body.append(empty);
  }
}
