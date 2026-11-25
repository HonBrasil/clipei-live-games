import {
  defaultGameSupport,
  normalizePenaltyConfig,
  parseCommand,
  supportRule,
  type ChatEvent,
  type GameSupportConfig,
  type PenaltyConfig,
  type PenaltyCorner,
  type PenaltyEvent,
  type PenaltyOutcome,
  type PenaltyPerson,
  type PenaltyReveal,
  type PenaltySnapshot,
  type PenaltyStatus,
  type SupportEvent,
} from '@clipei/shared';

/**
 * Disputa de Pênaltis: o chat se divide em dois times (!a / !b).
 * Em cada cobrança, as duas torcidas votam ao mesmo tempo, numa janela de alguns segundos
 * (o atraso da live não atrapalha): quem bate escolhe o canto, quem defende escolhe o pulo.
 * A maioria decide; o resultado tem um pouco de sorte (o goleiro pode pular certo e não pegar,
 * a bola pode ir na trave). Cinco cobranças cada (ou três) e morte súbita se empatar.
 */

const KICK_MS = 2600;
const RESULT_MS = 2600;
const SUDDEN_MAX = 10;
const CPU_NAMES = ['CPU Zagueiro', 'CPU Camisa 10', 'CPU Lateral'];

interface Member {
  id: string;
  name: string;
  color: string;
  team: 0 | 1;
  bot: boolean;
  kicked: number;
  right: number;
  /** voto de capitão (pontos): vale mais na próxima decisão */
  weight: number;
}

export interface PenaltySupportResult {
  applied: boolean;
  effect: string | null;
}

const CORNER_WORDS: Record<string, PenaltyCorner> = {
  esq: 0,
  esquerda: 0,
  e: 0,
  l: 0,
  meio: 1,
  m: 1,
  centro: 1,
  c: 1,
  dir: 2,
  direita: 2,
  d: 2,
  r: 2,
};

export class PenaltyGame {
  readonly config: PenaltyConfig;
  support: GameSupportConfig = defaultGameSupport('penalty');
  status: PenaltyStatus = 'idle';
  lobbyEndsAt: number | null = null;
  phaseEndsAt: number | null = null;
  winner: 0 | 1 | null = null;
  dirty = true;

  private members = new Map<string, Member>();
  private score: [number, number] = [0, 0];
  private marks: [PenaltyOutcome[], PenaltyOutcome[]] = [[], []];
  private placed: [boolean, boolean] = [false, false];
  private wall: [boolean, boolean] = [false, false];
  private kicking: 0 | 1 = 0;
  private kicker: Member | null = null;
  private keepers: [Member | null, Member | null] = [null, null];
  private kickVotes = new Map<string, PenaltyCorner>();
  private keepVotes = new Map<string, PenaltyCorner>();
  private reveal: PenaltyReveal | null = null;
  private events: PenaltyEvent[] = [];
  private seq = 0;

  constructor(
    config: Partial<PenaltyConfig>,
    private rng: () => number = Math.random,
  ) {
    this.config = normalizePenaltyConfig(undefined, config);
  }

  get isActive() {
    return this.status !== 'idle' && this.status !== 'finished' && this.status !== 'stopped';
  }
  get humans() {
    return [...this.members.values()].filter((m) => !m.bot).length;
  }
  teamName(t: 0 | 1 | null) {
    return t === null ? null : (t === 0 ? this.config.teamA : this.config.teamB).name;
  }
  get scoreline() {
    return [...this.score] as [number, number];
  }
  get mvp() {
    if (this.winner === null) return null;
    const best = [...this.members.values()].filter((m) => m.team === this.winner && !m.bot && m.right > 0).sort((a, b) => b.right - a.right)[0];
    return best ? { name: best.name, color: best.color } : null;
  }

  open(now = Date.now()) {
    this.status = 'lobby';
    this.lobbyEndsAt = now + this.config.joinSec * 1000;
    this.dirty = true;
  }

  startNow(now = Date.now()) {
    if (this.status === 'lobby') this.lobbyEndsAt = now;
    this.update(now);
  }

  stop() {
    if (!this.isActive) return;
    this.status = 'stopped';
    this.dirty = true;
  }

  // ─── Chat ──────────────────────────────────────────────────

  handle(e: ChatEvent, now = Date.now()) {
    const cmd = parseCommand(e.text);
    if (!cmd) return;
    const id = `${e.platform}:${e.user.id}`;
    const name = e.user.displayName;
    const color = e.user.color;
    const arg = (cmd.args[0] ?? '').toLowerCase();
    if (cmd.name === 'a' || cmd.name === 'b') return void this.join(id, name, color, cmd.name === 'a' ? 0 : 1);
    if (cmd.name === 'time') return void this.join(id, name, color, arg === 'a' || arg === '1' ? 0 : arg === 'b' || arg === '2' ? 1 : null);
    if (cmd.name === 'entrar' || cmd.name === 'penalti' || cmd.name === 'penaltis') return void this.join(id, name, color, null);
    const corner = CORNER_WORDS[cmd.name];
    if (corner !== undefined) this.vote(id, name, color, corner, now);
  }

  /** Entra num time (null = o que tiver menos gente). Não troca de time depois de entrar. */
  join(id: string, name: string, color: string | undefined, team: 0 | 1 | null) {
    if (!this.isActive || this.status === 'finished') return null;
    const cur = this.members.get(id);
    if (cur) return cur;
    const counts = this.counts();
    const t: 0 | 1 = team ?? (counts[0] <= counts[1] ? 0 : 1);
    const m: Member = { id, name: name.slice(0, 25), color: validColor(color) ?? (t === 0 ? this.config.teamA.color : this.config.teamB.color), team: t, bot: false, kicked: 0, right: 0, weight: 1 };
    this.members.set(id, m);
    this.push({ kind: 'join', team: t, name: m.name, color: m.color });
    return m;
  }

  /** Voto no canto (quem bate) ou no pulo (quem defende). Quem ainda não tem time entra no menor. */
  vote(id: string, name: string, color: string | undefined, corner: PenaltyCorner, _now = Date.now()) {
    if (this.status !== 'vote') return false;
    const m = this.members.get(id) ?? this.join(id, name, color, null);
    if (!m) return false;
    if (m.team === this.kicking) this.kickVotes.set(m.id, corner);
    else this.keepVotes.set(m.id, corner);
    this.dirty = true;
    return true;
  }

  // ─── Apoios ────────────────────────────────────────────────

  special(e: SupportEvent, now = Date.now()): PenaltySupportResult {
    const none = { applied: false, effect: null };
    if (!this.isActive) return none;
    const rule = supportRule(this.support, e);
    if (!rule) return none;
    if (e.kind === 'raid') {
      if (this.status === 'lobby') return none;
      const t: 0 | 1 = this.score[0] === this.score[1] ? (this.rng() < 0.5 ? 0 : 1) : this.score[0] < this.score[1] ? 0 : 1;
      this.placed[t] = true;
      this.push({ kind: 'item', team: t, label: 'torcida', name: this.teamName(t) ?? '' });
      return { applied: true, effect: `PRESSÃO DA TORCIDA: chute colocado para o time ${this.teamName(t)}` };
    }
    if (!e.user) return none;
    const id = `${e.platform}:${e.user.id}`;
    const m = this.members.get(id) ?? this.join(id, e.user.name, e.user.color, null);
    if (!m) return none;
    const team = this.teamName(m.team);
    if (e.kind === 'points') {
      m.weight = Math.max(m.weight, rule.p.weight ?? 3);
      this.push({ kind: 'item', team: m.team, label: 'capitao', name: m.name, color: m.color });
      return { applied: true, effect: `VOTO DE CAPITÃO para ${m.name} (vale ${m.weight})` };
    }
    if (e.kind === 'bits') {
      if (this.placed[m.team]) return none;
      this.placed[m.team] = true;
      this.push({ kind: 'item', team: m.team, label: 'colocado', name: m.name, color: m.color });
      return { applied: true, effect: `CHUTE COLOCADO para o time ${team}` };
    }
    // sub / gift
    if (this.wall[m.team]) return none;
    this.wall[m.team] = true;
    this.push({ kind: 'item', team: m.team, label: 'paredao', name: m.name, color: m.color });
    void now;
    return { applied: true, effect: `PAREDÃO no gol do time ${team}` };
  }

  // ─── Fases ─────────────────────────────────────────────────

  update(now = Date.now()) {
    if (this.status === 'lobby' && this.lobbyEndsAt !== null && now >= this.lobbyEndsAt) this.begin(now);
    else if (this.status === 'vote' && this.phaseEndsAt !== null && now >= this.phaseEndsAt) this.shoot(now);
    else if (this.status === 'kick' && this.phaseEndsAt !== null && now >= this.phaseEndsAt) {
      this.status = 'result';
      this.phaseEndsAt = now + RESULT_MS;
      this.dirty = true;
    } else if (this.status === 'result' && this.phaseEndsAt !== null && now >= this.phaseEndsAt) this.next(now);
  }

  private begin(now: number) {
    if (this.humans === 0) {
      this.status = 'stopped';
      this.dirty = true;
      return;
    }
    const counts = this.counts();
    for (const t of [0, 1] as const) {
      if (counts[t] > 0) continue;
      if (!this.config.fillBots) {
        this.status = 'stopped';
        this.dirty = true;
        return;
      }
      CPU_NAMES.forEach((n, i) =>
        this.members.set(`cpu:${t}:${i}`, { id: `cpu:${t}:${i}`, name: n, color: '#9aa0a6', team: t, bot: true, kicked: 0, right: 0, weight: 1 }),
      );
    }
    this.keepers = [this.pick(0, true), this.pick(1, true)];
    this.kicking = this.rng() < 0.5 ? 0 : 1;
    this.startVote(now);
  }

  private startVote(now: number) {
    this.status = 'vote';
    this.reveal = null;
    this.kickVotes.clear();
    this.keepVotes.clear();
    this.kicker = this.pick(this.kicking, false);
    if (this.kicker) this.kicker.kicked++;
    // goleiro sai se entrou gente nova num time da CPU? não: o goleiro é o mesmo a partida toda
    this.keepers = this.keepers.map((k, t) => k ?? this.pick(t as 0 | 1, true)) as [Member | null, Member | null];
    this.phaseEndsAt = now + this.config.voteSec * 1000;
    this.dirty = true;
  }

  /** Fecha a votação e decide a cobrança. */
  private shoot(now: number) {
    const kt = this.kicking;
    const dt = (1 - kt) as 0 | 1;
    const [corner, kickTally] = this.decide(kt, this.kickVotes);
    const [dive, keepTally] = this.decide(dt, this.keepVotes);
    // sorte: goleiro no canto certo nem sempre pega; fora do canto, a bola ainda pode ir na trave ou pra fora
    let saveChance = 0;
    if (dive === corner) saveChance = corner === 1 ? 0.72 : 0.62;
    else if (this.wall[dt] && Math.abs(dive - corner) === 1) saveChance = (this.support.sub.p.reachPct ?? 35) / 100;
    if (this.placed[kt]) saveChance *= 1 - (this.support.bits.p.reducePct ?? 60) / 100;
    let outcome: PenaltyOutcome;
    const roll = this.rng();
    if (roll < saveChance) outcome = 'save';
    else {
      const miss = this.rng();
      outcome = miss < 0.05 ? 'post' : miss < 0.09 ? 'out' : 'goal';
    }
    if (dive === corner || (this.wall[dt] && Math.abs(dive - corner) === 1)) this.wall[dt] = false;
    this.placed[kt] = false;
    if (outcome === 'goal') this.score[kt]++;
    this.marks[kt].push(outcome);
    // quem acertou o voto (para o craque da partida)
    for (const [id, c] of this.kickVotes) if (c === corner && outcome === 'goal') this.members.get(id)!.right++;
    for (const [id, c] of this.keepVotes) if (c === dive && outcome !== 'goal') this.members.get(id)!.right++;
    for (const m of this.members.values()) if (this.kickVotes.has(m.id) || this.keepVotes.has(m.id)) m.weight = 1;
    this.reveal = { corner, height: this.rng() < 0.5 ? 0 : 1, dive, outcome, kickVotes: kickTally, keepVotes: keepTally };
    this.push({ kind: 'kick', team: kt, outcome, name: this.kicker?.name, color: this.kicker?.color });
    this.status = 'kick';
    this.phaseEndsAt = now + KICK_MS;
    this.dirty = true;
  }

  private next(now: number) {
    const w = this.decided();
    if (w !== null) {
      this.winner = w;
      this.status = 'finished';
      this.phaseEndsAt = null;
      this.push({ kind: 'win', team: w, name: this.teamName(w) ?? '' });
      this.dirty = true;
      return;
    }
    this.kicking = (1 - this.kicking) as 0 | 1;
    this.startVote(now);
  }

  /** Vencedor, se já decidido (inclui decisão antecipada e morte súbita). */
  private decided(): 0 | 1 | null {
    const n = this.config.kicks;
    const [a, b] = this.score;
    const [ka, kb] = [this.marks[0].length, this.marks[1].length];
    if (ka <= n && kb <= n) {
      const leftA = n - ka;
      const leftB = n - kb;
      if (a > b + leftB) return 0;
      if (b > a + leftA) return 1;
      if (ka < n || kb < n) return null;
    }
    // morte súbita: decide quando os dois bateram o mesmo número de vezes
    if (ka !== kb) return null;
    if (a !== b) return a > b ? 0 : 1;
    if (ka >= n + SUDDEN_MAX) return this.rng() < 0.5 ? 0 : 1;
    return null;
  }

  private decide(team: 0 | 1, votes: Map<string, PenaltyCorner>): [PenaltyCorner, [number, number, number]] {
    const tally: [number, number, number] = [0, 0, 0];
    for (const [id, c] of votes) tally[c] += this.members.get(id)?.weight ?? 1;
    // CPU vota no instinto
    for (const m of this.members.values()) if (m.bot && m.team === team) tally[Math.floor(this.rng() * 3) as PenaltyCorner] += 1;
    const max = Math.max(...tally);
    if (max === 0) return [Math.floor(this.rng() * 3) as PenaltyCorner, tally];
    const best = ([0, 1, 2] as const).filter((c) => tally[c] === max);
    return [best[Math.floor(this.rng() * best.length)], tally];
  }

  /** Sorteia o cobrador (quem bateu menos) ou o goleiro do time. */
  private pick(team: 0 | 1, keeper: boolean) {
    const list = [...this.members.values()].filter((m) => m.team === team);
    if (!list.length) return null;
    const humans = list.filter((m) => !m.bot);
    const pool = humans.length ? humans : list;
    if (keeper) return pool[Math.floor(this.rng() * pool.length)];
    const min = Math.min(...pool.map((m) => m.kicked));
    const fresh = pool.filter((m) => m.kicked === min && m !== this.keepers[team]);
    const from = fresh.length ? fresh : pool;
    return from[Math.floor(this.rng() * from.length)];
  }

  private counts(): [number, number] {
    const c: [number, number] = [0, 0];
    for (const m of this.members.values()) c[m.team]++;
    return c;
  }

  // ─── Saída ─────────────────────────────────────────────────

  snapshot(now = Date.now(), peek = false): PenaltySnapshot {
    let events: PenaltyEvent[] = [];
    if (!peek) {
      events = this.events;
      this.events = [];
      this.dirty = false;
    }
    const counts = this.counts();
    const person = (m: Member | null): PenaltyPerson | null => (m ? { name: m.name, color: m.color } : null);
    const team = (t: 0 | 1) => {
      const cfg = t === 0 ? this.config.teamA : this.config.teamB;
      return { name: cfg.name, color: cfg.color, players: counts[t], score: this.score[t], marks: [...this.marks[t]], placed: this.placed[t], wall: this.wall[t] };
    };
    return {
      status: this.status,
      fullscreen: this.config.fullscreen,
      serverNow: now,
      lobbyEndsAt: this.lobbyEndsAt,
      phaseEndsAt: this.phaseEndsAt,
      teams: [team(0), team(1)],
      kicks: this.config.kicks,
      kicking: this.kicking,
      round: this.marks[this.kicking].length + (this.status === 'vote' ? 1 : 0),
      suddenDeath: this.marks[this.kicking].length >= this.config.kicks,
      kicker: person(this.kicker),
      keepers: [person(this.keepers[0]), person(this.keepers[1])],
      votes: { kick: this.kickVotes.size, keep: this.keepVotes.size },
      reveal: this.status === 'vote' ? null : this.reveal,
      winner: this.winner,
      mvp: this.mvp,
      events,
    };
  }

  private push(e: Omit<PenaltyEvent, 'id'>) {
    this.events.push({ id: ++this.seq, ...e });
    this.dirty = true;
  }
}

const validColor = (c: string | undefined) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : null);

// ─── Chat dos mods e textos do bot ───────────────────────────

export type PenaltyChatCommand = { type: 'start' } | { type: 'stop' } | { type: 'help' };

/** !penaltis iniciar / !penaltis parar (mods) e !penaltis ajuda. */
export function parsePenaltyChatCommand(e: ChatEvent): PenaltyChatCommand | null {
  const cmd = parseCommand(e.text);
  if (!cmd || !['penaltis', 'penalti', 'penalty', 'penaltys'].includes(cmd.name)) return null;
  const first = (cmd.args[0] ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (['ajuda', 'help', '?', 'comandos'].includes(first)) return { type: 'help' };
  if (!(e.user.isMod || e.user.isBroadcaster)) return null;
  if (['iniciar', 'abrir', 'comecar', 'start'].includes(first)) return { type: 'start' };
  if (['parar', 'encerrar', 'cancelar', 'stop', 'fim'].includes(first)) return { type: 'stop' };
  return null;
}

export function penaltyHelpText(status: PenaltyStatus, cfg: PenaltyConfig) {
  if (status === 'lobby') return `⚽ Escolha seu time: !a (${cfg.teamA.name}) ou !b (${cfg.teamB.name}). !entrar cai no time com menos gente.`;
  if (status === 'vote' || status === 'kick' || status === 'result')
    return '⚽ Vote com !esq, !meio ou !dir (lado da tela). Quem bate escolhe o canto, quem defende escolhe o pulo do goleiro.';
  return 'Mods: !penaltis iniciar · !penaltis parar. No jogo: !a / !b para escolher o time e !esq, !meio, !dir para votar.';
}

export function penaltyOpenAnnouncement(cfg: PenaltyConfig) {
  return `⚽ DISPUTA DE PÊNALTIS: ${cfg.teamA.name} x ${cfg.teamB.name}! Escolha seu time em ${cfg.joinSec} s: !a (${cfg.teamA.name}) ou !b (${cfg.teamB.name}).`;
}

export function penaltyStartAnnouncement(cfg: PenaltyConfig) {
  return `⚽ Bola no meio! ${cfg.kicks} cobranças para cada lado. Em cada pênalti, vote com !esq, !meio ou !dir: quem bate escolhe o canto, quem defende escolhe o pulo.`;
}

export function penaltyResultAnnouncement(winner: string | null, score: [number, number], cfg: PenaltyConfig, mvp: PenaltyPerson | null) {
  if (!winner) return '⚽ Disputa de pênaltis encerrada.';
  const craque = mvp ? ` Craque da torcida: ${mvp.name}.` : '';
  return `🏆 ${winner} vence nos pênaltis! ${cfg.teamA.name} ${score[0]} x ${score[1]} ${cfg.teamB.name}.${craque}`;
}
