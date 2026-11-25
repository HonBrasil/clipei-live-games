import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent, ServerMessage } from '@clipei/shared';
import { Room } from './rooms.ts';

function chat(userId: string, text: string, role: 'viewer' | 'mod' = 'viewer'): ChatEvent {
  return {
    id: Math.random().toString(36),
    platform: 'twitch',
    channelId: 'c1',
    text,
    ts: Date.now(),
    user: { id: userId, login: userId, displayName: userId, isSub: false, isVip: false, isMod: role === 'mod', isBroadcaster: false },
  };
}

function setup() {
  const room = new Room('key', 'c1', 'Canal', false);
  const msgs: ServerMessage[] = [];
  const sent: string[] = [];
  room.sendChat = async (t) => {
    sent.push(t);
  };
  const socket = { readyState: 1, send: (raw: string) => msgs.push(JSON.parse(raw)), on: () => {} };
  room.attach(socket as never);
  const tickFor = (ms: number) => {
    for (let t = 0; t < ms; t += 1000) {
      vi.advanceTimersByTime(1000);
      room.tick();
    }
  };
  return { room, msgs, sent, tickFor };
}

describe('Room', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_700_000_000_000 }));
  afterEach(() => vi.useRealTimers());

  it('mods invocam e encerram pelo chat; espectador não', () => {
    const { room } = setup();
    room.handleChat(chat('ana', '!boss iniciar'));
    expect(room.game).toBeNull();
    room.handleChat(chat('mod1', '!boss brasa', 'mod'));
    expect(room.game?.isRunning).toBe(true);
    expect(room.lastConfig.skin).toBe('brasa');
    room.handleChat(chat('mod1', '!boss parar', 'mod'));
    expect(room.game?.isRunning).toBe(false);
  });

  it('vida automática cresce com o chat ativo', () => {
    const { room } = setup();
    room.startBoss(room.lastConfig, 'auto');
    const small = room.lastConfig.maxHp;
    for (let i = 0; i < 200; i++) room.handleChat(chat(`u${i}`, 'oi'));
    room.startBoss(room.lastConfig, 'auto');
    expect(room.lastConfig.maxHp).toBeGreaterThan(small * 10);
  });

  it('boss automático avisa 1 min antes e aparece na hora', () => {
    const { room, msgs, tickFor } = setup();
    for (let i = 0; i < 10; i++) room.handleChat(chat(`u${i}`, 'oi'));
    room.updateSettings({ autoSpawn: { enabled: true, intervalMin: 5, warn: true, minChatters: 3 } });

    for (let i = 0; i < 10; i++) room.handleChat(chat(`u${i}`, 'ainda aqui'));
    tickFor(4 * 60_000);
    const warn = msgs.find((m) => m.type === 'incoming' && m.at !== null);
    expect(warn).toBeTruthy();
    expect(room.game).toBeNull();
    tickFor(61_000);
    expect(room.game?.isRunning).toBe(true);
  });

  it('não invoca com o chat vazio e adia', () => {
    const { room, tickFor } = setup();
    room.updateSettings({ autoSpawn: { enabled: true, intervalMin: 5, minChatters: 3 } });
    tickFor(5 * 60_000 + 2000);
    expect(room.game).toBeNull();
    expect(room.status().nextAutoAt).not.toBeNull();
  });

  it('apoios: bits batem no boss; pontos sem boss são devolvidos', () => {
    const { room } = setup();
    const calls: boolean[] = [];
    room.hooks.redemption = (_e, ok) => calls.push(ok);
    const pts = { kind: 'points' as const, platform: 'twitch' as const, amount: 1, user: { id: '9', name: 'Ana' }, redemptionId: 'r1' };
    room.updateSettings({ support: { points: { enabled: true } } });
    expect(room.handleSupport(pts).applied).toBe(false);
    room.startBoss({ ...room.lastConfig, maxHp: 5000 }, 'fixed');
    const r = room.handleSupport({ kind: 'bits', platform: 'twitch', amount: 100, user: { id: '1', name: 'Bia' } });
    expect(r).toEqual({ applied: true, damage: 300 });
    expect(room.handleSupport(pts).applied).toBe(true);
    expect(calls).toEqual([false, true]);
    expect(room.game!.leaderboard()[0]).toMatchObject({ name: 'Bia', damage: 300 });
  });

  it('corrida: mod abre, chat entra, larga, termina com anúncio; boss fica bloqueado durante a corrida', () => {
    const { room, msgs, sent, tickFor } = setup();
    room.handleChat(chat('mod', '!corrida iniciar', 'mod'));
    expect(room.activeGame()).toBe('race');
    room.handleChat(chat('ana', '!correr'));
    room.handleChat(chat('bia', '!correr'));
    room.handleChat(chat('mod', '!boss iniciar', 'mod'));
    expect(room.game?.isRunning).toBeFalsy();
    tickFor(46_000);
    expect(room.race?.status).toBe('running');
    tickFor(130_000);
    expect(room.race?.status).toBe('finished');
    expect(room.activeGame()).toBeNull();
    const said = msgs.flatMap((m) => (m.type === 'toast' ? [m.text] : []));
    expect(said.some((t) => t.includes('CORRIDA ABERTA'))).toBe(true);
    expect(said.some((t) => t.includes('Largou'))).toBe(true);
    expect(said.some((t) => t.includes('venceu a corrida'))).toBe(true);
    expect(sent.length).toBeGreaterThan(0);
    const race = msgs.filter((m) => m.type === 'race');
    expect(race.length).toBeGreaterThan(100);
    expect(race.some((m) => m.type === 'race' && m.state.roster?.length === 4)).toBe(true);
  });

  it('corrida: apoio durante a corrida vira poder e pontos sem corrida são devolvidos', () => {
    const { room, msgs, tickFor } = setup();
    const refunds: boolean[] = [];
    room.hooks.redemption = (_e, ok) => refunds.push(ok);
    room.startRace({ joinSec: 15 });
    room.handleChat(chat('ana', '!correr'));
    tickFor(20_000);
    room.handleSupport({ kind: 'bits', amount: 300, platform: 'twitch', user: { id: 'ana', name: 'ana' } });
    expect(msgs.some((m) => m.type === 'toast' && m.text.includes('FOGUETE'))).toBeTruthy();
    room.stopRace();
    room.handleSupport({ kind: 'points', amount: 1, platform: 'twitch', user: { id: 'ana', name: 'ana' } });
    expect(refunds).toContain(false);
  });

  it('duelo: mod abre, dois entram, FOGO, alguém vence; torcida e item por apoio', () => {
    const { room, msgs, tickFor } = setup();
    room.handleChat(chat('mod', '!duelo iniciar', 'mod'));
    expect(room.activeGame()).toBe('duel');
    room.handleChat(chat('ana', '!duelo'));
    room.handleChat(chat('bia', '!duelo'));
    room.handleChat(chat('zeca', '!1'));
    room.handleSupport({ kind: 'bits', amount: 100, platform: 'twitch', user: { id: 'zeca', name: 'zeca' } });
    // espera o FOGO e as duas atiram até alguém acertar
    for (let i = 0; i < 40 && room.duel?.status !== 'fire'; i++) tickFor(1000);
    expect(room.duel?.status).toBe('fire');
    for (let i = 0; i < 30 && room.duel?.status === 'fire'; i++) {
      room.handleChat(chat('ana', '!bang'));
      room.handleChat(chat('bia', '!bang'));
      tickFor(1000);
    }
    tickFor(5000);
    expect(room.duel?.status).toBe('finished');
    const said = msgs.flatMap((m) => (m.type === 'toast' ? [m.text] : []));
    expect(said.some((t) => t.includes('DUELO X1'))).toBe(true);
    expect(said.some((t) => t.includes('ana x bia'))).toBe(true);
    expect(said.some((t) => t.includes('COLETE para ana'))).toBe(true);
    expect(said.some((t) => t.includes('venceu'))).toBe(true);
    expect(msgs.some((m) => m.type === 'duel' && m.state.events.some((e) => e.kind === 'shot'))).toBe(true);
  });

  it('battle royale: mod abre, chat embarca, caem, alguém vence; raid vira bombardeio', () => {
    const { room, msgs, tickFor } = setup();
    room.handleChat(chat('mod', '!royale iniciar', 'mod'));
    expect(room.activeGame()).toBe('royale');
    room.handleChat(chat('ana', '!cair cidade'));
    room.handleChat(chat('bia', '!entrar'));
    room.handleChat(chat('mod', '!corrida iniciar', 'mod'));
    expect(room.race).toBeNull();
    tickFor(68_000);
    expect(room.royale?.status).toBe('play');
    room.handleSupport({ kind: 'raid', amount: 30, platform: 'twitch', user: { id: 'r', name: 'Raider' } });
    for (let i = 0; i < 400 && room.royale?.status === 'play'; i++) tickFor(1000);
    expect(room.royale?.status).toBe('finished');
    const said = msgs.flatMap((m) => (m.type === 'toast' ? [m.text] : []));
    expect(said.some((t) => t.includes('BATTLE ROYALE'))).toBe(true);
    expect(said.some((t) => t.includes('Saltaram 10'))).toBe(true);
    expect(said.some((t) => t.includes('BOMBARDEIO'))).toBe(true);
    expect(said.some((t) => t.includes('ÚLTIMO DE PÉ') || t.includes('Ninguém sobreviveu'))).toBe(true);
  });

  it('pipa combate: mod abre, chat solta pipa, relos, chat apara, alguém vira rei do céu', () => {
    const { room, msgs, tickFor } = setup();
    room.handleChat(chat('mod', '!pipa iniciar', 'mod'));
    expect(room.activeGame()).toBe('kite');
    room.handleChat(chat('ana', '!pipa raia'));
    room.handleChat(chat('bia', '!pipa'));
    room.handleChat(chat('mod', '!royale iniciar', 'mod'));
    expect(room.royale).toBeNull();
    tickFor(61_000);
    expect(room.kite?.status).toBe('play');
    room.handleChat(chat('ana', '!dibicar'));
    room.handleSupport({ kind: 'bits', amount: 100, platform: 'twitch', user: { id: 'bia', name: 'bia' } });
    for (let i = 0; i < 400 && room.kite?.status === 'play'; i++) {
      tickFor(1000);
      room.handleChat(chat(`fã${i % 5}`, '!aparar'));
    }
    expect(room.kite?.status).toBe('finished');
    const said = msgs.flatMap((m) => (m.type === 'toast' ? [m.text] : []));
    expect(said.some((t) => t.includes('PIPA COMBATE'))).toBe(true);
    expect(said.some((t) => t.includes('6 pipas no céu'))).toBe(true);
    expect(said.some((t) => t.includes('LINHA DIAMANTE para bia'))).toBe(true);
    expect(said.some((t) => t.includes('REI DO CÉU') || t.includes('Céu limpo'))).toBe(true);
    expect(msgs.some((m) => m.type === 'kite' && m.state.events.some((e) => e.kind === 'aparar'))).toBe(true);
  });

  it('pênaltis: mod abre, chat escolhe time e vota, alguém vence e o bot anuncia', () => {
    const { room, msgs, tickFor } = setup();
    room.handleChat(chat('mod', '!penaltis iniciar', 'mod'));
    expect(room.activeGame()).toBe('penalty');
    room.handleChat(chat('ana', '!a'));
    room.handleChat(chat('bia', '!b'));
    room.handleChat(chat('mod', '!pipa iniciar', 'mod'));
    expect(room.kite).toBeNull();
    tickFor(46_000);
    expect(['vote', 'kick', 'result']).toContain(room.penalty?.status);
    room.handleSupport({ kind: 'bits', amount: 100, platform: 'twitch', user: { id: 'ana', name: 'ana' } });
    for (let i = 0; i < 900 && room.penalty?.status !== 'finished'; i++) {
      room.handleChat(chat('ana', '!dir'));
      room.handleChat(chat('bia', '!esq'));
      tickFor(1000);
    }
    expect(room.penalty?.status).toBe('finished');
    const said = msgs.flatMap((m) => (m.type === 'toast' ? [m.text] : []));
    expect(said.some((t) => t.includes('DISPUTA DE PÊNALTIS'))).toBe(true);
    expect(said.some((t) => t.includes('Bola no meio'))).toBe(true);
    expect(said.some((t) => t.includes('CHUTE COLOCADO'))).toBe(true);
    expect(said.some((t) => t.includes('vence nos pênaltis'))).toBe(true);
    expect(msgs.some((m) => m.type === 'penalty' && m.state.events.some((e) => e.kind === 'kick'))).toBe(true);
  });

  it('pescaria: mod liga, chat pesca, pausa com outro jogo e apoio sem jogo vai para a pescaria', () => {
    const { room, msgs, tickFor } = setup();
    room.handleChat(chat('ana', '!pescar'));
    expect(room.fishing.snapshot().casters).toHaveLength(0); // desligada
    room.handleChat(chat('mod', '!pescaria ligar', 'mod'));
    expect(room.getSettings().fishing.enabled).toBe(true);
    room.handleChat(chat('ana', '!pescar'));
    expect(room.fishing.snapshot().casters).toHaveLength(1);
    tickFor(10_000);
    expect(Object.values(room.fishing.save.players).find((p) => p.name === 'ana')?.catches).toBe(1);
    expect(msgs.some((m) => m.type === 'fishing' && m.state.catches.length === 1)).toBe(true);
    // outro jogo começa: pausa e recolhe as linhas
    room.handleChat(chat('bia', '!pescar'));
    room.handleChat(chat('mod', '!pipa iniciar', 'mod'));
    tickFor(300);
    expect(room.fishing.snapshot().casters).toHaveLength(0);
    expect(msgs.filter((m) => m.type === 'fishing').at(-1)).toMatchObject({ state: { paused: true } });
    room.stopKite();
    tickFor(300);
    room.handleSupport({ kind: 'raid', amount: 20, platform: 'twitch', user: null });
    const said = msgs.flatMap((m) => (m.type === 'toast' ? [m.text] : []));
    expect(said.some((t) => t.includes('CARDUME'))).toBe(true);
  });
});
