import { describe, expect, it } from 'vitest';
import { ROYALE_FLAG, type ChatEvent } from '@clipei/shared';
import { parseRoyaleChatCommand, regionFrom, ROYALE_DROP_MS, RoyaleGame } from './royale.ts';

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

function play(g: RoyaleGame, from: number, until: (g: RoyaleGame) => boolean, max = 400_000) {
  let now = from;
  while (!until(g) && now - from < max) g.update((now += 100));
  return now;
}

describe('Battle Royale', () => {
  it('embarque: !entrar e !cair escolhem região; CPU completa até 10', () => {
    const g = new RoyaleGame({ joinSec: 30 }, seeded());
    g.open(T0);
    g.handle(chat('ana', '!cair cidade'), T0);
    g.handle(chat('bia', '!entrar'), T0);
    g.handle(chat('bia', '!cair porto'), T0);
    const s = g.snapshot(T0);
    expect(s.regions.cidade).toBe(1);
    expect(s.roster?.find((r) => r.name === 'bia')?.region).toBe('porto');
    g.update(T0 + 30_000);
    expect(g.status).toBe('drop');
    expect(g.size).toBe(10);
    expect(regionFrom('Fazênda')).toBe('fazenda');
  });

  it('ninguém entrou: cancela', () => {
    const g = new RoyaleGame({ joinSec: 15 }, seeded());
    g.open(T0);
    g.update(T0 + 15_000);
    expect(g.status).toBe('stopped');
  });

  it('partida completa termina com um vencedor em poucos minutos', () => {
    for (const n of [3, 40, 100]) {
      const g = new RoyaleGame({ joinSec: 15, maxPlayers: 100 }, seeded(n));
      g.open(T0);
      for (let i = 0; i < n; i++) g.join(`p${i}`, `p${i}`, undefined, null);
      g.update(T0 + 15_000);
      const start = T0 + 15_000 + ROYALE_DROP_MS;
      const end = play(g, T0 + 15_000, (x) => x.status === 'finished');
      expect(g.status).toBe('finished');
      expect(g.winner).not.toBeNull();
      const secs = (end - start) / 1000;
      expect(secs).toBeGreaterThan(30);
      expect(secs).toBeLessThan(300);
      const s = g.snapshot(end);
      expect(s.players.filter((p) => p[6] & ROYALE_FLAG.alive)).toHaveLength(1);
    }
  });

  it('!curar só com curativo, vivo e a cada 15 s', () => {
    const g = new RoyaleGame({ joinSec: 15, fillBots: false }, seeded(5));
    g.open(T0);
    g.join('simulator:ana', 'ana', undefined, 'cidade');
    g.join('simulator:bia', 'bia', undefined, 'porto');
    g.update(T0 + 15_000);
    const now = T0 + 15_000 + ROYALE_DROP_MS + 100;
    g.update(now);
    expect(g.heal('simulator:ana', now)).toBe(false); // sem curativo
    g.special({ kind: 'points', platform: 'simulator', user: { id: 'ana', name: 'ana' }, amount: 1 }, now);
    g.special({ kind: 'bits', platform: 'simulator', user: { id: 'ana', name: 'ana' }, amount: 100 }, now);
    const s = g.snapshot(now);
    expect(s.players[0][4]).toBe(100); // colete 3
  });

  it('caixa: só quem não está vivo vota; a caixa cai na região mais votada', () => {
    const g = new RoyaleGame({ joinSec: 15, fillBots: false }, seeded(9));
    g.open(T0);
    g.join('simulator:ana', 'ana', undefined, 'cidade');
    g.join('simulator:bia', 'bia', undefined, 'floresta');
    g.update(T0 + 15_000);
    let now = play(g, T0 + 15_000, (x) => x.snapshot(Date.now(), true).vote.endsAt !== null, 60_000);
    expect(g.vote('simulator:ana', 'porto')).toBe(false); // viva não vota
    for (let i = 0; i < 5; i++) g.handle(chat(`fan${i}`, '!caixa fazenda'), now);
    g.handle(chat('x', '!caixa porto'), now);
    expect(g.snapshot(now, true).vote.counts.fazenda).toBe(5);
    g.snapshot(now); // consome eventos
    now = play(g, now, (x) => x.snapshot(Date.now(), true).vote.endsAt === null, 20_000);
    const ev = g.snapshot(now).events.find((e) => e.kind === 'supply');
    expect(ev?.label).toBe('Fazenda');
  });

  it('raid vira bombardeio; comandos dos mods', () => {
    const g = new RoyaleGame({ joinSec: 15 }, seeded(2));
    g.open(T0);
    g.join('a', 'a', undefined, null);
    g.update(T0 + 15_000);
    const now = T0 + 15_000 + ROYALE_DROP_MS + 100;
    g.update(now);
    expect(g.special({ kind: 'raid', platform: 'simulator', user: { id: 'r', name: 'r' }, amount: 50 }, now).effect).toMatch(/BOMBARDEIO/);
    play(g, now, () => false, 5000);
    expect(parseRoyaleChatCommand(chat('m', '!royale iniciar', true))).toEqual({ type: 'start' });
    expect(parseRoyaleChatCommand(chat('m', '!br parar', true))).toEqual({ type: 'stop' });
    expect(parseRoyaleChatCommand(chat('x', '!royale iniciar'))).toBeNull();
  });
});
