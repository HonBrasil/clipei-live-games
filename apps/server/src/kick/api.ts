import { createHash, createVerify, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { config } from '../config.ts';
import type { OAuthTokens } from '../store.ts';

/**
 * API pública da Kick (https://docs.kick.com).
 *  - Login: OAuth 2.1 com PKCE em id.kick.com
 *  - API:   api.kick.com/public/v1
 *  - Eventos: webhooks assinados com RSA-SHA256 (chave pública em /public-key)
 */

const ID_URL = 'https://id.kick.com';
const API = 'https://api.kick.com/public/v1';

/**
 * Permissões pedidas ao streamer:
 *  user:read, channel:read       → nome, foto, canal e se está ao vivo
 *  chat:write                    → o bot da Clipei fala no chat dele
 *  events:subscribe              → receber chat, subs, presentes, kicks, status da live
 *  channel:rewards:read/write    → criar a recompensa "Golpe Especial" e aceitar/recusar resgates
 *  kicks:read                    → informações de Kicks
 */
export const KICK_SCOPES = [
  'user:read',
  'channel:read',
  'chat:write',
  'events:subscribe',
  'channel:rewards:read',
  'channel:rewards:write',
  'kicks:read',
];

/** Eventos que a Clipei assina para cada canal. */
export const KICK_EVENTS = [
  'chat.message.sent',
  'channel.subscription.new',
  'channel.subscription.renewal',
  'channel.subscription.gifts',
  'kicks.gifted',
  'livestream.status.updated',
  'channel.reward.redemption.updated',
];

export const kickConfigured = () => Boolean(config.kick.clientId && config.kick.clientSecret);

// ─── OAuth 2.1 + PKCE ────────────────────────────────────────

export function pkcePair() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function kickAuthorizeUrl(state: string, challenge: string) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.kick.clientId,
    redirect_uri: config.kick.redirectUri,
    scope: KICK_SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  return `${ID_URL}/oauth/authorize?${params}`;
}

interface KickTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number | string;
  scope?: string;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch(`${ID_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.kick.clientId, client_secret: config.kick.clientSecret, ...body }),
  });
  if (!res.ok) throw new Error(`Kick token ${res.status}: ${await res.text()}`);
  const r = (await res.json()) as KickTokenResponse;
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    expiresAt: Date.now() + (Number(r.expires_in) || 7200) * 1000,
    scopes: (r.scope ?? '').split(/\s+/).filter(Boolean),
  } satisfies OAuthTokens;
}

export function kickExchangeCode(code: string, verifier: string) {
  return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: config.kick.redirectUri, code_verifier: verifier });
}

/** Tokens da Kick duram ~2 h: renova se faltar menos de 5 min. Cada renovação devolve um refresh token novo. */
export async function kickEnsureFresh(tokens: OAuthTokens, onRefresh: (t: OAuthTokens) => void) {
  if (tokens.expiresAt - Date.now() > 5 * 60_000) return tokens;
  const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
  if (!fresh.scopes.length) fresh.scopes = tokens.scopes;
  onRefresh(fresh);
  return fresh;
}

// ─── Chamadas à API ──────────────────────────────────────────

export async function kickApi<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const err = new Error(`Kick ${init.method ?? 'GET'} ${path} → ${res.status}: ${await res.text()}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface KickUser {
  user_id: number;
  name: string;
  profile_picture?: string;
}

export interface KickChannel {
  broadcaster_user_id: number;
  slug: string;
  stream?: { is_live?: boolean };
}

export async function kickMe(token: string) {
  const [users, channels] = await Promise.all([
    kickApi<{ data: KickUser[] }>('/users', token),
    kickApi<{ data: KickChannel[] }>('/channels', token).catch(() => ({ data: [] as KickChannel[] })),
  ]);
  const user = users.data[0];
  if (!user) throw new Error('Kick não retornou o usuário');
  const channel = channels.data[0];
  return {
    id: String(user.user_id),
    name: user.name,
    avatar: user.profile_picture || undefined,
    slug: channel?.slug ?? user.name.toLowerCase(),
    live: Boolean(channel?.stream?.is_live),
  };
}

export async function kickIsLive(token: string) {
  const r = await kickApi<{ data: KickChannel[] }>('/channels', token);
  return Boolean(r.data[0]?.stream?.is_live);
}

/**
 * Mensagem no chat do canal do token. type "bot" usa a conta de bot do app
 * da Clipei (a conta que criou o app no painel de desenvolvedor da Kick).
 */
export async function kickSendChat(token: string, content: string) {
  return kickApi<{ data: { message_id: string; is_sent: boolean } }>('/chat', token, {
    method: 'POST',
    body: JSON.stringify({ type: 'bot', content: content.slice(0, 500) }),
  });
}

/** Garante as inscrições de eventos do canal (só cria as que faltam). */
export async function kickEnsureSubscriptions(token: string) {
  const existing = await kickApi<{ data: { event: string; version: number }[] }>('/events/subscriptions', token).catch(() => ({
    data: [] as { event: string; version: number }[],
  }));
  const have = new Set(existing.data.map((s) => s.event));
  const missing = KICK_EVENTS.filter((e) => !have.has(e));
  if (!missing.length) return { created: 0, errors: [] as string[] };
  const r = await kickApi<{ data: { name: string; error?: string }[] }>('/events/subscriptions', token, {
    method: 'POST',
    body: JSON.stringify({ method: 'webhook', events: missing.map((name) => ({ name, version: 1 })) }),
  });
  const errors = r.data.filter((d) => d.error).map((d) => `${d.name}: ${d.error}`);
  return { created: missing.length - errors.length, errors };
}

// ─── Recompensa de pontos de canal ───────────────────────────

const REWARD = {
  title: '⚡ Apoio no Minigame',
  description: 'Vantagem no minigame da Clipei Live Games que estiver rolando: golpe no boss, escudo na corrida, curativo no battle royale e mais. Sem jogo rolando, os pontos voltam.',
  background_color: '#FF1F2D',
};

export async function kickUpsertReward(token: string, rewardId: string | null, opts: { enabled: boolean; cost: number; paused: boolean }) {
  if (rewardId) {
    try {
      await kickApi(`/channels/rewards/${rewardId}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ ...REWARD, cost: opts.cost, is_enabled: opts.enabled, is_paused: opts.paused }),
      });
      return rewardId;
    } catch (err) {
      if ((err as { status?: number }).status !== 404) throw err;
    }
  }
  if (!opts.enabled) return null;
  const r = await kickApi<{ data: { id: string } }>('/channels/rewards', token, {
    method: 'POST',
    body: JSON.stringify({ ...REWARD, cost: opts.cost, is_enabled: true, should_redemptions_skip_request_queue: false }),
  });
  if (opts.paused) await kickSetRewardPaused(token, r.data.id, true).catch(() => {});
  return r.data.id;
}

export function kickSetRewardPaused(token: string, rewardId: string, paused: boolean) {
  return kickApi(`/channels/rewards/${rewardId}`, token, { method: 'PATCH', body: JSON.stringify({ is_paused: paused }) });
}

/** Aceita (true) ou recusa/reembolsa (false) um resgate pendente. */
export function kickResolveRedemption(token: string, redemptionId: string, accept: boolean) {
  return kickApi(`/channels/rewards/redemptions/${accept ? 'accept' : 'reject'}`, token, {
    method: 'POST',
    body: JSON.stringify({ ids: [redemptionId] }),
  });
}

// ─── Assinatura dos webhooks ─────────────────────────────────

let publicKey: string | null = null;

export async function kickPublicKey(force = false) {
  // testes locais: KICK_TEST_PUBLIC_KEY aponta para um .pem próprio (nunca em produção)
  if (process.env.KICK_TEST_PUBLIC_KEY && !config.isProd) return readFileSync(process.env.KICK_TEST_PUBLIC_KEY, 'utf8');
  if (publicKey && !force) return publicKey;
  const res = await fetch(`${API}/public-key`);
  if (!res.ok) throw new Error(`Kick public-key ${res.status}`);
  const r = (await res.json()) as { data: { public_key: string } };
  publicKey = r.data.public_key;
  return publicKey;
}

/** Só para testes: usar uma chave própria no lugar da chave da Kick. */
export function setKickPublicKeyForTests(pem: string) {
  publicKey = pem;
}

/**
 * Verifica Kick-Event-Signature: RSA PKCS#1 v1.5 + SHA-256 sobre
 * "<Kick-Event-Message-Id>.<Kick-Event-Message-Timestamp>.<corpo cru>".
 * Se falhar, busca a chave de novo uma vez (a Kick pode trocar a chave).
 */
export async function verifyKickSignature(messageId: string, timestamp: string, rawBody: string, signatureB64: string) {
  const payload = `${messageId}.${timestamp}.${rawBody}`;
  const check = (pem: string) => {
    try {
      return createVerify('RSA-SHA256').update(payload).verify(pem, Buffer.from(signatureB64, 'base64'));
    } catch {
      return false;
    }
  };
  if (check(await kickPublicKey())) return true;
  try {
    return check(await kickPublicKey(true));
  } catch {
    return false;
  }
}
