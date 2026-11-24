/**
 * Efeitos sonoros 100% sintetizados com Web Audio (estilo 8-bit).
 * Nenhum arquivo de áudio: zero risco de direitos autorais e nada para baixar.
 *
 * No OBS a fonte de navegador toca som sem clique. Em navegadores comuns o áudio
 * só libera depois de uma interação — use `unlock()` num clique.
 */
export type SfxName =
  | 'hit'
  | 'crit'
  | 'ult'
  | 'slam'
  | 'phase'
  | 'explode'
  | 'victory'
  | 'escape'
  | 'spawn'
  | 'warn'
  | 'bits'
  | 'thunder'
  | 'raid';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.6;
  private lastPlayed = new Map<SfxName, number>();
  muted = false;

  /** Intervalo mínimo entre repetições do mesmo som (chat lotado não vira ruído). */
  private static GAP: Partial<Record<SfxName, number>> = { hit: 85, crit: 60, ult: 120, slam: 200, thunder: 120 };

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume * 0.55;
  }

  /** Cria/retoma o contexto de áudio (chame num clique fora do OBS). */
  unlock() {
    const ctx = this.ensure();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  play(name: SfxName) {
    if (this.muted || this.volume <= 0) return;
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running') return;
    const now = performance.now();
    const gap = Sfx.GAP[name] ?? 0;
    if (now - (this.lastPlayed.get(name) ?? 0) < gap) return;
    this.lastPlayed.set(name, now);
    const t = ctx.currentTime + 0.005;
    this[name](ctx, t);
  }

  private ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      this.ctx = new AC();
    } catch {
      return null;
    }
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume * 0.55;
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // no OBS o contexto já nasce "running"; no navegador fica suspenso até um clique
    void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  // ─── blocos básicos ────────────────────────────────────────

  private tone(
    ctx: AudioContext,
    t: number,
    { type = 'square', from, to = from, dur, vol = 0.3, attack = 0.004 }: { type?: OscillatorType; from: number; to?: number; dur: number; vol?: number; attack?: number },
  ) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    if (to !== from) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private hiss(
    ctx: AudioContext,
    t: number,
    { dur, vol = 0.3, filter = 'lowpass', from = 4000, to = from, q = 0.8 }: { dur: number; vol?: number; filter?: BiquadFilterType; from?: number; to?: number; q?: number },
  ) {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    if (to !== from) f.frequency.exponentialRampToValueAtTime(Math.max(30, to), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  // ─── sons ──────────────────────────────────────────────────

  private hit(ctx: AudioContext, t: number) {
    const base = 180 + Math.random() * 120;
    this.tone(ctx, t, { from: base * 2, to: base, dur: 0.07, vol: 0.16 });
    this.hiss(ctx, t, { dur: 0.05, vol: 0.12, filter: 'highpass', from: 2500 });
  }

  private crit(ctx: AudioContext, t: number) {
    this.tone(ctx, t, { from: 660, to: 990, dur: 0.06, vol: 0.2 });
    this.tone(ctx, t + 0.05, { from: 990, to: 1320, dur: 0.09, vol: 0.18 });
    this.hiss(ctx, t, { dur: 0.08, vol: 0.18, filter: 'highpass', from: 3000 });
  }

  private ult(ctx: AudioContext, t: number) {
    this.hiss(ctx, t, { dur: 0.28, vol: 0.25, filter: 'bandpass', from: 400, to: 3500, q: 3 });
    this.tone(ctx, t + 0.26, { type: 'sine', from: 120, to: 38, dur: 0.5, vol: 0.55 });
    this.hiss(ctx, t + 0.26, { dur: 0.45, vol: 0.35, from: 2500, to: 200 });
    this.tone(ctx, t + 0.26, { from: 880, to: 1760, dur: 0.18, vol: 0.12 });
  }

  private slam(ctx: AudioContext, t: number) {
    this.tone(ctx, t, { type: 'sine', from: 95, to: 32, dur: 0.38, vol: 0.6 });
    this.hiss(ctx, t, { dur: 0.3, vol: 0.3, from: 900, to: 120 });
  }

  private phase(ctx: AudioContext, t: number) {
    for (let i = 0; i < 3; i++) {
      this.tone(ctx, t + i * 0.24, { type: 'sawtooth', from: 440, dur: 0.11, vol: 0.18 });
      this.tone(ctx, t + i * 0.24 + 0.12, { type: 'sawtooth', from: 330, dur: 0.11, vol: 0.18 });
    }
    this.tone(ctx, t, { type: 'sine', from: 70, to: 45, dur: 0.8, vol: 0.4 });
  }

  private explode(ctx: AudioContext, t: number) {
    this.hiss(ctx, t, { dur: 1.3, vol: 0.55, from: 3500, to: 80 });
    this.tone(ctx, t, { type: 'sine', from: 80, to: 28, dur: 1.1, vol: 0.6 });
    this.tone(ctx, t + 0.05, { from: 200, to: 50, dur: 0.6, vol: 0.18 });
  }

  private victory(ctx: AudioContext, t: number) {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this.tone(ctx, t + i * 0.11, { from: f, dur: 0.12, vol: 0.2 }));
    const end = t + notes.length * 0.11;
    [523.25, 659.25, 783.99].forEach((f) => this.tone(ctx, end, { from: f, dur: 0.7, vol: 0.12, attack: 0.01 }));
    this.tone(ctx, end, { type: 'triangle', from: 1046.5, dur: 0.7, vol: 0.14, attack: 0.01 });
  }

  private escape(ctx: AudioContext, t: number) {
    this.tone(ctx, t, { from: 600, to: 120, dur: 0.7, vol: 0.2 });
    this.hiss(ctx, t, { dur: 0.6, vol: 0.12, filter: 'bandpass', from: 2000, to: 300, q: 2 });
  }

  private spawn(ctx: AudioContext, t: number) {
    this.hiss(ctx, t, { dur: 0.9, vol: 0.3, from: 300, to: 120 });
    this.tone(ctx, t, { type: 'sine', from: 55, to: 40, dur: 1, vol: 0.45 });
    // rugido: serra grave com vibrato
    const o = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t + 0.3);
    o.frequency.exponentialRampToValueAtTime(70, t + 1.1);
    lfo.frequency.value = 22;
    lfoGain.gain.value = 14;
    lfo.connect(lfoGain).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
    o.connect(g).connect(this.master!);
    o.start(t + 0.3);
    lfo.start(t + 0.3);
    o.stop(t + 1.2);
    lfo.stop(t + 1.2);
  }

  private bits(ctx: AudioContext, t: number) {
    // chuva de cristais: sininhos subindo
    [1318.5, 1567.98, 1975.53, 2637.02, 2093, 2349.32].forEach((f, i) =>
      this.tone(ctx, t + i * 0.07, { type: 'triangle', from: f, dur: 0.25, vol: 0.12 }),
    );
  }

  private thunder(ctx: AudioContext, t: number) {
    this.hiss(ctx, t, { dur: 0.08, vol: 0.5, filter: 'highpass', from: 1500 });
    this.hiss(ctx, t + 0.04, { dur: 0.9, vol: 0.4, from: 1200, to: 90 });
    this.tone(ctx, t, { type: 'sine', from: 70, to: 35, dur: 0.7, vol: 0.45 });
  }

  private raid(ctx: AudioContext, t: number) {
    // corneta de reforços
    [392, 523.25, 659.25, 783.99].forEach((f, i) => this.tone(ctx, t + i * 0.12, { type: 'sawtooth', from: f, dur: 0.16, vol: 0.12 }));
    this.tone(ctx, t + 0.48, { type: 'sawtooth', from: 783.99, dur: 0.5, vol: 0.12, attack: 0.02 });
  }

  private warn(ctx: AudioContext, t: number) {
    this.tone(ctx, t, { from: 880, dur: 0.12, vol: 0.2 });
    this.tone(ctx, t + 0.18, { from: 880, dur: 0.12, vol: 0.2 });
    this.tone(ctx, t + 0.36, { from: 1175, dur: 0.22, vol: 0.2 });
  }
}
