/**
 * player.js - Audio playback engine, Media Session API (Android Auto & Vergrendelscherm) & Sleep Timer
 */

import { favoritesManager, normalizeStation } from './favorites.js';
import { radioApi } from './radio-api.js';

export const PlaybackStatus = {
  STOPPED: 'STOPPED',
  LOADING: 'LOADING',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  ERROR: 'ERROR'
};

export class AudioPlayer {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'none';
    this.currentStation = null;
    this.status = PlaybackStatus.STOPPED;
    this.errorMessage = '';
    this.listeners = new Set();
    this.retryCount = 0;
    this.maxRetries = 3;

    // Volume beheer
    const savedVol = localStorage.getItem('novaradio_volume');
    this.volume = savedVol !== null ? parseFloat(savedVol) : 0.85;
    this.isMuted = false;
    this.audio.volume = this.volume;

    // Slaaptimer beheer
    this.sleepTimerEnd = null;
    this.sleepTimerId = null;

    // Cast integratie callback
    this.castController = null;

    this.currentStation = this.getLastStation();

    this.setupAudioListeners();
    this.setupMediaSession();
  }

  getLastStation() {
    try {
      const saved = localStorage.getItem('novaradio_last_station');
      if (saved) return normalizeStation(JSON.parse(saved));
    } catch (e) {
      console.warn(e);
    }
    const recents = favoritesManager.getRecents();
    if (recents && recents.length > 0) return normalizeStation(recents[0]);
    const favs = favoritesManager.getFavorites();
    if (favs && favs.length > 0) return normalizeStation(favs[0]);
    return null;
  }

  setupAudioListeners() {
    this.audio.addEventListener('loadstart', () => {
      this.setStatus(PlaybackStatus.LOADING);
    });

    this.audio.addEventListener('waiting', () => {
      this.setStatus(PlaybackStatus.LOADING);
    });

    this.audio.addEventListener('canplay', () => {
      if (this.status === PlaybackStatus.LOADING) {
        this.setStatus(PlaybackStatus.PLAYING);
      }
    });

    this.audio.addEventListener('playing', () => {
      this.retryCount = 0;
      this.setStatus(PlaybackStatus.PLAYING);
      this.updateMediaSessionState('playing');
    });

    this.audio.addEventListener('pause', () => {
      if (this.status !== PlaybackStatus.STOPPED) {
        this.setStatus(PlaybackStatus.PAUSED);
      }
      this.updateMediaSessionState('paused');
    });

    this.audio.addEventListener('error', (e) => {
      console.warn('Audio playback fout:', e, this.audio.error);
      this.handleStreamError();
    });
  }

  handleStreamError() {
    if (this.retryCount < this.maxRetries && this.currentStation) {
      this.retryCount++;
      console.log(`Stream herverbinden (poging ${this.retryCount}/${this.maxRetries})...`);
      setTimeout(() => {
        if (this.currentStation) {
          this.audio.src = this.currentStation.url_resolved + (this.currentStation.url_resolved.includes('?') ? '&' : '?') + '_t=' + Date.now();
          this.audio.load();
          this.audio.play().catch(e => console.error('Herverbinden mislukt:', e));
        }
      }, 1500);
    } else {
      this.errorMessage = 'Stream kan niet worden geladen of is offline';
      this.setStatus(PlaybackStatus.ERROR);
    }
  }

  async playStation(station) {
    if (!station || !station.url_resolved) return;
    station = normalizeStation(station);

    // Als we al verbonden zijn met Chromecast, stuur het naar Cast!
    if (this.castController && this.castController.isConnected()) {
      this.currentStation = station;
      favoritesManager.addRecent(station);
      radioApi.recordClick(station.stationuuid);
      this.updateMediaSession(station);
      this.castController.loadMedia(station);
      this.notify();
      return;
    }

    this.currentStation = station;
    this.errorMessage = '';
    this.retryCount = 0;
    this.setStatus(PlaybackStatus.LOADING);

    // Voeg toe aan recents, bewaar als laatst gespeeld en registreer klik
    try {
      localStorage.setItem('novaradio_last_station', JSON.stringify(station));
    } catch (e) { console.warn(e); }
    favoritesManager.addRecent(station);
    radioApi.recordClick(station.stationuuid);
    this.updateMediaSession(station);

    try {
      this.audio.src = station.url_resolved;
      this.audio.load();
      await this.audio.play();
      this.setStatus(PlaybackStatus.PLAYING);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('Autoplay of play fout:', err);
        this.errorMessage = 'Klik op Play om het afspelen te starten';
        this.setStatus(PlaybackStatus.PAUSED);
      }
    }
  }

  togglePlay() {
    if (this.castController && this.castController.isConnected()) {
      this.castController.togglePlay();
      return;
    }

    if (!this.currentStation) {
      const favs = favoritesManager.getFavorites();
      if (favs.length > 0) {
        this.playStation(favs[0]);
      }
      return;
    }

    if (this.status === PlaybackStatus.PLAYING) {
      this.audio.pause();
    } else {
      this.audio.play().catch(e => console.error(e));
    }
  }

  pause() {
    if (this.castController && this.castController.isConnected()) {
      this.castController.pause();
      return;
    }
    this.audio.pause();
  }

  stop() {
    if (this.castController && this.castController.isConnected()) {
      this.castController.stop();
      return;
    }
    this.audio.pause();
    this.audio.src = '';
    this.setStatus(PlaybackStatus.STOPPED);
    this.updateMediaSessionState('none');
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, val));
    this.isMuted = this.volume === 0;
    this.audio.volume = this.volume;
    localStorage.setItem('novaradio_volume', this.volume.toString());

    if (this.castController && this.castController.isConnected()) {
      this.castController.setVolume(this.volume);
    }
    this.notify();
  }

  toggleMute() {
    if (this.isMuted) {
      this.setVolume(this.prevVolume || 0.8);
      this.isMuted = false;
    } else {
      this.prevVolume = this.volume;
      this.setVolume(0);
      this.isMuted = true;
    }
  }

  setStatus(newStatus) {
    this.status = newStatus;
    this.notify();
  }

  // --- ANDROID AUTO & VERGRENDELSCHERM (Media Session API) ---
  setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    try {
      navigator.mediaSession.setActionHandler('play', () => this.togglePlay());
      navigator.mediaSession.setActionHandler('pause', () => this.togglePlay());
      navigator.mediaSession.setActionHandler('stop', () => this.stop());

      // Stuurknoppen in de auto: zappen door favorieten!
      navigator.mediaSession.setActionHandler('previoustrack', () => this.playPreviousFavorite());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.playNextFavorite());
    } catch (e) {
      console.warn('MediaSession actie registratie fout:', e);
    }
  }

  updateMediaSession(station) {
    if (!('mediaSession' in navigator) || !station) return;

    const defaultIcon = new URL('./icons/icon-512.png', window.location.href).href;
    const stationIcon = station.favicon && station.favicon.startsWith('http') ? station.favicon : defaultIcon;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: station.name,
      artist: station.country ? `${station.country} • Live Radio` : 'Live Radio',
      album: station.tags ? station.tags.split(',').slice(0, 3).join(', ') : 'NovaRadio',
      artwork: [
        { src: stationIcon, sizes: '96x96', type: 'image/png' },
        { src: stationIcon, sizes: '128x128', type: 'image/png' },
        { src: stationIcon, sizes: '192x192', type: 'image/png' },
        { src: stationIcon, sizes: '512x512', type: 'image/png' }
      ]
    });
  }

  updateMediaSessionState(state) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = state;
    } catch (e) {}
  }

  playNextFavorite() {
    const list = favoritesManager.getFavorites();
    if (list.length === 0) return;
    if (!this.currentStation) {
      this.playStation(list[0]);
      return;
    }

    const currentId = this.currentStation.stationuuid || this.currentStation.url_resolved;
    const currentIndex = list.findIndex(s => (s.stationuuid || s.url_resolved) === currentId);
    const nextIndex = (currentIndex + 1) % list.length;
    this.playStation(list[nextIndex]);
  }

  playPreviousFavorite() {
    const list = favoritesManager.getFavorites();
    if (list.length === 0) return;
    if (!this.currentStation) {
      this.playStation(list[0]);
      return;
    }

    const currentId = this.currentStation.stationuuid || this.currentStation.url_resolved;
    const currentIndex = list.findIndex(s => (s.stationuuid || s.url_resolved) === currentId);
    const prevIndex = (currentIndex - 1 + list.length) % list.length;
    this.playStation(list[prevIndex]);
  }

  // --- SLAAPTIMER (SLEEP TIMER) ---
  setSleepTimer(minutes) {
    if (this.sleepTimerId) {
      clearInterval(this.sleepTimerId);
      this.sleepTimerId = null;
    }

    if (!minutes || minutes <= 0) {
      this.sleepTimerEnd = null;
      this.notify();
      return;
    }

    this.sleepTimerEnd = Date.now() + minutes * 60 * 1000;
    this.sleepTimerId = setInterval(() => {
      const remaining = this.getSleepTimerRemaining();
      if (remaining <= 0) {
        clearInterval(this.sleepTimerId);
        this.sleepTimerId = null;
        this.sleepTimerEnd = null;
        this.stop();
        this.notify();
      } else {
        this.notify();
      }
    }, 1000);

    this.notify();
  }

  getSleepTimerRemaining() {
    if (!this.sleepTimerEnd) return 0;
    return Math.max(0, Math.ceil((this.sleepTimerEnd - Date.now()) / 1000));
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notify() {
    this.listeners.forEach(cb => {
      try { cb(this); } catch (e) { console.error(e); }
    });
  }
}

export const audioPlayer = new AudioPlayer();
