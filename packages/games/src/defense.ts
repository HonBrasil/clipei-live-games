import {
  DEFENSE_CLASSES,
  DEFENSE_CLASS_IDS,
  DEFENSE_MONSTERS,
  DEFENSE_UPGRADES,
  DEFENSE_UPGRADE_IDS,
  defaultGameSupport,
  defensePathLength,
  defensePoint,
  defenseSlots,
  normalizeDefenseConfig,
  parseCommand,
  supportRule,
  type ChatEvent,
  type DefenseClass,
  type DefenseConfig,
  type DefenseFx,
  type DefenseMonsterKind,
  type DefenseMvp,
  type DefenseRosterEntry,
  type DefenseSnapshot,
  type DefenseStatus,
  type DefenseUpgrade,
  type GameSupportConfig,
  type SupportEvent,
} from '@clipei/shared';

/**
 * Defesa da Base: monstros andam por uma estrada da direita até a base, na esquerda.
 * Cada pessoa do chat vira uma torre ao lado da estrada (!arqueiro, !mago ou !canhao),
 * que atira sozinha. `!atk` carrega um tiro forte (x3). Entre as ondas o chat vota a
 * melhoria (!muralha, !gelo, !fogo). Se a vida da base zerar, acabou; sobreviveu a
 * todas as ondas, vitória do chat.
 */

const MIN_FIELD = 6;
const WAVE_COUNTDOWN_MS = 3500;
const POWER_COOLDOWN_MS = 8000;
const POWER_MULT = 3;
const BASE_MAX = 100;
const ALLY_SPEED = 170;
const HERO_EVERY_MS = 420;
const HERO_DMG = 34;
const KIND_IDX: Record<DefenseMonsterKind, number> = { goblin: 0, lobo: 1, ogro: 2, rei: 3 };
const CLASS_IDX: Record<DefenseClass, number> = { arqueiro: 0, mago: 1, canhao: 2 };
const DIFFICULTY = { facil: 0.75, normal: 1, dificil: 1.25 } as const;
/** Ajuste de vida dos monstros (simulado: no normal o chat vence ~2 de cada 3 partidas). */
const HP_MULT = 2.9;
/** Quanto a vida cresce com o número de torres (chat grande = monstros mais fortes). */
const TEAM_EXP = 0.85;
const BOT_NAMES = ['CPU Sentinela', 'CPU Pólvora', 'CPU Feiticeira', 'CPU Vigia', 'CPU Catapulta', 'CPU Fortaleza', 'CPU Besteiro', 'CPU Runa'];
const COLORS = ['#ff4d5e', '#3ddc6b', '#2f9bff', '#ffc83d', '#b46bff', '#ff8a3d', '#2fd6c8', '#ff6bd5'];

const CLASS_WORDS: Record<string, DefenseClass> = {
  arqueiro: 'arqueiro',
  arqueira: 'arqueiro',
  arco: 'arqueiro',
  flecha: 'arqueiro',
  mago: 'mago',
  maga: 'mago',
  magia: 'mago',
  bruxa: 'mago',
  canhao: 'canhao',
  bomba: 'canhao',
  canhoes: 'canhao',
};
const VOTE_WORDS: Record<string, DefenseUpgrade> = { muralha: 'muralha', muro: 'muralha', '1': 'muralha', gelo: 'gelo', '2': 'gelo', fogo: 'fogo', '3': 'fogo' };

const plain = (w: string) =>
  w
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

interface Tower {
  id: number;
  key: string;
  name: string;
  color: string;
  bot: boolean;
  slot: number;
  x: number;
  y: number;
  cls: DefenseClass;
  level: number;
  nextShotAt: number;
  power: boolean;
  powerReadyAt: number;
  dmg: number;
  kills: number;
}

interface Monster {
  id: number;
  kind: DefenseMonsterKind;
  p: number;
  hp: number;
  max: number;
  slowUntil: number;
  slowAmt: number;
  burnUntil: number;
  burnDps: number;
  lastBy: number;
}

interface Ally {
  id: number;
  p: number;
  dmg: number;
  hit: Set<number>;
}

/** Efeito sem o id (o jogo numera). */
type FxInput = DefenseFx extends infer F ? (F extends DefenseFx ? Omit<F, 'id'> : never) : never;

export interface DefenseSupportResult {
  applied: boolean;
  effect: string | null;
}

export class DefenseGame {
  readonly config: DefenseConfig;
  support: GameSupportConfig = defaultGameSupport('defense');
  status: DefenseStatus = 'idle';
  lobbyEndsAt: number | null = null;
  phaseEndsAt: number | null = null;
  wave = 0;
  baseHp = BASE_MAX;
  baseMax = BASE_MAX;
  result: 'won' | 'lost' | null = null;
  /** última melhoria escolhida (o anúncio usa) */
  lastUpgrade: DefenseUpgrade | null = null;
  /** a base passou de 30% para baixo nesta onda (a sala avisa o chat uma vez) */
  danger = false;
  kills = 0;
  dirty = true;

  private towers: Tower[] = [];
  private byKey = new Map<string, Tower>();
  private monsters: Monster[] = [];
  private queue: { kind: DefenseMonsterKind; at: number }[] = [];
  private allies: Ally[] = [];
  private pendingAllies: { n: number; dmg: number } | null = null;
  private hero: { name: string; until: number; nextAt: number } | null = null;
  private heroWaiting: { name: string; ms: number } | null = null;
  private votes = new Map<string, DefenseUpgrade>();
  private upgrades: Record<DefenseUpgrade, number> = { muralha: 0, gelo: 0, fogo: 0 };
  private fx: DefenseFx[] = [];
  private seq = 0;
  private rosterVersion = 0;
  private sentRoster = -1;
  private lastUpdate = 0;
  private readonly L = defensePathLength();
  private readonly slots = defenseSlots();

  constructor(
    config: Partial<DefenseConfig>,
    private rng: () => number = Math.random,
  ) {
    this.config = normalizeDefenseConfig(config);
  }

  get isActive() {
    return this.status === 'lobby' || this.status === 'wave' || this.status === 'vote';
  }
  get humans() {
    return this.towers.filter((t) => !t.bot).length;
  }
  get size() {
    return this.towers.length;
  }
  private get capacity() {
    return Math.min(this.config.maxPlayers, this.slots.length);
  }

  open(now = Date.now()) {
    this.status = 'lobby';
    this.lobbyEndsAt = now + this.config.joinSec * 1000;
    this.lastUpdate = now;
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
    if (!this.isActive) return;
    const cmd = parseCommand(e.text);
    if (!cmd) return;
    const key = `${e.platform}:${e.user.id}`;
    const word = plain(cmd.name);
    const cls = CLASS_WORDS[word] ?? (['entrar', 'torre', 'defender'].includes(word) ? null : undefined);
    if (cls !== undefined) {
      const t = this.byKey.get(key);
      if (!t) {
        this.join(key, e.user.displayName, e.user.color, cls ?? DEFENSE_CLASS_IDS[Math.floor(this.rng() * 3)]!, now);
      } else if (cls && cls !== t.cls && this.status !== 'wave') {
        t.cls = cls;
        this.rosterVersion++;
        this.dirty = true;
      } else if (this.status === 'wave') {
        this.charge(t, now);
      }
      return;
    }
    if (['atk', 'ataque', 'atacar', 'forte', 'tiro'].includes(word)) {
      const t = this.byKey.get(key);
      if (t) this.charge(t, now);
      return;
    }
    if (this.status === 'vote' && VOTE_WORDS[word]) {
      if (!this.byKey.has(key)) this.join(key, e.user.displayName, e.user.color, DEFENSE_CLASS_IDS[Math.floor(this.rng() * 3)]!, now);
      this.votes.set(key, VOTE_WORDS[word]!);
      this.dirty = true;
    }
  }

  private charge(t: Tower, now: number) {
    if (t.power || now < t.powerReadyAt) return;
    t.power = true;
    t.powerReadyAt = now + POWER_COOLDOWN_MS;
    t.nextShotAt = Math.min(t.nextShotAt, now);
    this.dirty = true;
  }

  private join(key: string, name: string, color: string | null | undefined, cls: DefenseClass, now: number): Tower | null {
    if (this.byKey.has(key)) return this.byKey.get(key)!;
    let slot = this.freeSlot();
    if (slot < 0) {
      // lugares cheios: gente de verdade tira uma torre CPU
      const bot = this.towers.find((t) => t.bot);
      if (!bot) return null;
      this.towers = this.towers.filter((t) => t !== bot);
      this.byKey.delete(bot.key);
      slot = bot.slot;
    }
    if (this.towers.length >= this.capacity && !this.towers.some((t) => t.bot)) return null;
    const s = this.slots[slot]!;
    const t: Tower = {
      id: ++this.seq,
      key,
      name: name.slice(0, 24),
      color: color || COLORS[this.towers.length % COLORS.length]!,
      bot: key.startsWith('cpu:'),
      slot,
      x: s.x,
      y: s.y,
      cls,
      level: 1,
      nextShotAt: now + 400,
      power: false,
      powerReadyAt: 0,
      dmg: 0,
      kills: 0,
    };
    this.towers.push(t);
    this.byKey.set(key, t);
    this.rosterVersion++;
    this.push({ kind: 'join', t: t.id });
    return t;
  }

  private freeSlot() {
    if (this.towers.length >= this.capacity) return -1;
    const used = new Set(this.towers.map((t) => t.slot));
    for (let i = 0; i < this.capacity; i++) if (!used.has(i)) return i;
    return -1;
  }

  // ─── Apoios ────────────────────────────────────────────────

  special(e: SupportEvent, now = Date.now()): DefenseSupportResult {
    const none = { applied: false, effect: null };
    if (!this.isActive) return none;
    const rule = supportRule(this.support, e);
    if (!rule) return none;
    const who = e.user?.name ?? 'Raid';
    if (e.kind === 'raid') {
      const n = Math.min(24, 4 + Math.floor(e.amount / 4));
      if (this.status === 'wave') this.sendAllies(n, rule.p.dmg ?? 80, who);
      else this.pendingAllies = { n, dmg: rule.p.dmg ?? 80 };
      return { applied: true, effect: `ONDA DE ${n} ALIADOS saindo da base` };
    }
    if (e.kind === 'bits') {
      if (this.status !== 'wave' || !this.monsters.length) return none;
      const dmg = Math.round(e.amount * (rule.p.power ?? 3));
      const target = this.densest();
      const at = defensePoint(target.p);
      const r = 95;
      for (const m of this.monsters) {
        const q = defensePoint(m.p);
        if (Math.hypot(q.x - at.x, q.y - at.y) <= r) this.hurt(m, dmg, -1);
      }
      this.push({ kind: 'meteor', x: Math.round(at.x), y: Math.round(at.y), r, name: who });
      this.reap(now);
      return { applied: true, effect: `METEORO de ${dmg} de dano` };
    }
    if (e.kind === 'points') {
      const key = e.user ? `${e.platform}:${e.user.id}` : null;
      let t = key ? this.byKey.get(key) : undefined;
      if (!t && key && e.user) {
        t = this.join(key, e.user.name, e.user.color, DEFENSE_CLASS_IDS[Math.floor(this.rng() * 3)]!, now) ?? undefined;
        if (t) t.level = 2;
      } else if (t) {
        if (t.level >= (rule.p.maxLevel ?? 3)) return none;
        t.level++;
      }
      if (!t) return none;
      this.rosterVersion++;
      this.push({ kind: 'level', t: t.id, level: t.level, name: t.name });
      return { applied: true, effect: `TORRE NÍVEL ${t.level} para ${t.name}` };
    }
    // sub / gift: herói
    const ms = (rule.p.seconds ?? 30) * 1000;
    if (this.status === 'wave') {
      const until = Math.max(this.hero?.until ?? now, now) + ms;
      this.hero = { name: who, until, nextAt: now };
    } else {
      this.heroWaiting = { name: who, ms: (this.heroWaiting?.ms ?? 0) + ms };
    }
    this.push({ kind: 'hero', name: who });
    return { applied: true, effect: `HERÓI ${who} defendendo a base por ${Math.round(ms / 1000)} s` };
  }

  private sendAllies(n: number, dmg: number, name: string) {
    for (let i = 0; i < n; i++) this.allies.push({ id: ++this.seq, p: 1 + i * (16 / this.L), dmg, hit: new Set() });
    this.push({ kind: 'allies', name, n });
  }

  private densest(): Monster {
    let best = this.monsters[0]!;
    let bestN = -1;
    for (const m of this.monsters) {
      const a = defensePoint(m.p);
      let n = 0;
      for (const o of this.monsters) {
        const b = defensePoint(o.p);
        if (Math.hypot(a.x - b.x, a.y - b.y) < 90) n += o.hp;
      }
      if (n > bestN) {
        bestN = n;
        best = m;
      }
    }
    return best;
  }

  // ─── Simulação ─────────────────────────────────────────────

  update(now = Date.now()) {
    const dt = Math.min(0.25, Math.max(0, (now - this.lastUpdate) / 1000));
    this.lastUpdate = now;
    if (this.status === 'lobby') {
      if (this.lobbyEndsAt !== null && now >= this.lobbyEndsAt) this.begin(now);
      return;
    }
    if (this.status === 'vote') {
      if (this.phaseEndsAt !== null && now >= this.phaseEndsAt) {
        this.applyVote();
        this.startWave(this.wave + 1, now);
      }
      return;
    }
    if (this.status !== 'wave') return;
    if (this.phaseEndsAt !== null && now < this.phaseEndsAt) return;
    this.phaseEndsAt = null;
    this.dirty = true;

    // novos monstros
    while (this.queue.length && this.queue[0]!.at <= now) {
      const q = this.queue.shift()!;
      this.spawn(q.kind);
    }
    // aliados do raid
    if (this.pendingAllies) {
      this.sendAllies(this.pendingAllies.n, this.pendingAllies.dmg, 'Raid');
      this.pendingAllies = null;
    }
    if (this.heroWaiting) {
      this.hero = { name: this.heroWaiting.name, until: now + this.heroWaiting.ms, nextAt: now };
      this.heroWaiting = null;
    }

    // andar, queimar e chegar na base
    const ice = Math.max(0.55, 1 - 0.12 * this.upgrades.gelo);
    for (const m of [...this.monsters]) {
      const def = DEFENSE_MONSTERS[m.kind];
      const slow = now < m.slowUntil ? 1 - m.slowAmt : 1;
      m.p += (def.speed * ice * slow * dt) / this.L;
      if (now < m.burnUntil) this.hurt(m, m.burnDps * dt, m.lastBy);
      if (m.p >= 1 && m.hp > 0) {
        this.monsters = this.monsters.filter((x) => x !== m);
        this.baseHp = Math.max(0, this.baseHp - def.dmg);
        this.push({ kind: 'leak', dmg: def.dmg });
        if (this.baseHp <= this.baseMax * 0.3) this.danger = true;
        if (this.baseHp <= 0) {
          this.finish('lost');
          return;
        }
      }
    }

    // aliados atropelam quem cruzar
    for (const a of this.allies) {
      a.p -= (ALLY_SPEED * dt) / this.L;
      for (const m of this.monsters) {
        if (a.hit.has(m.id) || Math.abs(m.p - a.p) * this.L > 14) continue;
        a.hit.add(m.id);
        this.hurt(m, a.dmg, -1);
      }
    }
    this.allies = this.allies.filter((a) => a.p > 0);

    // torres
    const fireMult = 1 + 0.22 * this.upgrades.fogo;
    for (const t of this.towers) {
      if (now < t.nextShotAt) continue;
      const def = DEFENSE_CLASSES[t.cls];
      const target = this.targetFor(t, def.range);
      if (!target) continue;
      const mult = (1 + 0.35 * (t.level - 1)) * fireMult * (t.power ? POWER_MULT : 1);
      const base = def.dmg * mult;
      this.push({ kind: 'shot', t: t.id, m: target.id, power: t.power });
      if (def.splash) {
        const at = defensePoint(target.p);
        for (const m of this.monsters) {
          const q = defensePoint(m.p);
          if (Math.hypot(q.x - at.x, q.y - at.y) <= def.splash) this.hit(t, m, base, now);
        }
        this.push({ kind: 'boom', x: Math.round(at.x), y: Math.round(at.y), r: def.splash });
      } else {
        this.hit(t, target, base, now);
      }
      t.power = false;
      t.nextShotAt = now + def.everyMs;
      if (t.bot && this.rng() < 0.08) this.charge(t, now);
    }

    // herói
    if (this.hero) {
      if (now >= this.hero.until) this.hero = null;
      else if (now >= this.hero.nextAt && this.monsters.length) {
        const m = this.monsters.reduce((a, b) => (b.p > a.p ? b : a));
        this.hurt(m, HERO_DMG * (1 + 0.15 * this.upgrades.fogo), -1);
        this.push({ kind: 'heroShot', m: m.id });
        this.hero.nextAt = now + HERO_EVERY_MS;
      }
    }

    this.reap(now);

    if (!this.queue.length && !this.monsters.length) {
      this.allies = [];
      if (this.wave >= this.config.waves) this.finish('won');
      else this.openVote(now);
    }
  }

  private targetFor(t: Tower, range: number) {
    let best: Monster | null = null;
    for (const m of this.monsters) {
      if (m.p < 0) continue;
      const q = defensePoint(m.p);
      if (Math.hypot(q.x - t.x, q.y - t.y) > range) continue;
      if (!best || m.p > best.p) best = m;
    }
    return best;
  }

  private hit(t: Tower, m: Monster, dmg: number, now: number) {
    const armor = t.cls === 'mago' ? 0 : DEFENSE_MONSTERS[m.kind].armor;
    this.hurt(m, dmg * (1 - armor), t.id);
    if (t.cls === 'mago') {
      m.slowAmt = Math.min(0.7, DEFENSE_CLASSES.mago.slow + 0.08 * this.upgrades.gelo);
      m.slowUntil = now + 1600;
    }
    if (this.upgrades.fogo) {
      m.burnDps = 3 * this.upgrades.fogo;
      m.burnUntil = now + 2000;
    }
  }

  private hurt(m: Monster, dmg: number, by: number) {
    if (m.hp <= 0 || dmg <= 0) return;
    const real = Math.min(m.hp, dmg);
    m.hp -= real;
    if (by >= 0) {
      m.lastBy = by;
      const t = this.towers.find((x) => x.id === by);
      if (t) t.dmg += real;
    }
  }

  /** Tira os mortos e credita o abate. */
  private reap(_now: number) {
    const dead = this.monsters.filter((m) => m.hp <= 0);
    if (!dead.length) return;
    this.monsters = this.monsters.filter((m) => m.hp > 0);
    for (const m of dead) {
      this.kills++;
      const t = this.towers.find((x) => x.id === m.lastBy);
      if (t) t.kills++;
      const q = defensePoint(m.p);
      this.push({ kind: 'kill', x: Math.round(q.x), y: Math.round(q.y), m: m.id, by: m.lastBy });
    }
  }

  private begin(now: number) {
    if (this.config.fillBots)
      for (let i = 0; this.towers.length < MIN_FIELD && i < BOT_NAMES.length; i++)
        this.join(`cpu:${i}`, BOT_NAMES[i]!, '#9aa0a6', DEFENSE_CLASS_IDS[i % 3]!, now);
    if (this.humans === 0) {
      this.status = 'stopped';
      this.dirty = true;
      return;
    }
    this.startWave(1, now);
  }

  private startWave(w: number, now: number) {
    this.wave = w;
    this.status = 'wave';
    this.danger = false;
    this.phaseEndsAt = now + WAVE_COUNTDOWN_MS;
    this.queue = this.buildWave(w, now + WAVE_COUNTDOWN_MS);
    this.dirty = true;
  }

  /** Monta a onda: mais monstros e mais fortes a cada onda; lobos em matilha; o Rei Ogro fecha a última. */
  private buildWave(w: number, t0: number) {
    const towers = Math.max(MIN_FIELD, this.towers.length);
    const count = Math.round((5 + 2.2 * w) * Math.min(2.6, 0.75 + towers / 24));
    const out: { kind: DefenseMonsterKind; at: number }[] = [];
    let at = t0;
    for (let i = 0; i < count; i++) {
      const r = this.rng();
      let kind: DefenseMonsterKind = 'goblin';
      if (w >= 3 && r < Math.min(0.3, 0.05 * w)) kind = 'ogro';
      else if (w >= 2 && r < 0.42) kind = 'lobo';
      if (kind === 'lobo') {
        // matilha: 3 lobos colados
        for (let k = 0; k < 3 && i < count; k++, i++) {
          out.push({ kind: 'lobo', at });
          at += 260;
        }
        i--;
        at += 700;
        continue;
      }
      out.push({ kind, at });
      at += kind === 'ogro' ? 1300 : 850;
    }
    if (w === this.config.waves) out.push({ kind: 'rei', at: at + 1500 });
    else if (w % 4 === 0) {
      out.push({ kind: 'ogro', at: at + 800 });
      out.push({ kind: 'ogro', at: at + 1800 });
    }
    return out;
  }

  private hpScale() {
    const towers = Math.max(MIN_FIELD, this.towers.length);
    return HP_MULT * DIFFICULTY[this.config.difficulty] * (1 + 0.2 * (this.wave - 1)) * Math.pow(towers / 8, TEAM_EXP);
  }

  private spawn(kind: DefenseMonsterKind) {
    const hp = Math.round(DEFENSE_MONSTERS[kind].hp * this.hpScale());
    this.monsters.push({ id: ++this.seq, kind, p: 0, hp, max: hp, slowUntil: 0, slowAmt: 0, burnUntil: 0, burnDps: 0, lastBy: -1 });
  }

  private openVote(now: number) {
    this.status = 'vote';
    this.phaseEndsAt = now + this.config.voteSec * 1000;
    this.votes.clear();
    for (const t of this.towers) if (t.bot) this.votes.set(t.key, DEFENSE_UPGRADE_IDS[Math.floor(this.rng() * 3)]!);
    this.dirty = true;
  }

  voteCounts(humansOnly = false): Record<DefenseUpgrade, number> {
    const c = { muralha: 0, gelo: 0, fogo: 0 };
    for (const [k, v] of this.votes) if (!humansOnly || !k.startsWith('cpu:')) c[v]++;
    return c;
  }

  private applyVote() {
    const human = this.voteCounts(true);
    const anyHuman = human.muralha + human.gelo + human.fogo > 0;
    const c = anyHuman ? human : this.voteCounts();
    let top = Math.max(c.muralha, c.gelo, c.fogo);
    let pool = DEFENSE_UPGRADE_IDS.filter((u) => c[u] === top);
    if (top === 0) {
      // ninguém votou: base machucada pede muralha, senão sorteio
      pool = this.baseHp < this.baseMax * 0.6 ? ['muralha'] : [...DEFENSE_UPGRADE_IDS];
      top = 0;
    }
    const u = pool[Math.floor(this.rng() * pool.length)]!;
    this.upgrades[u]++;
    this.lastUpgrade = u;
    if (u === 'muralha') {
      this.baseMax += 20;
      this.baseHp = Math.min(this.baseMax, this.baseHp + 45);
    }
    this.push({ kind: 'upgrade', u });
  }

  private finish(result: 'won' | 'lost') {
    this.result = result;
    this.status = 'finished';
    this.phaseEndsAt = null;
    this.queue = [];
    this.hero = null;
    this.allies = [];
    this.dirty = true;
  }

  private push(e: FxInput) {
    this.fx.push({ id: ++this.seq, ...e } as DefenseFx);
    if (this.fx.length > 400) this.fx.splice(0, this.fx.length - 400);
    this.dirty = true;
  }

  // ─── Resultado e tela ──────────────────────────────────────

  mvp(n = 3): DefenseMvp[] {
    const humans = this.towers.filter((t) => !t.bot && t.dmg > 0);
    const list = humans.length ? humans : this.towers;
    return [...list]
      .sort((a, b) => b.dmg - a.dmg)
      .slice(0, n)
      .map((t) => ({ name: t.name, color: t.color, cls: t.cls, dmg: Math.round(t.dmg), kills: t.kills }));
  }

  upgradeLevels() {
    return { ...this.upgrades };
  }

  snapshot(now = Date.now(), peek = false): DefenseSnapshot {
    const roster =
      peek || this.sentRoster !== this.rosterVersion
        ? this.towers.map<DefenseRosterEntry>((t) => ({ id: t.id, name: t.name, color: t.color, bot: t.bot }))
        : null;
    if (!peek) this.sentRoster = this.rosterVersion;
    const ice = Math.max(0.55, 1 - 0.12 * this.upgrades.gelo);
    const fx = peek ? [] : this.fx.splice(0);
    if (!peek) this.dirty = false;
    return {
      status: this.status,
      lobbyEndsAt: this.lobbyEndsAt,
      phaseEndsAt: this.phaseEndsAt,
      wave: this.wave,
      waves: this.config.waves,
      baseHp: Math.ceil(this.baseHp),
      baseMax: this.baseMax,
      roster,
      towers: this.towers.map((t) => [t.id, t.slot, CLASS_IDX[t.cls], t.level, t.power ? 2 : now >= t.powerReadyAt ? 1 : 0]),
      monsters: this.monsters.map((m) => {
        const slow = now < m.slowUntil ? 1 - m.slowAmt : 1;
        const v = (DEFENSE_MONSTERS[m.kind].speed * ice * slow) / this.L;
        return [m.id, KIND_IDX[m.kind], +m.p.toFixed(4), +v.toFixed(5), +(m.hp / m.max).toFixed(2), slow < 1 ? 1 : 0, now < m.burnUntil ? 1 : 0];
      }),
      allies: this.allies.map((a) => [a.id, +a.p.toFixed(4)]),
      hero: this.hero ? { name: this.hero.name, until: this.hero.until } : null,
      votes: this.voteCounts(),
      upgrades: { ...this.upgrades },
      pending: this.queue.length,
      kills: this.kills,
      humans: this.humans,
      result: this.result,
      mvp: this.status === 'finished' ? this.mvp() : [],
      fx,
      fullscreen: this.config.fullscreen,
      serverNow: now,
    };
  }
}

// ─── Chat dos mods e textos do bot ───────────────────────────

export type DefenseChatCommand = { type: 'start' } | { type: 'stop' } | { type: 'go' } | { type: 'help' };

/** !defesa iniciar | comecar | parar (mods) e !defesa ajuda. */
export function parseDefenseChatCommand(e: ChatEvent): DefenseChatCommand | null {
  const cmd = parseCommand(e.text);
  if (!cmd || !['defesa', 'base', 'td'].includes(plain(cmd.name))) return null;
  const a = plain(cmd.args[0] ?? '');
  if (!a || ['ajuda', 'help', '?', 'comandos'].includes(a)) return { type: 'help' };
  if (!(e.user.isMod || e.user.isBroadcaster)) return null;
  if (['iniciar', 'abrir', 'start'].includes(a)) return { type: 'start' };
  if (['comecar', 'ja', 'go', 'agora'].includes(a)) return { type: 'go' };
  if (['parar', 'encerrar', 'cancelar', 'stop', 'fim'].includes(a)) return { type: 'stop' };
  return null;
}

export function defenseHelpText(status: DefenseStatus) {
  if (status === 'lobby') return '🏰 Vire uma torre: !arqueiro (rápido, longe), !mago (deixa lento, fura armadura) ou !canhao (explosão em grupo).';
  if (status === 'wave') return '🏰 Sua torre atira sozinha. !atk = tiro forte (a cada 8 s). Ainda dá para entrar: !arqueiro, !mago ou !canhao.';
  if (status === 'vote') return '🏰 Votem a melhoria: !muralha (conserta a base), !gelo (monstros lentos) ou !fogo (mais dano). Dá para trocar de torre agora.';
  return 'Mods: !defesa iniciar · !defesa comecar · !defesa parar. No jogo: !arqueiro, !mago, !canhao, !atk e os votos !muralha, !gelo, !fogo.';
}

export function defenseOpenAnnouncement(cfg: DefenseConfig) {
  return `🏰 DEFESA DA BASE! ${cfg.waves} ondas de monstros vindo aí. Em ${cfg.joinSec} s vire uma torre: !arqueiro, !mago ou !canhao. Se a base cair, acabou!`;
}

export function defenseStartAnnouncement(towers: number, waves: number) {
  return `🏰 ${towers} torres de pé! Onda 1 de ${waves} chegando. Sua torre atira sozinha, !atk dá um tiro forte. Ainda dá para entrar no meio.`;
}

export function defenseVoteAnnouncement(wave: number, waves: number, baseHp: number, baseMax: number) {
  return `🏰 Onda ${wave} de ${waves} segurada! Base com ${Math.round((baseHp / baseMax) * 100)}%. Votem a melhoria: !muralha 🧱 · !gelo ❄️ · !fogo 🔥`;
}

export function defenseUpgradeAnnouncement(u: DefenseUpgrade, wave: number) {
  const d = DEFENSE_UPGRADES[u];
  return `${d.emoji} O chat escolheu ${d.name.toUpperCase()}: ${d.desc.toLowerCase()}. Onda ${wave} chegando!`;
}

export function defenseResultAnnouncement(result: 'won' | 'lost', wave: number, waves: number, kills: number, mvp: DefenseMvp | null) {
  const best = mvp ? ` MVP: ${mvp.name} (${DEFENSE_CLASSES[mvp.cls].emoji} ${mvp.dmg.toLocaleString('pt-BR')} de dano, ${mvp.kills} abates).` : '';
  if (result === 'won') return `🏆 A BASE RESISTIU! ${waves} ondas, ${kills} monstros derrubados.${best}`;
  return `💥 A base caiu na onda ${wave} de ${waves}. ${kills} monstros derrubados.${best} Revanche?`;
}
