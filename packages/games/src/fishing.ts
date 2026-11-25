import {
  FISH_RARITIES,
  FISH_RARITY_ORDER,
  FISH_SPECIES,
  defaultGameSupport,
  normalizeFishingConfig,
  parseCommand,
  supportRule,
  type ChatEvent,
  type FishCatch,
  type FishId,
  type FishRarity,
  type FishingCaster,
  type FishingConfig,
  type FishingRankRow,
  type FishingSnapshot,
  type FishingStats,
  type GameSupportConfig,
  type SupportEvent,
} from '@clipei/shared';

/**
 * Pescaria da Live: roda a live inteira, num canto do overlay.
 * Cada pessoa lança com !pescar (com espera entre lançamentos); alguns segundos depois sai
 * um peixe sorteado por raridade, com peso e pontos. O progresso fica salvo por canal:
 * coleção de espécies, pontos da semana (zera toda segunda) e pontos de sempre.
 */

const MAX_PLAYERS = 3000;
const RECENT_MS = 25_000;

export interface FishingPlayer {
  name: string;
  color: string;
  /** pontos da semana atual */
  week: number;
  weekCatches: number;
  total: number;
  catches: number;
  species: Partial<Record<FishId, number>>;
  best?: { fish: FishId; kg: number };
  lastCastAt?: number;
  /** isca rara: próximos lançamentos com sorte */
  luckCasts?: number;
  /** vara de ouro: sorte até esse horário */
  luckUntil?: number;
}

/** O que fica salvo de cada canal. */
export interface FishingSave {
  week: string;
  players: Record<string, FishingPlayer>;
  lastWeekTop: FishingRankRow[];
  species: Partial<Record<FishId, number>>;
  totalCatches: number;
  biggest: { name: string; fish: FishId; kg: number } | null;
}

interface Cast {
  id: number;
  key: string;
  name: string;
  color: string;
  castAt: number;
  biteAt: number;
  luck: number;
  double: boolean;
}

export type FishingAction =
  | { type: 'none' }
  | { type: 'cast' }
  | { type: 'cooldown'; waitSec: number }
  | { type: 'say'; text: string };

export interface FishingSupportResult {
  applied: boolean;
  effect: string | null;
}

const COLORS = ['#FF4D6D', '#7C5CFF', '#00E0FF', '#FFC300', '#3DFF8B', '#FF7A00', '#FF5CF4', '#9EF01A', '#5CA8FF'];

export function emptyFishingSave(week: string): FishingSave {
  return { week, players: {}, lastWeekTop: [], species: {}, totalCatches: 0, biggest: null };
}

/** Semana no horário de Brasília, no formato ISO (2026-W48). Vira toda segunda à meia-noite. */
export function fishingWeek(now: number) {
  const d = new Date(now - 3 * 3600_000);
  const day = (d.getUTCDay() + 6) % 7; // segunda = 0
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((thursday.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export const fishInfo = (id: FishId) => FISH_SPECIES.find((f) => f.id === id)!;
export const kgText = (kg: number) => (kg < 1 ? `${Math.round(kg * 1000)} g` : `${kg.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`);

export class FishingGame {
  config: FishingConfig = normalizeFishingConfig(undefined);
  support: GameSupportConfig = defaultGameSupport('fishing');
  dirty = true;
  readonly save: FishingSave;

  private casts = new Map<string, Cast>();
  private recent: FishCatch[] = [];
  private seq = 0;
  private shoalUntil = 0;

  constructor(
    save: FishingSave | null,
    private onSave: (s: FishingSave) => void = () => {},
    private rng: () => number = Math.random,
    now = Date.now(),
  ) {
    this.save = save ?? emptyFishingSave(fishingWeek(now));
    this.rollWeek(now);
  }

  get shoalActive() {
    return Date.now() < this.shoalUntil;
  }

  // ─── Chat ──────────────────────────────────────────────────

  handle(e: ChatEvent, now = Date.now()): FishingAction {
    const cmd = parseCommand(e.text);
    if (!cmd) return { type: 'none' };
    const key = `${e.platform}:${e.user.id}`;
    switch (cmd.name) {
      case 'pescar':
      case 'pesca':
      case 'pescaria':
      case 'fish':
        return this.cast(key, e.user.displayName, e.user.color, now);
      case 'peixes':
      case 'colecao':
      case 'minhapesca':
        return { type: 'say', text: this.summary(key, e.user.displayName) };
      case 'ranking':
      case 'top':
        return { type: 'say', text: this.rankingText() };
      default:
        return { type: 'none' };
    }
  }

  /** Lança a linha. `instant` (pontos do canal) pula a espera. */
  cast(key: string, name: string, color: string | undefined, now = Date.now(), instant = false): FishingAction {
    if (!this.config.enabled) return { type: 'none' };
    this.rollWeek(now);
    if (this.casts.has(key)) return { type: 'none' };
    const p = this.player(key, name, color);
    const shoal = now < this.shoalUntil;
    const wait = (this.config.cooldownSec * 1000) / (shoal ? 2 : 1);
    if (!instant && p.lastCastAt && now - p.lastCastAt < wait) return { type: 'cooldown', waitSec: Math.ceil((wait - (now - p.lastCastAt)) / 1000) };
    let luck = 1;
    if (p.luckCasts && p.luckCasts > 0) {
      luck *= 2.5;
      p.luckCasts--;
    }
    if (p.luckUntil && now < p.luckUntil) luck *= 2;
    if (shoal) luck *= 2;
    if (instant) luck *= 1.3;
    p.lastCastAt = now;
    const bite = shoal ? 2500 + this.rng() * 2500 : 4000 + this.rng() * 5000;
    this.casts.set(key, { id: ++this.seq, key, name: p.name, color: p.color, castAt: now, biteAt: now + bite, luck: Math.min(5, luck), double: shoal });
    this.dirty = true;
    return { type: 'cast' };
  }

  // ─── Apoios ────────────────────────────────────────────────

  special(e: SupportEvent, now = Date.now()): FishingSupportResult {
    const none = { applied: false, effect: null };
    if (!this.config.enabled) return none;
    const rule = supportRule(this.support, e);
    if (!rule) return none;
    if (e.kind === 'raid') {
      this.shoal(now, rule.p.seconds ?? 120);
      return { applied: true, effect: `CARDUME! Sorte e pontos em dobro por ${Math.round((rule.p.seconds ?? 120) / 60)} min` };
    }
    if (!e.user) return none;
    const key = `${e.platform}:${e.user.id}`;
    const p = this.player(key, e.user.name, e.user.color);
    if (e.kind === 'points') {
      const r = this.cast(key, e.user.name, e.user.color, now, true);
      return r.type === 'cast' ? { applied: true, effect: `${p.name} lançou a linha na hora` } : none;
    }
    if (e.kind === 'bits') {
      p.luckCasts = (p.luckCasts ?? 0) + (rule.p.casts ?? 3);
      this.persist();
      return { applied: true, effect: `ISCA RARA para ${p.name} (${p.luckCasts} lançamentos com sorte)` };
    }
    p.luckUntil = Math.max(p.luckUntil ?? 0, now) + (rule.p.minutes ?? 30) * 60_000;
    this.persist();
    return { applied: true, effect: `VARA DE OURO para ${p.name} (${rule.p.minutes ?? 30} min de sorte em dobro)` };
  }

  /** Cardume: sorte e pontos em dobro e espera pela metade. */
  shoal(now: number, seconds: number) {
    this.shoalUntil = Math.max(this.shoalUntil, now) + seconds * 1000;
    this.dirty = true;
  }

  // ─── Tempo ─────────────────────────────────────────────────

  /** Resolve as linhas que já beliscaram. Devolve as pescas novas (para o bot anunciar). */
  update(now = Date.now()): FishCatch[] {
    const out: FishCatch[] = [];
    for (const c of [...this.casts.values()]) {
      if (now < c.biteAt) continue;
      this.casts.delete(c.key);
      out.push(this.land(c, now));
    }
    const before = this.recent.length;
    this.recent = this.recent.filter((r) => now - r.at < RECENT_MS);
    if (out.length || before !== this.recent.length) this.dirty = true;
    if (this.shoalUntil && now >= this.shoalUntil) {
      this.shoalUntil = 0;
      this.dirty = true;
    }
    return out;
  }

  /** Para tudo (outro jogo começou ou a pescaria foi desligada): as linhas voltam sem peixe. */
  reelIn() {
    if (!this.casts.size) return;
    for (const c of this.casts.values()) {
      const p = this.save.players[c.key];
      if (p) p.lastCastAt = undefined;
    }
    this.casts.clear();
    this.dirty = true;
  }

  private land(c: Cast, now: number): FishCatch {
    const rarity = this.rollRarity(c.luck);
    const pool = FISH_SPECIES.filter((f) => f.rarity === rarity);
    const sp = pool[Math.floor(this.rng() * pool.length)];
    // peso: mais comum perto do meio, às vezes um gigante
    const t = Math.min(1, Math.pow(this.rng(), 1.6) + (this.rng() < 0.05 ? 0.4 : 0));
    const kg = Math.round((sp.min + (sp.max - sp.min) * t) * 100) / 100;
    const base = FISH_RARITIES[rarity].points;
    const factor = 0.6 + t;
    const points = Math.round(base * factor * (c.double ? 2 : 1));
    const p = this.save.players[c.key];
    const firstTime = !p.species[sp.id];
    p.species[sp.id] = (p.species[sp.id] ?? 0) + 1;
    p.week += points;
    p.total += points;
    p.catches++;
    p.weekCatches++;
    if (rarity !== 'lixo' && (!p.best || FISH_RARITY_ORDER.indexOf(rarity) > FISH_RARITY_ORDER.indexOf(fishInfo(p.best.fish).rarity) || (fishInfo(p.best.fish).rarity === rarity && kg > p.best.kg)))
      p.best = { fish: sp.id, kg };
    this.save.species[sp.id] = (this.save.species[sp.id] ?? 0) + 1;
    this.save.totalCatches++;
    if (rarity !== 'lixo' && (!this.save.biggest || kg > this.save.biggest.kg)) this.save.biggest = { name: p.name, fish: sp.id, kg };
    const fc: FishCatch = { id: c.id, name: p.name, color: p.color, fish: sp.id, rarity, kg, points, firstTime, at: now };
    this.recent.unshift(fc);
    this.recent = this.recent.slice(0, 4);
    this.persist();
    return fc;
  }

  private rollRarity(luck: number): FishRarity {
    const w = FISH_RARITY_ORDER.map((r) => {
      const base = FISH_RARITIES[r].weight;
      if (r === 'lixo') return base / luck;
      if (r === 'raro' || r === 'epico' || r === 'lendario') return base * luck;
      return base;
    });
    let x = this.rng() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < w.length; i++) {
      x -= w[i];
      if (x <= 0) return FISH_RARITY_ORDER[i];
    }
    return 'comum';
  }

  /** Virou a semana: guarda o pódio e zera os pontos da semana. */
  private rollWeek(now: number) {
    const wk = fishingWeek(now);
    if (this.save.week === wk) return;
    this.save.lastWeekTop = this.rank('week', 3);
    for (const p of Object.values(this.save.players)) {
      p.week = 0;
      p.weekCatches = 0;
    }
    this.save.week = wk;
    this.persist();
  }

  private player(key: string, name: string, color: string | undefined) {
    let p = this.save.players[key];
    if (!p) {
      p = this.save.players[key] = {
        name: name.slice(0, 25),
        color: color && /^#[0-9a-f]{6}$/i.test(color) ? color : COLORS[Object.keys(this.save.players).length % COLORS.length],
        week: 0,
        weekCatches: 0,
        total: 0,
        catches: 0,
        species: {},
      };
      this.prune();
    } else {
      p.name = name.slice(0, 25);
      if (color && /^#[0-9a-f]{6}$/i.test(color)) p.color = color;
    }
    return p;
  }

  /** Limite de jogadores guardados por canal: sai quem tem menos pontos e nada na semana. */
  private prune() {
    const keys = Object.keys(this.save.players);
    if (keys.length <= MAX_PLAYERS) return;
    const out = keys
      .filter((k) => this.save.players[k].week === 0)
      .sort((a, b) => this.save.players[a].total - this.save.players[b].total)
      .slice(0, keys.length - MAX_PLAYERS);
    for (const k of out) delete this.save.players[k];
  }

  private persist() {
    this.dirty = true;
    this.onSave(this.save);
  }

  // ─── Saída ─────────────────────────────────────────────────

  rank(by: 'week' | 'total', n: number): FishingRankRow[] {
    return Object.values(this.save.players)
      .filter((p) => (by === 'week' ? p.week : p.total) > 0)
      .sort((a, b) => (by === 'week' ? b.week - a.week : b.total - a.total))
      .slice(0, n)
      .map((p) => ({ name: p.name, color: p.color, points: by === 'week' ? p.week : p.total, catches: by === 'week' ? p.weekCatches : p.catches }));
  }

  snapshot(now = Date.now(), paused = false): FishingSnapshot {
    this.dirty = false;
    return {
      enabled: this.config.enabled,
      paused,
      corner: this.config.corner,
      hint: this.config.hint,
      serverNow: now,
      casters: [...this.casts.values()].map<FishingCaster>((c) => ({ id: c.id, name: c.name, color: c.color, castAt: c.castAt, lucky: c.luck > 1.2 })),
      catches: this.recent.filter((r) => now - r.at < RECENT_MS),
      shoalUntil: now < this.shoalUntil ? this.shoalUntil : null,
      week: this.rank('week', 3),
    };
  }

  stats(): FishingStats {
    return {
      week: this.save.week,
      weekTop: this.rank('week', 10),
      allTime: this.rank('total', 10),
      lastWeekTop: this.save.lastWeekTop,
      players: Object.keys(this.save.players).length,
      totalCatches: this.save.totalCatches,
      species: { ...this.save.species } as Record<string, number>,
      biggest: this.save.biggest,
    };
  }

  /** Texto do !peixes. */
  summary(key: string, name: string) {
    const p = this.save.players[key];
    if (!p || !p.catches) return `🎣 ${name}, você ainda não pescou nada. Digite !pescar!`;
    const real = FISH_SPECIES.filter((f) => f.rarity !== 'lixo');
    const got = real.filter((f) => p.species[f.id]).length;
    const pos = this.rank('week', MAX_PLAYERS).findIndex((r) => r.name === p.name) + 1;
    const best = p.best ? ` · maior: ${fishInfo(p.best.fish).name} de ${kgText(p.best.kg)}` : '';
    return `🎣 ${p.name}: ${p.week} pts na semana${pos ? ` (${pos}º)` : ''} · ${p.catches} pescas · coleção ${got}/${real.length}${best}`;
  }

  /** Texto do !ranking. */
  rankingText() {
    const top = this.rank('week', 3);
    if (!top.length) return '🎣 Ninguém pescou nesta semana ainda. Digite !pescar!';
    const medals = ['🥇', '🥈', '🥉'];
    return `🎣 Ranking da semana: ${top.map((r, i) => `${medals[i]} ${r.name} (${r.points})`).join(' · ')}`;
  }
}

/** !pescaria ligar / desligar / cardume (mods). */
export type FishingChatCommand = { type: 'on' } | { type: 'off' } | { type: 'shoal' };

export function parseFishingChatCommand(e: ChatEvent): FishingChatCommand | null {
  const cmd = parseCommand(e.text);
  if (!cmd || !(e.user.isMod || e.user.isBroadcaster)) return null;
  if (cmd.name === 'cardume') return { type: 'shoal' };
  if (cmd.name !== 'pescaria') return null;
  const a = (cmd.args[0] ?? '').toLowerCase();
  if (['ligar', 'iniciar', 'abrir', 'on'].includes(a)) return { type: 'on' };
  if (['desligar', 'parar', 'fechar', 'off'].includes(a)) return { type: 'off' };
  if (a === 'cardume') return { type: 'shoal' };
  return null;
}

export function fishingCatchAnnouncement(c: FishCatch) {
  const r = FISH_RARITIES[c.rarity];
  const icon = c.rarity === 'lendario' ? '🌟🎣' : c.rarity === 'epico' ? '💜🎣' : '🎣';
  return `${icon} ${c.name} pescou um ${fishInfo(c.fish).name} ${r.label.toUpperCase()} de ${kgText(c.kg)}! +${c.points} pts`;
}
