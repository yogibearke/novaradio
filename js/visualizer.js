/**
 * visualizer.js - Vloeiende neon audio equalizer visualizer voor desktop & mobile
 */

import { PlaybackStatus } from './player.js';

export class AudioVisualizer {
  constructor(canvasElement, player) {
    this.canvas = canvasElement;
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.player = player;
    this.barsCount = 28;
    this.barHeights = new Array(this.barsCount).fill(4);
    this.targetHeights = new Array(this.barsCount).fill(4);
    this.phase = 0;
    this.animationId = null;

    if (this.canvas) {
      this.resize();
      window.addEventListener('resize', () => this.resize());
      this.start();
    }
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    if (this.ctx) {
      this.ctx.scale(dpr, dpr);
    }
    this.width = rect.width;
    this.height = rect.height;
  }

  start() {
    const render = () => {
      this.draw();
      this.animationId = requestAnimationFrame(render);
    };
    render();
  }

  stop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  draw() {
    if (!this.ctx || !this.width || !this.height) return;

    this.ctx.clearRect(0, 0, this.width, this.height);

    const isPlaying = this.player.status === PlaybackStatus.PLAYING;
    const isLoading = this.player.status === PlaybackStatus.LOADING;
    this.phase += isPlaying ? 0.08 : 0.02;

    const gap = 4;
    const barWidth = Math.max(3, (this.width - (this.barsCount - 1) * gap) / this.barsCount);

    // Bereken target hoogtes
    for (let i = 0; i < this.barsCount; i++) {
      if (isPlaying) {
        // Organische frequentiesimulatie met verschillende octaven en basrespons
        const wave1 = Math.sin(this.phase * 2 + i * 0.4);
        const wave2 = Math.cos(this.phase * 3.5 - i * 0.6);
        const wave3 = Math.sin(this.phase * 5 + i * 0.2);
        
        // Bas accentueren op lage frequenties (linkerzijde)
        const bassBoost = i < 8 ? 1.4 : 1.0;
        const normalized = Math.max(0.08, (Math.abs(wave1 * 0.5 + wave2 * 0.3 + wave3 * 0.2)) * bassBoost);
        this.targetHeights[i] = normalized * (this.height - 8);
      } else if (isLoading) {
        // Pulsende laadgolf
        const pulse = Math.sin(this.phase * 4 + i * 0.3);
        this.targetHeights[i] = Math.max(4, Math.abs(pulse) * (this.height * 0.45));
      } else {
        // Ruststand
        this.targetHeights[i] = 4;
      }

      // Smooth interpolatie
      this.barHeights[i] += (this.targetHeights[i] - this.barHeights[i]) * 0.22;
    }

    // Teken gradient staven
    const gradient = this.ctx.createLinearGradient(0, this.height, this.width, 0);
    gradient.addColorStop(0, '#6366f1');   // Indigo
    gradient.addColorStop(0.5, '#a855f7'); // Paars
    gradient.addColorStop(1, '#06b6d4');   // Cyaan

    this.ctx.fillStyle = gradient;

    for (let i = 0; i < this.barsCount; i++) {
      const x = i * (barWidth + gap);
      const h = Math.max(3, this.barHeights[i]);
      const y = this.height - h;

      // Afgeronde staafjes
      const radius = Math.min(barWidth / 2, 3);
      this.ctx.beginPath();
      this.ctx.roundRect(x, y, barWidth, h, [radius, radius, 1, 1]);
      this.ctx.fill();
    }
  }
}
