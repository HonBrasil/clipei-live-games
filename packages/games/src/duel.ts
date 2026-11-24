import {
  normalizeDuelConfig,
  parseCommand,
  type ChatEvent,
  type DuelConfig,
  type DuelEvent,
  type DuelSnapshot,
  type DuelStatus,
  type SupportEvent,
} from '@clipei/shared';

/**
 * Duelo no velho oeste (X1 ou melhor de 3).
 *
 * - `!duelo`: os dois primeiros entram.
 * - Encarada (3,5 s) → contagem 3-2-1 → silêncio de 1 a 4 s sorteado → FOGO!
 * - `!bang`: reflexo COM sorte. O primeiro tiro sai antes, mas acerta só ~60%;
 *   errou, recarrega por 1,2 s e o outro tem a chance dele. Assim o atraso de
 *   cada um na live pesa menos.
 * - Atirar antes do FOGO trava a arma: o primeiro tiro depois do FOGO só sai 1,5 s depois.
 * - Torcida (`!1` / `!2`): quem tiver mais torcida ganha até +10% de mira.
 * - Apoios viram equipamento para o duelista (ou para quem o apoiador torce):
 *   pontos = mira (+15%), bits = colete (aguenta 1 tiro), sub = revólver dourado
 *   (o próximo tiro não erra).
 */

export const DUEL_INTRO_MS = 3500;
export const DUEL_COUNTDOWN_MS = 3000;
export const DUEL_WAIT_MS: [number, number] = [1000, 4000];
export const DUEL_FIRE_MS = 10_000;
export const DUEL_ROUND_MS = 3500;
export const DUEL_BASE_HIT = 0.6;
const RELOAD_MS = 1200;
const JAM_MS = 1500;
const AIM_BONUS = 0.15;
const CHEER_MAX = 0.1;
const MAX_DRAWS = 2;
const COLORS = ['#e8b04a', '#5ca8ff', '#ff5c5c', '#3dff8b', '#ff7a00', '#c58cff'];

interface Duelist {
  id: string;
  name: string;
  color: string;
  aim: boolean;
  vest: boolean;
  gold: boolean;
  jammed: boolean;
  readyAt: number;
}

export interface DuelSupportResult {
  applied: boolean;
  /** Texto do anúncio (ex.: "COLETE para Fulano") */
  effect: string | null;
}

export class DuelGame {
  readonly config: DuelConfig;
  status: DuelStatus = 'idle';
  round = 0;
  score: [number, number] = [0, 0];
  winner: number | null = null;
  phaseEndsAt: number | null = null;
  dirty = true;

  private players: Duelist[] = [];
  private cheers = new Map<string, 0 | 1>();
  private events: DuelEvent[] = [];
  private seq = 0;
  private draws = 0;

  constructor(
    config: Partial<DuelConfig>,
    private rng: () => number = Math.random,
  ) {
    this.config = normalizeDuelConfig(config);
  }

  get isActive() {
    return !['idle', 'finished', 'stopped'].includes(this.status);
  }
  get duelists() {
    return this.players.map((p) => p.name);
  }
  get target() {
    return this.config.bestOf === 3 ? 2 : 1;
  }

  open(now = Date.now()) {
    this.status = 'lobby';
    this.phaseEndsAt = now + this.config.joinSec * 1000;
    this.dirty = true;
  }

  stop(now = Date.now()) {
    if (!this.isActive) return;
    this.status = 'stopped';
    this.phaseEndsAt = null;
    void now;
    this.dirty = true;
  }

  // ─── Chat ──────────────────────────────────────────────────

  handle(e: ChatEvent, now = Date.now()): DuelEvent[] {
    const cmd = parseCommand(e.text);
    if (!cmd) return [];
    const id = `${e.platform}:${e.user.id}`;
    if (cmd.name === 'duelo' && cmd.args.length === 0) return this.join(id, e.user.displayName, e.user.color, now);
    if (['bang', 'pow', 'atirar', 'fogo', 'pew'].includes(cmd.name)) return this.shoot(id, now);
    if (cmd.name === '1' || cmd.name === '2') return this.cheer(id, cmd.name === '1' ? 0 : 1);
    if (cmd.name === 'torcer' && (cmd.args[0] === '1' || cmd.args[0] === '2')) return this.cheer(id, cmd.args[0] === '1' ? 0 : 1);
    return [];
  }

  join(id: string, name: string, color: string | undefined, now = Date.now()): DuelEvent[] {
    if (this.status !== 'lobby' || this.players.length >= 2 || this.players.some((p) => p.id === id)) return [];
    const taken = this.players[0]?.color;
    const pick = color && /^#[0-9a-f]{6}$/i.test(color) && color.toLowerCase() !== taken?.toLowerCase() ? color : COLORS.find((c) => c !== taken)!;
    this.players.push({ id, name: name.slice(0, 25), color: pick, aim: false, vest: false, gold: false, jammed: false, readyAt: 0 });
    // quem entrou deixa de torcer
    this.cheers.delete(id);
    const ev = this.emit('join', this.players.length - 1);
    if (this.players.length === 2) this.startRound(now);
    return [ev];
  }

  cheer(id: string, side: 0 | 1): DuelEvent[] {
    if (!this.config.cheer || this.players.some((p) => p.id === id)) return [];
    if (!['intro', 'countdown', 'wait', 'fire', 'round'].includes(this.status)) return [];
    if (this.cheers.get(id) === side) return [];
    this.cheers.set(id, side);
    this.dirty = true;
    return [];
  }

  shoot(id: string, now = Date.now()): DuelEvent[] {
    const who = this.players.findIndex((p) => p.id === id);
    if (who < 0) return [];
    const me = this.players[who];
    // queima de largada: arma trava
    if (this.status === 'countdown' || this.status === 'wait') {
      if (me.jammed) return [];
      me.jammed = true;
      return [this.emit('jam', who)];
    }
    if (this.status !== 'fire' || now < me.readyAt) return [];
    const other = this.players[1 - who];
    const sure = me.gold;
    me.gold = false;
    me.readyAt = now + RELOAD_MS;
    const out = [this.emit('shot', who)];
    if (!sure && this.rng() >= this.hitChance(who)) {
      out.push(this.emit('miss', who));
      return out;
    }
    if (other.vest) {
      other.vest = false;
      out.push(this.emit('vest', 1 - who));
      return out;
    }
    out.push(this.emit('hit', who));
    this.endRound(who, now);
    return out;
  }

  /** Chance de acerto do duelista (0..1). */
  hitChance(who: number) {
    let p = DUEL_BASE_HIT;
    if (this.players[who]?.aim) p += AIM_BONUS;
    if (this.config.cheer) {
      const [a, b] = this.cheerCount();
      const total = a + b;
      if (total > 0) {
        const share = (who === 0 ? a : b) / total;
        p += CHEER_MAX * Math.max(0, share - 0.5) * 2;
      }
    }
    return Math.min(0.95, p);
  }

  // ─── Apoios ────────────────────────────────────────────────

  /**
   * O equipamento vai para o próprio duelista ou, se quem apoiou está na
   * torcida, para o lado que ele torce. Cada duelista guarda 1 de cada item.
   */
  special(e: SupportEvent): DuelSupportResult {
    const none: DuelSupportResult = { applied: false, effect: null };
    if (!this.isActive || this.status === 'lobby' || e.kind === 'raid') return none;
    const id = e.user ? `${e.platform}:${e.user.id}` : null;
    let who = id ? this.players.findIndex((p) => p.id === id) : -1;
    if (who < 0 && id && this.cheers.has(id)) who = this.cheers.get(id)!;
    if (who < 0) return none;
    const p = this.players[who];
    const item = e.kind === 'points' ? 'aim' : e.kind === 'bits' ? 'vest' : 'gold';
    if (p[item]) return none;
    p[item] = true;
    this.events.push({ id: ++this.seq, kind: 'item', who, item, label: e.user?.name });
    this.dirty = true;
    const names = { aim: 'MIRA (+15%)', vest: 'COLETE', gold: 'REVÓLVER DOURADO' };
    return { applied: true, effect: `${names[item]} para ${p.name}` };
  }

  // ─── Tempo ─────────────────────────────────────────────────

  update(now = Date.now()): DuelEvent[] {
    if (!this.isActive || this.phaseEndsAt === null || now < this.phaseEndsAt) {
      // ninguém acertou a tempo
      if (this.status === 'fire' && this.fireEndsAt !== null && now >= this.fireEndsAt) return this.drawRound(now);
      return [];
    }
    switch (this.status) {
      case 'lobby':
        this.status = 'stopped';
        this.phaseEndsAt = null;
        this.dirty = true;
        return [];
      case 'intro':
        return this.phase('countdown', now + DUEL_COUNTDOWN_MS);
      case 'countdown': {
        const [a, b] = DUEL_WAIT_MS;
        return this.phase('wait', now + a + this.rng() * (b - a));
      }
      case 'wait':
        this.status = 'fire';
        this.phaseEndsAt = null;
        this.fireEndsAt = now + DUEL_FIRE_MS;
        // arma travada: o primeiro tiro atrasa
        for (const p of this.players) p.readyAt = p.jammed ? now + JAM_MS : now;
        this.dirty = true;
        return [];
      case 'round':
        if (this.winner !== null && this.score[this.winner] >= this.target) {
          this.status = 'finished';
          this.phaseEndsAt = null;
          this.dirty = true;
          return [this.emit('win', this.winner)];
        }
        if (this.draws > MAX_DRAWS) {
          this.status = 'finished';
          this.winner = null;
          this.phaseEndsAt = null;
          this.dirty = true;
          return [this.emit('draw', -1)];
        }
        this.startRound(now);
        return [];
      default:
        return [];
    }
  }

  private fireEndsAt: number | null = null;

  private phase(status: DuelStatus, endsAt: number) {
    this.status = status;
    this.phaseEndsAt = endsAt;
    this.dirty = true;
    return [];
  }

  private startRound(now: number) {
    this.round++;
    this.winner = null;
    this.fireEndsAt = null;
    for (const p of this.players) {
      p.jammed = false;
      p.readyAt = 0;
    }
    // a encarada longa só na primeira rodada
    this.phase(this.round === 1 ? 'intro' : 'countdown', now + (this.round === 1 ? DUEL_INTRO_MS : DUEL_COUNTDOWN_MS));
  }

  private endRound(winner: number, now: number) {
    this.score[winner]++;
    this.winner = winner;
    this.fireEndsAt = null;
    this.phase('round', now + DUEL_ROUND_MS);
    this.emit('round', winner);
  }

  private drawRound(now: number) {
    this.draws++;
    this.winner = null;
    this.fireEndsAt = null;
    this.phase('round', now + DUEL_ROUND_MS);
    return [this.emit('draw', -1)];
  }

  private cheerCount(): [number, number] {
    let a = 0;
    let b = 0;
    for (const side of this.cheers.values()) side === 0 ? a++ : b++;
    return [a, b];
  }

  private emit(kind: DuelEvent['kind'], who: number, label?: string): DuelEvent {
    const ev: DuelEvent = { id: ++this.seq, kind, who, label };
    this.events.push(ev);
    this.dirty = true;
    return ev;
  }

  snapshot(now = Date.now(), peek = false): DuelSnapshot {
    let events: DuelEvent[] = [];
    if (!peek) {
      events = this.events;
      this.events = [];
      this.dirty = false;
    }
    return {
      status: this.status,
      scene: this.config.scene,
      bestOf: this.config.bestOf,
      round: this.round,
      score: [...this.score],
      players: this.players.map((p) => ({ name: p.name, color: p.color, aim: p.aim, vest: p.vest, gold: p.gold, jammed: p.jammed })),
      cheers: this.cheerCount(),
      cheerOn: this.config.cheer,
      phaseEndsAt: this.phaseEndsAt,
      winner: this.winner,
      serverNow: now,
      events,
    };
  }
}

// ─── Chat dos mods e textos do bot ───────────────────────────

export type DuelChatCommand = { type: 'start' } | { type: 'stop' } | { type: 'help' };

/** !duelo iniciar / !duelo parar (mods). "!duelo" puro é para entrar (ou ajuda sem duelo aberto). */
export function parseDuelChatCommand(e: ChatEvent): DuelChatCommand | null {
  const cmd = parseCommand(e.text);
  if (!cmd || cmd.name !== 'duelo' || cmd.args.length === 0) return null;
  const first = cmd.args[0]
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (['ajuda', 'help', '?', 'comandos'].includes(first)) return { type: 'help' };
  if (!(e.user.isMod || e.user.isBroadcaster)) return null;
  if (['iniciar', 'abrir', 'comecar', 'start'].includes(first)) return { type: 'start' };
  if (['parar', 'encerrar', 'cancelar', 'stop', 'fim'].includes(first)) return { type: 'stop' };
  return { type: 'help' };
}

export function duelHelpText(status: DuelStatus) {
  if (status === 'lobby') return '🤠 Duelo aberto! Os dois primeiros que digitarem !duelo se enfrentam.';
  if (status === 'idle' || status === 'finished' || status === 'stopped') return 'Mods: !duelo iniciar · !duelo parar. No duelo: !duelo para entrar, !bang no FOGO e !1 / !2 para torcer.';
  return '🔫 Duelo rolando! Duelistas: !bang quando aparecer FOGO. Torcida: !1 ou !2.';
}

export function duelOpenAnnouncement(cfg: DuelConfig) {
  return `🤠 DUELO ${cfg.bestOf === 3 ? '(melhor de 3)' : 'X1'}! Os dois primeiros que digitarem !duelo se enfrentam. No FOGO!, digite !bang (atirar antes trava a arma).`;
}

export function duelStartAnnouncement(a: string, b: string, cheer: boolean) {
  return `🔥 ${a} x ${b}! Duelistas: !bang só no FOGO.${cheer ? ' Torcida: !1 para ' + a + ', !2 para ' + b + '.' : ''}`;
}

export function duelResultAnnouncement(winner: string | null, loser: string | null, score: [number, number], bestOf: number) {
  if (!winner) return '🌵 Ninguém acertou ninguém... o duelo terminou empatado.';
  const placar = bestOf === 3 ? ` (${Math.max(...score)} x ${Math.min(...score)})` : '';
  return `🏆 ${winner} sacou mais rápido e venceu ${loser ?? 'o duelo'}${placar}! 🤠`;
}
