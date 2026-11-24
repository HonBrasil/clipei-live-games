import { config } from '../config.ts';
import type { OAuthTokens } from '../store.ts';

const ID_URL = 'https://id.twitch.tv/oauth2';
const HELIX = 'https://api.twitch.tv/helix';

/**
 * Escopos pedidos ao streamer:
 *  channel:bot                 → o bot da Clipei lê e fala no chat dele
 *  bits:read                   → bits viram dano
 *  channel:read:subscriptions  → subs e subs de presente viram dano
 *  channel:manage:redemptions  → criar/pausar a recompensa de pontos e devolver pontos
 *  clips:edit                  → clip automático da vitória
 */
export const STREAMER_SCOPES = ['channel:bot', 'bits:read', 'channel:read:subscriptions', 'channel:manage:redemptions', 'clips:edit'];
/** Escopos pedidos à conta do bot. */
export const BOT_SCOPES = ['user:read:chat', 'user:write:chat', 'user:bot'];

export function authorizeUrl(scopes: string[], state: string, forceVerify = false) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.twitch.clientId,
    redirect_uri: config.twitch.redirectUri,
    scope: scopes.join(' '),
    state,
  });
  if (forceVerify) params.set('force_verify', 'true');
  return `${ID_URL}/authorize?${params}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string[];
}

function toTokens(r: TokenResponse): OAuthTokens {
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    expiresAt: Date.now() + r.expires_in * 1000,
    scopes: r.scope ?? [],
  };
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch(`${ID_URL}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.twitch.clientId,
      client_secret: config.twitch.clientSecret,
      ...body,
    }),
  });
  if (!res.ok) throw new Error(`Twitch token ${res.status}: ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}

export async function exchangeCode(code: string) {
  return toTokens(
    await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: config.twitch.redirectUri }),
  );
}

export async function refreshTokens(tokens: OAuthTokens) {
  return toTokens(await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }));
}

/** Garante um token válido, renovando se faltar menos de 2 min para expirar. */
export async function ensureFresh(tokens: OAuthTokens, onRefresh: (t: OAuthTokens) => void) {
  if (tokens.expiresAt - Date.now() > 120_000) return tokens;
  const fresh = await refreshTokens(tokens);
  onRefresh(fresh);
  return fresh;
}

// ─── App Access Token (client credentials) ───────────────────
// Mensagens enviadas com ele ganham o selo de Chat Bot.
let appToken: { token: string; expiresAt: number } | null = null;

export async function getAppToken() {
  if (appToken && appToken.expiresAt - Date.now() > 300_000) return appToken.token;
  const r = await tokenRequest({ grant_type: 'client_credentials' });
  appToken = { token: r.access_token, expiresAt: Date.now() + r.expires_in * 1000 };
  return appToken.token;
}

export async function helix<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${HELIX}${path}`, {
    ...init,
    headers: {
      'Client-Id': config.twitch.clientId,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = new Error(`Helix ${init.method ?? 'GET'} ${path} → ${res.status}: ${await res.text()}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
}

export async function getMe(userToken: string) {
  const r = await helix<{ data: TwitchUser[] }>('/users', userToken);
  const me = r.data[0];
  if (!me) throw new Error('Twitch não retornou o usuário');
  return me;
}

/**
 * Envia mensagem no chat como o bot.
 * Tenta primeiro com App Token (selo de Chat Bot); se falhar, usa o token do bot.
 */
export async function sendChatMessage(
  broadcasterId: string,
  botId: string,
  message: string,
  botUserToken: () => Promise<string>,
) {
  const body = JSON.stringify({ broadcaster_id: broadcasterId, sender_id: botId, message: message.slice(0, 500) });
  try {
    const token = await getAppToken();
    await helix('/chat/messages', token, { method: 'POST', body });
  } catch (err) {
    console.warn('[twitch] envio com app token falhou, tentando com token do bot:', (err as Error).message);
    await helix('/chat/messages', await botUserToken(), { method: 'POST', body });
  }
}
