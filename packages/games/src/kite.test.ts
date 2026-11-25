import { describe, expect, it } from 'vitest';
import { KITE_FLAG, type ChatEvent, type KiteEvent } from '@clipei/shared';
import { KiteGame, kiteModelFrom, parseKiteChatCommand } from './kite.ts';

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

/** Roda a partida guardando os eventos. */
function play(g: KiteGame, from: number, until: (g: KiteGame) => boolean, max = 700_000, onTick?: (now: number) => void) {
  let now = from;
  const events: KiteEvent[] = [];
  while (!until(g) && now - from < max) {
    g.update((now += 100));
    onTick?.(now);
    events.push(...g.snapshot(now).events);
  }
  return { now, events };
}

describe('Pipa Combate', () => {
  it('inscrição: !pipa com modelo, CPU completa até 6 e cada um ganha uma laje', () => {
    const g = new KiteGame({ joinSec: 30 }, seeded());
    g.open(T0);
    g.handle(chat('ana', '!pipa raia'), T0);
    g.handle(chat('bia', '!pipa'), T0);
    g.handle(chat('bia', '!pipa peixinho'), T0);
    const s = g.snapshot(T0);
    expect(s.roster?.find((r) => r.name === 'ana')?.model).toBe(1);
    expect(s.roster?.find((r) => r.name === 'bia')?.model).toBe(4);
    const xs = new Set(s.roster?.map((r) => r.ax));
    expect(xs.size).toBe(2);
    g.update(T0 + 30_000);
    expect(g.status).toBe('play');
    expect(g.size).toBe(6);
    expect(kiteModelFrom('Capucheta')).toBe(2);
  });

  it('ninguém entrou: cancela', () => {
    const g = new KiteGame({ joinSec: 15 }, seeded());
    g.open(T0);
    g.update(T0 + 15_000);
    expect(g.status).toBe('stopped');
  });

  it('partidas terminam (último no céu ou fim do tempo) com relos, rabiolas e cortes', () => {
    for (const n of [2, 12, 40]) {
      const g = new KiteGame({ joinSec: 15, maxPlayers: 40, durationSec: 180 }, seeded(n + 3));
      g.open(T0);
      for (let i = 0; i < n; i++) g.join(`p${i}`, `p${i}`, undefined, null);
      g.update(T0 + 15_000);
      const { now, events } = play(g, T0 + 15_000, (x) => x.status === 'finished');
      expect(g.status).toBe('finished');
      expect(g.winner).not.toBeNull();
      expect(now - (T0 + 15_000)).toBeLessThanOrEqual(181_000);
      expect(events.some((e) => e.kind === 'relo')).toBe(true);
      expect(events.some((e) => e.kind === 'cut')).toBe(true);
      expect(events.some((e) => e.kind === 'rabiola')).toBe(true);
      const s = g.snapshot(now);
      expect(s.winReason === 'last' || s.winReason === 'time').toBe(true);
      if (s.winReason === 'last') expect(s.alive).toBe(1);
    }
  });

  it('acabou o tempo com várias no céu: vence quem cortou mais', () => {
    const g = new KiteGame({ joinSec: 15, maxPlayers: 40, durationSec: 60 }, seeded(9));
    g.open(T0);
    for (let i = 0; i < 40; i++) g.join(`p${i}`, `p${i}`, undefined, null);
    g.update(T0 + 15_000);
    const { now } = play(g, T0 + 15_000, (x) => x.status === 'finished');
    const s = g.snapshot(now, true);
    if (s.winReason === 'time') {
      const best = Math.max(...s.kites.filter((k) => k[3] & KITE_FLAG.alive).map((k) => k[6]));
      expect(s.kites[s.winner!][6]).toBe(best);
    }
    expect(g.status).toBe('finished');
  });

  it('táticas têm recarga e só valem para quem está no céu', () => {
    const g = new KiteGame({ joinSec: 15 }, seeded(2));
    g.open(T0);
    g.join('ana', 'ana', undefined, null);
    expect(g.tactic('ana', 'puxar', T0)).toBe(false); // ainda na inscrição
    g.update(T0 + 15_000);
    const t = T0 + 16_000;
    expect(g.tactic('ana', 'puxar', t)).toBe(true);
    expect(g.tactic('ana', 'puxar', t + 1000)).toBe(false);
    expect(g.tactic('ana', 'puxar', t + 5000)).toBe(true);
    expect(g.tactic('ninguem', 'dibicar', t)).toBe(false);
    const flags = g.snapshot(t + 5000, true).kites[0][3];
    expect(flags & KITE_FLAG.puxar).toBeTruthy();
  });

  it('qualquer pessoa do chat apara pipa voada (uma por vez, com recarga) e entra no ranking', () => {
    const g = new KiteGame({ joinSec: 15, maxPlayers: 20 }, seeded(5));
    g.open(T0);
    for (let i = 0; i < 20; i++) g.join(`p${i}`, `p${i}`, undefined, null);
    g.update(T0 + 15_000);
    let caught = 0;
    const { now } = play(
      g,
      T0 + 15_000,
      () => caught >= 2,
      300_000,
      (t) => {
        const s = g.snapshot(t, true);
        if (s.voadas.length && g.aparar('espectador', 'Espectador', '#ff0000', t)) caught++;
      },
    );
    expect(caught).toBe(2);
    const s = g.snapshot(now, true);
    expect(s.aparadores[0]).toMatchObject({ name: 'Espectador', n: 2 });
    expect(g.aparar('espectador', 'Espectador', '#ff0000', now + 100)).toBe(false); // recarga ou sem voada
  });

  it('apoios: pontos = rabiola, bits = linha diamante, sub = raia dourada, raid = chuva de pipas', () => {
    const g = new KiteGame({ joinSec: 15 }, seeded(4));
    g.open(T0);
    g.join('twitch:ana', 'ana', undefined, null);
    const user = { id: 'ana', name: 'ana', login: 'ana' };
    const base = { platform: 'twitch' as const, amount: 1, user };
    expect(g.special({ ...base, kind: 'points' as const }, T0).applied).toBe(true);
    expect(g.special({ ...base, kind: 'bits' as const }, T0).applied).toBe(true);
    expect(g.special({ ...base, kind: 'sub' as const }, T0).applied).toBe(true);
    const k = g.snapshot(T0, true).kites[0];
    expect(k[4]).toBe(3); // rabiolas: 1 + pontos + sub
    expect(k[5]).toBe(3); // linha dourada
    expect(k[3] & KITE_FLAG.golden).toBeTruthy();
    expect(g.special({ ...base, kind: 'raid' as const, user: null }, T0).applied).toBe(false); // raid só no céu
    g.update(T0 + 15_000);
    expect(g.special({ ...base, kind: 'raid' as const, user: null }, T0 + 16_000).applied).toBe(true);
    g.update(T0 + 18_500);
    expect(g.snapshot(T0 + 18_500, true).voadas.length).toBeGreaterThanOrEqual(5);
  });

  it('chat dos mods: !pipa iniciar / parar; !pipa sozinho é entrar', () => {
    expect(parseKiteChatCommand(chat('m', '!pipa iniciar', true))).toEqual({ type: 'start' });
    expect(parseKiteChatCommand(chat('m', '!pipa parar', true))).toEqual({ type: 'stop' });
    expect(parseKiteChatCommand(chat('v', '!pipa iniciar'))).toBeNull();
    expect(parseKiteChatCommand(chat('m', '!pipa', true))).toBeNull();
    expect(parseKiteChatCommand(chat('v', '!pipa ajuda'))).toEqual({ type: 'help' });
  });
});
