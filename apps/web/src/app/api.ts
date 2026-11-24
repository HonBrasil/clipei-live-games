import type { BossConfig, BossSnapshot } from '@clipei/shared';

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Erro ${res.status}`);
  return data as T;
}

export interface BossInfo {
  state: BossSnapshot | null;
  config: BossConfig;
  hpMode: 'auto' | 'fixed';
}

export const nf = new Intl.NumberFormat('pt-BR');

export function fmtDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m}min ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

export function fmtCountdown(ms: number) {
  const left = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}min` : `${m}:${String(s).padStart(2, '0')}`;
}

export const ERRORS: Record<string, string> = {
  'twitch-nao-configurada': 'Preencha TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET no arquivo .env e reinicie o servidor.',
  'kick-nao-configurada': 'Preencha KICK_CLIENT_ID e KICK_CLIENT_SECRET no arquivo .env e reinicie o servidor.',
  'autorizacao-cancelada': 'A autorização foi cancelada.',
  'sessao-expirada': 'A sessão de login expirou. Tente conectar de novo.',
  'estado-invalido': 'Não foi possível validar o retorno do login. Tente de novo.',
  'falha-twitch': 'A Twitch recusou a conexão. Confira se a URL de redirecionamento no console é igual à do .env.',
  'falha-kick': 'A Kick recusou a conexão. Confira a URL de redirecionamento do app da Kick.',
  'sem-permissao-bot': 'Só administradores da Clipei podem conectar a conta do bot.',
};

export const SUCCESS: Record<string, string> = {
  streamer: 'Canal conectado! 🎉',
  bot: 'Conta do bot conectada! 🤖',
  kick: 'Kick conectada! 🟢',
};
