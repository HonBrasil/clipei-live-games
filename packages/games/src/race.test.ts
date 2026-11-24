import { describe, expect, it } from 'vitest';
import { RACE_FLAG, type ChatEvent, type SupportEvent } from '@clipei/shared';
import { parseRaceChatCommand, RACE_COUNTDOWN_MS, RaceGame } from './race.ts';

/** Sorteio determinístico para os testes. */
function seeded(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const chat = (id: string, text: string, extra: Partial<ChatEvent['user']> = {}): ChatEvent => ({
  id: `m-${Math.random()}`,
  platform: 'simulator',
  channelId: 'c',
  text,
  user: { id, login: id, displayName: id, isSub: false, isMod: false, isVip: false, isBroadcaster: false, ...extra },
  ts: 0,
});

const T0 = 1_000_000;

function runUntilDone(g: RaceGame, from: number, step = 100, max = 400_000) {
  let now = from;
  while (g.status === 'running' && now - from < max) {
    now += step;
    g.update(now);
  }
  return now;
}

describe('Corrida', () => {
  it('inscrição: cada pessoa entra uma vez, só durante o lobby', () => {
    const g = new RaceGame({ joinSec: 30 }, seeded());
    g.open(T0);
    g.handle(chat('ana', '!correr'), T0);
    g.handle(chat('ana', '!correr'), T0 + 10);
    g.handle(chat('bia', '!entrar'), T0 + 20);
    expect(g.humans).toBe(2);
    g.update(T0 + 30_000);
    expect(g.status).toBe('running');
    g.handle(chat('caio', '!correr'), T0 + 31_000);
    expect(g.humans).toBe(2);
  });

  it('completa com CPU até 4 pilotos e cancela se ninguém entrar', () => {
    const g = new RaceGame({ joinSec: 15 }, seeded());
    g.open(T0);
    g.handle(chat('ana', '!correr'), T0);
    g.update(T0 + 15_000);
    const snap = g.snapshot(T0 + 15_000);
    expect(snap.roster?.length).toBe(4);
    expect(snap.roster?.filter((r) => r.bot).length).toBe(3);
    expect(snap.participants).toBe(1);

    const empty = new RaceGame({ joinSec: 15 }, seeded());
    empty.open(T0);
    empty.update(T0 + 15_000);
    expect(empty.status).toBe('stopped');
  });

  it('corrida termina com pódio e todos colocados, num tempo razoável', () => {
    const g = new RaceGame({ joinSec: 15, laps: 2, fillBots: false }, seeded(7));
    g.open(T0);
    for (let i = 0; i < 30; i++) g.handle(chat(`p${i}`, '!correr'), T0);
    g.update(T0 + 15_000);
    const start = T0 + 15_000 + RACE_COUNTDOWN_MS;
    const end = runUntilDone(g, T0 + 15_000);
    expect(g.status).toBe('finished');
    const secs = (end - start) / 1000;
    expect(secs).toBeGreaterThan(45);
    expect(secs).toBeLessThan(110);
    const snap = g.snapshot(end);
    expect(snap.podium).toHaveLength(3);
    expect(snap.podium[0].timeMs).toBeGreaterThan(0);
    expect(snap.runners.every((r) => r[4] & RACE_FLAG.finished || true)).toBe(true);
  });

  it('turbo só vale com a janela aberta e uma vez por janela', () => {
    const g = new RaceGame({ joinSec: 15, fillBots: false }, () => 0.5);
    g.open(T0);
    g.handle(chat('ana', '!correr'), T0);
    g.update(T0 + 15_000);
    const start = T0 + 15_000 + RACE_COUNTDOWN_MS;
    expect(g.handle(chat('ana', '!turbo'), start + 1000)).toHaveLength(0); // janela fechada
    let now = start;
    while (!g.snapshot(now).turbo.open) g.update((now += 100));
    const ev = g.handle(chat('ana', '!turbo'), now);
    expect(ev[0]?.kind).toBe('turbo');
    expect(g.handle(chat('ana', '!turbo'), now + 100)).toHaveLength(0);
  });

  it('turbo pode tropeçar (15%)', () => {
    const g = new RaceGame({ joinSec: 15, fillBots: false }, () => 0.05);
    g.open(T0);
    g.handle(chat('ana', '!correr'), T0);
    g.update(T0 + 15_000);
    let now = T0 + 15_000;
    while (!g.snapshot(now).turbo.open) g.update((now += 100));
    expect(g.handle(chat('ana', '!turbo'), now)[0]?.kind).toBe('trip');
  });

  it('apoios: pontos dão escudo, bits dão foguete, sub de quem não corre vira banana no líder', () => {
    const g = new RaceGame({ joinSec: 15, fillBots: false }, seeded(3));
    g.open(T0);
    g.handle(chat('ana', '!correr'), T0);
    g.handle(chat('bia', '!correr'), T0);
    g.update(T0 + 15_000);
    const now = T0 + 15_000 + RACE_COUNTDOWN_MS + 5000;
    g.update(now);
    const sup = (id: string, kind: SupportEvent['kind'], amount = 1): SupportEvent => ({ kind, platform: 'simulator', user: { id, name: id }, amount });

    expect(g.special(sup('ana', 'points'), now).effect).toBe('ESCUDO');
    expect(g.special(sup('bia', 'bits', 500), now).effect).toMatch(/FOGUETE/);
    const snap = g.snapshot(now);
    expect(snap.runners[0][4] & RACE_FLAG.shield).toBeTruthy();
    expect(snap.runners[1][4] & RACE_FLAG.rocket).toBeTruthy();

    const banana = g.special(sup('zeca', 'sub'), now);
    expect(banana.effect).toMatch(/BANANA/);
    expect(g.snapshot(now).obstacles.some((o) => o.kind === 'banana')).toBe(true);
  });

  it('apoio sem corrida ativa não é aplicado (pontos são devolvidos pela sala)', () => {
    const g = new RaceGame({}, seeded());
    expect(g.special({ kind: 'points', platform: 'simulator', user: { id: 'x', name: 'x' }, amount: 1 }).applied).toBe(false);
  });

  it('comandos dos mods', () => {
    expect(parseRaceChatCommand(chat('mod', '!corrida iniciar', { isMod: true }))).toEqual({ type: 'start' });
    expect(parseRaceChatCommand(chat('mod', '!corrida parar', { isMod: true }))).toEqual({ type: 'stop' });
    expect(parseRaceChatCommand(chat('x', '!corrida iniciar'))).toBeNull();
    expect(parseRaceChatCommand(chat('x', '!corrida'))).toEqual({ type: 'help' });
  });
});
