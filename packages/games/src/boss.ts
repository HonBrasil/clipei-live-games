import {
  parseCommand,
  type BossConfig,
  type BossHit,
  type BossPhase,
  type BossSnapshot,
  type BossStatus,
  type ChatEvent,
  type LeaderboardEntry,
  type Platform,
  type SupportKind,
} from '@clipei/shared';

/**
 * Boss coletivo — o chat inteiro ataca um boss com uma barra de vida única.
 *
 * Comandos:
 *   !atk  (!ataque, !attack, !bater)  → golpe normal, com cooldown por pessoa
 *   !ult  (!especial)                 → golpe especial, 1x por pessoa por luta
 *
 * Fases:
 *   1. 100%–51%  normal
 *   2. 50%–21%   FÚRIA: boss com armadura, dano −25%
 *   3. 20%–0%    DESESPERO: boss vulnerável, dano +50% (hora do hype)
 *
 * Bônus: assinantes têm mais chance de crítico.
 */

export const BOSS_COMMANDS = {
  attack: ['atk', 'ataque', 'attack', 'bater', 'hit'],
  ult: ['ult', 'especial', 'ulti'],
} as const;

export type BossEvent =
  | { type: 'started'; config: BossConfig }
  | { type: 'phase'; phase: BossPhase }
  | { type: 'victory'; finalBlow: string; top: LeaderboardEntry[]; durationMs: number; participants: number }
  | { type: 'escaped'; hpLeft: number; top: LeaderboardEntry[]; participants: number }
  | { type: 'stopped' };

export interface BossGameOptions {
  random?: () => number;
  now?: () => number;
}

interface PlayerState extends LeaderboardEntry {
  lastAttackAt: number;
  usedUlt: boolean;
}

const MAX_RECENT_HITS = 40;

export class BossGame {
  readonly config: BossConfig;
  private status: BossStatus = 'idle';
  private hp: number;
  private phase: BossPhase = 1;
  private startedAt: number | null = null;
  private endedAt: number | null = null;
  private players = new Map<string, PlayerState>();
  private totalHits = 0;
  private finalBlow: string | null = null;
  private recentHits: BossHit[] = [];
  private random: () => number;
  private now: () => number;
  /** true quando algo mudou desde o último snapshot. */
  dirty = true;

  constructor(config: BossConfig, opts: BossGameOptions = {}) {
    this.config = {
      ...config,
      maxHp: Math.max(1, Math.round(config.maxHp)),
      cooldownMs: Math.max(0, config.cooldownMs),
      durationSec: Math.max(0, config.durationSec),
    };
    this.hp = this.config.maxHp;
    this.random = opts.random ?? Math.random;
    this.now = opts.now ?? Date.now;
  }

  start(): BossEvent[] {
    this.status = 'running';
    this.startedAt = this.now();
    this.dirty = true;
    return [{ type: 'started', config: this.config }];
  }

  stop(): BossEvent[] {
    if (this.status !== 'running') return [];
    this.status = 'idle';
    this.endedAt = this.now();
    this.dirty = true;
    return [{ type: 'stopped' }];
  }

  get isRunning() {
    return this.status === 'running';
  }

  /** Processa uma mensagem de chat. Retorna eventos para o bot anunciar. */
  handle(event: ChatEvent): BossEvent[] {
    if (this.status !== 'running') return [];
    const cmd = parseCommand(event.text);
    if (!cmd) return [];

    const isAttack = (BOSS_COMMANDS.attack as readonly string[]).includes(cmd.name);
    const isUlt = (BOSS_COMMANDS.ult as readonly string[]).includes(cmd.name);
    if (!isAttack && !isUlt) return [];

    const now = this.now();
    const key = `${event.platform}:${event.user.id}`;
    const player = this.player(key, event.user.displayName, event.platform, event.user.color);

    if (isUlt) {
      if (player.usedUlt) return [];
      player.usedUlt = true;
    } else if (now - player.lastAttackAt < this.config.cooldownMs) {
      return []; // spam dentro do cooldown é ignorado em silêncio
    }
    player.lastAttackAt = now;

    // ── cálculo de dano ──
    let damage = isUlt ? 40 + Math.floor(this.random() * 21) : 8 + Math.floor(this.random() * 8);
    const critChance = event.user.isSub ? 0.25 : 0.1;
    const crit = isUlt || this.random() < critChance;
    if (crit && !isUlt) damage *= 2;
    if (this.phase === 2) damage = Math.round(damage * 0.75);
    if (this.phase === 3) damage = Math.round(damage * 1.5);

    return this.apply(key, player, damage, { crit, ult: isUlt });
  }

  /**
   * Golpe de apoio (bits, sub, presente, pontos, raid): dano fixo, sem armadura
   * nem cooldown — quem apoia a live sempre acerta.
   */
  special(input: {
    id: string;
    name: string;
    color?: string;
    platform: Platform;
    damage: number;
    kind: SupportKind;
    label: string;
    amount: number;
  }): BossEvent[] {
    if (this.status !== 'running' || input.damage <= 0) return [];
    const player = this.player(input.id, input.name, input.platform, input.color);
    return this.apply(input.id, player, Math.round(input.damage), {
      crit: true,
      ult: false,
      special: input.kind,
      label: input.label,
      amount: input.amount,
    });
  }

  private player(key: string, name: string, platform: Platform, color?: string) {
    let player = this.players.get(key);
    if (!player) {
      player = { name, color, platform, damage: 0, hits: 0, lastAttackAt: -Infinity, usedUlt: false };
      this.players.set(key, player);
    }
    player.name = name;
    player.color = color ?? player.color;
    return player;
  }

  private apply(
    key: string,
    player: PlayerState,
    rawDamage: number,
    extra: Pick<BossHit, 'crit' | 'ult' | 'special' | 'label' | 'amount'>,
  ): BossEvent[] {
    const now = this.now();
    const damage = Math.max(1, Math.min(rawDamage, this.hp));
    this.hp -= damage;
    this.totalHits += 1;
    player.damage += damage;
    player.hits += 1;

    this.recentHits.push({ id: key, name: player.name, color: player.color, platform: player.platform, damage, ...extra });
    if (this.recentHits.length > MAX_RECENT_HITS) {
      // nunca descarta um golpe de apoio da fila de animação
      const idx = this.recentHits.findIndex((h) => !h.special);
      this.recentHits.splice(idx >= 0 ? idx : 0, 1);
    }
    this.dirty = true;

    const events: BossEvent[] = [];
    const ratio = this.hp / this.config.maxHp;
    const nextPhase: BossPhase = ratio <= 0.2 ? 3 : ratio <= 0.5 ? 2 : 1;
    if (nextPhase > this.phase && this.hp > 0) {
      this.phase = nextPhase;
      events.push({ type: 'phase', phase: nextPhase });
    }

    if (this.hp <= 0) {
      this.hp = 0;
      this.status = 'victory';
      this.endedAt = now;
      this.finalBlow = player.name;
      events.push({
        type: 'victory',
        finalBlow: player.name,
        top: this.leaderboard(3),
        durationMs: now - (this.startedAt ?? now),
        participants: this.players.size,
      });
    }
    return events;
  }

  /** Chamado pelo loop do servidor; verifica tempo limite. */
  update(): BossEvent[] {
    if (this.status !== 'running' || !this.config.durationSec || this.startedAt === null) return [];
    const now = this.now();
    if (now >= this.startedAt + this.config.durationSec * 1000) {
      this.status = 'escaped';
      this.endedAt = now;
      this.dirty = true;
      return [{ type: 'escaped', hpLeft: this.hp, top: this.leaderboard(3), participants: this.players.size }];
    }
    return [];
  }

  leaderboard(limit = 5): LeaderboardEntry[] {
    return [...this.players.values()]
      .sort((a, b) => b.damage - a.damage)
      .slice(0, limit)
      .map(({ name, color, platform, damage, hits }) => ({ name, color, platform, damage, hits }));
  }

  /** Estado para o overlay. Esvazia a fila de golpes recentes. */
  snapshot(): BossSnapshot {
    const snap: BossSnapshot = {
      status: this.status,
      skin: this.config.skin,
      name: this.config.name,
      hp: this.hp,
      maxHp: this.config.maxHp,
      phase: this.phase,
      startedAt: this.startedAt,
      endsAt:
        this.startedAt !== null && this.config.durationSec
          ? this.startedAt + this.config.durationSec * 1000
          : null,
      participants: this.players.size,
      totalHits: this.totalHits,
      leaderboard: this.leaderboard(5),
      finalBlow: this.finalBlow,
      recentHits: this.recentHits,
      serverNow: this.now(),
    };
    this.recentHits = [];
    this.dirty = false;
    return snap;
  }
}

export function formatNumber(n: number) {
  return n.toLocaleString('pt-BR');
}
