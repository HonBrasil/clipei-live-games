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
  'youtube-nao-configurado': 'O YouTube ainda não está configurado no servidor (GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET).',
  'falha-youtube': 'O YouTube recusou a conexão. Confira se a conta é usuária de teste do app e se ela tem um canal no YouTube.',
};

export const SUCCESS: Record<string, string> = {
  streamer: 'Canal conectado! 🎉',
  bot: 'Conta do bot conectada! 🤖',
  youtube: 'YouTube conectado! ▶️',
  'bot-youtube': 'Bot do YouTube conectado! 🤖',
  kick: 'Kick conectada! 🟢',
};

/** "6 dias e 2 h", "5 h", "40 min": o tempo que sobra de verdade (arredondar o dia para cima parecia parado). */
export function fmtLeft(ms: number) {
  const min = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  if (d >= 1) return h ? `${d} ${d === 1 ? 'dia' : 'dias'} e ${h} h` : `${d} ${d === 1 ? 'dia' : 'dias'}`;
  if (h >= 1) return `${h} h`;
  return `${min} min`;
}
