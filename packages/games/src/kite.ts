import {
  KITE_FLAG,
  KITE_LINES,
  KITE_MODELS,
  kiteRoofY,
  normalizeKiteConfig,
  parseCommand,
  type ChatEvent,
  type KiteConfig,
  type KiteEvent,
  type KiteRelo,
  type KiteRosterEntry,
  type KiteSnapshot,
  type KiteStatus,
  type KiteVoada,
  type SupportEvent,
} from '@clipei/shared';

/**
 * Pipa Combate: céu visto de lado (960×540), cada pessoa numa laje do morro.
 *
 * As pipas voam sozinhas (o atraso da live não deixa pilotar). O chat escolhe a tática:
 *   - `!puxar`: a pipa sobe (altura pesa no relo) e dá força se o relo fechar logo;
 *   - `!dibicar`: mergulha atrás da pipa mais perto e puxa um relo;
 *   - `!descarregar`: solta linha no relo, mais força para cortar, mas a pipa perde altura.
 * Quando as linhas se cruzam perto das pipas, abre um RELO de alguns segundos. A rabiola
 * é um escudo: o primeiro corte leva só ela. Pipa cortada vira "voada" e qualquer pessoa
 * do chat apara com `!aparar` (ranking de aparadores).
 * Vence o último no céu ou, no fim do tempo, quem cortou mais.
 */

export const KITE_W = 960;
export const KITE_H = 540;
const SKY_TOP = 36;
const SKY_LOW = 290;
const LAUNCH_MS = 6000;
const RELO_MS = 6000;
const PAIR_COOLDOWN_MS = 7000;
const VOADA_MS = 9000;
const APARAR_COOLDOWN_MS = 2500;
const MAX_LINE = 560;
const MIN_FIELD = 6;
const SPEED = 55;
const CHASE_SPEED = 105;
const COOLDOWN = { puxar: 5000, dibicar: 6000, descarregar: 7000 } as const;
/** !descarregar vale se foi digitado até 4 s antes do relo abrir (atraso da live). */
const ARM_EARLY_MS = 4000;
const BOT_NAMES = ['CPU Zé Pipa', 'CPU Biruta', 'CPU Rabiola', 'CPU Carretel', 'CPU Laje', 'CPU Vento Sul', 'CPU Papagaio', 'CPU Raia Véia'];
const COLORS = ['#FF4D6D', '#7C5CFF', '#00E0FF', '#FFC300', '#3DFF8B', '#FF7A00', '#FF5CF4', '#9EF01A', '#5CA8FF', '#FFFFFF', '#FF3B3B', '#00FFC6'];

type Tactic = 'puxar' | 'dibicar' | 'descarregar';

interface Kite {
  idx: number;
  id: string;
  name: string;
  color: string;
  bot: boolean;
  model: number;
  slot: number;
  ax: number;
  ay: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  wanderUntil: number;
  alive: boolean;
  place: number | null;
  cuts: number;
  rabiolas: number;
  line: number;
  golden: boolean;
  relo: Relo | null;
  chase: Kite | null;
  chaseUntil: number;
  /** dibicada manual: +10% de força no relo que ela provocar */
  dibicarUntil: number;
  puxarUntil: number;
  /** momento do último !descarregar (−∞ = nenhum armado) */
  armedAt: number;
  stuckUntil: number;
  nextAutoAt: number;
  last: Record<Tactic, number>;
}

interface Relo {
  a: Kite;
  b: Kite;
  x: number;
  y: number;
  startedAt: number;
  endsAt: number;
}

interface Voada extends KiteVoada {
  vx: number;
  vy: number;
}

export interface KiteSupportResult {
  applied: boolean;
  effect: string | null;
}

const MODEL_ALIASES: Record<string, number> = {};
KITE_MODELS.forEach((m, i) => {
  MODEL_ALIASES[m.id] = i;
});
Object.assign(MODEL_ALIASES, { losango: 0, papagaio: 0, pipinha: 0, arraia: 3, raia: 1, peixe: 4, capu: 2 });

export function kiteModelFrom(word: string | undefined): number | null {
  if (!word) return null;
  const w = word
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return MODEL_ALIASES[w] ?? null;
}

export class KiteGame {
  readonly config: KiteConfig;
  status: KiteStatus = 'idle';
  lobbyEndsAt: number | null = null;
  startedAt: number | null = null;
  endsAt: number | null = null;
  winner: number | null = null;
  winReason: 'last' | 'time' | null = null;
  dirty = true;

  private kites: Kite[] = [];
  private byId = new Map<string, Kite>();
  private relos: Relo[] = [];
  private pairUntil = new Map<string, number>();
  private voadas: Voada[] = [];
  private voadaSeq = 0;
  private aparadores = new Map<string, { name: string; color: string; n: number; last: number }>();
  private events: KiteEvent[] = [];
  private seq = 0;
  private rosterVersion = 0;
  private sentRoster = -1;
  private lastUpdate = 0;
  private wind = 0.3;
  private windTarget = 0.3;
  private nextWindAt = 0;
  private gustUntil = 0;
  private nextGustAt = 0;
  private nextStuckAt = 0;
  private cutCount = 0;

  constructor(
    config: Partial<KiteConfig>,
    private rng: () => number = Math.random,
  ) {
    this.config = normalizeKiteConfig(config);
  }

  get isActive() {
    return this.status === 'lobby' || this.status === 'play';
  }
  get humans() {
    return this.kites.filter((k) => !k.bot).length;
  }
  get aliveCount() {
    return this.kites.filter((k) => k.alive).length;
  }
  get size() {
    return this.kites.length;
  }
  nameOf(idx: number | null) {
    return idx === null ? null : (this.kites[idx]?.name ?? null);
  }
  cutsOf(idx: number) {
    return this.kites[idx]?.cuts ?? 0;
  }
  /** Quem mais aparou (para o anúncio final). */
  topAparador() {
    return [...this.aparadores.values()].sort((a, b) => b.n - a.n)[0] ?? null;
  }

  open(now = Date.now()) {
    this.status = 'lobby';
    this.lobbyEndsAt = now + this.config.joinSec * 1000;
    this.dirty = true;
  }

  startNow(now = Date.now()) {
    if (this.status === 'lobby') this.lobbyEndsAt = now;
    this.update(now);
  }

  stop() {
    if (!this.isActive) return;
    this.status = 'stopped';
    this.dirty = true;
  }

  // ─── Chat ──────────────────────────────────────────────────

  handle(e: ChatEvent, now = Date.now()) {
    const cmd = parseCommand(e.text);
    if (!cmd) return;
    const id = `${e.platform}:${e.user.id}`;
    switch (cmd.name) {
      case 'pipa':
      case 'pipas':
      case 'entrar':
      case 'soltar':
        this.join(id, e.user.displayName, e.user.color, kiteModelFrom(cmd.args[0]));
        break;
      case 'puxar':
      case 'puxa':
        this.tactic(id, 'puxar', now);
        break;
      case 'dibicar':
      case 'dibica':
      case 'dibicada':
        this.tactic(id, 'dibicar', now);
        break;
      case 'descarregar':
      case 'descarrega':
      case 'relar':
        this.tactic(id, 'descarregar', now);
        break;
      case 'aparar':
      case 'apara':
        this.aparar(id, e.user.displayName, e.user.color, now);
        break;
      default:
        break;
    }
  }

  join(id: string, name: string, color: string | undefined, model: number | null) {
    if (this.status !== 'lobby') return false;
    const existing = this.byId.get(id);
    if (existing) {
      if (model !== null && existing.model !== model) {
        existing.model = model;
        this.rosterVersion++;
        this.dirty = true;
      }
      return false;
    }
    if (this.kites.length >= this.config.maxPlayers) return false;
    this.add(id, name, color, false, model ?? Math.floor(this.rng() * KITE_MODELS.length));
    return true;
  }

  tactic(id: string, t: Tactic, now = Date.now()) {
    const k = this.byId.get(id);
    if (!k?.alive || this.status !== 'play' || now - k.last[t] < COOLDOWN[t]) return false;
    k.last[t] = now;
    if (t === 'puxar') {
      k.puxarUntil = now + 5000;
      if (!k.relo) {
        k.ty = Math.max(SKY_TOP, k.y - 90);
        k.wanderUntil = now + 3500;
      }
    } else if (t === 'dibicar') {
      if (!k.relo) {
        const target = this.nearestEnemy(k, 520);
        if (target) {
          k.chase = target;
          k.chaseUntil = now + 6000;
        }
      }
      k.dibicarUntil = now + 7000;
    } else {
      k.armedAt = now;
    }
    this.push({ kind: 'tactic', a: k.idx, b: -1, label: t });
    return true;
  }

  aparar(id: string, name: string, color: string | undefined, now = Date.now()) {
    if (this.status !== 'play' && this.status !== 'finished') return false;
    const v = this.voadas.find((x) => now < x.endsAt);
    if (!v) return false;
    const cur = this.aparadores.get(id);
    if (cur && now - cur.last < APARAR_COOLDOWN_MS) return false;
    const c = color && /^#[0-9a-f]{6}$/i.test(color) ? color : '#ffffff';
    if (cur) {
      cur.n++;
      cur.last = now;
    } else this.aparadores.set(id, { name: name.slice(0, 25), color: c, n: 1, last: now });
    this.voadas = this.voadas.filter((x) => x !== v);
    this.push({ kind: 'aparar', a: -1, b: v.owner, x: Math.round(v.x), y: Math.round(v.y), label: name.slice(0, 25), color: c, voada: v.id });
    return true;
  }

  // ─── Apoios ────────────────────────────────────────────────

  special(e: SupportEvent, now = Date.now()): KiteSupportResult {
    const none = { applied: false, effect: null };
    if (!this.isActive) return none;
    if (e.kind === 'raid') {
      if (this.status !== 'play') return none;
      this.gustUntil = now + 6000;
      this.windTarget = this.wind >= 0 ? 1 : -1;
      this.push({ kind: 'gust', a: -1, b: -1, label: 'raid' });
      for (let i = 0; i < 6; i++) {
        const m = Math.floor(this.rng() * KITE_MODELS.length);
        this.spawnVoada(80 + this.rng() * (KITE_W - 160), -20 - i * 30, -1, COLORS[Math.floor(this.rng() * COLORS.length)], m, now + i * 400);
      }
      return { applied: true, effect: 'VENTANIA e CHUVA DE PIPAS para o chat aparar' };
    }
    const id = e.user ? `${e.platform}:${e.user.id}` : null;
    let k = id ? this.byId.get(id) : undefined;
    if (!k && id && e.user && this.status === 'lobby' && this.kites.length < this.config.maxPlayers)
      k = this.add(id, e.user.name, e.user.color, false, Math.floor(this.rng() * KITE_MODELS.length));
    if (!k?.alive) return none;
    if (e.kind === 'points') {
      if (k.rabiolas >= 3) return none;
      k.rabiolas++;
      this.push({ kind: 'item', a: k.idx, b: -1, label: 'rabiola' });
      return { applied: true, effect: `RABIOLA EXTRA para ${k.name}` };
    }
    if (e.kind === 'bits') {
      if (k.line >= 2) return none;
      k.line = 2;
      this.push({ kind: 'item', a: k.idx, b: -1, label: 'diamante' });
      return { applied: true, effect: `LINHA DIAMANTE para ${k.name}` };
    }
    // sub / gift: Raia Dourada
    if (k.golden) return none;
    k.golden = true;
    k.line = 3;
    k.rabiolas = Math.min(3, k.rabiolas + 1);
    this.rosterVersion++;
    this.push({ kind: 'item', a: k.idx, b: -1, label: 'dourada' });
    return { applied: true, effect: `RAIA DOURADA para ${k.name}` };
  }

  // ─── Simulação ─────────────────────────────────────────────

  update(now = Date.now()) {
    const dt = this.lastUpdate ? Math.min(0.25, (now - this.lastUpdate) / 1000) : 0.1;
    this.lastUpdate = now;
    if (this.status === 'lobby' && this.lobbyEndsAt !== null && now >= this.lobbyEndsAt) this.beginPlay(now);
    if (this.status === 'finished') this.updateVoadas(now, dt);
    if (this.status !== 'play') return;
    this.dirty = true;

    const elapsed = now - (this.startedAt ?? now);
    const progress = Math.min(1, elapsed / (this.config.durationSec * 1000));
    this.updateWind(now, dt);
    if (elapsed > LAUNCH_MS) this.updateEvents(now);

    for (const k of this.kites) {
      if (!k.alive) continue;
      this.think(k, now, elapsed, progress);
      this.move(k, now, dt);
    }
    if (elapsed > LAUNCH_MS) this.detectRelos(now);
    for (const r of [...this.relos]) if (now >= r.endsAt) this.resolve(r, now);
    this.updateVoadas(now, dt);

    if (this.aliveCount <= 1) this.finish(now, 'last');
    else if (this.endsAt !== null && now >= this.endsAt) this.finish(now, 'time');
  }

  // ─── Saída ─────────────────────────────────────────────────

  snapshot(now = Date.now(), peek = false): KiteSnapshot {
    const sendRoster = peek || this.sentRoster !== this.rosterVersion;
    let events: KiteEvent[] = [];
    if (!peek) {
      this.sentRoster = this.rosterVersion;
      events = this.events;
      this.events = [];
      this.dirty = false;
    }
    return {
      status: this.status,
      fullscreen: this.config.fullscreen,
      lobbyEndsAt: this.lobbyEndsAt,
      startedAt: this.startedAt,
      endsAt: this.endsAt,
      serverNow: now,
      rosterVersion: this.rosterVersion,
      roster: sendRoster
        ? this.kites.map<KiteRosterEntry>((k) => ({ name: k.name, color: k.color, bot: k.bot || undefined, model: k.model, ax: Math.round(k.ax), ay: Math.round(k.ay) }))
        : undefined,
      kites: this.kites.map((k) => [
        k.idx,
        Math.round(k.x),
        Math.round(k.y),
        (k.alive ? KITE_FLAG.alive : 0) |
          (k.relo ? KITE_FLAG.relo : 0) |
          (now < k.puxarUntil ? KITE_FLAG.puxar : 0) |
          (now - k.armedAt < 2500 ? KITE_FLAG.descarregar : 0) |
          (now < k.stuckUntil ? KITE_FLAG.stuck : 0) |
          (k.golden ? KITE_FLAG.golden : 0) |
          (k.chase && now < k.chaseUntil ? KITE_FLAG.dibicar : 0),
        k.rabiolas,
        k.line,
        k.cuts,
      ]),
      relos: this.relos.map<KiteRelo>((r) => ({ a: r.a.idx, b: r.b.idx, x: Math.round(r.x), y: Math.round(r.y), endsAt: r.endsAt })),
      voadas: this.voadas.filter((v) => now < v.endsAt).map(({ id, x, y, owner, color, model, endsAt }) => ({ id, x: Math.round(x), y: Math.round(y), owner, color, model, endsAt })),
      wind: Math.round(this.wind * 100) / 100,
      gust: now < this.gustUntil,
      alive: this.aliveCount,
      participants: this.humans,
      events,
      winner: this.winner,
      winReason: this.winReason,
      topCuts: [...this.kites]
        .filter((k) => k.cuts > 0)
        .sort((a, b) => b.cuts - a.cuts)
        .slice(0, 5)
        .map((k) => k.idx),
      aparadores: [...this.aparadores.values()]
        .sort((a, b) => b.n - a.n)
        .slice(0, 5)
        .map(({ name, color, n }) => ({ name, color, n })),
    };
  }

  podium() {
    return [...this.kites]
      .sort((a, b) => (a.place ?? 99) - (b.place ?? 99))
      .slice(0, 3)
      .map((k) => ({ name: k.name, cuts: k.cuts, bot: k.bot }));
  }

  // ─── Fases ─────────────────────────────────────────────────

  private beginPlay(now: number) {
    if (this.humans === 0) {
      this.status = 'stopped';
      this.dirty = true;
      return;
    }
    if (this.config.fillBots)
      for (let i = 0; this.kites.length < MIN_FIELD && i < BOT_NAMES.length; i++) this.add(`cpu:${i}`, BOT_NAMES[i], '#9aa0a6', true, Math.floor(this.rng() * KITE_MODELS.length));
    this.status = 'play';
    this.startedAt = now;
    this.endsAt = now + this.config.durationSec * 1000;
    this.nextGustAt = now + 25_000 + this.rng() * 10_000;
    this.nextStuckAt = now + 20_000 + this.rng() * 15_000;
    this.nextWindAt = now + 8000;
    for (const k of this.kites) {
      k.x = k.ax;
      k.y = k.ay - 6;
      k.tx = clampX(k.ax + (this.rng() - 0.5) * 260);
      k.ty = 70 + this.rng() * 170;
      k.wanderUntil = now + LAUNCH_MS;
      k.nextAutoAt = now + LAUNCH_MS + 2000 + this.rng() * 6000;
    }
    this.rosterVersion++;
    this.dirty = true;
  }

  private finish(_now: number, reason: 'last' | 'time') {
    for (const r of this.relos) r.a.relo = r.b.relo = null;
    this.relos = [];
    const alive = this.kites
      .filter((k) => k.alive)
      .sort((a, b) => b.cuts - a.cuts || b.rabiolas - a.rabiolas || a.y - b.y);
    alive.forEach((k, i) => {
      k.place = i + 1;
    });
    const w = alive[0] ?? null;
    this.winner = w ? w.idx : null;
    this.winReason = w ? (alive.length > 1 ? 'time' : reason) : null;
    this.status = 'finished';
    if (w) this.push({ kind: 'win', a: w.idx, b: -1, label: this.winReason ?? undefined });
    this.dirty = true;
  }

  // ─── Pipas ─────────────────────────────────────────────────

  private think(k: Kite, now: number, elapsed: number, progress: number) {
    if (k.relo) return;
    if (now < k.stuckUntil) return;
    if (k.chase && (!k.chase.alive || now >= k.chaseUntil)) k.chase = null;
    if (k.chase) {
      k.tx = k.chase.x + (k.x < k.chase.x ? -6 : 6);
      k.ty = k.chase.y + 4;
      return;
    }
    // ataque automático: cada vez mais frequente (o céu não pode ficar parado)
    if (elapsed > LAUNCH_MS && now >= k.nextAutoAt) {
      k.nextAutoAt = now + 4000 + this.rng() * 5000;
      const stuck = this.kites.find((o) => o.alive && o !== k && now < o.stuckUntil);
      // reta final (3 ou menos no céu): vão uns atrás dos outros
      const final = this.aliveCount <= 3;
      if (this.rng() < 0.1 + 0.6 * progress * progress + (final ? 0.45 : 0) || stuck) {
        const target = stuck && this.rng() < 0.6 ? stuck : this.nearestEnemy(k, final ? 2000 : 300 + 400 * progress);
        if (target) {
          k.chase = target;
          k.chaseUntil = now + 5000;
          if (k.bot && this.rng() < 0.4) {
            k.dibicarUntil = now + 6000;
            this.push({ kind: 'tactic', a: k.idx, b: -1, label: 'dibicar' });
          }
          return;
        }
      }
      if (k.bot && this.rng() < 0.25) {
        k.puxarUntil = now + 5000;
        k.ty = Math.max(SKY_TOP, k.y - 90);
        k.wanderUntil = now + 3500;
        this.push({ kind: 'tactic', a: k.idx, b: -1, label: 'puxar' });
      }
    }
    if (now >= k.wanderUntil) {
      // passeia perto da própria laje, mais para o meio com o tempo
      const center = KITE_W / 2;
      const pull = this.aliveCount <= 3 ? 0.9 : progress * 0.6;
      const base = k.ax + (center - k.ax) * pull;
      k.tx = clampX(base + (this.rng() - 0.5) * (360 - 160 * progress));
      k.ty = SKY_TOP + 20 + this.rng() * (SKY_LOW - SKY_TOP - 60);
      k.wanderUntil = now + 3500 + this.rng() * 3500;
    }
  }

  private move(k: Kite, now: number, dt: number) {
    if (now < k.stuckUntil) {
      // enroscou no fio: desce até a fiação e fica parada
      k.y += (SKY_LOW + 18 - k.y) * Math.min(1, dt * 2);
      return;
    }
    if (k.relo) {
      // no relo: as duas pipas grudam no ponto onde as linhas cruzaram, tremendo
      const side = k === k.relo.a ? -1 : 1;
      const tx = k.relo.x + side * 12 + Math.sin(now / 90 + k.idx) * 3;
      const ty = k.relo.y + Math.cos(now / 110 + k.idx) * 3;
      k.x += (tx - k.x) * Math.min(1, dt * 4);
      k.y += (ty - k.y) * Math.min(1, dt * 4);
      return;
    }
    const speed = (k.chase ? CHASE_SPEED : SPEED) * (now < k.puxarUntil ? 1.35 : 1);
    const d = Math.hypot(k.tx - k.x, k.ty - k.y);
    if (d > 1) {
      const step = Math.min(d, speed * dt);
      k.x += ((k.tx - k.x) / d) * step;
      k.y += ((k.ty - k.y) / d) * step;
    }
    // vento empurra para o lado (rajada empurra forte)
    const gust = now < this.gustUntil ? 70 : 0;
    k.x += this.wind * (14 + gust) * dt;
    if (gust) k.y += Math.sin(now / 160 + k.idx) * 30 * dt;
    // a linha tem tamanho: não vai longe demais da laje
    const ld = Math.hypot(k.x - k.ax, k.y - k.ay);
    if (ld > MAX_LINE) {
      k.x = k.ax + ((k.x - k.ax) / ld) * MAX_LINE;
      k.y = k.ay + ((k.y - k.ay) / ld) * MAX_LINE;
    }
    k.x = clampX(k.x);
    k.y = Math.min(SKY_LOW, Math.max(SKY_TOP, k.y));
  }

  private nearestEnemy(k: Kite, maxD: number) {
    let best: Kite | null = null;
    let bd = maxD;
    for (const o of this.kites) {
      if (o === k || !o.alive || o.relo) continue;
      const d = Math.hypot(o.x - k.x, o.y - k.y);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  // ─── Relo ──────────────────────────────────────────────────

  private detectRelos(now: number) {
    const free = this.kites.filter((k) => k.alive && !k.relo);
    for (let i = 0; i < free.length; i++) {
      const a = free[i];
      if (a.relo) continue;
      for (let j = i + 1; j < free.length; j++) {
        const b = free[j];
        if (b.relo || a.relo) continue;
        const key = a.idx < b.idx ? `${a.idx}-${b.idx}` : `${b.idx}-${a.idx}`;
        if ((this.pairUntil.get(key) ?? 0) > now) continue;
        let at: { x: number; y: number } | null = null;
        if (Math.hypot(a.x - b.x, a.y - b.y) < 30) at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        else {
          const hit = cross(a.ax, a.ay, a.x, a.y, b.ax, b.ay, b.x, b.y);
          // só vale cruzando perto das pipas (parte de cima das linhas)
          if (hit && hit.t > 0.62 && hit.u > 0.62) at = { x: hit.x, y: hit.y };
        }
        if (!at) continue;
        this.startRelo(a, b, at.x, at.y, now);
        break;
      }
    }
  }

  private startRelo(a: Kite, b: Kite, x: number, y: number, now: number) {
    const r: Relo = { a, b, x, y: Math.min(SKY_LOW, y), startedAt: now, endsAt: now + RELO_MS };
    a.relo = b.relo = r;
    a.chase = b.chase = null;
    this.relos.push(r);
    this.push({ kind: 'relo', a: a.idx, b: b.idx, x: Math.round(x), y: Math.round(y) });
    // CPU também tem manha
    for (const k of [a, b]) {
      if (!k.bot) continue;
      const roll = this.rng();
      if (roll < 0.45) {
        k.armedAt = now + 1500;
        this.push({ kind: 'tactic', a: k.idx, b: -1, label: 'descarregar' });
      } else if (roll < 0.7) {
        k.puxarUntil = now + RELO_MS + 500;
        this.push({ kind: 'tactic', a: k.idx, b: -1, label: 'puxar' });
      }
    }
  }

  private power(k: Kite, other: Kite, r: Relo) {
    const alt = Math.max(-1, Math.min(1, (other.y - k.y) / 120));
    let p = KITE_LINES[k.line].power * (1 + 0.3 * alt);
    if (k.armedAt >= r.startedAt - ARM_EARLY_MS && k.armedAt <= r.endsAt) p *= 1.4;
    if (k.puxarUntil >= r.startedAt) p *= 1.15;
    if (k.dibicarUntil >= r.startedAt) p *= 1.1;
    if (r.startedAt < k.stuckUntil) p *= 0.6;
    return p * (0.65 + this.rng() * 0.7);
  }

  private resolve(r: Relo, now: number) {
    this.relos = this.relos.filter((x) => x !== r);
    const { a, b } = r;
    a.relo = b.relo = null;
    const key = a.idx < b.idx ? `${a.idx}-${b.idx}` : `${b.idx}-${a.idx}`;
    this.pairUntil.set(key, now + PAIR_COOLDOWN_MS);
    if (!a.alive || !b.alive) return;
    const pa = this.power(a, b, r);
    const pb = this.power(b, a, r);
    const [win, lose] = pa >= pb ? [a, b] : [b, a];
    // quem descarregou perde altura
    for (const k of [a, b]) {
      if (k.armedAt >= r.startedAt - ARM_EARLY_MS && k.armedAt <= r.endsAt) {
        k.y = Math.min(SKY_LOW, k.y + 50);
        k.armedAt = -Infinity;
      }
      k.ty = k.y;
      k.wanderUntil = now + 1500;
      k.nextAutoAt = Math.max(k.nextAutoAt, now + 2500);
    }
    if (lose.rabiolas > 0) {
      lose.rabiolas--;
      lose.x += lose.x < win.x ? -30 : 30;
      this.push({ kind: 'rabiola', a: win.idx, b: lose.idx, x: Math.round(r.x), y: Math.round(r.y) });
      return;
    }
    lose.alive = false;
    lose.relo = null;
    this.cutCount++;
    lose.place = this.kites.length - this.cutCount + 1;
    win.cuts++;
    this.push({ kind: 'cut', a: win.idx, b: lose.idx, x: Math.round(lose.x), y: Math.round(lose.y) });
    this.spawnVoada(lose.x, lose.y, lose.idx, lose.color, lose.model, now);
    for (const k of this.kites) if (k.chase === lose) k.chase = null;
  }

  // ─── Voadas, vento e eventos ───────────────────────────────

  private spawnVoada(x: number, y: number, owner: number, color: string, model: number, now: number) {
    this.voadas.push({ id: ++this.voadaSeq, x, y, owner, color, model, endsAt: now + VOADA_MS, vx: (this.rng() - 0.5) * 30, vy: 14 + this.rng() * 8 });
  }

  private updateVoadas(now: number, dt: number) {
    for (const v of [...this.voadas]) {
      if (now >= v.endsAt || v.y > KITE_H + 30) {
        this.voadas = this.voadas.filter((x) => x !== v);
        this.push({ kind: 'lost', a: -1, b: v.owner, x: Math.round(v.x), y: Math.round(Math.min(v.y, KITE_H)), voada: v.id });
        continue;
      }
      // cai balançando e vai com o vento
      v.x += (v.vx + this.wind * 22 + Math.sin(now / 400 + v.id) * 25) * dt;
      v.y += v.vy * dt;
      v.x = Math.min(KITE_W - 10, Math.max(10, v.x));
    }
  }

  private updateWind(now: number, dt: number) {
    if (now >= this.nextWindAt) {
      this.windTarget = (this.rng() - 0.5) * 1.4;
      this.nextWindAt = now + 12_000 + this.rng() * 8000;
    }
    this.wind += (this.windTarget - this.wind) * Math.min(1, dt * 0.5);
  }

  private updateEvents(now: number) {
    if (now >= this.nextGustAt) {
      this.nextGustAt = now + 30_000 + this.rng() * 15_000;
      this.gustUntil = now + 4000;
      this.windTarget = this.rng() < 0.5 ? -1 : 1;
      this.push({ kind: 'gust', a: -1, b: -1 });
    }
    if (now >= this.nextStuckAt) {
      this.nextStuckAt = now + 30_000 + this.rng() * 20_000;
      const free = this.kites.filter((k) => k.alive && !k.relo && now >= k.stuckUntil);
      if (free.length > 2) {
        const k = free[Math.floor(this.rng() * free.length)];
        k.stuckUntil = now + 5000;
        k.chase = null;
        this.push({ kind: 'stuck', a: k.idx, b: -1, x: Math.round(k.x), y: SKY_LOW + 18 });
      }
    }
  }

  // ─── Cadastro ──────────────────────────────────────────────

  private freeSlot() {
    const used = new Set(this.kites.map((k) => k.slot));
    const free: number[] = [];
    for (let s = 0; s < this.config.maxPlayers; s++) if (!used.has(s)) free.push(s);
    return free[Math.floor(this.rng() * free.length)] ?? this.kites.length;
  }

  private add(id: string, name: string, color: string | undefined, bot: boolean, model: number) {
    const slot = this.freeSlot();
    const n = Math.max(MIN_FIELD, this.config.maxPlayers);
    const ax = 24 + ((slot + 0.5) * (KITE_W - 48)) / n;
    const ay = kiteRoofY(ax) - 14;
    const k: Kite = {
      idx: this.kites.length,
      id,
      name: name.slice(0, 25),
      color: color && /^#[0-9a-f]{6}$/i.test(color) ? color : COLORS[this.kites.length % COLORS.length],
      bot,
      model: Math.max(0, Math.min(KITE_MODELS.length - 1, model)),
      slot,
      ax,
      ay,
      x: ax,
      y: ay - 6,
      tx: ax,
      ty: ay - 6,
      wanderUntil: 0,
      alive: true,
      place: null,
      cuts: 0,
      rabiolas: 1,
      line: this.rng() < 0.25 ? 1 : 0,
      golden: false,
      relo: null,
      chase: null,
      chaseUntil: 0,
      dibicarUntil: 0,
      puxarUntil: 0,
      armedAt: -Infinity,
      stuckUntil: 0,
      nextAutoAt: 0,
      last: { puxar: -Infinity, dibicar: -Infinity, descarregar: -Infinity },
    };
    this.kites.push(k);
    this.byId.set(id, k);
    this.rosterVersion++;
    this.dirty = true;
    return k;
  }

  private push(e: Omit<KiteEvent, 'id'>) {
    this.events.push({ id: ++this.seq, ...e });
    this.dirty = true;
  }
}

// ─── utilidades ──────────────────────────────────────────────

const clampX = (x: number) => Math.min(KITE_W - 20, Math.max(20, x));

/** Cruzamento dos segmentos P(t) = A→B e Q(u) = C→D (t, u ∈ [0, 1]). */
function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = dx - cx;
  const sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-6) return null;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / den;
  const u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, x: ax + rx * t, y: ay + ry * t };
}

// ─── Chat dos mods e textos do bot ───────────────────────────

export type KiteChatCommand = { type: 'start' } | { type: 'stop' } | { type: 'help' };

/** !pipa iniciar / !pipa parar (mods) e !pipa ajuda. `!pipa` sozinho (ou com modelo) é entrar no jogo. */
export function parseKiteChatCommand(e: ChatEvent): KiteChatCommand | null {
  const cmd = parseCommand(e.text);
  if (!cmd || (cmd.name !== 'pipa' && cmd.name !== 'pipas')) return null;
  const first = (cmd.args[0] ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (['ajuda', 'help', '?', 'comandos'].includes(first)) return { type: 'help' };
  if (!(e.user.isMod || e.user.isBroadcaster)) return null;
  if (['iniciar', 'abrir', 'comecar', 'start'].includes(first)) return { type: 'start' };
  if (['parar', 'encerrar', 'cancelar', 'stop', 'fim'].includes(first)) return { type: 'stop' };
  return null;
}

export function kiteHelpText(status: KiteStatus) {
  if (status === 'lobby') return '🪁 Inscrições abertas! Digite !pipa (ou !pipa raia / capucheta / arraia / peixinho).';
  if (status === 'play') return '🪁 No céu: !puxar (sobe), !dibicar (ataca a mais perto), !descarregar (no relo, mais força). Pipa voada? Qualquer um: !aparar';
  return 'Mods: !pipa iniciar · !pipa parar. No jogo: !pipa, !puxar, !dibicar, !descarregar e !aparar.';
}

export function kiteOpenAnnouncement(cfg: KiteConfig) {
  return `🪁 PIPA COMBATE! Inscrições por ${cfg.joinSec} s: digite !pipa (ou escolha: !pipa raia, capucheta, arraia ou peixinho). Último no céu vence!`;
}

export function kiteStartAnnouncement(players: number, durationSec: number) {
  const min = Math.round(durationSec / 60);
  return `🪁 ${players} pipas no céu, ${min} min de combate! Táticas: !puxar, !dibicar e !descarregar (no relo). Pipa voada? Qualquer um apara com !aparar`;
}

export function kiteResultAnnouncement(winner: string | null, cuts: number, reason: 'last' | 'time' | null, aparador: { name: string; n: number } | null) {
  const ap = aparador ? ` Rei da aparada: ${aparador.name} (${aparador.n}).` : '';
  if (!winner) return `🪁 Céu limpo, ninguém sobrou!${ap}`;
  const how = reason === 'time' ? 'mais cortes no fim do tempo' : 'último no céu';
  return `🏆 ${winner} é o REI DO CÉU (${how}), com ${cuts} ${cuts === 1 ? 'corte' : 'cortes'}! 🪁${ap}`;
}
