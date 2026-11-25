import {
  normalizeRoyaleConfig,
  parseCommand,
  ROYALE_FLAG,
  ROYALE_REGION_IDS,
  ROYALE_REGIONS,
  type ChatEvent,
  type RoyaleConfig,
  type RoyaleCrate,
  type RoyaleEvent,
  type RoyaleRegionId,
  type RoyaleRosterEntry,
  type RoyaleSnapshot,
  type RoyaleStatus,
  type RoyaleZone,
  type SupportEvent,
  type GameSupportConfig,
  defaultGameSupport,
  supportRule,
} from '@clipei/shared';

/**
 * Battle Royale do chat, visto de cima (mapa 960×540).
 *
 * O chat não pilota o boneco (o atraso da live não deixa): cada um anda,
 * saqueia e atira sozinho. O chat decide o que importa:
 *   - `!entrar` / `!cair <cidade|floresta|porto|fazenda>` no embarque;
 *   - `!curar` usa um curativo (1 a cada 15 s);
 *   - `!caixa <lugar>`: quem já morreu (ou só assiste) vota onde cai a caixa lendária.
 * A tempestade fecha em fases e empurra todo mundo para o meio; o último vivo vence.
 */

export const MAP_W = 960;
export const MAP_H = 540;
export const ROYALE_DROP_MS = 6000;
const SPEED = 40;
const MIN_FIELD = 10;
const MAX_MS = 6 * 60_000;
const HEAL = 40;
const HEAL_COOLDOWN_MS = 15_000;
const STAGE_WAIT_MS = [22_000, 18_000, 15_000, 13_000, 11_000, 9000, 8000];
const SHRINK_MS = 8000;
const STORM_DPS = [2, 3, 5, 8, 12, 18, 26, 35];
const VOTE_FIRST_MS = 15_000;
const VOTE_WINDOW_MS = 15_000;
const VOTE_EVERY_MS = 25_000;
const SUPPLY_FALL_MS = 4000;
/** Pouso: ninguém atira nos primeiros segundos (dá tempo de saquear). */
const GRACE_MS = 10_000;
/** Distância em que um jogador "enxerga" o outro. */
const SIGHT = 150;
/** Ritmo geral do combate (menor = partidas mais longas). */
const DMG_SCALE = 0.25;

/** alcance (px), intervalo (ms), dano, precisão — por raridade. */
export const ROYALE_GUNS = [
  { range: 140, cd: 700, dmg: 14, acc: 0.7 },
  { range: 95, cd: 1000, dmg: 36, acc: 0.78 },
  { range: 210, cd: 420, dmg: 15, acc: 0.62 },
  { range: 330, cd: 1500, dmg: 58, acc: 0.58 },
  { range: 230, cd: 200, dmg: 14, acc: 0.68 },
];
const TIER_WEIGHTS = [40, 30, 18, 9, 3];
const BOT_NAMES = ['CPU Recruta', 'CPU Cabo', 'CPU Sargento', 'CPU Tenente', 'CPU Capitão', 'CPU Major', 'CPU Coronel', 'CPU General', 'CPU Novato', 'CPU Veterano'];
const COLORS = ['#FF4D6D', '#7C5CFF', '#00E0FF', '#FFC300', '#3DFF8B', '#FF7A00', '#FF5CF4', '#9EF01A', '#5CA8FF', '#FFFFFF', '#FF3B3B', '#00FFC6'];

const REGION_ALIASES: Record<string, RoyaleRegionId> = {
  cidade: 'cidade',
  city: 'cidade',
  centro: 'cidade',
  '1': 'cidade',
  floresta: 'floresta',
  mata: 'floresta',
  bosque: 'floresta',
  '2': 'floresta',
  porto: 'porto',
  doca: 'porto',
  docas: 'porto',
  '3': 'porto',
  fazenda: 'fazenda',
  sitio: 'fazenda',
  roca: 'fazenda',
  '4': 'fazenda',
};

export function regionFrom(word: string | undefined): RoyaleRegionId | null {
  if (!word) return null;
  const w = word
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return REGION_ALIASES[w] ?? null;
}

interface Player {
  idx: number;
  id: string;
  name: string;
  color: string;
  bot: boolean;
  region: RoyaleRegionId;
  x: number;
  y: number;
  hp: number;
  shield: number;
  weapon: number;
  bandages: number;
  lastShot: number;
  lastHeal: number;
  healUntil: number;
  alive: boolean;
  kills: number;
  place: number | null;
  wx: number;
  wy: number;
  wanderUntil: number;
  inStorm: boolean;
  pendingSupply: boolean;
}

interface Crate extends RoyaleCrate {
  taken?: boolean;
}

export interface RoyaleSupportResult {
  applied: boolean;
  effect: string | null;
}

export class RoyaleGame {
  readonly config: RoyaleConfig;
  /** O que cada apoio faz (o streamer ajusta no painel). */
  support: GameSupportConfig = defaultGameSupport('royale');
  status: RoyaleStatus = 'idle';
  lobbyEndsAt: number | null = null;
  dropEndsAt: number | null = null;
  startedAt: number | null = null;
  winner: number | null = null;
  dirty = true;

  private players: Player[] = [];
  private byId = new Map<string, Player>();
  private crates: Crate[] = [];
  private crateSeq = 0;
  private cratesVersion = 0;
  private sentCrates = -1;
  private rosterVersion = 0;
  private sentRoster = -1;
  private events: RoyaleEvent[] = [];
  private seq = 0;
  private lastUpdate = 0;
  private zone: RoyaleZone = { cx: MAP_W / 2, cy: MAP_H / 2, r: 560, nx: MAP_W / 2, ny: MAP_H / 2, nr: 560, stage: 0, closesAt: null, shrinkEndsAt: null };
  private shrinkFrom: { cx: number; cy: number; r: number } | null = null;
  private votes = new Map<string, RoyaleRegionId>();
  private voteEndsAt: number | null = null;
  private nextVoteAt: number | null = null;
  private bombs: { at: number; x: number; y: number; dmg: number }[] = [];
  private deaths = 0;

  constructor(
    config: Partial<RoyaleConfig>,
    private rng: () => number = Math.random,
  ) {
    this.config = normalizeRoyaleConfig(config);
  }

  get isActive() {
    return this.status === 'lobby' || this.status === 'drop' || this.status === 'play';
  }
  get humans() {
    return this.players.filter((p) => !p.bot).length;
  }
  get aliveCount() {
    return this.players.filter((p) => p.alive).length;
  }
  get size() {
    return this.players.length;
  }
  nameOf(idx: number | null) {
    return idx === null ? null : (this.players[idx]?.name ?? null);
  }
  killsOf(idx: number) {
    return this.players[idx]?.kills ?? 0;
  }

  open(now = Date.now()) {
    this.status = 'lobby';
    this.lobbyEndsAt = now + this.config.joinSec * 1000;
    this.dirty = true;
  }

  /** Fecha o embarque agora. */
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
    if (cmd.name === 'entrar' || cmd.name === 'cair' || cmd.name === 'play' || cmd.name === 'pular') {
      this.join(id, e.user.displayName, e.user.color, regionFrom(cmd.args[0]));
    } else if (cmd.name === 'curar' || cmd.name === 'cura') {
      this.heal(id, now);
    } else if (cmd.name === 'caixa' || cmd.name === 'drop') {
      this.vote(id, regionFrom(cmd.args[0]));
    }
  }

  join(id: string, name: string, color: string | undefined, region: RoyaleRegionId | null) {
    if (this.status !== 'lobby') return false;
    const existing = this.byId.get(id);
    if (existing) {
      if (region && existing.region !== region) {
        existing.region = region;
        this.rosterVersion++;
        this.dirty = true;
      }
      return false;
    }
    if (this.players.length >= this.config.maxPlayers) return false;
    this.add(id, name, color, false, region ?? this.pickRegion());
    return true;
  }

  heal(id: string, now = Date.now()) {
    const p = this.byId.get(id);
    if (!p || !p.alive || this.status !== 'play' || p.bandages <= 0 || p.hp >= 100 || now - p.lastHeal < HEAL_COOLDOWN_MS) return false;
    this.doHeal(p, now);
    return true;
  }

  vote(id: string, region: RoyaleRegionId | null) {
    if (!region || this.voteEndsAt === null) return false;
    const p = this.byId.get(id);
    if (p?.alive) return false; // só quem morreu ou está assistindo
    this.votes.set(id, region);
    this.dirty = true;
    return true;
  }

  // ─── Apoios ────────────────────────────────────────────────

  special(e: SupportEvent, now = Date.now()): RoyaleSupportResult {
    const none = { applied: false, effect: null };
    if (!this.isActive) return none;
    const rule = supportRule(this.support, e);
    if (!rule) return none;
    if (e.kind === 'raid') {
      if (this.status !== 'play') return none;
      for (let i = 0; i < rule.p.bombs; i++) {
        const a = this.rng() * Math.PI * 2;
        const d = Math.sqrt(this.rng()) * this.zone.r * 0.9;
        this.bombs.push({ at: now + 600 + i * 450, x: clampX(this.zone.cx + Math.cos(a) * d), y: clampY(this.zone.cy + Math.sin(a) * d), dmg: rule.p.damage });
      }
      return { applied: true, effect: 'BOMBARDEIO no mapa' };
    }
    const id = e.user ? `${e.platform}:${e.user.id}` : null;
    let p = id ? this.byId.get(id) : undefined;
    if (!p && id && e.user && this.status === 'lobby' && this.players.length < this.config.maxPlayers) p = this.add(id, e.user.name, e.user.color, false, this.pickRegion());
    if (e.kind === 'points') {
      if (!p?.alive || p.bandages >= rule.p.maxBandages) return none;
      p.bandages++;
      this.push({ kind: 'item', a: p.idx, b: -1, label: 'curativo' });
      return { applied: true, effect: `CURATIVO EXTRA para ${p.name}` };
    }
    if (e.kind === 'bits') {
      if (!p?.alive) return none;
      p.shield = Math.max(p.shield, rule.p.shield);
      this.push({ kind: 'item', a: p.idx, b: -1, label: 'colete' });
      return { applied: true, effect: `COLETE ${rule.p.shield >= 100 ? 'NÍVEL 3' : `de ${rule.p.shield}%`} para ${p.name}` };
    }
    // sub / gift: caixa de suprimentos perto de quem apoiou (ou dentro da zona)
    if (p?.alive && this.status === 'lobby') {
      p.pendingSupply = true;
      return { applied: true, effect: `CAIXA DE SUPRIMENTOS no pouso de ${p.name}` };
    }
    if (this.status === 'lobby') return none;
    const at = p?.alive ? { x: clampX(p.x + 26), y: clampY(p.y - 10) } : this.pointInZone();
    this.supply(at.x, at.y, now, e.user?.name);
    return { applied: true, effect: p?.alive ? `CAIXA DE SUPRIMENTOS caindo do lado de ${p.name}` : 'CAIXA DE SUPRIMENTOS caindo no mapa' };
  }

  // ─── Simulação ─────────────────────────────────────────────

  update(now = Date.now()) {
    const dt = this.lastUpdate ? Math.min(0.25, (now - this.lastUpdate) / 1000) : 0.1;
    this.lastUpdate = now;

    if (this.status === 'lobby' && this.lobbyEndsAt !== null && now >= this.lobbyEndsAt) this.beginDrop(now);
    if (this.status === 'drop' && this.dropEndsAt !== null && now >= this.dropEndsAt) this.beginPlay(now);
    if (this.status !== 'play') return;
    this.dirty = true;

    this.updateZone(now);
    this.updateVote(now);
    this.updateBombs(now);

    const alive = this.players.filter((p) => p.alive);
    let shots = 0;
    for (const p of alive) {
      if (!p.alive) continue;
      const out = dist(p.x, p.y, this.zone.cx, this.zone.cy) > this.zone.r;
      p.inStorm = out;
      if (out) {
        p.hp -= STORM_DPS[Math.min(this.zone.stage, STORM_DPS.length - 1)] * dt;
        if (p.hp <= 0) {
          this.kill(p, null, -1, now, 'tempestade');
          continue;
        }
      }
      if (p.bot && p.hp < 45 && p.bandages > 0 && now - p.lastHeal >= HEAL_COOLDOWN_MS) this.doHeal(p, now);

      const enemy = now - (this.startedAt ?? now) >= GRACE_MS ? this.nearestEnemy(p, alive) : null;
      const gun = p.weapon >= 0 ? ROYALE_GUNS[p.weapon] : null;
      const ed = enemy ? dist(p.x, p.y, enemy.x, enemy.y) : Infinity;

      let goal: { x: number; y: number } | null = null;
      if (gun && enemy && ed <= gun.range * 1.5) {
        // combate: mantém ~70% do alcance
        const want = gun.range * 0.7;
        if (ed > want) goal = { x: enemy.x, y: enemy.y };
        else if (ed < want * 0.5) goal = { x: p.x + (p.x - enemy.x), y: p.y + (p.y - enemy.y) };
        if (ed <= gun.range && now - p.lastShot >= gun.cd) {
          p.lastShot = now;
          const hit = this.rng() < gun.acc * 0.85 * (1 - 0.35 * (ed / gun.range));
          if (shots++ < 30) this.push({ kind: 'shot', a: p.idx, b: enemy.idx, hit, weapon: p.weapon });
          if (hit) this.damage(enemy, gun.dmg * DMG_SCALE, p, now);
        }
      } else {
        const crate = this.nearestCrate(p, now, gun ? 70 : 600, gun ? p.weapon : -1);
        if (crate) {
          goal = crate;
          if (dist(p.x, p.y, crate.x, crate.y) < 8) this.loot(p, crate);
        }
      }
      if (!goal && (out || this.zone.shrinkEndsAt !== null || dist(p.x, p.y, this.zone.nx, this.zone.ny) > this.zone.nr * 0.9)) {
        // vai para dentro do próximo círculo
        if (now >= p.wanderUntil || dist(p.wx, p.wy, this.zone.nx, this.zone.ny) > this.zone.nr * 0.8) this.newWander(p, this.zone.nx, this.zone.ny, this.zone.nr * 0.7, now);
        goal = { x: p.wx, y: p.wy };
      }
      if (!goal) {
        if (now >= p.wanderUntil) this.newWander(p, this.zone.cx, this.zone.cy, this.zone.r * 0.8, now);
        goal = { x: p.wx, y: p.wy };
      }
      this.moveTo(p, goal.x, goal.y, (out ? SPEED * 1.15 : SPEED) * dt);
    }

    const left = this.players.filter((p) => p.alive);
    if (left.length <= 1 || (this.startedAt !== null && now - this.startedAt >= MAX_MS)) this.finish(now);
  }

  // ─── Saída ─────────────────────────────────────────────────

  snapshot(now = Date.now(), peek = false): RoyaleSnapshot {
    const sendRoster = peek || this.sentRoster !== this.rosterVersion;
    const sendCrates = peek || this.sentCrates !== this.cratesVersion;
    let events: RoyaleEvent[] = [];
    if (!peek) {
      this.sentRoster = this.rosterVersion;
      this.sentCrates = this.cratesVersion;
      events = this.events;
      this.events = [];
      this.dirty = false;
    }
    const counts = { cidade: 0, floresta: 0, porto: 0, fazenda: 0 } as Record<RoyaleRegionId, number>;
    for (const r of this.votes.values()) counts[r]++;
    const regions = { cidade: 0, floresta: 0, porto: 0, fazenda: 0 } as Record<RoyaleRegionId, number>;
    for (const p of this.players) regions[p.region]++;
    return {
      status: this.status,
      fullscreen: this.config.fullscreen,
      lobbyEndsAt: this.lobbyEndsAt,
      dropEndsAt: this.dropEndsAt,
      startedAt: this.startedAt,
      serverNow: now,
      rosterVersion: this.rosterVersion,
      roster: sendRoster ? this.players.map<RoyaleRosterEntry>((p) => ({ name: p.name, color: p.color, bot: p.bot || undefined, region: p.region })) : undefined,
      players: this.players.map((p) => [
        p.idx,
        Math.round(p.x),
        Math.round(p.y),
        Math.max(0, Math.round(p.hp)),
        Math.round(p.shield),
        p.weapon,
        (p.alive ? ROYALE_FLAG.alive : 0) | (now < p.healUntil ? ROYALE_FLAG.healing : 0) | (p.inStorm ? ROYALE_FLAG.storm : 0),
        p.kills,
      ]),
      cratesVersion: this.cratesVersion,
      crates: sendCrates ? this.crates.filter((c) => !c.taken).map(({ id, x, y, supply, landsAt }) => ({ id, x: Math.round(x), y: Math.round(y), supply, landsAt })) : undefined,
      zone: { ...this.zone, cx: Math.round(this.zone.cx), cy: Math.round(this.zone.cy), r: Math.round(this.zone.r) },
      vote: { counts, endsAt: this.voteEndsAt },
      alive: this.aliveCount,
      participants: this.humans,
      regions,
      events,
      winner: this.winner,
      topKills: [...this.players]
        .filter((p) => p.kills > 0)
        .sort((a, b) => b.kills - a.kills)
        .slice(0, 5)
        .map((p) => p.idx),
    };
  }

  /** Pódio final: vencedor, depois quem morreu por último. */
  podium() {
    return [...this.players]
      .sort((a, b) => (a.place ?? 0) - (b.place ?? 0))
      .slice(0, 3)
      .map((p) => ({ name: p.name, kills: p.kills, bot: p.bot }));
  }

  // ─── Fases ─────────────────────────────────────────────────

  private beginDrop(now: number) {
    if (this.humans === 0) {
      this.status = 'stopped';
      this.dirty = true;
      return;
    }
    if (this.config.fillBots) for (let i = 0; this.players.length < MIN_FIELD && i < BOT_NAMES.length; i++) this.add(`cpu:${i}`, BOT_NAMES[i], '#9aa0a6', true, this.pickRegion());
    for (const p of this.players) {
      const r = ROYALE_REGIONS[p.region];
      p.x = r.x + 14 + this.rng() * (r.w - 28);
      p.y = r.y + 14 + this.rng() * (r.h - 28);
    }
    // caixas: mais na cidade (perigosa), algumas soltas pelo mapa
    for (const id of ROYALE_REGION_IDS) {
      const r = ROYALE_REGIONS[id];
      for (let i = 0; i < r.crates; i++) this.crates.push({ id: ++this.crateSeq, x: r.x + 10 + this.rng() * (r.w - 20), y: r.y + 10 + this.rng() * (r.h - 20) });
    }
    for (let i = 0; i < 8; i++) this.crates.push({ id: ++this.crateSeq, x: 40 + this.rng() * (MAP_W - 80), y: 40 + this.rng() * (MAP_H - 80) });
    this.cratesVersion++;
    this.status = 'drop';
    this.dropEndsAt = now + ROYALE_DROP_MS;
    this.rosterVersion++;
    this.dirty = true;
  }

  private beginPlay(now: number) {
    this.status = 'play';
    this.startedAt = now;
    this.zone = { cx: MAP_W / 2, cy: MAP_H / 2, r: 560, nx: 0, ny: 0, nr: 0, stage: 0, closesAt: now + STAGE_WAIT_MS[0], shrinkEndsAt: null };
    this.pickNextCircle();
    this.nextVoteAt = now + VOTE_FIRST_MS;
    for (const p of this.players) {
      p.wanderUntil = 0;
      if (p.pendingSupply) {
        p.pendingSupply = false;
        this.supply(clampX(p.x + 26), clampY(p.y - 10), now, p.name);
      }
    }
    this.dirty = true;
  }

  private finish(now: number) {
    const alive = this.players.filter((p) => p.alive).sort((a, b) => b.hp + b.shield - (a.hp + a.shield));
    // tempo esgotado: vence quem tem mais vida
    for (const p of alive.slice(1)) this.kill(p, null, -1, now, 'tempo');
    const w = alive[0] ?? null;
    if (w) w.place = 1;
    this.winner = w ? w.idx : null;
    this.status = 'finished';
    this.voteEndsAt = null;
    if (w) this.push({ kind: 'win', a: w.idx, b: -1 });
    this.dirty = true;
  }

  // ─── Zona, votação e bombardeio ───────────────────────────

  private pickNextCircle() {
    const z = this.zone;
    const nr = z.stage === 0 ? 300 : Math.max(20, z.r * 0.6);
    const room = Math.max(0, (z.stage === 0 ? 120 : z.r) - nr);
    const a = this.rng() * Math.PI * 2;
    const d = this.rng() * room;
    z.nr = nr;
    z.nx = Math.min(MAP_W - nr * 0.5, Math.max(nr * 0.5, z.cx + Math.cos(a) * d));
    z.ny = Math.min(MAP_H - nr * 0.5, Math.max(nr * 0.5, z.cy + Math.sin(a) * d));
    if (z.stage === 0) {
      z.nx = Math.min(MAP_W - 200, Math.max(200, z.nx));
      z.ny = Math.min(MAP_H - 160, Math.max(160, z.ny));
    }
  }

  private updateZone(now: number) {
    const z = this.zone;
    if (z.closesAt !== null && now >= z.closesAt) {
      this.shrinkFrom = { cx: z.cx, cy: z.cy, r: z.r };
      z.closesAt = null;
      z.shrinkEndsAt = now + SHRINK_MS;
    }
    if (z.shrinkEndsAt !== null && this.shrinkFrom) {
      const k = Math.min(1, 1 - (z.shrinkEndsAt - now) / SHRINK_MS);
      z.cx = this.shrinkFrom.cx + (z.nx - this.shrinkFrom.cx) * k;
      z.cy = this.shrinkFrom.cy + (z.ny - this.shrinkFrom.cy) * k;
      z.r = this.shrinkFrom.r + (z.nr - this.shrinkFrom.r) * k;
      if (k >= 1) {
        z.shrinkEndsAt = null;
        this.shrinkFrom = null;
        z.stage++;
        if (z.r > 22) {
          this.pickNextCircle();
          z.closesAt = now + STAGE_WAIT_MS[Math.min(z.stage, STAGE_WAIT_MS.length - 1)];
        } else {
          z.nx = z.cx;
          z.ny = z.cy;
          z.nr = z.r;
        }
      }
    }
  }

  private updateVote(now: number) {
    if (this.voteEndsAt === null && this.nextVoteAt !== null && now >= this.nextVoteAt && this.zone.r > 70) {
      this.voteEndsAt = now + VOTE_WINDOW_MS;
      this.votes.clear();
      this.dirty = true;
    }
    if (this.voteEndsAt !== null && now >= this.voteEndsAt) {
      const counts = new Map<RoyaleRegionId, number>();
      for (const r of this.votes.values()) counts.set(r, (counts.get(r) ?? 0) + 1);
      const max = Math.max(0, ...counts.values());
      const top = max > 0 ? [...counts].filter(([, n]) => n === max).map(([r]) => r) : ROYALE_REGION_IDS;
      const region = top[Math.floor(this.rng() * top.length)];
      const r = ROYALE_REGIONS[region];
      let x = r.x + r.w / 2 + (this.rng() - 0.5) * r.w * 0.5;
      let y = r.y + r.h / 2 + (this.rng() - 0.5) * r.h * 0.5;
      // fora da zona? cai na borda de dentro, do lado escolhido
      const d = dist(x, y, this.zone.cx, this.zone.cy);
      if (d > this.zone.r * 0.8) {
        x = this.zone.cx + ((x - this.zone.cx) / d) * this.zone.r * 0.7;
        y = this.zone.cy + ((y - this.zone.cy) / d) * this.zone.r * 0.7;
      }
      this.supply(clampX(x), clampY(y), now, ROYALE_REGIONS[region].name);
      this.voteEndsAt = null;
      this.votes.clear();
      this.nextVoteAt = now + VOTE_EVERY_MS;
    }
  }

  private updateBombs(now: number) {
    for (const b of [...this.bombs]) {
      if (now < b.at) continue;
      this.bombs.splice(this.bombs.indexOf(b), 1);
      this.push({ kind: 'bomb', a: -1, b: -1, x: Math.round(b.x), y: Math.round(b.y) });
      for (const p of this.players) if (p.alive && dist(p.x, p.y, b.x, b.y) < 45) this.damage(p, b.dmg, null, now, 'bombardeio');
    }
  }

  // ─── Combate e saque ───────────────────────────────────────

  private damage(p: Player, amount: number, from: Player | null, now: number, cause?: string) {
    if (!p.alive) return;
    const absorbed = Math.min(p.shield, amount * 0.7);
    p.shield -= absorbed;
    p.hp -= amount - absorbed;
    if (p.hp <= 0) this.kill(p, from, from?.weapon ?? -1, now, cause);
  }

  private kill(p: Player, by: Player | null, weapon: number, _now: number, cause?: string) {
    if (!p.alive) return;
    p.alive = false;
    p.hp = 0;
    this.deaths++;
    p.place = this.players.length - this.deaths + 1;
    if (by) by.kills++;
    this.push({ kind: by ? 'kill' : 'storm', a: by ? by.idx : -1, b: p.idx, weapon, x: Math.round(p.x), y: Math.round(p.y), label: cause });
    // a arma dele fica no chão
    if (p.weapon >= 2) {
      this.crates.push({ id: ++this.crateSeq, x: p.x, y: p.y });
      this.cratesVersion++;
    }
  }

  private loot(p: Player, c: Crate) {
    c.taken = true;
    this.cratesVersion++;
    if (c.supply) {
      p.weapon = 4;
      p.shield = 100;
      p.bandages = Math.min(3, p.bandages + 1);
    } else {
      const tier = weighted(TIER_WEIGHTS, this.rng());
      if (tier > p.weapon) p.weapon = tier;
      if (this.rng() < 0.4) p.shield = Math.min(100, p.shield + 50);
      if (this.rng() < 0.5) p.bandages = Math.min(3, p.bandages + 1);
    }
    this.push({ kind: 'loot', a: p.idx, b: -1, weapon: p.weapon });
    this.crates = this.crates.filter((x) => !x.taken);
  }

  private supply(x: number, y: number, now: number, label?: string) {
    this.crates.push({ id: ++this.crateSeq, x, y, supply: true, landsAt: now + SUPPLY_FALL_MS });
    this.cratesVersion++;
    this.push({ kind: 'supply', a: -1, b: -1, x: Math.round(x), y: Math.round(y), label });
  }

  private doHeal(p: Player, now: number) {
    p.bandages--;
    p.hp = Math.min(100, p.hp + HEAL);
    p.lastHeal = now;
    p.healUntil = now + 1200;
    this.push({ kind: 'heal', a: p.idx, b: -1 });
  }

  private nearestEnemy(p: Player, alive: Player[]) {
    let best: Player | null = null;
    let bd = SIGHT;
    for (const o of alive) {
      if (o === p || !o.alive) continue;
      const d = dist(p.x, p.y, o.x, o.y);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  /** Caixa mais perto (as lendárias atraem de mais longe); ignora as que ainda estão caindo. */
  private nearestCrate(p: Player, now: number, maxD: number, tier: number) {
    let best: Crate | null = null;
    let bd = Infinity;
    for (const c of this.crates) {
      if (c.taken || (c.landsAt && now < c.landsAt)) continue;
      if (!c.supply && tier >= 2) continue;
      const d = dist(p.x, p.y, c.x, c.y) * (c.supply ? 0.4 : 1);
      if (d < bd && d <= (c.supply ? 260 : maxD)) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  private moveTo(p: Player, x: number, y: number, step: number) {
    const d = dist(p.x, p.y, x, y);
    if (d < 1) return;
    const k = Math.min(1, step / d);
    p.x = clampX(p.x + (x - p.x) * k);
    p.y = clampY(p.y + (y - p.y) * k);
  }

  private newWander(p: Player, cx: number, cy: number, r: number, now: number) {
    const a = this.rng() * Math.PI * 2;
    const d = Math.sqrt(this.rng()) * Math.max(10, r);
    p.wx = clampX(cx + Math.cos(a) * d);
    p.wy = clampY(cy + Math.sin(a) * d);
    p.wanderUntil = now + 4000 + this.rng() * 3000;
  }

  private pointInZone() {
    const a = this.rng() * Math.PI * 2;
    const d = Math.sqrt(this.rng()) * this.zone.r * 0.7;
    return { x: clampX(this.zone.cx + Math.cos(a) * d), y: clampY(this.zone.cy + Math.sin(a) * d) };
  }

  private pickRegion(): RoyaleRegionId {
    return ROYALE_REGION_IDS[Math.floor(this.rng() * ROYALE_REGION_IDS.length)];
  }

  private add(id: string, name: string, color: string | undefined, bot: boolean, region: RoyaleRegionId) {
    const p: Player = {
      idx: this.players.length,
      id,
      name: name.slice(0, 25),
      color: color && /^#[0-9a-f]{6}$/i.test(color) ? color : COLORS[this.players.length % COLORS.length],
      bot,
      region,
      x: MAP_W / 2,
      y: 30,
      hp: 100,
      shield: 0,
      weapon: -1,
      bandages: 0,
      lastShot: 0,
      lastHeal: -Infinity,
      healUntil: 0,
      alive: true,
      kills: 0,
      place: null,
      wx: MAP_W / 2,
      wy: MAP_H / 2,
      wanderUntil: 0,
      inStorm: false,
      pendingSupply: false,
    };
    this.players.push(p);
    this.byId.set(id, p);
    this.rosterVersion++;
    this.dirty = true;
    return p;
  }

  private push(e: Omit<RoyaleEvent, 'id'>) {
    this.events.push({ id: ++this.seq, ...e });
    this.dirty = true;
  }
}

// ─── utilidades ──────────────────────────────────────────────

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
const clampX = (x: number) => Math.min(MAP_W - 12, Math.max(12, x));
const clampY = (y: number) => Math.min(MAP_H - 12, Math.max(12, y));

function weighted(weights: number[], r: number) {
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i] / total;
    if (r < acc) return i;
  }
  return weights.length - 1;
}

// ─── Chat dos mods e textos do bot ───────────────────────────

export type RoyaleChatCommand = { type: 'start' } | { type: 'stop' } | { type: 'help' };

/** !royale (ajuda), !royale iniciar, !royale parar (mods). Também aceita !br. */
export function parseRoyaleChatCommand(e: ChatEvent): RoyaleChatCommand | null {
  const cmd = parseCommand(e.text);
  if (!cmd || (cmd.name !== 'royale' && cmd.name !== 'br')) return null;
  const first = (cmd.args[0] ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (!first || ['ajuda', 'help', '?', 'comandos'].includes(first)) return { type: 'help' };
  if (!(e.user.isMod || e.user.isBroadcaster)) return null;
  if (['iniciar', 'abrir', 'comecar', 'start'].includes(first)) return { type: 'start' };
  if (['parar', 'encerrar', 'cancelar', 'stop', 'fim'].includes(first)) return { type: 'stop' };
  return { type: 'help' };
}

export function royaleHelpText(status: RoyaleStatus) {
  if (status === 'lobby') return '🪂 Embarque aberto! !entrar (ou !cair cidade / floresta / porto / fazenda).';
  if (status === 'drop' || status === 'play') return '🔫 Battle Royale rolando! Vivos: !curar. Quem morreu ou assiste: !caixa <lugar> para escolher onde cai a caixa lendária.';
  return 'Mods: !royale iniciar · !royale parar. No jogo: !entrar, !cair <lugar>, !curar e !caixa <lugar>.';
}

export function royaleOpenAnnouncement(cfg: RoyaleConfig) {
  return `🪂 BATTLE ROYALE! Embarque aberto por ${cfg.joinSec} s: digite !entrar ou escolha onde cair com !cair cidade, !cair floresta, !cair porto ou !cair fazenda. Último de pé vence!`;
}

export function royaleStartAnnouncement(players: number) {
  return `✈️ Saltaram ${players} jogadores! Vivos: !curar (se tiver curativo). Quem cair fora: !caixa <lugar> para escolher onde cai a caixa lendária.`;
}

export function royaleResultAnnouncement(winner: string | null, kills: number, players: number) {
  if (!winner) return '🌪️ A tempestade levou todo mundo. Ninguém sobreviveu!';
  return `🏆 ${winner} é o ÚLTIMO DE PÉ entre ${players} jogadores, com ${kills} ${kills === 1 ? 'abate' : 'abates'}! 🪂`;
}
