/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lightweight synthesized Web Audio feedback for game moves, dice rolls,
 * captures, spin ticks, and victory chimes (no external audio assets needed).
 */

class GameSoundFX {
  private ctx: AudioContext | null = null;
  public muted = false;

  private getContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return null;
      if (!this.ctx) {
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  private tone(freq: number, duration = 0.08, type: OscillatorType = 'sine', gainVal = 0.06, delay = 0) {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(gainVal, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + duration + 0.01);
    } catch {
      // Audio playback blocked before interaction
    }
  }

  playMove() {
    this.tone(440, 0.06, 'triangle', 0.05);
  }

  playTick() {
    this.tone(680, 0.03, 'square', 0.025);
  }

  playDice() {
    this.tone(320, 0.05, 'triangle', 0.04, 0);
    this.tone(410, 0.05, 'triangle', 0.04, 0.05);
  }

  playCapture() {
    this.tone(520, 0.07, 'sawtooth', 0.05, 0);
    this.tone(760, 0.11, 'triangle', 0.06, 0.06);
  }

  playError() {
    this.tone(190, 0.12, 'sawtooth', 0.04);
  }

  playWin() {
    this.tone(523.25, 0.12, 'triangle', 0.07, 0);
    this.tone(659.25, 0.12, 'triangle', 0.07, 0.1);
    this.tone(783.99, 0.18, 'triangle', 0.08, 0.2);
    this.tone(1046.5, 0.28, 'sine', 0.08, 0.32);
  }
}

export const soundFx = new GameSoundFX();
