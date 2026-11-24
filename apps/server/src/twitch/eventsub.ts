import WebSocket from 'ws';
import type { ChatEvent } from '@clipei/shared';
import { helix } from './api.ts';

/**
 * Cliente EventSub via WebSocket — recebe `channel.chat.message` de todos os
 * canais conectados usando o token da conta do bot.
 *
 * Bom para desenvolvimento e para os primeiros streamers (até 300 inscrições
 * por conexão). Em escala, trocar o transporte por Conduits (mesma lógica de
 * normalização abaixo).
 */

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';

interface ChatMessageEvent {
  broadcaster_user_id: string;
  chatter_user_id: string;
  chatter_user_login: string;
  chatter_user_name: string;
  message_id: string;
  message: { text: string };
  color: string;
  badges: { set_id: string; id: string }[];
}

export interface EventSubOptions {
  botId: () => string | null;
  botToken: () => Promise<string>;
  onChat: (event: ChatEvent) => void;
  log?: (msg: string) => void;
}

export class TwitchEventSub {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private channels = new Set<string>();
  private subscribed = new Set<string>();
  /** Último erro ao inscrever cada canal (mostrado no painel). */
  private errors = new Map<string, string>();
  private keepaliveMs = 10_000;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoff = 1000;
  private closedByUs = false;
  private log: (msg: string) => void;

  constructor(private opts: EventSubOptions) {
    this.log = opts.log ?? ((m) => console.log(`[eventsub] ${m}`));
  }

  get connected() {
    return Boolean(this.sessionId);
  }

  lastError(broadcasterId: string) {
    return this.errors.get(broadcasterId) ?? null;
  }

  isListening(broadcasterId: string) {
    return this.subscribed.has(broadcasterId);
  }

  /** Passa a escutar o chat de um canal (conecta se necessário). */
  async listen(broadcasterId: string) {
    this.channels.add(broadcasterId);
    if (!this.ws) this.connect(EVENTSUB_URL);
    else if (this.sessionId) await this.subscribe(broadcasterId);
  }

  unlisten(broadcasterId: string) {
    this.channels.delete(broadcasterId);
    this.subscribed.delete(broadcasterId);
    // a inscrição some sozinha quando a sessão cai; para o MVP basta ignorar eventos
  }

  stop() {
    this.closedByUs = true;
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
    this.sessionId = null;
    this.subscribed.clear();
  }

  private connect(url: string, isReconnect = false) {
    this.closedByUs = false;
    const ws = new WebSocket(url);
    const previous = this.ws;
    this.ws = ws;

    ws.on('message', (raw) => this.onMessage(ws, raw.toString(), isReconnect, previous));
    ws.on('close', (code) => {
      if (this.ws !== ws) return; // conexão antiga substituída por reconnect
      this.sessionId = null;
      this.subscribed.clear();
      this.clearTimers();
      this.ws = null;
      if (this.closedByUs) return;
      this.log(`conexão fechada (${code}); reconectando em ${this.backoff / 1000}s`);
      this.reconnectTimer = setTimeout(() => this.connect(EVENTSUB_URL), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 60_000);
    });
    ws.on('error', (err) => this.log(`erro: ${err.message}`));
  }

  private async onMessage(ws: WebSocket, raw: string, isReconnect: boolean, previous: WebSocket | null) {
    let msg: { metadata: { message_type: string; subscription_type?: string }; payload: any };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    this.armKeepalive();

    switch (msg.metadata.message_type) {
      case 'session_welcome': {
        this.sessionId = msg.payload.session.id;
        this.keepaliveMs = (msg.payload.session.keepalive_timeout_seconds ?? 10) * 1000;
        this.backoff = 1000;
        this.log(`sessão ${isReconnect ? 'migrada' : 'aberta'}`);
        if (isReconnect && previous) {
          previous.close(); // inscrições continuam valendo na nova sessão
        } else {
          for (const id of this.channels) await this.subscribe(id);
        }
        break;
      }
      case 'session_reconnect':
        this.log('Twitch pediu reconexão');
        this.connect(msg.payload.session.reconnect_url, true);
        break;
      case 'notification':
        if (msg.metadata.subscription_type === 'channel.chat.message') {
          this.handleChat(msg.payload.event as ChatMessageEvent);
        }
        break;
      case 'revocation':
        this.log(`inscrição revogada: ${msg.payload.subscription?.status}`);
        this.subscribed.delete(msg.payload.subscription?.condition?.broadcaster_user_id);
        break;
    }
    void ws;
  }

  private handleChat(e: ChatMessageEvent) {
    if (!this.channels.has(e.broadcaster_user_id)) return;
    if (e.chatter_user_id === this.opts.botId()) return; // ignora o próprio bot
    const badge = (set: string) => e.badges?.some((b) => b.set_id === set) ?? false;
    this.opts.onChat({
      id: e.message_id,
      platform: 'twitch',
      channelId: e.broadcaster_user_id,
      text: e.message?.text ?? '',
      ts: Date.now(),
      user: {
        id: e.chatter_user_id,
        login: e.chatter_user_login,
        displayName: e.chatter_user_name,
        color: e.color || undefined,
        isSub: badge('subscriber') || badge('founder'),
        isMod: badge('moderator'),
        isVip: badge('vip'),
        isBroadcaster: badge('broadcaster'),
      },
    });
  }

  private async subscribe(broadcasterId: string) {
    const botId = this.opts.botId();
    if (!botId || !this.sessionId || this.subscribed.has(broadcasterId)) return;
    try {
      await helix('/eventsub/subscriptions', await this.opts.botToken(), {
        method: 'POST',
        body: JSON.stringify({
          type: 'channel.chat.message',
          version: '1',
          condition: { broadcaster_user_id: broadcasterId, user_id: botId },
          transport: { method: 'websocket', session_id: this.sessionId },
        }),
      });
      this.subscribed.add(broadcasterId);
      this.errors.delete(broadcasterId);
      this.log(`escutando chat do canal ${broadcasterId}`);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 409) this.subscribed.add(broadcasterId); // já inscrito
      else {
        this.errors.set(broadcasterId, (err as Error).message);
        this.log(`falha ao inscrever ${broadcasterId}: ${(err as Error).message}`);
      }
    }
  }

  private armKeepalive() {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
    // margem de 5s além do keepalive anunciado pela Twitch
    this.keepaliveTimer = setTimeout(() => {
      this.log('keepalive perdido; reconectando');
      this.ws?.terminate();
    }, this.keepaliveMs + 5000);
  }

  private clearTimers() {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.keepaliveTimer = this.reconnectTimer = null;
  }
}
