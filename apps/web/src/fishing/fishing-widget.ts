import { FISH_RARITIES, FISH_SPECIES, type FishCatch, type FishingSnapshot } from '@clipei/shared';
import type { Sfx } from '../arena/sfx.ts';
import { drawNameTags, type NameTag } from '../arena/name-tags.ts';

/**
 * Pescaria da Live: um lago pequeno num canto do overlay.
 *  - ninguém pescando: só um lembrete discreto "🎣 !pescar" (ou nada);
 *  - com gente pescando: o lago abre, cada linha vira uma boia com o nome da pessoa;
 *  - pescou: o peixe pula da água na cor da raridade e aparece o cartão da pesca.
 */

const W = 400;
const H = 170;
const WATER = 62;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const kg = (v: number) => (v < 1 ? `${Math.round(v * 1000)} g` : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`);
const fishOf = (id: string) => FISH_SPECIES.find((f) => f.id === id)!;

interface Jump {
  c: FishCatch;
  x: number;
  t0: number;
}

export class FishingWidget {
  private state: FishingSnapshot | null = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private pill: HTMLElement;
  private card: HTMLElement;
  private feed: HTMLElement;
  private rank: HTMLElement;
  private shoal: HTMLElement;
  private jumps: Jump[] = [];
  private seen = new Set<number>();
  private slot = new Map<number, number>();
  private res = 2;
  private running = false;
  private clockOffset = 0;

  constructor(
    private root: HTMLElement,
    private sfx: Sfx | null = null,
  ) {
    root.innerHTML = `
      <div class="fw-pill" hidden>🎣 <kbd>!pescar</kbd></div>
      <div class="fw-card" hidden>
        <div class="fw-head"><b>🎣 Pescaria</b><span class="fw-shoal" hidden>🐟 CARDUME</span><kbd>!pescar</kbd></div>
        <canvas class="fw-lake"></canvas>
        <ol class="fw-feed"></ol>
        <div class="fw-rank"></div>
      </div>`;
    this.pill = root.querySelector('.fw-pill')!;
    this.card = root.querySelector('.fw-card')!;
    this.feed = root.querySelector('.fw-feed')!;
    this.rank = root.querySelector('.fw-rank')!;
    this.shoal = root.querySelector('.fw-shoal')!;
    this.canvas = root.querySelector('.fw-lake')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.setResolution(2);
  }

  setResolution(res: number) {
    this.res = Math.max(1, Math.min(3, res));
    this.canvas.width = Math.round(W * this.res);
    this.canvas.height = Math.round(H * this.res);
  }

  setState(s: FishingSnapshot) {
    this.state = s;
    this.clockOffset = s.serverNow - Date.now();
    this.root.dataset.corner = s.corner;
    const visible = s.enabled && !s.paused;
    this.root.hidden = !visible;
    const busy = s.casters.length > 0 || s.catches.length > 0;
    this.card.hidden = !visible || !busy;
    this.pill.hidden = !visible || busy || !(s.hint || s.shoalUntil);
    this.pill.innerHTML = s.shoalUntil ? '🐟 <b>CARDUME!</b> <kbd>!pescar</kbd>' : '🎣 <kbd>!pescar</kbd>';
    this.pill.classList.toggle('is-shoal', !!s.shoalUntil);
    this.shoal.hidden = !s.shoalUntil;

    // boias: cada linha ganha um lugar fixo no lago enquanto estiver na água
    const live = new Set(s.casters.map((c) => c.id));
    for (const id of [...this.slot.keys()]) if (!live.has(id)) this.slot.delete(id);
    for (const c of s.casters) if (!this.slot.has(c.id)) this.slot.set(c.id, this.freeSlot());

    // pescas novas: peixe pulando + cartão
    for (const c of [...s.catches].reverse()) {
      if (this.seen.has(c.id)) continue;
      this.seen.add(c.id);
      this.jumps.push({ c, x: 60 + Math.random() * (W - 120), t0: performance.now() });
      this.sfx?.play(c.rarity === 'lendario' ? 'victory' : c.rarity === 'epico' || c.rarity === 'raro' ? 'crit' : 'hit');
    }
    this.feed.innerHTML = s.catches
      .slice(0, 3)
      .map((c) => {
        const r = FISH_RARITIES[c.rarity];
        return `<li class="fw-catch r-${c.rarity}" style="--rc:${r.color}">
          <i style="background:${esc(c.color)}"></i><b>${esc(c.name)}</b>
          <span>${esc(fishOf(c.fish).name)} · ${kg(c.kg)}${c.firstTime && c.rarity !== 'lixo' ? ' · <em>NOVO!</em>' : ''}</span>
          <strong>${c.rarity === 'lixo' ? 'lixo 😅' : `${r.label} +${c.points}`}</strong></li>`;
      })
      .join('');
    this.rank.innerHTML = s.week.length
      ? `🏆 Semana: ${s.week.map((r, i) => `<span>${['🥇', '🥈', '🥉'][i]} ${esc(r.name)} <b>${r.points}</b></span>`).join('')}`
      : '🏆 Ranking da semana: pesque o primeiro peixe!';
    if (!this.card.hidden && !this.running) {
      this.running = true;
      requestAnimationFrame(this.frame);
    }
  }

  private freeSlot() {
    const used = new Set(this.slot.values());
    for (let i = 0; i < 12; i++) if (!used.has(i)) return i;
    return Math.floor(Math.random() * 12);
  }

  // ─── Desenho ───────────────────────────────────────────────

  private frame = (now: number) => {
    if (this.card.hidden) {
      this.running = false;
      return;
    }
    this.draw(now);
    requestAnimationFrame(this.frame);
  };

  private draw(now: number) {
    const s = this.state;
    const ctx = this.ctx;
    if (!s) return;
    const t = now / 1000;
    ctx.setTransform(this.res, 0, 0, this.res, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // céu de fim de tarde e mata na margem
    const sky = ctx.createLinearGradient(0, 0, 0, WATER);
    sky.addColorStop(0, '#2a1f4a');
    sky.addColorStop(1, '#ff8f5c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, WATER);
    ctx.fillStyle = '#16361f';
    ctx.beginPath();
    ctx.moveTo(0, WATER);
    for (let x = 0; x <= W; x += 16) ctx.lineTo(x, WATER - 12 - Math.abs(Math.sin(x * 0.07)) * 14);
    ctx.lineTo(W, WATER);
    ctx.fill();
    // água
    const water = ctx.createLinearGradient(0, WATER, 0, H);
    water.addColorStop(0, s.shoalUntil ? '#1c6f8a' : '#1d4e6e');
    water.addColorStop(1, '#0b2236');
    ctx.fillStyle = water;
    ctx.fillRect(0, WATER, W, H - WATER);
    // reflexos e ondinhas
    ctx.strokeStyle = 'rgba(255,190,140,0.25)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 9; i++) {
      const y = WATER + 10 + i * 11;
      const off = (t * (10 + i * 2)) % 60;
      ctx.beginPath();
      for (let x = -60 + off; x < W; x += 60) {
        ctx.moveTo(x, y);
        ctx.lineTo(x + 18, y);
      }
      ctx.stroke();
    }
    // vitórias-régias
    ctx.fillStyle = '#2f7a3a';
    for (const [x, y] of [
      [30, 140],
      [362, 120],
      [330, 152],
    ]) {
      ctx.beginPath();
      ctx.ellipse(x, y, 13, 5, 0, 0.3, Math.PI * 2);
      ctx.lineTo(x, y);
      ctx.fill();
    }
    // cardume: peixinhos passando
    if (s.shoalUntil) {
      ctx.fillStyle = 'rgba(180,230,255,0.35)';
      for (let i = 0; i < 10; i++) {
        const x = ((t * 40 + i * 47) % (W + 40)) - 20;
        const y = WATER + 30 + ((i * 29) % 70);
        ctx.beginPath();
        ctx.ellipse(x, y, 7, 2.5, 0, 0, Math.PI * 2);
        ctx.moveTo(x - 7, y);
        ctx.lineTo(x - 11, y - 3);
        ctx.lineTo(x - 11, y + 3);
        ctx.fill();
      }
    }

    // boias e linhas
    const tags: NameTag[] = [];
    const serverNow = Date.now() + this.clockOffset;
    for (const c of s.casters) {
      const slot = this.slot.get(c.id) ?? 0;
      const x = 56 + ((slot * 97) % (W - 116));
      const baseY = WATER + 22 + ((slot * 37) % 60);
      const since = (serverNow - c.castAt) / 1000;
      // a boia cai, depois balança; perto de beliscar, dá umas puxadas
      const drop = Math.min(1, since / 0.4);
      const nib = since > 3 ? Math.max(0, Math.sin(t * 13 + slot)) * 3 : 0;
      const y = baseY - (1 - drop) * 40 + Math.sin(t * 3 + slot) * 1.5 + nib;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x + 40, 0);
      ctx.quadraticCurveTo(x + 22, y - 30, x, y - 4);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.ellipse(x, y + 3, 7 + nib, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI);
      ctx.fill();
      ctx.fillStyle = c.lucky ? '#ffc83d' : '#ff2d3a';
      ctx.beginPath();
      ctx.arc(x, y, 4, Math.PI, 0);
      ctx.fill();
      if (c.lucky) {
        ctx.fillStyle = 'rgba(255,210,61,0.8)';
        ctx.fillRect(x + 5 + Math.sin(t * 6) * 2, y - 9, 2, 2);
      }
      tags.push({ x, y: y - 8, name: c.name, color: c.color, priority: -c.castAt });
    }

    // peixes pulando
    this.jumps = this.jumps.filter((j) => now - j.t0 < 1600);
    for (const j of this.jumps) {
      const k = (now - j.t0) / 1100;
      if (k > 1) continue;
      const r = FISH_RARITIES[j.c.rarity];
      const sp = fishOf(j.c.fish);
      const x = j.x + k * 40;
      const y = WATER + 40 - Math.sin(k * Math.PI) * 60;
      const big = j.c.rarity === 'lendario' ? 1.6 : j.c.rarity === 'epico' ? 1.3 : 1;
      if (j.c.rarity !== 'comum' && j.c.rarity !== 'lixo') {
        const g = ctx.createRadialGradient(x, y, 2, x, y, 30 * big);
        g.addColorStop(0, `${r.color}aa`);
        g.addColorStop(1, `${r.color}00`);
        ctx.fillStyle = g;
        ctx.fillRect(x - 32 * big, y - 32 * big, 64 * big, 64 * big);
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-0.8 + k * 1.6);
      ctx.scale(big, big);
      if (j.c.rarity === 'lixo') {
        ctx.fillStyle = sp.color;
        ctx.fillRect(-7, -6, 14, 12);
      } else {
        ctx.fillStyle = sp.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, 13, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-11, 0);
        ctx.lineTo(-19, -6);
        ctx.lineTo(-19, 6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.ellipse(2, -2, 7, 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.arc(8, -1.5, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      // respingos na saída e na volta
      if (k < 0.15 || k > 0.85) {
        ctx.fillStyle = 'rgba(220,240,255,0.8)';
        for (let i = 0; i < 6; i++) ctx.fillRect(x - 10 + i * 4, WATER + 38 - Math.random() * 10, 2, 2);
      }
    }
    drawNameTags(ctx, tags, 8.5);
  }
}
