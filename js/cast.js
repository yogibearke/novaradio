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
    this.isRequestingSession = false;

    // Hook in op globale callback vanuit index.html
    window.__initCastController = () => this.init();

    // Als de SDK al klaar is of de callback al getriggerd was
    if (window.__castApiAvailable || (window.cast && window.cast.framework && window.chrome && window.chrome.cast)) {
      this.init();
    }
  }

  init() {
    if (this.context) return;
    const { cast, chrome } = window;

    if (!cast || !cast.framework || !chrome || !chrome.cast) {
      setTimeout(() => this.init(), 150);
      return;
    }

    try {
      this.context = cast.framework.CastContext.getInstance();
      this.context.setOptions({
        receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID || 'CC1AD845',
        autoJoinPolicy: chrome.cast.AutoJoinPolicy ? chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED : 'origin_scoped',
        androidReceiverCompatible: true,
        resumeSavedSession: true
      });

      this.remotePlayer = new cast.framework.RemotePlayer();
      this.remoteController = new cast.framework.RemotePlayerController(this.remotePlayer);
      this.castState = this.context.getCastState();
      console.log('Google Cast SDK gereed. CastState:', this.castState);
      if (window.debugLog) window.debugLog('Google Cast SDK gereed. CastState: ' + this.castState, 'success');
    } catch (err) {
      console.warn('CastContext initialisatie fout:', err);
      if (window.debugLog) window.debugLog('CastContext init fout: ' + err.message, 'error');
      setTimeout(() => this.init(), 250);
      return;
    }

    this.context.addEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED, (e) => {
      this.castState = e.castState;
      if (window.debugLog) window.debugLog('CastState gewijzigd naar: ' + e.castState, 'info');
      this.notify();
    });

    this.context.addEventListener(cast.framework.CastContextEventType.SESSION_STATE_CHANGED, (e) => {
      const S = cast.framework.SessionState;
      if (window.debugLog) {
        window.debugLog('Cast sessionState: ' + e.sessionState + (e.errorCode ? ' (code=' + e.errorCode + ')' : ''), 'info');
      }

      if (e.sessionState === S.SESSION_STARTING) {
        if (window.debugLog) window.debugLog('Cast verbinden met gekozen apparaat...', 'info');
      } else if (e.sessionState === S.SESSION_START_FAILED) {
        this.isRequestingSession = false;
        if (window.debugLog) window.debugLog('Cast verbinden MISLUKT (SESSION_START_FAILED): code=' + (e.errorCode || 'onbekend'), 'error');
      } else if (e.sessionState === S.SESSION_STARTED || e.sessionState === S.SESSION_RESUMED) {
        this.isRequestingSession = false;
        const devName = this.getDeviceName() || 'Chromecast';
        if (window.debugLog) window.debugLog('Cast succesvol verbonden met: ' + devName, 'success');
        this.player.audio.pause();
        if (this.player.currentStation) this.loadMedia(this.player.currentStation);
      } else if (e.sessionState === S.SESSION_ENDED) {
        if (window.debugLog) window.debugLog('Cast-sessie beëindigd', 'warn');
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

      const idleInfo = (state === S.IDLE && this.remotePlayer.idleReason) ? (' (idle=' + this.remotePlayer.idleReason + ')') : '';
      if (window.debugLog) {
        const logType = state === S.PLAYING ? 'success' : (state === S.IDLE && this.remotePlayer.idleReason === chrome.cast.media.IdleReason.ERROR ? 'error' : 'info');
        window.debugLog('Cast remotePlayer state: ' + state + idleInfo, logType);
      }

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
    if (this.isRequestingSession) {
      if (window.debugLog) window.debugLog('requestSession() genegeerd: al een aanvraag actief', 'warn');
      return;
    }

    if (window.debugLog) window.debugLog('requestSession() aangeroepen (CastState=' + this.castState + ')', 'info');

    if (!this.context && window.cast && window.cast.framework) {
      this.init();
    }

    if (this.context) {
      if (this.isConnected()) {
        if (window.debugLog) window.debugLog('Al verbonden, sessie wordt verbroken...', 'warn');
        this.context.endCurrentSession(true);
        return;
      }

      this.isRequestingSession = true;
      const timeoutId = setTimeout(() => {
        if (this.isRequestingSession) {
          this.isRequestingSession = false;
          if (window.debugLog) window.debugLog('Cast selectie time-out na 12s: lock hersteld', 'warn');
        }
      }, 12000);

      this.context.requestSession()
        .then(() => {
          clearTimeout(timeoutId);
          this.isRequestingSession = false;
          console.log('Cast sessie geopend');
          if (window.debugLog) window.debugLog('requestSession() resolved (apparaat gekozen)', 'success');
        })
        .catch((err) => {
          clearTimeout(timeoutId);
          this.isRequestingSession = false;
          if (err === 'cancel') {
            console.log('Cast sessie selectie geannuleerd door gebruiker');
            if (window.debugLog) window.debugLog('Cast selectiedialoog gesloten (geen apparaat gekozen)', 'warn');
          } else {
            console.warn('Cast sessie mislukt of afgewezen:', err);
            const errDetail = (typeof err === 'object') ? JSON.stringify(err) : String(err);
            if (window.debugLog) window.debugLog('requestSession FOUT: ' + errDetail, 'error');
            // Bij een actieve Google Cast SDK roepen we GEEN conflicterende remote.prompt() aan
          }
        });
      return;
    }

    // Alleen als CastContext geheel niet beschikbaar is op dit platform
    this.tryRemotePlaybackPrompt();
  }

  tryRemotePlaybackPrompt() {
    if (this.player && this.player.audio && this.player.audio.remote && typeof this.player.audio.remote.prompt === 'function') {
      if (window.debugLog) window.debugLog('Audio remote.prompt() wordt geactiveerd...', 'info');
      this.player.audio.remote.prompt().then(() => {
        if (window.debugLog) window.debugLog('remote.prompt() succesvol', 'success');
      }).catch((e) => {
        console.warn('Remote playback prompt fout:', e);
        if (window.debugLog) window.debugLog('remote.prompt() fout: ' + (e.message || e), 'error');
      });
    } else {
      if (window.debugLog) window.debugLog('Geen remote.prompt() beschikbaar op dit apparaat/browser', 'warn');
      if (window.novaRadioApp && typeof window.novaRadioApp.showToast === 'function') {
        window.novaRadioApp.showToast('Cast SDK nog aan het initialiseren...');
      }
    }
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
        if (window.debugLog) window.debugLog('Eerdere Cast stream netjes stoppen voor zenderwissel...', 'info');
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
    if (window.debugLog) window.debugLog(`Cast loadMedia (${station.name}): ${mimeType} -> ${station.url_resolved}`, 'info');

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
        if (window.debugLog) window.debugLog('Cast loadMedia() geaccepteerd door receiver', 'success');
        this.player.setStatus(PlaybackStatus.PLAYING);
      },
      (err) => {
        console.error('Cast kon de stream niet laden:', err);
        const errStr = (typeof err === 'object') ? JSON.stringify(err) : String(err);
        if (window.debugLog) window.debugLog('Cast loadMedia() FOUT: ' + errStr, 'error');
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
