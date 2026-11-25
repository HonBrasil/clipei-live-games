import { describe, expect, it } from 'vitest';
import { normalizeFishingConfig, type ChatEvent, type SupportEvent } from '@clipei/shared';
import { FishingGame, fishingWeek, parseFishingChatCommand, type FishingSave } from './fishing.ts';

function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const chat = (id: string, text: string, mod = false): ChatEvent => ({
  id: `m-${Math.random()}`,
  platform: 'twitch',
  channelId: 'c',
  text,
  ts: 0,
  user: { id, login: id, displayName: id, isSub: false, isMod: mod, isVip: false, isBroadcaster: false },
});
// quarta-feira, 25/11/2026, 15h em Brasília
const T0 = Date.UTC(2026, 10, 25, 18, 0, 0);

function game(seed = 1) {
  const saves: FishingSave[] = [];
  const g = new FishingGame(null, (s) => saves.push(s), seeded(seed), T0);
  g.config = normalizeFishingConfig({ enabled: true, cooldownSec: 60 });
  return { g, saves };
}

describe('Pescaria da Live', () => {
  it('semana vira na segunda à meia-noite de Brasília', () => {
    expect(fishingWeek(T0)).toBe('2026-W48');
    expect(fishingWeek(Date.UTC(2026, 10, 30, 2, 59))).toBe('2026-W48'); // domingo 23:59 em Brasília
    expect(fishingWeek(Date.UTC(2026, 10, 30, 3, 0))).toBe('2026-W49'); // segunda 00:00
  });

  it('!pescar lança, belisca em alguns segundos, soma pontos e salva', () => {
    const { g, saves } = game();
    expect(g.handle(chat('ana', '!pescar'), T0)).toEqual({ type: 'cast' });
    expect(g.snapshot(T0).casters).toHaveLength(1);
    expect(g.update(T0 + 3000)).toHaveLength(0);
    const got = g.update(T0 + 10_000);
    expect(got).toHaveLength(1);
    expect(got[0].firstTime).toBe(true);
    expect(saves.length).toBeGreaterThan(0);
    const p = g.save.players['twitch:ana'];
    expect(p.catches).toBe(1);
    expect(p.week).toBe(got[0].points);
    expect(g.snapshot(T0 + 10_000).catches).toHaveLength(1);
  });

  it('espera entre lançamentos (metade no cardume) e desligada não pesca', () => {
    const { g } = game();
    g.handle(chat('ana', '!pescar'), T0);
    g.update(T0 + 10_000);
    expect(g.handle(chat('ana', '!pescar'), T0 + 20_000)).toEqual({ type: 'cooldown', waitSec: 40 });
    g.shoal(T0 + 20_000, 120);
    expect(g.handle(chat('ana', '!pescar'), T0 + 31_000)).toEqual({ type: 'cast' });
    g.config = normalizeFishingConfig({ enabled: false });
    expect(g.handle(chat('bia', '!pescar'), T0 + 31_000)).toEqual({ type: 'none' });
  });

  it('raridades seguem os pesos e a sorte puxa raros para cima', () => {
    const count = (luck: boolean) => {
      const { g } = game(7);
      g.config = normalizeFishingConfig({ enabled: true, cooldownSec: 10 });
      let rare = 0;
      let t = T0;
      for (let i = 0; i < 3000; i++) {
        const id = `p${i}`;
        if (luck) g.special({ kind: 'bits', amount: 100, platform: 'twitch', user: { id, name: id } }, t);
        g.cast(`twitch:${id}`, id, undefined, t);
        t += 10_000;
        for (const c of g.update(t)) if (c.rarity === 'raro' || c.rarity === 'epico' || c.rarity === 'lendario') rare++;
      }
      return rare / 3000;
    };
    const base = count(false);
    expect(base).toBeGreaterThan(0.1);
    expect(base).toBeLessThan(0.2);
    expect(count(true)).toBeGreaterThan(base * 1.8);
  });

  it('ranking da semana zera na virada e guarda o pódio', () => {
    const { g } = game();
    g.handle(chat('ana', '!pescar'), T0);
    g.update(T0 + 10_000);
    const pts = g.save.players['twitch:ana'].week;
    expect(g.rankingText()).toContain('ana');
    const monday = Date.UTC(2026, 10, 30, 12, 0);
    g.handle(chat('bia', '!pescar'), monday);
    expect(g.save.players['twitch:ana'].week).toBe(0);
    expect(g.save.players['twitch:ana'].total).toBe(pts);
    expect(g.save.lastWeekTop[0]?.name).toBe(pts > 0 ? 'ana' : undefined);
  });

  it('!peixes mostra o resumo e apoios aplicam', () => {
    const { g } = game();
    expect(g.handle(chat('ana', '!peixes'), T0)).toMatchObject({ type: 'say' });
    const ev = (kind: SupportEvent['kind']): SupportEvent => ({ kind, amount: 100, platform: 'twitch', user: { id: 'ana', name: 'ana' } });
    expect(g.special(ev('sub'), T0).effect).toContain('VARA DE OURO');
    expect(g.special(ev('points'), T0).applied).toBe(true); // lança na hora
    expect(g.special(ev('points'), T0).applied).toBe(false); // já está com a linha na água
    expect(g.special({ kind: 'raid', amount: 30, platform: 'twitch', user: null }, T0).effect).toContain('CARDUME');
    expect(g.snapshot(T0).shoalUntil).not.toBeNull();
  });

  it('comandos dos mods', () => {
    expect(parseFishingChatCommand(chat('m', '!pescaria ligar', true))).toEqual({ type: 'on' });
    expect(parseFishingChatCommand(chat('m', '!cardume', true))).toEqual({ type: 'shoal' });
    expect(parseFishingChatCommand(chat('v', '!cardume'))).toBeNull();
  });

  it('ranking no mesmo canto do lago vira ranking junto do lago e respeita o top escolhido', () => {
    const g = new FishingGame(null, () => {}, () => 0.5);
    g.config = normalizeFishingConfig({ enabled: true, corner: 'br', rankPos: 'br', rankTop: 5, scene: 'full' });
    const snap = g.snapshot();
    expect(snap.rankPos).toBe('lake');
    expect(snap.scene).toBe('full');
    expect(normalizeFishingConfig({ rankPos: 'xx' as never, rankTop: 7 as never })).toMatchObject({ rankPos: 'lake', rankTop: 3, scene: 'transparent' });
  });
});
