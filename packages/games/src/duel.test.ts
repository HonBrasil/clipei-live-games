import { describe, expect, it } from 'vitest';
import type { ChatEvent, SupportEvent } from '@clipei/shared';
import { DUEL_COUNTDOWN_MS, DUEL_INTRO_MS, DUEL_ROUND_MS, DuelGame, parseDuelChatCommand } from './duel.ts';

const chat = (id: string, text: string, mod = false): ChatEvent => ({
  id: `m-${Math.random()}`,
  platform: 'simulator',
  channelId: 'c',
  text,
  ts: 0,
  user: { id, login: id, displayName: id, isSub: false, isMod: mod, isVip: false, isBroadcaster: false },
});
const T0 = 1_000_000;

/** Leva o duelo até o FOGO e devolve o instante. */
function toFire(g: DuelGame, from: number) {
  let now = from;
  for (let i = 0; i < 200 && g.status !== 'fire'; i++) g.update((now += 100));
  return now;
}

describe('Duelo', () => {
  it('os dois primeiros entram; o terceiro não; começa a encarada', () => {
    const g = new DuelGame({}, () => 0.5);
    g.open(T0);
    g.handle(chat('ana', '!duelo'), T0);
    g.handle(chat('ana', '!duelo'), T0);
    expect(g.status).toBe('lobby');
    g.handle(chat('bia', '!duelo'), T0);
    g.handle(chat('caio', '!duelo'), T0);
    expect(g.duelists).toEqual(['ana', 'bia']);
    expect(g.status).toBe('intro');
  });

  it('sem segundo duelista, o duelo é cancelado no fim do tempo', () => {
    const g = new DuelGame({ joinSec: 30 }, () => 0.5);
    g.open(T0);
    g.handle(chat('ana', '!duelo'), T0);
    g.update(T0 + 30_000);
    expect(g.status).toBe('stopped');
  });

  it('fases: encarada → contagem → silêncio → FOGO', () => {
    const g = new DuelGame({}, () => 0.5);
    g.open(T0);
    g.join('a', 'A', undefined, T0);
    g.join('b', 'B', undefined, T0);
    g.update(T0 + DUEL_INTRO_MS);
    expect(g.status).toBe('countdown');
    g.update(T0 + DUEL_INTRO_MS + DUEL_COUNTDOWN_MS);
    expect(g.status).toBe('wait');
    expect(toFire(g, T0 + DUEL_INTRO_MS + DUEL_COUNTDOWN_MS)).toBeGreaterThan(T0 + DUEL_INTRO_MS + DUEL_COUNTDOWN_MS + 999);
  });

  it('X1: tiro certeiro decide; atirar antes do FOGO trava a arma', () => {
    const g = new DuelGame({ bestOf: 1 }, () => 0.1); // sempre acerta
    g.open(T0);
    g.join('a', 'A', undefined, T0);
    g.join('b', 'B', undefined, T0);
    g.update(T0 + DUEL_INTRO_MS);
    expect(g.shoot('a', T0 + DUEL_INTRO_MS + 100)[0].kind).toBe('jam');
    const fire = toFire(g, T0 + DUEL_INTRO_MS);
    expect(g.shoot('a', fire)).toHaveLength(0); // travada por 1,5 s
    const ev = g.shoot('b', fire + 50);
    expect(ev.map((e) => e.kind)).toEqual(['shot', 'hit']);
    expect(g.score).toEqual([0, 1]);
    g.update(fire + 50 + DUEL_ROUND_MS);
    expect(g.status).toBe('finished');
    expect(g.winner).toBe(1);
  });

  it('errou, recarrega; colete segura um tiro; revólver dourado não erra', () => {
    const g = new DuelGame({}, () => 0.99); // sempre erra (sem dourado)
    g.open(T0);
    g.join('simulator:a', 'A', undefined, T0);
    g.join('simulator:b', 'B', undefined, T0);
    const fire = toFire(g, T0);
    expect(g.shoot('simulator:a', fire).map((e) => e.kind)).toEqual(['shot', 'miss']);
    expect(g.shoot('simulator:a', fire + 500)).toHaveLength(0); // recarregando
    const sup = (id: string, kind: SupportEvent['kind']): SupportEvent => ({ kind, platform: 'simulator', user: { id, name: id }, amount: 100 });
    expect(g.special(sup('b', 'bits')).effect).toMatch(/COLETE/);
    expect(g.special(sup('a', 'sub')).effect).toMatch(/DOURADO/);
    expect(g.shoot('simulator:a', fire + 1300).map((e) => e.kind)).toEqual(['shot', 'vest']);
    expect(g.special(sup('a', 'sub')).applied).toBe(true);
    expect(g.shoot('simulator:a', fire + 2600).map((e) => e.kind)).toEqual(['shot', 'hit']);
  });

  it('MD3: precisa de 2 vitórias', () => {
    const g = new DuelGame({ bestOf: 3 }, () => 0.1);
    g.open(T0);
    g.join('a', 'A', undefined, T0);
    g.join('b', 'B', undefined, T0);
    let now = toFire(g, T0);
    g.shoot('a', now);
    g.update((now += DUEL_ROUND_MS));
    expect(g.status).toBe('countdown');
    now = toFire(g, now);
    g.shoot('a', now);
    g.update((now += DUEL_ROUND_MS));
    expect(g.status).toBe('finished');
    expect(g.score).toEqual([2, 0]);
  });

  it('torcida dá até +10% e apoio de quem torce vai para o lado dele', () => {
    const g = new DuelGame({}, () => 0.5);
    g.open(T0);
    g.join('a', 'A', undefined, T0);
    g.join('b', 'B', undefined, T0);
    for (let i = 0; i < 9; i++) g.handle(chat(`t${i}`, '!1'));
    g.handle(chat('z', '!2'));
    expect(g.hitChance(0)).toBeCloseTo(0.68, 2);
    expect(g.hitChance(1)).toBeCloseTo(0.6, 2);
    const r = g.special({ kind: 'points', platform: 'simulator', user: { id: 'z', name: 'z' }, amount: 1 });
    expect(r.effect).toBe('MIRA (+15%) para B');
    expect(g.special({ kind: 'points', platform: 'simulator', user: { id: 'ninguem', name: 'x' }, amount: 1 }).applied).toBe(false);
  });

  it('comandos dos mods', () => {
    expect(parseDuelChatCommand(chat('m', '!duelo iniciar', true))).toEqual({ type: 'start' });
    expect(parseDuelChatCommand(chat('m', '!duelo parar', true))).toEqual({ type: 'stop' });
    expect(parseDuelChatCommand(chat('x', '!duelo iniciar'))).toBeNull();
    expect(parseDuelChatCommand(chat('x', '!duelo'))).toBeNull(); // "!duelo" puro é entrar
  });
});
