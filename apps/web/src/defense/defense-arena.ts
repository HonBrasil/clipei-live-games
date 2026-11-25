import {
  DEFENSE_BASE,
  DEFENSE_CLASSES,
  DEFENSE_CLASS_IDS,
  DEFENSE_H,
  DEFENSE_MONSTERS,
  DEFENSE_PATH,
  DEFENSE_W,
  defensePathLength,
  defensePoint,
  defenseSlots,
  type DefenseFx,
  type DefenseRosterEntry,
  type DefenseSnapshot,
} from '@clipei/shared';
import type { Sfx } from '../arena/sfx.ts';
import { drawNameTags, type NameMode, type NameTag } from '../arena/name-tags.ts';

/**
 * Defesa da Base, desenhada de cima (um pouco de perspectiva): campo, estrada de terra,
 * portal dos monstros na direita e o castelo na esquerda. Torres e monstros são
 * desenhados à mão no canvas, sem imagens.
 */

const W = DEFENSE_W;
const H = DEFENSE_H;
const L = defensePathLength();
const SLOTS = defenseSlots();
const KINDS = ['goblin', 'lobo', 'ogro', 'rei'] as const;
const ALLY_SPEED = 170;
const HERO_AT = { x: DEFENSE_BASE.x + 4, y: DEFENSE_BASE.y - 64 };

interface ShownMonster {
  id: number;
  kind: (typeof KINDS)[number];
  p: number;
  v: number;
  at: number;
  dp: number;
  hp: number;
  slow: boolean;
  burn: boolean;
  hitAt: number;
}

interface ShownTower {
  id: number;
  x: number;
  y: number;
  cls: number;
  level: number;
  power: number;
  angle: number;
  firedAt: number;
  bornAt: number;
}

interface Proj {
  kind: 'arrow' | 'orb' | 'ball' | 'bolt';
  x0: number;
  y0: number;
  m: number;
  tx: number;
  ty: number;
  t0: number;
  dur: number;
  power: boolean;
}

interface Fx {
  kind: 'boom' | 'poof' | 'text' | 'meteor' | 'ring' | 'scorch' | 'dust' | 'spark';
  x: number;
  y: number;
  r?: number;
  t0: number;
  max: number;
  text?: string;
  color?: string;
  big?: boolean;
  vx?: number;
  vy?: number;
}

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

function distToRoad(x: number, y: number) {
  let best = Infinity;
  for (let i = 0; i < DEFENSE_PATH.length - 1; i++) {
    const [ax, ay] = DEFENSE_PATH[i]!;
    const [bx, by] = DEFENSE_PATH[i + 1]!;
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t));
  }
  return best;
}

export class DefenseArena {
  private ctx: CanvasRenderingContext2D;
  private res = 1;
  private state: DefenseSnapshot | null = null;
  private roster = new Map<number, DefenseRosterEntry>();
  private monsters = new Map<number, ShownMonster>();
  private towers = new Map<number, ShownTower>();
  private kills = new Map<number, number>();
  private projs: Proj[] = [];
  private fx: Fx[] = [];
  private bg: { key: string; canvas: HTMLCanvasElement } | null = null;
  private names: NameMode = 'all';
  private transparent = false;
  private shakeAt = -1e9;
  private heroFlashAt = -1e9;
  private clockOffset = 0;
  private last = performance.now();
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

  setTransparent(on: boolean) {
    if (on === this.transparent) return;
    this.transparent = on;
    this.bg = null;
  }

  setResolution(res: number) {
    const r = Math.max(1, Math.min(2.5, Math.round(res * 4) / 4));
    if (r === this.res && this.canvas.width === Math.round(W * r)) return;
    this.res = r;
    this.canvas.width = Math.round(W * r);
    this.canvas.height = Math.round(H * r);
    this.bg = null;
  }

  nameOf(towerId: number) {
    return this.roster.get(towerId)?.name ?? '';
  }
  colorOf(towerId: number) {
    return this.roster.get(towerId)?.color ?? '#fff';
  }

  setState(s: DefenseSnapshot) {
    const prev = this.state;
    this.state = s;
    this.clockOffset = s.serverNow - Date.now();
    const now = performance.now();
    if (prev && prev.status !== 'lobby' && s.status === 'lobby') {
      this.towers.clear();
      this.monsters.clear();
      this.kills.clear();
      this.projs = [];
      this.fx = [];
    }
    if (s.roster) {
      this.roster = new Map(s.roster.map((r) => [r.id, r]));
    }
    // torres
    const seen = new Set<number>();
    for (const [id, slot, cls, level, power] of s.towers) {
      seen.add(id);
      const pos = SLOTS[slot] ?? { x: 0, y: 0 };
      const cur = this.towers.get(id);
      if (!cur) this.towers.set(id, { id, x: pos.x, y: pos.y, cls, level, power, angle: Math.PI, firedAt: 0, bornAt: now });
      else Object.assign(cur, { x: pos.x, y: pos.y, cls, level, power });
    }
    for (const id of [...this.towers.keys()]) if (!seen.has(id)) this.towers.delete(id);
    // monstros
    const alive = new Set<number>();
    for (const [id, k, p, v, hp, slow, burn] of s.monsters) {
      alive.add(id);
      const cur = this.monsters.get(id);
      if (!cur) this.monsters.set(id, { id, kind: KINDS[k] ?? 'goblin', p, v, at: now, dp: p, hp, slow: !!slow, burn: !!burn, hitAt: 0 });
      else {
        if (hp < cur.hp) cur.hitAt = now;
        Object.assign(cur, { p, v, at: now, hp, slow: !!slow, burn: !!burn });
      }
    }
    for (const id of [...this.monsters.keys()]) if (!alive.has(id)) this.monsters.delete(id);
    for (const e of s.fx) this.onFx(e, now);

    if (prev?.status !== 'lobby' && s.status === 'lobby') this.sfx?.play('warn');
    if (prev && prev.status !== 'wave' && s.status === 'wave') this.sfx?.play('spawn');
    if (prev && prev.status !== 'finished' && s.status === 'finished') {
      if (s.result === 'won') {
        this.sfx?.play('victory');
        for (let i = 0; i < 10; i++) this.fx.push({ kind: 'boom', x: 140 + hash(i) * 680, y: 80 + hash(i + 9) * 300, r: 40, t0: now + i * 180, max: 900, color: ['#ffc83d', '#3ddc6b', '#2f9bff', '#ff4d5e'][i % 4] });
      } else this.sfx?.play('explode');
    }
  }

  private monsterPos(m: ShownMonster) {
    return defensePoint(m.dp);
  }

  private onFx(e: DefenseFx, now: number) {
    switch (e.kind) {
      case 'shot': {
        const t = this.towers.get(e.t);
        const m = this.monsters.get(e.m);
        if (!t || !m) break;
        const q = this.monsterPos(m);
        const top = this.towerTop(t);
        t.angle = Math.atan2(q.y - top.y, q.x - top.x);
        t.firedAt = now;
        const cls = DEFENSE_CLASS_IDS[t.cls]!;
        const d = Math.hypot(q.x - top.x, q.y - top.y);
        const kind = cls === 'arqueiro' ? 'arrow' : cls === 'mago' ? 'orb' : 'ball';
        const speed = kind === 'arrow' ? 620 : kind === 'orb' ? 430 : 300;
        this.projs.push({ kind, x0: top.x, y0: top.y, m: e.m, tx: q.x, ty: q.y, t0: now, dur: Math.max(120, (d / speed) * 1000), power: e.power });
        if (e.power) this.fx.push({ kind: 'ring', x: top.x, y: top.y, r: 18, t0: now, max: 400, color: '#ffc83d' });
        if (now - this.lastSound > 140) {
          this.lastSound = now;
          this.sfx?.play(e.power ? 'crit' : 'hit');
        }
        break;
      }
      case 'boom':
        this.fx.push({ kind: 'boom', x: e.x, y: e.y, r: e.r, t0: now + 300, max: 520, color: '#ff9a3d' });
        break;
      case 'kill': {
        this.fx.push({ kind: 'poof', x: e.x, y: e.y, t0: now, max: 650 });
        for (let i = 0; i < 6; i++) {
          const a = hash(e.id + i) * Math.PI * 2;
          this.fx.push({ kind: 'spark', x: e.x, y: e.y - 6, t0: now, max: 600, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60 - 40, color: '#ffd23d' });
        }
        if (e.by >= 0) this.kills.set(e.by, (this.kills.get(e.by) ?? 0) + 1);
        break;
      }
      case 'leak':
        this.shakeAt = now;
        this.fx.push({ kind: 'text', x: DEFENSE_BASE.x + 8, y: DEFENSE_BASE.y - 92, t0: now, max: 1100, text: `-${e.dmg}`, color: '#ff4d5e', big: true });
        this.fx.push({ kind: 'boom', x: DEFENSE_BASE.x + 30, y: DEFENSE_BASE.y, r: 30, t0: now, max: 400, color: '#ff4d5e' });
        this.sfx?.play('slam');
        break;
      case 'meteor':
        this.fx.push({ kind: 'meteor', x: e.x, y: e.y, r: e.r, t0: now, max: 750, text: e.name });
        this.fx.push({ kind: 'boom', x: e.x, y: e.y, r: e.r, t0: now + 700, max: 800, color: '#ff6a2d', big: true });
        this.fx.push({ kind: 'scorch', x: e.x, y: e.y, r: e.r * 0.8, t0: now + 700, max: 5000 });
        this.fx.push({ kind: 'text', x: e.x, y: e.y - e.r - 10, t0: now + 700, max: 1800, text: `☄️ ${e.name}`, color: '#ffc83d', big: true });
        window.setTimeout(() => this.sfx?.play('explode'), 700);
        break;
      case 'hero':
        this.heroFlashAt = now;
        this.fx.push({ kind: 'ring', x: HERO_AT.x, y: HERO_AT.y, r: 60, t0: now, max: 900, color: '#ffc83d' });
        this.sfx?.play('ult');
        break;
      case 'heroShot': {
        const m = this.monsters.get(e.m);
        if (!m) break;
        const q = this.monsterPos(m);
        this.projs.push({ kind: 'bolt', x0: HERO_AT.x, y0: HERO_AT.y - 10, m: e.m, tx: q.x, ty: q.y, t0: now, dur: 160, power: true });
        break;
      }
      case 'allies':
        this.fx.push({ kind: 'text', x: DEFENSE_BASE.x + 110, y: DEFENSE_BASE.y - 40, t0: now, max: 2000, text: `⚔️ ${e.n} ALIADOS!`, color: '#7fd6ff', big: true });
        this.sfx?.play('raid');
        break;
      case 'level': {
        const t = this.towers.get(e.t);
        if (!t) break;
        this.fx.push({ kind: 'ring', x: t.x, y: t.y - 10, r: 34, t0: now, max: 800, color: '#ffc83d' });
        this.fx.push({ kind: 'text', x: t.x, y: t.y - 48, t0: now, max: 1600, text: `NÍVEL ${e.level}!`, color: '#ffc83d' });
        this.sfx?.play('bits');
        break;
      }
      case 'join': {
        const t = this.towers.get(e.t);
        if (t) this.fx.push({ kind: 'dust', x: t.x, y: t.y, t0: now, max: 500 });
        break;
      }
      case 'upgrade':
        this.bg = null;
        this.sfx?.play('phase');
        break;
    }
  }

  private towerTop(t: ShownTower) {
    const cls = DEFENSE_CLASS_IDS[t.cls];
    return { x: t.x, y: t.y - (cls === 'canhao' ? 18 : cls === 'mago' ? 38 : 30) };
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
    const s = this.state;
    for (const m of this.monsters.values()) {
      const target = Math.min(1, m.p + (m.v * (now - m.at)) / 1000);
      // segue a previsão sem pular para trás
      m.dp = m.dp + (target - m.dp) * Math.min(1, dt * 10);
    }
    for (const pr of this.projs) {
      const m = this.monsters.get(pr.m);
      if (m) {
        const q = this.monsterPos(m);
        pr.tx = q.x;
        pr.ty = q.y - DEFENSE_MONSTERS[m.kind].size * 0.6;
      }
    }
    this.projs = this.projs.filter((p) => now - p.t0 < p.dur);
    this.fx = this.fx.filter((f) => now - f.t0 < f.max);
    for (const f of this.fx) {
      if (f.kind === 'spark' && now >= f.t0) {
        f.x += (f.vx ?? 0) * dt;
        f.y += (f.vy ?? 0) * dt;
        f.vy = (f.vy ?? 0) + 160 * dt;
      }
    }
    if (s?.status === 'finished' && s.result === 'lost' && Math.random() < dt * 6)
      this.fx.push({ kind: 'poof', x: DEFENSE_BASE.x + (Math.random() - 0.5) * 70, y: DEFENSE_BASE.y - 30 - Math.random() * 40, t0: now, max: 900 });
  }

  // ─── Desenho ───────────────────────────────────────────────

  private draw(now: number) {
    const ctx = this.ctx;
    const s = this.state;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!s || s.status === 'idle' || s.status === 'stopped') return;
    const shake = now - this.shakeAt < 260 ? (1 - (now - this.shakeAt) / 260) * 4 : 0;
    ctx.setTransform(this.res, 0, 0, this.res, (Math.random() - 0.5) * shake * this.res, (Math.random() - 0.5) * shake * this.res);
    ctx.drawImage(this.background(s), 0, 0, W, H);
    const t = now / 1000;

    this.drawPortal(t, s.status === 'wave');
    for (const f of this.fx) if (f.kind === 'scorch' && now >= f.t0) this.drawFx(f, now);
    this.drawCastle(s, t, now);

    // tudo que fica no chão, ordenado por y (quem está mais embaixo fica na frente)
    type Item = { y: number; draw: () => void };
    const items: Item[] = [];
    for (const m of this.monsters.values()) {
      const q = this.monsterPos(m);
      items.push({ y: q.y, draw: () => this.drawMonster(m, q.x, q.y, q.a, t, now) });
    }
    for (const tw of this.towers.values()) items.push({ y: tw.y, draw: () => this.drawTower(tw, t, now) });
    const serverNow = Date.now() + this.clockOffset;
    for (const [id, p] of s.allies) {
      const ap = Math.max(0, p - (ALLY_SPEED * Math.max(0, serverNow - s.serverNow)) / 1000 / L);
      const q = defensePoint(ap);
      const side = id % 2 ? 7 : -7;
      items.push({ y: q.y + side, draw: () => this.drawAlly(q.x, q.y + side, t + id) });
    }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    if (s.hero && s.hero.until > serverNow) this.drawHero(s.hero.name, t, now);
    for (const pr of this.projs) this.drawProj(pr, now);
    for (const f of this.fx) if (f.kind !== 'scorch' && now >= f.t0) this.drawFx(f, now);
    this.drawTags(s);
  }

  private background(s: DefenseSnapshot) {
    const key = `${this.res}|${this.transparent}|${s.upgrades.gelo > 0}|${s.upgrades.fogo > 0}`;
    if (this.bg?.key === key) return this.bg.canvas;
    const c = document.createElement('canvas');
    c.width = Math.round(W * this.res);
    c.height = Math.round(H * this.res);
    const g = c.getContext('2d')!;
    g.setTransform(this.res, 0, 0, this.res, 0, 0);
    if (!this.transparent) {
      const grass = g.createLinearGradient(0, 0, 0, H);
      grass.addColorStop(0, '#5f9e45');
      grass.addColorStop(1, '#3f7a32');
      g.fillStyle = grass;
      g.fillRect(0, 0, W, H);
      // manchas de grama
      for (let i = 0; i < 160; i++) {
        const x = hash(i) * W;
        const y = hash(i + 500) * H;
        g.fillStyle = hash(i + 900) > 0.5 ? 'rgba(255,255,220,0.05)' : 'rgba(0,40,0,0.07)';
        g.beginPath();
        g.ellipse(x, y, 18 + hash(i + 3) * 40, 8 + hash(i + 4) * 16, 0, 0, Math.PI * 2);
        g.fill();
      }
      // tufos
      g.strokeStyle = 'rgba(30,70,20,0.5)';
      g.lineWidth = 1.2;
      for (let i = 0; i < 260; i++) {
        const x = hash(i + 40) * W;
        const y = hash(i + 80) * H;
        if (distToRoad(x, y) < 26) continue;
        g.beginPath();
        g.moveTo(x - 3, y);
        g.lineTo(x - 1, y - 5);
        g.moveTo(x, y);
        g.lineTo(x + 1, y - 6);
        g.moveTo(x + 3, y);
        g.lineTo(x + 4, y - 4);
        g.stroke();
      }
    }
    // estrada
    const road = (w: number, color: string) => {
      g.strokeStyle = color;
      g.lineWidth = w;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.beginPath();
      DEFENSE_PATH.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    };
    road(48, this.transparent ? 'rgba(40,24,10,0.45)' : 'rgba(60,40,20,0.35)');
    road(40, this.transparent ? 'rgba(122,88,52,0.82)' : '#8a6338');
    road(32, this.transparent ? 'rgba(176,136,88,0.85)' : '#b48a58');
    road(14, this.transparent ? 'rgba(196,158,106,0.6)' : '#c49e6a');
    // pedrinhas e marcas de roda
    for (let i = 0; i < 130; i++) {
      const p = defensePoint(hash(i + 7));
      const off = (hash(i + 11) - 0.5) * 26;
      g.fillStyle = hash(i) > 0.5 ? 'rgba(90,64,36,0.55)' : 'rgba(235,210,170,0.45)';
      g.beginPath();
      g.ellipse(p.x + Math.cos(p.a + Math.PI / 2) * off, p.y + Math.sin(p.a + Math.PI / 2) * off, 1.6, 1.1, 0, 0, Math.PI * 2);
      g.fill();
    }
    if (s.upgrades.gelo > 0) {
      // gelo: geada nas bordas da estrada
      g.strokeStyle = 'rgba(190,235,255,0.35)';
      g.lineWidth = 3;
      g.setLineDash([3, 6]);
      for (const side of [-17, 17]) {
        g.beginPath();
        for (let d = 0; d <= L; d += 8) {
          const p = defensePoint(d / L);
          const x = p.x + Math.cos(p.a + Math.PI / 2) * side;
          const y = p.y + Math.sin(p.a + Math.PI / 2) * side;
          d ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      }
      g.setLineDash([]);
    }
    if (!this.transparent) {
      // lugares das torres (marcas de pedra no chão)
      for (const sl of SLOTS) {
        g.fillStyle = 'rgba(40,60,30,0.22)';
        g.beginPath();
        g.ellipse(sl.x, sl.y + 2, 15, 7, 0, 0, Math.PI * 2);
        g.fill();
      }
      // árvores e pedras (longe da estrada, dos lugares e do castelo)
      const deco: { x: number; y: number; k: number; s: number }[] = [];
      for (let i = 0; i < 140 && deco.length < 46; i++) {
        const x = 20 + hash(i + 1000) * (W - 40);
        const y = 30 + hash(i + 2000) * (H - 40);
        if (distToRoad(x, y) < 40) continue;
        if (SLOTS.some((sl) => Math.hypot(sl.x - x, sl.y - y) < 26)) continue;
        if (Math.hypot(x - DEFENSE_BASE.x, y - DEFENSE_BASE.y) < 90) continue;
        if (deco.some((d) => Math.hypot(d.x - x, d.y - y) < 26)) continue;
        deco.push({ x, y, k: hash(i + 3000), s: 0.8 + hash(i + 4000) * 0.5 });
      }
      deco.sort((a, b) => a.y - b.y);
      for (const d of deco) {
        if (d.k < 0.62) this.paintTree(g, d.x, d.y, d.s, d.k);
        else if (d.k < 0.82) this.paintRock(g, d.x, d.y, d.s);
        else this.paintBush(g, d.x, d.y, d.s);
      }
    }
    this.bg = { key, canvas: c };
    return c;
  }

  private paintTree(g: CanvasRenderingContext2D, x: number, y: number, s: number, k: number) {
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.beginPath();
    g.ellipse(x + 4, y + 2, 16 * s, 6 * s, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#6b4a2b';
    g.fillRect(x - 2.5 * s, y - 12 * s, 5 * s, 13 * s);
    const greens = k < 0.3 ? ['#2f6b2a', '#3d8a34', '#5aa845'] : ['#2b5e36', '#357a44', '#4b9a58'];
    const blobs: [number, number, number][] = [
      [0, -24, 13],
      [-9, -17, 10],
      [9, -17, 10],
      [0, -14, 11],
    ];
    greens.forEach((c, i) => {
      g.fillStyle = c;
      for (const [bx, by, r] of blobs) {
        g.beginPath();
        g.arc(x + bx * s - i * 1.2, y + by * s - i * 1.8, (r - i * 2.4) * s, 0, Math.PI * 2);
        g.fill();
      }
    });
  }

  private paintRock(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.beginPath();
    g.ellipse(x + 2, y + 2, 12 * s, 5 * s, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#7d8088';
    g.beginPath();
    g.moveTo(x - 11 * s, y);
    g.lineTo(x - 7 * s, y - 9 * s);
    g.lineTo(x + 3 * s, y - 12 * s);
    g.lineTo(x + 11 * s, y - 4 * s);
    g.lineTo(x + 10 * s, y);
    g.closePath();
    g.fill();
    g.fillStyle = '#a3a6ad';
    g.beginPath();
    g.moveTo(x - 6 * s, y - 8 * s);
    g.lineTo(x + 3 * s, y - 11 * s);
    g.lineTo(x + 1 * s, y - 5 * s);
    g.closePath();
    g.fill();
  }

  private paintBush(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
    g.fillStyle = '#2f6b2a';
    for (const [bx, r] of [
      [-6, 7],
      [0, 9],
      [6, 7],
    ]) {
      g.beginPath();
      g.arc(x + bx! * s, y - 5 * s, r! * s, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#ff6b8a';
    g.fillRect(x - 3 * s, y - 9 * s, 2.4, 2.4);
    g.fillRect(x + 4 * s, y - 6 * s, 2.4, 2.4);
  }

  private drawPortal(t: number, active: boolean) {
    const ctx = this.ctx;
    const x = W - 14;
    const y = 122;
    ctx.save();
    ctx.translate(x, y);
    // caverna
    ctx.fillStyle = '#3a3340';
    ctx.beginPath();
    ctx.ellipse(10, 4, 44, 52, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4c4454';
    ctx.beginPath();
    ctx.ellipse(6, 0, 36, 44, 0, 0, Math.PI * 2);
    ctx.fill();
    // redemoinho
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 32);
    glow.addColorStop(0, active ? '#ff5ad1' : '#a06bff');
    glow.addColorStop(0.6, active ? '#7a1fd6' : '#4b2a8a');
    glow.addColorStop(1, '#14081f');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(0, 2, 26, 34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,200,255,0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      const a0 = t * (active ? 3 : 1.2) + (i * Math.PI * 2) / 3;
      for (let k = 0; k < 14; k++) {
        const a = a0 + k * 0.32;
        const r = 4 + k * 1.6;
        const px = Math.cos(a) * r * 0.78;
        const py = 2 + Math.sin(a) * r;
        k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawCastle(s: DefenseSnapshot, t: number, now: number) {
    const ctx = this.ctx;
    const { x, y } = DEFENSE_BASE;
    const ratio = s.baseHp / Math.max(1, s.baseMax);
    const fallen = s.status === 'finished' && s.result === 'lost';
    const walls = s.upgrades.muralha;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(6, 8, 64, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    const stone = fallen ? '#5c5a60' : '#9a9aa6';
    const dark = fallen ? '#47454b' : '#74747f';
    const brick = (bx: number, by: number, bw: number, bh: number) => {
      ctx.fillStyle = stone;
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 1;
      for (let yy = by + 7; yy < by + bh; yy += 7) {
        ctx.beginPath();
        ctx.moveTo(bx, yy);
        ctx.lineTo(bx + bw, yy);
        ctx.stroke();
        for (let xx = bx + ((yy / 7) % 2 ? 5 : 10); xx < bx + bw; xx += 11) {
          ctx.beginPath();
          ctx.moveTo(xx, yy - 7);
          ctx.lineTo(xx, yy);
          ctx.stroke();
        }
      }
    };
    const merlons = (bx: number, by: number, bw: number) => {
      ctx.fillStyle = dark;
      for (let xx = bx; xx < bx + bw - 2; xx += 8) ctx.fillRect(xx, by - 6, 5, 6);
    };
    // muralha extra (melhoria)
    if (walls > 0) {
      ctx.fillStyle = '#857a6a';
      ctx.fillRect(-58, -6 - walls * 2, 120, 14 + walls * 2);
      ctx.fillStyle = '#a69a86';
      for (let xx = -58; xx < 62; xx += 9) ctx.fillRect(xx, -12 - walls * 2, 6, 6);
    }
    if (!fallen) {
      // torres laterais
      brick(-52, -62, 26, 66);
      merlons(-52, -62, 26);
      brick(26, -62, 26, 66);
      merlons(26, -62, 26);
      // corpo
      brick(-30, -44, 60, 48);
      merlons(-30, -44, 60);
      // torre central
      brick(-14, -86, 28, 44);
      merlons(-14, -86, 28);
      // telhados
      ctx.fillStyle = '#c3303a';
      for (const [cx, cy, w] of [
        [-39, -68, 34],
        [39, -68, 34],
        [0, -92, 36],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(cx - w / 2, cy);
        ctx.lineTo(cx, cy - 26);
        ctx.lineTo(cx + w / 2, cy);
        ctx.closePath();
        ctx.fill();
      }
      // bandeira
      ctx.strokeStyle = '#3a2a1a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -118);
      ctx.lineTo(0, -140);
      ctx.stroke();
      ctx.fillStyle = '#ff1f2d';
      ctx.beginPath();
      ctx.moveTo(0, -140);
      for (let k = 0; k <= 8; k++) ctx.lineTo(k * 2.6, -140 + 4 + Math.sin(t * 6 + k * 0.8) * 1.5 + (k / 8) * 1);
      ctx.lineTo(0, -128);
      ctx.closePath();
      ctx.fill();
      // portão
      ctx.fillStyle = '#4a2f1b';
      ctx.beginPath();
      ctx.moveTo(-11, 4);
      ctx.lineTo(-11, -14);
      ctx.arc(0, -14, 11, Math.PI, 0);
      ctx.lineTo(11, 4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      for (let xx = -8; xx <= 8; xx += 4) {
        ctx.beginPath();
        ctx.moveTo(xx, 4);
        ctx.lineTo(xx, -20);
        ctx.stroke();
      }
      // janelas
      ctx.fillStyle = '#1f1a24';
      for (const [wx, wy] of [
        [-42, -40],
        [36, -40],
        [-4, -70],
      ] as const) {
        ctx.beginPath();
        ctx.roundRect(wx, wy, 8, 12, [4, 4, 0, 0]);
        ctx.fill();
      }
      // rachaduras conforme a vida cai
      ctx.strokeStyle = 'rgba(20,10,10,0.6)';
      ctx.lineWidth = 1.4;
      const cracks = ratio < 0.75 ? (ratio < 0.5 ? (ratio < 0.25 ? 3 : 2) : 1) : 0;
      for (let k = 0; k < cracks; k++) {
        const cx = [-22, 14, -40][k]!;
        const cy = [-30, -20, -50][k]!;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + 5, cy + 7);
        ctx.lineTo(cx + 2, cy + 12);
        ctx.lineTo(cx + 8, cy + 18);
        ctx.stroke();
      }
    } else {
      // escombros
      ctx.fillStyle = stone;
      for (let k = 0; k < 18; k++) {
        const bx = -55 + hash(k) * 110;
        const by = -18 + hash(k + 20) * 22;
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(hash(k + 40) * 2);
        ctx.fillRect(-7, -5, 14, 10);
        ctx.restore();
      }
      brick(-52, -24, 22, 28);
      brick(30, -34, 22, 38);
    }
    ctx.restore();

    // vida da base
    if (s.status !== 'lobby') {
      const bw = 104;
      const bx = x - bw / 2;
      const by = y - 156;
      ctx.fillStyle = 'rgba(8,8,14,0.8)';
      ctx.beginPath();
      ctx.roundRect(bx - 3, by - 3, bw + 6, 14, 7);
      ctx.fill();
      const col = ratio > 0.5 ? '#3ddc6b' : ratio > 0.25 ? '#ffc83d' : '#ff4d5e';
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.roundRect(bx, by, Math.max(0, bw * ratio), 8, 4);
      ctx.fill();
      if (ratio <= 0.25 && !fallen && Math.sin(now / 120) > 0) {
        ctx.strokeStyle = '#ff4d5e';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(bx - 3, by - 3, bw + 6, 14, 7);
        ctx.stroke();
      }
      ctx.font = '900 10px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText(`🏰 ${Math.max(0, Math.ceil(s.baseHp))}/${s.baseMax}`, x, by - 6);
    }
  }

  private drawTower(tw: ShownTower, t: number, now: number) {
    const ctx = this.ctx;
    const cls = DEFENSE_CLASS_IDS[tw.cls] ?? 'arqueiro';
    const color = this.colorOf(tw.id);
    const born = Math.min(1, (now - tw.bornAt) / 350);
    const pop = born < 1 ? 0.6 + 0.4 * Math.sin((born * Math.PI) / 2) + Math.sin(born * Math.PI) * 0.15 : 1;
    const recoil = Math.max(0, 1 - (now - tw.firedAt) / 160);
    ctx.save();
    ctx.translate(tw.x, tw.y);
    ctx.scale(pop, pop);
    // sombra e aura do tiro forte
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(3, 2, 15, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    if (tw.power === 2) {
      const a = 0.45 + Math.sin(t * 8) * 0.25;
      ctx.strokeStyle = `rgba(255,200,61,${a})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, 18, 8, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    const fire = this.state && this.state.upgrades.fogo > 0;
    if (cls === 'canhao') {
      // bastião baixo e largo
      ctx.fillStyle = '#6f6a66';
      ctx.beginPath();
      ctx.ellipse(0, -2, 14, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8b857f';
      ctx.fillRect(-14, -16, 28, 14);
      ctx.fillStyle = '#a49d96';
      ctx.beginPath();
      ctx.ellipse(0, -16, 14, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillRect(-14, -9, 28, 3);
      // cano
      ctx.save();
      ctx.translate(0, -18);
      ctx.rotate(tw.angle);
      ctx.translate(-recoil * 4, 0);
      ctx.fillStyle = '#26262b';
      ctx.beginPath();
      ctx.roundRect(-4, -4.5, 20, 9, 3);
      ctx.fill();
      ctx.fillStyle = '#3d3d45';
      ctx.fillRect(14, -5.5, 4, 11);
      ctx.restore();
      ctx.fillStyle = '#4a3420';
      ctx.beginPath();
      ctx.arc(0, -15, 5, 0, Math.PI * 2);
      ctx.fill();
      if (recoil > 0.5) {
        ctx.fillStyle = `rgba(255,200,120,${recoil})`;
        ctx.beginPath();
        ctx.arc(Math.cos(tw.angle) * 22, -18 + Math.sin(tw.angle) * 22, 6 * recoil, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // torre de pedra
      const h = cls === 'mago' ? 30 : 24;
      ctx.fillStyle = '#7d7b84';
      ctx.fillRect(-10, -h, 20, h);
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(4, -h, 6, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 1;
      for (let yy = -h + 6; yy < 0; yy += 6) {
        ctx.beginPath();
        ctx.moveTo(-10, yy);
        ctx.lineTo(10, yy);
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.fillRect(-10, -h + 4, 20, 3);
      if (cls === 'arqueiro') {
        // plataforma de madeira + arqueiro
        ctx.fillStyle = '#8a5a30';
        ctx.fillRect(-13, -h - 4, 26, 5);
        ctx.fillStyle = '#6e4626';
        for (let xx = -13; xx < 13; xx += 6) ctx.fillRect(xx, -h - 9, 4, 5);
        const ax = 0;
        const ay = -h - 12;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(ax - 4, ay - 2, 8, 9, 3);
        ctx.fill();
        ctx.fillStyle = '#f1c9a0';
        ctx.beginPath();
        ctx.arc(ax, ay - 5, 3.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2f6b2a';
        ctx.beginPath();
        ctx.moveTo(ax - 4, ay - 6);
        ctx.lineTo(ax + 4, ay - 6);
        ctx.lineTo(ax + 1, ay - 13);
        ctx.closePath();
        ctx.fill();
        // arco
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(tw.angle);
        ctx.strokeStyle = '#5a3a1a';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(4, 0, 7, -1.2, 1.2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(4 + Math.cos(-1.2) * 7, Math.sin(-1.2) * 7);
        ctx.lineTo(4 - recoil * 0 - (recoil ? 0 : 3), 0);
        ctx.lineTo(4 + Math.cos(1.2) * 7, Math.sin(1.2) * 7);
        ctx.stroke();
        ctx.restore();
      } else {
        // telhado cônico roxo e orbe flutuando
        ctx.fillStyle = '#5a2d8a';
        ctx.beginPath();
        ctx.moveTo(-13, -h);
        ctx.lineTo(0, -h - 18);
        ctx.lineTo(13, -h);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#7a45b8';
        ctx.beginPath();
        ctx.moveTo(-13, -h);
        ctx.lineTo(0, -h - 18);
        ctx.lineTo(-3, -h);
        ctx.closePath();
        ctx.fill();
        const oy = -h - 26 + Math.sin(t * 3 + tw.id) * 2;
        const pulse = 0.6 + recoil * 0.8 + Math.sin(t * 4 + tw.id) * 0.15;
        const g = ctx.createRadialGradient(0, oy, 1, 0, oy, 12 * pulse);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.35, '#d9a6ff');
        g.addColorStop(1, 'rgba(180,107,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, oy, 12 * pulse, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (fire) {
      // melhoria de fogo: chama no alto da torre
      const top = cls === 'canhao' ? -26 : cls === 'mago' ? -50 : -44;
      const f = 3 + Math.sin(t * 14 + tw.id) * 1.2;
      ctx.fillStyle = 'rgba(255,120,40,0.9)';
      ctx.beginPath();
      ctx.moveTo(-3, top + 4);
      ctx.quadraticCurveTo(0, top - f * 2, 3, top + 4);
      ctx.fill();
    }
    // nível: estrelinhas
    if (tw.level > 1) {
      ctx.fillStyle = '#ffc83d';
      ctx.font = '900 8px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('★'.repeat(Math.min(5, tw.level - 1)), 0, 11);
    }
    ctx.restore();
  }

  private drawMonster(m: ShownMonster, x: number, y: number, a: number, t: number, now: number) {
    const ctx = this.ctx;
    const def = DEFENSE_MONSTERS[m.kind];
    const flip = Math.cos(a) < 0 ? -1 : 1;
    const step = Math.sin(t * (m.kind === 'lobo' ? 18 : 9) + m.id);
    const hurt = now - m.hitAt < 90;
    const s = def.size;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(0, 2, s * 0.9, s * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.scale(flip, 1);
    const bob = Math.abs(step) * (m.kind === 'ogro' || m.kind === 'rei' ? 1.2 : 2);
    ctx.translate(0, -bob);
    if (m.kind === 'goblin') this.paintGoblin(s, step, hurt);
    else if (m.kind === 'lobo') this.paintWolf(s, step, hurt);
    else this.paintOgre(s, step, hurt, m.kind === 'rei');
    ctx.restore();

    // gelo / fogo
    if (m.slow) {
      ctx.fillStyle = 'rgba(160,220,255,0.35)';
      ctx.beginPath();
      ctx.ellipse(x, y - s * 0.7, s * 1.05, s * 0.95, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e6f8ff';
      ctx.fillRect(x - s * 0.6, y - s * 1.5, 2, 2);
      ctx.fillRect(x + s * 0.5, y - s * 0.9, 2, 2);
    }
    if (m.burn) {
      for (let i = 0; i < 3; i++) {
        const fx = x + (i - 1) * s * 0.5;
        const fy = y - s * 1.4 - Math.abs(Math.sin(t * 10 + i * 2 + m.id)) * 4;
        ctx.fillStyle = i === 1 ? '#ffd23d' : '#ff6a2d';
        ctx.beginPath();
        ctx.moveTo(fx - 2.5, fy + 5);
        ctx.quadraticCurveTo(fx, fy - 4, fx + 2.5, fy + 5);
        ctx.fill();
      }
    }
    // vida
    if (m.hp < 1 || m.kind === 'rei') {
      const bw = m.kind === 'rei' ? 60 : s * 2.2;
      const by = y - s * 2.1 - (m.kind === 'rei' ? 14 : 0);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - bw / 2 - 1, by - 1, bw + 2, 5);
      ctx.fillStyle = m.hp > 0.5 ? '#3ddc6b' : m.hp > 0.25 ? '#ffc83d' : '#ff4d5e';
      ctx.fillRect(x - bw / 2, by, bw * Math.max(0, m.hp), 3);
      if (m.kind === 'rei') {
        ctx.font = '900 10px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffc83d';
        ctx.fillText('👑 REI OGRO', x, by - 4);
      }
    }
  }

  private paintGoblin(s: number, step: number, hurt: boolean) {
    const ctx = this.ctx;
    const skin = hurt ? '#ffffff' : '#62b34a';
    // pernas
    ctx.strokeStyle = '#3b6b2c';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-3, -4);
    ctx.lineTo(-3 + step * 3, 0);
    ctx.moveTo(3, -4);
    ctx.lineTo(3 - step * 3, 0);
    ctx.stroke();
    // corpo (tanga marrom)
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.ellipse(0, -9, s * 0.6, s * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7a4a24';
    ctx.fillRect(-s * 0.6, -7, s * 1.2, 4);
    // cabeça e orelhas
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(1, -s * 1.45, s * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-3, -s * 1.6);
    ctx.lineTo(-11, -s * 1.95);
    ctx.lineTo(-3, -s * 1.3);
    ctx.moveTo(5, -s * 1.6);
    ctx.lineTo(12, -s * 1.95);
    ctx.lineTo(5, -s * 1.3);
    ctx.fill();
    ctx.fillStyle = '#ffdf3d';
    ctx.fillRect(2, -s * 1.55, 2.2, 2.2);
    ctx.fillRect(5.5, -s * 1.55, 2.2, 2.2);
    // porrete
    ctx.strokeStyle = '#6e4626';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(5, -9);
    ctx.lineTo(11, -16 - step * 2);
    ctx.stroke();
  }

  private paintWolf(s: number, step: number, hurt: boolean) {
    const ctx = this.ctx;
    const fur = hurt ? '#ffffff' : '#8a8f99';
    ctx.strokeStyle = '#5c616b';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-7, -5);
    ctx.lineTo(-7 + step * 4, 0);
    ctx.moveTo(-3, -5);
    ctx.lineTo(-3 - step * 4, 0);
    ctx.moveTo(5, -5);
    ctx.lineTo(5 + step * 4, 0);
    ctx.moveTo(9, -5);
    ctx.lineTo(9 - step * 4, 0);
    ctx.stroke();
    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.ellipse(1, -8, s * 1.1, s * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // rabo
    ctx.beginPath();
    ctx.moveTo(-s, -9);
    ctx.quadraticCurveTo(-s - 8, -14 - step * 2, -s - 10, -8);
    ctx.lineTo(-s, -7);
    ctx.fill();
    // cabeça
    ctx.beginPath();
    ctx.ellipse(s + 2, -12, 6, 5, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(s + 6, -12);
    ctx.lineTo(s + 13, -10);
    ctx.lineTo(s + 6, -8);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(s - 1, -15);
    ctx.lineTo(s + 1, -22);
    ctx.lineTo(s + 4, -16);
    ctx.fill();
    ctx.fillStyle = '#ff3d3d';
    ctx.fillRect(s + 4, -14, 2, 2);
  }

  private paintOgre(s: number, step: number, hurt: boolean, king: boolean) {
    const ctx = this.ctx;
    const skin = hurt ? '#ffffff' : king ? '#7d8f3e' : '#8c9a4c';
    if (king) {
      // capa
      ctx.fillStyle = '#5a1f8a';
      ctx.beginPath();
      ctx.moveTo(-s * 0.7, -s * 1.5);
      ctx.lineTo(-s * 1.2, -2);
      ctx.lineTo(s * 0.2, -2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = '#5a6330';
    ctx.lineWidth = s * 0.3;
    ctx.beginPath();
    ctx.moveTo(-s * 0.35, -s * 0.5);
    ctx.lineTo(-s * 0.35 + step * 3, 0);
    ctx.moveTo(s * 0.35, -s * 0.5);
    ctx.lineTo(s * 0.35 - step * 3, 0);
    ctx.stroke();
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.95, s * 0.8, s * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,220,0.25)';
    ctx.beginPath();
    ctx.ellipse(s * 0.1, -s * 0.8, s * 0.45, s * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    // ombreira de ferro
    ctx.fillStyle = '#9aa0a8';
    ctx.beginPath();
    ctx.ellipse(-s * 0.45, -s * 1.45, s * 0.38, s * 0.22, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c7ccd3';
    ctx.fillRect(-s * 0.6, -s * 1.52, 3, 2);
    // cabeça
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(s * 0.25, -s * 1.8, s * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(s * 0.32, -s * 1.62, 2, 3);
    ctx.fillRect(s * 0.48, -s * 1.62, 2, 3);
    ctx.fillStyle = king ? '#ff3d3d' : '#1f1f1f';
    ctx.fillRect(s * 0.3, -s * 1.9, 2.4, 2.4);
    ctx.fillRect(s * 0.48, -s * 1.9, 2.4, 2.4);
    if (king) {
      ctx.fillStyle = '#ffc83d';
      ctx.beginPath();
      ctx.moveTo(s * 0.02, -s * 2.08);
      ctx.lineTo(s * 0.06, -s * 2.4);
      ctx.lineTo(s * 0.18, -s * 2.2);
      ctx.lineTo(s * 0.27, -s * 2.45);
      ctx.lineTo(s * 0.36, -s * 2.2);
      ctx.lineTo(s * 0.48, -s * 2.4);
      ctx.lineTo(s * 0.5, -s * 2.08);
      ctx.closePath();
      ctx.fill();
    }
    // porrete
    ctx.save();
    ctx.translate(s * 0.75, -s * 1.1);
    ctx.rotate(-0.9 + step * 0.25);
    ctx.fillStyle = '#6e4626';
    ctx.beginPath();
    ctx.roundRect(-2, -s * 1.1, 5, s * 1.2, 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0.5, -s * 1.1, 4.5, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawAlly(x: number, y: number, t: number) {
    const ctx = this.ctx;
    const step = Math.sin(t * 14);
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 6, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2b3550';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-2, -4);
    ctx.lineTo(-2 + step * 2.5, 0);
    ctx.moveTo(2, -4);
    ctx.lineTo(2 - step * 2.5, 0);
    ctx.stroke();
    ctx.fillStyle = '#2f7dff';
    ctx.beginPath();
    ctx.roundRect(-4, -12, 8, 9, 2);
    ctx.fill();
    ctx.fillStyle = '#d7dce5';
    ctx.beginPath();
    ctx.arc(0, -15, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffc83d';
    ctx.beginPath();
    ctx.ellipse(4.5, -8, 3, 4.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#c9ced8';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-4, -2);
    ctx.lineTo(4, -22);
    ctx.stroke();
    ctx.restore();
  }

  private drawHero(name: string, t: number, now: number) {
    const ctx = this.ctx;
    const { x, y } = HERO_AT;
    const flash = Math.max(0, 1 - (now - this.heroFlashAt) / 900);
    ctx.save();
    ctx.translate(x, y);
    const g = ctx.createRadialGradient(0, -10, 2, 0, -10, 30 + flash * 30);
    g.addColorStop(0, 'rgba(255,220,120,0.55)');
    g.addColorStop(1, 'rgba(255,200,61,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, -10, 30 + flash * 30, 0, Math.PI * 2);
    ctx.fill();
    // capa
    ctx.fillStyle = '#ff1f2d';
    ctx.beginPath();
    ctx.moveTo(-5, -20);
    ctx.lineTo(-11 - Math.sin(t * 6) * 2, 2);
    ctx.lineTo(4, 0);
    ctx.closePath();
    ctx.fill();
    // corpo de armadura dourada
    ctx.fillStyle = '#ffc83d';
    ctx.beginPath();
    ctx.roundRect(-6, -20, 12, 16, 3);
    ctx.fill();
    ctx.fillStyle = '#e0a92a';
    ctx.fillRect(-6, -10, 12, 3);
    ctx.fillStyle = '#d9dde5';
    ctx.beginPath();
    ctx.arc(0, -25, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1f2330';
    ctx.fillRect(-3, -26, 6, 2);
    // espada erguida
    ctx.strokeStyle = '#eef3ff';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(7, -16);
    ctx.lineTo(16, -36 + Math.sin(t * 5) * 2);
    ctx.stroke();
    ctx.restore();
    drawNameTags(this.ctx, [{ x, y: y - 36, name: `🦸 ${name}`, color: '#ffc83d', priority: 1e6, leader: true, crown: false }], 9, 18);
  }

  private drawProj(pr: Proj, now: number) {
    const ctx = this.ctx;
    const k = Math.min(1, (now - pr.t0) / pr.dur);
    const x = pr.x0 + (pr.tx - pr.x0) * k;
    let y = pr.y0 + (pr.ty - pr.y0) * k;
    const ang = Math.atan2(pr.ty - pr.y0, pr.tx - pr.x0);
    const big = pr.power ? 1.6 : 1;
    if (pr.kind === 'arrow') {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      if (pr.power) {
        ctx.strokeStyle = 'rgba(255,200,61,0.6)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-14, 0);
        ctx.lineTo(4, 0);
        ctx.stroke();
      }
      ctx.strokeStyle = '#5a3a1a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-8 * big, 0);
      ctx.lineTo(4, 0);
      ctx.stroke();
      ctx.fillStyle = '#d7dce5';
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(2, -2.2);
      ctx.lineTo(2, 2.2);
      ctx.fill();
      ctx.fillStyle = '#ff4d5e';
      ctx.fillRect(-9 * big, -1.5, 3, 3);
      ctx.restore();
    } else if (pr.kind === 'orb') {
      for (let i = 4; i >= 0; i--) {
        const kk = Math.max(0, k - i * 0.05);
        const tx = pr.x0 + (pr.tx - pr.x0) * kk;
        const ty = pr.y0 + (pr.ty - pr.y0) * kk;
        ctx.fillStyle = `rgba(190,120,255,${0.18 * (5 - i)})`;
        ctx.beginPath();
        ctx.arc(tx, ty, (4.5 - i * 0.6) * big, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = pr.power ? '#ffe9a8' : '#f2e2ff';
      ctx.beginPath();
      ctx.arc(x, y, 2.4 * big, 0, Math.PI * 2);
      ctx.fill();
    } else if (pr.kind === 'ball') {
      const d = Math.hypot(pr.tx - pr.x0, pr.ty - pr.y0);
      const arc = Math.sin(k * Math.PI) * Math.min(60, d * 0.35);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(x, y + 4, 4 * big, 1.8 * big, 0, 0, Math.PI * 2);
      ctx.fill();
      y -= arc;
      ctx.fillStyle = pr.power ? '#ffb02e' : '#1d1d22';
      ctx.beginPath();
      ctx.arc(x, y, 4 * big, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.arc(x - 1.2, y - 1.4, 1.3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = `rgba(255,220,120,${1 - k})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(pr.x0, pr.y0);
      const segs = 5;
      for (let i = 1; i <= segs; i++) {
        const kk = i / segs;
        const jx = i < segs ? (hash(pr.t0 + i) - 0.5) * 12 : 0;
        const jy = i < segs ? (hash(pr.t0 + i + 9) - 0.5) * 12 : 0;
        ctx.lineTo(pr.x0 + (pr.tx - pr.x0) * kk + jx, pr.y0 + (pr.ty - pr.y0) * kk + jy);
      }
      ctx.stroke();
    }
  }

  private drawFx(f: Fx, now: number) {
    const ctx = this.ctx;
    const k = Math.min(1, (now - f.t0) / f.max);
    switch (f.kind) {
      case 'boom': {
        const r = (f.r ?? 30) * (0.4 + k * 0.8);
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
        g.addColorStop(0, `rgba(255,250,220,${(1 - k) * 0.9})`);
        g.addColorStop(0.4, hexA(f.color ?? '#ff9a3d', (1 - k) * 0.75));
        g.addColorStop(1, hexA(f.color ?? '#ff9a3d', 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
        ctx.fill();
        if (f.big) {
          ctx.strokeStyle = `rgba(255,220,160,${1 - k})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(f.x, f.y, (f.r ?? 30) * (0.6 + k), 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      }
      case 'poof':
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          ctx.fillStyle = `rgba(230,230,230,${(1 - k) * 0.7})`;
          ctx.beginPath();
          ctx.arc(f.x + Math.cos(a) * k * 12, f.y - 8 + Math.sin(a) * k * 8 - k * 6, 5 * (1 - k * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'spark':
        ctx.fillStyle = hexA(f.color ?? '#ffd23d', 1 - k);
        ctx.fillRect(f.x - 1.2, f.y - 1.2, 2.4, 2.4);
        break;
      case 'ring':
        ctx.strokeStyle = hexA(f.color ?? '#ffffff', 1 - k);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(f.x, f.y, (f.r ?? 20) * (0.3 + k), (f.r ?? 20) * (0.3 + k) * 0.55, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'dust':
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          ctx.fillStyle = `rgba(200,180,140,${(1 - k) * 0.7})`;
          ctx.beginPath();
          ctx.arc(f.x + Math.cos(a) * (8 + k * 14), f.y + Math.sin(a) * (3 + k * 5), 3, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'scorch':
        ctx.fillStyle = `rgba(30,20,15,${0.45 * (1 - k)})`;
        ctx.beginPath();
        ctx.ellipse(f.x, f.y, f.r ?? 40, (f.r ?? 40) * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'meteor': {
        const sx = f.x + 260;
        const sy = -60;
        const x = sx + (f.x - sx) * k;
        const y = sy + (f.y - sy) * k * k;
        for (let i = 0; i < 8; i++) {
          const kk = Math.max(0, k - i * 0.03);
          ctx.fillStyle = `rgba(255,${140 - i * 12},40,${0.5 - i * 0.05})`;
          ctx.beginPath();
          ctx.arc(sx + (f.x - sx) * kk, sy + (f.y - sy) * kk * kk, 12 - i, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#5a2a1a';
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffb02e';
        ctx.beginPath();
        ctx.arc(x - 3, y - 3, 4, 0, Math.PI * 2);
        ctx.fill();
        // alvo no chão
        ctx.strokeStyle = `rgba(255,80,60,${0.4 + 0.4 * Math.sin(now / 60)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(f.x, f.y, f.r ?? 80, (f.r ?? 80) * 0.5, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'text': {
        const y = f.y - k * 22;
        ctx.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
        ctx.font = `900 ${f.big ? 18 : 12}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.strokeText(f.text ?? '', f.x, y);
        ctx.fillStyle = f.color ?? '#fff';
        ctx.fillText(f.text ?? '', f.x, y);
        ctx.globalAlpha = 1;
        break;
      }
    }
  }

  private drawTags(s: DefenseSnapshot) {
    const ranked = [...this.kills.entries()].sort((a, b) => b[1] - a[1]);
    const topIds = new Set(ranked.slice(0, 5).map(([id]) => id));
    const leader = ranked[0]?.[0];
    const tags: NameTag[] = [];
    for (const tw of this.towers.values()) {
      const r = this.roster.get(tw.id);
      if (!r) continue;
      if (this.names === 'top' && !topIds.has(tw.id) && s.status !== 'lobby') continue;
      const kills = this.kills.get(tw.id) ?? 0;
      const h = DEFENSE_CLASS_IDS[tw.cls] === 'canhao' ? 30 : DEFENSE_CLASS_IDS[tw.cls] === 'mago' ? 58 : 46;
      tags.push({
        x: tw.x,
        y: tw.y - h,
        name: r.name,
        color: r.color,
        priority: (r.bot ? 0 : 100) + kills + tw.level * 5,
        leader: tw.id === leader && kills > 0,
        suffix: kills ? `${kills}💀` : undefined,
        alpha: r.bot ? 0.7 : 1,
      });
    }
    drawNameTags(this.ctx, tags, 8.5, 12);
  }
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

/** Miniatura do mapa para o painel (estrada, castelo e portal). */
export function drawDefenseThumb(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  const sx = canvas.width / W;
  const sy = canvas.height / H;
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  ctx.fillStyle = '#4f8c3c';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#b48a58';
  ctx.lineWidth = 34;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  DEFENSE_PATH.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  ctx.fillStyle = '#9a9aa6';
  ctx.fillRect(DEFENSE_BASE.x - 40, DEFENSE_BASE.y - 70, 80, 74);
  ctx.fillStyle = '#c3303a';
  ctx.beginPath();
  ctx.moveTo(DEFENSE_BASE.x - 44, DEFENSE_BASE.y - 70);
  ctx.lineTo(DEFENSE_BASE.x, DEFENSE_BASE.y - 110);
  ctx.lineTo(DEFENSE_BASE.x + 44, DEFENSE_BASE.y - 70);
  ctx.fill();
  const colors = DEFENSE_CLASS_IDS.map((c) => DEFENSE_CLASSES[c].color);
  SLOTS.slice(0, 18).forEach((s, i) => {
    ctx.fillStyle = colors[i % 3]!;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 11, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = '#7a1fd6';
  ctx.beginPath();
  ctx.ellipse(W - 10, 122, 30, 40, 0, 0, Math.PI * 2);
  ctx.fill();
}
