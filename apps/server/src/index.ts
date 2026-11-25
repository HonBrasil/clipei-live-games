import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import {
  BOSS_PRESETS,
  BOSS_SKINS,
  BOSS_SKIN_IDS,
  FOUNDER_SLOTS,
  isBossSkin,
  type BossConfig,
  type RaceConfig,
  type DuelConfig,
  type RoyaleConfig,
  type KiteConfig,
  type BossPresetKey,
  type MeResponse,
  type SimulatorStatus,
  type AdminOverview,
  type SupportKind,
} from '@clipei/shared';
import { config, twitchConfigured } from './config.ts';
import { flushStore, initStore, store, type StoredChannel } from './store.ts';
import * as billing from './billing.ts';
import { RoomManager, type Room } from './rooms.ts';
import {
  BOT_SCOPES,
  STREAMER_SCOPES,
  authorizeUrl,
  ensureFresh,
  exchangeCode,
  getAppToken,
  getMe,
  helix,
  sendChatMessage,
} from './twitch/api.ts';
import { TwitchEventSub } from './twitch/eventsub.ts';
import type { EventSubSocket } from './twitch/socket.ts';
import {
  SUPPORT_SCOPES,
  createClip,
  createSupportSocket,
  resolveRedemption,
  setRewardPaused,
  upsertReward,
} from './twitch/channel.ts';
import {
  KICK_SCOPES,
  kickAuthorizeUrl,
  kickConfigured,
  kickEnsureFresh,
  kickEnsureSubscriptions,
  kickExchangeCode,
  kickIsLive,
  kickMe,
  kickResolveRedemption,
  kickSendChat,
  kickSetRewardPaused,
  kickUpsertReward,
  pkcePair,
  verifyKickSignature,
} from './kick/api.ts';
import { mapKickEvent } from './kick/events.ts';

// dados do Supabase precisam estar em memória antes de qualquer rota ou sala
await initStore();

const DEMO_KEY = 'demo';
const SESSION_COOKIE = 'clipei_ch';
const OAUTH_COOKIE = 'clipei_oauth';

const app = Fastify({
  // atrás da Vercel/Railway: respeita X-Forwarded-* (protocolo, IP)
  trustProxy: true,
  logger: { level: config.isProd ? 'info' : 'warn' },
  ...(config.https ? { https: config.https } : {}),
});

await app.register(cookie, { secret: config.sessionSecret });
await app.register(websocket);

const rooms = new RoomManager();
rooms.ensure(DEMO_KEY, 'demo', 'Canal demo', true);

// ─── Twitch: bot + EventSub ──────────────────────────────────

async function botToken() {
  const bot = store.getBot();
  if (!bot) throw new Error('Conta do bot não conectada');
  return (await ensureFresh(bot.tokens, (t) => store.updateBotTokens(t))).accessToken;
}

const eventsub = new TwitchEventSub({
  botId: () => store.getBot()?.id ?? null,
  botToken,
  onChat: (event) => rooms.byChannelId(event.channelId)?.handleChat(event),
});

/** Situação "ao vivo" de cada canal na Twitch (consultada periodicamente). */
const liveState = new Map<string, boolean>();

/** Token do streamer sempre válido (renova sozinho). */
async function streamerToken(channelId: string) {
  const ch = store.getChannel(channelId);
  if (!ch?.tokens) throw new Error('Twitch não conectada');
  return (await ensureFresh(ch.tokens, (t) => store.updateChannelTokens(channelId, t))).accessToken;
}

const hasScope = (channelId: string, scope: string) => store.getChannel(channelId)?.tokens?.scopes.includes(scope) ?? false;

// ─── Kick: tokens, ao vivo, recompensas, inscrições ──────────

/** Token da Kick do streamer (renova sozinho; dura ~2 h). */
async function kickToken(channelId: string) {
  const ch = store.getChannel(channelId);
  if (!ch?.kick) throw new Error('Kick não conectada');
  return (await kickEnsureFresh(ch.kick.tokens, (t) => store.updateKickTokens(channelId, t))).accessToken;
}

/** Kick: canal ao vivo (atualizado por evento e por consulta periódica), último evento e problemas. */
const kickLive = new Map<string, boolean>();
const kickLastEvent = new Map<string, number>();
const kickProblem = new Map<string, string>();
/** Mensagens enviadas pelo bot na Kick (o webhook devolve o próprio texto do bot; ignoramos). */
const kickSent = new Set<string>();

async function syncKick(channelId: string) {
  const ch = store.getChannel(channelId);
  if (!ch?.kick || !kickConfigured()) return;
  const kickId = ch.kick.userId;
  try {
    const token = await kickToken(channelId);
    const { errors } = await kickEnsureSubscriptions(token);
    kickLive.set(kickId, await kickIsLive(token).catch(() => kickLive.get(kickId) ?? false));
    if (errors.length) kickProblem.set(kickId, `A Kick recusou alguns eventos: ${errors.join('; ').slice(0, 200)}`);
    else kickProblem.delete(kickId);
  } catch (err) {
    kickProblem.set(kickId, `Não deu para falar com a Kick: ${(err as Error).message.slice(0, 160)}`);
  }
  await syncKickReward(channelId);
}

async function syncKickReward(channelId: string) {
  const ch = store.getChannel(channelId);
  const room = rooms.byChannelId(channelId);
  if (!ch?.kick || !room || !kickConfigured()) return;
  const points = room.getSettings().support.points;
  if (!points.enabled && !ch.kick.rewardId) return;
  try {
    const id = await kickUpsertReward(await kickToken(channelId), ch.kick.rewardId ?? null, {
      enabled: points.enabled,
      cost: points.cost,
      paused: !room.game?.isRunning,
    });
    if (id !== (ch.kick.rewardId ?? null)) store.updateKickReward(channelId, id);
  } catch (err) {
    kickProblem.set(ch.kick.userId, `Recompensa de pontos na Kick: ${(err as Error).message.slice(0, 160)}`);
  }
}

// confere inscrições e status da live da Kick a cada 30 min (a Kick cancela inscrições que falham por 1 dia)
setInterval(() => {
  for (const ch of store.listChannels()) if (ch.kick) void syncKick(ch.id);
}, 30 * 60_000);

/** Situação da recompensa de pontos de cada canal (mostrada no painel). */
const rewardStatus = new Map<string, { ok: boolean; message: string }>();

async function syncReward(channelId: string) {
  void syncKickReward(channelId);
  const ch = store.getChannel(channelId);
  const room = rooms.byChannelId(channelId);
  if (!ch?.tokens || !room || !twitchConfigured()) return;
  const points = room.getSettings().support.points;
  if (!points.enabled && !ch.rewardId) return rewardStatus.delete(channelId);
  if (!hasScope(channelId, SUPPORT_SCOPES.points)) {
    rewardStatus.set(channelId, { ok: false, message: 'Reconecte a Twitch para liberar os pontos de canal.' });
    return;
  }
  try {
    const id = await upsertReward(channelId, await streamerToken(channelId), ch.rewardId ?? null, {
      enabled: points.enabled,
      cost: points.cost,
      paused: !room.game?.isRunning,
    });
    if (id !== (ch.rewardId ?? null)) {
      store.updateChannel(channelId, { rewardId: id });
      await supportSockets.get(channelId)?.sync(); // passa a escutar os resgates da recompensa nova
    }
    rewardStatus.set(
      channelId,
      points.enabled
        ? { ok: true, message: 'Recompensa "⚡ Apoio no Minigame" ativa no seu canal. Ela só abre enquanto um jogo está rolando.' }
        : { ok: true, message: 'Recompensa desativada no seu canal.' },
    );
  } catch (err) {
    rewardStatus.set(channelId, { ok: false, message: (err as Error).message });
  }
}

/** Uma conexão EventSub por canal para bits, subs, pontos e raids. */
const supportSockets = new Map<string, EventSubSocket>();

function startSupportEvents(channelId: string, restart = false) {
  if (!twitchConfigured() || !store.getChannel(channelId)?.tokens) return;
  const existing = supportSockets.get(channelId);
  if (existing && !restart) return;
  existing?.stop();
  const socket = createSupportSocket({
    broadcasterId: channelId,
    token: () => streamerToken(channelId),
    scopes: () => store.getChannel(channelId)?.tokens?.scopes ?? [],
    rewardId: () => store.getChannel(channelId)?.rewardId ?? null,
    onSupport: (e) => rooms.byChannelId(channelId)?.handleSupport(e),
  });
  supportSockets.set(channelId, socket);
  socket.start();
}

function roomFor(ch: StoredChannel): Room {
  const room = rooms.ensure(ch.overlayKey, ch.id, ch.displayName, false, ch.settings);
  const cur = () => store.getChannel(ch.id) ?? ch;
  room.entitled = () => billing.entitled(ch.id);

  // o bot fala em todas as plataformas conectadas
  const bot = store.getBot();
  const senders: ((text: string) => Promise<void>)[] = [];
  if (bot && ch.tokens && twitchConfigured()) senders.push((text) => sendChatMessage(ch.id, bot.id, text, botToken));
  if (ch.kick && kickConfigured()) {
    senders.push(async (text) => {
      const r = await kickSendChat(await kickToken(ch.id), text);
      if (r?.data?.message_id) kickSent.add(r.data.message_id);
      kickSent.add(`text:${text}`);
      if (kickSent.size > 200) kickSent.delete(kickSent.values().next().value!);
    });
  }
  room.sendChat = senders.length
    ? async (text) => {
        const results = await Promise.allSettled(senders.map((send) => send(text)));
        for (const r of results) if (r.status === 'rejected') app.log.warn({ err: r.reason }, 'falha ao enviar no chat');
      }
    : null;

  // ao vivo em qualquer plataforma conectada
  room.isLive = () => {
    const c = cur();
    const twitch = c.tokens ? !twitchConfigured() || liveState.get(c.id) === true : false;
    const kick = c.kick ? !kickConfigured() || kickLive.get(c.kick.userId) === true : false;
    return twitch || kick || (!c.tokens && !c.kick);
  };
  if (!room.clips.length && ch.clips?.length) room.clips = ch.clips;
  if (!room.history.length && ch.history?.length) room.history = ch.history;
  room.onSettingsChange = (settings) => {
    store.updateChannelSettings(ch.id, settings);
    if (settings.autoSpawn.enabled) void refreshLive();
    void syncReward(ch.id);
  };
  const pauseReward = (paused: boolean) => {
    if (!room.getSettings().support.points.enabled) return;
    const c = cur();
    if (c.tokens && c.rewardId) {
      const rewardId = c.rewardId;
      void streamerToken(ch.id)
        .then((t) => setRewardPaused(ch.id, t, rewardId, paused))
        .catch((err) => app.log.warn({ err }, 'falha ao pausar recompensa (Twitch)'));
    }
    if (c.kick?.rewardId) {
      const rewardId = c.kick.rewardId;
      void kickToken(ch.id)
        .then((t) => kickSetRewardPaused(t, rewardId, paused))
        .catch((err) => app.log.warn({ err }, 'falha ao pausar recompensa (Kick)'));
    }
  };
  room.hooks = {
    fightStarted: () => pauseReward(false),
    fightEnded: () => pauseReward(true),
    redemption: (e, fulfilled) => {
      if (!e.redemptionId) return;
      const c = cur();
      if (e.platform === 'kick') {
        void kickToken(ch.id)
          .then((t) => kickResolveRedemption(t, e.redemptionId!, fulfilled))
          .catch((err) => app.log.warn({ err }, 'falha ao resolver resgate (Kick)'));
        return;
      }
      if (e.platform !== 'twitch' || !c.rewardId) return;
      const rewardId = c.rewardId;
      void streamerToken(ch.id)
        .then((t) => resolveRedemption(ch.id, t, rewardId, e.redemptionId!, fulfilled))
        .catch((err) => app.log.warn({ err }, 'falha ao resolver resgate'));
    },
    // clip automático: só a Twitch tem API de clip
    createClip:
      twitchConfigured() && ch.tokens
        ? async () => {
            if (!hasScope(ch.id, SUPPORT_SCOPES.clips)) throw new Error('Falta a permissão clips:edit');
            return createClip(ch.id, await streamerToken(ch.id));
          }
        : undefined,
    clipSaved: (clips) => store.updateChannel(ch.id, { clips }),
    historySaved: (history) => store.updateChannel(ch.id, { history }),
  };
  return room;
}

/** Consulta quais canais com boss automático estão ao vivo (até 100 por chamada). */
async function refreshLive() {
  if (!twitchConfigured()) return;
  const ids = rooms
    .all()
    .filter((r) => !r.demo && r.getSettings().autoSpawn.enabled)
    .map((r) => r.channelId);
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    try {
      const qs = batch.map((id) => `user_id=${encodeURIComponent(id)}`).join('&');
      const r = await helix<{ data: { user_id: string; type: string }[] }>(`/streams?${qs}&first=100`, await getAppToken());
      const online = new Set(r.data.filter((d) => d.type === 'live').map((d) => d.user_id));
      for (const id of batch) liveState.set(id, online.has(id));
    } catch (err) {
      app.log.warn({ err }, 'falha ao consultar streams ao vivo');
    }
  }
}
setInterval(() => void refreshLive(), 90_000);

/** Liga o chat de um canal (precisa de streamer + bot conectados). */
function activateChannel(ch: StoredChannel, reconnected = false) {
  roomFor(ch);
  if (ch.tokens && twitchConfigured() && store.getBot()) {
    eventsub.listen(ch.id).catch((err) => app.log.error(err));
  }
  startSupportEvents(ch.id, reconnected);
  void syncReward(ch.id);
  if (ch.kick) void syncKick(ch.id);
}

for (const ch of store.listChannels()) activateChannel(ch);
void refreshLive();

// ─── Sessão ──────────────────────────────────────────────────

function currentChannel(req: FastifyRequest): StoredChannel | null {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  return unsigned.valid && unsigned.value ? store.getChannel(unsigned.value) : null;
}

function currentRoom(req: FastifyRequest): Room {
  const ch = currentChannel(req);
  return ch ? roomFor(ch) : rooms.byOverlayKey(DEMO_KEY)!;
}

const cookieOpts = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.isProd,
  signed: true,
};

// ─── OAuth Twitch ────────────────────────────────────────────

app.get<{ Querystring: { as?: string } }>('/api/auth/twitch/login', async (req, reply) => {
  if (!twitchConfigured()) {
    return reply.redirect(`${config.webUrl}/app?erro=twitch-nao-configurada`);
  }
  const role = req.query.as === 'bot' ? 'bot' : 'streamer';
  if (role === 'bot' && !isAdmin(currentChannel(req))) return reply.redirect(`${config.webUrl}/app?erro=sem-permissao-bot`);
  const state = randomBytes(16).toString('hex');
  reply.setCookie(OAUTH_COOKIE, JSON.stringify({ state, role }), { ...cookieOpts, maxAge: 600 });
  const scopes = role === 'bot' ? BOT_SCOPES : STREAMER_SCOPES;
  // force_verify no bot para permitir trocar de conta na tela da Twitch
  return reply.redirect(authorizeUrl(scopes, state, role === 'bot'));
});

app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
  '/api/auth/twitch/callback',
  async (req, reply) => {
    const back = (q: string) => reply.redirect(`${config.webUrl}/app?${q}`);
    const rawCookie = req.cookies[OAUTH_COOKIE];
    reply.clearCookie(OAUTH_COOKIE, { path: '/' });

    if (req.query.error) return back('erro=autorizacao-cancelada');
    const unsigned = rawCookie ? req.unsignCookie(rawCookie) : null;
    if (!unsigned?.valid || !unsigned.value) return back('erro=sessao-expirada');
    const saved = JSON.parse(unsigned.value) as { state: string; role: 'bot' | 'streamer' };
    if (!req.query.code || req.query.state !== saved.state) return back('erro=estado-invalido');

    try {
      const tokens = await exchangeCode(req.query.code);
      const me = await getMe(tokens.accessToken);

      if (saved.role === 'bot') {
        // só o admin da Clipei conecta a conta do bot (uma vez, vale para todos os canais)
        if (!isAdmin(currentChannel(req))) return back('erro=sem-permissao-bot');
        store.setBot({ id: me.id, login: me.login, displayName: me.display_name, tokens });
        // reinicia o EventSub com a nova conta do bot
        eventsub.stop();
        for (const ch of store.listChannels()) activateChannel(ch);
        return back('conectado=bot');
      }

      const previous = currentChannel(req);
      let ch = store.upsertChannel({
        id: me.id,
        login: me.login,
        displayName: me.display_name,
        avatar: me.profile_image_url,
        tokens,
      });
      // entrou antes só com a Kick: junta tudo na conta da Twitch
      if (previous && previous.id.startsWith('kick:')) ch = store.mergeInto(previous.id, ch.id) ?? ch;
      activateChannel(ch, true);
      reply.setCookie(SESSION_COOKIE, ch.id, { ...cookieOpts, maxAge: 60 * 60 * 24 * 30 });
      return back('conectado=streamer');
    } catch (err) {
      req.log.error(err);
      return back('erro=falha-twitch');
    }
  },
);

// ─── OAuth Kick (OAuth 2.1 + PKCE) ───────────────────────────

const KICK_OAUTH_COOKIE = 'clipei_kick_oauth';

app.get('/api/auth/kick/login', async (_req, reply) => {
  if (!kickConfigured()) return reply.redirect(`${config.webUrl}/app?erro=kick-nao-configurada`);
  const state = randomBytes(16).toString('hex');
  const { verifier, challenge } = pkcePair();
  reply.setCookie(KICK_OAUTH_COOKIE, JSON.stringify({ state, verifier }), { ...cookieOpts, maxAge: 600 });
  return reply.redirect(kickAuthorizeUrl(state, challenge));
});

app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/api/auth/kick/callback', async (req, reply) => {
  const back = (q: string) => reply.redirect(`${config.webUrl}/app?${q}`);
  const raw = req.cookies[KICK_OAUTH_COOKIE];
  reply.clearCookie(KICK_OAUTH_COOKIE, { path: '/' });
  if (req.query.error) return back('erro=autorizacao-cancelada');
  const unsigned = raw ? req.unsignCookie(raw) : null;
  if (!unsigned?.valid || !unsigned.value) return back('erro=sessao-expirada');
  const saved = JSON.parse(unsigned.value) as { state: string; verifier: string };
  if (!req.query.code || req.query.state !== saved.state) return back('erro=estado-invalido');

  try {
    const tokens = await kickExchangeCode(req.query.code, saved.verifier);
    const me = await kickMe(tokens.accessToken);
    kickLive.set(me.id, me.live);
    const link = { userId: me.id, name: me.name, slug: me.slug, avatar: me.avatar, tokens, rewardId: null as string | null };

    // 1) logado: liga a Kick na conta atual  2) Kick já ligada a uma conta: entra nela  3) senão: conta nova só da Kick
    const session = currentChannel(req);
    let ch: StoredChannel;
    if (session) {
      link.rewardId = session.kick?.userId === me.id ? (session.kick.rewardId ?? null) : null;
      store.setKick(session.id, link);
      ch = store.getChannel(session.id)!;
    } else {
      const existing = store.getChannelByKickId(me.id);
      if (existing) {
        link.rewardId = existing.kick?.rewardId ?? null;
        store.setKick(existing.id, link);
        ch = store.getChannel(existing.id)!;
      } else {
        ch = store.createKickAccount(link);
      }
    }
    activateChannel(ch);
    reply.setCookie(SESSION_COOKIE, ch.id, { ...cookieOpts, maxAge: 60 * 60 * 24 * 30 });
    return back('conectado=kick');
  } catch (err) {
    req.log.error(err);
    return back('erro=falha-kick');
  }
});

app.post('/api/auth/kick/disconnect', async (req, reply) => {
  const ch = currentChannel(req);
  if (!ch?.kick) return reply.code(400).send({ error: 'Kick não está conectada' });
  if (ch.id.startsWith('kick:')) return reply.code(400).send({ error: 'Sua conta entrou pela Kick. Conecte a Twitch antes de desligar a Kick.' });
  store.setKick(ch.id, undefined);
  roomFor(store.getChannel(ch.id)!);
  return { ok: true };
});

// ─── Webhook da Kick ─────────────────────────────────────────
// A assinatura é feita sobre o corpo cru, então esta rota lê o corpo como texto.

const seenKickMessages = new Set<string>();

await app.register(async (kickRoutes) => {
  kickRoutes.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  kickRoutes.post('/api/webhooks/kick', async (req, reply) => {
    const h = req.headers;
    const messageId = String(h['kick-event-message-id'] ?? '');
    const timestamp = String(h['kick-event-message-timestamp'] ?? '');
    const signature = String(h['kick-event-signature'] ?? '');
    const type = String(h['kick-event-type'] ?? '');
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});

    if (!messageId || !signature || !(await verifyKickSignature(messageId, timestamp, rawBody, signature))) {
      return reply.code(401).send({ error: 'assinatura inválida' });
    }
    // entrega "pelo menos uma vez": ignora repetidos
    if (seenKickMessages.has(messageId)) return { ok: true, duplicate: true };
    seenKickMessages.add(messageId);
    if (seenKickMessages.size > 5000) seenKickMessages.delete(seenKickMessages.values().next().value!);

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return reply.code(400).send({ error: 'json inválido' });
    }
    const mapped = mapKickEvent(type, payload);
    if (!mapped) return { ok: true, ignored: type };

    kickLastEvent.set(mapped.broadcasterId, Date.now());
    const account = store.getChannelByKickId(mapped.broadcasterId);
    if (!account) return { ok: true, ignored: 'canal não conectado' };
    const room = roomFor(account);

    switch (mapped.kind) {
      case 'chat':
        // a própria mensagem do bot volta pelo webhook: ignora
        if (kickSent.has(mapped.event.id) || kickSent.has(`text:${mapped.event.text}`)) break;
        room.handleChat(mapped.event);
        break;
      case 'support':
        room.handleSupport(mapped.event);
        break;
      case 'redemption':
        if (mapped.status === 'pending' && mapped.rewardId && mapped.rewardId === account.kick?.rewardId) {
          room.handleSupport(mapped.event);
        }
        break;
      case 'live':
        kickLive.set(mapped.broadcasterId, mapped.live);
        break;
    }
    return { ok: true };
  });
});

app.post('/api/auth/logout', async (_req, reply) => {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  return { ok: true };
});

// ─── Painel ──────────────────────────────────────────────────

app.get('/api/me', async (req): Promise<MeResponse> => {
  const ch = currentChannel(req);
  const room = currentRoom(req);
  const bot = store.getBot();
  return {
    demo: !ch,
    channel: ch ? { id: ch.id, login: ch.login, displayName: ch.displayName, avatar: ch.avatar } : null,
    overlayKey: room.key,
    twitch: {
      configured: twitchConfigured(),
      streamerConnected: Boolean(ch),
      botConnected: Boolean(bot),
      botName: bot?.displayName ?? null,
      chatListening: ch ? eventsub.isListening(ch.id) : false,
      chatError: ch ? friendlyChatError(eventsub.lastError(ch.id), eventsub.connected) : null,
    },
    simulator: room.simulator.status,
    settings: room.getSettings(),
    status: room.status(),
    clips: room.clips,
    history: room.history,
    missingScopes: ch?.tokens ? STREAMER_SCOPES.filter((sc) => !ch.tokens!.scopes.includes(sc)) : [],
    pointsReward: ch?.tokens ? (rewardStatus.get(ch.id) ?? null) : null,
    kick: {
      configured: kickConfigured(),
      connected: Boolean(ch?.kick),
      name: ch?.kick?.name ?? null,
      slug: ch?.kick?.slug ?? null,
      live: ch?.kick ? kickLive.get(ch.kick.userId) === true : false,
      lastEventAt: ch?.kick ? (kickLastEvent.get(ch.kick.userId) ?? null) : null,
      problem: ch?.kick ? (kickProblem.get(ch.kick.userId) ?? null) : null,
      missingScopes: ch?.kick ? KICK_SCOPES.filter((sc) => !ch.kick!.tokens.scopes.includes(sc)) : [],
    },
    primary: ch ? (ch.id.startsWith('kick:') ? 'kick' : 'twitch') : null,
    admin: isAdmin(ch),
    billing: ch ? billing.view(ch.id) : null,
    founderSlotsLeft: billing.founderSlotsLeft(),
  };
});

// ─── Planos ──────────────────────────────────────────────────

app.post<{ Body: { cycle?: string } }>('/api/billing/checkout', async (req, reply) => {
  const ch = currentChannel(req);
  if (!ch) return reply.code(401).send({ error: 'Entre com a Twitch para assinar.' });
  const cycle = req.body?.cycle === 'yearly' ? 'yearly' : 'monthly';
  const checkout = await billing.createCheckout(ch.id, cycle);
  if (!checkout) return reply.code(503).send({ error: 'O pagamento pelo Mercado Pago chega em breve. Enquanto isso, fale com a equipe da Clipei para liberar sua assinatura.' });
  return checkout;
});

app.post<{ Body: { channelId?: string; action?: string } }>('/api/admin/subscription', async (req, reply) => {
  if (!isAdmin(currentChannel(req))) return reply.code(403).send({ error: 'Só administradores da Clipei' });
  const id = String(req.body?.channelId ?? '');
  if (!store.getChannel(id)) return reply.code(404).send({ error: 'Canal não encontrado' });
  const action = req.body?.action;
  if (action === 'monthly' || action === 'yearly') billing.activate(id, action);
  else if (action === 'courtesy') billing.activate(id, 'monthly', { courtesy: true });
  else if (action === 'trial7') billing.extendTrial(id, 7);
  else if (action === 'expire') billing.expire(id);
  else return reply.code(400).send({ error: 'Ação inválida' });
  return { ok: true, billing: billing.view(id) };
});

app.get('/api/boss', async (req) => ({
  state: currentRoom(req).currentSnapshot(),
  config: currentRoom(req).lastConfig,
  hpMode: currentRoom(req).hpMode,
  presets: BOSS_PRESETS,
}));

app.post<{ Body: Partial<Omit<BossConfig, 'skin'>> & { preset?: BossPresetKey | 'auto'; skin?: string } }>('/api/boss/start', async (req, reply) => {
  const body = req.body ?? {};
  const room = currentRoom(req);
  const hpMode = body.preset === 'auto' ? 'auto' : 'fixed';
  const presetHp = body.preset && body.preset !== 'auto' ? BOSS_PRESETS[body.preset]?.maxHp : undefined;
  // "random" sorteia um boss diferente do último
  const skin =
    body.skin === 'random'
      ? pickOther(room.lastConfig.skin)
      : isBossSkin(body.skin)
        ? body.skin
        : room.lastConfig.skin;
  const cfg: BossConfig = {
    skin,
    name: String(body.name ?? '').trim().slice(0, 32) || BOSS_SKINS[skin].name,
    maxHp: clampInt(body.maxHp ?? presetHp ?? room.lastConfig.maxHp, 100, 10_000_000),
    durationSec: clampInt(body.durationSec ?? room.lastConfig.durationSec, 0, 3600),
    cooldownMs: clampInt(body.cooldownMs ?? room.lastConfig.cooldownMs, 0, 60_000),
  };
  if (!Number.isFinite(cfg.maxHp)) return reply.code(400).send({ error: 'Vida inválida' });
  if (!room.entitled()) return reply.code(402).send({ error: 'Seu teste acabou. Assine um plano para voltar a invocar bosses.' });
  if (room.race?.isActive) return reply.code(409).send({ error: 'Tem uma corrida rolando. Encerre a corrida antes de invocar o boss.' });
  if (room.duel?.isActive) return reply.code(409).send({ error: 'Tem um duelo rolando. Espere terminar para invocar o boss.' });
  if (room.royale?.isActive) return reply.code(409).send({ error: 'Tem um Battle Royale rolando. Espere terminar para invocar o boss.' });
  if (room.kite?.isActive) return reply.code(409).send({ error: 'Tem um Pipa Combate no céu. Espere terminar para invocar o boss.' });
  const started = room.startBoss(cfg, hpMode);
  return { ok: true, config: started, hpMode };
});

app.post('/api/settings', async (req) => ({ settings: currentRoom(req).updateSettings(req.body ?? {}) }));

/** Simula um apoio (bits, sub, presente, pontos, raid) para testar sem gastar nada. */
app.post<{ Body: { kind?: SupportKind; amount?: number; name?: string; unit?: 'bits' | 'kicks' } }>('/api/simulate/support', async (req, reply) => {
  const kinds: SupportKind[] = ['bits', 'sub', 'gift', 'points', 'raid'];
  const kind = req.body?.kind;
  if (!kind || !kinds.includes(kind)) return reply.code(400).send({ error: 'Tipo de apoio inválido' });
  const name = String(req.body?.name ?? 'ApoiadorTeste').slice(0, 25);
  const amount = Math.max(1, Math.min(100_000, Math.round(Number(req.body?.amount) || 1)));
  return currentRoom(req).handleSupport({
    kind,
    amount,
    platform: 'simulator',
    unit: req.body?.unit === 'kicks' ? 'kicks' : undefined,
    user: { id: `sim-${name.toLowerCase()}`, name },
  });
});

app.post('/api/sound/test', async (req) => {
  currentRoom(req).testSound();
  return { ok: true };
});

// ─── Corrida ─────────────────────────────────────────────────

app.post<{ Body: Partial<RaceConfig> }>('/api/race/start', async (req, reply) => {
  const room = currentRoom(req);
  if (!room.entitled()) return reply.code(402).send({ error: 'Seu teste acabou. Assine um plano para voltar a jogar.' });
  const res = room.startRace(req.body && Object.keys(req.body).length ? req.body : undefined);
  if (!res.ok) return reply.code(409).send({ error: res.error });
  return res;
});

app.post<{ Body: Partial<DuelConfig> }>('/api/duel/start', async (req, reply) => {
  const room = currentRoom(req);
  if (!room.entitled()) return reply.code(402).send({ error: 'Seu teste acabou. Assine um plano para voltar a jogar.' });
  const res = room.startDuel(req.body && Object.keys(req.body).length ? req.body : undefined);
  if (!res.ok) return reply.code(409).send({ error: res.error });
  return res;
});

app.post('/api/duel/stop', async (req) => ({ ok: currentRoom(req).stopDuel() }));

app.post<{ Body: Partial<RoyaleConfig> }>('/api/royale/start', async (req, reply) => {
  const room = currentRoom(req);
  if (!room.entitled()) return reply.code(402).send({ error: 'Seu teste acabou. Assine um plano para voltar a jogar.' });
  const res = room.startRoyale(req.body && Object.keys(req.body).length ? req.body : undefined);
  if (!res.ok) return reply.code(409).send({ error: res.error });
  return res;
});

app.post('/api/royale/go', async (req) => ({ ok: currentRoom(req).royaleGo() }));

app.post('/api/royale/stop', async (req) => ({ ok: currentRoom(req).stopRoyale() }));

app.post<{ Body: Partial<KiteConfig> }>('/api/kite/start', async (req, reply) => {
  const room = currentRoom(req);
  if (!room.entitled()) return reply.code(402).send({ error: 'Seu teste acabou. Assine um plano para voltar a jogar.' });
  const res = room.startKite(req.body && Object.keys(req.body).length ? req.body : undefined);
  if (!res.ok) return reply.code(409).send({ error: res.error });
  return res;
});

app.post('/api/kite/go', async (req) => ({ ok: currentRoom(req).kiteGo() }));

app.post('/api/kite/stop', async (req) => ({ ok: currentRoom(req).stopKite() }));

app.post('/api/race/go', async (req) => ({ ok: currentRoom(req).raceGo() }));

app.post('/api/race/stop', async (req) => ({ ok: currentRoom(req).stopRace() }));

app.post('/api/boss/stop', async (req) => {
  currentRoom(req).stopBoss();
  return { ok: true };
});

app.post<{ Body: Partial<SimulatorStatus> }>('/api/simulator', async (req) => {
  return { status: currentRoom(req).simulator.configure(req.body ?? {}) };
});

app.post('/api/overlay/regenerate', async (req, reply) => {
  const ch = currentChannel(req);
  if (!ch) return reply.code(400).send({ error: 'O canal demo não tem chave própria' });
  const key = store.regenerateOverlayKey(ch.id)!;
  roomFor({ ...ch, overlayKey: key });
  return { overlayKey: key };
});

app.post('/api/chat/test', async (req, reply) => {
  const room = currentRoom(req);
  if (!room.sendChat) return reply.code(400).send({ error: 'Conecte o canal e a conta do bot primeiro' });
  await room.sendChat('👋 Clipei Live Games conectado! Em breve: boss coletivo aqui no chat.');
  return { ok: true };
});

// ─── Painel de administração ─────────────────────────────────

app.get('/api/admin/overview', async (req, reply): Promise<AdminOverview | undefined> => {
  if (!isAdmin(currentChannel(req))) {
    reply.code(403).send({ error: 'Só administradores da Clipei' });
    return;
  }
  const bot = store.getBot();
  return {
    openAdmin: !config.twitch.botAdmins.length,
    platforms: { twitch: twitchConfigured(), kick: kickConfigured() },
    bot: {
      connected: Boolean(bot),
      name: bot?.displayName ?? null,
      login: bot?.login ?? null,
      missingScopes: bot ? BOT_SCOPES.filter((sc) => !bot.tokens.scopes.includes(sc)) : BOT_SCOPES,
    },
    channels: store
      .listChannels()
      .map((c) => {
        const room = rooms.byChannelId(c.id);
        return {
          id: c.id,
          displayName: c.displayName,
          login: c.login,
          platforms: [...(c.tokens ? ['twitch' as const] : []), ...(c.kick ? ['kick' as const] : [])],
          chatListening: c.tokens ? eventsub.isListening(c.id) : false,
          overlays: room?.status().overlays ?? 0,
          fights: (room?.history ?? c.history ?? []).length,
          lastFightAt: (room?.history ?? c.history ?? [])[0]?.at ?? null,
          connectedAt: c.connectedAt,
          billing: billing.view(c.id)!,
        };
      })
      .sort((a, b) => b.connectedAt - a.connectedAt),
    founders: { used: store.foundersUsed(), total: FOUNDER_SLOTS },
  };
});

app.get('/api/health', async () => ({ ok: true, eventsub: eventsub.connected, storage: config.supabase.url && config.supabase.secret ? 'supabase' : 'arquivo', twitch: twitchConfigured() }));

/** O site (Vercel) pergunta aqui onde fica o WebSocket do jogo. */
app.get('/api/config', async () => ({ wsUrl: config.publicWsUrl || null, platforms: { twitch: twitchConfigured(), kick: kickConfigured() } }));

// ─── WebSocket do overlay ────────────────────────────────────

app.get<{ Querystring: { key?: string; client?: string } }>('/ws', { websocket: true }, (socket, req) => {
  const key = req.query.key ?? '';
  let room = rooms.byOverlayKey(key);
  if (!room) {
    const ch = store.getChannelByOverlayKey(key);
    if (ch) room = roomFor(ch);
  }
  if (!room) {
    socket.close(4004, 'overlay key inválida');
    return;
  }
  room.attach(socket, req.query.client === 'panel' ? 'panel' : 'overlay');
});

// ─── Front estático (produção) ───────────────────────────────

if (existsSync(config.webDist)) {
  await app.register(fastifyStatic, { root: config.webDist });
  // rotas do site/painel (/, /entrar, /app/...) caem no index.html do React
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws')) return reply.sendFile('index.html');
    return reply.code(404).send({ error: 'não encontrado' });
  });
}

function pickOther(current: BossConfig['skin']) {
  const options = BOSS_SKIN_IDS.filter((id) => id !== current);
  return options[Math.floor(Math.random() * options.length)];
}

/**
 * Admin da Clipei: logins em ADMIN_LOGINS. Sem a variável, em desenvolvimento
 * qualquer conta conectada vira admin (para testar); em produção, ninguém.
 */
function isAdmin(ch: StoredChannel | null) {
  if (!ch) return false;
  const admins = config.twitch.botAdmins;
  if (!admins.length) return !config.isProd;
  return admins.includes(ch.login.toLowerCase());
}

/** Explica em português por que o chat ainda não está conectado. */
function friendlyChatError(raw: string | null, connected: boolean) {
  if (!raw) return connected ? null : 'Abrindo conexão com a Twitch…';
  if (/403/.test(raw)) return 'A Twitch negou a permissão para o bot. Clique em "Conectar com Twitch" de novo e aceite as permissões.';
  if (/401/.test(raw)) return 'O login do bot expirou. A equipe da Clipei já foi avisada; tente de novo em alguns minutos.';
  if (/429/.test(raw)) return 'Muitas conexões de teste seguidas. Espere 1 minuto e recarregue.';
  return `A Twitch respondeu: ${raw.slice(0, 160)}`;
}

function clampInt(v: unknown, min: number, max: number) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : NaN;
}

// ─── Start ───────────────────────────────────────────────────

const shutdown = async () => {
  eventsub.stop();
  rooms.dispose();
  await app.close();
  await flushStore();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: '0.0.0.0' });
const proto = config.https ? 'https' : 'http';
console.log(`\n  🎮 Clipei Live Games — servidor em ${proto}://localhost:${config.port}`);
console.log(`  Painel: ${config.webUrl}`);
console.log(`  Twitch: ${twitchConfigured() ? 'configurada ✅' : 'faltando TWITCH_CLIENT_ID/SECRET no .env ⚠️'}\n`);

