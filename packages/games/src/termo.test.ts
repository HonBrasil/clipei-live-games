import { describe, expect, it } from 'vitest';
import type { ChatEvent, SupportEvent } from '@clipei/shared';
import { TERMO_ANSWERS } from './termo-words.ts';
import { isTermoWord, parseTermoChatCommand, TermoGame, termoMarks, termoNormalize, type TermoSave } from './termo.ts';

const chat = (id: string, text: string, mod = false) =>
  ({ platform: 'twitch', text, user: { id, displayName: id, color: '#ff0000', isMod: mod, isBroadcaster: false } }) as unknown as ChatEvent;

describe('Termo do Chat', () => {
  it('cores com letras repetidas, acentos e dicionário', () => {
    expect(termoMarks('sorte', 'sorte').join('')).toBe('ggggg');
    expect(termoMarks('arara', 'carro').join('')).toBe('yybgb');
    expect(termoMarks('ossos', 'sorte').join('')).toBe('yybbb');
    expect(termoNormalize('Avião!')).toBe('aviao');
    expect(isTermoWord('casal')).toBe(true);
    expect(isTermoWord('xqzwk')).toBe(false);
    expect(TERMO_ANSWERS.every(isTermoWord)).toBe(true);
    expect(TERMO_ANSWERS.length).toBeGreaterThan(300);
  });

  it('chutes, pontos por letra nova, espera entre chutes e vitória', () => {
    let saved: TermoSave | null = null;
    const g = new TermoGame({ rounds: 2, roundSec: 120, cooldownSec: 5 }, null, (s) => (saved = s), () => 0);
    g.start(0);
    const answer = g.answer;
    expect(answer).toBe(TERMO_ANSWERS[0]);
    const wrong = TERMO_ANSWERS.find((w) => w !== answer && termoMarks(w, answer).includes('g'))!;
    expect(g.handle(chat('ana', `!t ${wrong}`), 1000)).toMatchObject({ type: 'guess', win: false });
    // mesma pessoa antes da espera: ignorado
    expect(g.handle(chat('ana', `!t ${answer}`), 2000)).toEqual({ type: 'none' });
    // palavra que não existe
    expect(g.handle(chat('bia', '!t xqzwk'), 2000)).toEqual({ type: 'invalid' });
    const s1 = g.snapshot(2000);
    expect(s1.guesses).toHaveLength(1);
    expect(s1.fx.some((f) => f.kind === 'invalid')).toBe(true);
    expect(s1.known.some(Boolean)).toBe(true);
    expect(s1.solution).toBeNull();
    expect(g.handle(chat('bia', `!termo ${answer.toUpperCase()}`), 8000)).toMatchObject({ type: 'guess', win: true });
    const s2 = g.snapshot(8000);
    expect(s2.status).toBe('between');
    expect(s2.winner?.name).toBe('bia');
    expect(s2.winner!.points).toBeGreaterThan(100);
    expect(s2.solution).toBeTruthy();
    // próxima palavra, sem repetir; depois acaba por tempo
    g.update(8000 + 7000);
    expect(g.status).toBe('playing');
    expect(g.answer).not.toBe(answer);
    g.update(8000 + 7000 + 120_000);
    expect(g.status).toBe('between');
    g.update(8000 + 7000 + 120_000 + 7000);
    expect(g.status).toBe('finished');
    expect(g.scores()[0]!.name).toBe('bia');
    expect(saved!.players['twitch:bia']!.wins).toBe(1);
  });

  it('dicas automáticas, apoios e comandos de mod', () => {
    const g = new TermoGame({ rounds: 1, roundSec: 100, hints: true }, null, null, () => 0);
    g.start(0);
    g.update(50_000);
    expect(g.snapshot(50_000).hinted.filter(Boolean)).toHaveLength(1);
    g.update(75_000);
    expect(g.snapshot(75_000).hinted.filter(Boolean)).toHaveLength(2);
    const user = { id: 'ana', name: 'ana', color: '#fff' };
    expect(g.special({ kind: 'bits', amount: 100, platform: 'twitch', user } as SupportEvent, 76_000).effect).toContain('DICA');
    expect(g.special({ kind: 'raid', amount: 20, platform: 'twitch', user: null } as SupportEvent, 76_000).effect).toContain('+60 s');
    // nunca revela a palavra inteira
    for (let i = 0; i < 5; i++) g.special({ kind: 'points', amount: 1, platform: 'twitch', user } as SupportEvent, 76_000);
    expect(g.snapshot(76_000).known.filter(Boolean).length).toBe(4);
    expect(g.special({ kind: 'sub', amount: 1, platform: 'twitch', user } as SupportEvent, 76_000).effect).toContain('SEM ESPERA');
    expect(parseTermoChatCommand(chat('m', '!termo iniciar', true))).toEqual({ type: 'start' });
    expect(parseTermoChatCommand(chat('m', '!termo pular', true))).toEqual({ type: 'skip' });
    expect(parseTermoChatCommand(chat('x', '!termo'))).toEqual({ type: 'help' });
    expect(parseTermoChatCommand(chat('m', '!termo casal', true))).toBeNull();
  });
});
