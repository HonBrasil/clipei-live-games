import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, type ChatEvent, type ServerMessage } from '@clipei/shared';
import { migrateAutoSpawn, Room } from './rooms.ts';

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

  it('modo loop: espera o OBS, abre os jogos em rodízio e mod pula a espera', () => {
    const { room, msgs, tickFor } = setup();
    let obs = 0;
    Object.defineProperty(room, 'overlayCount', { get: () => obs });
    room.handleChat(chat('mod', '!loop ligar', 'mod'));
    room.updateSettings({ loop: { games: ['race', 'kite'], gapSec: 30 } });
    tickFor(2000);
    expect(room.loopSnapshot()).toMatchObject({ enabled: true, blocked: 'obs', next: null });
    obs = 1;
    tickFor(2000);
    expect(room.loopSnapshot().next).toBe('race');
    tickFor(16_000);
    expect(room.activeGame()).toBe('race');
    room.stopRace();
    tickFor(2000);
    expect(room.loopSnapshot().next).toBe('kite');
    room.handleChat(chat('mod', '!loop pular', 'mod'));
    tickFor(1500);
    expect(room.activeGame()).toBe('kite');
    expect(room.loopSnapshot().rounds).toBe(2);
    const said = msgs.flatMap((m) => (m.type === 'toast' ? [m.text] : []));
    expect(said.some((t) => t.includes('Próximo minigame'))).toBe(true);
    expect(msgs.some((m) => m.type === 'loop')).toBe(true);
  });

  it('defesa da base: mod abre, chat vira torre, onda, votação e apoio', () => {
    const { room, msgs, tickFor } = setup();
    room.handleChat(chat('mod', '!defesa iniciar', 'mod'));
    expect(room.activeGame()).toBe('defense');
    room.handleChat(chat('ana', '!arqueiro'));
    room.handleChat(chat('bia', '!canhao'));
    room.handleChat(chat('mod', '!defesa começar', 'mod'));
    expect(room.defense?.status).toBe('wave');
    let i = 0;
    while (room.defense?.status === 'wave' && i++ < 1200) tickFor(100);
    expect(room.defense?.status).toBe('vote');
    room.handleChat(chat('ana', '!fogo'));
    room.handleSupport({ kind: 'sub', amount: 1, platform: 'twitch', user: { id: 'bia', name: 'bia', color: '#fff' } } as never);
    i = 0;
    while (room.defense?.status === 'vote' && i++ < 300) tickFor(100);
    expect(room.defense?.status).toBe('wave');
    room.stopDefense();
    const said = msgs.flatMap((m) => (m.type === 'toast' ? [m.text] : []));
    expect(said.some((t) => t.includes('DEFESA DA BASE'))).toBe(true);
    expect(said.some((t) => t.includes('Votem a melhoria'))).toBe(true);
    expect(said.some((t) => t.includes('FOGO'))).toBe(true);
    expect(said.some((t) => t.includes('HERÓI'))).toBe(true);
    expect(msgs.some((m) => m.type === 'defense' && m.state.monsters.length > 0)).toBe(true);
    expect(room.activeGame()).toBeNull();
  });

  it('temporizador: boss automático antigo migra e o minigame abre no intervalo com aviso', () => {
    const migrated = migrateAutoSpawn(mergeSettings(DEFAULT_SETTINGS, { autoSpawn: { enabled: true, intervalMin: 45, minChatters: 2 } }), {
      autoSpawn: { enabled: true, intervalMin: 45, minChatters: 2 },
    });
    expect(migrated.autoSpawn.enabled).toBe(false);
    expect(migrated.loop).toMatchObject({ enabled: true, mode: 'timer', intervalMin: 45, games: ['boss'], minChatters: 2 });
    expect(migrateAutoSpawn(migrated, { autoSpawn: { enabled: true }, loop: {} }).loop).toBe(migrated.loop);

    const { room, msgs, tickFor } = setup();
    Object.defineProperty(room, 'overlayCount', { get: () => 1 });
    room.updateSettings({ loop: { enabled: true, mode: 'timer', intervalMin: 5, games: ['race'] } });
    tickFor(2000);
    expect(room.loopSnapshot()).toMatchObject({ mode: 'timer', next: 'race' });
    const toasts = () => msgs.flatMap((m) => (m.type === 'toast' ? [m.text] : []));
    expect(toasts().some((t) => t.includes('Próximo minigame'))).toBe(false);
    tickFor(4 * 60_000);
    expect(toasts().some((t) => t.includes('Próximo minigame'))).toBe(true);
    expect(room.activeGame()).toBeNull();
    tickFor(60_000);
    expect(room.activeGame()).toBe('race');
  });

  it('chat simulado desliga sozinho quando o minigame termina', () => {
    const { room, tickFor } = setup();
    room.simulator.configure({ running: true, viewers: 10, messagesPerSecond: 5 });
    room.startRace();
    tickFor(2000);
    expect(room.simulator.status.running).toBe(true);
    room.stopRace();
    tickFor(2000);
    expect(room.simulator.status.running).toBe(true);
    tickFor(3000);
    expect(room.simulator.status.running).toBe(false);
    expect(room.status().simulating).toBe(false);
    // ligado sem jogo: desliga depois de 2 min
    room.simulator.configure({ running: true });
    tickFor(100_000);
    expect(room.simulator.status.running).toBe(true);
    tickFor(25_000);
    expect(room.simulator.status.running).toBe(false);
    room.simulator.stop();
  });

  it('termo do chat: mod abre, chat chuta, acerto anunciado e partida termina', () => {
    const { room, msgs, tickFor } = setup();
    room.handleChat(chat('mod', '!termo iniciar', 'mod'));
    expect(room.activeGame()).toBe('termo');
    room.updateSettings({ termo: { rounds: 1 } });
    const answer = room.termo!.answer;
    room.handleChat(chat('ana', '!t xqzwk'));
    room.handleChat(chat('bia', `!t ${answer}`));
    expect(room.termo!.status).toBe('between');
    tickFor(8000);
    // a partida aberta guardou a config antiga (3 palavras): vai para a segunda
    expect(room.termo!.round).toBe(2);
    room.stopTermo();
    const said = msgs.flatMap((m) => (m.type === 'toast' ? [m.text] : []));
    expect(said.some((t) => t.includes('TERMO DO CHAT'))).toBe(true);
    expect(said.some((t) => t.includes('bia acertou'))).toBe(true);
    expect(said.some((t) => t.includes('Palavra 2 de 3'))).toBe(true);
    expect(msgs.some((m) => m.type === 'termo' && m.state.guesses.length > 0)).toBe(true);
    expect(room.activeGame()).toBeNull();
  });

  it('desafios do chat: votação, desafio valendo, sugestão e histórico', () => {
    const { room, msgs, tickFor } = setup();
    room.updateSettings({ challenge: { voteSec: 20 } });
    room.handleChat(chat('mod', '!desafio votar', 'mod'));
    expect(room.activeGame()).toBe('challenge');
    room.handleChat(chat('ana', '!2'));
    room.handleChat(chat('bia', '!2'));
    tickFor(21_000);
    expect(room.challenge.status).toBe('active');
    expect(room.activeGame()).toBeNull();
    // outro jogo pode rodar com o desafio valendo
    expect(room.startRace().ok).toBe(true);
    room.stopRace();
    room.handleChat(chat('mod', '!desafio cumprido', 'mod'));
    expect(room.challenge.status).toBe('done');
    expect(room.getSettings().challenge.history[0]).toMatchObject({ result: 'done', votes: 2 });
    // sugestão de sub vai para aprovação
    room.handleChat({ ...chat('cris', '!sugerir dançar no chat'), user: { ...chat('cris', '').user, isSub: true } });
    expect(room.getSettings().challenge.pending[0]).toMatchObject({ text: 'dançar no chat', name: 'cris' });
    const said = msgs.flatMap((m) => (m.type === 'toast' ? [m.text] : []));
    expect(said.some((t) => t.includes('DESAFIO PARA O STREAMER'))).toBe(true);
    expect(said.some((t) => t.includes('O chat escolheu'))).toBe(true);
    expect(said.some((t) => t.includes('Desafio cumprido'))).toBe(true);
  });
});
