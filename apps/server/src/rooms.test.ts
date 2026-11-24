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
});
