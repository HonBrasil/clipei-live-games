import type { BossHit, BossSkinId, BossSnapshot } from '@clipei/shared';
import {
  bossDef,
  bossSize,
  HERO_H,
  HERO_W,
  bossPixels,
  bossSprite,
  hashString,
  heroSprite,
  shade,
  type HeroClass,
} from './sprites.ts';
import type { Sfx } from './sfx.ts';

/**
 * Arena 2D do Boss coletivo, desenhada em <canvas>.
 *
 * - O boss fica no centro, em pixel art, com animações de respiração,
 *   dano, pisão (ataque em área), fases, explosão na vitória e fuga.
 * - Cada espectador que ataca vira um mini-herói (cavaleiro, mago ou
 *   arqueiro) posicionado em anéis em volta do boss.
 * - O servidor é a fonte da verdade (vida, ranking). A arena só encena
 *   os golpes que chegam — com limite de animações para manter 60 fps
 *   mesmo com centenas de mensagens por segundo.
 */

export const W = 960;
export const H = 540;
const HERO_SCALE = 3;
const CX = 480;
const RING_Y = 440;
const BOSS_FEET = 420;

/** Geometria do boss atual (cada boss tem um tamanho de sprite). */
function geometry(skin: BossSkinId) {
  const { w, h } = bossSize(skin);
  const scale = Math.max(5, Math.round(216 / h));
  return { skin, w, h, scale, center: { x: CX, y: BOSS_FEET - (h * scale) / 2 } };
}
let geom = geometry('glitchador');

const DEFAULT_COLORS = ['#ff4b55', '#ffffff', '#ffc83d', '#2fe38a', '#3fa9ff', '#ff7a1a', '#c77dff', '#9ef01a'];
const MAX_PARTICLES = 600;
const SPECIAL_COLORS: Record<NonNullable<BossHit['special']>, string> = {
  bits: '#c77dff',
  sub: '#ffc83d',
  gift: '#ffc83d',
  points: '#ff4b55',
  raid: '#2fe38a',
};
const MAX_TEXTS = 14;
const MAX_NORMAL_TEXTS = 7;
const MAX_BIG_TEXTS = 3;
const NAME_TAGS = 10;

type Phase = 1 | 2 | 3;

interface Slot {
  x: number;
  y: number;
  facingLeft: boolean;
  hero: Hero | null;
}

interface Hero {
  id: string;
  name: string;
  color: string;
  cls: HeroClass;
  skin: number;
  slot: Slot;
  x: number;
  y: number;
  state: 'enter' | 'idle' | 'attack';
  t0: number;
  attack: BossHit | null;
  pending: BossHit | null;
  firedAt: number;
  lastActive: number;
  nameUntil: number;
  hopT0: number;
  bob: number;
}

interface Projectile {
  x: number;
  y: number;
  tx: number;
  ty: number;
  vx: number;
  vy: number;
  kind: 'bolt' | 'arrow' | 'ult' | 'crowd' | 'crystal' | 'runner';
  /** só efeito visual: o dano e o número já foram mostrados por outro projétil */
  cosmetic?: boolean;
  /** corredor do raid: aparência do herói */
  hero?: { cls: HeroClass; color: string; skin: number };
  hit: BossHit;
  trail: { x: number; y: number }[];
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  gravity: number;
}

interface FloatText {
  x: number;
  y: number;
  vy: number;
  life: number;
  max: number;
  text: string;
  sub?: string;
  color: string;
  size: number;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  color: string;
}

export class Arena {
  private ctx: CanvasRenderingContext2D;
  private slots: Slot[] = [];
  private heroes = new Map<string, Hero>();
  private projectiles: Projectile[] = [];
  private particles: Particle[] = [];
  private texts: FloatText[] = [];
  private rings: Ring[] = [];
  private crowdBudget = 0;

  private status: BossSnapshot['status'] = 'idle';
  private phase: Phase = 1;
  private fightId: number | null = null;
  private topName: string | null = null;

  private flashUntil = 0;
  private lastFlash = 0;
  private shakeUntil = 0;
  private shakeMag = 0;
  private slamT0 = -1;
  private nextSlamAt = 0;
  private deathT0 = -1;
  private exploded = false;
  private escapeT0 = -1;
  private screenFlash = 0;
  private bolts: { x: number; life: number; max: number; points: { x: number; y: number }[] }[] = [];
  private scheduled: { at: number; run: () => void }[] = [];
  private showFloor = true;
  private backdrop = false;
  private backdropCache: { key: string; canvas: HTMLCanvasElement } | null = null;
  private res = 1;
  private last = performance.now();

  constructor(
    private canvas: HTMLCanvasElement,
    private sfx: Sfx | null = null,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.setResolution(1);
    this.buildSlots();
    requestAnimationFrame(this.frame);
  }

  // ─── Configuração ────────────────────────────────────────────

  /**
   * Resolução interna do canvas. A arena é desenhada em 960×540 "lógicos";
   * quando o streamer aumenta o tamanho ou usa tela 1440p/4K, sobe a resolução
   * para o texto e os números continuarem nítidos.
   */
  setResolution(res: number) {
    const r = Math.max(1, Math.min(2.5, Math.round(res * 4) / 4));
    if (r === this.res && this.canvas.width === Math.round(W * r)) return;
    this.res = r;
    this.canvas.width = Math.round(W * r);
    this.canvas.height = Math.round(H * r);
    this.ctx.imageSmoothingEnabled = false;
  }

  setFloor(show: boolean) {
    this.showFloor = show;
  }

  /** Tela cheia: cenário completo atrás do boss (céu, montanhas e chão). */
  setBackdrop(on: boolean) {
    this.backdrop = on;
  }

  // ─── Entrada de dados ────────────────────────────────────────

  setState(s: BossSnapshot) {
    const now = performance.now();
    if (s.skin && s.skin !== geom.skin) geom = geometry(s.skin);
    const isNewFight = s.startedAt !== null && s.startedAt !== this.fightId;
    if (isNewFight) this.reset(s.startedAt!);

    if (this.status === 'running' && s.status === 'victory') this.deathT0 = now;
    if (this.status === 'running' && s.status === 'escaped') {
      this.escapeT0 = now;
      this.sfx?.play('escape');
    }
    if (isNewFight && s.status === 'running') this.sfx?.play('spawn');
    if (s.phase > this.phase && s.status === 'running') this.onPhase(s.phase as Phase, now);

    this.status = s.status;
    this.phase = s.phase as Phase;
    this.topName = s.leaderboard[0]?.name ?? null;
    if (s.status === 'running') this.ingest(s.recentHits, now);
    // o golpe de apoio que derrubou o boss também merece o efeito
    else this.ingest(s.recentHits.filter((h) => h.special), now);
  }

  private reset(fightId: number) {
    this.fightId = fightId;
    this.heroes.clear();
    this.slots.forEach((s) => (s.hero = null));
    this.projectiles = [];
    this.particles = [];
    this.texts = [];
    this.rings = [];
    this.bolts = [];
    this.scheduled = [];
    this.phase = 1;
    this.deathT0 = -1;
    this.escapeT0 = -1;
    this.exploded = false;
    this.nextSlamAt = performance.now() + 6000;
  }

  private ingest(hits: BossHit[], now: number) {
    this.crowdBudget = 8;
    for (const hit of hits) {
      if (hit.special) {
        this.specialStrike(hit, now);
        continue;
      }
      let hero = this.heroes.get(hit.id) ?? this.spawnHero(hit, now);
      if (!hero) {
        this.crowdHit(hit, now);
        continue;
      }
      hero.name = hit.name;
      hero.lastActive = now;
      hero.nameUntil = now + 2600;
      if (hero.state === 'idle') this.startAttack(hero, hit, now);
      else if (!hero.pending || hit.ult) hero.pending = hit;
    }
  }

  // ─── Heróis ──────────────────────────────────────────────────

  private buildSlots() {
    const rings = [
      { rx: 205, ry: 40, n: 12 },
      { rx: 298, ry: 62, n: 16 },
      { rx: 392, ry: 84, n: 20 },
    ];
    const slots: (Slot & { score: number })[] = [];
    rings.forEach((ring, ri) => {
      for (let i = 0; i < ring.n; i++) {
        const a = (i / ring.n) * Math.PI * 2 + (ri % 2) * (Math.PI / ring.n);
        const sin = Math.sin(a);
        const cos = Math.cos(a);
        if (sin < -0.3 && Math.abs(cos) < 0.75) continue; // atrás do boss, ficaria escondido
        const x = CX + ring.rx * cos;
        slots.push({ x, y: RING_Y + ring.ry * sin, facingLeft: x > CX, hero: null, score: ri * 10 - sin * 3 });
      }
    });
    // os primeiros a chegar ficam na frente, perto do boss
    this.slots = slots.sort((a, b) => a.score - b.score);
  }

  private spawnHero(hit: BossHit, now: number): Hero | null {
    let slot = this.slots.find((s) => !s.hero);
    if (!slot) {
      // troca o herói mais parado (fora o 1º do ranking) se estiver inativo há 5s
      let oldest: Hero | null = null;
      for (const h of this.heroes.values()) {
        if (h.state !== 'idle' || h.name === this.topName) continue;
        if (!oldest || h.lastActive < oldest.lastActive) oldest = h;
      }
      if (!oldest || now - oldest.lastActive < 5000) return null;
      this.heroes.delete(oldest.id);
      this.puff(oldest.x, oldest.y - 20, '#ffffff', 10);
      slot = oldest.slot;
    }
    const h = hashString(hit.id);
    const roll = h % 100;
    const hero: Hero = {
      id: hit.id,
      name: hit.name,
      color: validColor(hit.color) ?? DEFAULT_COLORS[h % DEFAULT_COLORS.length],
      cls: roll < 45 ? 'knight' : roll < 75 ? 'mage' : 'archer',
      skin: (h >> 8) % 4,
      slot,
      x: slot.x,
      y: slot.y,
      state: 'enter',
      t0: now,
      attack: null,
      pending: hit,
      firedAt: 0,
      lastActive: now,
      nameUntil: now + 2600,
      hopT0: -1,
      bob: (h % 1000) / 1000,
    };
    slot.hero = hero;
    this.heroes.set(hit.id, hero);
    return hero;
  }

  private startAttack(hero: Hero, hit: BossHit, now: number) {
    hero.state = 'attack';
    hero.t0 = now;
    hero.attack = hit;
    hero.firedAt = 0;
  }

  private updateHero(hero: Hero, now: number) {
    const t = now - hero.t0;
    const { slot } = hero;

    if (hero.state === 'enter') {
      // cai do céu
      const d = Math.min(1, t / 380);
      hero.x = slot.x;
      hero.y = slot.y - 300 * (1 - d) * (1 - d);
      if (d >= 1) {
        this.puff(slot.x, slot.y, '#ffffff', 6);
        hero.state = 'idle';
        if (hero.pending) {
          const p = hero.pending;
          hero.pending = null;
          this.startAttack(hero, p, now);
        }
      }
      return;
    }

    if (hero.state === 'attack' && hero.attack) {
      const hit = hero.attack;
      if (hit.ult) {
        // ULT: pulo alto e meteoro dourado
        const up = Math.sin(Math.min(1, t / 650) * Math.PI);
        hero.x = slot.x;
        hero.y = slot.y - up * 70;
        if (!hero.firedAt && t > 260) {
          hero.firedAt = now;
          this.fire(hero.x, hero.y - 40, 'ult', hit);
        }
        if (t > 650) this.finishAttack(hero, now);
        return;
      }
      if (hero.cls === 'knight') {
        // investida até o boss, corte e volta
        const target = towardBoss(slot.x, slot.y, 120);
        const go = t < 170 ? easeOut(t / 170) : t < 260 ? 1 : 1 - easeIn(Math.min(1, (t - 260) / 240));
        hero.x = slot.x + (target.x - slot.x) * go;
        hero.y = slot.y + (target.y - slot.y) * go - Math.sin(go * Math.PI) * 12;
        if (!hero.firedAt && t >= 170) {
          hero.firedAt = now;
          this.slash(hero.x, hero.y - 24, slot.facingLeft);
          this.impact(hit, geom.center.x + rand(-60, 60), geom.center.y + rand(-40, 60), now);
        }
        if (t > 500) this.finishAttack(hero, now);
        return;
      }
      // mago e arqueiro: pequeno salto e disparo
      hero.x = slot.x;
      hero.y = slot.y - Math.sin(Math.min(1, t / 260) * Math.PI) * 8;
      if (!hero.firedAt && t > 110) {
        hero.firedAt = now;
        const dir = slot.facingLeft ? -1 : 1;
        this.fire(hero.x + dir * 16, hero.y - 26, hero.cls === 'mage' ? 'bolt' : 'arrow', hit);
      }
      if (t > 360) this.finishAttack(hero, now);
      return;
    }

    // idle: respira e, se o boss pisou, dá um pulinho
    hero.x = slot.x;
    const hopT = now - hero.hopT0;
    const hop = hero.hopT0 > 0 && hopT < 420 ? Math.sin((hopT / 420) * Math.PI) * 22 : 0;
    hero.y = slot.y - hop;
  }

  private finishAttack(hero: Hero, now: number) {
    hero.state = 'idle';
    hero.attack = null;
    if (hero.pending) {
      const p = hero.pending;
      hero.pending = null;
      this.startAttack(hero, p, now);
    }
  }

  /** Golpes de quem não coube na arena: flechas vindas da plateia. */
  private crowdHit(hit: BossHit, now: number) {
    if (this.crowdBudget-- <= 0 && !hit.ult && !hit.crit) return;
    const fromLeft = Math.random() < 0.5;
    const x = fromLeft ? -20 : W + 20;
    const y = rand(380, 540);
    this.fire(x, y, hit.ult ? 'ult' : 'crowd', hit);
    void now;
  }

  // ─── Projéteis e efeitos ─────────────────────────────────────

  private fire(x: number, y: number, kind: Projectile['kind'], hit: BossHit, extra: Partial<Projectile> = {}) {
    const tx = extra.tx ?? geom.center.x + rand(-55, 55);
    const ty = extra.ty ?? geom.center.y + rand(-50, 50);
    const speed =
      kind === 'arrow' ? 1300 : kind === 'bolt' ? 900 : kind === 'ult' ? 700 : kind === 'crystal' ? 950 : kind === 'runner' ? 420 : 1100;
    const d = Math.hypot(tx - x, ty - y) || 1;
    if (kind === 'ult') this.sfx?.play('ult');
    this.projectiles.push({ x, y, tx, ty, vx: ((tx - x) / d) * speed, vy: ((ty - y) / d) * speed, kind, hit, trail: [], ...extra });
  }

  private later(ms: number, run: () => void) {
    this.scheduled.push({ at: performance.now() + ms, run });
  }

  /**
   * Golpes de apoio, cada um com seu efeito:
   *   bits   → chuva de cristais caindo do céu
   *   sub    → raio dourado     · gift → um raio por sub presenteado
   *   points → golpe especial em X
   *   raid   → reforços correndo dos dois lados da tela
   */
  private specialStrike(hit: BossHit, now: number) {
    const amount = Math.max(1, hit.amount ?? 1);
    const { x: cx, y: cy } = geom.center;
    switch (hit.special) {
      case 'bits': {
        this.sfx?.play('bits');
        const n = Math.max(5, Math.min(30, Math.round(amount / 15)));
        for (let i = 0; i < n; i++) {
          const x = cx + rand(-260, 260);
          this.later(i * 70, () =>
            this.fire(x, -30 - rand(0, 60), 'crystal', hit, {
              tx: cx + rand(-70, 70),
              ty: cy + rand(-60, 50),
              cosmetic: i > 0,
            }),
          );
        }
        break;
      }
      case 'sub':
      case 'gift': {
        const n = hit.special === 'gift' ? Math.min(10, amount) : 1;
        for (let i = 0; i < n; i++) {
          this.later(i * 180, () => {
            this.lightning(cx + rand(-60, 60), cy + rand(-30, 40));
            if (i === 0) this.impact(hit, cx, cy, performance.now());
            else this.burst(cx + rand(-60, 60), cy + rand(-40, 40), ['#ffc83d', '#ffffff'], 18, 420);
          });
        }
        break;
      }
      case 'points': {
        this.sfx?.play('ult');
        this.later(150, () => {
          this.slashX(cx, cy);
          this.impact(hit, cx, cy, performance.now());
        });
        break;
      }
      case 'raid': {
        this.sfx?.play('raid');
        const n = Math.max(6, Math.min(30, Math.round(amount / 3)));
        const classes: HeroClass[] = ['knight', 'mage', 'archer'];
        for (let i = 0; i < n; i++) {
          const fromLeft = i % 2 === 0;
          const y = RING_Y + rand(-50, 70);
          this.later(i * 90, () =>
            this.fire(fromLeft ? -30 : W + 30, y, 'runner', hit, {
              tx: cx + (fromLeft ? -1 : 1) * rand(60, 140),
              ty: y,
              cosmetic: i > 0,
              hero: { cls: classes[i % 3], color: DEFAULT_COLORS[i % DEFAULT_COLORS.length], skin: i % 4 },
            }),
          );
        }
        break;
      }
    }
    void now;
  }

  private lightning(x: number, y: number) {
    const points = [{ x: x + rand(-40, 40), y: -40 }];
    let px = points[0].x;
    for (let py = -40; py < y; py += rand(26, 46)) {
      px += rand(-26, 26);
      points.push({ x: px, y: py });
    }
    points.push({ x, y });
    this.bolts.push({ x, life: 0, max: 380, points });
    this.sfx?.play('thunder');
    this.screenFlash = Math.max(this.screenFlash, 0.35);
  }

  private slashX(x: number, y: number) {
    for (const dir of [1, -1]) {
      for (let i = 0; i < 26; i++) {
        const t = i / 25 - 0.5;
        this.addParticle({
          x: x + t * 220 * dir,
          y: y + t * 180,
          vx: rand(-30, 30),
          vy: rand(-30, 30),
          life: 0,
          max: 420 + i * 6,
          size: 6,
          color: i % 3 === 0 ? '#ffffff' : '#ff1f2d',
          gravity: 0,
        });
      }
    }
  }

  private impact(hit: BossHit, x: number, y: number, now: number, cosmetic = false) {
    if (this.status !== 'running' && !hit.special) return;
    if (cosmetic) {
      this.burst(x, y, hit.special === 'bits' ? ['#c77dff', '#5ce1e6', '#ffffff'] : ['#ffffff', '#2fe38a'], 6, 300);
      return;
    }
    if (hit.special) {
      this.lastFlash = now;
      this.flashUntil = now + 90;
      this.shake(now, 9, 300);
      const color = SPECIAL_COLORS[hit.special];
      this.burst(x, y, [color, '#ffffff'], 30, 520);
      this.rings.push({ x, y, r: 12, life: 0, max: 500, color });
      this.texts.push({
        x: geom.center.x,
        y: geom.center.y - 70,
        vy: -40,
        life: 0,
        max: 2200,
        text: `-${hit.damage.toLocaleString('pt-BR')}`,
        sub: `${hit.name} · ${hit.label ?? ''}`,
        color,
        size: 46,
      });
      return;
    }
    // flash branco com intervalo mínimo: com chat lotado o boss não pode ficar branco o tempo todo
    // só críticos e ults piscam, com intervalo mínimo: o boss não pode ficar branco com chat lotado
    if ((hit.ult || hit.crit) && now - this.lastFlash > 220) {
      this.lastFlash = now;
      this.flashUntil = now + 60;
    }
    if (!hit.ult) this.sfx?.play(hit.crit ? 'crit' : 'hit');
    if (hit.ult) {
      this.shake(now, 10, 320);
      this.burst(x, y, ['#ffc83d', '#ffffff', '#ff1f2d'], 46, 520);
      this.rings.push({ x, y, r: 10, life: 0, max: 420, color: '#ffc83d' });
    } else if (hit.crit) {
      this.shake(now, 5, 160);
      this.burst(x, y, ['#ffc83d', '#ffffff'], 16, 380);
    } else {
      this.burst(x, y, ['#ffffff', '#ff4b55'], 7, 260);
    }
    // números de dano com limite por tipo, para o boss continuar visível
    const big = hit.ult || hit.crit;
    const sameKind = this.texts.filter((t) => (t.size > 24) === big).length;
    if (sameKind < (big ? MAX_BIG_TEXTS : MAX_NORMAL_TEXTS)) {
      const side = Math.random() < 0.5 ? -1 : 1;
      this.texts.push({
        x: geom.center.x + side * rand(big ? 40 : 90, big ? 120 : 170),
        y: geom.center.y + rand(-90, 40),
        vy: -70,
        life: 0,
        max: hit.ult ? 1500 : hit.crit ? 1100 : 750,
        text: `${hit.ult ? 'ULT! ' : ''}-${hit.damage}`,
        sub: big ? hit.name : undefined,
        color: hit.ult ? '#ffc83d' : hit.crit ? '#ffd75e' : '#ffffff',
        size: hit.ult ? 38 : hit.crit ? 28 : 20,
      });
      if (this.texts.length > MAX_TEXTS) this.texts.shift();
    }
  }

  private slash(x: number, y: number, facingLeft: boolean) {
    const dir = facingLeft ? -1 : 1;
    for (let i = 0; i < 6; i++) {
      this.addParticle({
        x: x + dir * 18,
        y: y + rand(-14, 14),
        vx: dir * rand(60, 160),
        vy: rand(-60, 60),
        life: 0,
        max: 220,
        size: 4,
        color: '#ffffff',
        gravity: 0,
      });
    }
  }

  private burst(x: number, y: number, colors: string[], n: number, maxLife: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(80, 340);
      this.addParticle({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 60,
        life: 0,
        max: rand(maxLife * 0.6, maxLife),
        size: Math.random() < 0.3 ? 6 : 4,
        color: colors[i % colors.length],
        gravity: 600,
      });
    }
  }

  private puff(x: number, y: number, color: string, n: number) {
    for (let i = 0; i < n; i++) {
      this.addParticle({
        x: x + rand(-10, 10),
        y: y - rand(0, 6),
        vx: rand(-70, 70),
        vy: rand(-50, -10),
        life: 0,
        max: rand(250, 420),
        size: 3,
        color,
        gravity: 80,
      });
    }
  }

  private addParticle(p: Particle) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  private shake(now: number, mag: number, ms: number) {
    if (now + ms > this.shakeUntil || mag > this.shakeMag) {
      this.shakeUntil = now + ms;
      this.shakeMag = mag;
    }
  }

  private onPhase(phase: Phase, now: number) {
    this.sfx?.play('phase');
    this.shake(now, 12, 600);
    this.screenFlash = 0.5;
    this.rings.push({ x: geom.center.x, y: geom.center.y, r: 40, life: 0, max: 700, color: phase === 3 ? '#ffffff' : '#ff7a1a' });
    this.texts.push({
      x: geom.center.x,
      y: geom.center.y - 40,
      vy: -10,
      life: 0,
      max: 1800,
      text: phase === 2 ? 'FÚRIA!' : 'DESESPERO!',
      sub: phase === 2 ? 'armadura +25%' : 'dano +50% — ataquem!',
      color: phase === 2 ? '#ff7a1a' : '#ffffff',
      size: 54,
    });
    this.nextSlamAt = now + 900;
  }

  // ─── Loop ────────────────────────────────────────────────────

  private frame = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.update(now, dt);
    this.draw(now);
    requestAnimationFrame(this.frame);
  };

  private update(now: number, dt: number) {
    // pisão do boss (ataque em área cosmético)
    if (this.status === 'running' && now >= this.nextSlamAt && this.slamT0 < 0) this.slamT0 = now;
    if (this.slamT0 >= 0) {
      const t = now - this.slamT0;
      if (t >= 560 && t - dt * 1000 < 560) this.onSlamLand(now);
      if (t > 760) {
        this.slamT0 = -1;
        const every = this.phase === 3 ? 3800 : this.phase === 2 ? 5600 : 7500;
        this.nextSlamAt = now + every + rand(-800, 800);
      }
    }

    // brasas nas fases 2 e 3
    if (this.status === 'running' && this.phase >= 2) {
      const rate = this.phase === 3 ? 60 : 25;
      if (Math.random() < rate * dt) {
        this.addParticle({
          x: geom.center.x + rand(-130, 130),
          y: BOSS_FEET - rand(0, 40),
          vx: rand(-20, 20),
          vy: rand(-140, -60),
          life: 0,
          max: rand(700, 1300),
          size: Math.random() < 0.5 ? 3 : 5,
          color: this.phase === 3 ? (Math.random() < 0.5 ? '#ffffff' : '#ff1f2d') : Math.random() < 0.5 ? '#ff7a1a' : '#ffc83d',
          gravity: -20,
        });
      }
    }

    // vitória: piscar e explodir em pixels
    if (this.deathT0 >= 0 && !this.exploded && now - this.deathT0 > 950) {
      this.exploded = true;
      this.explodeBoss(now);
    }
    if (this.deathT0 >= 0) {
      for (const h of this.heroes.values()) {
        if (h.state === 'idle' && now - h.hopT0 > 520 && Math.random() < 0.04) h.hopT0 = now;
      }
    }

    for (const h of this.heroes.values()) this.updateHero(h, now);

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > (p.kind === 'ult' || p.kind === 'crystal' ? 10 : p.kind === 'runner' ? 0 : 5)) p.trail.shift();
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const arrived = (p.tx - p.x) * p.vx + (p.ty - p.y) * p.vy <= 0;
      if (arrived) {
        this.impact(p.hit, p.tx, p.ty, now, p.cosmetic);
        this.projectiles.splice(i, 1);
      }
    }

    for (const p of this.particles) {
      p.life += dt * 1000;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);

    for (const t of this.texts) {
      t.life += dt * 1000;
      t.y += t.vy * dt;
      t.vy *= 0.96;
    }
    this.texts = this.texts.filter((t) => t.life < t.max);

    for (const r of this.rings) {
      r.life += dt * 1000;
      r.r += 520 * dt;
    }
    this.rings = this.rings.filter((r) => r.life < r.max);

    this.screenFlash = Math.max(0, this.screenFlash - dt * 1.8);

    if (this.scheduled.length) {
      const due = this.scheduled.filter((t) => t.at <= now);
      this.scheduled = this.scheduled.filter((t) => t.at > now);
      due.forEach((t) => t.run());
    }
    for (const b of this.bolts) b.life += dt * 1000;
    this.bolts = this.bolts.filter((b) => b.life < b.max);
  }

  private onSlamLand(now: number) {
    this.sfx?.play('slam');
    this.shake(now, 9, 280);
    this.rings.push({ x: CX, y: BOSS_FEET, r: 30, life: 0, max: 520, color: '#ff1f2d' });
    this.puff(CX - 90, BOSS_FEET, '#7a7a85', 10);
    this.puff(CX + 90, BOSS_FEET, '#7a7a85', 10);
    for (const h of this.heroes.values()) if (h.state === 'idle') h.hopT0 = now + Math.hypot(h.x - CX, h.y - RING_Y) * 0.6;
  }

  private explodeBoss(now: number) {
    this.sfx?.play('explode');
    setTimeout(() => this.sfx?.play('victory'), 700);
    this.shake(now, 16, 700);
    this.screenFlash = 0.9;
    const pixels = bossPixels(geom.skin, this.phase);
    const left = CX - (geom.w * geom.scale) / 2;
    const top = BOSS_FEET - geom.h * geom.scale;
    for (let i = 0; i < pixels.length; i += 2) {
      const px = pixels[i];
      const x = left + px.x * geom.scale;
      const y = top + px.y * geom.scale;
      const a = Math.atan2(y - geom.center.y, x - geom.center.x);
      const sp = rand(120, 520);
      this.addParticle({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - rand(150, 350),
        life: 0,
        max: rand(900, 1700),
        size: geom.scale,
        color: px.color,
        gravity: 700,
      });
    }
    this.rings.push({ x: geom.center.x, y: geom.center.y, r: 20, life: 0, max: 800, color: '#ffffff' });
  }

  // ─── Desenho ─────────────────────────────────────────────────

  /** Cenário do boss em pixel art (desenhado uma vez por boss e resolução). */
  private backdropFor(skin: BossSkinId) {
    const key = `${skin}:${this.res}`;
    if (this.backdropCache?.key === key) return this.backdropCache.canvas;
    const c = document.createElement('canvas');
    c.width = Math.round(W * this.res);
    c.height = Math.round(H * this.res);
    const g = c.getContext('2d')!;
    g.setTransform(this.res, 0, 0, this.res, 0, 0);
    g.imageSmoothingEnabled = false;
    const { sky, glow, ridge } = bossDef(skin).theme;
    let seed = skin.length * 7919;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296), seed / 4294967296);

    // céu: escuro em cima, cor do tema no horizonte
    const sk = g.createLinearGradient(0, 0, 0, 380);
    sk.addColorStop(0, '#030306');
    sk.addColorStop(1, sky);
    g.fillStyle = sk;
    g.fillRect(0, 0, W, 380);
    // estrelas
    for (let i = 0; i < 90; i++) {
      g.globalAlpha = 0.25 + rnd() * 0.6;
      g.fillStyle = '#fff';
      g.fillRect(Math.floor(rnd() * W), Math.floor(rnd() * 260), rnd() < 0.15 ? 2 : 1, rnd() < 0.15 ? 2 : 1);
    }
    g.globalAlpha = 1;
    // sol/lua com o brilho do boss
    const sun = g.createRadialGradient(CX, 300, 10, CX, 300, 260);
    sun.addColorStop(0, `rgba(${glow},0.55)`);
    sun.addColorStop(1, `rgba(${glow},0)`);
    g.fillStyle = sun;
    g.fillRect(0, 0, W, 400);
    // duas camadas de montanhas em degraus (pixel art)
    const ridgeLine = (base: number, amp: number, color: string, step: number) => {
      g.fillStyle = color;
      let h = amp * 0.5;
      for (let x = 0; x < W; x += step) {
        h = Math.max(amp * 0.15, Math.min(amp, h + (rnd() - 0.5) * amp * 0.5));
        g.fillRect(x, base - h, step, h + 200);
      }
    };
    ridgeLine(330, 120, ridge[0], 12);
    ridgeLine(370, 80, ridge[1], 8);
    // chão de pedra com perspectiva
    g.fillStyle = '#07070a';
    g.fillRect(0, 380, W, H - 380);
    g.strokeStyle = `rgba(${glow},0.22)`;
    g.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      const y = 380 + (i * i * (H - 380)) / 36;
      g.beginPath();
      g.moveTo(0, Math.round(y) + 0.5);
      g.lineTo(W, Math.round(y) + 0.5);
      g.stroke();
    }
    for (let i = -10; i <= 10; i++) {
      g.beginPath();
      g.moveTo(CX + i * 40, 380);
      g.lineTo(CX + i * 160, H);
      g.stroke();
    }
    const fog = g.createLinearGradient(0, 360, 0, 420);
    fog.addColorStop(0, `rgba(${glow},0)`);
    fog.addColorStop(0.5, `rgba(${glow},0.18)`);
    fog.addColorStop(1, `rgba(${glow},0)`);
    g.fillStyle = fog;
    g.fillRect(0, 360, W, 60);
    this.backdropCache = { key, canvas: c };
    return c;
  }

  private draw(now: number) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.setTransform(this.res, 0, 0, this.res, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (now < this.shakeUntil) {
      const m = this.shakeMag * ((this.shakeUntil - now) / 300);
      ctx.translate(rand(-m, m), rand(-m, m));
    }
    if (this.backdrop) {
      ctx.drawImage(this.backdropFor(geom.skin), -12, -12, W + 24, H + 24);
      // brilho pulsando atrás do boss
      const glow = bossDef(geom.skin).theme.glow;
      const g = ctx.createRadialGradient(CX, BOSS_FEET - 140, 20, CX, BOSS_FEET - 140, 300);
      g.addColorStop(0, `rgba(${glow},${0.16 + 0.05 * Math.sin(now / 700)})`);
      g.addColorStop(1, `rgba(${glow},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    // fundo transparente: só um círculo discreto no chão (opcional)
    if (this.showFloor && (this.status === 'running' || this.deathT0 >= 0 || this.escapeT0 >= 0)) this.drawFloor();

    for (const r of this.rings) {
      const k = 1 - r.life / r.max;
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = k * 0.9;
      ctx.lineWidth = 6 * k + 1;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.r, r.r * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // ordem de profundidade: heróis atrás do boss → boss → heróis na frente
    const heroes = [...this.heroes.values()].sort((a, b) => a.slot.y - b.slot.y);
    const behind = heroes.filter((h) => h.slot.y < BOSS_FEET);
    const front = heroes.filter((h) => h.slot.y >= BOSS_FEET);
    behind.forEach((h) => this.drawHero(h, now));
    this.drawBoss(now);
    front.forEach((h) => this.drawHero(h, now));

    this.drawProjectiles();

    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;

    // clarão: só em volta do boss (o fundo é a gameplay do streamer)
    if (this.screenFlash > 0) {
      const g = ctx.createRadialGradient(geom.center.x, geom.center.y, 10, geom.center.x, geom.center.y, 320);
      g.addColorStop(0, `rgba(255,255,255,${this.screenFlash * 0.75})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(geom.center.x - 320, geom.center.y - 320, 640, 640);
    }

    this.drawNames(heroes, now);
    this.drawTexts();
    ctx.restore();
  }

  private drawFloor() {
    const ctx = this.ctx;
    const glow = this.phase === 3 ? '255,31,45' : this.phase === 2 ? bossDef(geom.skin).theme.glow : '255,31,45';
    // sombra suave e elíptica sob a multidão (ajuda a ler em qualquer gameplay)
    const k = 430 / 96;
    ctx.save();
    ctx.scale(1, 1 / k);
    const g = ctx.createRadialGradient(CX, RING_Y * k, 40, CX, RING_Y * k, 430);
    g.addColorStop(0, 'rgba(0,0,0,0.3)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(CX, RING_Y * k, 430, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(${glow},0.45)`;
    ctx.beginPath();
    ctx.ellipse(CX, RING_Y, 430, 96, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(${glow},0.18)`;
    ctx.beginPath();
    ctx.ellipse(CX, RING_Y, 250, 52, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawBoss(now: number) {
    if (this.status === 'idle' && this.deathT0 < 0) return;
    if (this.exploded) return;
    const ctx = this.ctx;
    const w = geom.w * geom.scale;
    const h = geom.h * geom.scale;
    let x = CX - w / 2;
    let y = BOSS_FEET - h;
    let sw = w;
    let sh = h;
    let alpha = 1;

    const speed = this.phase === 3 ? 180 : this.phase === 2 ? 320 : 480;
    const breathe = Math.sin(now / speed);
    y += breathe * (this.phase === 3 ? 5 : 3);
    sh += breathe * 4;
    y -= breathe * 4;

    if (this.slamT0 >= 0) {
      const t = now - this.slamT0;
      if (t < 300) {
        const k = t / 300; // agacha
        sh = h * (1 - 0.12 * k);
        sw = w * (1 + 0.08 * k);
      } else if (t < 560) {
        const k = (t - 300) / 260; // pula
        y -= Math.sin(k * Math.PI) * 70;
        sh = h * 1.06;
        sw = w * 0.96;
      } else {
        const k = Math.min(1, (t - 560) / 200); // aterrissa
        sh = h * (0.86 + 0.14 * k);
        sw = w * (1.12 - 0.12 * k);
      }
    }

    if (this.escapeT0 >= 0) {
      const t = now - this.escapeT0;
      if (t < 350) sh = h * (1 - 0.15 * (t / 350));
      else {
        const k = (t - 350) / 900;
        y -= k * k * 700;
        alpha = Math.max(0, 1 - k);
      }
      if (alpha <= 0) return;
    }

    x = CX - sw / 2;
    y = y + (h - sh);

    // sombra
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    const lift = Math.max(0, BOSS_FEET - (y + sh));
    ctx.ellipse(CX, BOSS_FEET + 2, Math.max(40, 140 - lift * 0.8), 22, 0, 0, Math.PI * 2);
    ctx.fill();

    // aura de fase
    if (this.phase >= 2 && this.status === 'running') {
      const g = ctx.createRadialGradient(CX, y + sh / 2, 40, CX, y + sh / 2, 220);
      const c = this.phase === 3 ? '255,31,45' : bossDef(geom.skin).theme.glow;
      const pulse = 0.25 + 0.15 * Math.sin(now / (this.phase === 3 ? 90 : 200));
      g.addColorStop(0, `rgba(${c},${pulse})`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(CX - 240, y - 60, 480, sh + 120);
    }

    const dying = this.deathT0 >= 0 && Math.floor((now - this.deathT0) / 80) % 2 === 0;
    const flash = now < this.flashUntil || dying;
    const rx = Math.round(x);
    const ry = Math.round(y);
    ctx.globalAlpha = alpha;
    ctx.drawImage(bossSprite(geom.skin, this.phase), rx, ry, Math.round(sw), Math.round(sh));
    // dano: clareia o boss por cima, sem apagar os detalhes
    if (flash) {
      ctx.globalAlpha = alpha * (dying ? 0.85 : 0.55);
      ctx.drawImage(bossSprite(geom.skin, this.phase, true), rx, ry, Math.round(sw), Math.round(sh));
    }
    ctx.globalAlpha = 1;
  }

  private drawHero(hero: Hero, now: number) {
    const ctx = this.ctx;
    const w = HERO_W * HERO_SCALE;
    const h = HERO_H * HERO_SCALE;
    const idleBob = hero.state === 'idle' ? Math.round(Math.sin(now / 260 + hero.bob * 6) * 1.5) : 0;
    const x = Math.round(hero.x - w / 2);
    const y = Math.round(hero.y - h + idleBob);
    const lift = hero.slot.y - hero.y;

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(hero.slot.x, hero.slot.y + 1, Math.max(6, 15 - lift * 0.05), 5, 0, 0, Math.PI * 2);
    ctx.fill();

    const glow = !!hero.attack?.ult && Math.floor(now / 60) % 2 === 0;
    ctx.drawImage(heroSprite(hero.cls, hero.color, hero.skin, hero.slot.facingLeft, glow), x, y, w, h);

    if (hero.name === this.topName) drawCrown(ctx, hero.x, y - 10);
  }

  private drawBolts() {
    const ctx = this.ctx;
    for (const b of this.bolts) {
      const k = 1 - b.life / b.max;
      ctx.globalAlpha = k;
      for (const [w, c] of [
        [12, 'rgba(255,200,61,0.35)'],
        [6, '#ffc83d'],
        [2, '#ffffff'],
      ] as const) {
        ctx.strokeStyle = c;
        ctx.lineWidth = w;
        ctx.beginPath();
        b.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawProjectiles() {
    const ctx = this.ctx;
    this.drawBolts();
    for (const p of this.projectiles) {
      if (p.kind === 'runner' && p.hero) {
        const sprite = heroSprite(p.hero.cls, p.hero.color, p.hero.skin, p.vx < 0);
        const w = HERO_W * HERO_SCALE;
        const h = HERO_H * HERO_SCALE;
        const hop = Math.abs(Math.sin(p.x / 18)) * 6;
        ctx.drawImage(sprite, Math.round(p.x - w / 2), Math.round(p.y - h - hop), w, h);
        continue;
      }
      if (p.kind === 'crystal') {
        p.trail.forEach((t, i) => {
          ctx.globalAlpha = ((i + 1) / p.trail.length) * 0.45;
          ctx.fillStyle = '#c77dff';
          ctx.fillRect(Math.round(t.x - 3), Math.round(t.y - 3), 6, 6);
        });
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.translate(Math.round(p.x), Math.round(p.y));
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = '#000000';
        ctx.fillRect(-9, -9, 18, 18);
        ctx.fillStyle = '#9b5cff';
        ctx.fillRect(-7, -7, 14, 14);
        ctx.fillStyle = '#5ce1e6';
        ctx.fillRect(-7, -7, 7, 7);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-5, -5, 3, 3);
        ctx.restore();
        continue;
      }
      const color = p.kind === 'ult' ? '#ffc83d' : p.kind === 'bolt' ? '#ff4b55' : '#ffffff';
      p.trail.forEach((t, i) => {
        ctx.globalAlpha = ((i + 1) / p.trail.length) * 0.5;
        ctx.fillStyle = color;
        const s = p.kind === 'ult' ? 10 : 4;
        ctx.fillRect(Math.round(t.x - s / 2), Math.round(t.y - s / 2), s, s);
      });
      ctx.globalAlpha = 1;
      if (p.kind === 'arrow' || p.kind === 'crowd') {
        const a = Math.atan2(p.vy, p.vx);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(a);
        ctx.fillStyle = '#8a5a2b';
        ctx.fillRect(-14, -1, 18, 3);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(4, -3, 6, 7);
        ctx.fillStyle = p.kind === 'crowd' ? '#ff4b55' : '#ffc83d';
        ctx.fillRect(-16, -3, 4, 7);
        ctx.restore();
      } else {
        const s = p.kind === 'ult' ? 22 : 10;
        ctx.fillStyle = color;
        ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(Math.round(p.x - s / 4), Math.round(p.y - s / 4), s / 2, s / 2);
      }
    }
  }

  private drawNames(heroes: Hero[], now: number) {
    const ctx = this.ctx;
    const visible = heroes
      .filter((h) => h.state === 'idle' && (h.nameUntil > now || h.name === this.topName))
      .sort((a, b) => b.lastActive - a.lastActive)
      .slice(0, NAME_TAGS);
    ctx.font = "700 13px Inter, system-ui, sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineJoin = 'round';
    for (const h of visible) {
      const label = h.name.length > 14 ? `${h.name.slice(0, 13)}…` : h.name;
      const y = h.y - HERO_H * HERO_SCALE - (h.name === this.topName ? 14 : 4);
      ctx.globalAlpha = Math.min(1, (h.nameUntil - now) / 400 + (h.name === this.topName ? 1 : 0));
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.strokeText(label, h.x, y);
      ctx.fillStyle = shade(h.color, 0.35);
      ctx.fillText(label, h.x, y);
    }
    ctx.globalAlpha = 1;
  }

  private drawTexts() {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const t of this.texts) {
      const k = t.life / t.max;
      const pop = k < 0.12 ? 0.6 + (k / 0.12) * 0.55 : k < 0.2 ? 1.15 - ((k - 0.12) / 0.08) * 0.15 : 1;
      ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      ctx.font = `italic 900 ${Math.round(t.size * pop)}px 'Exo 2', Inter, sans-serif`;
      ctx.lineWidth = t.size > 40 ? 8 : 6;
      ctx.strokeStyle = '#000000';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
      if (t.sub) {
        ctx.font = `800 ${t.size > 40 ? 18 : 13}px Inter, sans-serif`;
        ctx.lineWidth = 4;
        ctx.strokeText(t.sub, t.x, t.y + t.size * 0.62);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(t.sub, t.x, t.y + t.size * 0.62);
      }
    }
    ctx.globalAlpha = 1;
  }
}

function drawCrown(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const rows = ['k.k.k', 'kykyk', 'kyyyk', 'kkkkk'];
  const s = 3;
  const left = Math.round(x - (rows[0].length * s) / 2);
  rows.forEach((r, ry) => {
    for (let rx = 0; rx < r.length; rx++) {
      if (r[rx] === '.') continue;
      ctx.fillStyle = r[rx] === 'k' ? '#000000' : '#ffc83d';
      ctx.fillRect(left + rx * s, Math.round(y) + ry * s - 12, s, s);
    }
  });
}

// ─── utilidades ──────────────────────────────────────────────

function towardBoss(x: number, y: number, stopAt: number) {
  const tx = geom.center.x;
  const ty = Math.max(y - 30, BOSS_FEET - 60);
  const d = Math.hypot(tx - x, ty - y);
  const k = d > stopAt ? (d - stopAt) / d : 0;
  return { x: x + (tx - x) * k, y: y + (ty - y) * k };
}

function rand(a: number, b: number) {
  return a + Math.random() * (b - a);
}
function easeOut(t: number) {
  return 1 - (1 - t) * (1 - t);
}
function easeIn(t: number) {
  return t * t;
}
/** Aceita a cor do usuário, mas clareia cores muito escuras (sumiriam no fundo preto). */
function validColor(c?: string) {
  if (!c || !/^#[0-9a-f]{6}$/i.test(c)) return null;
  const n = parseInt(c.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.35 ? shade(c, 0.45) : c;
}
