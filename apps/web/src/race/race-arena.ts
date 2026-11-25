import { RACE_FLAG, type RaceEvent, type RaceObstacle, type RaceRosterEntry, type RaceSnapshot, type RaceTrackId } from '@clipei/shared';
import type { Sfx } from '../arena/sfx.ts';
import { drawNameTags, type NameMode, type NameTag } from '../arena/name-tags.ts';

/**
 * Corrida vista de cima, desenhada em 960×540 "lógicos" (como a arena do boss).
 * O servidor manda posições 5x por segundo; aqui cada kart é previsto pela
 * velocidade e suavizado, para andar liso a 60 fps.
 */

const W = 960;
const H = 540;
const ROAD = 92;
const LANE = 34; // deslocamento lateral máximo (lat = ±1)
const KART_PX = 2; // tamanho do pixel do sprite
const KART_SCALE = 1.05;

// ─── Circuito ────────────────────────────────────────────────

const CONTROL: [number, number][] = [
  [300, 84],
  [520, 80],
  [740, 88],
  [862, 160],
  [884, 290],
  [834, 420],
  [700, 468],
  [600, 438],
  [480, 470],
  [360, 438],
  [250, 468],
  [118, 424],
  [74, 290],
  [100, 156],
  [190, 90],
]

interface Pt {
  x: number;
  y: number;
}

class Track {
  readonly pts: Pt[] = [];
  private cum: number[] = [];
  readonly total: number;

  constructor(ctrl: [number, number][]) {
    const n = ctrl.length;
    const P = (i: number) => ctrl[(i + n) % n];
    for (let i = 0; i < n; i++) {
      const [p0, p1, p2, p3] = [P(i - 1), P(i), P(i + 1), P(i + 2)];
      for (let s = 0; s < 48; s++) {
        const t = s / 48;
        const t2 = t * t;
        const t3 = t2 * t;
        const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        this.pts.push({ x: f(p0[0], p1[0], p2[0], p3[0]), y: f(p0[1], p1[1], p2[1], p3[1]) });
      }
    }
    let acc = 0;
    this.cum = this.pts.map((p, i) => {
      if (i > 0) acc += Math.hypot(p.x - this.pts[i - 1].x, p.y - this.pts[i - 1].y);
      return acc;
    });
    const first = this.pts[0];
    const last = this.pts[this.pts.length - 1];
    this.total = acc + Math.hypot(first.x - last.x, first.y - last.y);
  }

  /** Ponto e direção na fração f da volta (aceita qualquer número; usa a parte fracionária). */
  at(f: number) {
    const d = (((f % 1) + 1) % 1) * this.total;
    let lo = 0;
    let hi = this.cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid] <= d) lo = mid;
      else hi = mid - 1;
    }
    const a = this.pts[lo];
    const b = this.pts[(lo + 1) % this.pts.length];
    const seg = (lo + 1 < this.cum.length ? this.cum[lo + 1] : this.total) - this.cum[lo] || 1;
    const k = (d - this.cum[lo]) / seg;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, angle };
  }

  /** Posição na pista com deslocamento lateral (lat −1..1). */
  place(f: number, lat: number) {
    const p = this.at(f);
    const nx = -Math.sin(p.angle);
    const ny = Math.cos(p.angle);
    return { x: p.x + nx * lat * LANE, y: p.y + ny * lat * LANE, angle: p.angle };
  }

  distanceTo(x: number, y: number) {
    let best = Infinity;
    for (let i = 0; i < this.pts.length; i += 3) best = Math.min(best, Math.hypot(this.pts[i].x - x, this.pts[i].y - y));
    return best;
  }
}

const track = new Track(CONTROL);

// ─── Temas ───────────────────────────────────────────────────

interface Theme {
  ground: string;
  ground2: string;
  road: string;
  roadDark: string;
  curbA: string;
  curbB: string;
  line: string;
  glow: string;
}

const THEMES: Record<RaceTrackId, Theme> = {
  neon: { ground: '#0b0d1a', ground2: '#141836', road: '#24252f', roadDark: '#1b1c24', curbA: '#ff2fb0', curbB: '#24f0ff', line: '#f8e94b', glow: '255,47,176' },
  deserto: { ground: '#e3b66f', ground2: '#d6a35a', road: '#8f5f37', roadDark: '#7c5130', curbA: '#ffffff', curbB: '#d12f2f', line: '#f3d9a3', glow: '255,170,60' },
  gelo: { ground: '#eef6ff', ground2: '#d8e9f8', road: '#6c8fae', roadDark: '#5e7f9c', curbA: '#ffffff', curbB: '#2f7de1', line: '#e9f6ff', glow: '120,200,255' },
  castelo: { ground: '#2e5a2d', ground2: '#274f26', road: '#6b6870', roadDark: '#5c5960', curbA: '#ebe4d1', curbB: '#8a2d2d', line: '#d8d2c0', glow: '255,150,60' },
};

// ─── Sprites ─────────────────────────────────────────────────

const KART = [
  '...dccd...',
  '..dcllcd..',
  'kkdccccdkk',
  'kkdccccdkk',
  '..dccccd..',
  '..dchhcd..',
  '..chvvhc..',
  '..chhhhc..',
  '..dccccd..',
  'kkdccccdkk',
  'kkdccccdkk',
  'kkdccccdkk',
  '..dddddd..',
  '..kkkkkk..',
];

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

const kartCache = new Map<string, HTMLCanvasElement>();
function kartSprite(color: string) {
  let c = kartCache.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = 10 * KART_PX;
  c.height = KART.length * KART_PX;
  const g = c.getContext('2d')!;
  const pal: Record<string, string> = { k: '#141414', c: color, d: shade(color, -0.4), l: shade(color, 0.45), h: '#f4f4f4', v: '#24304a' };
  KART.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      g.fillStyle = pal[ch];
      g.fillRect(x * KART_PX, y * KART_PX, KART_PX, KART_PX);
    }),
  );
  kartCache.set(color, c);
  return c;
}

/** Pequeno gerador previsível (decoração igual em toda carga). */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// ─── Arena da corrida ────────────────────────────────────────

interface Shown {
  p: number;
  lat: number;
  serverP: number;
  serverLat: number;
  speed: number;
  flags: number;
  at: number;
  spin: number;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  max: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

export class RaceArena {
  private ctx: CanvasRenderingContext2D;
  private res = 1;
  private full = false;
  private state: RaceSnapshot | null = null;
  private roster: RaceRosterEntry[] = [];
  private shown = new Map<number, Shown>();
  private obstacles: RaceObstacle[] = [];
  private floaters: Floater[] = [];
  private particles: Particle[] = [];
  private staticLayer: HTMLCanvasElement | null = null;
  private staticKey = '';
  private clockOffset = 0;
  private last = performance.now();
  private lastBeep = -1;
  private running = false;
  private names: NameMode = 'all';

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
    this.staticKey = '';
  }

  /** Tela cheia: desenha o cenário em volta da pista. */
  setNames(mode: NameMode) {
    this.names = mode;
  }

  setDisplay(fullscreen: boolean) {
    if (this.full === fullscreen) return;
    this.full = fullscreen;
    this.staticKey = '';
  }

  get rosterEntries() {
    return this.roster;
  }

  setState(s: RaceSnapshot) {
    const now = performance.now();
    if (s.roster) this.roster = s.roster;
    this.clockOffset = s.serverNow - Date.now();
    const prev = this.state;
    this.state = s;
    this.obstacles = s.obstacles;

    for (const [idx, p, lat, speed, flags] of s.runners) {
      const serverP = p / 1e4;
      const serverLat = lat / 100;
      const cur = this.shown.get(idx);
      if (!cur) this.shown.set(idx, { p: serverP, lat: serverLat, serverP, serverLat, speed: speed / 1e5, flags, at: now, spin: 0 });
      else Object.assign(cur, { serverP, serverLat, speed: speed / 1e5, flags, at: now });
    }
    if (s.status === 'lobby' || (prev && prev.rosterVersion !== s.rosterVersion && s.status !== 'running')) this.layoutGrid();

    for (const e of s.events) this.onEvent(e);
    if (prev?.turbo.open === false && s.turbo.open) this.sfx?.play('warn');
    if (prev && prev.status !== 'finished' && s.status === 'finished') this.sfx?.play('victory');
    if (prev?.status !== 'lobby' && s.status === 'lobby') this.sfx?.play('spawn');
  }

  // ─── Eventos visuais ───────────────────────────────────────

  private onEvent(e: RaceEvent) {
    const sh = this.shown.get(e.who);
    const pos = sh ? track.place(sh.p, sh.lat) : { x: W / 2, y: H / 2 };
    const name = this.roster[e.who]?.name ?? '';
    const float = (text: string, color: string) => {
      // com o chat lotado, muitos "TURBO!" ao mesmo tempo viram borrão: limita
      if (this.floaters.filter((f) => f.text === text).length >= 4) return;
      this.floaters.push({ x: pos.x, y: pos.y - 16, text, color, life: 0, max: 1300 });
    };
    switch (e.kind) {
      case 'turbo':
        float('TURBO!', '#ffd23d');
        break;
      case 'trip':
        float('OPS!', '#ff6b6b');
        if (sh) sh.spin = 1;
        break;
      case 'hit':
        float('🍌', '#ffd23d');
        if (sh) sh.spin = 1;
        this.sfx?.play('hit');
        break;
      case 'blocked':
        float('ESCUDO!', '#5ce1ff');
        break;
      case 'rocket':
        float('FOGUETE!', '#ff8a3d');
        this.sfx?.play('bits');
        break;
      case 'shield':
        float('🛡️', '#5ce1ff');
        break;
      case 'banana':
        float('🍌', '#ffd23d');
        break;
      case 'raid':
        this.floaters.push({ x: W / 2, y: H / 2, text: `RAID${e.label ? ` de ${e.label}` : ''}! VENTO A FAVOR`, color: '#7cf0ff', life: 0, max: 2200 });
        this.sfx?.play('raid');
        break;
      case 'finish':
        if (e.place === 1) this.floaters.push({ x: pos.x, y: pos.y - 26, text: `🏆 ${name}`, color: '#ffd23d', life: 0, max: 2600 });
        break;
      default:
        break;
    }
  }

  /** Na inscrição, os karts esperam enfileirados atrás da linha de largada. */
  private layoutGrid() {
    for (const [idx, sh] of this.shown) {
      const row = Math.floor(idx / 5);
      const col = idx % 5;
      sh.serverP = sh.p = -0.012 - row * 0.012;
      sh.serverLat = sh.lat = -0.8 + col * 0.4;
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
    const s = this.state;
    this.running = !!s && s.status === 'running' && s.startedAt !== null && Date.now() + this.clockOffset >= s.startedAt;
    // contagem 3, 2, 1
    if (s?.status === 'running' && s.startedAt) {
      const left = Math.ceil((s.startedAt - (Date.now() + this.clockOffset)) / 1000);
      if (left !== this.lastBeep && left >= 0 && left <= 3) {
        this.lastBeep = left;
        this.sfx?.play(left === 0 ? 'ult' : 'hit');
      }
    }
    const laps = s?.laps ?? 1;
    for (const sh of this.shown.values()) {
      if (this.running) {
        const predicted = Math.min(laps, sh.serverP + sh.speed * ((now - sh.at) / 1000));
        sh.p += (predicted - sh.p) * Math.min(1, dt * 9);
      } else {
        sh.p += (sh.serverP - sh.p) * Math.min(1, dt * 6);
      }
      sh.lat += (sh.serverLat - sh.lat) * Math.min(1, dt * 6);
      if (sh.spin > 0) sh.spin = Math.max(0, sh.spin - dt * 0.9);
      // chama do turbo / fumaça do foguete
      if (this.running && sh.flags & (RACE_FLAG.boost | RACE_FLAG.rocket) && Math.random() < (sh.flags & RACE_FLAG.rocket ? 0.9 : 0.5)) {
        const pos = track.place(sh.p, sh.lat);
        const back = pos.angle + Math.PI;
        const rocket = (sh.flags & RACE_FLAG.rocket) !== 0;
        this.particles.push({
          x: pos.x + Math.cos(back) * 11,
          y: pos.y + Math.sin(back) * 11,
          vx: Math.cos(back) * 40 + (Math.random() - 0.5) * 20,
          vy: Math.sin(back) * 40 + (Math.random() - 0.5) * 20,
          life: 0,
          max: rocket ? 520 : 320,
          color: Math.random() < 0.5 ? '#ffd23d' : rocket ? '#ff5a1f' : '#ff9a2e',
          size: rocket ? 4 : 3,
        });
      }
    }
    for (const p of this.particles) {
      p.life += dt * 1000;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life < p.max).slice(-400);
    for (const f of this.floaters) {
      f.life += dt * 1000;
      f.y -= 18 * dt;
    }
    this.floaters = this.floaters.filter((f) => f.life < f.max);
  }

  // ─── Desenho ───────────────────────────────────────────────

  private draw(now: number) {
    const ctx = this.ctx;
    const s = this.state;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!s || s.status === 'idle') return;
    ctx.setTransform(this.res, 0, 0, this.res, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.staticFor(s.track), 0, 0, W, H);

    for (const o of this.obstacles) this.drawObstacle(o, now);

    const leaders = new Set(s.leaders.slice(0, 5));
    const first = s.leaders[0];
    const order = [...this.shown.entries()]
      .map(([idx, sh]) => ({ idx, sh, pos: track.place(sh.p, sh.lat) }))
      .sort((a, b) => a.pos.y - b.pos.y);

    for (const p of this.particles) {
      ctx.globalAlpha = 1 - p.life / p.max;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    for (const { idx, sh, pos } of order) this.drawKart(idx, sh, pos, now);
    // nomes por cima de tudo: todo mundo do chat (ou só os 5 primeiros)
    if (s.status === 'running' || s.status === 'lobby') {
      const tags: NameTag[] = [];
      for (const { idx, sh, pos } of order) {
        if (sh.flags & RACE_FLAG.finished) continue;
        const r = this.roster[idx];
        const top = leaders.has(idx);
        if (!r || (this.names === 'top' ? !top : r.bot && !top)) continue;
        const rank = s.leaders.indexOf(idx);
        tags.push({
          x: pos.x,
          y: pos.y - 14,
          name: r.name,
          color: r.color,
          leader: idx === first && this.running,
          priority: rank >= 0 ? 100 - rank : r.bot ? 0 : 10,
          alpha: top ? 1 : 0.9,
        });
      }
      drawNameTags(ctx, tags, 11);
    }

    ctx.textAlign = 'center';
    for (const f of this.floaters) {
      const k = f.life / f.max;
      ctx.globalAlpha = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.6) / 0.4);
      ctx.font = `italic 900 ${f.max > 2000 ? 26 : 16}px "Exo 2", sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#000';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  private drawKart(idx: number, sh: Shown, pos: { x: number; y: number; angle: number }, now: number) {
    const ctx = this.ctx;
    const color = this.roster[idx]?.color ?? '#ffffff';
    const sprite = kartSprite(color);
    const finished = (sh.flags & RACE_FLAG.finished) !== 0;
    const stumble = (sh.flags & RACE_FLAG.stumble) !== 0;
    ctx.save();
    ctx.translate(pos.x, pos.y);
    // sombra
    ctx.globalAlpha = finished ? 0.15 : 0.35;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(1.5, 2.5, 12, 9, pos.angle, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = finished ? 0.45 : 1;
    const spin = stumble || sh.spin > 0 ? (now / 90) % (Math.PI * 2) : 0;
    ctx.rotate(pos.angle + Math.PI / 2 + spin);
    const w = sprite.width * KART_SCALE;
    const h = sprite.height * KART_SCALE;
    ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
    ctx.restore();

    if (sh.flags & RACE_FLAG.shield) {
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.25 * Math.sin(now / 160);
      ctx.strokeStyle = '#5ce1ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (stumble) {
      ctx.fillStyle = '#ffd23d';
      for (let i = 0; i < 3; i++) {
        const a = now / 200 + (i * Math.PI * 2) / 3;
        ctx.fillRect(pos.x + Math.cos(a) * 13 - 1.5, pos.y - 14 + Math.sin(a) * 4 - 1.5, 3, 3);
      }
    }
  }

  private drawObstacle(o: RaceObstacle, now: number) {
    const ctx = this.ctx;
    const pos = track.place(o.p, o.lat);
    if (o.kind === 'oil') {
      ctx.fillStyle = 'rgba(8,8,12,0.85)';
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y, 15, 10, pos.angle, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(120,140,255,${0.25 + 0.15 * Math.sin(now / 300)})`;
      ctx.fillRect(pos.x - 5, pos.y - 4, 6, 2);
      return;
    }
    // casca de banana em pixel art
    const px = 2;
    const B = ['..yy..', '.yyyy.', 'yy..yy', 'y....y'];
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(Math.sin(now / 400 + o.id) * 0.2);
    B.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch !== 'y') return;
        ctx.fillStyle = y === 0 ? '#7a5a12' : '#ffd23d';
        ctx.fillRect((x - 3) * px, (y - 2) * px, px, px);
      }),
    );
    ctx.restore();
  }

  // ─── Camada estática: chão, pista, zebras, largada ─────────

  private staticFor(id: RaceTrackId) {
    const key = `${id}:${this.full}:${this.res}`;
    if (this.staticLayer && this.staticKey === key) return this.staticLayer;
    const c = this.staticLayer ?? document.createElement('canvas');
    c.width = Math.round(W * this.res);
    c.height = Math.round(H * this.res);
    const g = c.getContext('2d')!;
    g.setTransform(this.res, 0, 0, this.res, 0, 0);
    g.clearRect(0, 0, W, H);
    const t = THEMES[id];
    if (this.full) this.paintScenery(g, id, t);

    const path = () => {
      g.beginPath();
      track.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
    };
    g.lineJoin = 'round';
    g.lineCap = 'round';
    // sombra/contorno para destacar sobre o jogo (modo sobreposto)
    path();
    g.strokeStyle = this.full ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.55)';
    g.lineWidth = ROAD + (this.full ? 22 : 26);
    g.stroke();
    if (!this.full) {
      path();
      g.strokeStyle = `rgba(${t.glow},0.35)`;
      g.lineWidth = ROAD + 18;
      g.stroke();
    }
    // zebras
    path();
    g.strokeStyle = t.curbA;
    g.lineWidth = ROAD + 12;
    g.stroke();
    path();
    g.setLineDash([12, 12]);
    g.strokeStyle = t.curbB;
    g.stroke();
    g.setLineDash([]);
    // asfalto
    path();
    g.strokeStyle = t.road;
    g.lineWidth = ROAD;
    g.stroke();
    path();
    g.strokeStyle = t.roadDark;
    g.lineWidth = ROAD - 30;
    g.globalAlpha = 0.45;
    g.stroke();
    g.globalAlpha = 1;
    // faixa central
    path();
    g.setLineDash([14, 18]);
    g.strokeStyle = t.line;
    g.globalAlpha = 0.55;
    g.lineWidth = 2;
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;

    // linha de largada/chegada quadriculada
    const s0 = track.at(0);
    g.save();
    g.translate(s0.x, s0.y);
    g.rotate(s0.angle);
    const sq = 6;
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < Math.ceil(ROAD / sq); i++) {
        g.fillStyle = (i + row) % 2 ? '#111' : '#f4f4f4';
        g.fillRect(-sq + row * sq, -ROAD / 2 + i * sq, sq, sq);
      }
    }
    g.restore();
    this.staticLayer = c;
    this.staticKey = key;
    return c;
  }

  /** Cenário da tela cheia, em pixel art simples e sempre igual (semente fixa). */
  private paintScenery(g: CanvasRenderingContext2D, id: RaceTrackId, t: Theme) {
    const rnd = seeded(id.length * 977 + 13);
    g.fillStyle = t.ground;
    g.fillRect(0, 0, W, H);
    // textura do chão
    g.fillStyle = t.ground2;
    for (let i = 0; i < 520; i++) g.fillRect(Math.floor(rnd() * W / 4) * 4, Math.floor(rnd() * H / 4) * 4, 4, 4);

    const free = (x: number, y: number, r: number) => track.distanceTo(x, y) > ROAD / 2 + r + 8;
    const spots: Pt[] = [];
    for (let i = 0; i < 400 && spots.length < 46; i++) {
      const x = 20 + rnd() * (W - 40);
      const y = 20 + rnd() * (H - 40);
      if (free(x, y, 18) && spots.every((s) => Math.hypot(s.x - x, s.y - y) > 40)) spots.push({ x, y });
    }
    const px = (x: number, y: number, w: number, h: number, c: string) => {
      g.fillStyle = c;
      g.fillRect(Math.round(x), Math.round(y), w, h);
    };
    for (const { x, y } of spots) {
      if (id === 'neon') {
        // prédios vistos de cima com janelas acesas
        const w = 26 + Math.floor(rnd() * 3) * 6;
        const h = 22 + Math.floor(rnd() * 3) * 6;
        px(x - w / 2 + 3, y - h / 2 + 3, w, h, 'rgba(0,0,0,0.45)');
        px(x - w / 2, y - h / 2, w, h, rnd() < 0.5 ? '#1d2147' : '#28123a');
        for (let wx = 4; wx < w - 4; wx += 6) for (let wy = 4; wy < h - 4; wy += 6) if (rnd() < 0.55) px(x - w / 2 + wx, y - h / 2 + wy, 3, 3, rnd() < 0.5 ? '#ffd23d' : '#24f0ff');
        px(x - w / 2, y - h / 2, w, 2, rnd() < 0.5 ? '#ff2fb0' : '#24f0ff');
      } else if (id === 'deserto') {
        if (rnd() < 0.6) {
          // cacto
          px(x - 2, y - 10, 5, 20, '#2f8a3b');
          px(x - 8, y - 4, 4, 8, '#2f8a3b');
          px(x + 4, y - 7, 4, 7, '#2f8a3b');
          px(x - 2, y - 10, 2, 20, '#3fa84d');
        } else {
          px(x - 7, y - 4, 14, 9, '#a9845a');
          px(x - 5, y - 6, 10, 4, '#c19a6b');
        }
      } else if (id === 'gelo') {
        // pinheiro com neve
        px(x - 2, y + 6, 4, 5, '#5b3b22');
        px(x - 10, y, 20, 6, '#1f6b45');
        px(x - 7, y - 6, 14, 6, '#24804f');
        px(x - 4, y - 11, 8, 5, '#2a9158');
        px(x - 6, y - 6, 6, 2, '#ffffff');
        px(x - 3, y - 11, 4, 2, '#ffffff');
      } else {
        // castelo: blocos de pedra e tochas
        if (rnd() < 0.55) {
          px(x - 12, y - 8, 24, 16, '#7d7a80');
          px(x - 12, y - 8, 24, 3, '#9a979e');
          px(x - 12, y, 24, 1, '#5d5a60');
          px(x - 1, y - 8, 1, 16, '#5d5a60');
        } else {
          px(x - 1, y - 2, 3, 10, '#5b3b22');
          px(x - 3, y - 8, 7, 6, '#ff8a2e');
          px(x - 1, y - 10, 3, 4, '#ffd23d');
        }
      }
    }
    // brilho suave no centro do circuito
    const grad = g.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, 420);
    grad.addColorStop(0, `rgba(${t.glow},0.10)`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  }
}

/** Miniatura da pista para o painel (escolha do cenário). */
export function drawTrackThumb(canvas: HTMLCanvasElement, id: RaceTrackId) {
  const g = canvas.getContext('2d')!;
  const t = THEMES[id];
  const k = Math.min(canvas.width / W, canvas.height / H);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = t.ground;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.setTransform(k, 0, 0, k, (canvas.width - W * k) / 2, (canvas.height - H * k) / 2);
  const path = () => {
    g.beginPath();
    track.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
  };
  g.lineJoin = 'round';
  path();
  g.strokeStyle = t.curbB;
  g.lineWidth = ROAD + 16;
  g.stroke();
  path();
  g.strokeStyle = t.road;
  g.lineWidth = ROAD;
  g.stroke();
  const s0 = track.at(0);
  g.fillStyle = '#fff';
  g.save();
  g.translate(s0.x, s0.y);
  g.rotate(s0.angle);
  g.fillRect(-6, -ROAD / 2, 12, ROAD);
  g.restore();
}
