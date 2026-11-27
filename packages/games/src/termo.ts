import {
  defaultGameSupport,
  normalizeTermoConfig,
  parseCommand,
  supportRule,
  type ChatEvent,
  type GameSupportConfig,
  type SupportEvent,
  type TermoConfig,
  type TermoFx,
  type TermoGuess,
  type TermoMark,
  type TermoScoreRow,
  type TermoSnapshot,
  type TermoStatus,
} from '@clipei/shared';
import { TERMO_ANSWERS, TERMO_DISPLAY, TERMO_VALID_RAW } from './termo-words.ts';
import { fishingWeek } from './fishing.ts';

/**
 * Termo do Chat: a palavra secreta de 5 letras (estilo Termo/Wordle).
 * O chat chuta com `!t palavra`; cada chute aparece na tela com as letras coloridas
 * (verde = lugar certo, amarelo = existe em outro lugar, cinza = não existe).
 * Quem acerta primeiro leva os pontos; quem descobre letras novas também pontua.
 * Uma partida tem várias palavras; o placar da partida e o ranking da semana ficam salvos.
 */

export const TERMO_GUESS_SHOWN = 6;
const BETWEEN_MS = 7000;
const WIN_POINTS = 100;
const SPEED_BONUS = 50;
const NEW_GREEN = 10;
const NEW_YELLOW = 3;

const VALID = new Set(TERMO_VALID_RAW.split(' '));

/** Tira acento e deixa só letras minúsculas. */
export function termoNormalize(w: string) {
  return w
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}

export const isTermoWord = (w: string) => VALID.has(w);
export const termoDisplay = (w: string) => TERMO_DISPLAY[w] ?? w;

/** Cores do chute (com letras repetidas do jeito do Termo). */
export function termoMarks(guess: string, answer: string): TermoMark[] {
  const marks: TermoMark[] = Array(5).fill('b');
  const left: Record<string, number> = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) marks[i] = 'g';
    else left[answer[i]!] = (left[answer[i]!] ?? 0) + 1;
  }
  for (let i = 0; i < 5; i++) {
    if (marks[i] === 'g') continue;
    const c = guess[i]!;
    if (left[c]) {
      marks[i] = 'y';
      left[c]--;
    }
  }
  return marks;
}

const RANK: Record<TermoMark, number> = { b: 0, y: 1, g: 2 };

interface Player {
  key: string;
  name: string;
  color: string;
  points: number;
  wins: number;
  lastAt: number;
  freeUntil: number;
}

/** Ranking da semana (guardado por canal). */
export interface TermoSave {
  week: string;
  players: Record<string, { name: string; color: string; points: number; wins: number }>;
  lastWeekTop: TermoScoreRow[];
  totalWords: number;
}

export const emptyTermoSave = (now = Date.now()): TermoSave => ({ week: fishingWeek(now), players: {}, lastWeekTop: [], totalWords: 0 });

export type TermoAction = { type: 'none' } | { type: 'guess'; win: boolean } | { type: 'invalid' };

export interface TermoSupportResult {
  applied: boolean;
  effect: string | null;
}

export class TermoGame {
  readonly config: TermoConfig;
  support: GameSupportConfig = defaultGameSupport('termo');
  status: TermoStatus = 'idle';
  round = 0;
  endsAt: number | null = null;
  nextAt: number | null = null;
  answer = '';
  winner: { name: string; color: string; points: number } | null = null;
  dirty = true;

  private guesses: TermoGuess[] = [];
  private tried = new Set<string>();
  private letters: Record<string, TermoMark> = {};
  private known: (string | null)[] = Array(5).fill(null);
  private hinted: boolean[] = Array(5).fill(false);
  private yellowsFound = new Set<string>();
  private players = new Map<string, Player>();
  private used = new Set<string>();
  private fx: TermoFx[] = [];
  private seq = 0;
  private roundStart = 0;
  private autoHints = 0;
  totalGuesses = 0;

  constructor(
    config: Partial<TermoConfig>,
    private save: TermoSave | null = null,
    private onSave: ((s: TermoSave) => void) | null = null,
    private rng: () => number = Math.random,
  ) {
    this.config = normalizeTermoConfig(config);
  }

  get isActive() {
    return this.status === 'playing' || this.status === 'between';
  }

  start(now = Date.now()) {
    this.round = 0;
    this.players.clear();
    this.used.clear();
    this.nextRound(now);
  }

  stop() {
    if (!this.isActive) return;
    this.status = 'stopped';
    this.endsAt = null;
    this.nextAt = null;
    this.dirty = true;
  }

  /** Mods: pula a palavra atual (mostra a resposta e vai para a próxima). */
  skip(now = Date.now()) {
    if (this.status !== 'playing') return false;
    this.endRound(now, null);
    return true;
  }

  private nextRound(now: number) {
    this.round++;
    const pool = TERMO_ANSWERS.filter((w) => !this.used.has(w));
    this.answer = (pool.length ? pool : TERMO_ANSWERS)[Math.floor(this.rng() * (pool.length || TERMO_ANSWERS.length))]!;
    this.used.add(this.answer);
    this.guesses = [];
    this.tried.clear();
    this.letters = {};
    this.known = Array(5).fill(null);
    this.hinted = Array(5).fill(false);
    this.yellowsFound.clear();
    this.winner = null;
    this.autoHints = 0;
    this.roundStart = now;
    this.status = 'playing';
    this.endsAt = now + this.config.roundSec * 1000;
    this.nextAt = null;
    this.dirty = true;
  }

  private player(e: { key: string; name: string; color?: string | null }) {
    let p = this.players.get(e.key);
    if (!p) {
      p = { key: e.key, name: e.name.slice(0, 24), color: e.color || '#ffffff', points: 0, wins: 0, lastAt: -Infinity, freeUntil: 0 };
      this.players.set(e.key, p);
    }
    return p;
  }

  // ─── Chat ──────────────────────────────────────────────────

  handle(e: ChatEvent, now = Date.now()): TermoAction {
    if (this.status !== 'playing') return { type: 'none' };
    const cmd = parseCommand(e.text);
    if (!cmd || !['t', 'termo', 'palavra', 'chute'].includes(cmd.name)) return { type: 'none' };
    const word = termoNormalize(cmd.args.join(''));
    if (word.length !== 5) return { type: 'none' };
    const key = `${e.platform}:${e.user.id}`;
    const p = this.player({ key, name: e.user.displayName, color: e.user.color });
    if (now < p.freeUntil) {
      // sub: sem espera
    } else if (now - p.lastAt < this.config.cooldownSec * 1000) return { type: 'none' };
    if (!isTermoWord(word)) {
      p.lastAt = now - this.config.cooldownSec * 500; // palavra inválida: meia espera
      this.push({ kind: 'invalid', word, name: p.name });
      return { type: 'invalid' };
    }
    if (this.tried.has(word)) return { type: 'none' };
    p.lastAt = now;
    this.tried.add(word);
    this.totalGuesses++;
    const marks = termoMarks(word, this.answer);
    // pontos por descobrir letras novas
    let found = 0;
    marks.forEach((m, i) => {
      const c = word[i]!;
      if (m === 'g' && !this.known[i]) {
        this.known[i] = c;
        found += NEW_GREEN;
      } else if (m === 'y' && !this.yellowsFound.has(c) && !this.known.includes(c)) {
        this.yellowsFound.add(c);
        found += NEW_YELLOW;
      }
      if (RANK[m] > RANK[this.letters[c] ?? 'b'] || this.letters[c] === undefined) this.letters[c] = m;
    });
    p.points += found;
    this.guesses.push({ id: ++this.seq, word, marks: marks.join(''), name: p.name, color: p.color });
    if (this.guesses.length > 40) this.guesses.splice(0, this.guesses.length - 40);
    this.dirty = true;
    if (word === this.answer) {
      this.endRound(now, p);
      return { type: 'guess', win: true };
    }
    return { type: 'guess', win: false };
  }

  // ─── Apoios ────────────────────────────────────────────────

  special(e: SupportEvent, now = Date.now()): TermoSupportResult {
    const none = { applied: false, effect: null };
    if (this.status !== 'playing') return none;
    const rule = supportRule(this.support, e);
    if (!rule) return none;
    const who = e.user?.name ?? 'Raid';
    if (e.kind === 'sub' || e.kind === 'gift') {
      if (!e.user) return none;
      const p = this.player({ key: `${e.platform}:${e.user.id}`, name: e.user.name, color: e.user.color });
      const min = rule.p.minutes ?? 10;
      p.freeUntil = Math.max(p.freeUntil, now) + min * 60_000;
      return { applied: true, effect: `CHUTE SEM ESPERA para ${p.name} por ${min} min` };
    }
    if (e.kind === 'raid') {
      const sec = rule.p.seconds ?? 60;
      this.endsAt = (this.endsAt ?? now) + sec * 1000;
      this.push({ kind: 'time', seconds: sec, by: who });
      const pos = this.reveal(who);
      return { applied: true, effect: `+${sec} s na rodada${pos !== null ? ' e uma letra revelada' : ''}` };
    }
    // bits e pontos: dica
    const pos = this.reveal(who);
    if (pos === null) return none;
    return { applied: true, effect: `DICA: a ${pos + 1}ª letra é "${this.answer[pos]!.toUpperCase()}"` };
  }

  /** Revela uma letra ainda desconhecida (null = já sabe todas menos a última). */
  private reveal(by: string | null): number | null {
    const open = [0, 1, 2, 3, 4].filter((i) => !this.known[i]);
    // nunca entrega a palavra inteira
    if (open.length <= 1) return null;
    const pos = open[Math.floor(this.rng() * open.length)]!;
    this.known[pos] = this.answer[pos]!;
    this.hinted[pos] = true;
    const c = this.answer[pos]!;
    if (this.letters[c] !== 'g') this.letters[c] = 'g';
    this.push({ kind: 'hint', pos, letter: c, by });
    return pos;
  }

  // ─── Tempo ─────────────────────────────────────────────────

  update(now = Date.now()) {
    if (this.status === 'between') {
      if (this.nextAt !== null && now >= this.nextAt) {
        if (this.round >= this.config.rounds) this.finish();
        else this.nextRound(now);
      }
      return;
    }
    if (this.status !== 'playing' || this.endsAt === null) return;
    if (now >= this.endsAt) {
      this.endRound(now, null);
      return;
    }
    if (this.config.hints) {
      const total = this.endsAt - this.roundStart;
      const passed = (now - this.roundStart) / total;
      const want = passed >= 0.75 ? 2 : passed >= 0.5 ? 1 : 0;
      while (this.autoHints < want) {
        this.autoHints++;
        this.reveal(null);
      }
    }
  }

  private endRound(now: number, winner: Player | null) {
    if (winner) {
      const left = Math.max(0, (this.endsAt ?? now) - now) / Math.max(1, this.config.roundSec * 1000);
      const pts = WIN_POINTS + Math.round(SPEED_BONUS * Math.min(1, left));
      winner.points += pts;
      winner.wins++;
      this.winner = { name: winner.name, color: winner.color, points: pts };
      this.push({ kind: 'win', name: winner.name, color: winner.color, word: this.answer, points: pts });
    } else {
      this.push({ kind: 'timeout', word: this.answer });
    }
    this.status = 'between';
    this.endsAt = null;
    this.nextAt = now + BETWEEN_MS;
    this.dirty = true;
  }

  private finish() {
    this.status = 'finished';
    this.nextAt = null;
    this.dirty = true;
    this.persist();
  }

  // ─── Placar ────────────────────────────────────────────────

  scores(n = 5): TermoScoreRow[] {
    return [...this.players.values()]
      .filter((p) => p.points > 0)
      .sort((a, b) => b.points - a.points || b.wins - a.wins)
      .slice(0, n)
      .map((p) => ({ name: p.name, color: p.color, points: p.points, wins: p.wins }));
  }

  /** Soma a partida no ranking da semana. */
  private persist() {
    if (!this.onSave) return;
    const now = Date.now();
    let s = this.save ?? emptyTermoSave(now);
    const week = fishingWeek(now);
    if (s.week !== week) s = { ...emptyTermoSave(now), lastWeekTop: rankSave(s, 3), totalWords: s.totalWords };
    for (const p of this.players.values()) {
      if (p.points <= 0) continue;
      const cur = s.players[p.key] ?? { name: p.name, color: p.color, points: 0, wins: 0 };
      s.players[p.key] = { name: p.name, color: p.color, points: cur.points + p.points, wins: cur.wins + p.wins };
    }
    s.totalWords += this.round;
    this.save = s;
    this.onSave(s);
  }

  weekTop(n = 10): TermoScoreRow[] {
    const s = this.save;
    if (!s || s.week !== fishingWeek(Date.now())) return [];
    return rankSave(s, n);
  }

  get saveData() {
    return this.save;
  }

  private push(e: TermoFxInput) {
    this.fx.push({ id: ++this.seq, ...e } as TermoFx);
    if (this.fx.length > 60) this.fx.splice(0, this.fx.length - 60);
    this.dirty = true;
  }

  snapshot(now = Date.now(), peek = false): TermoSnapshot {
    const fx = peek ? [] : this.fx.splice(0);
    if (!peek) this.dirty = false;
    const showAnswer = this.status === 'between' || this.status === 'finished';
    return {
      status: this.status,
      round: this.round,
      rounds: this.config.rounds,
      endsAt: this.endsAt,
      nextAt: this.nextAt,
      guesses: this.guesses.slice(-TERMO_GUESS_SHOWN),
      letters: { ...this.letters },
      known: [...this.known],
      hinted: [...this.hinted],
      solution: showAnswer ? termoDisplay(this.answer) : null,
      winner: this.winner,
      scores: this.scores(),
      totalGuesses: this.totalGuesses,
      players: this.players.size,
      fx,
      serverNow: now,
    };
  }
}

type TermoFxInput = TermoFx extends infer F ? (F extends TermoFx ? Omit<F, 'id'> : never) : never;

function rankSave(s: TermoSave, n: number): TermoScoreRow[] {
  return Object.values(s.players)
    .sort((a, b) => b.points - a.points || b.wins - a.wins)
    .slice(0, n);
}

// ─── Chat dos mods e textos do bot ───────────────────────────

export type TermoChatCommand = { type: 'start' } | { type: 'stop' } | { type: 'skip' } | { type: 'help' };

/** !termo (ajuda) · !termo iniciar | pular | parar (mods). */
export function parseTermoChatCommand(e: ChatEvent): TermoChatCommand | null {
  const cmd = parseCommand(e.text);
  if (!cmd || cmd.name !== 'termo') return null;
  const a = termoNormalize(cmd.args[0] ?? '');
  if (!a || ['ajuda', 'help', 'comandos'].includes(a)) return { type: 'help' };
  if (!(e.user.isMod || e.user.isBroadcaster)) return null;
  if (['iniciar', 'abrir', 'comecar', 'start'].includes(a)) return { type: 'start' };
  if (['pular', 'proxima', 'skip'].includes(a)) return { type: 'skip' };
  if (['parar', 'encerrar', 'stop', 'fim'].includes(a)) return { type: 'stop' };
  // "!termo casal" é chute, não comando
  return null;
}

export function termoHelpText() {
  return '🔤 Termo do Chat: chute a palavra de 5 letras com !t e a palavra (ex.: !t casal). Verde = letra no lugar certo, amarelo = tem na palavra em outro lugar. Acentos não importam.';
}

export function termoStartAnnouncement(cfg: TermoConfig) {
  const min = Math.round(cfg.roundSec / 60);
  return `🔤 TERMO DO CHAT! ${cfg.rounds === 1 ? 'Uma palavra' : `${cfg.rounds} palavras`} de 5 letras, ${min} min cada. Chute com !t e a palavra (ex.: !t casal). Quem acertar primeiro leva!`;
}

export function termoWinAnnouncement(name: string, word: string, points: number, round: number, rounds: number) {
  return `🎉 ${name} acertou: ${word.toUpperCase()}! +${points} pontos.${round < rounds ? ` Próxima palavra em instantes (${round + 1}/${rounds}).` : ''}`;
}

export function termoTimeoutAnnouncement(word: string, round: number, rounds: number) {
  return `⏰ Ninguém acertou! A palavra era ${word.toUpperCase()}.${round < rounds ? ` Próxima em instantes (${round + 1}/${rounds}).` : ''}`;
}

export function termoResultAnnouncement(scores: TermoScoreRow[]) {
  if (!scores.length) return '🔤 Fim do Termo do Chat! Ninguém pontuou dessa vez.';
  const podium = scores
    .slice(0, 3)
    .map((r, i) => `${['🥇', '🥈', '🥉'][i]} ${r.name} (${r.points})`)
    .join(' · ');
  return `🔤 Fim do Termo do Chat! ${podium}`;
}
