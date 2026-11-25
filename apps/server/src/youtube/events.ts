import type { ChatEvent, SupportEvent } from '@clipei/shared';
import type { YtChatItem } from './chat.ts';

/**
 * Converte o chat do YouTube para os formatos únicos da Clipei. Os jogos nunca veem o YouTube.
 *  - Super Chat / Super Sticker → "bits" pelo valor (1 bit ≈ US$ 0,01, conversão aproximada)
 *  - membro novo / marco de meses → "sub" · presentes de assinatura → "gift"
 */

/** Quanto vale 1 unidade da moeda em dólar (aproximado; só para dar peso ao apoio). */
const USD: Record<string, number> = {
  USD: 1, BRL: 0.18, EUR: 1.08, GBP: 1.27, ARS: 0.001, MXN: 0.055, CLP: 0.0011, COP: 0.00025, PEN: 0.27, UYU: 0.025,
  CAD: 0.73, AUD: 0.66, JPY: 0.0067, KRW: 0.00073, INR: 0.012, PHP: 0.017, IDR: 0.000063, TRY: 0.03, PLN: 0.25, CHF: 1.13,
};

export function bitsFromMoney(micros: number, currency: string) {
  const value = micros / 1_000_000;
  return Math.max(1, Math.round(value * (USD[currency?.toUpperCase()] ?? 0.18) * 100));
}

export type YtMapped = { kind: 'chat'; event: ChatEvent } | { kind: 'support'; event: SupportEvent } | null;

export function mapYoutubeItem(item: YtChatItem, channelId: string): YtMapped {
  const s = item.snippet;
  const a = item.authorDetails;
  if (!s || !a) return null;
  const user = { id: a.channelId, name: a.displayName };
  switch (s.type) {
    case 'TEXT_MESSAGE_EVENT':
      return {
        kind: 'chat',
        event: {
          id: item.id,
          platform: 'youtube',
          channelId,
          text: s.textMessageDetails?.messageText ?? s.displayMessage ?? '',
          ts: Date.now(),
          user: {
            id: a.channelId,
            login: a.displayName.replace(/^@/, '').toLowerCase(),
            displayName: a.displayName.replace(/^@/, ''),
            isSub: a.isChatSponsor,
            isMod: a.isChatModerator,
            isVip: false,
            isBroadcaster: a.isChatOwner,
          },
        },
      };
    case 'SUPER_CHAT_EVENT':
    case 'SUPER_STICKER_EVENT': {
      const d = s.superChatDetails ?? s.superStickerDetails;
      if (!d) return null;
      const what = s.type === 'SUPER_CHAT_EVENT' ? 'Super Chat' : 'Super Sticker';
      return {
        kind: 'support',
        event: { kind: 'bits', platform: 'youtube', amount: bitsFromMoney(d.amountMicros, d.currency), user, label: `${what} de ${d.amountDisplayString}` },
      };
    }
    case 'NEW_SPONSOR_EVENT':
      return { kind: 'support', event: { kind: 'sub', platform: 'youtube', amount: 1, user, label: 'virou membro' } };
    case 'MEMBER_MILESTONE_CHAT_EVENT':
      return {
        kind: 'support',
        event: { kind: 'sub', platform: 'youtube', amount: s.memberMilestoneChatDetails?.memberMonth || 1, user, label: 'renovou como membro' },
      };
    case 'MEMBERSHIP_GIFTING_EVENT':
      return {
        kind: 'support',
        event: { kind: 'gift', platform: 'youtube', amount: s.membershipGiftingDetails?.giftMembershipsCount || 1, user },
      };
    default:
      return null;
  }
}
