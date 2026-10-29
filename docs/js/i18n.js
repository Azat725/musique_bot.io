const DICT = {
  ru: {
    nav_home: 'Главная', nav_search: 'Поиск', nav_library: 'Медиатека', nav_settings: 'Настройки',
    greet_morning: 'Доброе утро', greet_day: 'Добрый день', greet_evening: 'Добрый вечер', greet_night: 'Доброй ночи',
    home_recent: 'Недавно слушали', home_top_global: 'Мировой топ',
    home_genres: 'Жанры', see_all: 'Все', home_for_you: 'Для вас', home_popular: 'Популярное', home_empty: 'Подборки не загрузились', home_empty_text: 'Похоже, YouTube Music сейчас недоступен. Поиск по другим источникам работает.', home_trending_in: 'В тренде · {c}',
    country_RU: 'Россия', country_KZ: 'Казахстан', country_BY: 'Беларусь', country_US: 'США',
    genre_pop: 'Поп', genre_hiphop: 'Хип-хоп', genre_rock: 'Рок', genre_dance: 'Электроника', genre_latin: 'Латино', genre_jazz: 'Джаз',
    search_placeholder: 'Трек, исполнитель, альбом', search_hint: 'Найти пластинку', search_hint_sub: '',
    search_nothing: 'Ничего не найдено', search_recent: 'Вы искали', search_clear: 'Очистить', search_more: 'Другие источники', search_artists: 'Артисты', search_tracks: 'Треки',
    search_mode_all: 'Всё', search_mode_tracks: 'Треки', search_mode_artists: 'Артисты',
    sort_title: 'Порядок плейлистов', sort_new: 'Сначала новые', sort_old: 'Сначала старые', sort_most: 'Больше треков', sort_least: 'Меньше треков',
    lib_artists: 'Артисты', artists_count: 'Избранных: {n}', artists_empty: 'Добавляйте артистов кнопкой с микрофоном в их карточке',
    artist_fav: 'В избранные артисты', artist_unfav_menu: 'Убрать из избранных', toast_artist_fav: 'Артист в избранном', toast_artist_unfav: 'Артист убран из избранного',
    lib_likes: 'Избранное', lib_history: 'История', lib_playlists: 'Плейлисты', lib_new_playlist: 'Новый плейлист',
    lib_empty_playlists: 'Создайте первый плейлист — добавляйте треки через меню «⋯».',
    tracks_one: 'трек', tracks_few: 'трека', tracks_many: 'треков',
    play: 'Слушать', shuffle: 'Вперемешку', rename: 'Переименовать', delete: 'Удалить',
    playlist_delete_confirm: 'Удалить плейлист «{name}»?', playlist_name: 'Название плейлиста',
    playlist_empty: 'Здесь пока пусто', likes_empty: 'Отмечайте треки сердцем — они появятся здесь',
    history_empty: 'Вы ещё ничего не слушали', clear_history: 'Очистить историю',
    menu_like: 'В избранное', menu_unlike: 'Убрать из избранного', menu_add_playlist: 'Добавить в плейлист',
    menu_send: 'Отправить в чат', menu_play_next: 'Играть следующим', menu_remove: 'Убрать из плейлиста', menu_artist: 'К исполнителю',
    artist_kicker: 'Исполнитель', artist_popular: 'Популярные треки', artist_albums: 'Альбомы', artist_singles: 'Синглы и EP',
    artist_related: 'Похожие исполнители', artist_about: 'Об исполнителе', artist_choose: 'Чья карточка?',
    artist_listeners: '{n} слушателей в месяц', artist_subscribers: '{n} подписчиков', album_kicker: 'Альбом', more: 'Ещё',
    cancel: 'Отмена', save: 'Сохранить', create: 'Создать',
    toast_sending: 'Отправляем трек в чат с ботом…', toast_added: 'Добавлено в «{name}»', toast_liked: 'Добавлено в избранное',
    toast_unliked: 'Удалено из избранного', toast_next: 'Сыграет следующим', toast_unavailable: 'Трек недоступен, переключаю',
    toast_error: 'Что-то пошло не так', toast_removed: 'Удалено',
    pill_playlist: 'В плейлист', pill_send: 'В чат',
    player_now: 'Сейчас играет', player_nothing: 'Ничего не играет',
    settings_appearance: 'Оформление', settings_theme: 'Тема', theme_system: 'Авто', theme_light: 'Светлая', theme_dark: 'Тёмная',
    settings_language: 'Язык', settings_sounds: 'Звук пластинки', settings_sounds_hint: 'Треск при загрузке, скретч при перемотке, щелчок иглы',
    settings_data: 'Данные', settings_about: 'О приложении', settings_sound: 'Звук', done: 'Готово',
    settings_profile: 'Профиль', settings_name: 'Имя в приветствии', settings_name_off: 'Не задано', settings_name_hint: 'Как к вам обращаться',
    settings_name_edit: 'Изменить имя', settings_name_remove: 'Убрать имя',
    settings_noise: 'Шум пластинки', settings_noise_hint: 'Тихий треск винила под музыку',
    noise_off: 'Выкл', noise_low: 'Тихо', noise_mid: 'Средне', noise_high: 'Громко',
    eq_title: 'Эквалайзер', eq_on: 'Вкл', eq_off: 'Выключен', eq_flat: 'Ровно', eq_bass: 'Бас', eq_warm: 'Тёплый винил',
    eq_vocal: 'Вокал', eq_rock: 'Рок', eq_jazz: 'Джаз', eq_electro: 'Электроника', eq_custom: 'Свой',
    eq_note: 'С эквалайзером на iPhone музыка может прерываться, если свернуть Telegram',
    about_text: 'Musique ищет музыку в YouTube Music и открытых источниках. Откройте трек на весь экран — он заиграет на виниловой пластинке.',
    settings_cleared: 'История очищена',
    no_server_title: 'Сервер недоступен', no_server_text: 'Похоже, сервер был перезапущен. Откройте Musique через кнопку меню в боте или отправьте /start.', retry: 'Повторить',
  },
  en: {
    nav_home: 'Home', nav_search: 'Search', nav_library: 'Library', nav_settings: 'Settings',
    greet_morning: 'Good morning', greet_day: 'Good afternoon', greet_evening: 'Good evening', greet_night: 'Good night',
    home_recent: 'Recently played', home_top_global: 'Global top',
    home_genres: 'Genres', see_all: 'All', home_for_you: 'For you', home_popular: 'Popular', home_empty: 'Charts did not load', home_empty_text: 'YouTube Music seems unreachable right now. Search on other sources still works.', home_trending_in: 'Trending · {c}',
    country_RU: 'Russia', country_KZ: 'Kazakhstan', country_BY: 'Belarus', country_US: 'USA',
    genre_pop: 'Pop', genre_hiphop: 'Hip-hop', genre_rock: 'Rock', genre_dance: 'Electronic', genre_latin: 'Latin', genre_jazz: 'Jazz',
    search_placeholder: 'Track, artist, album', search_hint: 'Find a record', search_hint_sub: '',
    search_nothing: 'Nothing found', search_recent: 'Recent searches', search_clear: 'Clear', search_more: 'Other sources', search_artists: 'Artists', search_tracks: 'Tracks',
    search_mode_all: 'All', search_mode_tracks: 'Tracks', search_mode_artists: 'Artists',
    sort_title: 'Sort playlists', sort_new: 'Newest first', sort_old: 'Oldest first', sort_most: 'Most tracks', sort_least: 'Fewest tracks',
    lib_artists: 'Artists', artists_count: 'Favourites: {n}', artists_empty: 'Add artists with the microphone button on their card',
    artist_fav: 'Add to favourite artists', artist_unfav_menu: 'Remove from favourites', toast_artist_fav: 'Artist added to favourites', toast_artist_unfav: 'Artist removed from favourites',
    lib_likes: 'Favourites', lib_history: 'History', lib_playlists: 'Playlists', lib_new_playlist: 'New playlist',
    lib_empty_playlists: 'Create your first playlist — add tracks via the “⋯” menu.',
    tracks_one: 'track', tracks_few: 'tracks', tracks_many: 'tracks',
    play: 'Play', shuffle: 'Shuffle', rename: 'Rename', delete: 'Delete',
    playlist_delete_confirm: 'Delete playlist “{name}”?', playlist_name: 'Playlist name',
    playlist_empty: 'Nothing here yet', likes_empty: 'Tap the heart on a track to save it here',
    history_empty: 'You haven’t listened to anything yet', clear_history: 'Clear history',
    menu_like: 'Add to favourites', menu_unlike: 'Remove from favourites', menu_add_playlist: 'Add to playlist',
    menu_send: 'Send to chat', menu_play_next: 'Play next', menu_remove: 'Remove from playlist', menu_artist: 'Go to artist',
    artist_kicker: 'Artist', artist_popular: 'Popular', artist_albums: 'Albums', artist_singles: 'Singles & EPs',
    artist_related: 'Fans also like', artist_about: 'About', artist_choose: 'Which artist?',
    artist_listeners: '{n} monthly listeners', artist_subscribers: '{n} subscribers', album_kicker: 'Album', more: 'More',
    cancel: 'Cancel', save: 'Save', create: 'Create',
    toast_sending: 'Sending the track to your chat…', toast_added: 'Added to “{name}”', toast_liked: 'Added to favourites',
    toast_unliked: 'Removed from favourites', toast_next: 'Will play next', toast_unavailable: 'Track unavailable, skipping',
    toast_error: 'Something went wrong', toast_removed: 'Removed',
    pill_playlist: 'To playlist', pill_send: 'To chat',
    player_now: 'Now playing', player_nothing: 'Nothing playing',
    settings_appearance: 'Appearance', settings_theme: 'Theme', theme_system: 'Auto', theme_light: 'Light', theme_dark: 'Dark',
    settings_language: 'Language', settings_sounds: 'Vinyl sound', settings_sounds_hint: 'Crackle while loading, scratch when scrubbing, needle click',
    settings_data: 'Data', settings_about: 'About', settings_sound: 'Sound', done: 'Done',
    settings_profile: 'Profile', settings_name: 'Name in the greeting', settings_name_off: 'Not set', settings_name_hint: 'What should we call you',
    settings_name_edit: 'Change name', settings_name_remove: 'Remove name',
    settings_noise: 'Record noise', settings_noise_hint: 'Soft vinyl crackle under the music',
    noise_off: 'Off', noise_low: 'Low', noise_mid: 'Medium', noise_high: 'High',
    eq_title: 'Equalizer', eq_on: 'On', eq_off: 'Off', eq_flat: 'Flat', eq_bass: 'Bass', eq_warm: 'Warm vinyl',
    eq_vocal: 'Vocal', eq_rock: 'Rock', eq_jazz: 'Jazz', eq_electro: 'Electronic', eq_custom: 'Custom',
    eq_note: 'With the equalizer on, iPhone may pause music when Telegram is in the background',
    about_text: 'Musique finds music on YouTube Music and open sources. Open a track full screen and it plays on a vinyl record.',
    settings_cleared: 'History cleared',
    no_server_title: 'Server unavailable', no_server_text: 'The server may have restarted. Open Musique from the bot’s menu button or send /start.', retry: 'Retry',
  },
};

let lang = 'ru';

export function setLang(value) {
  lang = DICT[value] ? value : 'en';
  document.documentElement.lang = lang;
}

export function t(key, vars = {}) {
  const s = DICT[lang][key] ?? DICT.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

export function plural(n) {
  if (lang !== 'ru') return `${n} ${t(n === 1 ? 'tracks_one' : 'tracks_many')}`;
  const m10 = n % 10, m100 = n % 100;
  const key = m10 === 1 && m100 !== 11 ? 'tracks_one'
    : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'tracks_few' : 'tracks_many';
  return `${n} ${t(key)}`;
}
