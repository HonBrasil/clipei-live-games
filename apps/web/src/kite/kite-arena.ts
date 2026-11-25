import { KITE_FLAG, KITE_HOUSE_W, KITE_LINES, kiteRoofY, type KiteEvent, type KiteRosterEntry, type KiteSnapshot, type KiteVoada } from '@clipei/shared';
import type { Sfx } from '../arena/sfx.ts';
import { drawNameTags, type NameMode, type NameTag } from '../arena/name-tags.ts';

/**
 * Pipa Combate visto de lado, em 960×540 "lógicos".
 * Céu de fim de tarde, morro com lajes, caixas d'água e fiação; cada pessoa é um
 * bonequinho na laje segurando a linha. O servidor manda posições 5x por segundo;
 * aqui tudo é suavizado (pipas balançando, rabiolas ondulando, faíscas no relo).
 */

const W = 960;
const H = 540;
const WIRE_Y = 306;

interface Shown {
  x: number;
  y: number;
  tx: number;
  ty: number;
  vx: number;
  flags: number;
  rabiolas: number;
  line: number;
  cuts: number;
  /** pipa já cortada: não desenha mais no céu */
  gone: boolean;
}

interface Fly {
  v: KiteVoada;
  x: number;
  y: number;
  spin: number;
  /** aparada: voa para baixo até sumir */
  caughtBy?: string;
  caughtColor?: string;
  t0?: number;
}

interface Fx {
  x: number;
  y: number;
  kind: 'snap' | 'bows' | 'poof' | 'text';
  t0: number;
  max: number;
  color?: string;
  text?: string;
  big?: boolean;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function shade(hex: string, k: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (v: number) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k);
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

export class KiteArena {
  private ctx: CanvasRenderingContext2D;
  private res = 1;
  private state: KiteSnapshot | null = null;
  private roster: KiteRosterEntry[] = [];
  private shown = new Map<number, Shown>();
  private flies = new Map<number, Fly>();
  private fx: Fx[] = [];
  private sparks: Spark[] = [];
  private bg: { key: string; canvas: HTMLCanvasElement } | null = null;
  private clockOffset = 0;
  private cam = { x: W / 2, y: H / 2, z: 1 };
  private last = performance.now();
  private names: NameMode = 'all';
  private wind = 0.3;
  private clouds = Array.from({ length: 7 }, (_, i) => ({ x: (i * 173) % W, y: 40 + ((i * 61) % 150), w: 60 + ((i * 37) % 70), s: 0.5 + (i % 3) * 0.25 }));
  private streaks: { x: number; y: number; len: number }[] = [];
  private lastSound = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private sfx: Sfx | null = null,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.setResolution(1);
    requestAnimationFrame(this.frame);
  }

  setNames(mode: NameMode) {
    this.names = mode;
  }

  setResolution(res: number) {
    const r = Math.max(1, Math.min(2.5, Math.round(res * 4) / 4));
    if (r === this.res && this.canvas.width === Math.round(W * r)) return;
    this.res = r;
    this.canvas.width = Math.round(W * r);
    this.canvas.height = Math.round(H * r);
    this.bg = null;
  }

  get rosterEntries() {
    return this.roster;
  }

  setState(s: KiteSnapshot) {
    const prev = this.state;
    this.state = s;
    this.clockOffset = s.serverNow - Date.now();
    this.wind = s.wind;
    if (s.roster) this.roster = s.roster;
    if (prev && prev.rosterVersion !== s.rosterVersion && s.status === 'play' && prev.status === 'lobby') this.shown.clear();
    for (const [idx, x, y, flags, rabiolas, line, cuts] of s.kites) {
      const cur = this.shown.get(idx);
      const alive = (flags & KITE_FLAG.alive) !== 0;
      if (!cur) this.shown.set(idx, { x, y, tx: x, ty: y, vx: 0, flags, rabiolas, line, cuts, gone: !alive });
      else Object.assign(cur, { tx: x, ty: y, flags, rabiolas, line, cuts });
    }
    // pipas voadas: entra quem chegou, sai quem sumiu (aparada ou caiu)
    const ids = new Set(s.voadas.map((v) => v.id));
    for (const v of s.voadas) {
      const f = this.flies.get(v.id);
      if (!f) this.flies.set(v.id, { v, x: v.x, y: v.y, spin: 0 });
      else f.v = v;
    }
    const now = performance.now();
    for (const e of s.events) this.onEvent(e, now);
    for (const [id, f] of this.flies) if (!ids.has(id) && !f.caughtBy) this.flies.delete(id);
    if (prev?.status !== 'lobby' && s.status === 'lobby') this.sfx?.play('warn');
    if (prev?.status === 'lobby' && s.status === 'play') this.sfx?.play('spawn');
    if (prev && prev.status !== 'finished' && s.status === 'finished' && s.winner !== null) this.sfx?.play('victory');
  }

  private onEvent(e: KiteEvent, now: number) {
    const name = (i: number) => this.roster[i]?.name ?? '';
    switch (e.kind) {
      case 'relo':
        this.burst(e.x ?? 0, e.y ?? 0, 10, '#fff3b0');
        if (now - this.lastSound > 200) {
          this.lastSound = now;
          this.sfx?.play('hit');
        }
        break;
      case 'rabiola': {
        const b = this.shown.get(e.b);
        this.fx.push({ x: b?.x ?? e.x ?? 0, y: (b?.y ?? e.y ?? 0) + 24, kind: 'bows', t0: now, max: 1400, color: this.roster[e.b]?.color });
        this.fx.push({ x: e.x ?? 0, y: (e.y ?? 0) - 26, kind: 'text', t0: now, max: 1500, text: 'RABIOLA!', color: '#ffd23d' });
        this.sfx?.play('crit');
        break;
      }
      case 'cut': {
        const b = this.shown.get(e.b);
        if (b) b.gone = true;
        this.fx.push({ x: e.x ?? 0, y: e.y ?? 0, kind: 'snap', t0: now, max: 700 });
        this.fx.push({ x: e.x ?? 0, y: (e.y ?? 0) - 30, kind: 'text', t0: now, max: 2000, text: `✂ ${name(e.a)} CORTOU!`, color: '#ffffff', big: true });
        this.burst(e.x ?? 0, e.y ?? 0, 26, '#ffffff');
        this.sfx?.play('slam');
        break;
      }
      case 'aparar': {
        const f = e.voada !== undefined ? this.flies.get(e.voada) : undefined;
        if (f) {
          f.caughtBy = e.label;
          f.caughtColor = e.color;
          f.t0 = now;
        }
        this.fx.push({ x: f?.x ?? e.x ?? 0, y: (f?.y ?? e.y ?? 0) - 18, kind: 'text', t0: now, max: 1800, text: `🙌 ${e.label ?? ''} aparou!`, color: e.color ?? '#3ddc6b' });
        this.sfx?.play('bits');
        break;
      }
      case 'lost':
        this.fx.push({ x: e.x ?? 0, y: Math.min(H - 20, kiteRoofY(e.x ?? 0)), kind: 'poof', t0: now, max: 700 });
        break;
      case 'stuck':
        this.fx.push({ x: e.x ?? 0, y: WIRE_Y - 30, kind: 'text', t0: now, max: 2200, text: 'ENROSCOU NO FIO!', color: '#ff9f43' });
        break;
      case 'gust':
        this.sfx?.play('thunder');
        break;
      case 'item': {
        const k = this.shown.get(e.a);
        if (k) this.burst(k.x, k.y, 18, e.label === 'dourada' ? '#ffc83d' : e.label === 'diamante' ? '#c08bff' : '#3ddc6b');
        break;
      }
      default:
        break;
    }
  }

  private burst(x: number, y: number, n: number, color: string) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 110;
      this.sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.4 + Math.random() * 0.5, color });
    }
  }

  // ─── Loop ──────────────────────────────────────────────────

  private frame = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.update(dt, now);
    this.draw(now);
    requestAnimationFrame(this.frame);
  };

  private update(dt: number, now: number) {
    for (const k of this.shown.values()) {
      const ox = k.x;
      k.x += (k.tx - k.x) * Math.min(1, dt * 5);
      k.y += (k.ty - k.y) * Math.min(1, dt * 5);
      k.vx += ((k.x - ox) / Math.max(dt, 0.001) - k.vx) * Math.min(1, dt * 6);
    }
    for (const f of this.flies.values()) {
      if (f.caughtBy && f.t0 !== undefined) {
        // aparada: puxada para baixo, para a mão de alguém
        f.y += 220 * dt;
        f.spin += dt * 2;
        if (now - f.t0 > 1400) this.flies.delete(f.v.id);
        continue;
      }
      f.x += (f.v.x - f.x) * Math.min(1, dt * 4);
      f.y += (f.v.y - f.y) * Math.min(1, dt * 4);
      f.spin += dt * 3.2;
    }
    for (const p of this.sparks) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 90 * dt;
      p.life -= dt;
    }
    this.sparks = this.sparks.filter((p) => p.life > 0);
    for (const c of this.clouds) {
      c.x += (6 + this.wind * 18) * c.s * dt;
      if (c.x > W + 80) c.x = -80;
      if (c.x < -90) c.x = W + 70;
    }
    // rajada: riscos de vento atravessando o céu
    const s = this.state;
    if (s?.gust && this.streaks.length < 26 && Math.random() < 0.6) this.streaks.push({ x: this.wind >= 0 ? -60 : W + 60, y: 30 + Math.random() * 270, len: 40 + Math.random() * 70 });
    for (const st of this.streaks) st.x += (this.wind >= 0 ? 1 : -1) * 620 * dt;
    this.streaks = this.streaks.filter((st) => st.x > -120 && st.x < W + 120);
    this.fx = this.fx.filter((f) => now - f.t0 < f.max);

    // câmera: chega perto no final
    let target = { x: W / 2, y: H / 2, z: 1 };
    if (s && (s.status === 'play' || s.status === 'finished') && s.alive <= 2 && s.alive > 0) {
      const alive = [...this.shown.entries()].filter(([, k]) => k.flags & KITE_FLAG.alive).map(([, k]) => k);
      if (alive.length) {
        const xs = alive.map((k) => k.x);
        const ys = alive.map((k) => k.y);
        const bw = Math.max(320, Math.max(...xs) - Math.min(...xs) + 220);
        const bh = Math.max(180, Math.max(...ys) - Math.min(...ys) + 160);
        const z = Math.min(1.7, Math.max(1, Math.min(W / bw, H / bh)));
        target = { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 + 30, z };
      }
    }
    const k = Math.min(1, dt * 1.4);
    this.cam.x += (target.x - this.cam.x) * k;
    this.cam.y += (target.y - this.cam.y) * k;
    this.cam.z += (target.z - this.cam.z) * k;
    const hw = W / 2 / this.cam.z;
    const hh = H / 2 / this.cam.z;
    this.cam.x = Math.min(W - hw, Math.max(hw, this.cam.x));
    this.cam.y = Math.min(H - hh, Math.max(hh, this.cam.y));
  }

  private draw(now: number) {
    const ctx = this.ctx;
    const s = this.state;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!s || s.status === 'idle' || s.status === 'stopped') return;
    const z = this.cam.z * this.res;
    ctx.setTransform(z, 0, 0, z, (W / 2 - this.cam.x * this.cam.z) * this.res, (H / 2 - this.cam.y * this.cam.z) * this.res);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.background(), 0, 0, W, H);
    this.drawClouds();
    const serverNow = Date.now() + this.clockOffset;
    const t = now / 1000;

    this.drawPeople(s, t);
    if (s.status === 'lobby') this.drawLobbyKites(t);
    else {
      this.drawLines(s, t);
      this.drawRelos(s, serverNow);
      this.drawKites(s, t);
    }
    this.drawFlies(t);
    this.drawStreaks();
    this.drawFx(now);
    this.drawNames(s);
  }

  // ─── Camadas ───────────────────────────────────────────────

  private drawClouds() {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(255,236,220,0.55)';
    for (const c of this.clouds) {
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.w / 2, 9, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x - c.w * 0.18, c.y - 7, c.w * 0.22, 9, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x + c.w * 0.12, c.y - 9, c.w * 0.25, 11, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawStreaks() {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const st of this.streaks) {
      ctx.moveTo(st.x, st.y);
      ctx.lineTo(st.x - Math.sign(this.wind || 1) * st.len, st.y + 2);
    }
    ctx.stroke();
  }

  /** Bonequinhos nas lajes: braço levantado segurando a linha (ou caído, se perdeu a pipa). */
  private drawPeople(s: KiteSnapshot, t: number) {
    const ctx = this.ctx;
    this.roster.forEach((r, idx) => {
      const k = this.shown.get(idx);
      const lost = s.status !== 'lobby' && k ? !(k.flags & KITE_FLAG.alive) : false;
      const win = s.status === 'finished' && s.winner === idx;
      const fx = Math.round(r.ax - 4);
      const feet = r.ay + 14;
      const hop = win ? Math.abs(Math.sin(t * 7)) * 5 : 0;
      const by = feet - hop;
      const shirt = r.bot ? '#8d939a' : r.color;
      ctx.globalAlpha = lost ? 0.55 : 1;
      // pernas
      ctx.fillStyle = '#26324a';
      ctx.fillRect(fx - 2, by - 5, 2, 5);
      ctx.fillRect(fx + 1, by - 5, 2, 5);
      // tronco
      ctx.fillStyle = shirt;
      ctx.fillRect(fx - 3, by - 12, 7, 7);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(fx - 3, by - 6, 7, 1);
      // cabeça e boné
      ctx.fillStyle = ['#f1c27d', '#c68642', '#8d5524', '#e0ac69'][idx % 4];
      ctx.fillRect(fx - 2, by - 17, 5, 5);
      ctx.fillStyle = shade(shirt, -0.45);
      ctx.fillRect(fx - 2, by - 18, 5, 2);
      ctx.fillRect(fx + 2, by - 17, 2, 1);
      // braço
      ctx.strokeStyle = shirt;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(fx + 3, by - 11);
      if (win) ctx.lineTo(fx + 5, by - 19);
      else if (lost) ctx.lineTo(fx + 5, by - 6);
      else ctx.lineTo(r.ax, r.ay + (feet - by === 0 ? 0 : -hop));
      ctx.stroke();
      if (win) {
        ctx.beginPath();
        ctx.moveTo(fx - 3, by - 11);
        ctx.lineTo(fx - 5, by - 19);
        ctx.stroke();
      }
      // carretel / lata na mão
      if (!lost) {
        ctx.fillStyle = '#d8d8d8';
        ctx.fillRect(fx - 5, by - 9, 3, 3);
      }
      ctx.globalAlpha = 1;
    });
  }

  /** Inscrições: pipa ainda na mão de cada um, esperando o vento. */
  private drawLobbyKites(t: number) {
    this.roster.forEach((r, idx) => {
      const sway = Math.sin(t * 2 + idx) * 0.15;
      this.drawKite(r.model, r.ax + 5, r.ay - 12 + Math.sin(t * 3 + idx) * 1.5, r.color, 0.62, sway, false, 1);
    });
  }

  private drawLines(s: KiteSnapshot, t: number) {
    const ctx = this.ctx;
    ctx.lineWidth = 0.9;
    for (const [idx, k] of this.shown) {
      if (k.gone || !(k.flags & KITE_FLAG.alive)) continue;
      const r = this.roster[idx];
      if (!r) continue;
      const len = Math.hypot(k.x - r.ax, k.y - r.ay);
      const mx = (r.ax + k.x) / 2 - this.wind * 18;
      const my = (r.ay + k.y + 6) / 2 + len * 0.1 + Math.sin(t * 1.3 + idx) * 3;
      const inRelo = (k.flags & KITE_FLAG.relo) !== 0;
      ctx.strokeStyle = KITE_LINES[k.line]?.color ?? '#fff';
      ctx.globalAlpha = inRelo ? 1 : 0.8;
      ctx.lineWidth = inRelo || k.line >= 2 ? 1.3 : 0.9;
      ctx.beginPath();
      ctx.moveTo(r.ax, r.ay);
      ctx.quadraticCurveTo(mx, my, k.x, k.y + 6);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    void s;
  }

  private drawRelos(s: KiteSnapshot, serverNow: number) {
    const ctx = this.ctx;
    for (const r of s.relos) {
      const left = Math.max(0, r.endsAt - serverNow) / 6000;
      // anel do tempo do relo
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y + 20, 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,45,58,0.9)';
      ctx.beginPath();
      ctx.arc(r.x, r.y + 20, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = 'italic 900 7px "Exo 2", sans-serif';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('RELO', r.x, r.y + 20.5);
      ctx.textBaseline = 'alphabetic';
      // faíscas no cruzamento
      if (Math.random() < 0.7) {
        const a = Math.random() * Math.PI * 2;
        this.sparks.push({ x: r.x, y: r.y + 8, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60 - 20, life: 0.3, color: Math.random() < 0.5 ? '#fff3b0' : '#ffb02e' });
      }
    }
  }

  private drawKites(s: KiteSnapshot, t: number) {
    for (const [idx, k] of this.shown) {
      if (k.gone || !(k.flags & KITE_FLAG.alive)) continue;
      const r = this.roster[idx];
      if (!r) continue;
      const golden = (k.flags & KITE_FLAG.golden) !== 0;
      const stuck = (k.flags & KITE_FLAG.stuck) !== 0;
      const ang = stuck ? 0.9 + Math.sin(t * 9) * 0.1 : Math.max(-0.6, Math.min(0.6, k.vx / 140)) + this.wind * 0.18 + Math.sin(t * 2.2 + idx) * 0.07;
      this.drawTail(k.x, k.y, k.rabiolas, r.color, t, idx);
      const ctx = this.ctx;
      if (k.flags & KITE_FLAG.descarregar) {
        ctx.fillStyle = 'rgba(255,45,58,0.35)';
        ctx.beginPath();
        ctx.arc(k.x, k.y, 17 + Math.sin(t * 20) * 2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (k.flags & KITE_FLAG.puxar) {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1;
        for (let i = -1; i <= 1; i++) {
          const o = ((t * 60 + i * 9) % 18) + 14;
          ctx.beginPath();
          ctx.moveTo(k.x + i * 6, k.y + o);
          ctx.lineTo(k.x + i * 6, k.y + o + 7);
          ctx.stroke();
        }
      }
      if (golden) {
        const g = ctx.createRadialGradient(k.x, k.y, 2, k.x, k.y, 26);
        g.addColorStop(0, 'rgba(255,210,61,0.55)');
        g.addColorStop(1, 'rgba(255,210,61,0)');
        ctx.fillStyle = g;
        ctx.fillRect(k.x - 26, k.y - 26, 52, 52);
      }
      const win = s.status === 'finished' && s.winner === idx;
      this.drawKite(r.model, k.x, k.y, golden ? '#ffc83d' : r.color, golden ? 1.3 : win ? 1.25 : 1, ang, golden);
      if (stuck) {
        ctx.fillStyle = '#ff9f43';
        ctx.font = 'italic 900 12px "Exo 2", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('!', k.x + 14, k.y - 10);
      }
    }
  }

  /** Rabiola: laços alternando a cor da pessoa e branco; tamanho = quantas rabiolas restam. */
  private drawTail(x: number, y: number, rabiolas: number, color: string, t: number, seed: number) {
    const ctx = this.ctx;
    const n = rabiolas <= 0 ? 3 : 4 + rabiolas * 5;
    let px = x;
    let py = y + 12;
    ctx.strokeStyle = 'rgba(30,30,30,0.7)';
    ctx.lineWidth = 0.7;
    const pts: [number, number][] = [];
    for (let i = 1; i <= n; i++) {
      const nx = x - this.wind * i * 2.4 + Math.sin(t * 4 + i * 0.6 + seed) * i * 0.45;
      const ny = y + 12 + i * 4.3;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      pts.push([nx, ny]);
      px = nx;
      py = ny;
    }
    if (rabiolas <= 0) return;
    pts.forEach(([bx, by], i) => {
      if (i % 2) return;
      ctx.fillStyle = i % 4 === 0 ? color : '#ffffff';
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - 3.5, by - 2);
      ctx.lineTo(bx - 3.5, by + 2);
      ctx.closePath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + 3.5, by - 2);
      ctx.lineTo(bx + 3.5, by + 2);
      ctx.closePath();
      ctx.fill();
    });
  }

  /** Os 5 modelos: pipa (losango), raia, capucheta, arraia e peixinho. */
  private drawKite(model: number, x: number, y: number, color: string, scale: number, ang: number, golden: boolean, alpha = 1) {
    const ctx = this.ctx;
    const light = shade(color, 0.45);
    const dark = shade(color, -0.45);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.scale(scale, scale);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(20,14,10,0.85)';
    ctx.lineWidth = 1.1;
    const poly = (pts: number[], fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.closePath();
      ctx.fill();
    };
    switch (model) {
      case 1: {
        // raia: sextavada com círculo no meio
        poly([0, -14, 11, -6, 9, 8, 0, 14, -9, 8, -11, -6], color);
        poly([0, -14, 11, -6, 0, 0], light);
        poly([0, 14, -9, 8, 0, 0], light);
        ctx.beginPath();
        ctx.moveTo(0, -14);
        ctx.lineTo(11, -6);
        ctx.lineTo(9, 8);
        ctx.lineTo(0, 14);
        ctx.lineTo(-9, 8);
        ctx.lineTo(-11, -6);
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.arc(0, 0, 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 2: {
        // capucheta: quadradinho de papel dobrado, sem varetas
        poly([-9, -9, 9, -9, 9, 9, -9, 9], color);
        poly([-9, -9, 9, -9, 0, 0], light);
        ctx.strokeRect(-9, -9, 18, 18);
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath();
        ctx.moveTo(-9, 9);
        ctx.lineTo(9, -9);
        ctx.stroke();
        // laço
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(0, 9);
        ctx.lineTo(-4, 13);
        ctx.lineTo(4, 13);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 3: {
        // arraia: asas largas e curvas
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, -11);
        ctx.quadraticCurveTo(10, -9, 16, 1);
        ctx.quadraticCurveTo(7, 3, 0, 13);
        ctx.quadraticCurveTo(-7, 3, -16, 1);
        ctx.quadraticCurveTo(-10, -9, 0, -11);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = light;
        ctx.beginPath();
        ctx.moveTo(0, -11);
        ctx.quadraticCurveTo(-10, -9, -16, 1);
        ctx.quadraticCurveTo(-7, 0, 0, -2);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(40,25,15,0.8)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(0, -11);
        ctx.lineTo(0, 13);
        ctx.moveTo(-16, 1);
        ctx.quadraticCurveTo(0, -5, 16, 1);
        ctx.stroke();
        // pendões nas pontas
        ctx.lineWidth = 1.1;
        ctx.strokeStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(16, 1);
        ctx.lineTo(19, 8);
        ctx.moveTo(-16, 1);
        ctx.lineTo(-19, 8);
        ctx.stroke();
        break;
      }
      case 4: {
        // peixinho: corpo de peixe, nadadeiras e rabo bifurcado
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.moveTo(0, 8);
        ctx.quadraticCurveTo(-3, 13, -9, 18);
        ctx.lineTo(0, 14.5);
        ctx.lineTo(9, 18);
        ctx.quadraticCurveTo(3, 13, 0, 8);
        ctx.closePath();
        ctx.fill();
        poly([-6, 0, -12, 5, -6, 5], dark);
        poly([6, 0, 12, 5, 6, 5], dark);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, -14);
        ctx.quadraticCurveTo(9, -6, 7, 3);
        ctx.quadraticCurveTo(5, 9, 0, 11);
        ctx.quadraticCurveTo(-5, 9, -7, 3);
        ctx.quadraticCurveTo(-9, -6, 0, -14);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // escamas
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 0.8;
        for (const yy of [-1, 3.5]) {
          ctx.beginPath();
          ctx.arc(-2.5, yy, 2.5, 0.2, Math.PI - 0.2);
          ctx.arc(2.5, yy, 2.5, 0.2, Math.PI - 0.2);
          ctx.stroke();
        }
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, -7.5, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.arc(0, -7.2, 1.2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      default: {
        // pipa (losango) com varetas
        poly([0, -14, 10, -2, 0, 14, -10, -2], color);
        poly([0, -14, 10, -2, 0, -2], light);
        poly([0, 14, -10, -2, 0, -2], light);
        ctx.beginPath();
        ctx.moveTo(0, -14);
        ctx.lineTo(10, -2);
        ctx.lineTo(0, 14);
        ctx.lineTo(-10, -2);
        ctx.closePath();
        ctx.stroke();
        ctx.strokeStyle = 'rgba(60,40,20,0.8)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(0, -14);
        ctx.lineTo(0, 14);
        ctx.moveTo(-10, -2);
        ctx.quadraticCurveTo(0, -6, 10, -2);
        ctx.stroke();
      }
    }
    if (golden) {
      ctx.fillStyle = '#fff6c2';
      const tw = Math.sin(performance.now() / 120);
      ctx.fillRect(5, -11 + tw, 2, 2);
      ctx.fillRect(-7, 3 - tw, 1.5, 1.5);
    }
    ctx.restore();
  }

  private drawFlies(t: number) {
    const ctx = this.ctx;
    for (const f of this.flies.values()) {
      const r = f.v.owner >= 0 ? this.roster[f.v.owner] : null;
      const alpha = f.caughtBy && f.t0 !== undefined ? Math.max(0, 1 - (performance.now() - f.t0) / 1400) : 1;
      // linha solta, ondulando
      ctx.globalAlpha = alpha * 0.7;
      ctx.strokeStyle = '#f2efe6';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(f.x, f.y + 6);
      for (let i = 1; i <= 8; i++) ctx.lineTo(f.x + Math.sin(t * 5 + i) * i * 1.5 - this.wind * i * 3, f.y + 6 + i * 7);
      ctx.stroke();
      ctx.globalAlpha = 1;
      this.drawKite(f.v.model, f.x, f.y, f.v.color, 0.95, Math.sin(f.spin) * 1.1, false, alpha);
      if (!f.caughtBy) {
        // alvo piscando para o chat aparar
        const pulse = 0.5 + 0.5 * Math.sin(t * 8);
        ctx.strokeStyle = `rgba(61,220,107,${0.5 + pulse * 0.5})`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(f.x, f.y, 18 + pulse * 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '800 9px Inter, sans-serif';
        ctx.textAlign = 'center';
        const label = '!aparar';
        const w = ctx.measureText(label).width + 10;
        ctx.fillStyle = 'rgba(20,120,60,0.92)';
        ctx.beginPath();
        ctx.roundRect(f.x - w / 2, f.y + 20, w, 13, 6);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(label, f.x, f.y + 29.5);
      }
      void r;
    }
  }

  private drawFx(now: number) {
    const ctx = this.ctx;
    for (const p of this.sparks) {
      ctx.globalAlpha = Math.min(1, p.life * 2.5);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
    }
    ctx.globalAlpha = 1;
    for (const f of this.fx) {
      const k = (now - f.t0) / f.max;
      if (f.kind === 'snap') {
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5 * (1 - k);
        ctx.beginPath();
        ctx.arc(f.x, f.y, 8 + 30 * k, 0, Math.PI * 2);
        ctx.stroke();
      } else if (f.kind === 'bows') {
        ctx.globalAlpha = 1 - k;
        for (let i = 0; i < 6; i++) {
          const a = i * 1.1;
          const bx = f.x + Math.cos(a) * 30 * k + (i - 3) * 4;
          const by = f.y + 40 * k * k + Math.sin(a) * 8;
          ctx.fillStyle = i % 2 ? '#ffffff' : (f.color ?? '#ff2d3a');
          ctx.fillRect(bx - 2.5, by - 1.5, 5, 3);
        }
      } else if (f.kind === 'poof') {
        ctx.globalAlpha = (1 - k) * 0.8;
        ctx.fillStyle = '#e8ddd0';
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          ctx.arc(f.x + (i - 2) * 6 * (1 + k), f.y - 4 - k * 10, 4 + k * 6, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (f.kind === 'text') {
        ctx.globalAlpha = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.7) / 0.3);
        ctx.font = `italic 900 ${f.big ? 15 : 11}px "Exo 2", sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = '#000';
        const y = f.y - k * 14;
        ctx.strokeText(f.text ?? '', f.x, y);
        ctx.fillStyle = f.color ?? '#fff';
        ctx.fillText(f.text ?? '', f.x, y);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Nomes por cima das pipas (ou dos bonecos, nas inscrições). */
  private drawNames(s: KiteSnapshot) {
    const tags: NameTag[] = [];
    const top = new Set(s.topCuts.slice(0, 3));
    const z = Math.sqrt(this.cam.z);
    if (s.status === 'lobby') {
      this.roster.forEach((r, idx) => {
        if (r.bot) return;
        tags.push({ x: r.ax, y: r.ay - 22, name: r.name, color: r.color, priority: idx });
      });
    } else {
      for (const [idx, k] of this.shown) {
        const r = this.roster[idx];
        if (!r || k.gone || !(k.flags & KITE_FLAG.alive)) continue;
        const inRelo = (k.flags & KITE_FLAG.relo) !== 0;
        const highlight = top.has(idx) || inRelo || s.winner === idx || s.alive <= 6;
        if (this.names === 'top' ? !highlight : r.bot && !highlight) continue;
        tags.push({
          x: k.x,
          y: k.y - 17,
          name: r.name,
          color: r.color,
          leader: s.topCuts[0] === idx && k.cuts > 0,
          suffix: k.cuts ? `${k.cuts}✂` : undefined,
          priority: s.winner === idx ? 1e6 : (inRelo ? 2000 : 0) + (top.has(idx) ? 1000 : 0) + k.cuts * 10 + (r.bot ? 0 : 5),
        });
      }
    }
    drawNameTags(this.ctx, tags, 8.5 / z);
  }

  // ─── Fundo (pré-desenhado) ─────────────────────────────────

  private background() {
    const key = `${this.res}`;
    if (this.bg?.key === key) return this.bg.canvas;
    const c = document.createElement('canvas');
    c.width = Math.round(W * this.res);
    c.height = Math.round(H * this.res);
    const g = c.getContext('2d')!;
    g.setTransform(this.res, 0, 0, this.res, 0, 0);
    const rnd = seeded(777);

    // céu de fim de tarde
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#24306e');
    sky.addColorStop(0.35, '#6b4a9a');
    sky.addColorStop(0.62, '#ff8a5c');
    sky.addColorStop(0.8, '#ffc36b');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // sol baixo
    const sun = g.createRadialGradient(760, 330, 10, 760, 330, 140);
    sun.addColorStop(0, 'rgba(255,240,180,1)');
    sun.addColorStop(0.25, 'rgba(255,214,120,0.9)');
    sun.addColorStop(1, 'rgba(255,170,90,0)');
    g.fillStyle = sun;
    g.fillRect(560, 160, 400, 340);
    // estrelinhas no alto
    g.fillStyle = 'rgba(255,255,255,0.6)';
    for (let i = 0; i < 40; i++) g.fillRect(rnd() * W, rnd() * 110, 1.2, 1.2);

    // morros ao fundo
    g.fillStyle = '#5a3a6e';
    g.beginPath();
    g.moveTo(0, 360);
    for (let x = 0; x <= W; x += 20) g.lineTo(x, 345 - 45 * Math.sin((x / W) * Math.PI) - 12 * Math.sin(x / 60));
    g.lineTo(W, H);
    g.lineTo(0, H);
    g.closePath();
    g.fill();
    // casinhas distantes (silhueta com janelas acesas)
    for (let x = 0; x < W; x += 14 + rnd() * 10) {
      const top = 330 - 40 * Math.sin((x / W) * Math.PI) + rnd() * 20;
      g.fillStyle = '#4a2f5e';
      g.fillRect(x, top, 13, H - top);
      if (rnd() < 0.5) {
        g.fillStyle = 'rgba(255,214,120,0.8)';
        g.fillRect(x + 4, top + 5, 2, 2);
      }
    }

    // fiação: postes nas lajes e fios caindo entre eles
    const poles: [number, number][] = [];
    for (let x = 70; x < W; x += 190) poles.push([x, kiteRoofY(x)]);
    g.strokeStyle = '#2a1e2e';
    g.lineWidth = 3;
    for (const [px, py] of poles) {
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px, WIRE_Y - 6);
      g.stroke();
      g.fillStyle = '#2a1e2e';
      g.fillRect(px - 9, WIRE_Y - 8, 18, 3);
    }
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(30,20,35,0.85)';
    for (let w = 0; w < 3; w++) {
      for (let i = 0; i < poles.length - 1; i++) {
        const [x1] = poles[i];
        const [x2] = poles[i + 1];
        const y = WIRE_Y - 7 + w * 0.5;
        g.beginPath();
        g.moveTo(x1 - 8 + w * 8, y);
        g.quadraticCurveTo((x1 + x2) / 2, y + 22, x2 - 8 + w * 8, y);
        g.stroke();
      }
    }

    // o morro: uma casa por coluna, laje em cima
    const walls = ['#c4643f', '#d98b4e', '#b8553a', '#e2b07a', '#8fb3a5', '#d7c26a', '#c97c8a', '#9a6b4f', '#e7d3b0', '#7ea0c4'];
    for (let h = 0; h * KITE_HOUSE_W < W; h++) {
      const x = h * KITE_HOUSE_W;
      const roof = kiteRoofY(x + 1);
      const wall = walls[Math.floor(rnd() * walls.length)];
      // casa de trás (mais alta, mais escura) às vezes
      if (rnd() < 0.5) {
        g.fillStyle = shade(wall, -0.45);
        g.fillRect(x + 6, roof - 18, KITE_HOUSE_W - 14, 20);
      }
      g.fillStyle = wall;
      g.fillRect(x, roof, KITE_HOUSE_W, H - roof);
      // tijolinho aparente
      if (rnd() < 0.45) {
        g.fillStyle = 'rgba(120,40,20,0.25)';
        for (let by = roof + 6; by < H; by += 6) for (let bx = x + ((by / 6) % 2) * 5; bx < x + KITE_HOUSE_W; bx += 10) g.fillRect(bx, by, 8, 1);
      }
      // laje
      g.fillStyle = '#8c8780';
      g.fillRect(x - 1, roof - 3, KITE_HOUSE_W + 2, 4);
      g.fillStyle = '#b0aaa2';
      g.fillRect(x - 1, roof - 3, KITE_HOUSE_W + 2, 1);
      // janelas e portas
      for (let wy = roof + 12; wy < H - 10; wy += 30) {
        for (let wx = x + 7; wx < x + KITE_HOUSE_W - 10; wx += 17) {
          const lit = rnd() < 0.35;
          g.fillStyle = lit ? '#ffd88a' : '#3a2a35';
          g.fillRect(wx, wy, 9, 10);
          g.fillStyle = 'rgba(0,0,0,0.35)';
          g.fillRect(wx, wy + 10, 9, 1);
        }
      }
      // caixa d'água azul em algumas lajes (longe do bonequinho do meio)
      if (rnd() < 0.3) {
        const cx = x + (rnd() < 0.5 ? 4 : KITE_HOUSE_W - 16);
        g.fillStyle = '#2f6fd1';
        g.fillRect(cx, roof - 12, 12, 9);
        g.fillStyle = '#4f8ff0';
        g.fillRect(cx, roof - 12, 12, 2);
      }
      // antena
      if (rnd() < 0.25) {
        g.strokeStyle = '#3a3a3a';
        g.lineWidth = 1;
        const ax = x + 10 + rnd() * 28;
        g.beginPath();
        g.moveTo(ax, roof - 3);
        g.lineTo(ax, roof - 20);
        g.moveTo(ax - 5, roof - 16);
        g.lineTo(ax + 5, roof - 16);
        g.stroke();
      }
      // divisa entre casas
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(x + KITE_HOUSE_W - 1, roof, 1, H - roof);
    }
    // escurece a base (profundidade)
    const fade = g.createLinearGradient(0, 400, 0, H);
    fade.addColorStop(0, 'rgba(20,10,30,0)');
    fade.addColorStop(1, 'rgba(20,10,30,0.55)');
    g.fillStyle = fade;
    g.fillRect(0, 400, W, H - 400);

    this.bg = { key, canvas: c };
    return c;
  }
}
