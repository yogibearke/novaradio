/**
 * app.js - Hoofdcontroller voor NovaRadio
 */

import { favoritesManager } from './favorites.js';
import { radioApi } from './radio-api.js';
import { audioPlayer, PlaybackStatus } from './player.js';
import { CastController } from './cast.js?v=6';
import { AudioVisualizer } from './visualizer.js';

class App {
  constructor() {
    this.currentTab = 'favorites';
    this.selectedCountry = 'BE';
    this.selectedGenre = '';
    this.searchQuery = '';
    this.searchDebounceTimer = null;
    this.deferredInstallPrompt = null;

    this.castController = new CastController(audioPlayer);
    this.visualizer = null;

    this.init();
  }

  init() {
    this.setupVisualizer();
    this.bindDomEvents();
    this.subscribeToManagers();
    this.renderFavorites();
    this.renderRecents();
    this.loadDiscoverStations();
    this.registerServiceWorker();
    this.setupPwaInstall();
  }

  setupVisualizer() {
    const canvas = document.getElementById('visualizerCanvas');
    if (canvas) {
      this.visualizer = new AudioVisualizer(canvas, audioPlayer);
    }
  }

  subscribeToManagers() {
    favoritesManager.subscribe(() => {
      this.renderFavorites();
      this.renderRecents();
      this.updatePlayerFavState();
      this.updateActiveCardHighlights();
    });

    audioPlayer.subscribe(() => {
      this.updatePlayerUI();
      this.updateCastUI();
      this.updateActiveCardHighlights();
    });

    this.castController.subscribe(() => {
      this.updateCastUI();
    });
  }

  bindDomEvents() {
    // Navigatie tabs (desktop & mobiel)
    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = btn.dataset.tab;
        if (tab) this.switchTab(tab);
      });
    });

    // Brand logo klik -> ga naar favorieten
    document.getElementById('brandBtn')?.addEventListener('click', () => {
      this.switchTab('favorites');
    });

    // Zoekbalk
    const searchInput = document.getElementById('searchInput');
    const searchClear = document.getElementById('searchClearBtn');
    searchInput?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.trim();
      if (searchClear) {
        searchClear.classList.toggle('active', this.searchQuery.length > 0);
      }
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = setTimeout(() => {
        if (this.searchQuery.length >= 2) {
          this.switchTab('discover');
          this.executeSearch();
        } else if (this.searchQuery.length === 0) {
          this.loadDiscoverStations();
        }
      }, 350);
    });

    searchClear?.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        this.searchQuery = '';
        searchClear.classList.remove('active');
        this.loadDiscoverStations();
      }
    });

    // Landenfilter chips
    document.querySelectorAll('#countryChips .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#countryChips .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.selectedCountry = chip.dataset.country;
        this.loadDiscoverStations();
      });
    });

    // Genre filter chips
    document.querySelectorAll('#genreChips .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#genreChips .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.selectedGenre = chip.dataset.genre || '';
        this.loadDiscoverStations();
      });
    });

    // Player controls
    document.getElementById('btnPlayPause')?.addEventListener('click', () => {
      audioPlayer.togglePlay();
    });
    document.getElementById('btnPrevStation')?.addEventListener('click', () => {
      audioPlayer.playPreviousFavorite();
    });
    document.getElementById('btnNextStation')?.addEventListener('click', () => {
      audioPlayer.playNextFavorite();
    });
    document.getElementById('btnPlayerFav')?.addEventListener('click', () => {
      if (audioPlayer.currentStation) {
        const isNowFav = favoritesManager.toggleFavorite(audioPlayer.currentStation);
        this.showToast(isNowFav ? 'Toegevoegd aan favorieten' : 'Verwijderd uit favorieten');
      }
    });

    // Volume slider & mute
    const volSlider = document.getElementById('volumeSlider');
    if (volSlider) {
      volSlider.value = audioPlayer.volume.toString();
      volSlider.addEventListener('input', (e) => {
        audioPlayer.setVolume(parseFloat(e.target.value));
      });
    }
    document.getElementById('btnMute')?.addEventListener('click', () => {
      audioPlayer.toggleMute();
      if (volSlider) volSlider.value = audioPlayer.volume.toString();
    });

    // Slaaptimer knoppen & modal
    const sleepModal = document.getElementById('sleepModal');
    document.getElementById('sleepTimerTriggerBtn')?.addEventListener('click', () => {
      sleepModal?.classList.add('open');
    });
    document.getElementById('sleepBadge')?.addEventListener('click', () => {
      sleepModal?.classList.add('open');
    });
    document.getElementById('closeSleepModalBtn')?.addEventListener('click', () => {
      sleepModal?.classList.remove('open');
    });
    document.querySelectorAll('.timer-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mins = parseInt(btn.dataset.time, 10);
        audioPlayer.setSleepTimer(mins);
        sleepModal?.classList.remove('open');
        this.showToast(`Slaaptimer ingesteld op ${mins} minuten`);
      });
    });
    document.getElementById('cancelTimerBtn')?.addEventListener('click', () => {
      audioPlayer.setSleepTimer(0);
      sleepModal?.classList.remove('open');
      this.showToast('Slaaptimer uitgeschakeld');
    });

    // Cast knoppen: synchroon requestSession() aanroepen (Chrome eist een directe klik)
    const onCastClick = () => this.castController.requestSession();
    document.getElementById('headerCastBtn')?.addEventListener('click', onCastClick);
    document.getElementById('playerCastBtn')?.addEventListener('click', onCastClick);

    // Eigen zender modal & form
    const customModal = document.getElementById('customStationModal');
    document.getElementById('addCustomStationBtn')?.addEventListener('click', () => {
      customModal?.classList.add('open');
    });
    document.getElementById('closeCustomModalBtn')?.addEventListener('click', () => {
      customModal?.classList.remove('open');
    });
    document.getElementById('customStationForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('customName')?.value.trim();
      const url = document.getElementById('customUrl')?.value.trim();
      const logo = document.getElementById('customLogo')?.value.trim();
      const genre = document.getElementById('customGenre')?.value.trim();

      if (name && url) {
        const customStation = {
          stationuuid: 'custom-' + Date.now(),
          name,
          url_resolved: url,
          favicon: logo || '',
          country: 'Eigen Zender',
          tags: genre || 'custom,radio',
          codec: 'Live',
          bitrate: 128
        };
        favoritesManager.addFavorite(customStation);
        customModal?.classList.remove('open');
        e.target.reset();
        this.showToast(`"${name}" toegevoegd aan favorieten!`);
        this.switchTab('favorites');
      }
    });

    // Sluit modals bij achtergrondklik
    window.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('open');
      }
    });

    // Export & Import favorieten
    document.getElementById('exportFavsBtn')?.addEventListener('click', () => {
      this.exportFavoritesFile();
    });
    const importFileInput = document.getElementById('importFileInput');
    document.getElementById('importFavsBtn')?.addEventListener('click', () => {
      importFileInput?.click();
    });
    importFileInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          const res = favoritesManager.importJSON(evt.target.result);
          if (res.success) {
            this.showToast(`${res.count} favorieten succesvol geïmporteerd!`);
          } else {
            this.showToast('Fout bij importeren: ' + res.error);
          }
        };
        reader.readAsText(file);
      }
    });

    // Reset presets knop
    document.getElementById('resetPresetsBtn')?.addEventListener('click', () => {
      if (confirm('Wil je de standaard Belgische en Nederlandse favorieten herstellen?')) {
        favoritesManager.init();
        this.showToast('Standaardpresets hersteld!');
      }
    });

    // Shortcut knop in lege staat
    document.getElementById('addFavShortcutBtn')?.addEventListener('click', () => {
      this.switchTab('discover');
    });
  }

  switchTab(tabId) {
    this.currentTab = tabId;

    // Update Desktop Nav
    document.querySelectorAll('.app-nav .nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.tab === tabId);
    });

    // Update Mobile Nav
    document.querySelectorAll('.mobile-bottom-nav .mobile-nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.tab === tabId);
    });

    // Update Views
    document.querySelectorAll('.view-section').forEach(sec => {
      sec.classList.remove('active');
    });
    const targetView = document.getElementById(`${tabId}View`);
    if (targetView) {
      targetView.classList.add('active');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  // --- RENDERING VAN KAARTEN ---
  createStationCard(station) {
    const card = document.createElement('div');
    card.className = 'station-card';
    const stationId = station.stationuuid || station.url_resolved;
    card.dataset.stationId = stationId;

    const isCurrentPlaying = audioPlayer.currentStation && 
      (audioPlayer.currentStation.stationuuid || audioPlayer.currentStation.url_resolved) === stationId;
    if (isCurrentPlaying) {
      card.classList.add('is-active');
    }

    const isFav = favoritesManager.isFavorite(stationId);
    const hasFavicon = station.favicon && station.favicon.startsWith('http');
    const firstLetter = (station.name || 'R').charAt(0).toUpperCase();

    card.innerHTML = `
      <div class="station-art-wrap">
        ${hasFavicon ? `
          <img class="station-art" src="${station.favicon}" alt="${station.name}" loading="lazy" onerror="this.onerror=null; this.src='./icons/icon.svg';">
        ` : `
          <div class="station-art-fallback">${firstLetter}</div>
        `}
        <div class="station-play-overlay">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="${isCurrentPlaying && audioPlayer.status === PlaybackStatus.PLAYING ? 'M6 19h4V5H6v14zm8-14v14h4V5h-4z' : 'M8 5v14l11-7z'}"></path>
          </svg>
        </div>
      </div>

      <div class="station-details">
        <span class="station-name" title="${station.name}">${station.name}</span>
        <span class="station-tags">${station.tags ? station.tags.split(',').slice(0, 3).join(', ') : (station.country || 'Radio')}</span>
        <div class="station-meta">
          <span class="badge-codec">${station.codec || 'MP3'}</span>
          ${station.bitrate ? `<span style="font-size: 0.68rem; color: var(--text-dim);">${station.bitrate}k</span>` : ''}
          <span class="badge-country">${station.country || ''}</span>
        </div>
      </div>

      <button class="btn-fav-card ${isFav ? 'favorited' : ''}" title="${isFav ? 'Verwijder uit favorieten' : 'Voeg toe aan favorieten'}" aria-label="Favoriet">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path>
        </svg>
      </button>
    `;

    // Klik op kaart speelt de radio
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-fav-card')) return;
      audioPlayer.playStation(station);
    });

    // Klik op favoriet hartje
    const favBtn = card.querySelector('.btn-fav-card');
    favBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const updatedFav = favoritesManager.toggleFavorite(station);
      this.showToast(updatedFav ? `Toegevoegd: ${station.name}` : `Verwijderd: ${station.name}`);
    });

    return card;
  }

  renderFavorites() {
    const list = document.getElementById('favoritesList');
    const empty = document.getElementById('favoritesEmptyState');
    const badge = document.getElementById('favCountBadge');
    if (!list) return;

    const favorites = favoritesManager.getFavorites();
    if (badge) badge.textContent = favorites.length.toString();

    list.innerHTML = '';
    if (favorites.length === 0) {
      if (empty) empty.style.display = 'flex';
      return;
    }

    if (empty) empty.style.display = 'none';
    favorites.forEach(station => {
      list.appendChild(this.createStationCard(station));
    });
  }

  renderRecents() {
    const list = document.getElementById('recentsList');
    const empty = document.getElementById('recentsEmptyState');
    if (!list) return;

    const recents = favoritesManager.getRecents();
    list.innerHTML = '';
    if (recents.length === 0) {
      if (empty) empty.style.display = 'flex';
      return;
    }

    if (empty) empty.style.display = 'none';
    recents.forEach(station => {
      list.appendChild(this.createStationCard(station));
    });
  }

  async loadDiscoverStations() {
    const list = document.getElementById('discoverList');
    const loading = document.getElementById('discoverLoading');
    if (!list) return;

    if (loading) loading.style.display = 'block';
    list.innerHTML = '';

    try {
      let stations = [];
      if (this.selectedGenre) {
        stations = await radioApi.getStationsByTag(this.selectedGenre, 40);
      } else if (this.selectedCountry === 'TOP') {
        stations = await radioApi.getTopStations(40);
      } else {
        stations = await radioApi.getStationsByCountry(this.selectedCountry, 40);
      }

      if (loading) loading.style.display = 'none';
      if (stations.length === 0) {
        list.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-dim); padding: 2rem;">Geen stations gevonden voor deze selectie.</div>';
        return;
      }

      stations.forEach(station => {
        list.appendChild(this.createStationCard(station));
      });
    } catch (err) {
      if (loading) loading.style.display = 'none';
      list.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--accent-red); padding: 2rem;">Fout bij ophalen van radiostations. Controleer internetverbinding.</div>`;
    }
  }

  async executeSearch() {
    const list = document.getElementById('discoverList');
    const loading = document.getElementById('discoverLoading');
    if (!list) return;

    if (loading) loading.style.display = 'block';
    list.innerHTML = '';

    try {
      const stations = await radioApi.searchStations({ name: this.searchQuery, limit: 50 });
      if (loading) loading.style.display = 'none';
      if (stations.length === 0) {
        list.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-dim); padding: 2rem;">Geen zenders gevonden voor "${this.searchQuery}".</div>`;
        return;
      }
      stations.forEach(station => {
        list.appendChild(this.createStationCard(station));
      });
    } catch (e) {
      if (loading) loading.style.display = 'none';
      list.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--accent-red); padding: 2rem;">Zoekfout opgetreden.</div>';
    }
  }

  // --- SPELER INTERFACE BIJWERKEN ---
  updatePlayerUI() {
    const playIcon = document.getElementById('playIcon');
    const pauseIcon = document.getElementById('pauseIcon');
    const statusBadge = document.getElementById('playerStatusBadge');
    const playerName = document.getElementById('playerName');
    const playerSub = document.getElementById('playerSub');
    const playerThumb = document.getElementById('playerThumb');

    const isPlaying = audioPlayer.status === PlaybackStatus.PLAYING;
    const isLoading = audioPlayer.status === PlaybackStatus.LOADING;

    if (playIcon && pauseIcon) {
      playIcon.style.display = isPlaying ? 'none' : 'block';
      pauseIcon.style.display = isPlaying ? 'block' : 'none';
    }

    if (audioPlayer.currentStation) {
      if (playerName) playerName.textContent = audioPlayer.currentStation.name;
      const defaultIcon = './icons/icon.svg';
      if (playerThumb) {
        playerThumb.src = (audioPlayer.currentStation.favicon && audioPlayer.currentStation.favicon.startsWith('http'))
          ? audioPlayer.currentStation.favicon
          : defaultIcon;
        playerThumb.onerror = () => { playerThumb.src = defaultIcon; };
      }
    }

    // Status tekst
    if (statusBadge) {
      switch (audioPlayer.status) {
        case PlaybackStatus.PLAYING:
          statusBadge.innerHTML = '<span class="pulse-dot"></span> Live Stream';
          statusBadge.style.color = 'var(--accent-green)';
          break;
        case PlaybackStatus.LOADING:
          statusBadge.innerHTML = 'Verbinden & bufferen...';
          statusBadge.style.color = 'var(--secondary)';
          break;
        case PlaybackStatus.PAUSED:
          statusBadge.innerHTML = 'Gepauzeerd';
          statusBadge.style.color = 'var(--text-dim)';
          break;
        case PlaybackStatus.ERROR:
          statusBadge.innerHTML = audioPlayer.errorMessage || 'Stream offline';
          statusBadge.style.color = 'var(--accent-red)';
          break;
        default:
          statusBadge.innerHTML = 'Klaar om te spelen';
          statusBadge.style.color = 'var(--text-dim)';
      }
    }

    // Slaaptimer weergave
    const sleepBadge = document.getElementById('sleepBadge');
    const sleepTimerText = document.getElementById('sleepTimerText');
    const remainingSecs = audioPlayer.getSleepTimerRemaining();
    if (sleepBadge && sleepTimerText) {
      if (remainingSecs > 0) {
        sleepBadge.classList.add('active');
        const mins = Math.floor(remainingSecs / 60);
        const secs = remainingSecs % 60;
        sleepTimerText.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
      } else {
        sleepBadge.classList.remove('active');
      }
    }

    this.updatePlayerFavState();
  }

  updatePlayerFavState() {
    const btn = document.getElementById('btnPlayerFav');
    const svg = document.getElementById('playerFavIcon');
    if (!btn || !svg || !audioPlayer.currentStation) return;

    const id = audioPlayer.currentStation.stationuuid || audioPlayer.currentStation.url_resolved;
    const isFav = favoritesManager.isFavorite(id);
    svg.setAttribute('fill', isFav ? 'var(--accent-pink)' : 'none');
    svg.setAttribute('stroke', isFav ? 'var(--accent-pink)' : 'currentColor');
  }

  updateActiveCardHighlights() {
    const currentId = audioPlayer.currentStation ? 
      (audioPlayer.currentStation.stationuuid || audioPlayer.currentStation.url_resolved) : null;

    document.querySelectorAll('.station-card').forEach(card => {
      const isCurrent = card.dataset.stationId === currentId;
      card.classList.toggle('is-active', isCurrent);
      const playIconPath = card.querySelector('.station-play-overlay svg path');
      if (playIconPath) {
        if (isCurrent && audioPlayer.status === PlaybackStatus.PLAYING) {
          playIconPath.setAttribute('d', 'M6 19h4V5H6v14zm8-14v14h4V5h-4z'); // Pauze icoon
        } else {
          playIconPath.setAttribute('d', 'M8 5v14l11-7z'); // Play icoon
        }
      }
    });
  }

  updateCastUI() {
    const badge = document.getElementById('castActiveBadge');
    const nameEl = document.getElementById('castDeviceName');
    const isConnected = this.castController.isConnected();
    const state = this.castController.castState;
    const noDevices = state === 'NO_DEVICES_AVAILABLE';

    document.querySelectorAll('.btn-cast').forEach(btn => {
      btn.classList.toggle('is-connected', isConnected);
      btn.classList.toggle('no-devices', noDevices && !isConnected);
      btn.title = isConnected
        ? `Casten naar ${this.castController.getDeviceName()} (klik om te stoppen)`
        : noDevices ? 'Geen Cast-apparaten gevonden' : 'Casten naar een apparaat';
    });

    if (!badge || !nameEl) return;

    if (isConnected) {
      badge.classList.add('active');
      nameEl.textContent = this.castController.getDeviceName();
    } else {
      badge.classList.remove('active');
    }
  }

  // --- PWA & SERVICE WORKER ---
  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then(reg => console.log('Service Worker geregistreerd:', reg.scope))
          .catch(err => console.warn('Service Worker registratie fout:', err));
      });
    }
  }

  setupPwaInstall() {
    const installBtn = document.getElementById('pwaInstallBtn');
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredInstallPrompt = e;
      if (installBtn) {
        installBtn.classList.add('visible');
        installBtn.addEventListener('click', async () => {
          if (this.deferredInstallPrompt) {
            this.deferredInstallPrompt.prompt();
            const choice = await this.deferredInstallPrompt.userChoice;
            if (choice.outcome === 'accepted') {
              installBtn.classList.remove('visible');
            }
            this.deferredInstallPrompt = null;
          }
        });
      }
    });

    window.addEventListener('appinstalled', () => {
      if (installBtn) installBtn.classList.remove('visible');
      this.showToast('NovaRadio succesvol geïnstalleerd!');
    });
  }

  // --- EXPORT & TOASTS ---
  exportFavoritesFile() {
    const json = favoritesManager.exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `novaradio_favorieten_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showToast('Favorieten opgeslagen als bestand!');
  }

  showToast(message) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="color: var(--secondary);">
        <circle cx="12" cy="12" r="10"></circle>
      </svg>
      <span>${message}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(30px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }
}

// Start NovaRadio wanneer de DOM klaar is
document.addEventListener('DOMContentLoaded', () => {
  window.novaRadioApp = new App();
});
