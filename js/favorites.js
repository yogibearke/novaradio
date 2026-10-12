/**
 * favorites.js - Beheer van favorieten, recent beluisterde zenders en opslag
 */

const STORAGE_KEYS = {
  FAVORITES: 'novaradio_favorites_v1',
  RECENTS: 'novaradio_recents_v1',
  SETTINGS: 'novaradio_settings_v1'
};

// Hoogwaardige standaardpresets (België & Nederland) voor de allereerste start
export const DEFAULT_PRESET_STATIONS = [
  {
    stationuuid: 'preset-stubru',
    name: 'Studio Brussel',
    url_resolved: 'https://icecast.vrtcdn.be/stubru-high.mp3',
    favicon: 'https://vrt.streamovations.be/logos/stubru.png',
    country: 'Belgium',
    tags: 'rock,alternative,indie,pop',
    codec: 'MP3',
    bitrate: 192,
    homepage: 'https://stubru.be'
  },
  {
    stationuuid: 'preset-radio1',
    name: 'VRT Radio 1',
    url_resolved: 'https://icecast.vrtcdn.be/radio1-high.mp3',
    favicon: 'https://vrt.streamovations.be/logos/radio1.png',
    country: 'Belgium',
    tags: 'news,talk,current affairs,pop',
    codec: 'MP3',
    bitrate: 192,
    homepage: 'https://radio1.be'
  },
  {
    stationuuid: 'preset-mnm',
    name: 'MNM',
    url_resolved: 'https://icecast.vrtcdn.be/mnm-high.mp3',
    favicon: 'https://vrt.streamovations.be/logos/mnm.png',
    country: 'Belgium',
    tags: 'pop,hits,dance,charts',
    codec: 'MP3',
    bitrate: 192,
    homepage: 'https://mnm.be'
  },
  {
    stationuuid: 'preset-qmusic-be',
    name: 'Qmusic België',
    url_resolved: 'https://stream.qmusic.be/qmusic/mp3',
    favicon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Qmusic_logo_2019.svg/512px-Qmusic_logo_2019.svg.png',
    country: 'Belgium',
    tags: 'pop,hits,entertainment',
    codec: 'MP3',
    bitrate: 128,
    homepage: 'https://qmusic.be'
  },
  {
    stationuuid: 'preset-joe-be',
    name: 'Joe FM',
    url_resolved: 'https://stream.joe.be/joe/mp3',
    favicon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/Joe_logo_2019.svg/512px-Joe_logo_2019.svg.png',
    country: 'Belgium',
    tags: '70s,80s,90s,classics,pop',
    codec: 'MP3',
    bitrate: 128,
    homepage: 'https://joe.be'
  },
  {
    stationuuid: 'preset-nostalgie-be',
    name: 'Nostalgie Vlaanderen',
    url_resolved: 'https://stream.nostalgie.be/nostalgie/mp3',
    favicon: 'https://play-lh.googleusercontent.com/9vD_v17Tq7p8g1zB8Z1t9xV6X3D0_H9j_G8e8f8_2Y8z_H8_2Y8z_H8=s180-rw',
    country: 'Belgium',
    tags: 'classics,retro,pop,rock',
    codec: 'MP3',
    bitrate: 128,
    homepage: 'https://nostalgie.be'
  },
  {
    stationuuid: 'preset-willy',
    name: 'Willy Radio',
    url_resolved: 'https://stream.willy.radio/willy/mp3',
    favicon: 'https://willy.radio/favicon.ico',
    country: 'Belgium',
    tags: 'rock,alternative,indie',
    codec: 'MP3',
    bitrate: 128,
    homepage: 'https://willy.radio'
  },
  {
    stationuuid: 'preset-npo-radio2',
    name: 'NPO Radio 2',
    url_resolved: 'https://icecast.omroep.nl/radio2-bb-mp3',
    favicon: 'https://assets.npo.nl/radio2/icons/apple-touch-icon.png',
    country: 'Netherlands',
    tags: 'pop,rock,classics,talk',
    codec: 'MP3',
    bitrate: 192,
    homepage: 'https://nporadio2.nl'
  },
  {
    stationuuid: 'preset-radio-538',
    name: 'Radio 538',
    url_resolved: 'https://stream.538.nl/538/mp3',
    favicon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Radio_538_logo_2019.svg/512px-Radio_538_logo_2019.svg.png',
    country: 'Netherlands',
    tags: 'hits,dance,pop,chart',
    codec: 'MP3',
    bitrate: 128,
    homepage: 'https://538.nl'
  },
  {
    stationuuid: 'preset-skyradio',
    name: 'Sky Radio',
    url_resolved: 'https://stream.skyradio.nl/skyradio/mp3',
    favicon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Sky_Radio_logo_2019.svg/512px-Sky_Radio_logo_2019.svg.png',
    country: 'Netherlands',
    tags: 'easy listening,pop,nonstop',
    codec: 'MP3',
    bitrate: 128,
    homepage: 'https://skyradio.nl'
  }
];

export class FavoritesManager {
  constructor() {
    this.listeners = new Set();
    this.init();
  }

  init() {
    const existing = localStorage.getItem(STORAGE_KEYS.FAVORITES);
    if (!existing) {
      // Eerste installatie: initialiseer met de handgeselecteerde favorieten
      this.saveFavorites(DEFAULT_PRESET_STATIONS);
    }
  }

  getFavorites() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.FAVORITES);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Fout bij laden favorieten:', e);
      return [];
    }
  }

  saveFavorites(stations) {
    try {
      localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(stations));
      this.notify();
    } catch (e) {
      console.error('Fout bij opslaan favorieten:', e);
    }
  }

  isFavorite(stationId) {
    const list = this.getFavorites();
    return list.some(s => (s.stationuuid || s.url_resolved) === stationId);
  }

  addFavorite(station) {
    if (!station) return;
    const list = this.getFavorites();
    const id = station.stationuuid || station.url_resolved;
    if (!list.some(s => (s.stationuuid || s.url_resolved) === id)) {
      list.unshift(station);
      this.saveFavorites(list);
    }
  }

  removeFavorite(stationId) {
    const list = this.getFavorites();
    const updated = list.filter(s => (s.stationuuid || s.url_resolved) !== stationId);
    this.saveFavorites(updated);
  }

  toggleFavorite(station) {
    if (!station) return false;
    const id = station.stationuuid || station.url_resolved;
    if (this.isFavorite(id)) {
      this.removeFavorite(id);
      return false;
    } else {
      this.addFavorite(station);
      return true;
    }
  }

  getRecents() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.RECENTS);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  addRecent(station) {
    if (!station) return;
    try {
      let list = this.getRecents();
      const id = station.stationuuid || station.url_resolved;
      list = list.filter(s => (s.stationuuid || s.url_resolved) !== id);
      list.unshift({ ...station, playedAt: Date.now() });
      if (list.length > 20) list.pop();
      localStorage.setItem(STORAGE_KEYS.RECENTS, JSON.stringify(list));
      this.notify();
    } catch (e) {
      console.error('Fout bij opslaan recents:', e);
    }
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notify() {
    this.listeners.forEach(cb => {
      try { cb(); } catch (err) { console.error(err); }
    });
  }

  exportJSON() {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      favorites: this.getFavorites(),
      recents: this.getRecents()
    };
    return JSON.stringify(data, null, 2);
  }

  importJSON(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (Array.isArray(data.favorites)) {
        this.saveFavorites(data.favorites);
        if (Array.isArray(data.recents)) {
          localStorage.setItem(STORAGE_KEYS.RECENTS, JSON.stringify(data.recents));
        }
        return { success: true, count: data.favorites.length };
      }
      return { success: false, error: 'Ongeldig bestandsformaat' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

export const favoritesManager = new FavoritesManager();
