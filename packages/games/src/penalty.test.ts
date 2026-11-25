import { describe, expect, it } from 'vitest';
import { normalizeGameSupport, type ChatEvent, type SupportEvent } from '@clipei/shared';
import { PenaltyGame, parsePenaltyChatCommand } from './penalty.ts';

function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const chat = (id: string, text: string, mod = false): ChatEvent => ({
  id: `m-${Math.random()}`,
  platform: 'simulator',
  channelId: 'c',
  text,
  ts: 0,
  user: { id, login: id, displayName: id, isSub: false, isMod: mod, isVip: false, isBroadcaster: false },
});
const T0 = 1_000_000;

function lobby(seed = 1, cfg = {}) {
  const g = new PenaltyGame({ joinSec: 30, voteSec: 10, ...cfg }, seeded(seed));
  g.open(T0);
  return g;
}

/** Roda até acabar, votando por cada fase. */
function playOut(g: PenaltyGame, from: number, onVote?: (now: number) => void) {
  let now = from;
  let guard = 0;
  while (g.status !== 'finished' && g.status !== 'stopped' && guard++ < 5000) {
    if (g.status === 'vote') onVote?.(now);
    g.update((now += 500));
  }
  return now;
}

describe('Disputa de Pênaltis', () => {
  it('escolha de times: !a / !b / !entrar no menor, sem trocar depois', () => {
    const g = lobby();
    g.handle(chat('ana', '!a'));
    g.handle(chat('bia', '!b'));
    g.handle(chat('caio', '!entrar'));
    g.handle(chat('ana', '!b'));
    const s = g.snapshot(T0);
    expect(s.teams[0].players).toBe(2);
    expect(s.teams[1].players).toBe(1);
    expect(s.events.filter((e) => e.kind === 'join')).toHaveLength(3);
  });

  it('ninguém entrou: cancela; um time vazio vira CPU', () => {
    const g = lobby();
    g.update(T0 + 30_000);
    expect(g.status).toBe('stopped');
    const h = lobby();
    h.handle(chat('ana', '!a'));
    h.update(T0 + 30_000);
    expect(h.status).toBe('vote');
    expect(h.snapshot(T0, true).teams[1].players).toBe(3);
  });

  it('partidas sempre terminam com vencedor, 5 cobranças ou morte súbita', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = lobby(seed);
      g.handle(chat('ana', '!a'));
      g.handle(chat('bia', '!b'));
      g.update(T0 + 30_000);
      playOut(g, T0 + 30_000, () => {
        g.handle(chat('ana', ['!esq', '!meio', '!dir'][seed % 3]));
        g.handle(chat('bia', ['!dir', '!esq', '!meio'][seed % 3]));
      });
      expect(g.status).toBe('finished');
      const s = g.snapshot(T0, true);
      expect(s.winner).not.toBeNull();
      const [a, b] = [s.teams[0], s.teams[1]];
      // empate só se a morte súbita bateu o limite (aí decide no cara ou coroa)
      if (a.marks.length < 15) expect(a.score).not.toBe(b.score);
      // decisão antecipada ou morte súbita pareada
      if (a.marks.length > 5 || b.marks.length > 5) expect(a.marks.length).toBe(b.marks.length);
    }
  });

  it('maioria decide e o voto só aparece na revelação', () => {
    const g = lobby(3);
    for (const n of ['a1', 'a2', 'a3']) g.handle(chat(n, '!a'));
    for (const n of ['b1', 'b2']) g.handle(chat(n, '!b'));
    g.update(T0 + 30_000);
    const kt = g.snapshot(T0, true).kicking;
    const kickers = kt === 0 ? ['a1', 'a2', 'a3'] : ['b1', 'b2'];
    const keepers = kt === 0 ? ['b1', 'b2'] : ['a1', 'a2', 'a3'];
    for (const n of kickers) g.handle(chat(n, '!dir'));
    for (const n of keepers) g.handle(chat(n, '!esq'));
    const voting = g.snapshot(T0, true);
    expect(voting.reveal).toBeNull();
    expect(voting.votes).toEqual({ kick: kickers.length, keep: keepers.length });
    g.update(T0 + 30_000 + 10_000);
    const r = g.snapshot(T0, true).reveal!;
    expect(r.corner).toBe(2);
    expect(r.dive).toBe(0);
    expect(r.outcome).not.toBe('save'); // pulou pro outro lado
  });

  it('quem não tem time entra no menor ao votar', () => {
    const g = lobby();
    g.handle(chat('ana', '!a'));
    g.update(T0 + 30_000);
    expect(g.vote('twitch:novo', 'novo', undefined, 1)).toBe(true);
    expect(g.snapshot(T0, true).teams[0].players).toBe(2); // o time da ana tinha 1, a CPU tinha 3
  });

  it('apoios: bits = chute colocado, sub = paredão, pontos = voto de capitão, raid = time que perde', () => {
    const g = lobby(5);
    g.join('twitch:ana', 'ana', undefined, 0);
    g.join('twitch:bia', 'bia', undefined, 1);
    g.support = normalizeGameSupport('penalty', undefined, { points: { p: { weight: 5 } } });
    const ev = (kind: SupportEvent['kind'], id: string): SupportEvent => ({ kind, amount: 100, platform: 'twitch', user: { id, name: id } });
    expect(g.special(ev('bits', 'ana'), T0).effect).toContain('CHUTE COLOCADO');
    expect(g.special(ev('bits', 'ana'), T0).applied).toBe(false); // já tem
    expect(g.special(ev('sub', 'bia'), T0).effect).toContain('PAREDÃO');
    expect(g.special(ev('points', 'ana'), T0).effect).toContain('vale 5');
    expect(g.special({ kind: 'raid', amount: 10, platform: 'twitch', user: null }, T0).applied).toBe(false); // ainda na escolha de times
    const s = g.snapshot(T0, true);
    expect(s.teams[0].placed).toBe(true);
    expect(s.teams[1].wall).toBe(true);
    g.update(T0 + 30_000);
    expect(g.special({ kind: 'raid', amount: 10, platform: 'twitch', user: null }, T0 + 31_000).applied).toBe(true);
  });

  it('chat dos mods', () => {
    expect(parsePenaltyChatCommand(chat('m', '!penaltis iniciar', true))).toEqual({ type: 'start' });
    expect(parsePenaltyChatCommand(chat('m', '!pênaltis parar', true))).toEqual({ type: 'stop' }); // acento é aceito
    expect(parsePenaltyChatCommand(chat('v', '!penaltis iniciar'))).toBeNull();
    expect(parsePenaltyChatCommand(chat('v', '!penaltis ajuda'))).toEqual({ type: 'help' });
  });
});
