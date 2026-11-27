import { describe, expect, it } from 'vitest';
import { normalizeChallengeConfig, type ChatEvent, type SupportEvent } from '@clipei/shared';
import { ChallengeGame, parseChallengeChatCommand } from './challenge.ts';

const chat = (id: string, text: string, extra: Partial<ChatEvent['user']> = {}) =>
  ({ platform: 'twitch', text, user: { id, displayName: id, isSub: false, isMod: false, isVip: false, isBroadcaster: false, ...extra } }) as unknown as ChatEvent;

describe('Desafios do Chat', () => {
  const cfg = normalizeChallengeConfig({
    list: [
      { id: 'a', text: 'Jogar só de faca', minutes: 5, enabled: true },
      { id: 'b', text: 'Falar fino', minutes: 0, enabled: true },
      { id: 'c', text: 'Sem mira', minutes: 3, enabled: true },
      { id: 'x', text: 'Desligado', minutes: 3, enabled: false },
    ],
    options: 3,
    voteSec: 30,
  });

  it('lista personalizada: limpa textos, respeita limites e começa com exemplos', () => {
    const c = normalizeChallengeConfig({ list: [{ id: '1', text: '   dançar   funk  ', minutes: 999, enabled: true }, { id: '2', text: '', minutes: 1, enabled: true }] as never });
    expect(c.list).toEqual([{ id: '1', text: 'dançar funk', minutes: 120, enabled: true }]);
    expect(normalizeChallengeConfig(undefined).list.length).toBeGreaterThan(5);
  });

  it('votação com troca de voto, voto turbinado, empate e desafio com tempo', () => {
    const g = new ChallengeGame(() => 0);
    expect(g.openVote(cfg, null, 0)).toBeNull();
    expect(g.options.map((o) => o.item.id)).not.toContain('x');
    g.handle(chat('ana', '!1'), cfg, 1000);
    g.handle(chat('ana', '!2'), cfg, 1000); // troca o voto
    g.handle(chat('bia', '!2'), cfg, 1000);
    expect(g.snapshot().options.map((o) => o.votes)).toEqual([0, 2, 0]);
    // pontos: o voto de quem já votou passa a valer 2
    g.special({ kind: 'points', amount: 1, platform: 'twitch', user: { id: 'caio', name: 'caio', color: '#fff' } } as SupportEvent, 2000);
    g.handle(chat('caio', '!3'), cfg, 2000);
    expect(g.snapshot().options[2]!.votes).toBe(2);
    g.update(30_000);
    expect(g.status).toBe('active');
    const cur = g.snapshot(30_000).current!;
    expect([g.options[1]!.item.text, g.options[2]!.item.text]).toContain(cur.text);
    expect(cur.votes).toBe(2);
  });

  it('desafio sem tempo só termina quando o streamer marca; histórico e raid', () => {
    const g = new ChallengeGame(() => 0);
    g.startDirect(cfg.list[1]!, 0);
    expect(g.endsAt).toBeNull();
    g.update(10 * 60_000);
    expect(g.status).toBe('active');
    expect(g.finish('done', 11 * 60_000)).toBe(true);
    expect(g.finished).toMatchObject({ text: 'Falar fino', result: 'done' });
    g.update(11 * 60_000 + 9000);
    expect(g.status).toBe('idle');
    // com tempo: raid soma minutos e o tempo acaba sozinho
    g.startDirect(cfg.list[0]!, 0);
    expect(g.special({ kind: 'raid', amount: 30, platform: 'twitch', user: null } as SupportEvent, 1000).effect).toContain('+2 min');
    g.update(5 * 60_000 + 1);
    expect(g.status).toBe('active');
    g.update(7 * 60_000);
    expect(g.result).toBe('timeout');
  });

  it('sugestões: só subs (ou quem deu sub agora) e comandos de mod', () => {
    const g = new ChallengeGame();
    expect(g.handle(chat('ana', '!sugerir dançar a música do chat'), cfg)).toEqual({ type: 'none' });
    expect(g.handle(chat('bia', '!sugerir dançar a música do chat', { isSub: true }), cfg)).toEqual({ type: 'suggest', text: 'dançar a música do chat', name: 'bia' });
    g.special({ kind: 'sub', amount: 1, platform: 'twitch', user: { id: 'ana', name: 'ana', color: '#fff' } } as SupportEvent);
    expect(g.handle(chat('ana', '!sugerir falar em inglês'), cfg)).toMatchObject({ type: 'suggest' });
    expect(g.handle(chat('ana', '!sugerir oi'), cfg)).toEqual({ type: 'none' });
    expect(parseChallengeChatCommand(chat('m', '!desafio votar', { isMod: true }))).toEqual({ type: 'vote' });
    expect(parseChallengeChatCommand(chat('m', '!desafio cumprido', { isMod: true }))).toEqual({ type: 'done' });
    expect(parseChallengeChatCommand(chat('x', '!desafio votar'))).toBeNull();
    expect(new ChallengeGame().openVote(normalizeChallengeConfig({ list: [{ id: 'a', text: 'só um', minutes: 1, enabled: true }] }), null)).toContain('pelo menos 2');
  });
});
