/** Order and narrowing of a list of tracks (favourites, a playlist). Pure: no imports, no DOM, so a test can load it as it is.
 *
 *  A list arrives in the order it was kept: favourites newest first, a playlist oldest first (`newestFirst` says which).
 *  'default' leaves that order alone, 'new' / 'old' put the latest / earliest added first, the rest sort by a field. */

export const SORT_KEYS = ['default', 'new', 'old', 'title', 'artist', 'long', 'short'];
const MAX_ARTISTS = 12; // the artist filter lists the most frequent ones; a sheet is not a place for a hundred rows

const fold = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').trim();
const collator = new Intl.Collator(['ru', 'en'], { numeric: true, sensitivity: 'base' });

/** A new array in the chosen order; equal items keep the order they had (the sort is stable). */
export function sortTracks(tracks, key, { newestFirst = false } = {}) {
  const list = tracks.slice();
  switch (key) {
    case 'new': return newestFirst ? list : list.reverse();
    case 'old': return newestFirst ? list.reverse() : list;
    case 'title': return list.sort((a, b) => collator.compare(fold(a.title), fold(b.title)));
    case 'artist': return list.sort((a, b) => collator.compare(fold(a.artist), fold(b.artist)) || collator.compare(fold(a.title), fold(b.title)));
    case 'long': return list.sort((a, b) => (b.duration || 0) - (a.duration || 0));
    case 'short': return list.sort((a, b) => (a.duration || 0) - (b.duration || 0));
    default: return list;
  }
}

/** The artists of a list, the most frequent first: [{ name, count }], at most MAX_ARTISTS. Tracks with no artist are not listed. */
export function artistsOf(tracks) {
  const count = new Map();
  for (const tr of tracks) {
    const name = String(tr.artist || '').trim();
    if (name) count.set(name, (count.get(name) || 0) + 1);
  }
  return [...count].map(([name, n]) => ({ name, count: n }))
    .sort((a, b) => b.count - a.count || collator.compare(a.name, b.name))
    .slice(0, MAX_ARTISTS);
}

/** Only the tracks of one artist (empty `artist` lets everything through). */
export const byArtist = (tracks, artist) => (artist ? tracks.filter((tr) => String(tr.artist || '').trim() === artist) : tracks);
