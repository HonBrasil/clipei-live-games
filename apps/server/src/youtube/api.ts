import { config } from '../config.ts';
import type { OAuthTokens } from '../store.ts';

/**
 * YouTube Data API v3 (Google OAuth).
 *  - Streamer: youtube.readonly → achar a live ativa e ler o chat.
 *  - Bot da Clipei: youtube.force-ssl → escrever no chat (cada mensagem custa 20 de cota).
 * Cota padrão do projeto: 10.000 unidades/dia, somando todos os canais.
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/youtube/v3';

export const YT_STREAMER_SCOPES = ['https://www.googleapis.com/auth/youtube.readonly'];
export const YT_BOT_SCOPES = ['https://www.googleapis.com/auth/youtube.force-ssl'];

export const youtubeConfigured = () => Boolean(config.google.clientId && config.google.clientSecret);

export function ytAuthorizeUrl(state: string, scopes: string[]) {
  const q = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    // consent: garante o refresh_token · select_account: deixa trocar de conta (bot x streamer)
    prompt: 'consent select_account',
    include_granted_scopes: 'false',
    state,
  });
  return `${AUTH_URL}?${q}`;
}

interface GoogleToken {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<GoogleToken> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.google.clientId, client_secret: config.google.clientSecret, ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as GoogleToken & { error?: string; error_description?: string };
  if (!res.ok) throw new Error(`Google OAuth ${res.status}: ${json.error_description ?? json.error ?? 'erro'}`);
  return json;
}

const toTokens = (t: GoogleToken, prev?: OAuthTokens): OAuthTokens => ({
  accessToken: t.access_token,
  // o Google só manda refresh_token na primeira autorização
  refreshToken: t.refresh_token ?? prev?.refreshToken ?? '',
  expiresAt: Date.now() + (t.expires_in - 60) * 1000,
  scopes: t.scope ? t.scope.split(' ') : (prev?.scopes ?? []),
});

export async function ytExchangeCode(code: string) {
  return toTokens(await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: config.google.redirectUri }));
}

/** Renova se faltar menos de 1 min (o access token do Google dura 1 h). */
export async function ytEnsureFresh(tokens: OAuthTokens, save: (t: OAuthTokens) => void) {
  if (Date.now() < tokens.expiresAt) return tokens;
  if (!tokens.refreshToken) throw new Error('Login do YouTube expirou: conecte de novo');
  const next = toTokens(await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }), tokens);
  save(next);
  return next;
}

export class YoutubeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string,
  ) {
    super(message);
  }
}

async function ytApi<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } };
  if (!res.ok) {
    const reason = json.error?.errors?.[0]?.reason ?? '';
    throw new YoutubeApiError(`YouTube ${res.status}${reason ? ` (${reason})` : ''}: ${json.error?.message ?? 'erro'}`, res.status, reason);
  }
  return json as T;
}

/** Canal do dono do token (1 de cota). */
export async function ytMe(token: string) {
  const r = await ytApi<{ items?: { id: string; snippet: { title: string; customUrl?: string; thumbnails?: { default?: { url: string } } } }[] }>(
    '/channels?part=snippet&mine=true',
    token,
  );
  const c = r.items?.[0];
  if (!c) throw new Error('Essa conta do Google não tem canal no YouTube');
  return { id: c.id, title: c.snippet.title, handle: c.snippet.customUrl ?? null, avatar: c.snippet.thumbnails?.default?.url };
}

/** Live ativa do dono do token, com o id do chat (1 de cota). null = não está ao vivo. */
export async function ytActiveBroadcast(token: string) {
  const r = await ytApi<{ items?: { id: string; snippet: { title: string; liveChatId?: string } }[] }>(
    '/liveBroadcasts?part=snippet&broadcastStatus=active&broadcastType=all&maxResults=5',
    token,
  );
  const b = r.items?.find((x) => x.snippet.liveChatId);
  return b ? { videoId: b.id, title: b.snippet.title, liveChatId: b.snippet.liveChatId! } : null;
}

/** Mensagem no chat da live (20 de cota). O YouTube aceita até 200 caracteres. */
export async function ytSendChat(token: string, liveChatId: string, text: string) {
  return ytApi<{ id: string }>('/liveChat/messages?part=snippet', token, {
    method: 'POST',
    body: JSON.stringify({ snippet: { liveChatId, type: 'textMessageEvent', textMessageDetails: { messageText: text.slice(0, 200) } } }),
  });
}
