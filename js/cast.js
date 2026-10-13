/**
 * cast.js - Officiële Google Cast integratie (Cast Application Framework)
 *
 * Ondersteunt dynamische audioformaten (MP3, AAC, AAC+, OGG, HLS),
 * synchrone requestSession() aanroep en volledige lifecycle-synchronisatie.
 */

import { PlaybackStatus } from './player.js';

function getStreamMimeType(station) {
  const codec = (station.codec || '').toLowerCase();
  const url = (station.url_resolved || '').toLowerCase();

  if (codec.includes('aac') || url.includes('.aac')) {
    return 'audio/aac';
  }
  if (codec.includes('ogg') || url.includes('.ogg') || url.includes('.opus')) {
    return 'audio/ogg';
  }
  if (codec.includes('flac') || url.includes('.flac')) {
    return 'audio/flac';
  }
  if (codec.includes('wav') || url.includes('.wav')) {
    return 'audio/wav';
  }
  if (codec.includes('hls') || url.includes('.m3u8')) {
    return 'application/x-mpegurl';
  }
  return 'audio/mpeg';
}

export class CastController {
  constructor(player) {
    this.player = player;
    this.player.castController = this;
    this.context = null;
    this.remotePlayer = null;
    this.remoteController = null;
    this.castState = 'NO_DEVICES_AVAILABLE';
    this.listeners = new Set();

    // Callback die de Cast SDK aanroept zodra hij geladen is
    window.__onGCastApiAvailable = (isAvailable) => {
      if (isAvailable) this.init();
    };
    if (window.cast && window.cast.framework) this.init();
  }

  init() {
    if (this.context) return;
    const { cast, chrome } = window;

    // De SDK roept de callback soms aan vóór cast.framework klaar is: even opnieuw proberen
    if (!cast || !cast.framework || !chrome || !chrome.cast) {
      setTimeout(() => this.init(), 100);
      return;
    }

    this.context = cast.framework.CastContext.getInstance();
    this.context.setOptions({
      receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
    });

    this.remotePlayer = new cast.framework.RemotePlayer();
    this.remoteController = new cast.framework.RemotePlayerController(this.remotePlayer);
    this.castState = this.context.getCastState();

    this.context.addEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED, (e) => {
      this.castState = e.castState;
      this.notify();
    });

    this.context.addEventListener(cast.framework.CastContextEventType.SESSION_STATE_CHANGED, (e) => {
      const S = cast.framework.SessionState;
      if (e.sessionState === S.SESSION_STARTED || e.sessionState === S.SESSION_RESUMED) {
        this.player.audio.pause();
        if (this.player.currentStation) this.loadMedia(this.player.currentStation);
      } else if (e.sessionState === S.SESSION_ENDED) {
        if (this.player.currentStation) {
          console.log('Cast-sessie beëindigd. Lokaal afspelen hervatten voor:', this.player.currentStation.name);
          this.player.audio.src = this.player.currentStation.url_resolved;
          this.player.audio.load();
          this.player.setStatus(PlaybackStatus.LOADING);
          if (typeof this.player.updateMediaSession === 'function') {
            this.player.updateMediaSession(this.player.currentStation);
          }
          this.player.audio.play().then(() => {
            this.player.setStatus(PlaybackStatus.PLAYING);
          }).catch((err) => {
            console.warn('Lokaal hervatten kon niet automatisch starten:', err);
            this.player.setStatus(PlaybackStatus.PAUSED);
          });
          if (window.novaRadioApp && typeof window.novaRadioApp.showToast === 'function') {
            window.novaRadioApp.showToast('Cast gestopt: lokaal hervat');
          }
        }
      }
      this.notify();
    });

    // Luister naar pauze/speel status
    this.remoteController.addEventListener(cast.framework.RemotePlayerEventType.IS_PAUSED_CHANGED, () => {
      if (!this.isConnected()) return;
      this.player.setStatus(this.remotePlayer.isPaused ? PlaybackStatus.PAUSED : PlaybackStatus.PLAYING);
    });

    // Volledige speler-levenscyclus monitoring (buffering, playing, fouten)
    this.remoteController.addEventListener(cast.framework.RemotePlayerEventType.PLAYER_STATE_CHANGED, () => {
      if (!this.isConnected()) return;
      const state = this.remotePlayer.playerState;
      const S = chrome.cast.media.PlayerState;

      if (state === S.PLAYING) {
        this.player.setStatus(PlaybackStatus.PLAYING);
      } else if (state === S.BUFFERING) {
        this.player.setStatus(PlaybackStatus.LOADING);
      } else if (state === S.PAUSED) {
        this.player.setStatus(PlaybackStatus.PAUSED);
      } else if (state === S.IDLE) {
        if (this.remotePlayer.idleReason === chrome.cast.media.IdleReason.ERROR) {
          console.warn('Chromecast speler fout op deze stream');
          this.player.errorMessage = 'Chromecast kon deze stream niet laden (probeer een ander station)';
          this.player.setStatus(PlaybackStatus.ERROR);
        }
      }
    });

    this.remoteController.addEventListener(cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED, () => {
      this.notify();
    });

    this.notify();
  }

  /** Moet synchroon vanuit een klik-handler aangeroepen worden */
  requestSession() {
    if (!this.context) {
      console.warn('Cast SDK nog niet geladen of niet ondersteund in deze browser.');
      return;
    }
    if (this.isConnected()) {
      this.context.endCurrentSession(true);
      return;
    }
    this.context.requestSession().catch((err) => {
      if (err !== 'cancel') console.warn('Cast sessie mislukt:', err);
    });
  }

  isConnected() {
    return !!(this.context && this.context.getCurrentSession());
  }

  getDeviceName() {
    const session = this.context && this.context.getCurrentSession();
    return session ? session.getCastDevice().friendlyName : '';
  }

  disconnect() {
    if (this.context && this.isConnected()) {
      this.context.endCurrentSession(true);
    }
  }

  async loadMedia(station) {
    const session = this.context && this.context.getCurrentSession();
    if (!session || !station) return;
    const { chrome } = window;

    this.player.setStatus(PlaybackStatus.LOADING);

    // 1. Schone stop van eerdere actieve stream op de Chromecast
    try {
      const activeMedia = session.getMediaSession();
      if (activeMedia) {
        console.log('Eerdere Cast-stream netjes stoppen voor wissel...');
        await new Promise((resolve) => {
          activeMedia.stop(null, () => resolve(), () => resolve());
          setTimeout(resolve, 250);
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } catch (e) {
      console.log('Geen actieve media om te stoppen:', e);
    }

    const mimeType = getStreamMimeType(station);
    console.log(`Schone stream starten op Cast (${station.name}): ${station.url_resolved} [${mimeType}]`);

    const mediaInfo = new chrome.cast.media.MediaInfo(station.url_resolved, mimeType);
    mediaInfo.streamType = chrome.cast.media.StreamType.LIVE;

    const metadata = new chrome.cast.media.MusicTrackMediaMetadata();
    metadata.title = station.name;
    metadata.artist = station.country || 'Live Radio';
    if (station.favicon && station.favicon.startsWith('http')) {
      metadata.images = [new chrome.cast.Image(station.favicon)];
    }
    mediaInfo.metadata = metadata;

    const request = new chrome.cast.media.LoadRequest(mediaInfo);
    request.autoplay = true;

    session.loadMedia(request).then(
      () => {
        this.player.setStatus(PlaybackStatus.PLAYING);
      },
      (err) => {
        console.error('Cast kon de stream niet laden:', err);
        this.player.errorMessage = 'Chromecast kon deze stream niet laden';
        this.player.setStatus(PlaybackStatus.ERROR);
      }
    );
  }

  togglePlay() { this.remoteController && this.remoteController.playOrPause(); }
  pause() { if (this.remotePlayer && !this.remotePlayer.isPaused) this.togglePlay(); }
  stop() { this.remoteController && this.remoteController.stop(); }

  setVolume(vol) {
    if (!this.remotePlayer) return;
    this.remotePlayer.volumeLevel = vol;
    this.remoteController.setVolumeLevel();
  }

  subscribe(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  notify() {
    this.listeners.forEach((cb) => { try { cb(this); } catch (e) { console.error(e); } });
  }
}
