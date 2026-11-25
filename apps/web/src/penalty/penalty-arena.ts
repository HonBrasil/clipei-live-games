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
const SKINS = ['#f1c9a5', '#e0ac69', '#c68642', '#a86b3c', '#8d5524', '#ffdbac'];
const HAIRS = ['#1b120c', '#2b1d12', '#3b2414', '#0d0d0d', '#6b4423', '#7a3b1d'];
function isLight(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 170;
}
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
    const keeper = this.keeperPose(r?.dive ?? 1, r?.corner ?? 1, r?.outcome, kickT, t);
    this.drawKeeper(keeper.x, keeper.y, keeper.rot, keeperColor, keeper.reach, s.keepers[defending]?.name);

    // bola
    const ball = this.ballPos(r?.corner ?? 1, r?.height ?? 0, r?.outcome, kickT);
    if (ball.z > 0.6) {
      // bola atrás da linha do gol: desenha a rede por cima
      this.drawBall(ball.x, ball.y, ball.size, ball.spin);
      this.drawNetBulge(ball, kickT);
    }
    // a bola fica sempre mais longe da câmera que o cobrador (de costas, na frente da tela)
    if (ball.z <= 0.6) this.drawBall(ball.x, ball.y, ball.size, ball.spin);
    const kicker = this.kickerPose(kickT);
    this.drawKicker(kicker, kickerColor, s.status === 'lobby' ? undefined : s.kicker?.name);

    // nomes
    const tags: NameTag[] = [];
    const kp = s.keepers[defending];
    if (kp && s.status !== 'lobby') tags.push({ x: keeper.x, y: keeper.y - 68, name: `🧤 ${kp.name}`, color: keeperColor, priority: 1 });
    if (s.kicker && s.status !== 'lobby' && s.status !== 'finished') tags.push({ x: kicker.x, y: kicker.y - 162, name: `⚽ ${s.kicker.name}`, color: kickerColor, priority: 2 });
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

  private keeperPose(dive: PenaltyCorner, corner: PenaltyCorner, outcome: PenaltyOutcome | undefined, kickT: number, t: number) {
    const idle = { x: 480 + Math.sin(t * 2.2) * 16, y: GOAL.line - 2, rot: 0, reach: 0 };
    if (kickT < STRIKE - 80 || !outcome) return idle;
    const f = ease(clamp01((kickT - (STRIKE - 80)) / 460));
    // pulou certo e foi gol: chega atrasado (para antes da bola); defendeu com o paredão: alcança o canto ao lado
    const late = outcome === 'goal' && dive === corner;
    const stretch = outcome === 'save' && dive !== corner;
    if (dive === 1 && !stretch) return { x: 480, y: GOAL.line - 2 - Math.sin(f * Math.PI) * 26, rot: 0, reach: f * (late ? 0.6 : 1) };
    const side: PenaltyCorner = stretch ? corner : dive;
    const dir = side === 0 ? -1 : 1;
    const tx = stretch ? (this.cornerX(side) + this.cornerX(dive)) / 2 + dir * 30 : this.cornerX(side) - dir * (late ? 46 : 6);
    const fall = clamp01((kickT - STRIKE - 420) / 400);
    return { x: idle.x + (tx - idle.x) * f, y: GOAL.line - 2 - Math.sin(f * Math.PI) * 24 + fall * 6, rot: dir * f * 1.25, reach: f };
  }

  private kickerPose(kickT: number) {
    if (kickT < 0) return { x: 446, y: 540, run: 0, phase: 'idle' as const, f: 0, t: 0 };
    const run = ease(clamp01(kickT / STRIKE));
    const x = 446 + (470 - 446) * run;
    const y = 540 - 40 * run;
    if (kickT < STRIKE - 180) return { x, y, run, phase: 'run' as const, f: kickT / 95, t: kickT };
    if (kickT < STRIKE) return { x, y, run, phase: 'back' as const, f: (kickT - (STRIKE - 180)) / 180, t: kickT };
    return { x, y, run, phase: 'strike' as const, f: clamp01((kickT - STRIKE) / 260), t: kickT };
  }

  // ─── Bonecos ───────────────────────────────────────────────

  private look(name: string | undefined) {
    let h = 0;
    for (const ch of name ?? 'x') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return {
      skin: SKINS[h % SKINS.length],
      hair: HAIRS[(h >>> 3) % HAIRS.length],
      style: (h >>> 6) % 4,
      number: ((h >>> 9) % 98) + 2,
    };
  }

  /**
   * Perna vista de trás: coxa e canela com meião e chuteira.
   * `spread` abre para o lado; `pitch` leva a coxa para frente (encurta na tela);
   * `bend` dobra o joelho (acima de 90° o pé sobe atrás, em direção à câmera).
   */
  private leg(hipX: number, hipY: number, spread: number, pitch: number, bend: number, len: number, skin: string, sock: string, boot: string, footScale = 1) {
    const ctx = this.ctx;
    const tl = len * Math.cos(pitch);
    const kx = hipX + Math.sin(spread) * tl;
    const ky = hipY + Math.cos(spread) * tl;
    const sl = len * 0.95 * Math.cos(bend);
    const fx = kx + Math.sin(spread) * Math.abs(sl) * 0.4;
    const fy = ky + sl;
    ctx.lineCap = 'round';
    ctx.strokeStyle = skin;
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(kx, ky);
    ctx.stroke();
    if (Math.abs(sl) > 2) {
      ctx.strokeStyle = sock;
      ctx.lineWidth = 12.5;
      ctx.beginPath();
      ctx.moveTo(kx + (fx - kx) * 0.15, ky + (fy - ky) * 0.15);
      ctx.lineTo(fx, fy);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.beginPath();
      ctx.moveTo(kx + (fx - kx) * 0.18, ky + (fy - ky) * 0.18);
      ctx.lineTo(kx + (fx - kx) * 0.27, ky + (fy - ky) * 0.27);
      ctx.stroke();
    }
    // chuteira: de sola (pé subindo atrás) ou de calcanhar (no chão)
    ctx.save();
    ctx.translate(fx, fy);
    ctx.scale(footScale, footScale);
    ctx.fillStyle = '#111216';
    ctx.beginPath();
    if (sl < 0) ctx.roundRect(-7, -9, 14, 13, 5);
    else ctx.roundRect(-8, -3, 16, 10, 4);
    ctx.fill();
    ctx.fillStyle = boot;
    ctx.fillRect(-6, sl < 0 ? -6 : 1, 12, 2);
    ctx.restore();
  }

  /** Goleiro de frente, joelhos flexionados e luvas grandes; no pulo, estica o corpo. */
  private drawKeeper(x: number, y: number, rot: number, color: string, reach: number, name?: string) {
    const ctx = this.ctx;
    const l = this.look(name);
    const kit = shade(color, -0.3);
    const kitLight = shade(color, 0.15);
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 17 + reach * 8, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(rot);
    const crouch = 1 - reach;
    // pernas (agachado em posição de defesa; esticadas no pulo)
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      const hx = side * 5;
      const kx = side * (9 - reach * 3);
      const ky = -13 - reach * 2;
      const fx = side * (8 - reach * 4);
      ctx.strokeStyle = '#1b1c24';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(hx, -24);
      ctx.lineTo(kx, ky + crouch * 1);
      ctx.stroke();
      ctx.strokeStyle = kitLight;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(kx, ky);
      ctx.lineTo(fx, -2);
      ctx.stroke();
      ctx.fillStyle = '#111216';
      ctx.beginPath();
      ctx.roundRect(fx - 4.5, -3, 9, 4.5, 2);
      ctx.fill();
    }
    // calção
    ctx.fillStyle = '#1b1c24';
    ctx.beginPath();
    ctx.roundRect(-10, -28, 20, 9, 3);
    ctx.fill();
    // camisa de goleiro (manga longa, com listras diagonais)
    const g = ctx.createLinearGradient(-12, -48, 12, -24);
    g.addColorStop(0, kitLight);
    g.addColorStop(1, kit);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-12, -46);
    ctx.quadraticCurveTo(0, -50, 12, -46);
    ctx.lineTo(10, -26);
    ctx.lineTo(-10, -26);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 3;
    for (let i = -24; i < 24; i += 8) {
      ctx.beginPath();
      ctx.moveTo(i, -50);
      ctx.lineTo(i + 16, -24);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'italic 900 8px "Exo 2", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('1', 0, -33);
    // braços: abertos na espera, esticados para o canto no pulo
    const armY = -44;
    for (const side of [-1, 1]) {
      const ex = side * (19 - reach * 3);
      const ey = armY + 6 - reach * 14;
      const hx = side * (23 - reach * 2);
      const hy = armY - 2 - reach * 24;
      ctx.strokeStyle = kit;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(side * 10, armY);
      ctx.lineTo(ex, ey);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      // luva grande
      ctx.fillStyle = '#c6ff3d';
      ctx.beginPath();
      ctx.ellipse(hx, hy - 1, 5, 6, side * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1b1c24';
      ctx.fillRect(hx - 4, hy + 3, 8, 2);
    }
    // pescoço e cabeça (de frente: rosto)
    ctx.fillStyle = l.skin;
    ctx.fillRect(-3, -52, 6, 5);
    ctx.beginPath();
    ctx.arc(0, -57, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = l.hair;
    ctx.beginPath();
    ctx.arc(0, -59, 7.8, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
    ctx.fillStyle = '#1b1b1b';
    ctx.fillRect(-3.5, -57, 2, 2);
    ctx.fillRect(1.5, -57, 2, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-2, -53.5, 4, 1);
    ctx.restore();
  }

  /** Cobrador de costas, perto da câmera: nome e número nas costas, corrida e chute com a perna em dois segmentos. */
  private drawKicker(pose: ReturnType<PenaltyArena['kickerPose']>, color: string, name?: string) {
    const ctx = this.ctx;
    const l = this.look(name);
    const { x, y } = pose;
    const sock = shade(color, -0.15);
    const bob = pose.phase === 'run' ? Math.abs(Math.sin(pose.f)) * 4 : 0;
    // poses das pernas: [coxa, joelho] esquerda (apoio) e direita (chute)
    // [abertura, coxa para frente, dobra do joelho]
    let left: [number, number, number] = [0.04, 0, 0.05];
    let right: [number, number, number] = [-0.04, 0, 0.05];
    let footScale = 1;
    let armSwing = 0;
    let armOut = 0;
    if (pose.phase === 'run') {
      const c = Math.sin(pose.f);
      left = [0.05, 0.25 * Math.max(0, c), 0.2 + 1.9 * Math.max(0, -c)];
      right = [-0.05, 0.25 * Math.max(0, -c), 0.2 + 1.9 * Math.max(0, c)];
      armSwing = c * 0.5;
    } else if (pose.phase === 'back') {
      // perna do chute vai para trás: joelho dobrado, pé sobe
      left = [0.08, 0, 0.15];
      // de costas: o pé sobe atrás, a canela aponta para cima
      right = [0.1, 0, 0.6 + 1.9 * ease(pose.f)];
      armOut = pose.f;
    } else if (pose.phase === 'strike') {
      // chute: a perna vai para a frente (de costas, parece encolher e subir)
      left = [0.1, 0, 0.2];
      right = [-0.05, 1.1 * ease(pose.f), 2.5 - 2.4 * ease(pose.f)];
      footScale = 1 - 0.3 * ease(pose.f);
      armOut = 1 - 0.4 * pose.f;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 34, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(0, -bob);
    const hipY = -62;
    this.leg(-10, hipY, left[0], left[1], left[2], 30, l.skin, sock, color);
    this.leg(10, hipY, right[0], right[1], right[2], 30, l.skin, sock, color, footScale);
    // calção com faixa lateral
    ctx.fillStyle = '#f4f4f6';
    ctx.beginPath();
    ctx.moveTo(-21, -78);
    ctx.lineTo(21, -78);
    ctx.lineTo(23, -56);
    ctx.quadraticCurveTo(12, -52, 2, -58);
    ctx.lineTo(-2, -58);
    ctx.quadraticCurveTo(-12, -52, -23, -56);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(-22, -77, 3, 19);
    ctx.fillRect(19, -77, 3, 19);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(-1, -74, 2, 15);
    // braços (atrás do tronco nas costas, mão balançando)
    const shoulderY = -118;
    for (const side of [-1, 1]) {
      const swing = side === -1 ? armSwing : -armSwing;
      const out = armOut * (side === -1 ? 0.9 : 0.5);
      const sx = side * 25;
      const ex = sx + side * (6 + out * 14) + Math.sin(swing) * 4;
      const ey = shoulderY + 26 - out * 6;
      const hx = ex + side * (4 + out * 14);
      const hy = ey + 22 - out * 10 + Math.cos(swing) * 2;
      // manga
      ctx.strokeStyle = color;
      ctx.lineWidth = 15;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sx, shoulderY + 4);
      ctx.lineTo(sx + (ex - sx) * 0.55, shoulderY + 4 + (ey - shoulderY - 4) * 0.55);
      ctx.stroke();
      // braço
      ctx.strokeStyle = l.skin;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(sx + (ex - sx) * 0.5, shoulderY + 4 + (ey - shoulderY - 4) * 0.5);
      ctx.lineTo(ex, ey);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.fillStyle = l.skin;
      ctx.beginPath();
      ctx.arc(hx, hy, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    // camisa: ombros arredondados, cintura mais fina, volume com degradê
    const g = ctx.createLinearGradient(-28, shoulderY, 26, -76);
    g.addColorStop(0, shade(color, 0.22));
    g.addColorStop(0.55, color);
    g.addColorStop(1, shade(color, -0.28));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-22, -76);
    ctx.lineTo(-25, shoulderY + 8);
    ctx.quadraticCurveTo(-27, shoulderY - 4, -14, shoulderY - 6);
    ctx.lineTo(14, shoulderY - 6);
    ctx.quadraticCurveTo(27, shoulderY - 4, 25, shoulderY + 8);
    ctx.lineTo(22, -76);
    ctx.quadraticCurveTo(0, -72, -22, -76);
    ctx.closePath();
    ctx.fill();
    // gola e barra
    ctx.fillStyle = shade(color, -0.45);
    ctx.beginPath();
    ctx.ellipse(0, shoulderY - 5, 8, 2.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(-22, -80, 44, 4);
    // nome e número nas costas
    const light = isLight(color);
    ctx.fillStyle = light ? '#14141a' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = '800 8.5px Inter, sans-serif';
    const label = (name ?? '').replace(/^@/, '').toUpperCase().slice(0, 11);
    if (label) ctx.fillText(label, 0, shoulderY + 6);
    ctx.font = 'italic 900 27px "Exo 2", sans-serif';
    ctx.lineWidth = 2;
    ctx.strokeStyle = light ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.35)';
    ctx.strokeText(String(l.number), 0, -86);
    ctx.fillText(String(l.number), 0, -86);
    // pescoço, orelhas e cabelo (de costas)
    ctx.fillStyle = shade(l.skin, -0.12);
    ctx.fillRect(-6, shoulderY - 14, 12, 10);
    ctx.fillStyle = l.skin;
    ctx.beginPath();
    ctx.ellipse(-13, shoulderY - 22, 3, 4.5, 0, 0, Math.PI * 2);
    ctx.ellipse(13, shoulderY - 22, 3, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    const hy = shoulderY - 24;
    ctx.fillStyle = l.hair;
    if (l.style === 2) {
      // black power
      ctx.beginPath();
      ctx.arc(0, hy - 3, 17, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(0, hy, 13, 0, Math.PI * 2);
      ctx.fill();
      if (l.style === 1) {
        // degradê: nuca mais clara
        ctx.fillStyle = shade(l.skin, -0.25);
        ctx.fillRect(-10, hy + 6, 20, 5);
      } else if (l.style === 3) {
        // coque
        ctx.fillStyle = l.hair;
        ctx.beginPath();
        ctx.arc(0, hy - 14, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.ellipse(-4, hy - 6, 5, 3, -0.5, 0, Math.PI * 2);
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
