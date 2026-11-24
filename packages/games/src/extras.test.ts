import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, type ChatEvent } from '@clipei/shared';
import { ChatActivity } from './activity.ts';
import { autoBossHp, niceRound } from './auto-hp.ts';
import { parseBossChatCommand } from './commands.ts';
import { AutoSpawner, RETRY_MS } from './scheduler.ts';

function ev(text: string, role: 'viewer' | 'mod' | 'streamer' = 'viewer'): ChatEvent {
  return {
    id: 'x',
    platform: 'twitch',
    channelId: 'c',
    text,
    ts: 0,
    user: {
      id: 'u',
      login: 'u',
      displayName: 'u',
      isSub: false,
      isVip: false,
      isMod: role === 'mod',
      isBroadcaster: role === 'streamer',
    },
  };
}

describe('ChatActivity', () => {
  it('conta pessoas diferentes na janela', () => {
    let t = 0;
    const a = new ChatActivity(60_000, () => t);
    a.record('ana');
    a.record('ana');
    a.record('bia');
    expect(a.count()).toBe(2);
    t = 61_000;
    a.record('caio');
    expect(a.count()).toBe(1);
  });
});

describe('autoBossHp', () => {
  it('cresce com o chat e respeita mínimo', () => {
    const small = autoBossHp({ activeChatters: 5, cooldownMs: 2000, durationSec: 180 });
    const big = autoBossHp({ activeChatters: 500, cooldownMs: 2000, durationSec: 180 });
    expect(small).toBeGreaterThanOrEqual(800);
    expect(big).toBeGreaterThan(small * 50);
  });
  it('luta mais longa = mais vida', () => {
    const a = autoBossHp({ activeChatters: 100, cooldownMs: 2000, durationSec: 60 });
    const b = autoBossHp({ activeChatters: 100, cooldownMs: 2000, durationSec: 300 });
    expect(b).toBeGreaterThan(a * 4);
  });
  it('arredonda para números redondos', () => {
    expect(niceRound(9837)).toBe(9800);
    expect(niceRound(123_456)).toBe(120_000);
  });
});

describe('parseBossChatCommand', () => {
  it('mods controlam, espectadores só pedem ajuda', () => {
    expect(parseBossChatCommand(ev('!boss iniciar', 'mod'))).toEqual({ type: 'start', skin: undefined });
    expect(parseBossChatCommand(ev('!boss dragão', 'streamer'))).toEqual({ type: 'start', skin: 'brasa' });
    expect(parseBossChatCommand(ev('!boss iniciar slime', 'mod'))).toEqual({ type: 'start', skin: 'gosmao' });
    expect(parseBossChatCommand(ev('!boss surpresa', 'mod'))).toEqual({ type: 'start', skin: 'random' });
    expect(parseBossChatCommand(ev('!boss parar', 'mod'))).toEqual({ type: 'stop' });
    expect(parseBossChatCommand(ev('!boss iniciar'))).toBeNull();
    expect(parseBossChatCommand(ev('!boss'))).toEqual({ type: 'help' });
    expect(parseBossChatCommand(ev('!atk', 'mod'))).toBeNull();
  });
});

describe('AutoSpawner', () => {
  const settings = { enabled: true, intervalMin: 30, skin: 'random' as const, warn: true, minChatters: 3 };
  const ok = { running: false, activeChatters: 10, live: true };

  it('avisa 1 min antes e invoca na hora', () => {
    let t = 0;
    const s = new AutoSpawner(settings, () => t);
    expect(s.nextAt).toBe(30 * 60_000);
    t = 28 * 60_000;
    expect(s.tick(ok)).toBeNull();
    t = 29 * 60_000 + 1;
    expect(s.tick(ok)?.type).toBe('warn');
    expect(s.tick(ok)).toBeNull(); // avisa uma vez só
    t = 30 * 60_000;
    expect(s.tick(ok)).toEqual({ type: 'spawn' });
  });

  it('adia quando o chat está parado ou a live está fora do ar', () => {
    let t = 0;
    const s = new AutoSpawner(settings, () => t);
    t = 30 * 60_000;
    expect(s.tick({ ...ok, activeChatters: 1 })).toEqual({ type: 'postponed', at: t + RETRY_MS });
    t += RETRY_MS;
    expect(s.tick({ ...ok, live: false })?.type).toBe('postponed');
  });

  it('luta manual pausa e reinicia a contagem', () => {
    let t = 0;
    const s = new AutoSpawner(settings, () => t);
    t = 10 * 60_000;
    s.fightStarted();
    expect(s.tick({ ...ok, running: true })).toBeNull();
    t = 15 * 60_000;
    s.fightEnded();
    expect(s.nextAt).toBe(45 * 60_000);
  });

  it('desligado não faz nada', () => {
    const s = new AutoSpawner({ ...settings, enabled: false }, () => 999_999_999);
    expect(s.tick(ok)).toBeNull();
  });
});

describe('mergeSettings', () => {
  it('valida limites', () => {
    const m = mergeSettings(DEFAULT_SETTINGS, { volume: 500, autoSpawn: { intervalMin: 1, skin: 'xxx', enabled: true } });
    expect(m.volume).toBe(100);
    expect(m.autoSpawn.intervalMin).toBe(5);
    expect(m.autoSpawn.skin).toBe('random');
    expect(m.autoSpawn.enabled).toBe(true);
  });
});

import { BossGame } from './boss.ts';
import { supportDamage, supportLabel } from './support.ts';
import type { SupportEvent } from '@clipei/shared';

describe('apoios', () => {
  const s = DEFAULT_SETTINGS.support;
  const e = (kind: SupportEvent['kind'], amount: number): SupportEvent => ({
    kind,
    amount,
    platform: 'twitch',
    user: { id: '1', name: 'Ana' },
  });

  it('calcula dano por tipo e respeita o liga/desliga', () => {
    expect(supportDamage(e('bits', 100), s)).toBe(300);
    expect(supportDamage(e('sub', 1), s)).toBe(250);
    expect(supportDamage(e('gift', 5), s)).toBe(1250);
    expect(supportDamage(e('raid', 40), s)).toBe(200);
    expect(supportDamage(e('points', 1), s)).toBeNull(); // pontos começam desligados
    expect(supportDamage(e('bits', 100), { ...s, bits: { enabled: false, damagePerBit: 3 } })).toBeNull();
    expect(supportLabel(e('gift', 1))).toBe('1 sub de presente');
  });

  it('golpe especial ignora cooldown, entra no ranking e pode dar o golpe final', () => {
    const g = new BossGame({ skin: 'glitchador', name: 'B', maxHp: 1000, durationSec: 0, cooldownMs: 99999 }, { random: () => 0.5 });
    g.start();
    g.special({ id: 'twitch:1', name: 'Ana', platform: 'twitch', damage: 400, kind: 'bits', label: '100 bits', amount: 100 });
    const snap = g.snapshot();
    expect(snap.hp).toBe(600);
    expect(snap.recentHits[0].special).toBe('bits');
    expect(snap.leaderboard[0]).toMatchObject({ name: 'Ana', damage: 400 });
    const ev = g.special({ id: 'twitch:2', name: 'Bia', platform: 'twitch', damage: 5000, kind: 'gift', label: '20 subs', amount: 20 });
    expect(ev.some((x) => x.type === 'victory')).toBe(true);
    expect(g.snapshot().finalBlow).toBe('Bia');
  });
});
