/**
 * radio-api.js - Client voor de Radio Browser API (40.000+ radiostations wereldwijd)
 */

const API_SERVERS = [
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info'
];

class RadioBrowserApi {
  constructor() {
    this.currentServerIndex = 0;
    this.cache = new Map();
  }

  getBaseUrl() {
    return API_SERVERS[this.currentServerIndex];
  }

  async switchServer() {
    this.currentServerIndex = (this.currentServerIndex + 1) % API_SERVERS.length;
    console.log(`Geschakeld naar Radio-Browser server: ${this.getBaseUrl()}`);
  }

  async fetchWithRetry(endpoint, params = {}) {
    const cacheKey = endpoint + '?' + new URLSearchParams(params).toString();
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < 1000 * 60 * 5) { // 5 min cache
        return cached.data;
      }
    }

    let attempts = 0;
    while (attempts < API_SERVERS.length) {
      try {
        const url = new URL(`${this.getBaseUrl()}/json/${endpoint}`);
        Object.entries(params).forEach(([key, val]) => {
          if (val !== undefined && val !== null && val !== '') {
            url.searchParams.append(key, val);
          }
        });

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7500);

        const response = await fetch(url.toString(), {
          signal: controller.signal,
          headers: {
            'User-Agent': 'NovaRadio/1.0 (Web/PWA client)'
          }
        });
        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}`);
        }

        const data = await response.json();
        const cleaned = this.cleanStations(data);
        this.cache.set(cacheKey, { timestamp: Date.now(), data: cleaned });
        return cleaned;
      } catch (err) {
        console.warn(`Radio API error bij ${this.getBaseUrl()}:`, err);
        attempts++;
        await this.switchServer();
      }
    }

    throw new Error('Kon geen verbinding maken met Radio Browser servers');
  }

  cleanStations(stations) {
    if (!Array.isArray(stations)) return [];
    return stations
      .filter(s => s && s.url_resolved && s.name && s.lastcheckok === 1)
      .map(s => ({
        stationuuid: s.stationuuid,
        name: s.name.trim(),
        url_resolved: s.url_resolved,
        url: s.url,
        favicon: s.favicon && s.favicon.startsWith('http') ? s.favicon : '',
        country: s.country || '',
        countrycode: s.countrycode || '',
        tags: s.tags || '',
        codec: s.codec || 'MP3',
        bitrate: s.bitrate || 128,
        votes: s.votes || 0,
        clickcount: s.clickcount || 0,
        homepage: s.homepage || ''
      }));
  }

  async getTopStations(limit = 40) {
    return this.fetchWithRetry('stations/topvote', {
      limit,
      hidebroken: true
    });
  }

  async getStationsByCountry(countryCode, limit = 50) {
    return this.fetchWithRetry('stations/bycountrycodeexact/' + encodeURIComponent(countryCode), {
      limit,
      order: 'votes',
      reverse: true,
      hidebroken: true
    });
  }

  async getStationsByTag(tag, limit = 50) {
    return this.fetchWithRetry('stations/bytag/' + encodeURIComponent(tag), {
      limit,
      order: 'votes',
      reverse: true,
      hidebroken: true
    });
  }

  async searchStations({ name = '', countrycode = '', tag = '', limit = 60 }) {
    return this.fetchWithRetry('stations/search', {
      name,
      countrycode,
      tag,
      limit,
      order: 'votes',
      reverse: true,
      hidebroken: true
    });
  }

  async recordClick(stationuuid) {
    if (!stationuuid || stationuuid.startsWith('preset-') || stationuuid.startsWith('custom-')) return;
    try {
      fetch(`${this.getBaseUrl()}/json/url/${stationuuid}`, { method: 'GET' }).catch(() => {});
    } catch (e) {}
  }
}

export const radioApi = new RadioBrowserApi();
