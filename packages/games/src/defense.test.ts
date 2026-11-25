import { describe, expect, it } from 'vitest';
import { normalizeDefenseConfig, type ChatEvent, type SupportEvent } from '@clipei/shared';
import { DefenseGame, parseDefenseChatCommand } from './defense.ts';

const chat = (id: string, text: string, mod = false) =>
  ({ platform: 'twitch', text, user: { id, displayName: id, color: '#ff0000', isMod: mod, isBroadcaster: false } }) as unknown as ChatEvent;

/** Joga até acabar (ou até o limite), avançando de 100 em 100 ms. */
function play(g: DefenseGame, start: number, until: (g: DefenseGame) => boolean, max = 30_000) {
  let now = start;
  for (let i = 0; i < max && !until(g); i++) {
    now += 100;
    g.update(now);
  }
  return now;
}

describe('DefenseGame', () => {
  it('chat vira torre, completa com CPU, troca de classe na votação e vota a melhoria', () => {
    const g = new DefenseGame({ joinSec: 10, waves: 2 }, () => 0.3);
    let now = 1_000_000;
    g.open(now);
    g.handle(chat('ana', '!arqueiro'), now);
    g.handle(chat('bia', '!canhão'), now);
    g.handle(chat('caio', '!entrar'), now);
    expect(g.humans).toBe(3);
    now = play(g, now, (x) => x.status === 'wave');
    expect(g.size).toBe(6); // 3 CPU
    const first = g.snapshot(now);
    expect(first.roster).toHaveLength(6);
    expect(g.snapshot(now).roster).toBeNull(); // só manda quando muda
    now = play(g, now, (x) => x.status !== 'wave');
    expect(g.status).toBe('vote');
    expect(g.kills).toBeGreaterThan(0);
    g.handle(chat('ana', '!mago'), now);
    expect(g.snapshot(now).roster).not.toBeNull();
    g.handle(chat('ana', '!fogo'), now);
    g.handle(chat('bia', '!fogo'), now);
    g.handle(chat('caio', '!gelo'), now);
    now = play(g, now, (x) => x.status !== 'vote');
    expect(g.lastUpgrade).toBe('fogo');
    expect(g.upgradeLevels().fogo).toBe(1);
    play(g, now, (x) => !x.isActive);
    expect(g.status).toBe('finished');
    expect(['won', 'lost']).toContain(g.result);
    expect(g.mvp()[0]?.dmg).toBeGreaterThan(0);
  });

  it('sem ninguém do chat a defesa não começa', () => {
    const g = new DefenseGame({ joinSec: 5 });
    g.open(0);
    play(g, 0, (x) => !x.isActive);
    expect(g.status).toBe('stopped');
  });

  it('uma torre só no difícil: a partida termina, e na derrota a base zera', () => {
    const g = new DefenseGame({ joinSec: 5, fillBots: false, waves: 3, difficulty: 'dificil' }, () => 0.5);
    g.open(0);
    g.handle(chat('ana', '!canhao'), 0);
    const end = play(g, 0, (x) => !x.isActive, 60_000);
    expect(g.status).toBe('finished');
    expect(end).toBeGreaterThan(0);
    if (g.result === 'lost') expect(g.baseHp).toBe(0);
  });

  it('apoios: meteoro, herói, torre nível acima e onda de aliados', () => {
    const g = new DefenseGame({ joinSec: 5, waves: 5 }, () => 0.2);
    let now = 0;
    g.open(now);
    g.handle(chat('ana', '!mago'), now);
    now = play(g, now, (x) => x.status === 'wave' && x.snapshot(now, true).monsters.length >= 3);
    const user = { id: 'ana', name: 'ana', color: '#ff0000' };
    const bits = g.special({ kind: 'bits', amount: 100, platform: 'twitch', user } as SupportEvent, now);
    expect(bits).toMatchObject({ applied: true });
    expect(bits.effect).toContain('METEORO');
    expect(g.special({ kind: 'sub', amount: 1, platform: 'twitch', user } as SupportEvent, now).effect).toContain('HERÓI');
    expect(g.special({ kind: 'points', amount: 1, platform: 'twitch', user } as SupportEvent, now).effect).toContain('NÍVEL 2');
    const raid = g.special({ kind: 'raid', amount: 40, platform: 'twitch', user: null } as SupportEvent, now);
    expect(raid.effect).toContain('ALIADOS');
    g.update(now + 100);
    const s = g.snapshot(now + 100);
    expect(s.hero?.name).toBe('ana');
    expect(s.allies.length).toBeGreaterThan(0);
    expect(s.fx.some((f) => f.kind === 'meteor')).toBe(true);
  });

  it('tiro forte tem recarga e comandos de mod', () => {
    const g = new DefenseGame({ joinSec: 5 });
    g.open(0);
    g.handle(chat('ana', '!arqueiro'), 0);
    play(g, 0, (x) => x.status === 'wave');
    g.handle(chat('ana', '!atk'), 6000);
    expect(g.snapshot(6000, true).towers.some((t) => t[4] === 2)).toBe(true);
    expect(parseDefenseChatCommand(chat('m', '!defesa iniciar', true))).toEqual({ type: 'start' });
    expect(parseDefenseChatCommand(chat('m', '!defesa começar', true))).toEqual({ type: 'go' });
    expect(parseDefenseChatCommand(chat('x', '!defesa parar'))).toBeNull();
    expect(parseDefenseChatCommand(chat('x', '!defesa'))).toEqual({ type: 'help' });
    expect(normalizeDefenseConfig({ waves: 99, difficulty: 'x' as never })).toMatchObject({ waves: 15, difficulty: 'normal' });
  });
});
