import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, normalizeGameSupport, type SupportEvent } from '@clipei/shared';
import { KiteGame } from './kite.ts';
import { RaceGame } from './race.ts';
import { RoyaleGame } from './royale.ts';

const T0 = 1_000_000;
const ev = (kind: SupportEvent['kind'], amount = 1, id = 'ana'): SupportEvent => ({ kind, amount, platform: 'twitch', user: { id, name: id } });

describe('Apoios editáveis por jogo', () => {
  it('normaliza: limites, opções fechadas e jogo sem efeito', () => {
    const c = normalizeGameSupport('kite', undefined, { bits: { min: -5, p: { line: 7 } }, raid: { p: { kites: 99 } } });
    expect(c.bits.min).toBe(1);
    expect(c.bits.p.line).toBe(3); // acima do máximo: fica no máximo
    expect(c.raid.p.kites).toBe(15);
    const d = normalizeGameSupport('duel', undefined, { raid: { enabled: true } });
    expect(d.raid.enabled).toBe(false); // duelo não tem efeito de raid
  });

  it('mergeSettings guarda só o que mudou e mantém o resto', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { gameSupport: { royale: { raid: { p: { bombs: 3 } } } } });
    expect(s.gameSupport.royale.raid.p.bombs).toBe(3);
    expect(s.gameSupport.royale.raid.p.damage).toBe(35);
    const s2 = mergeSettings(s, { gameSupport: { royale: { bits: { enabled: false } } } });
    expect(s2.gameSupport.royale.raid.p.bombs).toBe(3);
    expect(s2.gameSupport.royale.bits.enabled).toBe(false);
  });

  it('desligado ou abaixo do mínimo: não aplica', () => {
    const g = new RoyaleGame({ joinSec: 15 });
    g.open(T0);
    g.join('twitch:ana', 'ana', undefined, null);
    g.support = normalizeGameSupport('royale', undefined, { bits: { min: 500 }, points: { enabled: false } });
    expect(g.special(ev('bits', 100), T0).applied).toBe(false);
    expect(g.special(ev('bits', 500), T0).applied).toBe(true);
    expect(g.special(ev('points'), T0).applied).toBe(false);
  });

  it('valores do streamer valem no jogo', () => {
    const k = new KiteGame({ joinSec: 15 });
    k.open(T0);
    k.join('twitch:ana', 'ana', undefined, null);
    k.support = normalizeGameSupport('kite', undefined, { bits: { p: { line: 3 } }, points: { p: { maxRabiolas: 2 } } });
    expect(k.special(ev('bits', 100), T0).effect).toContain('LINHA DOURADA');
    expect(k.special(ev('points'), T0).applied).toBe(true); // 1 → 2
    expect(k.special(ev('points'), T0).applied).toBe(false); // já no máximo

    const r = new RaceGame({ joinSec: 15 });
    r.open(T0);
    r.support = normalizeGameSupport('race', undefined, { bits: { p: { secPer100: 2, maxSec: 4 } } });
    r.join('twitch:ana', 'ana', undefined);
    expect(r.special(ev('bits', 1000), T0).effect).toContain('4,0 s');
  });
});
