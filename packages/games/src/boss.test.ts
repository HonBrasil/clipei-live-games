import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '@clipei/shared';
import { parseCommand } from '@clipei/shared';
import { BossGame } from './boss.ts';

function msg(userId: string, text: string, extra: Partial<ChatEvent['user']> = {}): ChatEvent {
  return {
    id: Math.random().toString(36),
    platform: 'simulator',
    channelId: 'demo',
    text,
    ts: 0,
    user: {
      id: userId,
      login: userId,
      displayName: userId,
      isSub: false,
      isMod: false,
      isVip: false,
      isBroadcaster: false,
      ...extra,
    },
  };
}

function setup(maxHp = 1000, cooldownMs = 2000, durationSec = 0) {
  let t = 1_000_000;
  const clock = { advance: (ms: number) => (t += ms) };
  // random fixo em 0.5 → dano base 12, sem crítico (0.5 > 0.25)
  const game = new BossGame(
    { skin: 'glitchador', name: 'Teste', maxHp, cooldownMs, durationSec },
    { random: () => 0.5, now: () => t },
  );
  game.start();
  return { game, clock };
}

describe('parseCommand', () => {
  it('reconhece comandos com acento e maiúsculas', () => {
    expect(parseCommand('!ATÁQUE agora')).toEqual({ name: 'ataque', args: ['agora'] });
    expect(parseCommand('oi chat')).toBeNull();
    expect(parseCommand('!')).toBeNull();
  });
});

describe('BossGame', () => {
  it('aplica dano com !atk e ignora outras mensagens', () => {
    const { game } = setup();
    game.handle(msg('ana', 'oi'));
    game.handle(msg('ana', '!atk'));
    const s = game.snapshot();
    expect(s.hp).toBe(1000 - 12);
    expect(s.totalHits).toBe(1);
    expect(s.recentHits).toHaveLength(1);
    expect(game.snapshot().recentHits).toHaveLength(0); // fila esvaziada
  });

  it('respeita cooldown por espectador', () => {
    const { game, clock } = setup();
    game.handle(msg('ana', '!atk'));
    game.handle(msg('ana', '!atk')); // ignorado
    game.handle(msg('bia', '!atk')); // outra pessoa, conta
    expect(game.snapshot().totalHits).toBe(2);
    clock.advance(2000);
    game.handle(msg('ana', '!atk'));
    expect(game.snapshot().totalHits).toBe(3);
  });

  it('!ult funciona uma vez por pessoa', () => {
    const { game } = setup();
    game.handle(msg('ana', '!ult'));
    game.handle(msg('ana', '!ult'));
    const s = game.snapshot();
    expect(s.totalHits).toBe(1);
    expect(s.recentHits[0].ult).toBe(true);
    expect(s.recentHits[0].damage).toBe(50); // 40 + floor(0.5*21)
  });

  it('muda de fase e anuncia vitória com golpe final', () => {
    const { game, clock } = setup(100, 0);
    const phases: number[] = [];
    let victory: string | null = null;
    for (let i = 0; i < 50 && game.isRunning; i++) {
      clock.advance(10);
      for (const e of game.handle(msg(`u${i}`, '!atk'))) {
        if (e.type === 'phase') phases.push(e.phase);
        if (e.type === 'victory') victory = e.finalBlow;
      }
    }
    expect(phases).toEqual([2, 3]);
    expect(victory).not.toBeNull();
    const s = game.snapshot();
    expect(s.hp).toBe(0);
    expect(s.status).toBe('victory');
    expect(s.finalBlow).toBe(victory);
  });

  it('boss foge quando o tempo acaba', () => {
    const { game, clock } = setup(1000, 0, 30);
    game.handle(msg('ana', '!atk'));
    expect(game.update()).toEqual([]);
    clock.advance(30_000);
    const events = game.update();
    expect(events[0]?.type).toBe('escaped');
    expect(game.snapshot().status).toBe('escaped');
    expect(game.handle(msg('bia', '!atk'))).toEqual([]);
  });

  it('ranking ordena por dano', () => {
    const { game, clock } = setup(10_000, 0);
    game.handle(msg('ana', '!atk'));
    clock.advance(1);
    game.handle(msg('ana', '!atk'));
    game.handle(msg('bia', '!atk'));
    const top = game.leaderboard();
    expect(top[0].name).toBe('ana');
    expect(top[0].hits).toBe(2);
  });
});
