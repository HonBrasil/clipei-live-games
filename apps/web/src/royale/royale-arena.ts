import {
  ROYALE_FLAG,
  ROYALE_REGIONS,
  ROYALE_REGION_IDS,
  ROYALE_WEAPONS,
  type RoyaleCrate,
  type RoyaleEvent,
  type RoyaleRosterEntry,
  type RoyaleSnapshot,
} from '@clipei/shared';
import type { Sfx } from '../arena/sfx.ts';

/**
 * Battle Royale visto de cima, em 960×540 "lógicos".
 * Mapa em pixel art (cidade, porto, fazenda, floresta, rio), avião, paraquedas,
 * soldados, tiros, tempestade, caixas e bombardeio. O servidor manda posições
 * 5x por segundo; aqui tudo é suavizado e, no final, a câmera dá zoom nos últimos vivos.
 */

const W = 960;
const H = 540;
const DROP_MS = 6000;
const RIVER_X = 488;

interface Shown {
  x: number;
  y: number;
  tx: number;
  ty: number;
  hp: number;
  shield: number;
  weapon: number;
  flags: number;
  kills: number;
  aimX: number;
  aimY: number;
  deadAt: number;
}

interface Tracer {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
  until: number;
}

interface Fx {
  x: number;
  y: number;
  kind: 'boom' | 'skull' | 'heal' | 'loot' | 'smoke';
  t0: number;
  max: number;
  color?: string;
}

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export class RoyaleArena {
  private ctx: CanvasRenderingContext2D;
  private res = 1;
  private state: RoyaleSnapshot | null = null;
  private roster: RoyaleRosterEntry[] = [];
  private crates: RoyaleCrate[] = [];
  private shown = new Map<number, Shown>();
  private tracers: Tracer[] = [];
  private fx: Fx[] = [];
  private bg: { key: string; canvas: HTMLCanvasElement } | null = null;
  private clockOffset = 0;
  private cam = { x: W / 2, y: H / 2, z: 1 };
  private last = performance.now();
  private lastShotSound = 0;

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
    this.bg = null;
  }

  get rosterEntries() {
    return this.roster;
  }

  setState(s: RoyaleSnapshot) {
    const prev = this.state;
    this.state = s;
    this.clockOffset = s.serverNow - Date.now();
    if (s.roster) this.roster = s.roster;
    if (s.crates) this.crates = s.crates;
    const now = performance.now();
    for (const [idx, x, y, hp, shield, weapon, flags, kills] of s.players) {
      const cur = this.shown.get(idx);
      if (!cur) this.shown.set(idx, { x, y, tx: x, ty: y, hp, shield, weapon, flags, kills, aimX: x + 1, aimY: y, deadAt: 0 });
      else {
        if (cur.flags & ROYALE_FLAG.alive && !(flags & ROYALE_FLAG.alive)) cur.deadAt = now;
        Object.assign(cur, { tx: x, ty: y, hp, shield, weapon, flags, kills });
        if (prev?.status !== 'play') {
          cur.x = x;
          cur.y = y;
        }
      }
    }
    for (const e of s.events) this.onEvent(e, now);
    if (prev?.status !== 'lobby' && s.status === 'lobby') this.sfx?.play('warn');
    if (prev?.status === 'lobby' && s.status === 'drop') this.sfx?.play('spawn');
    if (prev && prev.status !== 'finished' && s.status === 'finished' && s.winner !== null) this.sfx?.play('victory');
  }

  private onEvent(e: RoyaleEvent, now: number) {
    const a = this.shown.get(e.a);
    const b = this.shown.get(e.b);
    switch (e.kind) {
      case 'shot': {
        if (!a || !b) break;
        const miss = e.hit ? 0 : 14;
        this.tracers.push({ x0: a.x, y0: a.y, x1: b.x + (Math.random() - 0.5) * miss * 2, y1: b.y + (Math.random() - 0.5) * miss * 2, color: ROYALE_WEAPONS[e.weapon ?? 0]?.color ?? '#fff', until: now + 90 });
        a.aimX = b.x;
        a.aimY = b.y;
        if (now - this.lastShotSound > 140) {
          this.lastShotSound = now;
          this.sfx?.play('hit');
        }
        break;
      }
      case 'kill':
      case 'storm':
        this.fx.push({ x: e.x ?? b?.x ?? 0, y: e.y ?? b?.y ?? 0, kind: 'skull', t0: now, max: 2200 });
        break;
      case 'heal':
        if (a) this.fx.push({ x: a.x, y: a.y, kind: 'heal', t0: now, max: 1000 });
        break;
      case 'loot':
        if (a) this.fx.push({ x: a.x, y: a.y, kind: 'loot', t0: now, max: 700, color: ROYALE_WEAPONS[e.weapon ?? 0]?.color });
        break;
      case 'bomb':
        this.fx.push({ x: e.x ?? 0, y: e.y ?? 0, kind: 'boom', t0: now, max: 700 });
        this.sfx?.play('explode');
        break;
      case 'supply':
        this.sfx?.play('bits');
        break;
      default:
        break;
    }
  }

  // ─── Loop ──────────────────────────────────────────────────

  private frame = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.update(dt);
    this.draw(now);
    requestAnimationFrame(this.frame);
  };

  private update(dt: number) {
    for (const p of this.shown.values()) {
      p.x += (p.tx - p.x) * Math.min(1, dt * 6);
      p.y += (p.ty - p.y) * Math.min(1, dt * 6);
    }
    // câmera: zoom nos últimos vivos
    const s = this.state;
    let target = { x: W / 2, y: H / 2, z: 1 };
    if (s && (s.status === 'play' || s.status === 'finished') && s.alive <= 3 && s.alive > 0) {
      const alive = [...this.shown.values()].filter((p) => p.flags & ROYALE_FLAG.alive);
      if (alive.length) {
        const xs = alive.map((p) => p.x);
        const ys = alive.map((p) => p.y);
        const bw = Math.max(220, Math.max(...xs) - Math.min(...xs) + 120);
        const bh = Math.max(124, Math.max(...ys) - Math.min(...ys) + 90);
        const z = Math.min(2.2, Math.max(1, Math.min(W / bw, H / bh)));
        target = { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2, z };
      }
    }
    const k = Math.min(1, dt * 1.6);
    this.cam.x += (target.x - this.cam.x) * k;
    this.cam.y += (target.y - this.cam.y) * k;
    this.cam.z += (target.z - this.cam.z) * k;
    // não deixa a câmera mostrar fora do mapa
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
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.background(), 0, 0, W, H);
    const serverNow = Date.now() + this.clockOffset;

    if (s.status === 'lobby') this.drawRegions(s);
    this.drawCrates(serverNow, now);

    if (s.status === 'play' || s.status === 'finished') {
      this.drawPlayers(s, now);
      this.drawStorm(s);
    }
    if (s.status === 'drop') this.drawDrop(s, serverNow);
    if (s.status === 'lobby' || s.status === 'drop') this.drawPlane(s, serverNow);

    for (const t of this.tracers) {
      if (now > t.until) continue;
      ctx.strokeStyle = t.color;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(t.x0, t.y0);
      ctx.lineTo(t.x1, t.y1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    this.tracers = this.tracers.filter((t) => now <= t.until);
    this.drawFx(now);
  }

  // ─── Camadas ───────────────────────────────────────────────

  private drawRegions(s: RoyaleSnapshot) {
    const ctx = this.ctx;
    for (const id of ROYALE_REGION_IDS) {
      const r = ROYALE_REGIONS[id];
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 12);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.textAlign = 'center';
      ctx.font = 'italic 900 26px "Exo 2", sans-serif';
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#000';
      ctx.strokeText(r.name.toUpperCase(), r.x + r.w / 2, r.y + r.h / 2);
      ctx.fillStyle = '#fff';
      ctx.fillText(r.name.toUpperCase(), r.x + r.w / 2, r.y + r.h / 2);
      ctx.font = '800 15px Inter, sans-serif';
      const n = s.regions[id];
      const t = `!cair ${id} · ${n} ${n === 1 ? 'jogador' : 'jogadores'}`;
      ctx.lineWidth = 4;
      ctx.strokeText(t, r.x + r.w / 2, r.y + r.h / 2 + 24);
      ctx.fillStyle = '#ffd23d';
      ctx.fillText(t, r.x + r.w / 2, r.y + r.h / 2 + 24);
    }
  }

  private planeX(s: RoyaleSnapshot, serverNow: number) {
    if (s.status === 'drop' && s.dropEndsAt) {
      const k = 1 - (s.dropEndsAt - serverNow) / DROP_MS;
      return -80 + k * 1.6 * (W + 160);
    }
    return -80 + (((serverNow / 7000) % 1) * (W + 160));
  }

  private drawPlane(s: RoyaleSnapshot, serverNow: number) {
    const ctx = this.ctx;
    const x = this.planeX(s, serverNow);
    const y = 34;
    ctx.save();
    ctx.translate(x, y);
    // sombra no chão
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(-26, 40, 52, 6);
    // avião em pixel art (visto de cima, indo para a direita)
    const px = (dx: number, dy: number, w: number, h: number, c: string) => {
      ctx.fillStyle = c;
      ctx.fillRect(dx, dy, w, h);
    };
    px(-30, -4, 56, 9, '#d8dde3'); // fuselagem
    px(26, -3, 6, 7, '#aab2bb');
    px(-6, -26, 12, 52, '#c2c9d1'); // asas
    px(-30, -12, 8, 24, '#c2c9d1'); // cauda
    px(14, -2, 6, 5, '#4aa8ff'); // cabine
    px(-6, -26, 12, 3, '#ff2d3a');
    px(-6, 23, 12, 3, '#ff2d3a');
    ctx.restore();
  }

  /** Paraquedas: cada um salta quando o avião passa por cima do ponto de pouso. */
  private drawDrop(s: RoyaleSnapshot, serverNow: number) {
    if (!s.dropEndsAt) return;
    const ctx = this.ctx;
    const start = s.dropEndsAt - DROP_MS;
    const list = [...this.shown.entries()].sort((a, b) => a[1].ty - b[1].ty);
    for (const [idx, p] of list) {
      const jumpAt = start + (p.tx / W) * 2400;
      const k = Math.max(0, Math.min(1, (serverNow - jumpAt) / 3200));
      if (serverNow < jumpAt) continue;
      const e = 1 - (1 - k) * (1 - k);
      const y = 34 + (p.ty - 34) * e;
      const x = p.tx;
      const color = this.roster[idx]?.color ?? '#fff';
      // sombra crescendo no ponto de pouso
      ctx.fillStyle = `rgba(0,0,0,${0.15 + 0.25 * e})`;
      ctx.beginPath();
      ctx.ellipse(x, p.ty + 4, 3 + 4 * e, 1.5 + 2 * e, 0, 0, Math.PI * 2);
      ctx.fill();
      if (k < 1) {
        const sc = 1.6 - 0.6 * e;
        // cordas
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x - 8 * sc, y - 14 * sc);
        ctx.lineTo(x, y);
        ctx.moveTo(x + 8 * sc, y - 14 * sc);
        ctx.lineTo(x, y);
        ctx.stroke();
        // cúpula do paraquedas na cor da pessoa
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(x, y - 15 * sc, 10 * sc, 6 * sc, 0, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(x - 2 * sc, y - 21 * sc, 4 * sc, 5 * sc);
      }
      this.drawSoldier(x, y, color, -1, 0, 1, 1);
    }
  }

  private drawCrates(serverNow: number, now: number) {
    const ctx = this.ctx;
    for (const c of this.crates) {
      const falling = c.landsAt && serverNow < c.landsAt;
      if (c.supply) {
        let y = c.y;
        if (falling) {
          const k = 1 - (c.landsAt! - serverNow) / 4000;
          y = c.y - (1 - k) * 160;
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.beginPath();
          ctx.ellipse(c.x, c.y + 6, 4 + 6 * k, 2 + 2 * k, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ff2d3a';
          ctx.beginPath();
          ctx.ellipse(c.x, y - 18, 14, 8, 0, Math.PI, 0);
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(c.x - 12, y - 18);
          ctx.lineTo(c.x, y - 6);
          ctx.lineTo(c.x + 12, y - 18);
          ctx.stroke();
        } else {
          // fumaça de sinalização
          ctx.globalAlpha = 0.35 + 0.15 * Math.sin(now / 300);
          ctx.fillStyle = '#ff5ca8';
          for (let i = 0; i < 4; i++) {
            const t = ((now / 900 + i / 4) % 1) * 26;
            ctx.beginPath();
            ctx.arc(c.x + Math.sin(now / 500 + i) * 3, c.y - 8 - t, 3 + t * 0.15, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          const g = ctx.createRadialGradient(c.x, c.y, 2, c.x, c.y, 22);
          g.addColorStop(0, 'rgba(255,200,61,0.55)');
          g.addColorStop(1, 'rgba(255,200,61,0)');
          ctx.fillStyle = g;
          ctx.fillRect(c.x - 22, c.y - 22, 44, 44);
        }
        ctx.fillStyle = '#7a4a12';
        ctx.fillRect(c.x - 7, y - 6, 14, 12);
        ctx.fillStyle = '#ffc83d';
        ctx.fillRect(c.x - 7, y - 1, 14, 2);
        ctx.fillRect(c.x - 1, y - 6, 2, 12);
        continue;
      }
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(c.x - 4, c.y - 2, 9, 7);
      ctx.fillStyle = '#9a6a35';
      ctx.fillRect(c.x - 5, c.y - 4, 9, 8);
      ctx.fillStyle = '#c8924f';
      ctx.fillRect(c.x - 5, c.y - 4, 9, 2);
      ctx.fillStyle = '#5c3c18';
      ctx.fillRect(c.x - 1, c.y - 4, 1, 8);
    }
  }

  private drawStorm(s: RoyaleSnapshot) {
    const ctx = this.ctx;
    const z = s.zone;
    ctx.save();
    ctx.beginPath();
    ctx.rect(-50, -50, W + 100, H + 100);
    ctx.arc(z.cx, z.cy, Math.max(0, z.r), 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(110,40,200,0.38)';
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(200,150,255,0.95)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(z.cx, z.cy, Math.max(0, z.r), 0, Math.PI * 2);
    ctx.stroke();
    if (z.nr < z.r - 1) {
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(z.nx, z.ny, z.nr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  private drawPlayers(s: RoyaleSnapshot, now: number) {
    const ctx = this.ctx;
    const entries = [...this.shown.entries()];
    // mortos por baixo
    for (const [, p] of entries) {
      if (p.flags & ROYALE_FLAG.alive) continue;
      const a = p.deadAt ? Math.max(0.25, 1 - (now - p.deadAt) / 3000) : 0.25;
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#2a2a2a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x - 4, p.y - 4);
      ctx.lineTo(p.x + 4, p.y + 4);
      ctx.moveTo(p.x + 4, p.y - 4);
      ctx.lineTo(p.x - 4, p.y + 4);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const alive = entries.filter(([, p]) => p.flags & ROYALE_FLAG.alive).sort((a, b) => a[1].y - b[1].y);
    const showNames = new Set<number>(s.topKills.slice(0, 3));
    if (s.alive <= 8) for (const [idx] of alive) showNames.add(idx);
    for (const [idx, p] of alive) {
      const color = this.roster[idx]?.color ?? '#fff';
      const ang = Math.atan2(p.aimY - p.y, p.aimX - p.x);
      this.drawSoldier(p.x, p.y, color, p.weapon, ang, p.flags & ROYALE_FLAG.storm ? 0.7 : 1, s.winner === idx ? 1.25 : 1);
      if (p.hp < 100 || p.shield > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(p.x - 8, p.y - 13, 16, 3);
        ctx.fillStyle = p.hp > 50 ? '#3ddc6b' : p.hp > 25 ? '#ffc83d' : '#ff4b55';
        ctx.fillRect(p.x - 8, p.y - 13, (16 * p.hp) / 100, 3);
        if (p.shield > 0) {
          ctx.fillStyle = '#4aa8ff';
          ctx.fillRect(p.x - 8, p.y - 15, (16 * p.shield) / 100, 2);
        }
      }
      if (p.flags & ROYALE_FLAG.healing) {
        ctx.fillStyle = '#3ddc6b';
        ctx.fillRect(p.x + 7, p.y - 10, 2, 6);
        ctx.fillRect(p.x + 5, p.y - 8, 6, 2);
      }
      if (showNames.has(idx)) this.label(this.roster[idx]?.name ?? '', p.x, p.y - 22, p.kills, s.topKills[0] === idx);
    }
  }

  /** Soldado visto de cima: corpo na cor da pessoa, capacete e a arma apontando. */
  private drawSoldier(x: number, y: number, color: string, weapon: number, ang: number, alpha = 1, scale = 1) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(1, 2, 6, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    if (weapon >= 0) {
      ctx.save();
      ctx.rotate(ang);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(2, -1.5, weapon === 3 ? 12 : weapon === 1 ? 7 : 9, 3);
      ctx.fillStyle = ROYALE_WEAPONS[weapon].color;
      ctx.fillRect(2, -1, 4, 2);
      ctx.restore();
    }
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3b4a2c';
    ctx.beginPath();
    ctx.arc(0, -0.5, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(-1.5, -2.5, 2, 1.5);
    ctx.restore();
  }

  private label(name: string, x: number, y: number, kills: number, leader: boolean) {
    const ctx = this.ctx;
    const text = `${name.length > 14 ? `${name.slice(0, 13)}…` : name}${kills ? ` · ${kills}💀` : ''}`;
    ctx.font = '800 10px Inter, sans-serif';
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 8, w, 13, 4);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = leader ? '#ffd23d' : '#fff';
    ctx.fillText(text, x, y - 1.5);
    ctx.textBaseline = 'alphabetic';
  }

  private drawFx(now: number) {
    const ctx = this.ctx;
    for (const f of this.fx) {
      const k = (now - f.t0) / f.max;
      if (k >= 1) continue;
      if (f.kind === 'boom') {
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = k < 0.3 ? '#fff3b0' : '#ff7a1a';
        ctx.beginPath();
        ctx.arc(f.x, f.y, 10 + 40 * k, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ff2d3a';
        ctx.lineWidth = 3 * (1 - k);
        ctx.beginPath();
        ctx.arc(f.x, f.y, 45 * k + 8, 0, Math.PI * 2);
        ctx.stroke();
      } else if (f.kind === 'skull') {
        ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('💀', f.x, f.y - 10 - k * 14);
      } else if (f.kind === 'heal') {
        ctx.globalAlpha = 1 - k;
        ctx.font = 'italic 900 12px "Exo 2", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#3ddc6b';
        ctx.fillText('+40', f.x, f.y - 16 - k * 12);
      } else if (f.kind === 'loot') {
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = f.color ?? '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(f.x, f.y, 6 + 12 * k, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    this.fx = this.fx.filter((f) => now - f.t0 < f.max);
  }

  // ─── Mapa (desenhado uma vez) ──────────────────────────────

  private background() {
    const key = `${this.res}`;
    if (this.bg?.key === key) return this.bg.canvas;
    const c = document.createElement('canvas');
    c.width = Math.round(W * this.res);
    c.height = Math.round(H * this.res);
    const g = c.getContext('2d')!;
    g.setTransform(this.res, 0, 0, this.res, 0, 0);
    g.imageSmoothingEnabled = false;
    const rnd = seeded(4242);
    const px = (x: number, y: number, w: number, h: number, col: string) => {
      g.fillStyle = col;
      g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    };

    // grama
    px(0, 0, W, H, '#5e9a43');
    for (let i = 0; i < 900; i++) px(Math.floor((rnd() * W) / 4) * 4, Math.floor((rnd() * H) / 4) * 4, 4, 4, rnd() < 0.5 ? '#558d3c' : '#69a74c');
    // estradas de terra ligando as regiões
    g.strokeStyle = '#a8865a';
    g.lineWidth = 10;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(265, 165);
    g.lineTo(725, 145);
    g.moveTo(265, 165);
    g.lineTo(230, 405);
    g.lineTo(720, 395);
    g.lineTo(725, 145);
    g.stroke();

    // rio com pontes
    px(RIVER_X - 18, 0, 36, H, '#3b7fc4');
    for (let y = 0; y < H; y += 12) px(RIVER_X - 10 + ((y / 12) % 2) * 8, y + 3, 6, 2, '#6fb1ea');
    px(RIVER_X - 24, 0, 6, H, '#c8b07a');
    px(RIVER_X + 18, 0, 6, H, '#c8b07a');
    for (const by of [150, 397]) {
      px(RIVER_X - 28, by - 9, 56, 18, '#8a6338');
      for (let x = RIVER_X - 28; x < RIVER_X + 28; x += 6) px(x, by - 9, 1, 18, '#6d4c28');
    }

    // cidade: asfalto e telhados
    const city = ROYALE_REGIONS.cidade;
    px(city.x, city.y, city.w, city.h, '#7d7f86');
    for (let x = city.x + 8; x < city.x + city.w - 30; x += 52) {
      for (let y = city.y + 8; y < city.y + city.h - 30; y += 46) {
        const w = 30 + Math.floor(rnd() * 3) * 6;
        const h = 26 + Math.floor(rnd() * 2) * 6;
        const roof = ['#b5473a', '#4d5a6b', '#6b4d3a', '#3f6b5a'][Math.floor(rnd() * 4)];
        px(x + 3, y + 3, w, h, 'rgba(0,0,0,0.35)');
        px(x, y, w, h, roof);
        px(x, y, w, 3, 'rgba(255,255,255,0.18)');
        px(x + w / 2 - 1, y, 2, h, 'rgba(0,0,0,0.15)');
      }
    }
    for (let x = city.x; x < city.x + city.w; x += 16) px(x, city.y + city.h / 2 - 1, 8, 2, '#e8e2b0');

    // porto: cais, água e contêineres
    const port = ROYALE_REGIONS.porto;
    px(port.x + port.w - 40, 0, W - (port.x + port.w - 40), port.y + port.h + 30, '#2f6fb0');
    px(port.x, port.y, port.w - 40, port.h, '#8b8f96');
    for (let x = port.x + 10; x < port.x + port.w - 60; x += 34) {
      for (let y = port.y + 12; y < port.y + port.h - 20; y += 22) {
        if (rnd() < 0.25) continue;
        const col = ['#c0392b', '#2e86de', '#f39c12', '#27ae60', '#8e44ad'][Math.floor(rnd() * 5)];
        px(x, y, 28, 14, col);
        for (let k = 3; k < 28; k += 4) px(x + k, y, 1, 14, 'rgba(0,0,0,0.25)');
      }
    }
    for (let y = port.y + 10; y < port.y + port.h; y += 28) px(port.x + port.w - 40, y, 30, 8, '#6d4c28');

    // fazenda: plantações e celeiro
    const farm = ROYALE_REGIONS.fazenda;
    px(farm.x, farm.y, farm.w, farm.h, '#a88a4a');
    for (let y = farm.y + 4; y < farm.y + farm.h; y += 8) px(farm.x + 4, y, farm.w * 0.62, 4, '#c9b45c');
    for (let y = farm.y + 4; y < farm.y + farm.h; y += 8) px(farm.x + farm.w * 0.66, y, farm.w * 0.32, 4, '#7fae4a');
    px(farm.x + farm.w * 0.68, farm.y + 18, 60, 44, '#a23b2c');
    px(farm.x + farm.w * 0.68, farm.y + 18, 60, 6, '#d9d2c2');
    px(farm.x + farm.w * 0.68 + 24, farm.y + 40, 12, 22, '#5a1e16');

    // floresta: árvores vistas de cima
    const wood = ROYALE_REGIONS.floresta;
    px(wood.x, wood.y, wood.w, wood.h, '#3f7a34');
    for (let i = 0; i < 70; i++) {
      const x = wood.x + 8 + rnd() * (wood.w - 16);
      const y = wood.y + 8 + rnd() * (wood.h - 16);
      const r = 7 + rnd() * 6;
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.beginPath();
      g.arc(x + 2, y + 2, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = rnd() < 0.5 ? '#2b5e27' : '#346b2d';
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.beginPath();
      g.arc(x - r / 3, y - r / 3, r / 3, 0, Math.PI * 2);
      g.fill();
    }
    // árvores soltas e pedras pelo mapa
    for (let i = 0; i < 40; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const inRegion = ROYALE_REGION_IDS.some((id) => {
        const r = ROYALE_REGIONS[id];
        return x > r.x - 8 && x < r.x + r.w + 8 && y > r.y - 8 && y < r.y + r.h + 8;
      });
      if (inRegion || Math.abs(x - RIVER_X) < 34) continue;
      g.fillStyle = '#2f6a2a';
      g.beginPath();
      g.arc(x, y, 6, 0, Math.PI * 2);
      g.fill();
    }
    // nomes das regiões (pequenos, sempre visíveis)
    g.font = 'italic 900 13px "Exo 2", sans-serif';
    g.textAlign = 'left';
    for (const id of ROYALE_REGION_IDS) {
      const r = ROYALE_REGIONS[id];
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(r.x + 4, r.y + 4, g.measureText(r.name.toUpperCase()).width + 10, 17);
      g.fillStyle = '#fff';
      g.fillText(r.name.toUpperCase(), r.x + 9, r.y + 17);
    }
    this.bg = { key, canvas: c };
    return c;
  }
}
