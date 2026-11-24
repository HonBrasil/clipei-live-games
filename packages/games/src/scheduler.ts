import type { AutoSpawnSettings } from '@clipei/shared';

/**
 * Agendador do boss automático.
 *
 * - O relógio conta a partir de quando o recurso foi ligado ou do fim da última luta
 *   (luta manual também reinicia a contagem, para não emendar um boss no outro).
 * - 1 minuto antes avisa (se `warn` estiver ligado).
 * - Na hora, só invoca se a live estiver no ar e o chat tiver gente ativa;
 *   senão, adia e confere de novo em 2 minutos.
 */
export type SpawnSignal = { type: 'warn'; at: number } | { type: 'spawn' } | { type: 'postponed'; at: number };

export interface SpawnContext {
  running: boolean;
  activeChatters: number;
  live: boolean;
}

export const WARN_BEFORE_MS = 60_000;
export const RETRY_MS = 2 * 60_000;

export class AutoSpawner {
  nextAt: number | null = null;
  private warned = false;

  constructor(
    private settings: AutoSpawnSettings,
    private now: () => number = Date.now,
  ) {
    if (settings.enabled) this.schedule();
  }

  configure(settings: AutoSpawnSettings) {
    const changed =
      settings.enabled !== this.settings.enabled || settings.intervalMin !== this.settings.intervalMin;
    this.settings = settings;
    if (!settings.enabled) {
      this.nextAt = null;
      this.warned = false;
    } else if (changed || this.nextAt === null) {
      this.schedule();
    }
  }

  get skin() {
    return this.settings.skin;
  }

  /** Uma luta começou (manual ou automática): pausa a contagem. */
  fightStarted() {
    this.nextAt = null;
    this.warned = false;
  }

  /** A luta acabou: a contagem recomeça do zero. */
  fightEnded() {
    if (this.settings.enabled) this.schedule();
  }

  tick(ctx: SpawnContext): SpawnSignal | null {
    if (!this.settings.enabled || ctx.running) return null;
    if (this.nextAt === null) this.schedule();
    const now = this.now();
    const ready = ctx.live && ctx.activeChatters >= this.settings.minChatters;

    if (this.settings.warn && !this.warned && now >= this.nextAt! - WARN_BEFORE_MS && now < this.nextAt!) {
      if (!ready) return null; // sem chat ou fora do ar: não anuncia o que talvez não aconteça
      this.warned = true;
      return { type: 'warn', at: this.nextAt! };
    }
    if (now >= this.nextAt!) {
      if (!ready) {
        this.nextAt = now + RETRY_MS;
        this.warned = false;
        return { type: 'postponed', at: this.nextAt };
      }
      this.nextAt = null;
      this.warned = false;
      return { type: 'spawn' };
    }
    return null;
  }

  private schedule() {
    this.nextAt = this.now() + this.settings.intervalMin * 60_000;
    this.warned = false;
  }
}
