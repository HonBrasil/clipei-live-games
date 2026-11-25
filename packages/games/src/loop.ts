import { LOOP_GAME_INFO, parseCommand, type ChatEvent, type LoopBlock, type LoopConfig, type LoopGameId, type LoopSnapshot } from '@clipei/shared';

/** Primeiro jogo depois de ligar o loop: não faz o streamer esperar a pausa inteira. */
export const LOOP_FIRST_DELAY_MS = 15_000;

export interface LoopContext {
  cfg: LoopConfig;
  /** Algum minigame na tela agora (aberto pelo loop ou pelo streamer). */
  busy: boolean;
  entitled: boolean;
  live: boolean;
  /** Fontes do OBS conectadas. */
  overlays: number;
  /** Pessoas que falaram no chat nos últimos 10 min. */
  chatters: number;
}

export type LoopAction =
  | { type: 'scheduled'; game: LoopGameId; at: number; first: boolean }
  | { type: 'start'; game: LoopGameId }
  | { type: 'expired' };

/**
 * Rodízio de minigames para quando o streamer sai e deixa a live aberta.
 * Só decide QUAL jogo e QUANDO; quem abre o jogo é a sala.
 *  - espera o jogo da vez terminar, conta a pausa e agenda o próximo;
 *  - fica parado (sem agendar) se a live caiu, o OBS fechou ou o chat esvaziou;
 *  - desliga sozinho depois do tempo programado.
 */
export class GameLoop {
  next: LoopGameId | null = null;
  at: number | null = null;
  playing: LoopGameId | null = null;
  blocked: LoopBlock | null = null;
  rounds = 0;
  since: number | null = null;
  dirty = false;
  private cursor = 0;
  private last: LoopGameId | null = null;

  constructor(private rng: () => number = Math.random) {}

  tick(now: number, ctx: LoopContext): LoopAction | null {
    const { cfg } = ctx;
    if (!cfg.enabled) {
      if (this.since !== null) this.reset();
      return null;
    }
    if (this.since === null) {
      this.since = now;
      this.dirty = true;
    }
    if (cfg.maxHours > 0 && now - this.since >= cfg.maxHours * 3_600_000) {
      this.reset();
      return { type: 'expired' };
    }
    if (ctx.busy) {
      // jogo na tela: nada agendado; a pausa conta a partir do fim dele
      if (this.at !== null || this.blocked !== null) {
        this.at = null;
        this.next = null;
        this.blocked = null;
        this.dirty = true;
      }
      return null;
    }
    if (this.playing) {
      this.playing = null;
      this.dirty = true;
    }
    const block = this.blockOf(ctx);
    if (block) {
      if (block !== this.blocked || this.at !== null) {
        this.blocked = block;
        this.at = null;
        this.next = null;
        this.dirty = true;
      }
      return null;
    }
    if (this.blocked) {
      this.blocked = null;
      this.dirty = true;
    }
    if (this.at === null) {
      const first = this.rounds === 0;
      this.next = this.pick(cfg);
      this.at = now + (first ? Math.min(LOOP_FIRST_DELAY_MS, cfg.gapSec * 1000) : cfg.gapSec * 1000);
      this.dirty = true;
      return { type: 'scheduled', game: this.next, at: this.at, first };
    }
    if (now >= this.at && this.next) {
      const game = this.next;
      this.next = null;
      this.at = null;
      this.playing = game;
      this.last = game;
      this.rounds++;
      this.dirty = true;
      return { type: 'start', game };
    }
    return null;
  }

  /** O jogo não abriu (ex.: outro começou no mesmo instante): tenta de novo daqui a pouco. */
  failed(now: number, game: LoopGameId) {
    this.rounds = Math.max(0, this.rounds - 1);
    this.playing = null;
    this.next = game;
    this.at = now + 10_000;
    this.dirty = true;
  }

  /** "Pular a espera": abre o próximo jogo no próximo tick. */
  skip(now: number, cfg: LoopConfig) {
    if (!cfg.enabled || this.playing) return false;
    if (!this.next) this.next = this.pick(cfg);
    this.at = now;
    this.blocked = null;
    this.dirty = true;
    return true;
  }

  snapshot(now: number, cfg: LoopConfig): LoopSnapshot {
    this.dirty = false;
    return {
      enabled: cfg.enabled,
      next: this.next,
      at: this.at,
      playing: this.playing,
      blocked: this.blocked,
      rounds: this.rounds,
      since: this.since,
      endsAt: cfg.enabled && this.since !== null && cfg.maxHours > 0 ? this.since + cfg.maxHours * 3_600_000 : null,
      teaser: cfg.teaser,
      serverNow: now,
    };
  }

  private blockOf(ctx: LoopContext): LoopBlock | null {
    if (!ctx.entitled) return 'plan';
    if (!ctx.cfg.games.length) return 'empty';
    if (ctx.cfg.onlyLive && !ctx.live) return 'offline';
    if (ctx.overlays < 1) return 'obs';
    if (ctx.chatters < ctx.cfg.minChatters) return 'chat';
    return null;
  }

  private pick(cfg: LoopConfig): LoopGameId {
    const list = cfg.games;
    if (cfg.order === 'random') {
      const pool = list.length > 1 ? list.filter((g) => g !== this.last) : list;
      return pool[Math.floor(this.rng() * pool.length)] ?? list[0]!;
    }
    // sequência: continua depois do último jogo (mesmo se a lista mudou no meio)
    const after = this.last ? list.indexOf(this.last) : -1;
    const i = after >= 0 ? (after + 1) % list.length : this.cursor % list.length;
    this.cursor = i + 1;
    return list[i]!;
  }

  private reset() {
    this.since = null;
    this.next = null;
    this.at = null;
    this.playing = null;
    this.blocked = null;
    this.rounds = 0;
    this.dirty = true;
  }
}

export type LoopChatCommand = { type: 'on' } | { type: 'off' } | { type: 'skip' };

/** !loop ligar | desligar | pular (só mods e o streamer). */
export function parseLoopChatCommand(e: ChatEvent): LoopChatCommand | null {
  const cmd = parseCommand(e.text);
  if (!cmd || cmd.name !== 'loop' || !(e.user.isMod || e.user.isBroadcaster)) return null;
  const a = (cmd.args[0] ?? '').toLowerCase();
  if (['ligar', 'on', 'iniciar'].includes(a)) return { type: 'on' };
  if (['desligar', 'off', 'parar'].includes(a)) return { type: 'off' };
  if (['pular', 'proximo', 'próximo', 'agora'].includes(a)) return { type: 'skip' };
  return null;
}

const secs = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 90 ? `${Math.round(s / 60)} min` : `${s}s`;
};

export function loopNextAnnouncement(game: LoopGameId, inMs: number) {
  const g = LOOP_GAME_INFO[game];
  return `🔁 Próximo minigame em ${secs(inMs)}: ${g.emoji} ${g.name}! Fiquem ligados para entrar com ${g.join}.`;
}
