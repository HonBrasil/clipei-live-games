import type { PenaltyCorner, PenaltyOutcome, PenaltySnapshot } from '@clipei/shared';
import type { Sfx } from '../arena/sfx.ts';
import { drawNameTags, type NameTag } from '../arena/name-tags.ts';

/**
 * Disputa de Pênaltis vista de trás do cobrador, em 960×540 "lógicos".
 * Estádio à noite (torcida nas cores dos dois times), gol com rede, goleiro balançando,
 * cobrador correndo para a bola. Na cobrança, a bola voa para o canto votado e o goleiro
 * pula para o lado votado; o servidor já decidiu o resultado, aqui é só a animação.
 */

const W = 960;
const H = 540;
const GOAL = { left: 300, right: 660, top: 172, line: 300 };
const SPOT = { x: 480, y: 470 };
const KICK_MS = 2600;
const STRIKE = 700;
const FLIGHT = 520;

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

const ease = (t: number) => 1 - (1 - t) * (1 - t);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

interface Confetti {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  color: string;
  life: number;
}

export class PenaltyArena {
  private ctx: CanvasRenderingContext2D;
  private res = 1;
  private state: PenaltySnapshot | null = null;
  private bg: { key: string; canvas: HTMLCanvasElement } | null = null;
  private transparent = false;
  /** início local da animação da cobrança */
  private kickAt = 0;
  private confetti: Confetti[] = [];
  private last = performance.now();
  private flash = 0;

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

  setTransparent(on: boolean) {
    if (on === this.transparent) return;
    this.transparent = on;
    this.bg = null;
  }

  setState(s: PenaltySnapshot) {
    const prev = this.state;
    const colorsChanged = !prev || prev.teams[0].color !== s.teams[0].color || prev.teams[1].color !== s.teams[1].color;
    this.state = s;
    if (colorsChanged) this.bg = null;
    if (prev?.status !== 'lobby' && s.status === 'lobby') this.sfx?.play('warn');
    if (prev?.status !== 'kick' && s.status === 'kick') {
      // corrige pelo tempo que a mensagem levou (a fase de chute dura KICK_MS)
      const elapsed = s.phaseEndsAt ? Math.max(0, KICK_MS - (s.phaseEndsAt - s.serverNow)) : 0;
      this.kickAt = performance.now() - Math.min(400, elapsed);
      window.setTimeout(() => this.sfx?.play('hit'), Math.max(0, STRIKE - elapsed));
      window.setTimeout(() => this.onLand(s), Math.max(0, STRIKE + FLIGHT - elapsed));
    }
    if (prev && prev.status !== 'finished' && s.status === 'finished' && s.winner !== null) {
      this.sfx?.play('victory');
      this.burst(s.teams[s.winner].color, 160);
    }
  }

  private onLand(s: PenaltySnapshot) {
    const o = s.reveal?.outcome;
    if (o === 'goal') {
      this.sfx?.play('slam');
      this.burst(s.teams[s.kicking].color, 90);
      this.flash = 1;
    } else if (o === 'save') this.sfx?.play('crit');
    else this.sfx?.play('warn');
  }

  private burst(color: string, n: number) {
    for (let i = 0; i < n; i++) {
      this.confetti.push({
        x: 120 + Math.random() * 720,
        y: -10 - Math.random() * 80,
        vx: (Math.random() - 0.5) * 80,
        vy: 60 + Math.random() * 120,
        rot: Math.random() * 6,
        color: Math.random() < 0.65 ? color : '#ffffff',
        life: 2.5 + Math.random() * 1.5,
      });
    }
  }

  // ─── Loop ──────────────────────────────────────────────────

  private frame = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    for (const c of this.confetti) {
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot += dt * 6;
      c.life -= dt;
    }
    this.confetti = this.confetti.filter((c) => c.life > 0 && c.y < H + 20);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.draw(now);
    requestAnimationFrame(this.frame);
  };

  private draw(now: number) {
    const ctx = this.ctx;
    const s = this.state;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!s || s.status === 'idle' || s.status === 'stopped') return;
    ctx.setTransform(this.res, 0, 0, this.res, 0, 0);
    ctx.drawImage(this.background(s), 0, 0, W, H);

    const t = now / 1000;
    const kickT = s.status === 'kick' ? now - this.kickAt : s.status === 'result' || s.status === 'finished' ? KICK_MS : -1;
    const r = s.reveal;
    const defending = (1 - s.kicking) as 0 | 1;
    const keeperColor = s.teams[defending].color;
    const kickerColor = s.teams[s.kicking].color;

    // goleiro
    const keeper = this.keeperPose(r?.dive ?? 1, r?.outcome, kickT, t);
    this.drawKeeper(keeper.x, keeper.y, keeper.rot, keeperColor, keeper.reach);

    // bola
    const ball = this.ballPos(r?.corner ?? 1, r?.height ?? 0, r?.outcome, kickT);
    if (ball.z > 0.6) {
      // bola atrás da linha do gol: desenha a rede por cima
      this.drawBall(ball.x, ball.y, ball.size, ball.spin);
      this.drawNetBulge(ball, kickT);
    }
    // cobrador (de costas)
    const kicker = this.kickerPose(kickT);
    this.drawKicker(kicker.x, kicker.y, kicker.leg, kickerColor);
    if (ball.z <= 0.6) this.drawBall(ball.x, ball.y, ball.size, ball.spin);

    // nomes
    const tags: NameTag[] = [];
    const kp = s.keepers[defending];
    if (kp && s.status !== 'lobby') tags.push({ x: keeper.x, y: keeper.y - 50, name: `🧤 ${kp.name}`, color: keeperColor, priority: 1 });
    if (s.kicker && s.status !== 'lobby' && s.status !== 'finished') tags.push({ x: kicker.x, y: kicker.y - 132, name: `⚽ ${s.kicker.name}`, color: kickerColor, priority: 2 });
    drawNameTags(ctx, tags, 11);

    // confete e clarão do gol
    for (const c of this.confetti) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.globalAlpha = Math.min(1, c.life);
      ctx.fillStyle = c.color;
      ctx.fillRect(-3, -1.5, 6, 3);
      ctx.restore();
    }
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.25})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ─── Movimento ─────────────────────────────────────────────

  private cornerX(c: PenaltyCorner) {
    return c === 0 ? GOAL.left + 52 : c === 2 ? GOAL.right - 52 : 480;
  }

  private ballPos(corner: PenaltyCorner, height: 0 | 1, outcome: PenaltyOutcome | undefined, kickT: number) {
    const rest = { x: SPOT.x, y: SPOT.y, size: 10, z: 0, spin: 0 };
    if (kickT < STRIKE || !outcome) return rest;
    let tx = this.cornerX(corner);
    let ty = height ? GOAL.top + 34 : GOAL.line - 18;
    if (outcome === 'post') {
      if (corner === 1) ty = GOAL.top + 2;
      else tx = corner === 0 ? GOAL.left + 3 : GOAL.right - 3;
    }
    if (outcome === 'out') {
      if (corner === 1) ty = GOAL.top - 40;
      else tx = corner === 0 ? GOAL.left - 46 : GOAL.right + 46;
    }
    const f = clamp01((kickT - STRIKE) / FLIGHT);
    const e = ease(f);
    let x = SPOT.x + (tx - SPOT.x) * e;
    let y = SPOT.y + (ty - SPOT.y) * e - Math.sin(f * Math.PI) * (height ? 40 : 12);
    let size = 10 - 4.5 * e;
    let z = e;
    if (f >= 1) {
      const after = (kickT - STRIKE - FLIGHT) / 1000;
      if (outcome === 'goal') {
        // entra e cai dentro do gol
        y = Math.min(GOAL.line - 8, ty + after * after * 260);
        z = 1;
      } else if (outcome === 'save') {
        // espalmada de volta para o campo
        const dir = corner === 0 ? -1 : corner === 2 ? 1 : (kickT % 2 ? 1 : -1);
        x = tx + dir * after * 160;
        y = ty + after * 210 + after * after * 120;
        size = 5.5 + Math.min(4, after * 5);
        z = 0.3;
      } else if (outcome === 'post') {
        const dir = corner === 0 ? 1 : corner === 2 ? -1 : 1;
        x = tx + dir * after * 120;
        y = ty + after * 160 + after * after * 200;
        z = 0.3;
      } else {
        x = tx + (tx - SPOT.x) * after * 0.4;
        y = ty - after * 30;
        size = Math.max(3, 5.5 - after * 2);
        z = 1;
      }
    }
    return { x, y, size, z, spin: kickT / 90 };
  }

  private keeperPose(dive: PenaltyCorner, outcome: PenaltyOutcome | undefined, kickT: number, t: number) {
    const idle = { x: 480 + Math.sin(t * 2.2) * 16, y: GOAL.line - 2, rot: 0, reach: 0 };
    if (kickT < STRIKE - 80 || !outcome) return idle;
    const f = ease(clamp01((kickT - (STRIKE - 80)) / 460));
    if (dive === 1) return { x: 480, y: GOAL.line - 2 - Math.sin(f * Math.PI) * 26, rot: 0, reach: f };
    const dir = dive === 0 ? -1 : 1;
    const tx = this.cornerX(dive) - dir * 6;
    const fall = clamp01((kickT - STRIKE - 420) / 400);
    return { x: idle.x + (tx - idle.x) * f, y: GOAL.line - 2 - Math.sin(f * Math.PI) * 24 + fall * 6, rot: dir * f * 1.25, reach: f };
  }

  private kickerPose(kickT: number) {
    if (kickT < 0) return { x: 446, y: 540, leg: 0 };
    const run = ease(clamp01(kickT / STRIKE));
    const x = 446 + (470 - 446) * run;
    const y = 540 - 40 * run;
    const leg = kickT < STRIKE - 120 ? Math.sin(kickT / 60) * 0.4 : clamp01((kickT - (STRIKE - 120)) / 260);
    return { x, y, leg };
  }

  // ─── Desenho ───────────────────────────────────────────────

  private drawKeeper(x: number, y: number, rot: number, color: string, reach: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    // sombra
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 2, 16, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // pernas
    ctx.fillStyle = '#1b1b22';
    ctx.fillRect(-8, -16, 6, 16);
    ctx.fillRect(2, -16, 6, 16);
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(-8, -6, 6, 4);
    ctx.fillRect(2, -6, 6, 4);
    // corpo (camisa de goleiro: cor do time mais escura com faixa)
    ctx.fillStyle = shade(color, -0.25);
    ctx.fillRect(-11, -38, 22, 23);
    ctx.fillStyle = shade(color, 0.35);
    ctx.fillRect(-11, -30, 22, 4);
    // braços abertos (sobem no pulo)
    const up = -10 - reach * 22;
    ctx.strokeStyle = shade(color, -0.25);
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-10, -34);
    ctx.lineTo(-24, -34 + up * 0.6);
    ctx.moveTo(10, -34);
    ctx.lineTo(24, -34 + up * 0.6);
    ctx.stroke();
    // luvas
    ctx.fillStyle = '#c6ff3d';
    ctx.beginPath();
    ctx.arc(-25, -34 + up * 0.6, 4.5, 0, Math.PI * 2);
    ctx.arc(25, -34 + up * 0.6, 4.5, 0, Math.PI * 2);
    ctx.fill();
    // cabeça
    ctx.fillStyle = '#e0ac69';
    ctx.beginPath();
    ctx.arc(0, -45, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b1d12';
    ctx.beginPath();
    ctx.arc(0, -48, 7, Math.PI, 0);
    ctx.fill();
    ctx.restore();
  }

  /** Cobrador de costas, grande, perto da câmera. */
  private drawKicker(x: number, y: number, leg: number, color: string) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 30, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    // perna de apoio
    ctx.fillStyle = '#e0ac69';
    ctx.fillRect(-16, -44, 11, 34);
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(-17, -24, 13, 18);
    ctx.fillStyle = '#111';
    ctx.fillRect(-18, -8, 15, 8);
    // perna do chute (balança para trás e chuta)
    ctx.save();
    ctx.translate(10, -46);
    ctx.rotate(-0.5 + leg * 0.9);
    ctx.fillStyle = '#e0ac69';
    ctx.fillRect(-5, 0, 11, 30);
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(-6, 18, 13, 16);
    ctx.fillStyle = '#111';
    ctx.fillRect(-7, 32, 15, 8);
    ctx.restore();
    // calção
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(-20, -62, 40, 20);
    // camisa
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-24, -112, 48, 54, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(-24, -66, 48, 6);
    // número nas costas
    ctx.fillStyle = shade(color, 0.7);
    ctx.font = 'italic 900 24px "Exo 2", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('10', 0, -76);
    // braços
    ctx.fillStyle = '#e0ac69';
    ctx.fillRect(-32, -106, 9, 34);
    ctx.fillRect(23, -106, 9, 34);
    // cabeça (de trás: cabelo)
    ctx.fillStyle = '#2b1d12';
    ctx.beginPath();
    ctx.arc(0, -124, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawBall(x: number, y: number, size: number, spin: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(1, size * 0.9, size, size * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(spin);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b1b1b';
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.35, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * size * 0.78, Math.sin(a) * size * 0.78, size * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Rede estufando onde a bola entrou. */
  private drawNetBulge(ball: { x: number; y: number }, kickT: number) {
    const k = clamp01((kickT - STRIKE - FLIGHT) / 500);
    if (k <= 0 || k >= 1) return;
    const ctx = this.ctx;
    ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - k)})`;
    ctx.lineWidth = 1.5;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.ellipse(ball.x, ball.y, 10 * i * (0.5 + k), 7 * i * (0.5 + k), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ─── Fundo ─────────────────────────────────────────────────

  private background(s: PenaltySnapshot) {
    const key = `${this.res}:${this.transparent}:${s.teams[0].color}:${s.teams[1].color}`;
    if (this.bg?.key === key) return this.bg.canvas;
    const c = document.createElement('canvas');
    c.width = Math.round(W * this.res);
    c.height = Math.round(H * this.res);
    const g = c.getContext('2d')!;
    g.setTransform(this.res, 0, 0, this.res, 0, 0);
    const rnd = seeded(2026);

    if (!this.transparent) {
      // céu noturno e arquibancada
      const sky = g.createLinearGradient(0, 0, 0, 250);
      sky.addColorStop(0, '#05070f');
      sky.addColorStop(1, '#141a2e');
      g.fillStyle = sky;
      g.fillRect(0, 0, W, 260);
      for (let tier = 0; tier < 4; tier++) {
        const y0 = 70 + tier * 40;
        g.fillStyle = tier % 2 ? '#1a1f30' : '#20263a';
        g.fillRect(0, y0, W, 40);
        // torcida: metade de cada time, com gente misturada
        for (let x = 4; x < W; x += 7) {
          for (let row = 0; row < 3; row++) {
            if (rnd() < 0.12) continue;
            const side = x < W / 2 ? 0 : 1;
            const mixed = rnd() < 0.15 ? 1 - side : side;
            const col = rnd() < 0.2 ? '#e8e2d8' : s.teams[mixed].color;
            g.fillStyle = col;
            g.fillRect(x + rnd() * 2, y0 + 6 + row * 11 + rnd() * 2, 4, 6);
            g.fillStyle = '#d9a877';
            g.fillRect(x + 0.5 + rnd(), y0 + 3 + row * 11, 3, 3);
          }
        }
      }
      // refletores
      for (const fx of [80, 880]) {
        const glow = g.createRadialGradient(fx, 40, 4, fx, 40, 160);
        glow.addColorStop(0, 'rgba(255,255,240,0.9)');
        glow.addColorStop(0.15, 'rgba(255,255,220,0.35)');
        glow.addColorStop(1, 'rgba(255,255,220,0)');
        g.fillStyle = glow;
        g.fillRect(fx - 160, 0, 320, 220);
        g.fillStyle = '#fff';
        for (let i = 0; i < 4; i++) g.fillRect(fx - 18 + i * 10, 30, 7, 7);
      }
      // placas de publicidade
      g.fillStyle = '#0b0b0f';
      g.fillRect(0, 232, W, 22);
      g.font = 'italic 900 15px "Exo 2", sans-serif';
      g.textBaseline = 'middle';
      for (let x = 20; x < W; x += 240) {
        g.fillStyle = '#ff1f2d';
        g.fillText('CLIPEI', x, 243);
        g.fillStyle = '#ffffff';
        g.fillText('LIVE GAMES', x + 62, 243);
      }
    }

    // gramado com faixas em perspectiva
    const grassTop = 254;
    for (let i = 0; i < 9; i++) {
      const y0 = grassTop + (i * i * (H - grassTop)) / 64;
      const y1 = grassTop + ((i + 1) * (i + 1) * (H - grassTop)) / 64;
      g.fillStyle = i % 2 ? '#2f8f3c' : '#37a046';
      g.fillRect(0, y0, W, y1 - y0 + 1);
    }
    if (this.transparent) {
      // janela por cima do jogo: só um gramado em volta do gol, sumindo nas bordas
      g.globalCompositeOperation = 'destination-in';
      const m = g.createRadialGradient(480, 400, 80, 480, 400, 430);
      m.addColorStop(0, 'rgba(0,0,0,1)');
      m.addColorStop(0.7, 'rgba(0,0,0,0.85)');
      m.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = m;
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
    }
    // linhas da grande área e marca do pênalti
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(40, GOAL.line);
    g.lineTo(920, GOAL.line);
    g.moveTo(170, GOAL.line);
    g.lineTo(60, H);
    g.moveTo(790, GOAL.line);
    g.lineTo(900, H);
    g.moveTo(255, GOAL.line);
    g.lineTo(228, 352);
    g.lineTo(732, 352);
    g.lineTo(705, GOAL.line);
    g.stroke();
    g.fillStyle = '#fff';
    g.beginPath();
    g.ellipse(SPOT.x, SPOT.y + 8, 7, 3, 0, 0, Math.PI * 2);
    g.fill();

    // gol: rede, fundo e traves
    const back = { left: GOAL.left + 18, right: GOAL.right - 18, top: GOAL.top + 16, line: GOAL.line - 26 };
    g.fillStyle = 'rgba(10,12,20,0.35)';
    g.fillRect(back.left, back.top, back.right - back.left, back.line - back.top);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 1;
    for (let x = back.left; x <= back.right; x += 12) {
      g.beginPath();
      g.moveTo(x, back.top);
      g.lineTo(x + (x - 480) * 0.06, back.line);
      g.stroke();
    }
    for (let y = back.top; y <= back.line; y += 10) {
      g.beginPath();
      g.moveTo(back.left, y);
      g.lineTo(back.right, y);
      g.stroke();
    }
    // laterais e teto da rede
    g.beginPath();
    g.moveTo(GOAL.left, GOAL.top);
    g.lineTo(back.left, back.top);
    g.moveTo(GOAL.right, GOAL.top);
    g.lineTo(back.right, back.top);
    g.moveTo(GOAL.left, GOAL.line);
    g.lineTo(back.left, back.line);
    g.moveTo(GOAL.right, GOAL.line);
    g.lineTo(back.right, back.line);
    g.stroke();
    g.fillStyle = '#f7f7f7';
    g.fillRect(GOAL.left - 4, GOAL.top - 4, 7, GOAL.line - GOAL.top + 4);
    g.fillRect(GOAL.right - 3, GOAL.top - 4, 7, GOAL.line - GOAL.top + 4);
    g.fillRect(GOAL.left - 4, GOAL.top - 4, GOAL.right - GOAL.left + 8, 7);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(GOAL.left - 4, GOAL.line - 2, GOAL.right - GOAL.left + 8, 3);

    this.bg = { key, canvas: c };
    return c;
  }
}
