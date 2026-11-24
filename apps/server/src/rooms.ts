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
  mergeSettings,
  type BossConfig,
  type BossSkinId,
  type BossSnapshot,
  type ChatEvent,
  type ClipRecord,
  type FightRecord,
  type RoomSettings,
  type SupportEvent,
  type RoomStatus,
  type ServerMessage,
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

/**
 * Uma sala = um canal de streamer. Guarda o jogo ativo, os overlays
 * conectados (OBS, prévia do painel), o simulador, a atividade do chat,
 * as configurações e o agendador do boss automático.
 */
export class Room {
  game: BossGame | null = null;
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

    const cmd = parseBossChatCommand(event);
    if (cmd) {
      if (cmd.type === 'help') {
        if (Date.now() - this.lastHelpAt > HELP_COOLDOWN_MS) {
          this.lastHelpAt = Date.now();
          this.say(bossHelpText(!!this.game?.isRunning));
        }
      } else if (cmd.type === 'start') {
        if (this.entitled()) this.startQuick(cmd.skin);
      } else if (cmd.type === 'stop') {
        this.stopBoss();
      }
      return;
    }

    if (this.game) this.dispatch(this.game.handle(event));
  }

  /** Bits, subs, presentes, pontos de canal e raids viram golpes especiais. */
  handleSupport(e: SupportEvent) {
    const damage = supportDamage(e, this.settings.support);
    const running = !!this.game?.isRunning;
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
  private clipVictory() {
    if (!this.settings.clip.enabled) return;
    const bossName = this.lastConfig.name;
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
        if (this.settings.clip.postInChat) this.say(`🎬 Clip da vitória contra ${bossName}: ${url}`);
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
    if (this.game) {
      this.dispatch(this.game.update());
      if (this.game.dirty) this.broadcastSnapshot();
    }
    if (now - this.lastSpawnCheck >= 1000) {
      this.lastSpawnCheck = now;
      this.checkAutoSpawn();
    }
    if (now - this.lastStatusAt >= STATUS_EVERY_MS && this.sockets.size) this.broadcastStatus();
  }

  private checkAutoSpawn() {
    if (!this.entitled()) return;
    const signal = this.spawner.tick({
      running: !!this.game?.isRunning,
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
    this.broadcast({ type: 'settings', settings: this.settings });
    this.broadcastStatus();
    this.onSettingsChange?.(this.settings);
    return this.settings;
  }

  status(): RoomStatus {
    return {
      activeChatters: this.activity.count(),
      autoHp: this.autoHp(),
      nextAutoAt: this.spawner.nextAt,
      live: this.isLive(),
      overlays: [...this.sockets].filter((ws) => !this.panels.has(ws) && ws.readyState === 1).length,
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
