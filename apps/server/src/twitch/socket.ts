import WebSocket from 'ws';
import { helix } from './api.ts';

/**
 * Conexão EventSub por WebSocket reaproveitável: abre a sessão, cria as
 * inscrições, mantém keepalive, segue o "reconnect" da Twitch e reconecta
 * com espera crescente se cair.
 */

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';

export interface SubscriptionSpec {
  type: string;
  version: string;
  condition: Record<string, string>;
}

export interface EventSubSocketOptions {
  name: string;
  token: () => Promise<string>;
  subscriptions: () => SubscriptionSpec[];
  onNotification: (type: string, event: any) => void;
  onSubscribeError?: (spec: SubscriptionSpec, err: Error & { status?: number }) => void;
  log?: (msg: string) => void;
}

export class EventSubSocket {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private keepaliveMs = 10_000;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoff = 1000;
  private stopped = true;
  private log: (msg: string) => void;
  readonly active = new Set<string>();

  constructor(private opts: EventSubSocketOptions) {
    this.log = opts.log ?? ((m) => console.log(`[eventsub:${opts.name}] ${m}`));
  }

  get connected() {
    return Boolean(this.sessionId);
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect(EVENTSUB_URL);
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
    this.sessionId = null;
    this.active.clear();
  }

  /** Recria as inscrições que faltam (ex.: o streamer liberou permissões novas). */
  async sync() {
    if (!this.sessionId) return;
    for (const spec of this.opts.subscriptions()) await this.subscribe(spec);
  }

  private connect(url: string, isReconnect = false) {
    const ws = new WebSocket(url);
    const previous = this.ws;
    this.ws = ws;

    ws.on('message', (raw) => void this.onMessage(raw.toString(), isReconnect, previous));
    ws.on('close', (code) => {
      if (this.ws !== ws) return;
      this.sessionId = null;
      this.active.clear();
      this.clearTimers();
      this.ws = null;
      if (this.stopped) return;
      this.log(`conexão fechada (${code}); reconectando em ${this.backoff / 1000}s`);
      this.reconnectTimer = setTimeout(() => this.connect(EVENTSUB_URL), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 60_000);
    });
    ws.on('error', (err) => this.log(`erro: ${err.message}`));
  }

  private async onMessage(raw: string, isReconnect: boolean, previous: WebSocket | null) {
    let msg: { metadata: { message_type: string; subscription_type?: string }; payload: any };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    this.armKeepalive();

    switch (msg.metadata.message_type) {
      case 'session_welcome':
        this.sessionId = msg.payload.session.id;
        this.keepaliveMs = (msg.payload.session.keepalive_timeout_seconds ?? 10) * 1000;
        this.backoff = 1000;
        if (isReconnect && previous) previous.close(); // inscrições seguem válidas
        else await this.sync();
        break;
      case 'session_reconnect':
        this.connect(msg.payload.session.reconnect_url, true);
        break;
      case 'notification':
        if (msg.metadata.subscription_type) this.opts.onNotification(msg.metadata.subscription_type, msg.payload.event);
        break;
      case 'revocation':
        this.log(`inscrição revogada: ${msg.payload.subscription?.type} (${msg.payload.subscription?.status})`);
        this.active.delete(msg.payload.subscription?.type);
        break;
    }
  }

  private async subscribe(spec: SubscriptionSpec) {
    const key = `${spec.type}:${JSON.stringify(spec.condition)}`;
    if (!this.sessionId || this.active.has(key)) return;
    try {
      await helix('/eventsub/subscriptions', await this.opts.token(), {
        method: 'POST',
        body: JSON.stringify({ ...spec, transport: { method: 'websocket', session_id: this.sessionId } }),
      });
      this.active.add(key);
    } catch (err) {
      const e = err as Error & { status?: number };
      if (e.status === 409) this.active.add(key);
      else {
        this.log(`falha ao inscrever ${spec.type}: ${e.message}`);
        this.opts.onSubscribeError?.(spec, e);
      }
    }
  }

  private armKeepalive() {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
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
