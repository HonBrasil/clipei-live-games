import type { ChatEvent, SupportEvent } from '@clipei/shared';

/**
 * Converte os webhooks da Kick para os formatos únicos da Clipei.
 * Os jogos nunca veem o formato da Kick.
 */

interface KickUserRef {
  user_id?: number | null;
  username?: string | null;
  is_anonymous?: boolean;
  identity?: { username_color?: string; badges?: { type: string }[] } | null;
}

export type KickMapped =
  | { kind: 'chat'; broadcasterId: string; event: ChatEvent }
  | { kind: 'support'; broadcasterId: string; event: SupportEvent }
  | { kind: 'redemption'; broadcasterId: string; rewardId: string; status: string; event: SupportEvent }
  | { kind: 'live'; broadcasterId: string; live: boolean };

const user = (u?: KickUserRef | null) =>
  u && !u.is_anonymous && u.user_id ? { id: String(u.user_id), name: String(u.username ?? 'alguém'), color: u.identity?.username_color } : null;

export function mapKickEvent(type: string, p: any): KickMapped | null {
  const broadcasterId = String(p?.broadcaster?.user_id ?? '');
  if (!broadcasterId) return null;

  switch (type) {
    case 'chat.message.sent': {
      const s: KickUserRef = p.sender ?? {};
      const badges = new Set((s.identity?.badges ?? []).map((b) => b.type));
      const isBroadcaster = String(s.user_id) === broadcasterId || badges.has('broadcaster');
      return {
        kind: 'chat',
        broadcasterId,
        event: {
          id: String(p.message_id ?? Math.random()),
          platform: 'kick',
          channelId: broadcasterId,
          text: String(p.content ?? ''),
          ts: Date.now(),
          user: {
            id: String(s.user_id ?? 'anon'),
            login: String(s.username ?? '').toLowerCase(),
            displayName: String(s.username ?? 'alguém'),
            color: s.identity?.username_color || undefined,
            isSub: badges.has('subscriber') || badges.has('founder') || badges.has('og'),
            isMod: badges.has('moderator'),
            isVip: badges.has('vip'),
            isBroadcaster,
          },
        },
      };
    }
    case 'channel.subscription.new':
      return { kind: 'support', broadcasterId, event: { kind: 'sub', platform: 'kick', amount: 1, user: user(p.subscriber) } };
    case 'channel.subscription.renewal':
      return {
        kind: 'support',
        broadcasterId,
        event: { kind: 'sub', platform: 'kick', amount: Number(p.duration) || 1, user: user(p.subscriber) },
      };
    case 'channel.subscription.gifts':
      return {
        kind: 'support',
        broadcasterId,
        event: { kind: 'gift', platform: 'kick', amount: Array.isArray(p.giftees) ? p.giftees.length || 1 : 1, user: user(p.gifter) },
      };
    case 'kicks.gifted':
      return {
        kind: 'support',
        broadcasterId,
        event: { kind: 'bits', unit: 'kicks', platform: 'kick', amount: Number(p.gift?.amount) || 0, user: user(p.sender) },
      };
    case 'channel.reward.redemption.updated':
      return {
        kind: 'redemption',
        broadcasterId,
        rewardId: String(p.reward?.id ?? ''),
        status: String(p.status ?? ''),
        event: { kind: 'points', platform: 'kick', amount: 1, user: user(p.redeemer), redemptionId: String(p.id ?? '') },
      };
    case 'livestream.status.updated':
      return { kind: 'live', broadcasterId, live: Boolean(p.is_live) };
    default:
      return null;
  }
}
