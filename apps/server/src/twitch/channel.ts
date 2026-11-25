import type { SupportEvent } from '@clipei/shared';
import { helix } from './api.ts';
import { EventSubSocket, type SubscriptionSpec } from './socket.ts';

/**
 * Eventos de apoio de UM canal (bits, subs, presentes, pontos, raids),
 * recompensa de pontos de canal e clips — tudo com o token do streamer.
 */

/** Permissões que o streamer precisa liberar (além de channel:bot, para o chat). */
export const SUPPORT_SCOPES = {
  bits: 'bits:read',
  subs: 'channel:read:subscriptions',
  points: 'channel:manage:redemptions',
  clips: 'clips:edit',
} as const;

const REWARD_TITLE = '⚡ Apoio no Minigame';
const REWARD_PROMPT = 'Vantagem no minigame da Clipei Live Games que estiver rolando: golpe no boss, escudo na corrida, curativo no battle royale e mais. Sem jogo rolando, os pontos voltam.';

export function supportSubscriptions(broadcasterId: string, scopes: string[], rewardId: string | null): SubscriptionSpec[] {
  const has = (s: string) => scopes.includes(s);
  const c = { broadcaster_user_id: broadcasterId };
  const subs: SubscriptionSpec[] = [{ type: 'channel.raid', version: '1', condition: { to_broadcaster_user_id: broadcasterId } }];
  if (has(SUPPORT_SCOPES.bits)) subs.push({ type: 'channel.cheer', version: '1', condition: c });
  if (has(SUPPORT_SCOPES.subs)) {
    subs.push({ type: 'channel.subscribe', version: '1', condition: c });
    subs.push({ type: 'channel.subscription.message', version: '1', condition: c });
    subs.push({ type: 'channel.subscription.gift', version: '1', condition: c });
  }
  if (has(SUPPORT_SCOPES.points) && rewardId) {
    subs.push({
      type: 'channel.channel_points_custom_reward_redemption.add',
      version: '1',
      condition: { ...c, reward_id: rewardId },
    });
  }
  return subs;
}

/** Converte a notificação da Twitch no formato único de apoio. */
export function toSupportEvent(type: string, e: any): SupportEvent | null {
  const user = (id?: string, name?: string, anonymous = false) =>
    anonymous || !id ? null : { id: String(id), name: String(name ?? 'alguém') };
  switch (type) {
    case 'channel.cheer':
      return { kind: 'bits', platform: 'twitch', amount: Number(e.bits) || 0, user: user(e.user_id, e.user_name, e.is_anonymous) };
    case 'channel.subscribe':
      // subs de presente chegam também como "subscription.gift" (um evento só para o pacote todo)
      if (e.is_gift) return null;
      return { kind: 'sub', platform: 'twitch', amount: 1, user: user(e.user_id, e.user_name) };
    case 'channel.subscription.message':
      return { kind: 'sub', platform: 'twitch', amount: Number(e.cumulative_months) || 1, user: user(e.user_id, e.user_name) };
    case 'channel.subscription.gift':
      return { kind: 'gift', platform: 'twitch', amount: Number(e.total) || 1, user: user(e.user_id, e.user_name, e.is_anonymous) };
    case 'channel.channel_points_custom_reward_redemption.add':
      return { kind: 'points', platform: 'twitch', amount: 1, user: user(e.user_id, e.user_name), redemptionId: e.id };
    case 'channel.raid':
      return {
        kind: 'raid',
        platform: 'twitch',
        amount: Number(e.viewers) || 0,
        user: user(e.from_broadcaster_user_id, e.from_broadcaster_user_name),
      };
    default:
      return null;
  }
}

export function createSupportSocket(opts: {
  broadcasterId: string;
  token: () => Promise<string>;
  scopes: () => string[];
  rewardId: () => string | null;
  onSupport: (e: SupportEvent) => void;
}) {
  return new EventSubSocket({
    name: `canal ${opts.broadcasterId}`,
    token: opts.token,
    subscriptions: () => supportSubscriptions(opts.broadcasterId, opts.scopes(), opts.rewardId()),
    onNotification: (type, event) => {
      const e = toSupportEvent(type, event);
      if (e) opts.onSupport(e);
    },
  });
}

// ─── Recompensa de pontos de canal ───────────────────────────

interface RewardResponse {
  data: { id: string }[];
}

/** Cria ou atualiza a recompensa. Retorna o id (ou lança erro explicando o motivo). */
export async function upsertReward(
  broadcasterId: string,
  token: string,
  rewardId: string | null,
  opts: { enabled: boolean; cost: number; paused: boolean },
) {
  const body = {
    title: REWARD_TITLE,
    prompt: REWARD_PROMPT,
    cost: opts.cost,
    is_enabled: opts.enabled,
    is_paused: opts.paused,
    background_color: '#FF1F2D',
    should_redemptions_skip_request_queue: false,
  };
  if (rewardId) {
    try {
      await helix(`/channel_points/custom_rewards?broadcaster_id=${broadcasterId}&id=${rewardId}`, token, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      return rewardId;
    } catch (err) {
      // recompensa apagada pelo streamer na Twitch: cria de novo
      if ((err as { status?: number }).status !== 404) throw friendlyRewardError(err as Error);
    }
  }
  if (!opts.enabled) return null;
  try {
    const r = await helix<RewardResponse>(`/channel_points/custom_rewards?broadcaster_id=${broadcasterId}`, token, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return r.data[0].id;
  } catch (err) {
    throw friendlyRewardError(err as Error);
  }
}

export async function setRewardPaused(broadcasterId: string, token: string, rewardId: string, paused: boolean) {
  await helix(`/channel_points/custom_rewards?broadcaster_id=${broadcasterId}&id=${rewardId}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ is_paused: paused }),
  });
}

/** Confirma o resgate (FULFILLED) ou devolve os pontos (CANCELED). */
export async function resolveRedemption(
  broadcasterId: string,
  token: string,
  rewardId: string,
  redemptionId: string,
  fulfilled: boolean,
) {
  await helix(
    `/channel_points/custom_rewards/redemptions?broadcaster_id=${broadcasterId}&reward_id=${rewardId}&id=${redemptionId}`,
    token,
    { method: 'PATCH', body: JSON.stringify({ status: fulfilled ? 'FULFILLED' : 'CANCELED' }) },
  );
}

function friendlyRewardError(err: Error & { status?: number }) {
  const msg = err.message ?? '';
  if (err.status === 403 || /partner|affiliate/i.test(msg)) {
    return new Error('Recompensas de pontos exigem canal Afiliado ou Parceiro da Twitch.');
  }
  if (/DUPLICATE_REWARD|same title/i.test(msg)) {
    return new Error('Já existe uma recompensa com esse nome no seu canal. Apague a antiga na Twitch e tente de novo.');
  }
  if (/maximum|limit/i.test(msg)) return new Error('Seu canal chegou ao limite de recompensas personalizadas.');
  return new Error('A Twitch recusou a recompensa. Tente reconectar o canal.');
}

// ─── Clip ────────────────────────────────────────────────────

export async function createClip(broadcasterId: string, token: string) {
  const r = await helix<{ data: { id: string; edit_url: string }[] }>(`/clips?broadcaster_id=${broadcasterId}`, token, {
    method: 'POST',
  });
  const id = r.data[0]?.id;
  if (!id) throw new Error('Twitch não devolveu o clip');
  return { id, url: `https://clips.twitch.tv/${id}` };
}
