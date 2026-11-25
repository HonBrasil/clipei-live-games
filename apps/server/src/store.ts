import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { newTrial, type ClipRecord, type FightRecord, type RoomSettings, type Subscription } from '@clipei/shared';
import type { FishingSave } from '@clipei/games';
import { config } from './config.ts';
import { SupabaseKv } from './kv.ts';

/**
 * Armazenamento simples em JSON para o MVP.
 * Próxima etapa: trocar por Postgres (as funções abaixo já isolam o acesso).
 */

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}

/** Canal da Kick ligado a uma conta Clipei. */
export interface KickLink {
  userId: string;
  name: string;
  slug: string;
  avatar?: string;
  tokens: OAuthTokens;
  rewardId?: string | null;
}

/** Canal do YouTube ligado a uma conta Clipei. */
export interface YoutubeLink {
  channelId: string;
  name: string;
  handle: string | null;
  avatar?: string;
  tokens: OAuthTokens;
}

/** Conta do bot no YouTube (um canal da Clipei, escreve em todos os chats). */
export interface StoredYoutubeBot {
  channelId: string;
  name: string;
  tokens: OAuthTokens;
}

/**
 * Conta de streamer na Clipei. O id é o id da Twitch (contas antigas e de quem
 * entra pela Twitch) ou "kick:<id>" para quem entra só pela Kick.
 */
export interface StoredChannel {
  id: string;
  login: string;
  displayName: string;
  avatar?: string;
  overlayKey: string;
  /** Tokens da Twitch (ausente em contas só da Kick). */
  tokens?: OAuthTokens;
  kick?: KickLink;
  youtube?: YoutubeLink;
  connectedAt: number;
  settings?: RoomSettings;
  /** Recompensa de pontos criada pela Clipei no canal. */
  rewardId?: string | null;
  clips?: ClipRecord[];
  history?: FightRecord[];
  /** Teste/assinatura. Criada no primeiro acesso (teste de 7 dias). */
  subscription?: Subscription;
}

export interface StoredBot {
  id: string;
  login: string;
  displayName: string;
  tokens: OAuthTokens;
}

interface StoreShape {
  channels: Record<string, StoredChannel>;
  bot: StoredBot | null;
  ytBot?: StoredYoutubeBot | null;
  /** progresso da Pescaria por canal (chave própria no banco: não regrava o canal a cada peixe) */
  fishing?: Record<string, FishingSave>;
}

const FILE = resolve(config.dataDir, 'store.json');
/** Em produção os dados ficam no Supabase; sem as variáveis, num JSON local (desenvolvimento). */
const remote = config.supabase.url && config.supabase.secret ? new SupabaseKv(config.supabase.url, config.supabase.secret) : null;
let data: StoreShape = remote ? { channels: {}, bot: null } : load();

function load(): StoreShape {
  try {
    if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, 'utf8'));
  } catch (err) {
    console.error('[store] arquivo corrompido, começando do zero', err);
  }
  return { channels: {}, bot: null };
}

/** Carrega tudo do Supabase antes do servidor começar (chamado uma vez no início). */
export async function initStore() {
  if (!remote) return;
  const rows = await remote.all();
  const next: StoreShape = { channels: {}, bot: null };
  for (const r of rows) {
    if (r.key === 'bot') next.bot = r.value as StoredBot;
    else if (r.key === 'ytbot') next.ytBot = r.value as StoredYoutubeBot;
    else if (r.key.startsWith('fish:')) (next.fishing ??= {})[r.key.slice(5)] = r.value as FishingSave;
    else if (r.key.startsWith('channel:')) next.channels[r.key.slice(8)] = r.value as StoredChannel;
    persisted.set(r.key, JSON.stringify(r.value));
  }
  data = next;
  console.log(`[store] Supabase: ${Object.keys(next.channels).length} canais carregados`);
}

// ─── Gravação ────────────────────────────────────────────────
// No Supabase só vai o que mudou (compara com o último JSON gravado), em lote.

const persisted = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let chain: Promise<void> = Promise.resolve();

function save() {
  if (!remote) {
    mkdirSync(config.dataDir, { recursive: true });
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, FILE); // escrita atômica
    return;
  }
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    chain = chain.then(flush);
  }, 250);
}

async function flush() {
  if (!remote) return;
  const current = new Map<string, string>();
  for (const [id, ch] of Object.entries(data.channels)) current.set(`channel:${id}`, JSON.stringify(ch));
  if (data.bot) current.set('bot', JSON.stringify(data.bot));
  if (data.ytBot) current.set('ytbot', JSON.stringify(data.ytBot));
  for (const [id, f] of Object.entries(data.fishing ?? {})) if (data.channels[id]) current.set(`fish:${id}`, JSON.stringify(f));
  const changed = [...current].filter(([k, json]) => persisted.get(k) !== json).map(([key, json]) => ({ key, json }));
  const removed = [...persisted.keys()].filter((k) => !current.has(k));
  if (!changed.length && !removed.length) return;
  try {
    await remote.upsert(changed);
    await remote.remove(removed);
    for (const { key, json } of changed) persisted.set(key, json);
    for (const k of removed) persisted.delete(k);
  } catch (err) {
    console.error('[store] falha ao gravar no Supabase, tentando de novo em 5 s', err);
    setTimeout(save, 5000);
  }
}

/** Grava o que estiver pendente (desligamento do servidor). */
export async function flushStore() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
    chain = chain.then(flush);
  }
  await chain;
}

export const store = {
  getChannel: (id: string) => data.channels[id] ?? null,
  getChannelByKickId: (kickUserId: string) =>
    Object.values(data.channels).find((c) => c.kick?.userId === kickUserId) ?? null,
  getChannelByYoutubeId: (ytChannelId: string) =>
    Object.values(data.channels).find((c) => c.youtube?.channelId === ytChannelId) ?? null,
  getChannelByOverlayKey: (key: string) =>
    Object.values(data.channels).find((c) => c.overlayKey === key) ?? null,
  listChannels: () => Object.values(data.channels),
  upsertChannel(input: Omit<StoredChannel, 'overlayKey' | 'connectedAt' | 'settings' | 'rewardId' | 'clips' | 'kick' | 'youtube'>) {
    const existing = data.channels[input.id];
    data.channels[input.id] = {
      ...input,
      kick: existing?.kick,
      youtube: existing?.youtube,
      settings: existing?.settings,
      rewardId: existing?.rewardId ?? null,
      clips: existing?.clips ?? [],
      history: existing?.history,
      // reconectar não reinicia o teste
      subscription: existing?.subscription ?? newTrial(),
      overlayKey: existing?.overlayKey ?? newOverlayKey(),
      connectedAt: existing?.connectedAt ?? Date.now(),
    };
    save();
    return data.channels[input.id];
  },
  updateKickTokens(id: string, tokens: OAuthTokens) {
    const ch = data.channels[id];
    if (!ch?.kick) return;
    ch.kick.tokens = tokens;
    save();
  },
  updateKickReward(id: string, rewardId: string | null) {
    const ch = data.channels[id];
    if (!ch?.kick) return;
    ch.kick.rewardId = rewardId;
    save();
  },
  updateChannelTokens(id: string, tokens: OAuthTokens) {
    const ch = data.channels[id];
    if (!ch) return;
    ch.tokens = tokens;
    save();
  },
  /** Assinatura do canal; quem ainda não tem ganha o teste a partir de agora. */
  subscription(id: string): Subscription | null {
    const ch = data.channels[id];
    if (!ch) return null;
    if (!ch.subscription) {
      ch.subscription = newTrial();
      save();
    }
    return ch.subscription;
  },
  updateSubscription(id: string, patch: Partial<Subscription>) {
    const sub = store.subscription(id);
    if (!sub) return null;
    Object.assign(sub, patch);
    save();
    return sub;
  },
  foundersUsed: () => Object.values(data.channels).filter((c) => c.subscription?.founderNumber != null).length,
  updateChannelSettings(id: string, settings: RoomSettings) {
    const ch = data.channels[id];
    if (!ch) return;
    ch.settings = settings;
    save();
  },
  setYoutube(id: string, yt: YoutubeLink | undefined) {
    const ch = data.channels[id];
    if (!ch) return;
    // um canal do YouTube só pode estar ligado a uma conta Clipei
    for (const other of Object.values(data.channels)) if (other !== ch && yt && other.youtube?.channelId === yt.channelId) delete other.youtube;
    ch.youtube = yt;
    save();
  },
  updateYoutubeTokens(id: string, tokens: OAuthTokens) {
    const ch = data.channels[id];
    if (!ch?.youtube) return;
    ch.youtube.tokens = tokens;
    save();
  },
  /** Cria conta Clipei só com o YouTube (id "yt:<canal>"). */
  createYoutubeAccount(yt: YoutubeLink) {
    const id = `yt:${yt.channelId}`;
    const existing = data.channels[id];
    data.channels[id] = {
      id,
      login: (yt.handle ?? yt.name).replace(/^@/, '').toLowerCase(),
      displayName: yt.name,
      avatar: yt.avatar,
      overlayKey: existing?.overlayKey ?? newOverlayKey(),
      connectedAt: existing?.connectedAt ?? Date.now(),
      settings: existing?.settings,
      clips: existing?.clips ?? [],
      subscription: existing?.subscription ?? newTrial(),
      youtube: yt,
    };
    save();
    return data.channels[id];
  },
  getYoutubeBot: () => data.ytBot ?? null,
  setYoutubeBot(bot: StoredYoutubeBot | null) {
    data.ytBot = bot;
    save();
  },
  updateYoutubeBotTokens(tokens: OAuthTokens) {
    if (!data.ytBot) return;
    data.ytBot.tokens = tokens;
    save();
  },
  setKick(id: string, kick: KickLink | undefined) {
    const ch = data.channels[id];
    if (!ch) return;
    // um canal da Kick só pode estar ligado a uma conta Clipei
    for (const other of Object.values(data.channels)) if (other !== ch && other.kick?.userId === kick?.userId) delete other.kick;
    ch.kick = kick;
    save();
  },
  /**
   * Quem entrou só com a Kick e depois conecta a Twitch: a conta "kick:<id>"
   * vira a conta da Twitch, levando Kick, configurações, URL do overlay e clips.
   */
  mergeInto(fromId: string, intoId: string) {
    const from = data.channels[fromId];
    const into = data.channels[intoId];
    if (!from || !into || from === into) return into ?? null;
    into.kick = into.kick ?? from.kick;
    into.youtube = into.youtube ?? from.youtube;
    into.settings = into.settings ?? from.settings;
    into.subscription = into.subscription ?? from.subscription;
    into.overlayKey = from.overlayKey;
    into.clips = [...(from.clips ?? []), ...(into.clips ?? [])].slice(0, 20);
    if (data.fishing?.[fromId]) {
      data.fishing[intoId] ??= data.fishing[fromId];
      delete data.fishing[fromId];
    }
    delete data.channels[fromId];
    save();
    return into;
  },
  /** Cria conta Clipei só com a Kick (id "kick:<id>"). */
  createKickAccount(kick: KickLink) {
    const id = `kick:${kick.userId}`;
    const existing = data.channels[id];
    data.channels[id] = {
      id,
      login: kick.slug,
      displayName: kick.name,
      avatar: kick.avatar,
      overlayKey: existing?.overlayKey ?? newOverlayKey(),
      connectedAt: existing?.connectedAt ?? Date.now(),
      settings: existing?.settings,
      clips: existing?.clips ?? [],
      kick,
    };
    save();
    return data.channels[id];
  },
  updateChannel(id: string, patch: Partial<Pick<StoredChannel, 'rewardId' | 'clips' | 'history'>>) {
    const ch = data.channels[id];
    if (!ch) return;
    Object.assign(ch, patch);
    save();
  },
  regenerateOverlayKey(id: string) {
    const ch = data.channels[id];
    if (!ch) return null;
    ch.overlayKey = newOverlayKey();
    save();
    return ch.overlayKey;
  },
  removeChannel(id: string) {
    delete data.channels[id];
    if (data.fishing) delete data.fishing[id];
    save();
  },
  getFishing: (id: string) => data.fishing?.[id] ?? null,
  /** O objeto da pescaria é o mesmo que o jogo altera: só marca para gravar. */
  saveFishing(id: string, f: FishingSave) {
    (data.fishing ??= {})[id] = f;
    save();
  },
  getBot: () => data.bot,
  setBot(bot: StoredBot | null) {
    data.bot = bot;
    save();
  },
  updateBotTokens(tokens: OAuthTokens) {
    if (!data.bot) return;
    data.bot.tokens = tokens;
    save();
  },
};

function newOverlayKey() {
  return randomBytes(12).toString('base64url');
}
