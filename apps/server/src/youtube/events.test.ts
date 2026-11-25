import { describe, expect, it } from 'vitest';
import { bitsFromMoney, mapYoutubeItem } from './events.ts';
import type { YtChatItem } from './chat.ts';

const author = { channelId: 'UCfa', displayName: '@Fã', isChatOwner: false, isChatSponsor: true, isChatModerator: false, isVerified: false };
const base = (snippet: Partial<YtChatItem['snippet']>): YtChatItem => ({
  id: 'm1',
  snippet: { type: 'TEXT_MESSAGE_EVENT', publishedAt: '', displayMessage: '', liveChatId: 'c', authorChannelId: 'UCfa', ...snippet },
  authorDetails: author,
});

describe('YouTube → Clipei', () => {
  it('mensagem vira ChatEvent com nome sem @ e membro como sub', () => {
    const m = mapYoutubeItem(base({ textMessageDetails: { messageText: '!atk' } }), 'UCdono');
    expect(m?.kind).toBe('chat');
    if (m?.kind !== 'chat') return;
    expect(m.event).toMatchObject({ platform: 'youtube', channelId: 'UCdono', text: '!atk' });
    expect(m.event.user).toMatchObject({ id: 'UCfa', displayName: 'Fã', isSub: true });
  });

  it('Super Chat vira bits pelo valor, com o texto do valor', () => {
    const m = mapYoutubeItem(
      base({ type: 'SUPER_CHAT_EVENT', superChatDetails: { amountMicros: 10_000_000, currency: 'BRL', amountDisplayString: 'R$ 10,00', userComment: '' } }),
      'UCdono',
    );
    expect(m?.kind).toBe('support');
    if (m?.kind !== 'support') return;
    expect(m.event).toMatchObject({ kind: 'bits', amount: 180, label: 'Super Chat de R$ 10,00' });
    expect(bitsFromMoney(5_000_000, 'USD')).toBe(500);
  });

  it('membros: novo = sub, marco = sub com meses, presentes = gift', () => {
    expect(mapYoutubeItem(base({ type: 'NEW_SPONSOR_EVENT', newSponsorDetails: { memberLevelName: 'x', isUpgrade: false } }), 'U')).toMatchObject({ event: { kind: 'sub', amount: 1 } });
    expect(mapYoutubeItem(base({ type: 'MEMBER_MILESTONE_CHAT_EVENT', memberMilestoneChatDetails: { memberLevelName: 'x', memberMonth: 6 } }), 'U')).toMatchObject({ event: { kind: 'sub', amount: 6 } });
    expect(mapYoutubeItem(base({ type: 'MEMBERSHIP_GIFTING_EVENT', membershipGiftingDetails: { giftMembershipsCount: 5 } }), 'U')).toMatchObject({ event: { kind: 'gift', amount: 5 } });
    expect(mapYoutubeItem(base({ type: 'TOMBSTONE' }), 'U')).toBeNull();
  });
});
