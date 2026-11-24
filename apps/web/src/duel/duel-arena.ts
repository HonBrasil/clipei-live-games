import type { DuelEvent, DuelSceneId, DuelSnapshot } from '@clipei/shared';
import type { Sfx } from '../arena/sfx.ts';

/**
 * Duelo no velho oeste em pixel art, 960×540 "lógicos".
 * Dois cowboys frente a frente; o servidor manda as fases e os tiros,
 * aqui só encenamos (saque, clarão, rastro da bala, colete, queda, chapéu voando).
 */

const W = 960;
const H = 540;
const PX = 6;
const GROUND = 440;
const POS = [255, 705];

const COWBOY = [
  '......HHHH......',
  '.....HHHHHH.....',
  '...hhhhhhhhhh...',
  '......SSSS......',
  '......SSES......',
  '......SSSS......',
  '.......SS.......',
  '.....CCCCCC.....',
  '....CCVVVVCC....',
  '....CCVVVVCC....',
  '....CCVVVVCC....',
  '....SCVVVVCS....',
  '....SBBBBBBS....',
  '.....BBBBBBG....',
  '.....PPPPPPG....',
  '.....PPPPPP.....',
  '.....PP..PP.....',
  '.....PP..PP.....',
  '.....PP..PP.....',
  '.....PP..PP.....',
  '.....PP..PP.....',
  '....KKK..KKK....',
];

const PAL: Record<string, string> = { H: '#5a3a1e', h: '#43290f', S: '#e0a57a', E: '#1a1a1a', V: '#3b2a20', B: '#2a1d14', G: '#a7adb3', P: '#3d4f6e', K: '#4a2f18' };

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

const spriteCache = new Map<string, HTMLCanvasElement>();
/** Cowboy virado para a direita; aim = braço esticado com o revólver. */
function cowboy(color: string, aim: boolean, hat = true) {
  const key = `${color}:${aim}:${hat}`;
  let c = spriteCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = 22 * PX;
  c.height = COWBOY.length * PX;
  const g = c.getContext('2d')!;
  COWBOY.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      if (!hat && (ch === 'H' || ch === 'h')) return;
      if (aim && ((y === 11 && x === 11) || (ch === 'G' && y >= 13))) return; // a mão e a arma saem do coldre
      g.fillStyle = ch === 'C' ? (y === 7 ? shade(color, 0.2) : color) : PAL[ch];
      g.fillRect(x * PX, y * PX, PX, PX);
    }),
  );
  if (!hat) {
    // cabelo
    g.fillStyle = '#3b2412';
    g.fillRect(6 * PX, 2 * PX, 4 * PX, PX);
  }
  if (aim) {
    // braço esticado + revólver
    g.fillStyle = color;
    g.fillRect(11 * PX, 8 * PX, 4 * PX, 2 * PX);
    g.fillStyle = PAL.S;
    g.fillRect(15 * PX, 8 * PX, PX, 2 * PX);
    g.fillStyle = PAL.G;
    g.fillRect(16 * PX, 8 * PX, 4 * PX, PX);
    g.fillStyle = '#6b7075';
    g.fillRect(16 * PX, 9 * PX, PX, 2 * PX);
  }
  spriteCache.set(key, c);
  return c;
}

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

interface Pose {
  aim: boolean;
  dead: number; // 0..1 queda
  deadAt: number;
  hatFly: { x: number; y: number; vx: number; vy: number; rot: number } | null;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  max: number;
  size: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
}

export class DuelArena {
  private ctx: CanvasRenderingContext2D;
  private res = 1;
  private full = false;
  private state: DuelSnapshot | null = null;
  private poses: Pose[] = [this.freshPose(), this.freshPose()];
  private floaters: Floater[] = [];
  private sparks: Spark[] = [];
  private tracer: { from: number; until: number; hit: boolean } | null = null;
  private flash: { who: number; until: number } | null = null;
  private weed: { x: number; rot: number } | null = null;
  private bgCache: { key: string; canvas: HTMLCanvasElement } | null = null;
  private last = performance.now();

  constructor(
    private canvas: HTMLCanvasElement,
    private sfx: Sfx | null = null,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.setResolution(1);
    requestAnimationFrame(this.frame);
  }

  setResolution(res: number) {
    const r = Math.max(1, Math.min(2.5, Math.round(res * 4) / 4));
    if (r === this.res && this.canvas.width === Math.round(W * r)) return;
    this.res = r;
    this.canvas.width = Math.round(W * r);
    this.canvas.height = Math.round(H * r);
    this.bgCache = null;
  }

  setDisplay(fullscreen: boolean) {
    this.full = fullscreen;
  }

  private freshPose(): Pose {
    return { aim: false, dead: 0, deadAt: 0, hatFly: null };
  }

  setState(s: DuelSnapshot) {
    const prev = this.state;
    this.state = s;
    // rodada nova: todo mundo de pé de novo
    if (prev && prev.round !== s.round) this.poses = [this.freshPose(), this.freshPose()];
    if (prev?.status !== 'intro' && s.status === 'intro') {
      this.weed = { x: -60, rot: 0 };
      this.sfx?.play('spawn');
    }
    if (prev?.status !== 'lobby' && s.status === 'lobby') this.sfx?.play('warn');
    if (prev?.status !== 'fire' && s.status === 'fire') this.sfx?.play('ult');
    if (prev?.status === 'countdown' || s.status === 'countdown') {
      // bip da contagem fica no overlay-view (sabe o tempo); aqui nada
    }
    for (const e of s.events) this.onEvent(e);
    if (prev?.status !== 'finished' && s.status === 'finished' && s.winner !== null) this.sfx?.play('victory');
  }

  private head(who: number) {
    return { x: POS[who], y: GROUND - COWBOY.length * PX };
  }

  private float(who: number, text: string, color: string, size = 22) {
    const h = this.head(who);
    this.floaters.push({ x: h.x, y: h.y - 78, text, color, life: 0, max: 1500, size });
  }

  private onEvent(e: DuelEvent) {
    const now = performance.now();
    if (e.kind === 'shot') {
      this.poses[e.who].aim = true;
      this.flash = { who: e.who, until: now + 110 };
      this.tracer = { from: e.who, until: now + 140, hit: false };
      this.sfx?.play('crit');
    } else if (e.kind === 'miss') {
      this.float(e.who, 'ERROU!', '#ffffff');
      const t = 1 - e.who;
      for (let i = 0; i < 10; i++) this.sparks.push({ x: POS[t] + (t ? 60 : -60), y: GROUND - 4, vx: (Math.random() - 0.5) * 80, vy: -Math.random() * 90, life: 0, max: 500, color: '#c9a878' });
    } else if (e.kind === 'vest') {
      this.float(e.who, 'COLETE!', '#5ce1ff');
      const h = this.head(e.who);
      for (let i = 0; i < 14; i++) this.sparks.push({ x: h.x, y: h.y + 10 * PX, vx: (Math.random() - 0.5) * 220, vy: (Math.random() - 0.7) * 200, life: 0, max: 380, color: Math.random() < 0.5 ? '#ffd23d' : '#ffffff' });
      this.sfx?.play('hit');
    } else if (e.kind === 'hit') {
      const t = 1 - e.who;
      if (this.tracer) this.tracer.hit = true;
      const p = this.poses[t];
      p.deadAt = now;
      const h = this.head(t);
      p.hatFly = { x: h.x, y: h.y, vx: t === 0 ? -90 : 90, vy: -260, rot: 0 };
      this.float(t, 'PÁ!', '#ff4b55', 34);
      this.sfx?.play('slam');
    } else if (e.kind === 'jam') {
      this.float(e.who, 'TRAVOU!', '#ffb02e');
      this.sfx?.play('escape');
    } else if (e.kind === 'item') {
      const icon = e.item === 'aim' ? '🎯 MIRA' : e.item === 'vest' ? '🦺 COLETE' : '✨ DOURADO';
      this.float(e.who, icon, '#ffd23d', 20);
      this.sfx?.play('bits');
    } else if (e.kind === 'draw') {
      this.floaters.push({ x: W / 2, y: 200, text: 'NINGUÉM ACERTOU', color: '#ffffff', life: 0, max: 2200, size: 30 });
    }
  }

  // ─── Loop ──────────────────────────────────────────────────

  private frame = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.update(now, dt);
    this.draw(now);
    requestAnimationFrame(this.frame);
  };

  private update(now: number, dt: number) {
    for (const p of this.poses) {
      if (p.deadAt) p.dead = Math.min(1, (now - p.deadAt) / 420);
      if (p.hatFly) {
        p.hatFly.vy += 700 * dt;
        p.hatFly.x += p.hatFly.vx * dt;
        p.hatFly.y += p.hatFly.vy * dt;
        p.hatFly.rot += dt * 8;
        if (p.hatFly.y > GROUND - 8) {
          p.hatFly.y = GROUND - 8;
          p.hatFly.vx = 0;
          p.hatFly.vy = 0;
          p.hatFly.rot = 0;
        }
      }
    }
    if (this.weed) {
      this.weed.x += 210 * dt;
      this.weed.rot += dt * 6;
      if (this.weed.x > W + 80) this.weed = null;
    }
    for (const s of this.sparks) {
      s.life += dt * 1000;
      s.vy += 500 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    this.sparks = this.sparks.filter((s) => s.life < s.max);
    for (const f of this.floaters) {
      f.life += dt * 1000;
      f.y -= 22 * dt;
    }
    this.floaters = this.floaters.filter((f) => f.life < f.max);
  }

  private draw(now: number) {
    const ctx = this.ctx;
    const s = this.state;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!s || s.status === 'idle' || s.status === 'stopped') return;
    ctx.setTransform(this.res, 0, 0, this.res, 0, 0);
    ctx.imageSmoothingEnabled = false;

    if (this.full) ctx.drawImage(this.background(s.scene), 0, 0, W, H);
    else {
      // sobreposto: só uma faixa de chão discreta
      const g = ctx.createLinearGradient(0, GROUND - 30, 0, GROUND + 40);
      g.addColorStop(0, 'rgba(120,80,40,0)');
      g.addColorStop(0.5, 'rgba(120,80,40,0.45)');
      g.addColorStop(1, 'rgba(120,80,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(60, GROUND - 30, W - 120, 70);
    }

    if (this.weed) this.drawWeed(this.weed.x, GROUND - 18, this.weed.rot);

    // rastro da bala
    if (this.tracer && now < this.tracer.until) {
      const from = this.tracer.from;
      const y = GROUND - COWBOY.length * PX + 9 * PX;
      const x0 = POS[from] + (from === 0 ? 1 : -1) * 11 * PX;
      const x1 = POS[1 - from] + (from === 0 ? -1 : 1) * (this.tracer.hit ? 0 : -90);
      ctx.strokeStyle = 'rgba(255,230,150,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
    }

    for (let who = 0; who < 2; who++) {
      const pl = s.players[who];
      if (!pl) continue;
      this.drawCowboy(who, pl.color, now);
      const p = this.poses[who];
      if (p.dead < 0.5) this.drawTag(who, pl.name, pl.color, [pl.aim ? '🎯' : '', pl.vest ? '🦺' : '', pl.gold ? '✨' : ''].join(''));
    }

    for (const sp of this.sparks) {
      ctx.globalAlpha = 1 - sp.life / sp.max;
      ctx.fillStyle = sp.color;
      ctx.fillRect(sp.x - 2, sp.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    for (const f of this.floaters) {
      const k = f.life / f.max;
      ctx.globalAlpha = k < 0.12 ? k / 0.12 : 1 - Math.max(0, (k - 0.65) / 0.35);
      ctx.font = `italic 900 ${f.size}px "Exo 2", sans-serif`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#000';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  private drawCowboy(who: number, color: string, now: number) {
    const ctx = this.ctx;
    const p = this.poses[who];
    const spr = cowboy(color, p.aim, !p.hatFly);
    const w = spr.width;
    const h = spr.height;
    const x = POS[who];
    // respiração leve na encarada
    const breathe = p.dead ? 0 : Math.round(Math.sin(now / 700 + who * 2) * 1);
    ctx.save();
    ctx.translate(x, GROUND);
    // sombra
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 34 + p.dead * 30, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    if (who === 1) ctx.scale(-1, 1);
    // queda para trás
    if (p.dead > 0) ctx.rotate(-p.dead * (Math.PI / 2));
    ctx.drawImage(spr, -w / 2 + 2 * PX, -h + breathe, w, h);
    // clarão do tiro
    if (this.flash?.who === who && now < this.flash.until) {
      ctx.fillStyle = '#fff6b0';
      const fx = -w / 2 + 2 * PX + 20 * PX;
      const fy = -h + 8.5 * PX;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const r = i % 2 ? 6 : 16;
        ctx.lineTo(fx + Math.cos(a) * r, fy + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    if (p.hatFly) {
      ctx.save();
      ctx.translate(p.hatFly.x, p.hatFly.y);
      ctx.rotate(p.hatFly.rot);
      ctx.fillStyle = PAL.H;
      ctx.fillRect(-3 * PX, -2 * PX, 6 * PX, 2 * PX);
      ctx.fillStyle = PAL.h;
      ctx.fillRect(-5 * PX, 0, 10 * PX, PX);
      ctx.restore();
    }
  }

  private drawTag(who: number, name: string, color: string, items: string) {
    const ctx = this.ctx;
    const hd = this.head(who);
    const text = name.length > 16 ? `${name.slice(0, 15)}…` : name;
    ctx.font = 'italic 900 20px "Exo 2", sans-serif';
    const w = ctx.measureText(text).width + 22;
    const y = hd.y - 30;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.beginPath();
    ctx.roundRect(hd.x - w / 2, y - 16, w, 28, 7);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(hd.x - w / 2, y + 9, w, 3);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(text, hd.x, y - 2);
    if (items) {
      ctx.font = '18px sans-serif';
      ctx.fillText(items, hd.x, y - 32);
    }
    ctx.textBaseline = 'alphabetic';
  }

  private drawWeed(x: number, y: number, rot: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y + Math.abs(Math.sin(rot)) * -10);
    ctx.rotate(rot);
    ctx.strokeStyle = '#a07a45';
    ctx.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, 10 + (i % 3) * 5, i, i + 2.4);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ─── Cenários (tela cheia) ─────────────────────────────────

  private background(scene: DuelSceneId) {
    const key = `${scene}:${this.res}`;
    if (this.bgCache?.key === key) return this.bgCache.canvas;
    const c = document.createElement('canvas');
    c.width = Math.round(W * this.res);
    c.height = Math.round(H * this.res);
    const g = c.getContext('2d')!;
    g.setTransform(this.res, 0, 0, this.res, 0, 0);
    g.imageSmoothingEnabled = false;
    const rnd = seeded(scene.length * 131 + 7);
    const px = (x: number, y: number, w: number, h: number, col: string) => {
      g.fillStyle = col;
      g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    };
    const night = scene === 'fantasma';
    const sky = g.createLinearGradient(0, 0, 0, GROUND);
    if (scene === 'saloon') {
      sky.addColorStop(0, '#5fb4ea');
      sky.addColorStop(1, '#f6dca0');
    } else if (scene === 'deserto') {
      sky.addColorStop(0, '#3b1d5e');
      sky.addColorStop(0.55, '#e0603a');
      sky.addColorStop(1, '#ffc36b');
    } else {
      sky.addColorStop(0, '#05070f');
      sky.addColorStop(1, '#1b2340');
    }
    g.fillStyle = sky;
    g.fillRect(0, 0, W, GROUND);

    if (night) {
      for (let i = 0; i < 80; i++) px(rnd() * W, rnd() * 260, 2, 2, `rgba(255,255,255,${0.3 + rnd() * 0.6})`);
      g.fillStyle = '#f1edd8';
      g.beginPath();
      g.arc(760, 110, 46, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.beginPath();
      g.arc(745, 100, 10, 0, Math.PI * 2);
      g.arc(778, 128, 7, 0, Math.PI * 2);
      g.fill();
    } else {
      const sunY = scene === 'deserto' ? 360 : 90;
      g.fillStyle = scene === 'deserto' ? '#ffdf7e' : '#fff3c4';
      g.beginPath();
      g.arc(scene === 'deserto' ? 480 : 820, sunY, scene === 'deserto' ? 70 : 38, 0, Math.PI * 2);
      g.fill();
    }

    // mesas (montanhas chatas) ao fundo
    const mesa = night ? '#141a30' : scene === 'deserto' ? '#7a2d2a' : '#c9925c';
    for (let i = 0; i < 4; i++) {
      const x = i * 260 + rnd() * 80 - 40;
      const w = 160 + rnd() * 90;
      const h = 60 + rnd() * 50;
      px(x, GROUND - 70 - h, w, h + 70, mesa);
      px(x + 12, GROUND - 70 - h - 10, w - 24, 12, mesa);
    }

    // fachadas do velho oeste nas laterais
    const wood = night ? '#2a2230' : '#7a4a26';
    const wood2 = night ? '#211a27' : '#5e3519';
    const building = (x: number, w: number, h: number, sign: string) => {
      px(x, GROUND - h, w, h, wood);
      for (let yy = GROUND - h + 8; yy < GROUND; yy += 10) px(x, yy, w, 2, wood2);
      px(x - 6, GROUND - h - 18, w + 12, 22, wood2);
      g.fillStyle = night ? '#9c8fb0' : '#f3e2b8';
      g.font = 'italic 900 15px "Exo 2", sans-serif';
      g.textAlign = 'center';
      g.fillText(sign, x + w / 2, GROUND - h - 2);
      // janelas e porta
      const lit = night ? (rnd() < 0.4 ? '#ffcf6b' : '#0c0a10') : '#2b1a10';
      px(x + 14, GROUND - h + 26, 22, 22, lit);
      px(x + w - 36, GROUND - h + 26, 22, 22, night && rnd() < 0.5 ? '#ffcf6b' : '#2b1a10');
      px(x + w / 2 - 14, GROUND - 46, 28, 46, '#2b1a10');
      // varanda
      px(x - 6, GROUND - 52, w + 12, 4, wood2);
    };
    building(-20, 170, 170, scene === 'fantasma' ? 'S_LOON' : 'SALOON');
    building(820, 170, 150, scene === 'fantasma' ? 'B NCO' : 'BANCO');

    // chão
    const ground = night ? '#3a3742' : scene === 'deserto' ? '#c4753e' : '#d9b077';
    const ground2 = night ? '#302d38' : scene === 'deserto' ? '#ad6433' : '#c89c63';
    px(0, GROUND, W, H - GROUND, ground);
    for (let i = 0; i < 260; i++) px(Math.floor((rnd() * W) / 4) * 4, GROUND + 4 + Math.floor((rnd() * (H - GROUND)) / 4) * 4, 4, 4, ground2);
    // cactos e pedras
    for (let i = 0; i < 4; i++) {
      const x = 180 + rnd() * 600;
      const y = GROUND + 30 + rnd() * 50;
      if (Math.abs(x - POS[0]) < 70 || Math.abs(x - POS[1]) < 70) continue;
      px(x, y - 22, 6, 24, night ? '#2b4a36' : '#3f8a46');
      px(x - 8, y - 14, 6, 8, night ? '#2b4a36' : '#3f8a46');
      px(x + 6, y - 18, 6, 8, night ? '#2b4a36' : '#3f8a46');
    }
    if (night) {
      const fog = g.createLinearGradient(0, GROUND - 40, 0, GROUND + 40);
      fog.addColorStop(0, 'rgba(160,170,210,0)');
      fog.addColorStop(0.5, 'rgba(160,170,210,0.18)');
      fog.addColorStop(1, 'rgba(160,170,210,0)');
      g.fillStyle = fog;
      g.fillRect(0, GROUND - 40, W, 80);
    }
    this.bgCache = { key, canvas: c };
    return c;
  }
}
