import {
  defaultGameSupport,
  parseCommand,
  supportRule,
  type ChallengeConfig,
  type ChallengeHistoryItem,
  type ChallengeItem,
  type ChallengeSnapshot,
  type ChallengeStatus,
  type ChatEvent,
  type GameSupportConfig,
  type SupportEvent,
} from '@clipei/shared';

/**
 * Desafios do Chat: o streamer cadastra os desafios dele; o chat vota (!1, !2, !3…)
 * qual ele vai cumprir; o desafio fica na tela com o tempo correndo até o streamer
 * marcar cumprido/falhou ou o tempo acabar.
 * Só a votação ocupa a tela como "jogo"; o desafio valendo fica num banner discreto
 * enquanto o streamer joga (e outros minigames podem rodar).
 */

const DONE_SHOW_MS = 8000;

interface Option {
  item: ChallengeItem;
  votes: number;
}

export type ChallengeAction = { type: 'none' } | { type: 'voted' } | { type: 'suggest'; text: string; name: string } | { type: 'status' };

export interface ChallengeSupportResult {
  applied: boolean;
  effect: string | null;
}

export class ChallengeGame {
  support: GameSupportConfig = defaultGameSupport('challenge');
  status: ChallengeStatus = 'idle';
  options: Option[] = [];
  voteEndsAt: number | null = null;
  current: { item: ChallengeItem; votes: number } | null = null;
  startedAt: number | null = null;
  endsAt: number | null = null;
  result: ChallengeHistoryItem['result'] | null = null;
  doneAt: number | null = null;
  dirty = true;
  /** desafio terminado (a sala grava no histórico) */
  finished: ChallengeHistoryItem | null = null;

  private ballots = new Map<string, { option: number; weight: number }>();
  /** peso extra (bits/pontos) de quem ainda vai votar */
  private boost = new Map<string, number>();

  constructor(private rng: () => number = Math.random) {}

  /** A votação ocupa a tela (um jogo por vez). */
  get isVoting() {
    return this.status === 'vote';
  }

  /**
   * Abre a votação. `pick`: ids escolhidos pelo streamer (senão sorteia entre os ativos).
   * Devolve um erro em texto se não der.
   */
  openVote(cfg: ChallengeConfig, pick: string[] | null, now = Date.now()): string | null {
    const active = cfg.list.filter((c) => c.enabled);
    let chosen: ChallengeItem[];
    if (pick?.length) chosen = pick.map((id) => cfg.list.find((c) => c.id === id)).filter((c): c is ChallengeItem => !!c);
    else {
      const pool = [...active];
      chosen = [];
      while (chosen.length < cfg.options && pool.length) chosen.push(pool.splice(Math.floor(this.rng() * pool.length), 1)[0]!);
    }
    if (chosen.length < 2) return 'Cadastre e ative pelo menos 2 desafios para abrir a votação.';
    this.options = chosen.slice(0, 5).map((item) => ({ item, votes: 0 }));
    this.ballots.clear();
    this.boost.clear();
    this.status = 'vote';
    this.voteEndsAt = now + cfg.voteSec * 1000;
    this.result = null;
    this.dirty = true;
    return null;
  }

  /** Começa um desafio direto, sem votação (o streamer escolheu). */
  startDirect(item: ChallengeItem, now = Date.now()) {
    this.options = [];
    this.begin({ item, votes: 0 }, now);
  }

  handle(e: ChatEvent, cfg: ChallengeConfig, now = Date.now()): ChallengeAction {
    const cmd = parseCommand(e.text);
    if (!cmd) return { type: 'none' };
    if (cmd.name === 'sugerir') {
      if (cfg.suggestions === 'off') return { type: 'none' };
      if (cfg.suggestions === 'subs' && !(e.user.isSub || e.user.isMod || e.user.isVip || e.user.isBroadcaster) && !this.subPass.has(this.key(e))) return { type: 'none' };
      const text = cmd.args.join(' ').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (text.length < 4) return { type: 'none' };
      return { type: 'suggest', text, name: e.user.displayName };
    }
    if (this.status === 'vote') {
      const n = Number(cmd.name);
      if (Number.isInteger(n) && n >= 1 && n <= this.options.length) {
        const key = this.key(e);
        const weight = this.boost.get(key) ?? 1;
        const prev = this.ballots.get(key);
        if (prev) this.options[prev.option]!.votes -= prev.weight;
        this.ballots.set(key, { option: n - 1, weight });
        this.options[n - 1]!.votes += weight;
        this.dirty = true;
        return { type: 'voted' };
      }
    }
    if (cmd.name === 'desafio' && !cmd.args.length) return { type: 'status' };
    return { type: 'none' };
  }

  /** Quem deu sub pode sugerir mesmo com "só subs" (vale o sub dado na hora, em qualquer plataforma). */
  private subPass = new Set<string>();
  private key(e: { platform: string; user: { id: string } }) {
    return `${e.platform}:${e.user.id}`;
  }

  special(e: SupportEvent, now = Date.now()): ChallengeSupportResult {
    const none = { applied: false, effect: null };
    const rule = supportRule(this.support, e);
    if (!rule) return none;
    if (e.kind === 'sub' || e.kind === 'gift') {
      if (!e.user) return none;
      this.subPass.add(`${e.platform}:${e.user.id}`);
      return { applied: true, effect: `${e.user.name} pode sugerir um desafio com !sugerir` };
    }
    if (e.kind === 'raid') {
      if (this.status !== 'active' || this.endsAt === null) return none;
      const min = rule.p.minutes ?? 2;
      this.endsAt += min * 60_000;
      this.dirty = true;
      return { applied: true, effect: `+${min} min no desafio` };
    }
    // bits e pontos: voto turbinado
    if (this.status !== 'vote' || !e.user) return none;
    const key = `${e.platform}:${e.user.id}`;
    const w = rule.p.votes ?? 2;
    const ballot = this.ballots.get(key);
    if (ballot) {
      // já votou: o voto passa a valer mais na hora
      this.options[ballot.option]!.votes += w - ballot.weight;
      ballot.weight = w;
      this.dirty = true;
      return { applied: true, effect: `o voto de ${e.user.name} agora vale ${w}` };
    }
    this.boost.set(key, w);
    return { applied: true, effect: `o próximo voto de ${e.user.name} vale ${w}` };
  }

  update(now = Date.now()) {
    if (this.status === 'vote' && this.voteEndsAt !== null && now >= this.voteEndsAt) {
      const top = Math.max(...this.options.map((o) => o.votes));
      const best = this.options.filter((o) => o.votes === top);
      this.begin(best[Math.floor(this.rng() * best.length)]!, now);
      return;
    }
    if (this.status === 'active' && this.endsAt !== null && now >= this.endsAt) this.finish('timeout', now);
    if (this.status === 'done' && this.doneAt !== null && now - this.doneAt >= DONE_SHOW_MS) {
      this.status = 'idle';
      this.dirty = true;
    }
  }

  private begin(o: { item: ChallengeItem; votes: number }, now: number) {
    this.current = o;
    this.status = 'active';
    this.voteEndsAt = null;
    this.startedAt = now;
    this.endsAt = o.item.minutes > 0 ? now + o.item.minutes * 60_000 : null;
    this.dirty = true;
  }

  /** Streamer/mod marca o resultado. */
  finish(result: ChallengeHistoryItem['result'], now = Date.now()) {
    if (this.status === 'vote' && result === 'skipped') {
      this.status = 'idle';
      this.options = [];
      this.voteEndsAt = null;
      this.dirty = true;
      return true;
    }
    if (this.status !== 'active' || !this.current) return false;
    this.result = result;
    this.status = 'done';
    this.doneAt = now;
    this.endsAt = null;
    this.finished = { text: this.current.item.text, result, votes: this.current.votes, at: now };
    this.dirty = true;
    return true;
  }

  snapshot(now = Date.now()): ChallengeSnapshot {
    this.dirty = false;
    return {
      status: this.status,
      options: this.options.map((o) => ({ text: o.item.text, minutes: o.item.minutes, votes: o.votes })),
      voteEndsAt: this.voteEndsAt,
      voters: this.ballots.size,
      current: this.current ? { text: this.current.item.text, minutes: this.current.item.minutes, votes: this.current.votes } : null,
      startedAt: this.startedAt,
      endsAt: this.endsAt,
      result: this.result,
      serverNow: now,
    };
  }
}

// ─── Comandos dos mods e textos do bot ───────────────────────

export type ChallengeChatCommand = { type: 'vote' } | { type: 'done' } | { type: 'failed' } | { type: 'stop' };

/** !desafio votar | cumprido | falhou | parar (mods). */
export function parseChallengeChatCommand(e: ChatEvent): ChallengeChatCommand | null {
  const cmd = parseCommand(e.text);
  if (!cmd || cmd.name !== 'desafio' || !cmd.args.length) return null;
  if (!(e.user.isMod || e.user.isBroadcaster)) return null;
  const a = cmd.args[0]!.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (['votar', 'votacao', 'iniciar', 'abrir'].includes(a)) return { type: 'vote' };
  if (['cumprido', 'feito', 'ok', 'concluido'].includes(a)) return { type: 'done' };
  if (['falhou', 'falha', 'nao'].includes(a)) return { type: 'failed' };
  if (['parar', 'cancelar', 'pular'].includes(a)) return { type: 'stop' };
  return null;
}

const minutesText = (m: number) => (m > 0 ? `${m} min` : 'até cumprir');

export function challengeVoteAnnouncement(options: { text: string; minutes: number }[], sec: number) {
  return `🎯 DESAFIO PARA O STREAMER! Votem em ${sec}s: ${options.map((o, i) => `!${i + 1} ${o.text} (${minutesText(o.minutes)})`).join(' · ')}`;
}

export function challengeStartAnnouncement(text: string, minutes: number, votes: number) {
  return `🎯 O chat escolheu${votes ? ` (${votes} ${votes === 1 ? 'voto' : 'votos'})` : ''}: "${text}"${minutes > 0 ? ` por ${minutes} min` : ''}. Valendo!`;
}

export function challengeResultAnnouncement(text: string, result: ChallengeHistoryItem['result']) {
  if (result === 'done') return `✅ Desafio cumprido: "${text}". Mandou bem!`;
  if (result === 'failed') return `❌ Não rolou: "${text}". O chat venceu essa!`;
  if (result === 'timeout') return `⏰ Acabou o tempo do desafio "${text}"!`;
  return `🎯 Desafio cancelado.`;
}
