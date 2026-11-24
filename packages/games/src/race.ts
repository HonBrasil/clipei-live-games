import {
  normalizeRaceConfig,
  parseCommand,
  RACE_FLAG,
  type ChatEvent,
  type RaceConfig,
  type RaceEvent,
  type RaceObstacle,
  type RacePodiumEntry,
  type RaceRosterEntry,
  type RaceSnapshot,
  type RaceStatus,
  type SupportEvent,
} from '@clipei/shared';

/**
 * Corrida do chat, vista de cima.
 *
 * 1. Inscrição: `!correr` coloca a pessoa no grid (uma vez só).
 * 2. Largada com contagem de 3 s. Todo mundo anda sozinho, com ritmo sorteado
 *    a cada poucos segundos (sorte) e um leve "vácuo" para quem ficou para trás.
 * 3. De tempo em tempo abre uma JANELA DE TURBO (4 s): quem digitar `!turbo`
 *    ganha um arranque, com 15% de chance de tropeçar.
 * 4. Óleo e cascas de banana aparecem na pista; desviar é sorte (posição lateral).
 * 5. Apoios viram poderes: pontos = escudo, bits = foguete, sub = foguete +
 *    escudo (ou banana no líder), raid = vento a favor para todos.
 *
 * Unidades: progresso em voltas (0..laps); posição lateral de −1 a 1.
 */

/** Voltas por segundo de um piloto no ritmo médio (~34 s por volta). */
export const RACE_BASE_SPEED = 1 / 34;
export const RACE_COUNTDOWN_MS = 3000;
export const TURBO_WINDOW_MS = 4000;
const TURBO_FIRST_MS = 8000;
const TURBO_GAP_MS: [number, number] = [11_000, 15_000];
const TURBO_MS = 2200;
const TRIP_CHANCE = 0.15;
const STUMBLE_MS = 1200;
const MIN_FIELD = 4;
const LAT_HIT = 0.24;
const FINISH_GRACE_MS = 8000;

const BOT_NAMES = ['CPU Faísca', 'CPU Turbina', 'CPU Pistão', 'CPU Ferrugem'];
const BOT_COLORS = ['#9aa0a6', '#c0c4ca', '#7d838a', '#b0b5bb'];
const COLORS = ['#FF4D6D', '#7C5CFF', '#00E0FF', '#FFC300', '#3DFF8B', '#FF7A00', '#FF5CF4', '#9EF01A', '#5CA8FF', '#FFFFFF', '#FF3B3B', '#00FFC6'];

interface Runner {
  idx: number;
  id: string;
  name: string;
  color: string;
  bot: boolean;
  p: number;
  lat: number;
  latV: number;
  pace: number;
  paceUntil: number;
  boostUntil: number;
  rocket: boolean;
  stumbleUntil: number;
  shield: boolean;
  usedWindow: number;
  finishedAt: number | null;
  place: number | null;
}

export interface RaceSupportResult {
  applied: boolean;
  /** Texto curto para o anúncio (ex.: "FOGUETE"). */
  effect: string | null;
  events: RaceEvent[];
}

export class RaceGame {
  readonly config: RaceConfig;
  status: RaceStatus = 'idle';
  lobbyEndsAt: number | null = null;
  startedAt: number | null = null;
  endsAt: number | null = null;
  finishedAt: number | null = null;
  dirty = true;

  private runners: Runner[] = [];
  private byId = new Map<string, Runner>();
  private obstacles: RaceObstacle[] = [];
  private events: RaceEvent[] = [];
  private seq = 0;
  private obstacleSeq = 0;
  private rosterVersion = 0;
  private sentRosterVersion = -1;
  private finishedCount = 0;
  private thirdAt: number | null = null;
  private window = { id: 0, open: false, until: 0, nextAt: 0 };
  private nextObstacleAt = 0;
  private lastUpdate = 0;

  constructor(
    config: Partial<RaceConfig>,
    private rng: () => number = Math.random,
  ) {
    this.config = normalizeRaceConfig(config);
  }

  get isActive() {
    return this.status === 'lobby' || this.status === 'running';
  }
  get turboOpen() {
    return this.window.open;
  }
  get pilots() {
    return this.runners.length;
  }
  get humans() {
    return this.runners.filter((r) => !r.bot).length;
  }

  // ─── Fases ─────────────────────────────────────────────────

  open(now = Date.now()): RaceEvent[] {
    this.status = 'lobby';
    this.lobbyEndsAt = now + this.config.joinSec * 1000;
    this.dirty = true;
    return [];
  }

  /** Fecha as inscrições agora (botão "Largar já" do painel). */
  startNow(now = Date.now()) {
    if (this.status === 'lobby') this.lobbyEndsAt = now;
    return this.update(now);
  }

  stop(now = Date.now()) {
    if (!this.isActive) return [];
    this.status = 'stopped';
    this.finishedAt = now;
    this.dirty = true;
    return [];
  }

  // ─── Entrada do chat ───────────────────────────────────────

  handle(e: ChatEvent, now = Date.now()): RaceEvent[] {
    const cmd = parseCommand(e.text);
    if (!cmd) return [];
    const id = `${e.platform}:${e.user.id}`;
    if (['correr', 'entrar', 'play', 'join'].includes(cmd.name)) return this.join(id, e.user.displayName, e.user.color);
    if (cmd.name === 'turbo') return this.turbo(id, now);
    return [];
  }

  join(id: string, name: string, color?: string): RaceEvent[] {
    if (this.status !== 'lobby' || this.byId.has(id) || this.runners.length >= this.config.maxRunners) return [];
    const r = this.addRunner(id, name, color, false);
    return [this.emit('join', r.idx)];
  }

  turbo(id: string, now = Date.now()): RaceEvent[] {
    const r = this.byId.get(id);
    if (!r || !this.racing(now) || r.finishedAt !== null) return [];
    if (!this.window.open || r.usedWindow === this.window.id) return [];
    r.usedWindow = this.window.id;
    this.dirty = true;
    if (this.rng() < TRIP_CHANCE) {
      r.stumbleUntil = now + 1000;
      r.boostUntil = 0;
      return [this.emit('trip', r.idx)];
    }
    r.boostUntil = now + TURBO_MS;
    r.rocket = false;
    return [this.emit('turbo', r.idx)];
  }

  /** Apoios viram poderes. Sem corrida ativa (ou sem efeito possível), applied = false. */
  special(e: SupportEvent, now = Date.now()): RaceSupportResult {
    const none: RaceSupportResult = { applied: false, effect: null, events: [] };
    if (!this.isActive) return none;
    const id = e.user ? `${e.platform}:${e.user.id}` : null;
    let r = id ? this.byId.get(id) : undefined;
    // apoiou durante a inscrição: já entra na corrida
    if (!r && id && e.user && this.status === 'lobby' && this.runners.length < this.config.maxRunners) {
      r = this.addRunner(id, e.user.name, e.user.color, false);
      this.events.push(this.mk('join', r.idx));
    }
    const label = e.user?.name;
    const events: RaceEvent[] = [];

    if (e.kind === 'raid') {
      const from = Math.max(now, this.startedAt ?? now);
      for (const x of this.runners) if (x.finishedAt === null) x.boostUntil = from + 2500;
      events.push(this.emit('raid', -1, label));
      return { applied: true, effect: 'VENTO A FAVOR para todos', events };
    }

    if (e.kind === 'points') {
      if (!r || r.finishedAt !== null) return none;
      r.shield = true;
      events.push(this.emit('shield', r.idx));
      return { applied: true, effect: 'ESCUDO', events };
    }

    if (e.kind === 'bits') {
      const secs = Math.min(6, 1.5 + (e.amount / 100) * 0.75);
      if (r && r.finishedAt === null) {
        this.rocketFor(r, secs, now);
        events.push(this.emit('rocket', r.idx));
        return { applied: true, effect: `FOGUETE de ${secs.toFixed(1).replace('.', ',')} s`, events };
      }
      return this.bananaOnLeader(label, events) ? { applied: true, effect: 'CASCA DE BANANA no líder', events } : none;
    }

    // sub / gift
    if (r && r.finishedAt === null) {
      this.rocketFor(r, e.kind === 'gift' ? Math.min(6, 3 + e.amount * 0.3) : 3.5, now);
      r.shield = true;
      events.push(this.emit('rocket', r.idx), this.emit('shield', r.idx));
      return { applied: true, effect: 'FOGUETE + ESCUDO', events };
    }
    return this.bananaOnLeader(label, events) ? { applied: true, effect: 'CASCA DE BANANA no líder', events } : none;
  }

  // ─── Simulação ─────────────────────────────────────────────

  update(now = Date.now()): RaceEvent[] {
    const out: RaceEvent[] = [];
    const dt = this.lastUpdate ? Math.min(0.25, (now - this.lastUpdate) / 1000) : 0.1;
    this.lastUpdate = now;

    if (this.status === 'lobby' && this.lobbyEndsAt !== null && now >= this.lobbyEndsAt) {
      if (this.humans === 0) {
        this.status = 'stopped';
        this.finishedAt = now;
        this.dirty = true;
        return out;
      }
      if (this.config.fillBots) {
        for (let i = 0; this.runners.length < MIN_FIELD && i < BOT_NAMES.length; i++) this.addRunner(`cpu:${i}`, BOT_NAMES[i], BOT_COLORS[i], true);
      }
      // grid: espalha na largura da pista
      this.runners.forEach((r, i) => {
        r.lat = this.runners.length === 1 ? 0 : -0.8 + (1.6 * (i % 8)) / 7;
        r.p = -0.004 * Math.floor(i / 8);
      });
      this.status = 'running';
      this.startedAt = now + RACE_COUNTDOWN_MS;
      this.endsAt = this.startedAt + this.config.laps * (1 / RACE_BASE_SPEED) * 1.8 * 1000;
      this.window = { id: 0, open: false, until: 0, nextAt: this.startedAt + TURBO_FIRST_MS };
      this.nextObstacleAt = this.startedAt + 5000;
      this.dirty = true;
    }

    if (!this.racing(now)) return out;
    this.dirty = true;

    // janela de turbo
    if (!this.window.open && now >= this.window.nextAt) {
      this.window = { id: this.window.id + 1, open: true, until: now + TURBO_WINDOW_MS, nextAt: 0 };
      // pilotos CPU também aproveitam (metade das vezes)
      for (const r of this.runners) if (r.bot && r.finishedAt === null && this.rng() < 0.5) out.push(...this.turbo(r.id, now));
    } else if (this.window.open && now >= this.window.until) {
      this.window.open = false;
      this.window.nextAt = now + TURBO_GAP_MS[0] + this.rng() * (TURBO_GAP_MS[1] - TURBO_GAP_MS[0]);
    }

    const leader = this.leaderP();
    if (now >= this.nextObstacleAt) {
      this.nextObstacleAt = now + 5000 + this.rng() * 3000;
      const p = leader + 0.25 + this.rng() * 0.2;
      if (p < this.config.laps - 0.05 && this.obstacles.length < 6) {
        this.obstacles.push({ id: ++this.obstacleSeq, kind: this.rng() < 0.6 ? 'banana' : 'oil', p, lat: -0.8 + this.rng() * 1.6 });
      }
    }

    for (const r of this.runners) {
      if (r.finishedAt !== null) continue;
      if (now >= r.paceUntil) {
        r.pace = 0.88 + this.rng() * 0.24;
        r.paceUntil = now + 2500 + this.rng() * 1500;
      }
      const behind = Math.max(0, leader - r.p);
      let mul = r.pace + Math.min(0.12, behind * 0.3);
      if (now < r.stumbleUntil) mul *= 0.25;
      else if (now < r.boostUntil) mul *= r.rocket ? 2.1 : 1.75;
      for (const o of this.obstacles) {
        if (o.kind === 'oil' && Math.abs(r.p - o.p) < 0.03 && Math.abs(r.lat - o.lat) < 0.35) mul *= 0.55;
      }

      // deriva lateral: decide quem desvia dos obstáculos (sorte)
      r.latV = r.latV * 0.9 + (this.rng() - 0.5) * 2.4 * dt;
      r.lat = Math.max(-0.9, Math.min(0.9, r.lat + r.latV * dt));
      if (Math.abs(r.lat) >= 0.9) r.latV *= -0.5;

      const prev = r.p;
      r.p += RACE_BASE_SPEED * mul * dt;

      for (const o of [...this.obstacles]) {
        if (o.kind !== 'banana' || !(prev < o.p && r.p >= o.p) || Math.abs(r.lat - o.lat) > LAT_HIT) continue;
        this.obstacles.splice(this.obstacles.indexOf(o), 1);
        if (r.shield) {
          r.shield = false;
          out.push(this.emit('blocked', r.idx));
        } else {
          r.stumbleUntil = now + STUMBLE_MS;
          r.boostUntil = 0;
          out.push(this.emit('hit', r.idx));
        }
      }

      if (r.p >= this.config.laps) {
        r.p = this.config.laps;
        r.finishedAt = now;
        r.place = ++this.finishedCount;
        if (r.place === 3) this.thirdAt = now;
        if (r.place <= 3) out.push(this.emit('finish', r.idx, undefined, r.place));
      }
    }
    // obstáculos que todos já passaram somem
    const last = Math.min(...this.runners.filter((r) => r.finishedAt === null).map((r) => r.p), this.config.laps);
    this.obstacles = this.obstacles.filter((o) => o.p > last - 0.02);

    const allDone = this.finishedCount >= this.runners.length;
    const grace = this.thirdAt !== null && now - this.thirdAt >= FINISH_GRACE_MS;
    if (allDone || grace || (this.endsAt !== null && now >= this.endsAt)) this.finish(now);
    return out;
  }

  // ─── Saída ─────────────────────────────────────────────────

  /** Ordem atual: quem chegou (pela colocação), depois quem está mais à frente. */
  standings(): Runner[] {
    return [...this.runners].sort((a, b) => {
      if (a.place !== null || b.place !== null) return (a.place ?? Infinity) - (b.place ?? Infinity);
      return b.p - a.p;
    });
  }

  podium(): RacePodiumEntry[] {
    return this.standings()
      .slice(0, 3)
      .map((r) => ({ name: r.name, color: r.color, timeMs: r.finishedAt && this.startedAt ? r.finishedAt - this.startedAt : null, bot: r.bot || undefined }));
  }

  snapshot(now = Date.now(), fullRoster = false): RaceSnapshot {
    // fullRoster = foto para quem acabou de conectar: não consome os eventos dos outros
    const sendRoster = fullRoster || this.sentRosterVersion !== this.rosterVersion;
    const racing = this.racing(now);
    let events: RaceEvent[] = [];
    if (!fullRoster) {
      this.sentRosterVersion = this.rosterVersion;
      events = this.events;
      this.events = [];
      this.dirty = false;
    }
    return {
      status: this.status,
      track: this.config.track,
      laps: this.config.laps,
      maxRunners: this.config.maxRunners,
      lobbyEndsAt: this.lobbyEndsAt,
      startedAt: this.startedAt,
      endsAt: this.endsAt,
      finishedAt: this.finishedAt,
      serverNow: now,
      rosterVersion: this.rosterVersion,
      roster: sendRoster ? this.runners.map<RaceRosterEntry>((r) => ({ name: r.name, color: r.color, bot: r.bot || undefined })) : undefined,
      runners: this.runners.map((r) => {
        let flags = 0;
        if (now < r.boostUntil) flags |= r.rocket ? RACE_FLAG.rocket : RACE_FLAG.boost;
        if (now < r.stumbleUntil) flags |= RACE_FLAG.stumble;
        if (r.shield) flags |= RACE_FLAG.shield;
        if (r.finishedAt !== null) flags |= RACE_FLAG.finished;
        const speed = racing && r.finishedAt === null ? this.speedOf(r, now) : 0;
        return [r.idx, Math.round(r.p * 1e4), Math.round(r.lat * 100), Math.round(speed * 1e5), flags];
      }),
      obstacles: this.obstacles.map((o) => ({ ...o, p: Math.round(o.p * 1e4) / 1e4, lat: Math.round(o.lat * 100) / 100 })),
      turbo: { open: this.window.open, until: this.window.open ? this.window.until : null, nextAt: this.window.open ? null : this.window.nextAt || null },
      events,
      leaders: this.standings()
        .slice(0, 5)
        .map((r) => r.idx),
      podium: this.status === 'finished' ? this.podium() : [],
      participants: this.humans,
    };
  }

  // ─── Internos ──────────────────────────────────────────────

  private racing(now: number) {
    return this.status === 'running' && this.startedAt !== null && now >= this.startedAt;
  }

  private finish(now: number) {
    this.status = 'finished';
    this.finishedAt = now;
    this.obstacles = [];
    this.window.open = false;
    // quem não chegou fica ordenado por distância
    for (const r of this.standings()) if (r.place === null) r.place = ++this.finishedCount;
    this.dirty = true;
  }

  private addRunner(id: string, name: string, color: string | undefined, bot: boolean) {
    const r: Runner = {
      idx: this.runners.length,
      id,
      name: name.slice(0, 25),
      color: color && /^#[0-9a-f]{6}$/i.test(color) ? color : COLORS[this.runners.length % COLORS.length],
      bot,
      p: 0,
      lat: 0,
      latV: 0,
      pace: 1,
      paceUntil: 0,
      boostUntil: 0,
      rocket: false,
      stumbleUntil: 0,
      shield: false,
      usedWindow: 0,
      finishedAt: null,
      place: null,
    };
    this.runners.push(r);
    this.byId.set(id, r);
    this.rosterVersion++;
    this.dirty = true;
    return r;
  }

  private rocketFor(r: Runner, secs: number, now: number) {
    const from = Math.max(now, this.startedAt ?? now);
    r.boostUntil = Math.max(r.boostUntil, from) + secs * 1000;
    r.rocket = true;
    r.stumbleUntil = 0;
  }

  /** Casca de banana bem na frente do líder (na mesma faixa: acerta, a não ser que ele tenha escudo). */
  private bananaOnLeader(label: string | undefined, events: RaceEvent[]) {
    const leader = this.standings().find((r) => r.finishedAt === null);
    if (!leader || this.status !== 'running') return false;
    const p = Math.max(leader.p, 0) + 0.03;
    if (p >= this.config.laps) return false;
    this.obstacles.push({ id: ++this.obstacleSeq, kind: 'banana', p, lat: leader.lat });
    leader.latV = 0;
    events.push(this.emit('banana', leader.idx, label));
    return true;
  }

  private leaderP() {
    let best = 0;
    for (const r of this.runners) if (r.finishedAt === null && r.p > best) best = r.p;
    return best;
  }

  private speedOf(r: Runner, now: number) {
    let mul = r.pace;
    if (now < r.stumbleUntil) mul *= 0.25;
    else if (now < r.boostUntil) mul *= r.rocket ? 2.1 : 1.75;
    return RACE_BASE_SPEED * mul;
  }

  private mk(kind: RaceEvent['kind'], who: number, label?: string, place?: number): RaceEvent {
    return { id: ++this.seq, kind, who, label, place };
  }

  private emit(kind: RaceEvent['kind'], who: number, label?: string, place?: number) {
    const ev = this.mk(kind, who, label, place);
    this.events.push(ev);
    this.dirty = true;
    return ev;
  }

  /** Nome de um piloto pelo índice (anúncios do bot). */
  nameOf(idx: number) {
    return this.runners[idx]?.name ?? '';
  }
}

// ─── Chat dos mods e textos do bot ───────────────────────────

export type RaceChatCommand = { type: 'start' } | { type: 'stop' } | { type: 'help' };

/** !corrida (ajuda), !corrida iniciar, !corrida parar (mods/streamer). */
export function parseRaceChatCommand(e: ChatEvent): RaceChatCommand | null {
  const cmd = parseCommand(e.text);
  if (!cmd || cmd.name !== 'corrida') return null;
  const first = (cmd.args[0] ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  const canControl = e.user.isMod || e.user.isBroadcaster;
  if (!first || ['ajuda', 'help', '?', 'comandos'].includes(first)) return { type: 'help' };
  if (!canControl) return null;
  if (['parar', 'encerrar', 'stop', 'cancelar', 'fim'].includes(first)) return { type: 'stop' };
  if (['iniciar', 'comecar', 'start', 'abrir'].includes(first)) return { type: 'start' };
  return { type: 'help' };
}

export function raceHelpText(status: RaceStatus) {
  if (status === 'lobby') return '🏁 Inscrições abertas: digite !correr para entrar na corrida!';
  if (status === 'running') return '🏎️ Corrida rolando! Quando aparecer TURBO na tela, digite !turbo.';
  return 'Mods: !corrida iniciar · !corrida parar. Na corrida: !correr para entrar e !turbo nas janelas de turbo.';
}

const fmtTime = (ms: number | null) => (ms === null ? '' : ` (${(ms / 1000).toFixed(1).replace('.', ',')} s)`);

export function raceOpenAnnouncement(config: RaceConfig, trackName: string) {
  return `🏁 CORRIDA ABERTA na ${trackName}! Digite !correr para entrar. Largada em ${config.joinSec} s.`;
}

export function raceStartAnnouncement(pilots: number) {
  return `🚦 Largou! ${pilots} ${pilots === 1 ? 'piloto' : 'pilotos'} na pista. Quando aparecer TURBO na tela, digite !turbo (cuidado: dá para tropeçar).`;
}

export function raceResultAnnouncement(podium: RacePodiumEntry[], pilots: number) {
  const [a, b, c] = podium;
  if (!a) return '🏁 Corrida encerrada.';
  return `🏆 ${a.name} venceu a corrida${fmtTime(a.timeMs)}!${b ? ` 🥈 ${b.name}` : ''}${c ? ` 🥉 ${c.name}` : ''} · ${pilots} ${pilots === 1 ? 'piloto' : 'pilotos'}`;
}
