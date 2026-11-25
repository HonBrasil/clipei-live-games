import { describe, expect, it } from 'vitest';
import { normalizeLoopConfig, type ChatEvent } from '@clipei/shared';
import { GameLoop, LOOP_FIRST_DELAY_MS, parseLoopChatCommand, type LoopContext } from './loop.ts';

const ctx = (over: Partial<LoopContext> = {}, cfg: Parameters<typeof normalizeLoopConfig>[0] = {}): LoopContext => ({
  cfg: normalizeLoopConfig({ enabled: true, games: ['race', 'kite', 'boss'], gapSec: 60, ...cfg }),
  busy: false,
  entitled: true,
  live: true,
  overlays: 1,
  chatters: 5,
  ...over,
});

describe('GameLoop', () => {
  it('agenda o primeiro jogo rápido, abre na hora e espera o jogo acabar para contar a pausa', () => {
    const l = new GameLoop();
    const a = l.tick(0, ctx());
    expect(a).toEqual({ type: 'scheduled', game: 'race', at: LOOP_FIRST_DELAY_MS, first: true, announce: true });
    expect(l.tick(LOOP_FIRST_DELAY_MS - 1, ctx())).toBeNull();
    expect(l.tick(LOOP_FIRST_DELAY_MS, ctx())).toEqual({ type: 'start', game: 'race' });
    // corrida na tela: nada agendado
    expect(l.tick(100_000, ctx({ busy: true }))).toBeNull();
    expect(l.at).toBeNull();
    // acabou: pausa inteira a partir de agora, próximo da sequência
    const b = l.tick(200_000, ctx());
    expect(b).toMatchObject({ type: 'scheduled', game: 'kite', at: 260_000, first: false });
    expect(l.tick(260_000, ctx())).toEqual({ type: 'start', game: 'kite' });
    l.tick(300_000, ctx());
    expect(l.next).toBe('boss');
  });

  it('fica parado com a live fora do ar, OBS fechado ou chat vazio, e volta sozinho', () => {
    const l = new GameLoop();
    expect(l.tick(0, ctx({ live: false }))).toBeNull();
    expect(l.blocked).toBe('offline');
    l.tick(1000, ctx({ overlays: 0 }));
    expect(l.blocked).toBe('obs');
    l.tick(2000, ctx({ chatters: 1 }, { minChatters: 3 }));
    expect(l.blocked).toBe('chat');
    expect(l.tick(3000, ctx())).toMatchObject({ type: 'scheduled' });
    expect(l.blocked).toBeNull();
    // live com aviso desligado: offline não bloqueia
    const l2 = new GameLoop();
    expect(l2.tick(0, ctx({ live: false }, { onlyLive: false }))).toMatchObject({ type: 'scheduled' });
  });

  it('modo aleatório não repete o último jogo e desliga sozinho no tempo programado', () => {
    const l = new GameLoop(() => 0);
    const c = ctx({}, { order: 'random', maxHours: 1 });
    l.tick(0, c);
    expect(l.tick(LOOP_FIRST_DELAY_MS, c)).toEqual({ type: 'start', game: 'race' });
    l.tick(30_000, ctx({ busy: true }, { order: 'random', maxHours: 1 }));
    l.tick(60_000, c);
    expect(l.next).not.toBe('race');
    expect(l.tick(3_600_000, c)).toEqual({ type: 'expired' });
    expect(l.snapshot(3_600_000, normalizeLoopConfig({})).since).toBeNull();
  });

  it('pular abre o próximo no tick seguinte e comandos de mod funcionam', () => {
    const l = new GameLoop();
    const c = ctx();
    l.tick(0, c);
    expect(l.skip(1000, c.cfg)).toBe('race');
    expect(l.snapshot(1000, c.cfg).playing).toBe('race');
    // abre na hora mesmo com a live fora do ar
    const l2 = new GameLoop();
    expect(l2.skip(0, ctx({ live: false }).cfg)).toBe('race');
    const ev = (text: string, isMod: boolean) => ({ text, user: { isMod, isBroadcaster: false } }) as unknown as ChatEvent;
    expect(parseLoopChatCommand(ev('!loop ligar', true))).toEqual({ type: 'on' });
    expect(parseLoopChatCommand(ev('!loop pular', true))).toEqual({ type: 'skip' });
    expect(parseLoopChatCommand(ev('!loop desligar', false))).toBeNull();
  });

  it('normaliza a lista de jogos mantendo a ordem do streamer', () => {
    expect(normalizeLoopConfig({ games: ['kite', 'xx' as never, 'race', 'kite'], gapSec: 5 })).toMatchObject({ games: ['kite', 'race'], gapSec: 20 });
  });

  it('temporizador: um jogo a cada X min, aviso 1 min antes, contagem segue com chat parado', () => {
    const l = new GameLoop();
    const c = ctx({}, { mode: 'timer', intervalMin: 10 });
    expect(l.tick(0, c)).toMatchObject({ type: 'scheduled', game: 'race', at: 600_000, announce: false });
    expect(l.snapshot(0, c.cfg).warnAt).toBe(540_000);
    // chat vazio no meio: a contagem não zera
    expect(l.tick(200_000, ctx({ chatters: 0 }, { mode: 'timer', intervalMin: 10, minChatters: 2 }))).toBeNull();
    expect(l.at).toBe(600_000);
    expect(l.tick(539_000, c)).toBeNull();
    expect(l.tick(540_000, c)).toEqual({ type: 'warn', game: 'race', at: 600_000 });
    expect(l.tick(600_000, c)).toEqual({ type: 'start', game: 'race' });
    // terminou: conta de novo o intervalo inteiro
    l.tick(700_000, ctx({ busy: true }, { mode: 'timer', intervalMin: 10 }));
    expect(l.tick(800_000, c)).toMatchObject({ type: 'scheduled', game: 'kite', at: 1_400_000 });
    // venceu com a live fora do ar: quando voltar, avisa e abre em 1 min
    const off = ctx({ live: false }, { mode: 'timer', intervalMin: 10 });
    expect(l.tick(1_400_000, off)).toBeNull();
    expect(l.at).toBeNull();
    expect(l.tick(2_000_000, c)).toMatchObject({ type: 'scheduled', at: 2_060_000 });
    expect(l.tick(2_000_100, c)).toMatchObject({ type: 'warn' });
  });
});
