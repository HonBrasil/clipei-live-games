import type { WebSocket } from 'ws';
import {
  AutoSpawner,
  BossGame,
  ChatActivity,
  autoBossHp,
  bossAnnouncement,
  bossHelpText,
  incomingAnnouncement,
  parseBossChatCommand,
  parseRaceChatCommand,
  RaceGame,
  DuelGame,
  parseDuelChatCommand,
  RoyaleGame,
  KiteGame,
  DefenseGame,
  parseDefenseChatCommand,
  defenseHelpText,
  defenseOpenAnnouncement,
  defenseStartAnnouncement,
  defenseVoteAnnouncement,
  defenseUpgradeAnnouncement,
  defenseResultAnnouncement,
  parseKiteChatCommand,
  PenaltyGame,
  parsePenaltyChatCommand,
  FishingGame,
  parseFishingChatCommand,
  fishingCatchAnnouncement,
  GameLoop,
  loopNextAnnouncement,
  parseLoopChatCommand,
  penaltyHelpText,
  penaltyOpenAnnouncement,
  penaltyStartAnnouncement,
  penaltyResultAnnouncement,
  kiteHelpText,
  kiteOpenAnnouncement,
  kiteStartAnnouncement,
  kiteResultAnnouncement,
  parseRoyaleChatCommand,
  royaleHelpText,
  royaleOpenAnnouncement,
  royaleStartAnnouncement,
  royaleResultAnnouncement,
  duelHelpText,
  duelOpenAnnouncement,
  duelStartAnnouncement,
  duelResultAnnouncement,
  raceHelpText,
  raceOpenAnnouncement,
  raceResultAnnouncement,
  raceStartAnnouncement,
  supportAnnouncement,
  supportDamage,
  supportLabel,
  supportName,
  supportThanks,
  type BossEvent,
} from '@clipei/games';
import {
  BOSS_SKINS,
  BOSS_SKIN_IDS,
  DEFAULT_SETTINGS,
  RACE_TRACKS,
  mergeSettings,
  type BossConfig,
  type BossSkinId,
  type BossSnapshot,
  type ChatEvent,
  type ClipRecord,
  type FightRecord,
  type RoomSettings,
  type LoopGameId,
  type SupportEvent,
  type RoomStatus,
  type ServerMessage,
  type RaceConfig,
  type RaceSnapshot,
  type RaceStatus,
  type DuelConfig,
  type DuelSnapshot,
  type DuelStatus,
  type RoyaleConfig,
  type KiteConfig,
  type DefenseConfig,
  type DefenseSnapshot,
  type DefenseStatus,
  type PenaltyConfig,
  type PenaltySnapshot,
  type PenaltyStatus,
  type KiteSnapshot,
  type KiteStatus,
  type RoyaleSnapshot,
  type RoyaleStatus,
  ROYALE_REGION_IDS,
} from '@clipei/shared';
import { ChatSimulator } from './simulator.ts';

export type ChatSender = (text: string) => Promise<void>;

/** Integrações da plataforma (Twitch) que a sala aciona; salas demo não têm. */
export interface RoomHooks {
  /** Confirma (true) ou reembolsa (false) um resgate de pontos. */
  redemption?: (e: SupportEvent, fulfilled: boolean) => void;
  fightStarted?: () => void;
  fightEnded?: () => void;
  /** Cria o clip da vitória e devolve o link. */
  createClip?: () => Promise<{ id: string; url: string }>;
  clipSaved?: (clips: ClipRecord[]) => void;
  historySaved?: (history: FightRecord[]) => void;
}
export type HpMode = 'auto' | 'fixed';

const DEFAULT_CONFIG: BossConfig = { skin: 'glitchador', name: 'Glitchador', maxHp: 10_000, durationSec: 180, cooldownMs: 2000 };
const BOT_MIN_INTERVAL_MS = 1500;
const HELP_COOLDOWN_MS = 30_000;
const STATUS_EVERY_MS = 3000;
/** Posições da corrida vão ao overlay 5x por segundo (ele interpola no meio). */
const RACE_BROADCAST_MS = 200;

/**
 * Uma sala = um canal de streamer. Guarda o jogo ativo, os overlays
 * conectados (OBS, prévia do painel), o simulador, a atividade do chat,
 * as configurações e o agendador do boss automático.
 */
export class Room {
  game: BossGame | null = null;
  race: RaceGame | null = null;
  duel: DuelGame | null = null;
  royale: RoyaleGame | null = null;
  kite: KiteGame | null = null;
  defense: DefenseGame | null = null;
  penalty: PenaltyGame | null = null;
  /** Pescaria: roda junto, a live inteira (pausa quando outro jogo começa). O servidor troca pela versão com progresso salvo. */
  fishing = new FishingGame(null);
  fishingBound = false;
  /** Modo Loop: rodízio automático de minigames. */
  readonly loop = new GameLoop();
  lastConfig: BossConfig = { ...DEFAULT_CONFIG };
  hpMode: HpMode = 'auto';
  readonly sockets = new Set<WebSocket>();
  readonly simulator: ChatSimulator;
  readonly activity = new ChatActivity();
  sendChat: ChatSender | null = null;
  /** A live está no ar? (Twitch consulta a API; demo considera sempre no ar). */
  isLive: () => boolean = () => true;
  /** Teste ou assinatura em dia? Sem isso, nada de boss novo (a luta em curso termina normal). */
  entitled: () => boolean = () => true;
  onSettingsChange: ((s: RoomSettings) => void) | null = null;
  hooks: RoomHooks = {};
  clips: ClipRecord[] = [];
  history: FightRecord[] = [];
  private panels = new WeakSet<WebSocket>();

  private settings: RoomSettings;
  private spawner: AutoSpawner;
  private botQueue: string[] = [];
  private botBusy = false;
  private lastSnapshot: BossSnapshot | null = null;
  private lastHelpAt = 0;
  private lastSpawnCheck = 0;
  private lastStatusAt = 0;
  private lastRaceAt = 0;
  private raceStatus: RaceStatus = 'idle';
  private duelStatus: DuelStatus = 'idle';
  private royaleStatus: RoyaleStatus = 'idle';
  private lastRoyaleAt = 0;
  private kiteStatus: KiteStatus = 'idle';
  private defenseStatus: DefenseStatus = 'idle';
  private lastDefenseAt = 0;
  private defenseDangerSaid = false;
  private penaltyStatus: PenaltyStatus = 'idle';
  private lastFishingAt = 0;
  private fishingPaused = false;
  private lastRankingAt = 0;
  private fishSummaryAt = new Map<string, number>();
  private lastPenaltyAt = 0;
  private lastKiteAt = 0;

  constructor(
    public key: string,
    public channelId: string,
    public name: string,
    public demo: boolean,
    settings: RoomSettings = DEFAULT_SETTINGS,
  ) {
    this.settings = mergeSettings(DEFAULT_SETTINGS, settings);
    this.spawner = new AutoSpawner(this.settings.autoSpawn);
    this.simulator = new ChatSimulator(channelId, (e) => this.handleChat(e));
    this.simulator.script = () => {
      const pg = this.penalty;
      if (pg?.isActive) {
        const x = Math.random();
        if (pg.status === 'lobby') return x < 0.35 ? '!a' : x < 0.7 ? '!b' : 'chatter';
        return x < 0.2 ? '!esq' : x < 0.35 ? '!meio' : x < 0.55 ? '!dir' : 'chatter';
      }
      const dg = this.defense;
      if (dg?.isActive) {
        const x = Math.random();
        if (dg.status === 'vote') return x < 0.2 ? '!fogo' : x < 0.35 ? '!gelo' : x < 0.5 ? '!muralha' : 'chatter';
        if (dg.status === 'lobby') return x < 0.25 ? '!arqueiro' : x < 0.45 ? '!mago' : x < 0.65 ? '!canhao' : 'chatter';
        return x < 0.15 ? '!atk' : x < 0.2 ? '!arqueiro' : 'chatter';
      }
      const kg = this.kite;
      if (kg?.isActive) {
        const x = Math.random();
        const models = ['', '', 'raia', 'capucheta', 'arraia', 'peixinho'];
        if (kg.status === 'lobby') return x < 0.7 ? `!pipa ${models[Math.floor(Math.random() * models.length)]}`.trim() : 'chatter';
        return x < 0.12 ? '!puxar' : x < 0.22 ? '!dibicar' : x < 0.34 ? '!descarregar' : x < 0.5 ? '!aparar' : 'chatter';
      }
      const br = this.royale;
      if (br?.isActive) {
        const x = Math.random();
        const place = ROYALE_REGION_IDS[Math.floor(Math.random() * ROYALE_REGION_IDS.length)];
        if (br.status === 'lobby') return x < 0.5 ? `!cair ${place}` : x < 0.8 ? '!entrar' : 'chatter';
        if (br.status === 'play') return x < 0.35 ? `!caixa ${place}` : x < 0.5 ? '!curar' : 'chatter';
        return 'chatter';
      }
      const d = this.duel;
      if (d?.isActive) {
        const x = Math.random();
        if (d.status === 'lobby') return x < 0.15 ? '!duelo' : 'chatter';
        if (d.status === 'fire') return x < 0.45 ? '!bang' : x < 0.75 ? (x < 0.6 ? '!1' : '!2') : 'chatter';
        return x < 0.03 ? '!bang' : x < 0.5 ? (x < 0.3 ? '!1' : '!2') : 'chatter';
      }
      const r = this.race;
      if (!r?.isActive) {
        if (this.settings.fishing.enabled && !this.activeGame()) {
          const x = Math.random();
          return x < 0.3 ? '!pescar' : x < 0.32 ? '!peixes' : 'chatter';
        }
        return undefined;
      }
      if (r.status === 'lobby') return Math.random() < 0.6 ? '!correr' : 'chatter';
      return r.turboOpen && Math.random() < 0.5 ? '!turbo' : 'chatter';
    };
  }

  /** Só um minigame por vez na tela. */
  activeGame(): 'boss' | 'race' | 'duel' | 'royale' | 'kite' | 'penalty' | 'defense' | null {
    if (this.game?.isRunning) return 'boss';
    if (this.race?.isActive) return 'race';
    if (this.duel?.isActive) return 'duel';
    if (this.royale?.isActive) return 'royale';
    if (this.kite?.isActive) return 'kite';
    if (this.penalty?.isActive) return 'penalty';
    if (this.defense?.isActive) return 'defense';
    return null;
  }

  private busyText(busy: NonNullable<ReturnType<Room['activeGame']>>) {
    const what = { boss: 'um boss na arena', race: 'uma corrida rolando', duel: 'um duelo rolando', royale: 'um Battle Royale rolando', kite: 'um Pipa Combate no céu', penalty: 'uma disputa de pênaltis rolando', defense: 'uma Defesa da Base rolando' }[busy];
    return `Tem ${what}. Um jogo por vez: espere terminar.`;
  }

  // ─── Modo Loop ─────────────────────────────────────────────

  private tickLoop(now: number) {
    const cfg = this.settings.loop;
    const action = this.loop.tick(now, {
      cfg,
      busy: this.activeGame() !== null,
      entitled: this.entitled(),
      live: this.isLive(),
      overlays: this.overlayCount,
      chatters: this.activity.count(),
    });
    if (action?.type === 'expired') {
      this.updateSettings({ loop: { enabled: false } });
      this.say('🔁 Modo Loop desligado: acabou o tempo programado pelo streamer.');
    } else if (action?.type === 'scheduled') {
      if (cfg.announce) this.say(loopNextAnnouncement(action.game, action.at - now));
    } else if (action?.type === 'start') {
      if (!this.loopStart(action.game)) this.loop.failed(now, action.game);
    }
    if (this.loop.dirty) this.broadcastLoop();
  }

  private loopStart(game: LoopGameId): boolean {
    if (this.activeGame()) return false;
    switch (game) {
      case 'boss':
        this.startQuick('random');
        return true;
      case 'race':
        return this.startRace().ok;
      case 'duel':
        return this.startDuel().ok;
      case 'royale':
        return this.startRoyale().ok;
      case 'kite':
        return this.startKite().ok;
      case 'penalty':
        return this.startPenalty().ok;
      case 'defense':
        return this.startDefense().ok;
    }
  }

  /** Abre o próximo jogo do rodízio sem esperar a pausa. */
  loopSkip() {
    if (this.activeGame()) return false;
    const ok = this.loop.skip(Date.now(), this.settings.loop);
    if (ok) this.tickLoop(Date.now());
    return ok;
  }

  loopSnapshot() {
    return this.loop.snapshot(Date.now(), this.settings.loop);
  }

  private broadcastLoop() {
    this.broadcast({ type: 'loop', state: this.loopSnapshot() });
  }

  // ─── Pescaria da Live ──────────────────────────────────────

  /** Comandos da pescaria (mods e chat). true = a mensagem era da pescaria. */
  private handleFishingChat(event: ChatEvent) {
    const mod = parseFishingChatCommand(event);
    if (mod) {
      if (mod.type === 'shoal') {
        if (this.settings.fishing.enabled && !this.activeGame()) this.fishingShoal();
      } else this.updateSettings({ fishing: { enabled: mod.type === 'on' } });
      return true;
    }
    if (!this.settings.fishing.enabled || this.activeGame() || !this.entitled()) return false;
    this.fishing.config = this.settings.fishing;
    const action = this.fishing.handle(event);
    if (action.type === 'none') return false;
    if (action.type === 'say') {
      const key = `${event.platform}:${event.user.id}`;
      const now = Date.now();
      const isRanking = /^!(ranking|top)\b/i.test(event.text.trim());
      if (isRanking ? now - this.lastRankingAt > 30_000 : now - (this.fishSummaryAt.get(key) ?? 0) > 60_000) {
        if (isRanking) this.lastRankingAt = now;
        else this.fishSummaryAt.set(key, now);
        this.say(action.text);
      }
    }
    if (action.type === 'cast') this.broadcastFishing();
    return true;
  }

  /** Cardume (botão do painel, !cardume dos mods ou raid). */
  fishingShoal(seconds = this.settings.gameSupport.fishing.raid.p.seconds ?? 120) {
    if (!this.settings.fishing.enabled) return false;
    this.fishing.shoal(Date.now(), seconds);
    this.say(`🐟 CARDUME NO LAGO! Por ${Math.round(seconds / 60)} min: sorte e pontos em dobro e espera pela metade. Digite !pescar!`, 'success');
    this.broadcastFishing();
    return true;
  }

  fishingStats() {
    return this.fishing.stats();
  }

  private tickFishing(now: number) {
    const f = this.fishing;
    f.config = this.settings.fishing;
    f.support = this.settings.gameSupport.fishing;
    const enabled = this.settings.fishing.enabled;
    const paused = !!this.activeGame();
    if (paused !== this.fishingPaused) {
      this.fishingPaused = paused;
      if (paused) f.reelIn();
      f.dirty = true;
    }
    if (!enabled) {
      if (f.dirty) {
        f.reelIn();
        this.broadcastFishing();
      }
      return;
    }
    if (!paused) {
      for (const c of f.update(now)) {
        const order = ['raro', 'epico', 'lendario'];
        const min = this.settings.fishing.announce;
        if (min !== 'nunca' && order.indexOf(c.rarity) >= order.indexOf(min)) this.say(fishingCatchAnnouncement(c), c.rarity === 'lendario' ? 'success' : 'info');
      }
    }
    if (f.dirty && now - this.lastFishingAt >= 250) this.broadcastFishing();
  }

  private broadcastFishing() {
    this.lastFishingAt = Date.now();
    this.broadcast({ type: 'fishing', state: this.fishing.snapshot(Date.now(), this.fishingPaused) });
  }

  // ─── Defesa da Base ────────────────────────────────────────

  startDefense(patch?: Partial<DefenseConfig>) {
    const busy = this.activeGame();
    if (busy) return { ok: false as const, error: this.busyText(busy) };
    if (patch) this.updateSettings({ defense: patch });
    this.defense = new DefenseGame(this.settings.defense);
    this.defense.support = this.settings.gameSupport.defense;
    this.defense.open();
    this.defenseStatus = 'lobby';
    this.spawner.fightStarted();
    this.hooks.fightStarted?.();
    this.broadcast({ type: 'incoming', at: null, serverNow: Date.now() });
    this.say(defenseOpenAnnouncement(this.defense.config));
    this.broadcastDefense();
    this.broadcastStatus();
    return { ok: true as const, config: this.defense.config };
  }

  defenseGo() {
    if (this.defense?.status !== 'lobby') return false;
    this.defense.startNow();
    this.afterDefenseUpdate();
    return true;
  }

  stopDefense() {
    if (!this.defense?.isActive) return false;
    this.defense.stop();
    this.afterDefenseUpdate();
    return true;
  }

  defenseSnapshot(): DefenseSnapshot | null {
    return this.defense && this.defense.status !== 'idle' ? this.defense.snapshot(Date.now(), true) : null;
  }

  private broadcastDefense() {
    if (!this.defense) return;
    this.lastDefenseAt = Date.now();
    this.broadcast({ type: 'defense', state: this.defense.snapshot() });
  }

  private afterDefenseUpdate() {
    const g = this.defense;
    if (!g) return;
    if (g.status === 'wave' && g.danger && !this.defenseDangerSaid) {
      this.defenseDangerSaid = true;
      this.say(`⚠️ A base está com ${Math.round((g.baseHp / g.baseMax) * 100)}% de vida! Tiro forte com !atk, AGORA!`, 'warning');
    }
    const prev = this.defenseStatus;
    const next = g.status;
    if (prev === next) return;
    this.defenseStatus = next;
    if (next === 'wave') this.defenseDangerSaid = false;
    if (prev === 'lobby' && next === 'wave') this.say(defenseStartAnnouncement(g.size, g.config.waves));
    if (prev === 'wave' && next === 'vote') this.say(defenseVoteAnnouncement(g.wave, g.config.waves, g.baseHp, g.baseMax));
    if (prev === 'vote' && next === 'wave' && g.lastUpgrade) this.say(defenseUpgradeAnnouncement(g.lastUpgrade, g.wave));
    if (next === 'finished' || next === 'stopped') {
      if (next === 'finished' && g.result) {
        this.say(defenseResultAnnouncement(g.result, g.wave, g.config.waves, g.kills, g.mvp(1)[0] ?? null), g.result === 'won' ? 'success' : 'warning');
        if (g.result === 'won') this.clipVictory(`Defesa da Base · ${g.config.waves} ondas`);
      } else if (prev === 'lobby' && g.humans === 0) {
        this.say('🏰 Ninguém virou torre dessa vez. Fica para a próxima!', 'warning');
      } else {
        this.say('🏰 Defesa da Base encerrada pelo streamer.', 'warning');
      }
      this.spawner.fightEnded();
      this.hooks.fightEnded?.();
    }
    this.broadcastDefense();
    this.broadcastStatus();
  }

  // ─── Disputa de Pênaltis ───────────────────────────────────

  startPenalty(patch?: Partial<PenaltyConfig>) {
    const busy = this.activeGame();
    if (busy) return { ok: false as const, error: this.busyText(busy) };
    if (patch) this.updateSettings({ penalty: patch });
    this.penalty = new PenaltyGame(this.settings.penalty);
    this.penalty.open();
    this.penaltyStatus = 'lobby';
    this.spawner.fightStarted();
    this.hooks.fightStarted?.();
    this.broadcast({ type: 'incoming', at: null, serverNow: Date.now() });
    this.say(penaltyOpenAnnouncement(this.penalty.config));
    this.broadcastPenalty();
    this.broadcastStatus();
    return { ok: true as const, config: this.penalty.config };
  }

  penaltyGo() {
    if (this.penalty?.status !== 'lobby') return false;
    this.penalty.startNow();
    this.afterPenaltyUpdate();
    return true;
  }

  stopPenalty() {
    if (!this.penalty?.isActive) return false;
    this.penalty.stop();
    this.afterPenaltyUpdate();
    return true;
  }

  penaltySnapshot(): PenaltySnapshot | null {
    return this.penalty && this.penalty.status !== 'idle' ? this.penalty.snapshot(Date.now(), true) : null;
  }

  private broadcastPenalty() {
    if (!this.penalty) return;
    this.lastPenaltyAt = Date.now();
    this.broadcast({ type: 'penalty', state: this.penalty.snapshot() });
  }

  private afterPenaltyUpdate() {
    const g = this.penalty;
    if (!g) return;
    const prev = this.penaltyStatus;
    const next = g.status;
    if (prev === next) return;
    this.penaltyStatus = next;
    if (prev === 'lobby' && next === 'vote') this.say(penaltyStartAnnouncement(g.config));
    if (next === 'finished' || next === 'stopped') {
      if (next === 'finished') {
        this.say(penaltyResultAnnouncement(g.teamName(g.winner), g.scoreline, g.config, g.mvp), 'success');
        if (g.winner !== null) this.clipVictory(`Pênaltis · ${g.teamName(g.winner)}`);
      } else if (prev === 'lobby') {
        this.say('⚽ Ninguém escolheu time dessa vez. Fica para a próxima!', 'warning');
      } else {
        this.say('⚽ Disputa de pênaltis encerrada pelo streamer.', 'warning');
      }
      this.spawner.fightEnded();
      this.hooks.fightEnded?.();
    }
    this.broadcastPenalty();
    this.broadcastStatus();
  }

  // ─── Pipa Combate ──────────────────────────────────────────

  startKite(patch?: Partial<KiteConfig>) {
    const busy = this.activeGame();
    if (busy) return { ok: false as const, error: this.busyText(busy) };
    if (patch) this.updateSettings({ kite: patch });
    this.kite = new KiteGame(this.settings.kite);
    this.kite.open();
    this.kiteStatus = 'lobby';
    this.spawner.fightStarted();
    this.hooks.fightStarted?.();
    this.broadcast({ type: 'incoming', at: null, serverNow: Date.now() });
    this.say(kiteOpenAnnouncement(this.kite.config));
    this.broadcastKite();
    this.broadcastStatus();
    return { ok: true as const, config: this.kite.config };
  }

  kiteGo() {
    if (this.kite?.status !== 'lobby') return false;
    this.kite.startNow();
    this.afterKiteUpdate();
    return true;
  }

  stopKite() {
    if (!this.kite?.isActive) return false;
    this.kite.stop();
    this.afterKiteUpdate();
    return true;
  }

  kiteSnapshot(): KiteSnapshot | null {
    return this.kite && this.kite.status !== 'idle' ? this.kite.snapshot(Date.now(), true) : null;
  }

  private broadcastKite() {
    if (!this.kite) return;
    this.lastKiteAt = Date.now();
    this.broadcast({ type: 'kite', state: this.kite.snapshot() });
  }

  private afterKiteUpdate() {
    const g = this.kite;
    if (!g) return;
    const prev = this.kiteStatus;
    const next = g.status;
    if (prev === next) return;
    this.kiteStatus = next;
    if (prev === 'lobby' && next === 'play') this.say(kiteStartAnnouncement(g.size, g.config.durationSec));
    if (next === 'finished' || next === 'stopped') {
      if (next === 'finished') {
        this.say(kiteResultAnnouncement(g.nameOf(g.winner), g.winner === null ? 0 : g.cutsOf(g.winner), g.winReason, g.topAparador()), 'success');
        if (g.winner !== null) this.clipVictory(`Pipa Combate · ${g.nameOf(g.winner)}`);
      } else if (prev === 'lobby' && g.humans === 0) {
        this.say('🪁 Ninguém soltou pipa dessa vez. Fica para a próxima!', 'warning');
      } else {
        this.say('🪁 Pipa Combate encerrado pelo streamer.', 'warning');
      }
      this.spawner.fightEnded();
      this.hooks.fightEnded?.();
    }
    this.broadcastKite();
    this.broadcastStatus();
  }

  // ─── Battle Royale ─────────────────────────────────────────

  startRoyale(patch?: Partial<RoyaleConfig>) {
    const busy = this.activeGame();
    if (busy) return { ok: false as const, error: this.busyText(busy) };
    if (patch) this.updateSettings({ royale: patch });
    this.royale = new RoyaleGame(this.settings.royale);
    this.royale.open();
    this.royaleStatus = 'lobby';
    this.spawner.fightStarted();
    this.hooks.fightStarted?.();
    this.broadcast({ type: 'incoming', at: null, serverNow: Date.now() });
    this.say(royaleOpenAnnouncement(this.royale.config));
    this.broadcastRoyale();
    this.broadcastStatus();
    return { ok: true as const, config: this.royale.config };
  }

  royaleGo() {
    if (this.royale?.status !== 'lobby') return false;
    this.royale.startNow();
    this.afterRoyaleUpdate();
    return true;
  }

  stopRoyale() {
    if (!this.royale?.isActive) return false;
    this.royale.stop();
    this.afterRoyaleUpdate();
    return true;
  }

  royaleSnapshot(): RoyaleSnapshot | null {
    return this.royale && this.royale.status !== 'idle' ? this.royale.snapshot(Date.now(), true) : null;
  }

  private broadcastRoyale() {
    if (!this.royale) return;
    this.lastRoyaleAt = Date.now();
    this.broadcast({ type: 'royale', state: this.royale.snapshot() });
  }

  private afterRoyaleUpdate() {
    const g = this.royale;
    if (!g) return;
    const prev = this.royaleStatus;
    const next = g.status;
    if (prev === next) return;
    this.royaleStatus = next;
    if (prev === 'lobby' && next === 'drop') this.say(royaleStartAnnouncement(g.size));
    if (next === 'finished' || next === 'stopped') {
      if (next === 'finished') {
        this.say(royaleResultAnnouncement(g.nameOf(g.winner), g.winner === null ? 0 : g.killsOf(g.winner), g.size), 'success');
        if (g.winner !== null) this.clipVictory(`Battle Royale · ${g.nameOf(g.winner)}`);
      } else if (prev === 'lobby' && g.humans === 0) {
        this.say('🪂 Ninguém embarcou dessa vez. Fica para a próxima!', 'warning');
      } else {
        this.say('🪂 Battle Royale encerrado pelo streamer.', 'warning');
      }
      this.spawner.fightEnded();
      this.hooks.fightEnded?.();
    }
    this.broadcastRoyale();
    this.broadcastStatus();
  }

  // ─── Duelo ─────────────────────────────────────────────────

  startDuel(patch?: Partial<DuelConfig>) {
    const busy = this.activeGame();
    if (busy) return { ok: false as const, error: this.busyText(busy) };
    if (patch) this.updateSettings({ duel: patch });
    this.duel = new DuelGame(this.settings.duel);
    this.duel.open();
    this.duelStatus = 'lobby';
    this.spawner.fightStarted();
    this.hooks.fightStarted?.();
    this.broadcast({ type: 'incoming', at: null, serverNow: Date.now() });
    this.say(duelOpenAnnouncement(this.duel.config));
    this.broadcastDuel();
    this.broadcastStatus();
    return { ok: true as const, config: this.duel.config };
  }

  stopDuel() {
    if (!this.duel?.isActive) return false;
    this.duel.stop();
    this.afterDuelUpdate();
    return true;
  }

  duelSnapshot(): DuelSnapshot | null {
    return this.duel && this.duel.status !== 'idle' ? this.duel.snapshot(Date.now(), true) : null;
  }

  private broadcastDuel() {
    if (!this.duel) return;
    this.broadcast({ type: 'duel', state: this.duel.snapshot() });
  }

  private afterDuelUpdate() {
    const d = this.duel;
    if (!d) return;
    const prev = this.duelStatus;
    const next = d.status;
    if (prev !== next) {
      this.duelStatus = next;
      const [a, b] = d.duelists;
      if (prev === 'lobby' && next === 'intro') this.say(duelStartAnnouncement(a, b, d.config.cheer, d.config.cheerSec));
      if (next === 'finished' || next === 'stopped') {
        if (next === 'finished') {
          const w = d.winner;
          this.say(duelResultAnnouncement(w === null ? null : d.duelists[w], w === null ? null : d.duelists[1 - w], d.score, d.config.bestOf), 'success');
          if (w !== null) this.clipVictory(`Duelo · ${a} x ${b}`);
        } else if (prev === 'lobby') {
          this.say(a ? `🌵 Ninguém aceitou o desafio de ${a}. Fica para a próxima!` : '🌵 Ninguém apareceu para o duelo dessa vez.', 'warning');
        } else {
          this.say('🌵 Duelo encerrado pelo streamer.', 'warning');
        }
        this.spawner.fightEnded();
        this.hooks.fightEnded?.();
      }
      this.broadcastStatus();
    }
    this.broadcastDuel();
  }

  // ─── Corrida ───────────────────────────────────────────────

  /** Abre as inscrições com a configuração salva (ou a enviada). */
  startRace(patch?: Partial<RaceConfig>) {
    const busy = this.activeGame();
    if (busy && busy !== 'race') return { ok: false as const, error: this.busyText(busy) };
    if (patch) this.updateSettings({ race: patch });
    this.race?.stop();
    this.race = new RaceGame(this.settings.race);
    this.race.open();
    this.raceStatus = 'lobby';
    this.spawner.fightStarted();
    this.hooks.fightStarted?.();
    this.broadcast({ type: 'incoming', at: null, serverNow: Date.now() });
    this.say(raceOpenAnnouncement(this.race.config, RACE_TRACKS[this.race.config.track].name));
    this.broadcastRace();
    this.broadcastStatus();
    return { ok: true as const, config: this.race.config };
  }

  /** Fecha as inscrições e larga agora. */
  raceGo() {
    if (this.race?.status !== 'lobby') return false;
    this.race.startNow();
    this.afterRaceUpdate();
    return true;
  }

  stopRace() {
    if (!this.race?.isActive) return false;
    this.race.stop();
    this.afterRaceUpdate();
    return true;
  }

  raceSnapshot(): RaceSnapshot | null {
    return this.race && this.race.status !== 'idle' ? this.race.snapshot(Date.now(), true) : null;
  }

  private broadcastRace() {
    if (!this.race) return;
    this.lastRaceAt = Date.now();
    this.broadcast({ type: 'race', state: this.race.snapshot() });
  }

  /** Mudanças de fase: anúncios do bot, clip, fim de jogo. */
  private afterRaceUpdate() {
    const r = this.race;
    if (!r) return;
    const prev = this.raceStatus;
    const next = r.status;
    if (prev === next) return;
    this.raceStatus = next;
    if (prev === 'lobby' && next === 'running') this.say(raceStartAnnouncement(r.pilots));
    if (next === 'finished' || next === 'stopped') {
      if (next === 'finished') {
        this.say(raceResultAnnouncement(r.podium(), r.humans), 'success');
        this.clipVictory(`Corrida · ${RACE_TRACKS[r.config.track].name}`);
      } else if (prev === 'lobby' && r.humans === 0) {
        this.say('🏁 Ninguém entrou na corrida dessa vez. Bora de novo daqui a pouco? !correr', 'warning');
      } else {
        this.say('🏁 Corrida encerrada pelo streamer.', 'warning');
      }
      this.spawner.fightEnded();
      this.hooks.fightEnded?.();
    }
    this.broadcastRace();
    this.broadcastStatus();
  }

  // ─── Partida ───────────────────────────────────────────────

  /** Invoca um boss. Com hpMode 'auto', a vida vem do tamanho do chat ativo. */
  startBoss(config: BossConfig, hpMode: HpMode = this.hpMode) {
    this.game?.stop();
    this.hpMode = hpMode;
    const cfg = { ...config, maxHp: hpMode === 'auto' ? this.autoHp(config) : config.maxHp };
    this.lastConfig = cfg;
    this.game = new BossGame(cfg);
    this.spawner.fightStarted();
    this.hooks.fightStarted?.();
    this.broadcast({ type: 'incoming', at: null, serverNow: Date.now() });
    this.dispatch(this.game.start());
    this.broadcastSnapshot();
    this.broadcastStatus();
    return cfg;
  }

  /** Invoca reaproveitando a última configuração (chat de mods e boss automático). */
  startQuick(skin?: BossSkinId | 'random') {
    const chosen = skin === 'random' ? pickOther(this.lastConfig.skin) : (skin ?? this.lastConfig.skin);
    const keepName = !skin && this.lastConfig.name !== BOSS_SKINS[this.lastConfig.skin].name;
    return this.startBoss({
      ...this.lastConfig,
      skin: chosen,
      name: keepName ? this.lastConfig.name : BOSS_SKINS[chosen].name,
    });
  }

  stopBoss() {
    if (!this.game?.isRunning) return;
    this.dispatch(this.game.stop());
    this.broadcastSnapshot();
  }

  autoHp(config: Pick<BossConfig, 'cooldownMs' | 'durationSec'> = this.lastConfig) {
    return autoBossHp({ activeChatters: this.activity.count(), cooldownMs: config.cooldownMs, durationSec: config.durationSec });
  }

  handleChat(event: ChatEvent) {
    this.activity.record(`${event.platform}:${event.user.id}`);

    const loopCmd = parseLoopChatCommand(event);
    if (loopCmd) {
      if (loopCmd.type === 'skip') {
        if (!this.settings.loop.enabled) this.say('🔁 O Modo Loop está desligado. Use !loop ligar.');
        else if (!this.loopSkip()) this.say('🔁 Tem um jogo rolando: o próximo abre quando ele terminar.');
      } else {
        const on = loopCmd.type === 'on';
        if (on !== this.settings.loop.enabled) {
          this.updateSettings({ loop: { enabled: on } });
          this.say(on ? '🔁 Modo Loop ligado! Os minigames vão se revezar sozinhos.' : '🔁 Modo Loop desligado.');
        }
      }
      return;
    }

    const raceCmd = parseRaceChatCommand(event);
    if (raceCmd) {
      if (raceCmd.type === 'help') {
        if (Date.now() - this.lastHelpAt > HELP_COOLDOWN_MS) {
          this.lastHelpAt = Date.now();
          this.say(raceHelpText(this.race?.status ?? 'idle'));
        }
      } else if (raceCmd.type === 'start') {
        if (this.entitled() && !this.activeGame()) this.startRace();
      } else {
        this.stopRace();
      }
      return;
    }
    const duelCmd = parseDuelChatCommand(event);
    if (duelCmd) {
      if (duelCmd.type === 'help') {
        if (Date.now() - this.lastHelpAt > HELP_COOLDOWN_MS) {
          this.lastHelpAt = Date.now();
          this.say(duelHelpText(this.duel?.status ?? 'idle'));
        }
      } else if (duelCmd.type === 'start') {
        if (this.entitled() && !this.activeGame()) this.startDuel();
      } else {
        this.stopDuel();
      }
      return;
    }
    if (this.handleFishingChat(event)) return;
    const penCmd = parsePenaltyChatCommand(event);
    if (penCmd) {
      if (penCmd.type === 'help') {
        if (Date.now() - this.lastHelpAt > HELP_COOLDOWN_MS) {
          this.lastHelpAt = Date.now();
          this.say(penaltyHelpText(this.penalty?.status ?? 'idle', this.penalty?.config ?? this.settings.penalty));
        }
      } else if (penCmd.type === 'start') {
        if (this.entitled() && !this.activeGame()) this.startPenalty();
      } else {
        this.stopPenalty();
      }
      return;
    }
    if (this.penalty?.isActive) {
      this.penalty.handle(event);
      return;
    }
    const defCmd = parseDefenseChatCommand(event);
    if (defCmd) {
      if (defCmd.type === 'help') {
        if (Date.now() - this.lastHelpAt > HELP_COOLDOWN_MS) {
          this.lastHelpAt = Date.now();
          this.say(defenseHelpText(this.defense?.status ?? 'idle'));
        }
      } else if (defCmd.type === 'start') {
        if (this.entitled() && !this.activeGame()) this.startDefense();
      } else if (defCmd.type === 'go') {
        this.defenseGo();
      } else {
        this.stopDefense();
      }
      return;
    }
    if (this.defense?.isActive) {
      this.defense.handle(event);
      return;
    }
    const kiteCmd = parseKiteChatCommand(event);
    if (kiteCmd) {
      if (kiteCmd.type === 'help') {
        if (Date.now() - this.lastHelpAt > HELP_COOLDOWN_MS) {
          this.lastHelpAt = Date.now();
          this.say(kiteHelpText(this.kite?.status ?? 'idle'));
        }
      } else if (kiteCmd.type === 'start') {
        if (this.entitled() && !this.activeGame()) this.startKite();
      } else {
        this.stopKite();
      }
      return;
    }
    if (this.kite?.isActive) {
      this.kite.handle(event);
      return;
    }
    const brCmd = parseRoyaleChatCommand(event);
    if (brCmd) {
      if (brCmd.type === 'help') {
        if (Date.now() - this.lastHelpAt > HELP_COOLDOWN_MS) {
          this.lastHelpAt = Date.now();
          this.say(royaleHelpText(this.royale?.status ?? 'idle'));
        }
      } else if (brCmd.type === 'start') {
        if (this.entitled() && !this.activeGame()) this.startRoyale();
      } else {
        this.stopRoyale();
      }
      return;
    }
    if (this.royale?.isActive) {
      this.royale.handle(event);
      return;
    }
    if (this.race?.isActive) {
      this.race.handle(event);
      return;
    }
    if (this.duel?.isActive) {
      this.duel.handle(event);
      if (this.duel.dirty) this.afterDuelUpdate();
      return;
    }

    const cmd = parseBossChatCommand(event);
    if (cmd) {
      if (cmd.type === 'help') {
        if (Date.now() - this.lastHelpAt > HELP_COOLDOWN_MS) {
          this.lastHelpAt = Date.now();
          this.say(bossHelpText(!!this.game?.isRunning));
        }
      } else if (cmd.type === 'start') {
        if (this.entitled() && !this.race?.isActive && !this.duel?.isActive && !this.royale?.isActive && !this.kite?.isActive && !this.penalty?.isActive && !this.defense?.isActive) this.startQuick(cmd.skin);
      } else if (cmd.type === 'stop') {
        this.stopBoss();
      }
      return;
    }

    if (this.game) this.dispatch(this.game.handle(event));
  }

  /** Bits, subs, presentes, pontos de canal e raids viram golpes especiais. */
  handleSupport(e: SupportEvent) {
    if (this.penalty?.isActive) {
      this.penalty.support = this.settings.gameSupport.penalty;
      const res = this.penalty.special(e);
      if (!res.applied) {
        if (e.kind === 'points') this.hooks.redemption?.(e, false);
        const thanks = supportThanks(e);
        if (thanks && e.kind !== 'points') this.say(thanks);
        return { applied: false, damage: 0 };
      }
      const icon = e.kind === 'points' ? '🧢' : e.kind === 'bits' ? '🎯' : e.kind === 'raid' ? '📣' : '🧤';
      this.say(`${icon} ${supportName(e)} (${supportLabel(e).replace('golpe especial', 'pontos do canal')}): ${res.effect}!`, 'success');
      if (e.kind === 'points') this.hooks.redemption?.(e, true);
      this.broadcastPenalty();
      return { applied: true, damage: 0 };
    }
    if (this.defense?.isActive) {
      this.defense.support = this.settings.gameSupport.defense;
      const res = this.defense.special(e);
      if (!res.applied) {
        if (e.kind === 'points') this.hooks.redemption?.(e, false);
        const thanks = supportThanks(e);
        if (thanks && e.kind !== 'points') this.say(thanks);
        return { applied: false, damage: 0 };
      }
      const icon = e.kind === 'points' ? '🗼' : e.kind === 'bits' ? '☄️' : e.kind === 'raid' ? '⚔️' : '🦸';
      this.say(`${icon} ${supportName(e)} (${supportLabel(e).replace('golpe especial', 'pontos do canal')}): ${res.effect}!`, 'success');
      if (e.kind === 'points') this.hooks.redemption?.(e, true);
      this.broadcastDefense();
      return { applied: true, damage: 0 };
    }
    if (this.kite?.isActive) {
      this.kite.support = this.settings.gameSupport.kite;
      const res = this.kite.special(e);
      if (!res.applied) {
        if (e.kind === 'points') this.hooks.redemption?.(e, false);
        const thanks = supportThanks(e);
        if (thanks && e.kind !== 'points') this.say(thanks);
        return { applied: false, damage: 0 };
      }
      const icon = e.kind === 'points' ? '🎏' : e.kind === 'bits' ? '💎' : e.kind === 'raid' ? '🌪️' : '👑';
      this.say(`${icon} ${supportName(e)} (${supportLabel(e).replace('golpe especial', 'pontos do canal')}): ${res.effect}!`, 'success');
      if (e.kind === 'points') this.hooks.redemption?.(e, true);
      this.broadcastKite();
      return { applied: true, damage: 0 };
    }
    if (this.royale?.isActive) {
      this.royale.support = this.settings.gameSupport.royale;
      const res = this.royale.special(e);
      if (!res.applied) {
        if (e.kind === 'points') this.hooks.redemption?.(e, false);
        const thanks = supportThanks(e);
        if (thanks && e.kind !== 'points') this.say(thanks);
        return { applied: false, damage: 0 };
      }
      const icon = e.kind === 'points' ? '🩹' : e.kind === 'bits' ? '🦺' : e.kind === 'raid' ? '💣' : '📦';
      this.say(`${icon} ${supportName(e)} (${supportLabel(e).replace('golpe especial', 'pontos do canal')}): ${res.effect}!`, 'success');
      if (e.kind === 'points') this.hooks.redemption?.(e, true);
      this.broadcastRoyale();
      return { applied: true, damage: 0 };
    }
    if (this.duel?.isActive) {
      this.duel.support = this.settings.gameSupport.duel;
      const res = this.duel.special(e);
      if (!res.applied) {
        if (e.kind === 'points') this.hooks.redemption?.(e, false);
        const thanks = supportThanks(e);
        if (thanks && e.kind !== 'points') this.say(thanks);
        return { applied: false, damage: 0 };
      }
      const icon = e.kind === 'points' ? '🎯' : e.kind === 'bits' ? '🦺' : '✨';
      this.say(`${icon} ${supportName(e)} (${supportLabel(e).replace('golpe especial', 'pontos do canal')}): ${res.effect}!`, 'success');
      if (e.kind === 'points') this.hooks.redemption?.(e, true);
      this.afterDuelUpdate();
      return { applied: true, damage: 0 };
    }
    if (this.race?.isActive) {
      this.race.support = this.settings.gameSupport.race;
      const res = this.race.special(e);
      if (!res.applied) {
        if (e.kind === 'points') this.hooks.redemption?.(e, false);
        return { applied: false, damage: 0 };
      }
      const icon = e.kind === 'points' ? '🛡️' : e.kind === 'raid' ? '🌬️' : '🚀';
      this.say(`${icon} ${supportName(e)} (${supportLabel(e).replace('golpe especial', 'pontos do canal')}): ${res.effect}!`, 'success');
      if (e.kind === 'points') this.hooks.redemption?.(e, true);
      this.broadcastRace();
      return { applied: true, damage: 0 };
    }
    const damage = supportDamage(e, this.settings.support);
    const running = !!this.game?.isRunning;
    if (!running && this.settings.fishing.enabled && !this.activeGame()) {
      this.fishing.support = this.settings.gameSupport.fishing;
      const res = this.fishing.special(e);
      if (res.applied) {
        const icon = e.kind === 'points' ? '🎣' : e.kind === 'bits' ? '🪱' : e.kind === 'raid' ? '🐟' : '🏆';
        this.say(`${icon} ${supportName(e)} (${supportLabel(e).replace('golpe especial', 'pontos do canal')}): ${res.effect}!`, 'success');
        if (e.kind === 'points') this.hooks.redemption?.(e, true);
        this.broadcastFishing();
        return { applied: true, damage: 0 };
      }
    }
    if (damage === null || !running) {
      if (e.kind === 'points') this.hooks.redemption?.(e, false); // devolve os pontos
      const thanks = running ? null : supportThanks(e);
      if (thanks) this.say(thanks);
      return { applied: false, damage: 0 };
    }
    const events = this.game!.special({
      id: e.user ? `${e.platform}:${e.user.id}` : `${e.platform}:anon:${e.kind}`,
      name: supportName(e),
      color: e.user?.color,
      platform: e.platform,
      damage,
      kind: e.kind,
      label: supportLabel(e),
      amount: e.amount,
    });
    this.say(supportAnnouncement(e, damage, this.lastConfig.name), 'success');
    if (e.kind === 'points') this.hooks.redemption?.(e, true);
    this.dispatch(events);
    return { applied: true, damage };
  }

  /** Clip automático da vitória (opcional). */
  private clipVictory(title = this.lastConfig.name) {
    if (!this.settings.clip.enabled) return;
    const bossName = title;
    if (!this.hooks.createClip) {
      this.broadcast({ type: 'toast', text: '🎬 (simulação) O clip da vitória seria criado agora na Twitch.', tone: 'info' });
      return;
    }
    // espera a explosão acontecer: o clip da Twitch pega os segundos anteriores ao pedido
    setTimeout(async () => {
      try {
        const { id, url } = await this.hooks.createClip!();
        const clip: ClipRecord = { id, url, bossName, createdAt: Date.now() };
        this.clips = [clip, ...this.clips].slice(0, 20);
        this.hooks.clipSaved?.(this.clips);
        this.broadcast({ type: 'clip', clip });
        if (this.settings.clip.postInChat) this.say(bossName.startsWith('Corrida') ? `🎬 Clip da chegada: ${url}` : `🎬 Clip da vitória contra ${bossName}: ${url}`);
        else this.broadcast({ type: 'toast', text: `🎬 Clip criado: ${url}`, tone: 'success' });
      } catch (err) {
        console.warn(`[clip] ${this.name}:`, (err as Error).message);
        this.broadcast({ type: 'toast', text: '🎬 Não deu para criar o clip (a live precisa estar no ar).', tone: 'warning' });
      }
    }, 4000);
  }

  /** Chamado a cada 100 ms. */
  tick() {
    const now = Date.now();
    this.tickFishing(now);
    if (this.penalty?.isActive) {
      this.penalty.update(now);
      if (this.penalty.status !== this.penaltyStatus) this.afterPenaltyUpdate();
      else if (this.penalty.dirty && now - this.lastPenaltyAt >= RACE_BROADCAST_MS) this.broadcastPenalty();
    }
    if (this.defense?.isActive) {
      this.defense.update(now);
      if (this.defense.status !== this.defenseStatus || (this.defense.danger && !this.defenseDangerSaid)) this.afterDefenseUpdate();
      else if (now - this.lastDefenseAt >= RACE_BROADCAST_MS) this.broadcastDefense();
    }
    if (this.kite?.isActive) {
      this.kite.update(now);
      if (this.kite.status !== this.kiteStatus) this.afterKiteUpdate();
      else if (now - this.lastKiteAt >= RACE_BROADCAST_MS) this.broadcastKite();
    }
    if (this.royale?.isActive) {
      this.royale.update(now);
      if (this.royale.status !== this.royaleStatus) this.afterRoyaleUpdate();
      else if (now - this.lastRoyaleAt >= RACE_BROADCAST_MS) this.broadcastRoyale();
    }
    if (this.duel?.isActive) {
      this.duel.update(now);
      if (this.duel.dirty || this.duel.status !== this.duelStatus) this.afterDuelUpdate();
    }
    if (this.race?.isActive) {
      this.race.update(now);
      if (this.race.status !== this.raceStatus) this.afterRaceUpdate();
      else if (now - this.lastRaceAt >= RACE_BROADCAST_MS) this.broadcastRace();
    }
    if (this.game) {
      this.dispatch(this.game.update());
      if (this.game.dirty) this.broadcastSnapshot();
    }
    if (now - this.lastSpawnCheck >= 1000) {
      this.lastSpawnCheck = now;
      this.checkAutoSpawn();
      this.tickLoop(now);
    }
    if (now - this.lastStatusAt >= STATUS_EVERY_MS && this.sockets.size) this.broadcastStatus();
  }

  private checkAutoSpawn() {
    // com o Modo Loop ligado, o boss entra no rodízio em vez de vir sozinho
    if (!this.entitled() || this.settings.loop.enabled) return;
    const signal = this.spawner.tick({
      running: this.activeGame() !== null,
      activeChatters: this.activity.count(),
      live: this.isLive(),
    });
    if (!signal) return;
    const skin = this.spawner.skin;
    if (signal.type === 'warn') {
      this.say(incomingAnnouncement(skin === 'random' ? null : BOSS_SKINS[skin].name));
      this.broadcast({ type: 'incoming', at: signal.at, serverNow: Date.now() });
    } else if (signal.type === 'postponed') {
      this.broadcast({ type: 'incoming', at: null, serverNow: Date.now() });
    } else {
      this.startQuick(skin);
    }
    this.broadcastStatus();
  }

  // ─── Configurações ─────────────────────────────────────────

  getSettings() {
    return this.settings;
  }

  updateSettings(patch: unknown) {
    this.settings = mergeSettings(this.settings, patch);
    this.spawner.configure(this.settings.autoSpawn);
    if (patch && typeof patch === 'object' && 'loop' in patch) this.loop.dirty = true;
    if (patch && typeof patch === 'object' && 'fishing' in patch) {
      // posição, fundo e ranking mudam na hora no OBS
      this.fishing.config = this.settings.fishing;
      this.fishing.dirty = true;
    }
    this.broadcast({ type: 'settings', settings: this.settings });
    this.broadcastStatus();
    this.onSettingsChange?.(this.settings);
    return this.settings;
  }

  /** OBS (overlays) conectados agora. */
  get overlayCount() {
    return [...this.sockets].filter((ws) => !this.panels.has(ws) && ws.readyState === 1).length;
  }

  status(): RoomStatus {
    return {
      activeChatters: this.activity.count(),
      autoHp: this.autoHp(),
      nextAutoAt: this.settings.loop.enabled ? null : this.spawner.nextAt,
      live: this.isLive(),
      overlays: [...this.sockets].filter((ws) => !this.panels.has(ws) && ws.readyState === 1).length,
      game: this.activeGame(),
      serverNow: Date.now(),
    };
  }

  testSound() {
    this.broadcast({ type: 'sfx-test' });
  }

  // ─── Conexões ──────────────────────────────────────────────

  /** kind "panel" = painel do streamer (não conta como OBS conectado). */
  attach(ws: WebSocket, kind: 'overlay' | 'panel' = 'overlay') {
    this.sockets.add(ws);
    if (kind === 'panel') this.panels.add(ws);
    else setTimeout(() => this.broadcastStatus(), 50);
    this.send(ws, { type: 'hello', channel: { name: this.name, demo: this.demo } });
    this.send(ws, { type: 'settings', settings: this.settings });
    this.send(ws, { type: 'room', status: this.status() });
    const state = this.currentSnapshot();
    if (state) this.send(ws, { type: 'boss', state: { ...state, recentHits: [] } });
    const race = this.raceSnapshot();
    if (race) this.send(ws, { type: 'race', state: race });
    const duel = this.duelSnapshot();
    if (duel) this.send(ws, { type: 'duel', state: duel });
    const br = this.royaleSnapshot();
    if (br) this.send(ws, { type: 'royale', state: br });
    const kite = this.kiteSnapshot();
    if (kite) this.send(ws, { type: 'kite', state: kite });
    const def = this.defenseSnapshot();
    if (def) this.send(ws, { type: 'defense', state: def });
    const pen = this.penaltySnapshot();
    if (pen) this.send(ws, { type: 'penalty', state: pen });
    if (this.settings.fishing.enabled) this.send(ws, { type: 'fishing', state: this.fishing.snapshot(Date.now(), this.fishingPaused) });
    this.send(ws, { type: 'loop', state: this.loopSnapshot() });
    ws.on('close', () => {
      this.sockets.delete(ws);
      if (!this.panels.has(ws)) this.broadcastStatus();
    });
  }

  currentSnapshot(): BossSnapshot | null {
    if (!this.game) return null;
    if (this.game.dirty) this.broadcastSnapshot();
    return this.lastSnapshot;
  }

  broadcast(msg: ServerMessage) {
    const raw = JSON.stringify(msg);
    for (const ws of this.sockets) if (ws.readyState === 1) ws.send(raw);
  }

  private broadcastStatus() {
    this.lastStatusAt = Date.now();
    this.broadcast({ type: 'room', status: this.status() });
  }

  private broadcastSnapshot() {
    if (!this.game) return;
    const state = this.game.snapshot();
    this.lastSnapshot = state;
    this.broadcast({ type: 'boss', state });
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  private dispatch(events: BossEvent[]) {
    for (const event of events) {
      if (event.type === 'victory' || event.type === 'escaped' || event.type === 'stopped') {
        this.spawner.fightEnded();
        this.hooks.fightEnded?.();
        this.broadcastStatus();
      }
      if (event.type === 'victory') this.clipVictory();
      if (event.type === 'victory' || event.type === 'escaped' || event.type === 'stopped') this.recordFight(event.type);
      const text = bossAnnouncement(event, this.lastConfig.name);
      if (!text) continue;
      const tone = event.type === 'victory' ? 'success' : event.type === 'escaped' ? 'warning' : 'info';
      this.say(text, tone);
    }
  }

  private recordFight(result: FightRecord['result']) {
    if (!this.game) return;
    const snap = this.game.snapshot();
    this.lastSnapshot = { ...snap, recentHits: [] };
    const rec: FightRecord = {
      at: Date.now(),
      skin: this.lastConfig.skin,
      name: this.lastConfig.name,
      result,
      durationMs: snap.startedAt ? Date.now() - snap.startedAt : 0,
      participants: snap.participants,
      totalHits: snap.totalHits,
      maxHp: snap.maxHp,
      finalBlow: snap.finalBlow,
      top: snap.leaderboard[0]?.name ?? null,
    };
    this.history = [rec, ...this.history].slice(0, 30);
    this.hooks.historySaved?.(this.history);
    this.broadcast({ type: 'boss', state: snap });
  }

  /** Mensagem do bot: vai para o chat (se conectado) e para o log do painel. */
  private say(text: string, tone: 'info' | 'success' | 'warning' = 'info') {
    this.broadcast({ type: 'toast', text, tone });
    this.queueBotMessage(text);
  }

  /** Fila do bot com intervalo mínimo para não tomar rate limit nem poluir o chat. */
  private queueBotMessage(text: string) {
    if (!this.sendChat || !this.settings.bot.speak) return;
    this.botQueue.push(text);
    if (this.botQueue.length > 4) this.botQueue.splice(0, this.botQueue.length - 4);
    void this.drainBotQueue();
  }

  private async drainBotQueue() {
    if (this.botBusy || !this.sendChat) return;
    this.botBusy = true;
    while (this.botQueue.length && this.sendChat) {
      const text = this.botQueue.shift()!;
      try {
        await this.sendChat(text);
      } catch (err) {
        console.warn(`[bot] falha ao enviar no canal ${this.name}:`, (err as Error).message);
      }
      await new Promise((r) => setTimeout(r, BOT_MIN_INTERVAL_MS));
    }
    this.botBusy = false;
  }
}

function pickOther(current: BossSkinId) {
  const options = BOSS_SKIN_IDS.filter((id) => id !== current);
  return options[Math.floor(Math.random() * options.length)];
}

export class RoomManager {
  private byKey = new Map<string, Room>();
  private byChannel = new Map<string, Room>();
  private loop: NodeJS.Timeout;

  constructor() {
    this.loop = setInterval(() => {
      for (const room of this.byKey.values()) room.tick();
    }, 100);
  }

  ensure(key: string, channelId: string, name: string, demo = false, settings?: RoomSettings) {
    let room = this.byChannel.get(channelId);
    if (room && room.key !== key) {
      // chave do overlay foi regenerada
      this.byKey.delete(room.key);
      room.key = key;
      for (const ws of room.sockets) ws.close(4001, 'overlay key changed');
    }
    if (!room) {
      room = new Room(key, channelId, name, demo, settings);
      this.byChannel.set(channelId, room);
    }
    room.name = name;
    this.byKey.set(key, room);
    return room;
  }

  byOverlayKey(key: string) {
    return this.byKey.get(key) ?? null;
  }

  byChannelId(channelId: string) {
    return this.byChannel.get(channelId) ?? null;
  }

  all() {
    return [...this.byChannel.values()];
  }

  dispose() {
    clearInterval(this.loop);
  }
}
