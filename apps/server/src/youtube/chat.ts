import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

/**
 * Chat da live do YouTube por conexão contínua (liveChatMessages.streamList, gRPC).
 * O YouTube empurra as mensagens assim que chegam; cada conexão custa 5 de cota
 * (não é por mensagem). Se cair, reconecta de onde parou com o pageToken.
 */

const here = dirname(fileURLToPath(import.meta.url));
const def = protoLoader.loadSync(resolve(here, 'stream_list.proto'), {
  keepCase: false,
  longs: Number,
  enums: String,
  defaults: true,
  oneofs: true,
});
const pkg = grpc.loadPackageDefinition(def) as unknown as {
  youtube: { api: { v3: { V3DataLiveChatMessageService: grpc.ServiceClientConstructor } } };
};

let client: grpc.Client | null = null;
function getClient() {
  client ??= new pkg.youtube.api.v3.V3DataLiveChatMessageService('youtube.googleapis.com:443', grpc.credentials.createSsl());
  return client;
}

export interface YtChatItem {
  id: string;
  snippet: {
    type: string;
    publishedAt: string;
    displayMessage: string;
    liveChatId: string;
    authorChannelId: string;
    textMessageDetails?: { messageText: string };
    superChatDetails?: { amountMicros: number; currency: string; amountDisplayString: string; userComment: string };
    superStickerDetails?: { amountMicros: number; currency: string; amountDisplayString: string };
    newSponsorDetails?: { memberLevelName: string; isUpgrade: boolean };
    memberMilestoneChatDetails?: { memberLevelName: string; memberMonth: number };
    membershipGiftingDetails?: { giftMembershipsCount: number };
  };
  authorDetails: {
    channelId: string;
    displayName: string;
    isChatOwner: boolean;
    isChatSponsor: boolean;
    isChatModerator: boolean;
    isVerified: boolean;
  };
}

export interface YtChatHandlers {
  token: () => Promise<string>;
  onItem: (item: YtChatItem) => void;
  /** a live acabou / o chat foi encerrado */
  onEnded: (reason: string) => void;
  onError: (message: string) => void;
  onConnected: () => void;
}

export class YoutubeChatStream {
  private call: grpc.ClientReadableStream<unknown> | null = null;
  private pageToken = '';
  private stopped = false;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** ignora o histórico que vem na primeira resposta (comandos antigos não podem disparar) */
  private readonly since = Date.now() - 5000;

  constructor(
    readonly liveChatId: string,
    private h: YtChatHandlers,
  ) {}

  start() {
    void this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.call?.cancel();
    this.call = null;
  }

  private async connect() {
    if (this.stopped) return;
    let token: string;
    try {
      token = await this.h.token();
    } catch (err) {
      this.h.onError((err as Error).message);
      return this.later();
    }
    const meta = new grpc.Metadata();
    meta.set('authorization', `Bearer ${token}`);
    const req = { liveChatId: this.liveChatId, part: ['snippet', 'authorDetails'], maxResults: 200, pageToken: this.pageToken };
    const fn = (getClient() as unknown as Record<string, (r: unknown, m: grpc.Metadata) => grpc.ClientReadableStream<unknown>>).StreamList.bind(getClient());
    const call = fn(req, meta);
    this.call = call;
    let first = true;
    call.on('data', (res: { nextPageToken?: string; offlineAt?: string; items?: YtChatItem[] }) => {
      if (first) {
        first = false;
        this.retry = 0;
        this.h.onConnected();
      }
      if (res.nextPageToken) this.pageToken = res.nextPageToken;
      for (const item of res.items ?? []) {
        if (item.snippet?.type === 'CHAT_ENDED_EVENT') {
          this.stop();
          this.h.onEnded('chat encerrado');
          return;
        }
        const at = Date.parse(item.snippet?.publishedAt ?? '');
        if (Number.isFinite(at) && at < this.since) continue;
        this.h.onItem(item);
      }
      if (res.offlineAt) {
        this.stop();
        this.h.onEnded('live encerrada');
      }
    });
    call.on('error', (err: grpc.ServiceError) => {
      if (this.stopped || err.code === grpc.status.CANCELLED) return;
      const msg = `${grpc.status[err.code] ?? err.code}: ${err.details || err.message}`;
      // chat encerrado / desativado: não adianta insistir
      if (err.code === grpc.status.FAILED_PRECONDITION || err.code === grpc.status.NOT_FOUND) {
        this.stop();
        this.h.onEnded(msg);
        return;
      }
      this.h.onError(msg);
      this.later();
    });
    call.on('end', () => {
      if (this.call === call) this.call = null;
      if (!this.stopped) this.later(1000);
    });
  }

  private later(ms?: number) {
    if (this.stopped || this.timer) return;
    const wait = ms ?? Math.min(60_000, 2000 * 2 ** Math.min(5, this.retry++));
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.connect();
    }, wait);
  }
}
