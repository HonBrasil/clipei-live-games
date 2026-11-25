// ─────────────────────────────────────────────────────────────
//  Clipei Live Games — tipos compartilhados entre servidor e front
// ─────────────────────────────────────────────────────────────

/** Plataformas de onde chegam mensagens de chat. */
export type Platform = 'twitch' | 'kick' | 'youtube' | 'simulator';

/** Quem mandou a mensagem, já normalizado para todas as plataformas. */
export interface ChatUser {
  id: string;
  login: string;
  displayName: string;
  color?: string;
  isSub: boolean;
  isMod: boolean;
  isVip: boolean;
  isBroadcaster: boolean;
}

/**
 * Evento único de chat. Cada adaptador (Twitch, Kick, YouTube) converte a
 * mensagem original para este formato — os jogos nunca sabem de onde veio.
 */
export interface ChatEvent {
  id: string;
  platform: Platform;
  /** ID do canal do streamer na plataforma de origem. */
  channelId: string;
  user: ChatUser;
  text: string;
  ts: number;
}

export interface ParsedCommand {
  name: string;
  args: string[];
}

/** Extrai `!comando arg1 arg2` de uma mensagem. Retorna null se não for comando. */
export function parseCommand(text: string, prefix = '!'): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(prefix)) return null;
  const parts = trimmed.slice(prefix.length).split(/\s+/).filter(Boolean);
  const name = parts.shift()?.toLowerCase();
  if (!name) return null;
  // remove acentos para aceitar "!atáque", "!ataque" etc.
  const normalized = name.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return { name: normalized, args: parts };
}

// ─── Boss coletivo ──────────────────────────────────────────

export type BossStatus = 'idle' | 'running' | 'victory' | 'escaped';
export type BossPhase = 1 | 2 | 3;

/** Catálogo de bosses que o streamer pode escolher (o visual fica no front). */
export const BOSS_SKINS = {
  glitchador: { name: 'Glitchador', title: 'O Ciclope Glitch', emoji: '👁️', intro: 'saiu de um bug no servidor' },
  gosmao: { name: 'Gosmão', title: 'O Rei Slime', emoji: '🟢', intro: 'escorregou para dentro da live' },
  brasa: { name: 'Brasa', title: 'O Dragão Ancião', emoji: '🐉', intro: 'desceu da montanha cuspindo fogo' },
  ossudo: { name: 'Rei Ossudo', title: 'O Monarca Esqueleto', emoji: '💀', intro: 'levantou da cripta' },
  mechaz: { name: 'Mecha-Z', title: 'O Robô de Guerra', emoji: '🤖', intro: 'foi ativado em modo de combate' },
} as const;

export type BossSkinId = keyof typeof BOSS_SKINS;
export const BOSS_SKIN_IDS = Object.keys(BOSS_SKINS) as BossSkinId[];

export function isBossSkin(v: unknown): v is BossSkinId {
  return typeof v === 'string' && v in BOSS_SKINS;
}

export interface BossConfig {
  /** Visual do boss (personagem). */
  skin: BossSkinId;
  name: string;
  maxHp: number;
  /** Tempo limite em segundos. 0 = sem limite. */
  durationSec: number;
  /** Intervalo mínimo entre ataques de um mesmo espectador. */
  cooldownMs: number;
}

export const BOSS_PRESETS = {
  facil: { label: 'Fácil', maxHp: 2_000, hint: 'até 30 pessoas no chat' },
  medio: { label: 'Médio', maxHp: 10_000, hint: '30 a 150 pessoas' },
  epico: { label: 'Épico', maxHp: 50_000, hint: '150 a 800 pessoas' },
  lendario: { label: 'Lendário', maxHp: 200_000, hint: '800+ pessoas' },
} as const;

export type BossPresetKey = keyof typeof BOSS_PRESETS;

export interface BossHit {
  /** Chave estável do espectador (plataforma:id) — vira o mini-herói na arena. */
  id: string;
  name: string;
  color?: string;
  platform: Platform;
  damage: number;
  crit: boolean;
  ult: boolean;
  /** Golpe vindo de apoio (bits, sub, presente, pontos, raid). */
  special?: SupportKind;
  /** Texto curto do apoio, ex.: "500 bits", "5 subs de presente". */
  label?: string;
  /** Quantidade (bits, subs presenteados, espectadores do raid) para dimensionar o efeito. */
  amount?: number;
}

// ─── Apoios (bits, subs, pontos de canal, raid) ─────────────

export type SupportKind = 'bits' | 'sub' | 'gift' | 'points' | 'raid';

/** Evento de apoio já normalizado (Twitch hoje; Kick/YouTube depois). */
export interface SupportEvent {
  kind: SupportKind;
  platform: Platform;
  user: { id: string; name: string; color?: string } | null; // null = anônimo
  /** bits, meses de sub, quantidade de presentes ou espectadores do raid */
  amount: number;
  /** resgate de pontos: para confirmar ou reembolsar */
  redemptionId?: string;
  /** moeda do apoio tipo "bits": Bits (Twitch) ou Kicks (Kick) */
  unit?: 'bits' | 'kicks';
  /** como mostrar o apoio no chat, ex.: "Super Chat de R$ 10,00" (YouTube) */
  label?: string;
}

export interface SupportSettings {
  bits: { enabled: boolean; damagePerBit: number };
  subs: { enabled: boolean; damagePerSub: number };
  points: { enabled: boolean; cost: number; damage: number };
  raid: { enabled: boolean; damagePerViewer: number };
}

// ─── Apoios por minigame (tudo editável pelo streamer) ───────

export type SupportGameId = 'race' | 'duel' | 'royale' | 'kite' | 'penalty' | 'fishing' | 'defense';
export const SUPPORT_GAME_IDS: SupportGameId[] = ['race', 'duel', 'royale', 'kite', 'penalty', 'fishing', 'defense'];
/** Presentes (gift) seguem a regra de sub. */
export type SupportRuleKind = 'bits' | 'sub' | 'points' | 'raid';
export const SUPPORT_RULE_KINDS: SupportRuleKind[] = ['bits', 'sub', 'points', 'raid'];

export interface SupportParamDef {
  key: string;
  /** texto antes do campo, ex.: "Foguete de" */
  label: string;
  /** texto depois do campo, ex.: "s a cada 100 bits" */
  suffix?: string;
  min: number;
  max: number;
  step: number;
  def: number;
  /** lista fechada (vira um seletor) */
  options?: { value: number; label: string }[];
}

export interface SupportKindDef {
  /** o que acontece, curto: "Foguete", "Colete nível 3" */
  effect: string;
  detail: string;
  params: SupportParamDef[];
}

/** Bits e raids podem ter mínimo (a partir de X bits / X pessoas). */
export const SUPPORT_MIN: Partial<Record<SupportRuleKind, { label: string; suffix: string; max: number; step: number }>> = {
  bits: { label: 'A partir de', suffix: 'bits', max: 100_000, step: 50 },
  raid: { label: 'A partir de', suffix: 'pessoas no raid', max: 10_000, step: 1 },
};

/** O que cada apoio faz em cada jogo, e o que o streamer pode ajustar. Sem entrada = não tem efeito naquele jogo. */
export const GAME_SUPPORT: Record<SupportGameId, Partial<Record<SupportRuleKind, SupportKindDef>>> = {
  race: {
    bits: {
      effect: 'Foguete',
      detail: 'Quem apoiou dispara na pista. Se não estiver correndo, joga uma casca de banana no líder.',
      params: [
        { key: 'secPer100', label: 'Foguete de', suffix: 's a cada 100 bits', min: 0.25, max: 5, step: 0.25, def: 0.75 },
        { key: 'maxSec', label: 'No máximo', suffix: 's de foguete', min: 1, max: 15, step: 0.5, def: 6 },
      ],
    },
    sub: {
      effect: 'Foguete + escudo',
      detail: 'Sub ou presente: foguete e escudo para quem apoiou (presentes somam tempo de foguete).',
      params: [{ key: 'rocketSec', label: 'Foguete de', suffix: 's', min: 1, max: 10, step: 0.5, def: 3.5 }],
    },
    points: { effect: 'Escudo', detail: 'Protege da próxima casca de banana ou óleo.', params: [] },
    raid: {
      effect: 'Vento a favor',
      detail: 'Todo mundo acelera junto.',
      params: [{ key: 'sec', label: 'Vento de', suffix: 's', min: 1, max: 10, step: 0.5, def: 2.5 }],
    },
  },
  duel: {
    bits: { effect: 'Colete', detail: 'O duelista aguenta 1 tiro.', params: [] },
    sub: { effect: 'Revólver dourado', detail: 'O primeiro tiro do duelista não erra.', params: [] },
    points: {
      effect: 'Mira',
      detail: 'Mais chance de acertar.',
      params: [{ key: 'aimPct', label: 'Mira de +', suffix: '% de acerto', min: 5, max: 40, step: 5, def: 15 }],
    },
  },
  royale: {
    bits: {
      effect: 'Colete',
      detail: 'Escudo para quem apoiou.',
      params: [{ key: 'shield', label: 'Colete de', suffix: '% de escudo', min: 25, max: 100, step: 25, def: 100 }],
    },
    sub: { effect: 'Caixa de suprimentos', detail: 'Cai do lado de quem apoiou: arma lendária, colete e curativo.', params: [] },
    points: {
      effect: 'Curativo extra',
      detail: 'Usado com !curar.',
      params: [{ key: 'maxBandages', label: 'Até', suffix: 'curativos por pessoa', min: 1, max: 6, step: 1, def: 3 }],
    },
    raid: {
      effect: 'Bombardeio',
      detail: 'Explosões aleatórias dentro da zona.',
      params: [
        { key: 'bombs', label: '', suffix: 'bombas', min: 2, max: 20, step: 1, def: 8 },
        { key: 'damage', label: 'de', suffix: 'de dano cada', min: 10, max: 100, step: 5, def: 35 },
      ],
    },
  },
  fishing: {
    bits: {
      effect: 'Isca rara',
      detail: 'Os próximos lançamentos de quem apoiou têm mais chance de peixe raro, épico e lendário.',
      params: [{ key: 'casts', label: 'Vale para', suffix: 'lançamentos', min: 1, max: 10, step: 1, def: 3 }],
    },
    sub: {
      effect: 'Vara de ouro',
      detail: 'Sorte em dobro para quem apoiou por um tempo.',
      params: [{ key: 'minutes', label: 'Por', suffix: 'minutos', min: 5, max: 120, step: 5, def: 30 }],
    },
    points: { effect: 'Lançamento na hora', detail: 'Pula a espera e lança a linha na mesma hora, com um pouco mais de sorte.', params: [] },
    raid: {
      effect: 'Cardume',
      detail: 'Todo mundo pesca com sorte e pontos em dobro, e a espera cai pela metade.',
      params: [{ key: 'seconds', label: 'Por', suffix: 'segundos', min: 30, max: 600, step: 30, def: 120 }],
    },
  },
  penalty: {
    bits: {
      effect: 'Chute colocado',
      detail: 'No próximo pênalti do time de quem apoiou, o goleiro tem menos chance de defender.',
      params: [{ key: 'reducePct', label: 'Defesa', suffix: '% mais difícil', min: 20, max: 100, step: 10, def: 60 }],
    },
    sub: {
      effect: 'Paredão',
      detail: 'Na próxima defesa do time de quem apoiou, o goleiro também alcança o canto ao lado do pulo.',
      params: [{ key: 'reachPct', label: 'Chance de pegar o canto ao lado:', suffix: '%', min: 10, max: 80, step: 5, def: 35 }],
    },
    points: {
      effect: 'Voto de capitão',
      detail: 'O voto de quem resgatou vale mais na próxima decisão do time.',
      params: [{ key: 'weight', label: 'Vale', suffix: 'votos', min: 2, max: 10, step: 1, def: 3 }],
    },
    raid: { effect: 'Pressão da torcida', detail: 'O time que está perdendo (ou um sorteado, se empatado) ganha um chute colocado.', params: [] },
  },
  kite: {
    bits: {
      effect: 'Linha melhor',
      detail: 'Mais força no relo.',
      params: [
        {
          key: 'line',
          label: 'Vira',
          min: 1,
          max: 3,
          step: 1,
          def: 2,
          options: [
            { value: 1, label: 'Linha Neon' },
            { value: 2, label: 'Linha Diamante' },
            { value: 3, label: 'Linha Dourada' },
          ],
        },
      ],
    },
    sub: {
      effect: 'Raia Dourada',
      detail: 'Pipa maior e brilhante com Linha Dourada.',
      params: [{ key: 'rabiolas', label: 'Mais', suffix: 'rabiola(s)', min: 0, max: 3, step: 1, def: 1 }],
    },
    points: {
      effect: 'Rabiola extra',
      detail: 'Um escudo a mais contra corte.',
      params: [{ key: 'maxRabiolas', label: 'Até', suffix: 'rabiolas por pipa', min: 1, max: 5, step: 1, def: 3 }],
    },
    raid: {
      effect: 'Ventania e chuva de pipas',
      detail: 'Embaralha o céu e solta pipas para o chat aparar.',
      params: [
        { key: 'kites', label: '', suffix: 'pipas na chuva', min: 0, max: 15, step: 1, def: 6 },
        { key: 'gustSec', label: 'Ventania de', suffix: 's', min: 2, max: 15, step: 1, def: 6 },
      ],
    },
  },
  defense: {
    bits: {
      effect: 'Meteoro',
      detail: 'Cai no meio do maior grupo de monstros.',
      params: [{ key: 'power', label: 'Dano de', suffix: 'por bit', min: 1, max: 20, step: 1, def: 3 }],
    },
    sub: {
      effect: 'Herói na base',
      detail: 'Um herói com o nome de quem deu sub defende a base, alcançando o mapa todo.',
      params: [{ key: 'seconds', label: 'Por', suffix: 's', min: 10, max: 120, step: 5, def: 30 }],
    },
    points: {
      effect: 'Torre nível acima',
      detail: 'A torre de quem resgatou sobe de nível (mais dano). Quem ainda não tem torre ganha uma.',
      params: [{ key: 'maxLevel', label: 'Até o nível', min: 2, max: 5, step: 1, def: 3 }],
    },
    raid: {
      effect: 'Onda de aliados',
      detail: 'Soldados saem da base e atropelam os monstros pelo caminho.',
      params: [{ key: 'dmg', label: 'Cada aliado causa', suffix: 'de dano', min: 20, max: 500, step: 10, def: 80 }],
    },
  },
};

export interface SupportRule {
  enabled: boolean;
  /** mínimo de bits / pessoas no raid (1 = qualquer valor) */
  min: number;
  p: Record<string, number>;
}
export type GameSupportConfig = Record<SupportRuleKind, SupportRule>;

export function defaultGameSupport(game: SupportGameId): GameSupportConfig {
  const out = {} as GameSupportConfig;
  for (const kind of SUPPORT_RULE_KINDS) {
    const def = GAME_SUPPORT[game][kind];
    out[kind] = { enabled: !!def, min: 1, p: Object.fromEntries((def?.params ?? []).map((x) => [x.key, x.def])) };
  }
  return out;
}

/** Mescla e valida (limites de cada campo). */
export function normalizeGameSupport(game: SupportGameId, base: Partial<GameSupportConfig> | undefined, patch?: unknown): GameSupportConfig {
  const out = defaultGameSupport(game);
  const pt = (patch ?? {}) as Partial<Record<SupportRuleKind, Partial<SupportRule>>>;
  for (const kind of SUPPORT_RULE_KINDS) {
    const def = GAME_SUPPORT[game][kind];
    const b = base?.[kind];
    const q = pt[kind];
    if (!def) {
      out[kind].enabled = false;
      continue;
    }
    const en = q?.enabled ?? b?.enabled;
    if (typeof en === 'boolean') out[kind].enabled = en;
    const lim = SUPPORT_MIN[kind];
    const mn = Number(q?.min ?? b?.min ?? 1);
    out[kind].min = lim && Number.isFinite(mn) ? Math.min(lim.max, Math.max(1, Math.round(mn))) : 1;
    for (const d of def.params) {
      const v = Number(q?.p?.[d.key] ?? b?.p?.[d.key] ?? d.def);
      const ok = Number.isFinite(v) ? Math.min(d.max, Math.max(d.min, Math.round(v / d.step) * d.step)) : d.def;
      out[kind].p[d.key] = d.options && !d.options.some((o) => o.value === ok) ? d.def : Math.round(ok * 1000) / 1000;
    }
  }
  return out;
}

/** Regra do apoio no jogo (presente usa a de sub). null = desligado ou abaixo do mínimo. */
export function supportRule(cfg: GameSupportConfig, e: { kind: SupportKind; amount: number }): SupportRule | null {
  const kind: SupportRuleKind = e.kind === 'gift' ? 'sub' : e.kind;
  const r = cfg[kind];
  if (!r?.enabled) return null;
  if ((kind === 'bits' || kind === 'raid') && e.amount < r.min) return null;
  return r;
}

export interface ClipSettings {
  enabled: boolean;
  /** Posta o link do clip no chat. */
  postInChat: boolean;
}

export interface ClipRecord {
  id: string;
  url: string;
  bossName: string;
  createdAt: number;
}

export interface LeaderboardEntry {
  name: string;
  color?: string;
  platform: Platform;
  damage: number;
  hits: number;
}

export interface BossSnapshot {
  status: BossStatus;
  skin: BossSkinId;
  name: string;
  hp: number;
  maxHp: number;
  phase: BossPhase;
  startedAt: number | null;
  endsAt: number | null;
  participants: number;
  totalHits: number;
  leaderboard: LeaderboardEntry[];
  finalBlow: string | null;
  /** Golpes desde o último snapshot (para animar números de dano). */
  recentHits: BossHit[];
  serverNow: number;
}

// ─── Configurações da sala (por canal) ──────────────────────

export const AUTO_SPAWN_INTERVALS = [15, 30, 60, 120, 180] as const;

export interface AutoSpawnSettings {
  enabled: boolean;
  /** Intervalo entre bosses, em minutos (5 a 720). */
  intervalMin: number;
  skin: BossSkinId | 'random';
  /** Avisa no chat e no overlay 1 minuto antes. */
  warn: boolean;
  /** Só invoca se houver pelo menos este número de pessoas ativas no chat (últimos 10 min). */
  minChatters: number;
}

export type ArenaPosition = 'left' | 'center' | 'right';

/** Como o minigame aparece na tela da live (muda ao vivo no OBS). */
export interface LayoutSettings {
  position: ArenaPosition;
  /** Tamanho da arena em % (100 = metade da largura da tela). */
  size: number;
  /** Barra de vida flutuando acima do boss ou no topo da tela. */
  hpBar: 'boss' | 'top';
  showRanking: boolean;
  /** Círculo discreto no chão sob os personagens. */
  showFloor: boolean;
  /**
   * overlay: fundo transparente por cima do jogo (posição e tamanho ajustáveis).
   * fullscreen: o minigame vira a tela principal, com cenário completo.
   */
  display: 'overlay' | 'fullscreen';
  /** Nomes em cima dos personagens: de todo mundo do chat ou só dos destaques. */
  names: 'all' | 'top';
}

export const ARENA_SIZE = { min: 40, max: 130, presets: [{ label: 'P', value: 55 }, { label: 'M', value: 75 }, { label: 'G', value: 100 }] };

export interface RoomSettings {
  /** Volume dos sons do overlay, 0 a 100. */
  volume: number;
  autoSpawn: AutoSpawnSettings;
  layout: LayoutSettings;
  support: SupportSettings;
  clip: ClipSettings;
  /** Bot da Clipei: falar no chat (ele sempre lê o chat para os jogos funcionarem). */
  bot: { speak: boolean };
  /** Última configuração da Corrida (o painel e o !corrida dos mods usam). */
  race: RaceConfig;
  duel: DuelConfig;
  royale: RoyaleConfig;
  kite: KiteConfig;
  penalty: PenaltyConfig;
  defense: DefenseConfig;
  fishing: FishingConfig;
  /** Modo Loop: os minigames se revezam sozinhos (streamer ausente, live aberta). */
  loop: LoopConfig;
  /** O que bits, subs, pontos e raids fazem em cada minigame (o boss usa `support`). */
  gameSupport: Record<SupportGameId, GameSupportConfig>;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  volume: 60,
  autoSpawn: { enabled: false, intervalMin: 60, skin: 'random', warn: true, minChatters: 3 },
  layout: { position: 'right', size: 75, hpBar: 'boss', showRanking: true, showFloor: true, display: 'overlay', names: 'all' },
  support: {
    bits: { enabled: true, damagePerBit: 3 },
    subs: { enabled: true, damagePerSub: 250 },
    points: { enabled: false, cost: 500, damage: 120 },
    raid: { enabled: true, damagePerViewer: 5 },
  },
  clip: { enabled: false, postInChat: true },
  bot: { speak: true },
  race: { track: 'neon', joinSec: 45, laps: 2, maxRunners: 60, fillBots: true },
  duel: { bestOf: 1, scene: 'saloon', joinSec: 60, cheer: true, cheerSec: 15 },
  royale: { joinSec: 60, maxPlayers: 100, fillBots: true, fullscreen: true },
  kite: { joinSec: 60, durationSec: 180, maxPlayers: 40, fillBots: true, fullscreen: true },
  gameSupport: {
    race: defaultGameSupport('race'),
    duel: defaultGameSupport('duel'),
    royale: defaultGameSupport('royale'),
    kite: defaultGameSupport('kite'),
    penalty: defaultGameSupport('penalty'),
    fishing: defaultGameSupport('fishing'),
    defense: defaultGameSupport('defense'),
  },
  defense: { joinSec: 60, waves: 8, voteSec: 15, maxPlayers: 60, fillBots: true, difficulty: 'normal', fullscreen: true },
  fishing: { enabled: false, cooldownSec: 60, corner: 'bl', announce: 'epico', hint: true, scene: 'transparent', rankPos: 'lake', rankTop: 3 },
  loop: { enabled: false, mode: 'loop', intervalMin: 30, bossSkin: 'random', games: ['race', 'royale', 'kite', 'penalty', 'boss'], order: 'sequence', gapSec: 60, minChatters: 0, onlyLive: true, maxHours: 0, announce: true, teaser: true },
  penalty: {
    joinSec: 45,
    voteSec: 12,
    kicks: 5,
    teamA: { name: 'Vermelho', color: '#ff2d3a' },
    teamB: { name: 'Azul', color: '#2f7dff' },
    fillBots: true,
    fullscreen: true,
  },
};

/** Mescla configurações parciais com validação dos limites. */
export function mergeSettings(base: RoomSettings, patch: unknown): RoomSettings {
  type Deep<T> = { [K in keyof T]?: T[K] extends object ? Deep<T[K]> : T[K] };
  const p = (patch ?? {}) as Deep<RoomSettings>;
  const baseLayout = base.layout ?? DEFAULT_SETTINGS.layout;
  const bs = base.support ?? DEFAULT_SETTINGS.support;
  const ps = p.support ?? {};
  const sup = {
    bits: { ...bs.bits, ...(ps.bits ?? {}) },
    subs: { ...bs.subs, ...(ps.subs ?? {}) },
    points: { ...bs.points, ...(ps.points ?? {}) },
    raid: { ...bs.raid, ...(ps.raid ?? {}) },
  };
  const clip = { ...(base.clip ?? DEFAULT_SETTINGS.clip), ...(p.clip ?? {}) };
  const a = { ...base.autoSpawn, ...(p.autoSpawn ?? {}) };
  const l = { ...baseLayout, ...(p.layout ?? {}) };
  const num = (v: unknown, def: number, min: number, max: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  return {
    volume: num(p.volume ?? base.volume, base.volume, 0, 100),
    autoSpawn: {
      enabled: Boolean(a.enabled),
      intervalMin: num(a.intervalMin, 60, 5, 720),
      skin: a.skin === 'random' || isBossSkin(a.skin) ? a.skin : 'random',
      warn: Boolean(a.warn),
      minChatters: num(a.minChatters, 3, 0, 1000),
    },
    layout: {
      position: l.position === 'left' || l.position === 'center' ? l.position : 'right',
      size: num(l.size, 75, ARENA_SIZE.min, ARENA_SIZE.max),
      hpBar: l.hpBar === 'top' ? 'top' : 'boss',
      showRanking: l.showRanking !== false,
      showFloor: l.showFloor !== false,
      display: l.display === 'fullscreen' ? 'fullscreen' : 'overlay',
      names: l.names === 'top' ? 'top' : 'all',
    },
    support: {
      bits: { enabled: Boolean(sup.bits.enabled), damagePerBit: num(sup.bits.damagePerBit, 3, 1, 50) },
      subs: { enabled: Boolean(sup.subs.enabled), damagePerSub: num(sup.subs.damagePerSub, 250, 10, 10_000) },
      points: {
        enabled: Boolean(sup.points.enabled),
        cost: num(sup.points.cost, 500, 1, 1_000_000),
        damage: num(sup.points.damage, 120, 1, 10_000),
      },
      raid: { enabled: Boolean(sup.raid.enabled), damagePerViewer: num(sup.raid.damagePerViewer, 5, 1, 100) },
    },
    clip: { enabled: Boolean(clip.enabled), postInChat: clip.postInChat !== false },
    bot: { speak: (p.bot?.speak ?? base.bot?.speak ?? true) !== false },
    race: normalizeRaceConfig({ ...(base.race ?? {}), ...((p.race ?? {}) as Partial<RaceConfig>) }),
    duel: normalizeDuelConfig({ ...(base.duel ?? {}), ...((p.duel ?? {}) as Partial<DuelConfig>) }),
    royale: normalizeRoyaleConfig({ ...(base.royale ?? {}), ...((p.royale ?? {}) as Partial<RoyaleConfig>) }),
    kite: normalizeKiteConfig({ ...(base.kite ?? {}), ...((p.kite ?? {}) as Partial<KiteConfig>) }),
    penalty: normalizePenaltyConfig(base.penalty, p.penalty as Partial<PenaltyConfig> | undefined),
    fishing: normalizeFishingConfig({ ...(base.fishing ?? {}), ...((p.fishing ?? {}) as Partial<FishingConfig>) }),
    defense: normalizeDefenseConfig({ ...(base.defense ?? {}), ...((p.defense ?? {}) as Partial<DefenseConfig>) }),
    loop: normalizeLoopConfig({ ...(base.loop ?? {}), ...((p.loop ?? {}) as Partial<LoopConfig>) }),
    gameSupport: Object.fromEntries(
      SUPPORT_GAME_IDS.map((g) => [g, normalizeGameSupport(g, base.gameSupport?.[g], (p.gameSupport as Record<string, unknown> | undefined)?.[g])]),
    ) as Record<SupportGameId, GameSupportConfig>,
  };
}

/** Situação da sala, enviada ao painel a cada poucos segundos. */
export interface RoomStatus {
  /** Pessoas diferentes que falaram no chat nos últimos 10 minutos. */
  activeChatters: number;
  /** Vida que o modo automático usaria agora. */
  autoHp: number;
  /** Quando o próximo boss automático deve aparecer (null = desligado ou em luta). */
  nextAutoAt: number | null;
  live: boolean;
  /** Fontes do OBS conectadas agora (o painel não conta). */
  overlays: number;
  /** Minigame rolando agora na tela (só um por vez). */
  game: 'boss' | 'race' | 'duel' | 'royale' | 'kite' | 'penalty' | 'defense' | null;
  serverNow: number;
}

// ─── Protocolo WebSocket (servidor → overlay/painel) ────────

export type ServerMessage =
  | { type: 'hello'; channel: { name: string; demo: boolean } }
  | { type: 'boss'; state: BossSnapshot }
  | { type: 'race'; state: RaceSnapshot }
  | { type: 'duel'; state: DuelSnapshot }
  | { type: 'royale'; state: RoyaleSnapshot }
  | { type: 'kite'; state: KiteSnapshot }
  | { type: 'penalty'; state: PenaltySnapshot }
  | { type: 'fishing'; state: FishingSnapshot }
  | { type: 'loop'; state: LoopSnapshot }
  | { type: 'defense'; state: DefenseSnapshot }
  | { type: 'toast'; text: string; tone?: 'info' | 'success' | 'warning' }
  | { type: 'settings'; settings: RoomSettings }
  | { type: 'room'; status: RoomStatus }
  /** Boss automático chegando: overlay mostra contagem regressiva. at = null cancela. */
  | { type: 'incoming'; at: number | null; serverNow: number }
  | { type: 'sfx-test' }
  /** Clip da vitória criado (painel mostra o link). */
  | { type: 'clip'; clip: ClipRecord };

// ─── API do painel ──────────────────────────────────────────

export interface MeResponse {
  demo: boolean;
  settings: RoomSettings;
  status: RoomStatus;
  clips: ClipRecord[];
  history: FightRecord[];
  /** Permissões que faltam o streamer autorizar (reconectar a Twitch). */
  missingScopes: string[];
  /** Situação da recompensa de pontos de canal na Twitch. */
  pointsReward: { ok: boolean; message: string } | null;
  kick: {
    configured: boolean;
    connected: boolean;
    name: string | null;
    slug: string | null;
    live: boolean;
    /** Último evento recebido pelo webhook (confirma que o túnel/URL pública funciona). */
    lastEventAt: number | null;
    /** Problema nas inscrições de eventos ou na recompensa. */
    problem: string | null;
    missingScopes: string[];
  };
  youtube: {
    configured: boolean;
    connected: boolean;
    name: string | null;
    handle: string | null;
    live: boolean;
    /** chat da live conectado agora */
    chatConnected: boolean;
    lastEventAt: number | null;
    problem: string | null;
    /** bot do YouTube (conta da Clipei) conectado */
    botConnected: boolean;
    botName: string | null;
  };
  /** Plataforma usada para entrar (conta só da Kick não tem Twitch). */
  primary: Platform | null;
  /** Administrador da Clipei (vê o painel /app/admin). */
  admin: boolean;
  /** Assinatura do canal (null no modo demo). */
  billing: BillingView | null;
  founderSlotsLeft: number;
  channel: { id: string; login: string; displayName: string; avatar?: string } | null;
  overlayKey: string;
  twitch: {
    configured: boolean;
    streamerConnected: boolean;
    botConnected: boolean;
    botName: string | null;
    chatListening: boolean;
    /** Motivo de não estar ouvindo o chat (erro da Twitch), se houver. */
    chatError: string | null;
  };
  simulator: SimulatorStatus;
}

export interface SimulatorStatus {
  running: boolean;
  viewers: number;
  messagesPerSecond: number;
  subRatio: number;
}

// ─── Catálogo da plataforma ─────────────────────────────────

export type GameId = 'boss' | 'race' | 'duel' | 'royale' | 'kite' | 'penalty' | 'defense' | 'fishing' | 'quiz' | 'teams' | 'wheel' | 'missions';

export interface GameInfo {
  id: GameId;
  name: string;
  tagline: string;
  description: string;
  status: 'active' | 'soon';
  commands: string[];
}

/** Minigames da Clipei. Os "soon" aparecem no catálogo como em breve. */
export const GAMES: GameInfo[] = [
  {
    id: 'boss',
    name: 'Boss coletivo',
    tagline: 'O chat inteiro contra um chefe',
    description: 'Cada pessoa vira um mini-herói na arena. Bits, subs e pontos viram golpes especiais.',
    status: 'active',
    commands: ['!atk', '!ult'],
  },
  {
    id: 'race',
    name: 'Corrida',
    tagline: 'O chat inteiro na pista',
    description: 'Cada pessoa vira um piloto num circuito visto de cima. Sorte, janelas de turbo e apoios viram foguetes e cascas de banana.',
    status: 'active',
    commands: ['!correr', '!turbo'],
  },
  {
    id: 'duel',
    name: 'Duelo',
    tagline: 'X1 no velho oeste',
    description: 'Os dois primeiros que digitarem !duelo se encaram na rua do saloon. No FOGO!, quem sacar primeiro atira, mas pode errar. A torcida e os apoios ajudam.',
    status: 'active',
    commands: ['!duelo', '!bang', '!1', '!2'],
  },
  {
    id: 'royale',
    name: 'Battle Royale',
    tagline: 'Último de pé vence',
    description: 'O chat salta de paraquedas num mapa visto de cima, pega armas e luta até sobrar um. A tempestade fecha e quem morreu vota onde cai a caixa.',
    status: 'active',
    commands: ['!entrar', '!cair', '!curar', '!caixa'],
  },
  {
    id: 'kite',
    name: 'Pipa Combate',
    tagline: 'Último no céu vence',
    description: 'Cada pessoa solta uma pipa sobre o morro. Quando as linhas cruzam, é relo: puxe, dibique ou descarregue para cortar. Pipa voada, o chat apara.',
    status: 'active',
    commands: ['!pipa', '!dibicar', '!puxar', '!descarregar', '!aparar'],
  },
  {
    id: 'penalty',
    name: 'Disputa de Pênaltis',
    tagline: 'Time contra time',
    description: 'O chat se divide em dois times. Quem bate vota o canto, quem defende vota o pulo do goleiro. Cinco cobranças cada e morte súbita.',
    status: 'active',
    commands: ['!a', '!b', '!esq', '!meio', '!dir'],
  },
  {
    id: 'defense',
    name: 'Defesa da Base',
    tagline: 'O chat inteiro contra as ondas',
    description: 'Monstros chegam em ondas e cada pessoa vira uma torre: arqueiro, mago ou canhão. Entre as ondas o chat vota a melhoria. Se a base cair, acabou.',
    status: 'active',
    commands: ['!arqueiro', '!mago', '!canhao', '!atk', '!muralha', '!gelo', '!fogo'],
  },
  {
    id: 'fishing',
    name: 'Pescaria da Live',
    tagline: 'Roda a live inteira',
    description: 'Um lago discreto no canto da tela: o chat pesca quando quiser, monta a coleção de peixes e disputa o ranking da semana. Saiu lendário, o chat inteiro fica sabendo.',
    status: 'active',
    commands: ['!pescar', '!peixes', '!ranking'],
  },
  {
    id: 'quiz',
    name: 'Quiz gamer',
    tagline: 'Perguntas de games, o mais rápido leva',
    description: 'Perguntas por tema (FPS, MOBA, retrô). O chat responde com !a !b !c !d.',
    status: 'soon',
    commands: ['!a', '!b', '!c', '!d'],
  },
  {
    id: 'teams',
    name: 'Batalha de equipes',
    tagline: 'Vermelho contra azul',
    description: 'O chat se divide em dois times e disputa rodadas com placar ao vivo.',
    status: 'soon',
    commands: ['!time', '!atk'],
  },
  {
    id: 'wheel',
    name: 'Roleta de desafios',
    tagline: 'Desafios para o streamer, sem apostas',
    description: 'O streamer cadastra desafios e o chat gira a roleta.',
    status: 'soon',
    commands: ['!girar'],
  },
  {
    id: 'missions',
    name: 'Missões da comunidade',
    tagline: 'Metas que a live cumpre junto',
    description: 'Objetivos da live e da semana com barra de progresso no overlay.',
    status: 'soon',
    commands: [],
  },
];

// ─── Planos e assinatura ─────────────────────────────────────

export type BillingCycle = 'monthly' | 'yearly';

export const TRIAL_DAYS = 7;
export const FOUNDER_SLOTS = 10;
/** Desconto dos Fundadores, válido em todas as renovações. */
export const FOUNDER_DISCOUNT = 0.2;
const DAY = 86_400_000;

export interface PlanOffer {
  id: BillingCycle;
  name: string;
  /** Preço cheio do ciclo (R$). */
  price: number;
  months: number;
  note: string;
  highlight?: boolean;
}

/** Um plano só, com tudo liberado, cobrado por mês ou por ano. */
export const PLAN_OFFERS: PlanOffer[] = [
  { id: 'monthly', name: 'Mensal', price: 29.9, months: 1, note: 'Cancele quando quiser' },
  { id: 'yearly', name: 'Anual', price: 299, months: 12, note: '2 meses grátis', highlight: true },
];

export const PLAN_FEATURES = [
  'Todos os minigames, inclusive os próximos',
  '8 bosses em pixel art e boss automático',
  'Bits, subs, raids e pontos viram golpes',
  'Clip automático da vitória',
  'Overlay transparente no tamanho que quiser',
  'Bot da Clipei no seu chat',
];

export const planOffer = (cycle: BillingCycle) => PLAN_OFFERS.find((o) => o.id === cycle)!;

/** Preço do ciclo, com o desconto de Fundador quando for o caso. */
export function offerPrice(cycle: BillingCycle, founder = false) {
  const base = planOffer(cycle).price;
  return Math.round(base * (founder ? 1 - FOUNDER_DISCOUNT : 1) * 100) / 100;
}

export const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Assinatura guardada por canal. O teste começa na primeira conexão. */
export interface Subscription {
  trialEndsAt: number;
  cycle: BillingCycle | null;
  /** Fim do período pago (null = nunca assinou). */
  periodEnd: number | null;
  /** 1..FOUNDER_SLOTS para os primeiros assinantes. O selo é para sempre. */
  founderNumber: number | null;
  /** Ativada pela equipe sem cobrança (não ocupa vaga de Fundador). */
  courtesy: boolean;
  provider: 'manual' | 'mercadopago' | null;
  /** Primeira vez que pagou. */
  since: number | null;
}

export type SubscriptionStatus = 'trial' | 'active' | 'expired';

export interface BillingView {
  status: SubscriptionStatus;
  cycle: BillingCycle | null;
  trialEndsAt: number;
  periodEnd: number | null;
  founderNumber: number | null;
  courtesy: boolean;
  /** Dias restantes do teste ou do período pago (arredondado para cima). */
  daysLeft: number;
  /** Preço que essa conta paga no ciclo atual (null em teste/cortesia). */
  price: number | null;
}

export function newTrial(now = Date.now()): Subscription {
  return { trialEndsAt: now + TRIAL_DAYS * DAY, cycle: null, periodEnd: null, founderNumber: null, courtesy: false, provider: null, since: null };
}

export function subscriptionStatus(sub: Subscription, now = Date.now()): SubscriptionStatus {
  if (sub.periodEnd && sub.periodEnd > now) return 'active';
  if (sub.trialEndsAt > now && !sub.periodEnd) return 'trial';
  return 'expired';
}

export function billingView(sub: Subscription, now = Date.now()): BillingView {
  const status = subscriptionStatus(sub, now);
  const end = status === 'active' ? sub.periodEnd! : sub.trialEndsAt;
  return {
    status,
    cycle: sub.cycle,
    trialEndsAt: sub.trialEndsAt,
    periodEnd: sub.periodEnd,
    founderNumber: sub.founderNumber,
    courtesy: sub.courtesy,
    daysLeft: status === 'expired' ? 0 : Math.max(0, Math.ceil((end - now) / DAY)),
    price: sub.cycle && !sub.courtesy ? offerPrice(sub.cycle, sub.founderNumber != null) : null,
  };
}

/** Soma meses de calendário (dia 31 cai no último dia do mês seguinte). */
export function addMonths(from: number, months: number) {
  const d = new Date(from);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d.getTime();
}

/** Uma luta encerrada (histórico no Início). */
export interface FightRecord {
  at: number;
  skin: BossSkinId;
  name: string;
  result: 'victory' | 'escaped' | 'stopped';
  durationMs: number;
  participants: number;
  totalHits: number;
  maxHp: number;
  finalBlow: string | null;
  top: string | null;
}

// ─── Painel de administração ────────────────────────────────

export interface AdminOverview {
  /** ADMIN_LOGINS não definido: qualquer conta vira admin (só em desenvolvimento). */
  openAdmin: boolean;
  platforms: { twitch: boolean; kick: boolean; youtube: boolean };
  bot: { connected: boolean; name: string | null; login: string | null; missingScopes: string[] };
  channels: {
    id: string;
    displayName: string;
    login: string;
    platforms: Platform[];
    chatListening: boolean;
    overlays: number;
    fights: number;
    lastFightAt: number | null;
    connectedAt: number;
    billing: BillingView;
  }[];
  founders: { used: number; total: number };
}

// ─── Corrida ────────────────────────────────────────────────

export type RaceTrackId = 'neon' | 'deserto' | 'gelo' | 'castelo';

export const RACE_TRACKS: Record<RaceTrackId, { name: string; title: string }> = {
  neon: { name: 'Cidade Neon', title: 'Asfalto e luzes' },
  deserto: { name: 'Deserto', title: 'Areia, cactos e calor' },
  gelo: { name: 'Pista de Gelo', title: 'Neve e pinheiros' },
  castelo: { name: 'Castelo', title: 'Pedra, tochas e fosso' },
};
export const RACE_TRACK_IDS = Object.keys(RACE_TRACKS) as RaceTrackId[];
export const isRaceTrack = (v: unknown): v is RaceTrackId => typeof v === 'string' && v in RACE_TRACKS;

export interface RaceConfig {
  track: RaceTrackId;
  /** Tempo de inscrição (!correr), em segundos. */
  joinSec: number;
  laps: number;
  maxRunners: number;
  /** Completa com pilotos da Clipei (CPU) até 4 na pista. */
  fillBots: boolean;
}

export const DEFAULT_RACE_CONFIG: RaceConfig = { track: 'neon', joinSec: 45, laps: 2, maxRunners: 60, fillBots: true };
export const RACE_LIMITS = { joinSec: [15, 120], laps: [1, 3], maxRunners: [4, 150] } as const;

export function normalizeRaceConfig(c: Partial<RaceConfig> | undefined): RaceConfig {
  const d = DEFAULT_RACE_CONFIG;
  const num = (v: unknown, def: number, [min, max]: readonly [number, number]) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  return {
    track: isRaceTrack(c?.track) ? c.track : d.track,
    joinSec: num(c?.joinSec, d.joinSec, RACE_LIMITS.joinSec),
    laps: num(c?.laps, d.laps, RACE_LIMITS.laps),
    maxRunners: num(c?.maxRunners, d.maxRunners, RACE_LIMITS.maxRunners),
    fillBots: c?.fillBots !== false,
  };
}

/** lobby = inscrições; running = largada (contagem até startedAt) e corrida. */
export type RaceStatus = 'idle' | 'lobby' | 'running' | 'finished' | 'stopped';

export interface RaceRosterEntry {
  name: string;
  color: string;
  bot?: boolean;
}

/** [índice no roster, progresso ×1e4 (voltas), posição lateral −100..100, velocidade ×1e5 (voltas/s), flags RACE_FLAG] */
export type RaceRunnerTuple = [number, number, number, number, number];

export const RACE_FLAG = { boost: 1, stumble: 2, shield: 4, finished: 8, rocket: 16 } as const;

export interface RaceObstacle {
  id: number;
  kind: 'banana' | 'oil';
  /** posição em voltas (0..laps) */
  p: number;
  /** −1..1 através da pista */
  lat: number;
}

export type RaceEventKind = 'join' | 'turbo' | 'trip' | 'rocket' | 'shield' | 'banana' | 'hit' | 'blocked' | 'finish' | 'raid';

export interface RaceEvent {
  id: number;
  kind: RaceEventKind;
  /** índice no roster (−1 = ninguém em especial) */
  who: number;
  label?: string;
  place?: number;
}

export interface RacePodiumEntry {
  name: string;
  color: string;
  timeMs: number | null;
  bot?: boolean;
}

export interface RaceSnapshot {
  status: RaceStatus;
  track: RaceTrackId;
  laps: number;
  maxRunners: number;
  lobbyEndsAt: number | null;
  /** Momento da largada (antes dele: contagem 3, 2, 1). */
  startedAt: number | null;
  /** Limite de tempo da corrida. */
  endsAt: number | null;
  finishedAt: number | null;
  serverNow: number;
  rosterVersion: number;
  /** Só vem quando muda (ou na conexão): nomes e cores por índice. */
  roster?: RaceRosterEntry[];
  runners: RaceRunnerTuple[];
  obstacles: RaceObstacle[];
  turbo: { open: boolean; until: number | null; nextAt: number | null };
  events: RaceEvent[];
  /** Índices do roster na ordem atual (até 5). */
  leaders: number[];
  podium: RacePodiumEntry[];
  /** Pessoas (sem contar CPU). */
  participants: number;
}

// ─── Duelo ──────────────────────────────────────────────────

export type DuelSceneId = 'saloon' | 'deserto' | 'fantasma';

export const DUEL_SCENES: Record<DuelSceneId, { name: string; title: string }> = {
  saloon: { name: 'Rua do Saloon', title: 'Meio-dia, sol a pino' },
  deserto: { name: 'Pôr do sol', title: 'Mesas e céu laranja' },
  fantasma: { name: 'Cidade fantasma', title: 'Lua cheia e silêncio' },
};
export const DUEL_SCENE_IDS = Object.keys(DUEL_SCENES) as DuelSceneId[];

export interface DuelConfig {
  /** 1 = X1 (um tiro decide), 3 = melhor de 3. */
  bestOf: 1 | 3;
  scene: DuelSceneId;
  /** Tempo para aparecerem os dois duelistas (!duelo), em segundos. */
  joinSec: number;
  /** Torcida do chat (!1 / !2) dá um bônus pequeno de mira. */
  cheer: boolean;
  /** Tempo de torcida antes da contagem (com os dois duelistas na tela), em segundos. */
  cheerSec: number;
}

export const DEFAULT_DUEL_CONFIG: DuelConfig = { bestOf: 1, scene: 'saloon', joinSec: 60, cheer: true, cheerSec: 15 };

export function normalizeDuelConfig(c: Partial<DuelConfig> | undefined): DuelConfig {
  const join = Math.round(Number(c?.joinSec));
  return {
    bestOf: Number(c?.bestOf) === 3 ? 3 : 1,
    scene: c?.scene && c.scene in DUEL_SCENES ? c.scene : 'saloon',
    joinSec: Number.isFinite(join) ? Math.min(180, Math.max(15, join)) : 60,
    cheer: c?.cheer !== false,
    cheerSec: Number.isFinite(Math.round(Number(c?.cheerSec))) ? Math.min(60, Math.max(5, Math.round(Number(c?.cheerSec)))) : 15,
  };
}

/**
 * lobby: esperando os 2 duelistas · intro: encarada · countdown: 3, 2, 1 ·
 * wait: silêncio antes do FOGO · fire: valendo! · round: fim da rodada ·
 * finished / stopped: acabou.
 */
export type DuelStatus = 'idle' | 'lobby' | 'intro' | 'countdown' | 'wait' | 'fire' | 'round' | 'finished' | 'stopped';

export interface DuelistView {
  name: string;
  color: string;
  /** +15% de mira (pontos do canal) */
  aim: boolean;
  /** aguenta 1 tiro (bits) */
  vest: boolean;
  /** primeiro tiro não erra (sub) */
  gold: boolean;
  /** atirou antes do FOGO: arma travada */
  jammed: boolean;
}

export type DuelEventKind = 'join' | 'shot' | 'miss' | 'hit' | 'vest' | 'jam' | 'item' | 'round' | 'draw' | 'win';

export interface DuelEvent {
  id: number;
  kind: DuelEventKind;
  /** 0 ou 1 = duelista; −1 = nenhum */
  who: number;
  /** item recebido ('aim' | 'vest' | 'gold') ou nome de quem apoiou */
  item?: 'aim' | 'vest' | 'gold';
  label?: string;
}

export interface DuelSnapshot {
  status: DuelStatus;
  scene: DuelSceneId;
  bestOf: 1 | 3;
  round: number;
  score: [number, number];
  players: DuelistView[];
  /** torcida: [!1, !2] */
  cheers: [number, number];
  cheerOn: boolean;
  /** fim da fase atual (lobby, intro, contagem); null no FOGO */
  phaseEndsAt: number | null;
  /** vencedor da rodada/duelo (0, 1) ou null */
  winner: number | null;
  serverNow: number;
  events: DuelEvent[];
}

// ─── Battle Royale ──────────────────────────────────────────

export type RoyaleRegionId = 'cidade' | 'floresta' | 'porto' | 'fazenda';

/** Regiões do mapa (960×540 lógicos). Mais caixas onde é mais perigoso. */
export const ROYALE_REGIONS: Record<RoyaleRegionId, { name: string; x: number; y: number; w: number; h: number; crates: number }> = {
  cidade: { name: 'Cidade', x: 120, y: 70, w: 290, h: 190, crates: 16 },
  porto: { name: 'Porto', x: 590, y: 60, w: 270, h: 170, crates: 11 },
  fazenda: { name: 'Fazenda', x: 80, y: 320, w: 300, h: 170, crates: 10 },
  floresta: { name: 'Floresta', x: 570, y: 300, w: 300, h: 190, crates: 10 },
};
export const ROYALE_REGION_IDS = Object.keys(ROYALE_REGIONS) as RoyaleRegionId[];

export const ROYALE_WEAPONS = [
  { name: 'Pistola', color: '#c9ced4' },
  { name: 'Escopeta', color: '#3ddc6b' },
  { name: 'Fuzil', color: '#4aa8ff' },
  { name: 'Sniper', color: '#b46bff' },
  { name: 'Lendária', color: '#ffc83d' },
] as const;

export interface RoyaleConfig {
  /** Embarque (!entrar / !cair), em segundos. */
  joinSec: number;
  maxPlayers: number;
  /** Completa com CPU até 10 jogadores. */
  fillBots: boolean;
  /** Tela cheia (recomendado) mesmo com o overlay no modo sobreposto. Desligado = janela no tamanho e posição do overlay. */
  fullscreen: boolean;
}

export function normalizeRoyaleConfig(c: Partial<RoyaleConfig> | undefined): RoyaleConfig {
  const num = (v: unknown, def: number, min: number, max: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  return {
    joinSec: num(c?.joinSec, 60, 15, 180),
    maxPlayers: num(c?.maxPlayers, 100, 10, 100),
    fillBots: c?.fillBots !== false,
    fullscreen: c?.fullscreen !== false,
  };
}

/** lobby = embarque · drop = paraquedas · play = luta · finished / stopped. */
export type RoyaleStatus = 'idle' | 'lobby' | 'drop' | 'play' | 'finished' | 'stopped';

export interface RoyaleRosterEntry {
  name: string;
  color: string;
  bot?: boolean;
  region: RoyaleRegionId;
}

/** [índice, x, y, vida 0-100, colete 0-100, arma (−1 sem arma, 0-4), flags ROYALE_FLAG, abates] */
export type RoyalePlayerTuple = [number, number, number, number, number, number, number, number];
export const ROYALE_FLAG = { alive: 1, healing: 2, storm: 4 } as const;

export interface RoyaleZone {
  cx: number;
  cy: number;
  r: number;
  /** próximo círculo (para onde está fechando ou vai fechar) */
  nx: number;
  ny: number;
  nr: number;
  stage: number;
  /** quando começa a fechar (ou null se já está fechando / final) */
  closesAt: number | null;
  /** fim do fechamento atual (null se parado) */
  shrinkEndsAt: number | null;
}

export interface RoyaleCrate {
  id: number;
  x: number;
  y: number;
  /** caixa de suprimentos (lendária) */
  supply?: boolean;
  /** caixa de suprimentos ainda caindo até este instante */
  landsAt?: number;
}

export type RoyaleEventKind = 'shot' | 'kill' | 'storm' | 'heal' | 'loot' | 'supply' | 'bomb' | 'item' | 'win';

export interface RoyaleEvent {
  id: number;
  kind: RoyaleEventKind;
  /** quem atirou / matou / curou */
  a: number;
  /** alvo / vítima (−1 = nenhum) */
  b: number;
  hit?: boolean;
  weapon?: number;
  x?: number;
  y?: number;
  label?: string;
}

export interface RoyaleSnapshot {
  status: RoyaleStatus;
  fullscreen: boolean;
  lobbyEndsAt: number | null;
  /** fim da queda de paraquedas */
  dropEndsAt: number | null;
  startedAt: number | null;
  serverNow: number;
  rosterVersion: number;
  roster?: RoyaleRosterEntry[];
  players: RoyalePlayerTuple[];
  cratesVersion: number;
  crates?: RoyaleCrate[];
  zone: RoyaleZone;
  /** votação da caixa: [cidade, floresta, porto, fazenda] e quando cai */
  vote: { counts: Record<RoyaleRegionId, number>; endsAt: number | null };
  alive: number;
  /** pessoas (sem CPU) */
  participants: number;
  /** contagem por região no embarque */
  regions: Record<RoyaleRegionId, number>;
  events: RoyaleEvent[];
  winner: number | null;
  /** top abates: índices do roster */
  topKills: number[];
}

// ─── Pipa Combate ────────────────────────────────────────────

/** Céu visto de lado, 960×540 lógicos. */
export const KITE_MODELS = [
  { id: 'pipa', name: 'Pipa' },
  { id: 'raia', name: 'Raia' },
  { id: 'capucheta', name: 'Capucheta' },
  { id: 'arraia', name: 'Arraia' },
  { id: 'peixinho', name: 'Peixinho' },
] as const;
export type KiteModelId = (typeof KITE_MODELS)[number]['id'];

/** Linhas inventadas (nada de cerol ou chilena). `power` pesa no relo. */
export const KITE_LINES = [
  { name: 'Linha Comum', color: '#f2efe6', power: 1 },
  { name: 'Linha Neon', color: '#39f3ff', power: 1.2 },
  { name: 'Linha Diamante', color: '#c08bff', power: 1.45 },
  { name: 'Linha Dourada', color: '#ffc83d', power: 1.7 },
] as const;

/** Largura de cada casa do morro (px lógicos). */
export const KITE_HOUSE_W = 48;

/** Altura do telhado (laje) da casa em x: mesma conta no servidor e no desenho. */
export function kiteRoofY(x: number) {
  const h = Math.floor(Math.max(0, x) / KITE_HOUSE_W);
  const hill = 470 - 50 * Math.sin((h / 20) * Math.PI);
  const n = ((h * 2654435761) >>> 0) % 37;
  return Math.round(hill - n);
}

export interface KiteConfig {
  /** Inscrições (!pipa), em segundos. */
  joinSec: number;
  /** Tempo máximo da partida; acabou o tempo, vence quem cortou mais. */
  durationSec: number;
  maxPlayers: number;
  /** Completa com pipas CPU até 6. */
  fillBots: boolean;
  /** Tela cheia (recomendado) mesmo com o overlay sobreposto. Desligado = janela. */
  fullscreen: boolean;
}

export function normalizeKiteConfig(c: Partial<KiteConfig> | undefined): KiteConfig {
  const num = (v: unknown, def: number, min: number, max: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  return {
    joinSec: num(c?.joinSec, 60, 15, 180),
    durationSec: num(c?.durationSec, 180, 60, 600),
    maxPlayers: num(c?.maxPlayers, 40, 6, 60),
    fillBots: c?.fillBots !== false,
    fullscreen: c?.fullscreen !== false,
  };
}

/** lobby = inscrições · play = céu valendo · finished / stopped. */
export type KiteStatus = 'idle' | 'lobby' | 'play' | 'finished' | 'stopped';

export interface KiteRosterEntry {
  name: string;
  color: string;
  bot?: boolean;
  model: number;
  /** mão do boneco na laje */
  ax: number;
  ay: number;
}

/** [índice, x, y, flags KITE_FLAG, rabiolas, linha (0-3), cortes] */
export type KiteTuple = [number, number, number, number, number, number, number];
export const KITE_FLAG = { alive: 1, relo: 2, puxar: 4, descarregar: 8, stuck: 16, golden: 32, dibicar: 64 } as const;

export interface KiteRelo {
  a: number;
  b: number;
  x: number;
  y: number;
  endsAt: number;
}

/** Pipa voada caindo: o chat apara com !aparar. */
export interface KiteVoada {
  id: number;
  x: number;
  y: number;
  /** dona (índice do roster) ou −1 (chuva de pipas do raid) */
  owner: number;
  color: string;
  model: number;
  endsAt: number;
}

export type KiteEventKind = 'relo' | 'rabiola' | 'cut' | 'aparar' | 'lost' | 'tactic' | 'gust' | 'stuck' | 'item' | 'win';

export interface KiteEvent {
  id: number;
  kind: KiteEventKind;
  /** quem cortou / quem agiu (−1 = ninguém) */
  a: number;
  /** quem foi cortado (−1 = ninguém) */
  b: number;
  x?: number;
  y?: number;
  /** tática ('puxar' | 'dibicar' | 'descarregar'), item, ou nome de quem aparou */
  label?: string;
  color?: string;
  voada?: number;
}

export interface KiteSnapshot {
  status: KiteStatus;
  fullscreen: boolean;
  lobbyEndsAt: number | null;
  startedAt: number | null;
  endsAt: number | null;
  serverNow: number;
  rosterVersion: number;
  roster?: KiteRosterEntry[];
  kites: KiteTuple[];
  relos: KiteRelo[];
  voadas: KiteVoada[];
  /** vento: −1 (para a esquerda) a 1 (para a direita) */
  wind: number;
  gust: boolean;
  alive: number;
  participants: number;
  events: KiteEvent[];
  winner: number | null;
  /** 'last' = último no céu · 'time' = acabou o tempo (mais cortes) */
  winReason: 'last' | 'time' | null;
  /** top cortes: índices do roster */
  topCuts: number[];
  /** quem mais aparou (qualquer pessoa do chat) */
  aparadores: { name: string; color: string; n: number }[];
}

// ─── Disputa de Pênaltis ─────────────────────────────────────

export const PENALTY_COLORS = [
  { color: '#ff2d3a', label: 'Vermelho' },
  { color: '#2f7dff', label: 'Azul' },
  { color: '#1fbf5b', label: 'Verde' },
  { color: '#ffc83d', label: 'Amarelo' },
  { color: '#8b5cff', label: 'Roxo' },
  { color: '#ff7a1a', label: 'Laranja' },
  { color: '#f2f2f2', label: 'Branco' },
  { color: '#1d1d24', label: 'Preto' },
] as const;

export interface PenaltyTeamConfig {
  name: string;
  color: string;
}

export interface PenaltyConfig {
  /** Escolha de times (!a / !b), em segundos. */
  joinSec: number;
  /** Janela de votação de cada cobrança, em segundos. */
  voteSec: number;
  /** Cobranças por time antes da morte súbita (3 ou 5). */
  kicks: number;
  teamA: PenaltyTeamConfig;
  teamB: PenaltyTeamConfig;
  /** Time vazio vira time da CPU (3 jogadores). */
  fillBots: boolean;
  /** Tela cheia (recomendado) mesmo com o overlay sobreposto. Desligado = janela. */
  fullscreen: boolean;
}

export function normalizePenaltyConfig(base: Partial<PenaltyConfig> | undefined, patch?: Partial<PenaltyConfig>): PenaltyConfig {
  const c = { ...(base ?? {}), ...(patch ?? {}) } as Partial<PenaltyConfig>;
  const num = (v: unknown, def: number, min: number, max: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  const team = (b: Partial<PenaltyTeamConfig> | undefined, q: Partial<PenaltyTeamConfig> | undefined, def: PenaltyTeamConfig): PenaltyTeamConfig => {
    const name = String(q?.name ?? b?.name ?? def.name).replace(/\s+/g, ' ').trim().slice(0, 18) || def.name;
    const color = String(q?.color ?? b?.color ?? def.color);
    return { name, color: /^#[0-9a-f]{6}$/i.test(color) ? color : def.color };
  };
  return {
    joinSec: num(c.joinSec, 45, 15, 180),
    voteSec: num(c.voteSec, 12, 6, 30),
    kicks: num(c.kicks, 5, 3, 5) >= 4 ? 5 : 3,
    teamA: team(base?.teamA, patch?.teamA, { name: 'Vermelho', color: '#ff2d3a' }),
    teamB: team(base?.teamB, patch?.teamB, { name: 'Azul', color: '#2f7dff' }),
    fillBots: c.fillBots !== false,
    fullscreen: c.fullscreen !== false,
  };
}

/**
 * lobby = escolha de times · vote = votação da cobrança · kick = animação do chute ·
 * result = mostra o resultado · finished / stopped.
 */
export type PenaltyStatus = 'idle' | 'lobby' | 'vote' | 'kick' | 'result' | 'finished' | 'stopped';
/** 0 = esquerda · 1 = meio · 2 = direita (lado da tela) */
export type PenaltyCorner = 0 | 1 | 2;
export type PenaltyOutcome = 'goal' | 'save' | 'post' | 'out';

export interface PenaltyTeamView {
  name: string;
  color: string;
  players: number;
  score: number;
  /** cobranças já batidas, em ordem */
  marks: PenaltyOutcome[];
  /** próximo chute colocado / próxima defesa com paredão */
  placed: boolean;
  wall: boolean;
}

export interface PenaltyPerson {
  name: string;
  color: string;
}

export interface PenaltyReveal {
  corner: PenaltyCorner;
  /** 0 = rasteiro · 1 = alto */
  height: 0 | 1;
  dive: PenaltyCorner;
  outcome: PenaltyOutcome;
  /** votos [esq, meio, dir] de quem bateu e de quem defendeu */
  kickVotes: [number, number, number];
  keepVotes: [number, number, number];
}

export type PenaltyEventKind = 'join' | 'kick' | 'item' | 'win';

export interface PenaltyEvent {
  id: number;
  kind: PenaltyEventKind;
  team: 0 | 1 | -1;
  name?: string;
  color?: string;
  outcome?: PenaltyOutcome;
  /** apoio: 'colocado' | 'paredao' | 'capitao' | 'torcida' */
  label?: string;
}

export interface PenaltySnapshot {
  status: PenaltyStatus;
  fullscreen: boolean;
  serverNow: number;
  lobbyEndsAt: number | null;
  phaseEndsAt: number | null;
  teams: [PenaltyTeamView, PenaltyTeamView];
  kicks: number;
  /** quem bate agora (0 = time A, 1 = time B) */
  kicking: 0 | 1;
  /** número da cobrança atual (1, 2, 3…) do time que bate */
  round: number;
  suddenDeath: boolean;
  kicker: PenaltyPerson | null;
  keepers: [PenaltyPerson | null, PenaltyPerson | null];
  /** quantos votaram nesta cobrança (o canto só aparece na revelação) */
  votes: { kick: number; keep: number };
  reveal: PenaltyReveal | null;
  winner: 0 | 1 | null;
  /** quem mais acertou o voto no time vencedor */
  mvp: PenaltyPerson | null;
  events: PenaltyEvent[];
}

// ─── Pescaria da Live ────────────────────────────────────────

export type FishRarity = 'lixo' | 'comum' | 'incomum' | 'raro' | 'epico' | 'lendario';

export const FISH_RARITIES: Record<FishRarity, { label: string; color: string; weight: number; points: number }> = {
  lixo: { label: 'Lixo', color: '#8a8f98', weight: 8, points: 0 },
  comum: { label: 'Comum', color: '#d9e2ec', weight: 55, points: 10 },
  incomum: { label: 'Incomum', color: '#3ddc6b', weight: 22, points: 25 },
  raro: { label: 'Raro', color: '#4aa8ff', weight: 10, points: 60 },
  epico: { label: 'Épico', color: '#b46bff', weight: 4, points: 150 },
  lendario: { label: 'Lendário', color: '#ffc83d', weight: 1, points: 500 },
};

export const FISH_RARITY_ORDER: FishRarity[] = ['lixo', 'comum', 'incomum', 'raro', 'epico', 'lendario'];

/** Peixes de água doce do Brasil (e alguns achados no fundo do lago). Peso em kg. */
export const FISH_SPECIES = [
  { id: 'bota', name: 'Bota velha', rarity: 'lixo', min: 0.4, max: 1.2, color: '#5b4a3a' },
  { id: 'lata', name: 'Lata enferrujada', rarity: 'lixo', min: 0.1, max: 0.3, color: '#8a8f98' },
  { id: 'pneu', name: 'Pneu de bicicleta', rarity: 'lixo', min: 0.8, max: 2, color: '#2a2a2e' },
  { id: 'lambari', name: 'Lambari', rarity: 'comum', min: 0.03, max: 0.15, color: '#c9d6e3' },
  { id: 'tilapia', name: 'Tilápia', rarity: 'comum', min: 0.3, max: 1.5, color: '#9fb0a6' },
  { id: 'traira', name: 'Traíra', rarity: 'comum', min: 0.4, max: 2.5, color: '#6f7a4f' },
  { id: 'piau', name: 'Piau', rarity: 'comum', min: 0.2, max: 1.2, color: '#b7a37a' },
  { id: 'pacu', name: 'Pacu', rarity: 'incomum', min: 1, max: 6, color: '#7f8c99' },
  { id: 'tambaqui', name: 'Tambaqui', rarity: 'incomum', min: 2, max: 15, color: '#4d5b52' },
  { id: 'piranha', name: 'Piranha', rarity: 'incomum', min: 0.3, max: 1.5, color: '#d0533f' },
  { id: 'matrinxa', name: 'Matrinxã', rarity: 'incomum', min: 1, max: 4, color: '#a8b6c4' },
  { id: 'tucunare', name: 'Tucunaré', rarity: 'raro', min: 1, max: 8, color: '#d8b23a' },
  { id: 'dourado', name: 'Dourado', rarity: 'raro', min: 2, max: 18, color: '#f0a92a' },
  { id: 'pintado', name: 'Pintado', rarity: 'raro', min: 3, max: 30, color: '#9aa4ad' },
  { id: 'pirarucu', name: 'Pirarucu', rarity: 'epico', min: 20, max: 150, color: '#7a2f2f' },
  { id: 'jau', name: 'Jaú', rarity: 'epico', min: 15, max: 90, color: '#3b3a2e' },
  { id: 'arraia', name: 'Arraia de fogo', rarity: 'epico', min: 3, max: 20, color: '#c2562d' },
  { id: 'dourado-rei', name: 'Dourado Rei', rarity: 'lendario', min: 20, max: 40, color: '#ffd23d' },
  { id: 'tucunare-arco-iris', name: 'Tucunaré Arco-íris', rarity: 'lendario', min: 8, max: 15, color: '#ff5cf4' },
  { id: 'pirarucu-ancestral', name: 'Pirarucu Ancestral', rarity: 'lendario', min: 180, max: 300, color: '#ff3b3b' },
] as const satisfies readonly { id: string; name: string; rarity: FishRarity; min: number; max: number; color: string }[];
export type FishId = (typeof FISH_SPECIES)[number]['id'];

export type FishingCorner = 'bl' | 'br' | 'tl' | 'tr';
/** Onde fica o ranking: junto do lago, escondido ou num ponto da tela (grade 3×3 sem o centro). */
export type FishingRankPos = 'lake' | 'off' | 'tl' | 'tc' | 'tr' | 'ml' | 'mr' | 'bl' | 'bc' | 'br';
export const FISHING_RANK_POS: FishingRankPos[] = ['lake', 'off', 'tl', 'tc', 'tr', 'ml', 'mr', 'bl', 'bc', 'br'];

export interface FishingConfig {
  /** A pescaria fica ligada a live inteira (pausa sozinha quando outro jogo começa). */
  enabled: boolean;
  /** Espera entre um lançamento e outro, por pessoa, em segundos. */
  cooldownSec: number;
  /** Canto do overlay onde fica o lago. */
  corner: FishingCorner;
  /** O bot anuncia no chat a partir desta raridade (ou nunca). */
  announce: 'raro' | 'epico' | 'lendario' | 'nunca';
  /** Mostrar o lembrete "🎣 !pescar" quando ninguém está pescando. */
  hint: boolean;
  /** transparent = só a água, sem caixa nem céu (some dentro do jogo); full = cartão com céu e mata. */
  scene: 'transparent' | 'full';
  /** Onde o ranking da semana aparece. */
  rankPos: FishingRankPos;
  /** Quantas pessoas o ranking mostra. */
  rankTop: 3 | 5 | 10;
}

export function normalizeFishingConfig(c: Partial<FishingConfig> | undefined): FishingConfig {
  const n = Math.round(Number(c?.cooldownSec));
  return {
    enabled: c?.enabled === true,
    cooldownSec: Number.isFinite(n) ? Math.min(600, Math.max(10, n)) : 60,
    corner: (['bl', 'br', 'tl', 'tr'] as const).includes(c?.corner as FishingCorner) ? (c!.corner as FishingCorner) : 'bl',
    announce: (['raro', 'epico', 'lendario', 'nunca'] as const).includes(c?.announce as FishingConfig['announce']) ? c!.announce! : 'epico',
    hint: c?.hint !== false,
    scene: c?.scene === 'full' ? 'full' : 'transparent',
    rankPos: FISHING_RANK_POS.includes(c?.rankPos as FishingRankPos) ? (c!.rankPos as FishingRankPos) : 'lake',
    rankTop: c?.rankTop === 5 || c?.rankTop === 10 ? c.rankTop : 3,
  };
}

export interface FishCatch {
  id: number;
  name: string;
  color: string;
  fish: FishId;
  rarity: FishRarity;
  kg: number;
  points: number;
  /** primeira vez que essa pessoa pega essa espécie */
  firstTime: boolean;
  at: number;
}

export interface FishingCaster {
  id: number;
  name: string;
  color: string;
  castAt: number;
  /** tem sorte extra (isca rara, vara de ouro, cardume) */
  lucky: boolean;
}

export interface FishingRankRow {
  name: string;
  color: string;
  points: number;
  catches: number;
}

export interface FishingSnapshot {
  enabled: boolean;
  /** outro minigame está rolando: pescaria pausada */
  paused: boolean;
  corner: FishingCorner;
  hint: boolean;
  scene: FishingConfig['scene'];
  rankPos: FishingRankPos;
  serverNow: number;
  casters: FishingCaster[];
  /** últimas pescas (mais recente primeiro) */
  catches: FishCatch[];
  shoalUntil: number | null;
  week: FishingRankRow[];
}

/** Resumo para o painel: ranking da semana, de sempre e números da coleção. */
export interface FishingStats {
  week: string;
  weekTop: FishingRankRow[];
  allTime: FishingRankRow[];
  lastWeekTop: FishingRankRow[];
  players: number;
  totalCatches: number;
  /** quantas vezes cada espécie já saiu no canal */
  species: Record<string, number>;
  biggest: { name: string; fish: FishId; kg: number } | null;
}

// ─── Modo Loop ───────────────────────────────────────────────

/** Minigames que podem entrar no rodízio (a pescaria roda junto, entre um e outro). */
export type LoopGameId = 'boss' | 'race' | 'duel' | 'royale' | 'kite' | 'penalty' | 'defense';
export const LOOP_GAMES: LoopGameId[] = ['boss', 'race', 'duel', 'royale', 'kite', 'penalty', 'defense'];
export const LOOP_GAME_INFO: Record<LoopGameId, { name: string; emoji: string; join: string }> = {
  boss: { name: 'Boss coletivo', emoji: '👾', join: '!atk' },
  race: { name: 'Corrida', emoji: '🏁', join: '!correr' },
  duel: { name: 'Duelo', emoji: '🤠', join: '!duelo' },
  royale: { name: 'Battle Royale', emoji: '🪂', join: '!entrar' },
  kite: { name: 'Pipa Combate', emoji: '🪁', join: '!pipa' },
  penalty: { name: 'Pênaltis', emoji: '⚽', join: '!a ou !b' },
  defense: { name: 'Defesa da Base', emoji: '🏰', join: '!arqueiro, !mago ou !canhao' },
};

export interface LoopConfig {
  enabled: boolean;
  /**
   * loop = rodízio contínuo (streamer ausente): acabou um, pausa curta, abre o próximo.
   * timer = de tempos em tempos (streamer jogando): um minigame a cada X minutos.
   */
  mode: 'loop' | 'timer';
  /** Temporizador: minutos entre o fim de um minigame e o próximo. */
  intervalMin: number;
  /** Qual boss aparece quando é a vez do Boss coletivo. */
  bossSkin: BossSkinId | 'random';
  /** Jogos do rodízio, na ordem em que entram (modo sequência). */
  games: LoopGameId[];
  order: 'sequence' | 'random';
  /** Pausa entre o fim de um jogo e a abertura do próximo. */
  gapSec: number;
  /** Só abre jogo se pelo menos tantas pessoas falaram no chat nos últimos 10 min (0 = sempre). */
  minChatters: number;
  /** Só roda com a live no ar. */
  onlyLive: boolean;
  /** Desliga sozinho depois de tantas horas (0 = nunca). */
  maxHours: number;
  /** O bot avisa no chat qual é o próximo jogo. */
  announce: boolean;
  /** Mostra no OBS a contagem para o próximo jogo. */
  teaser: boolean;
}

/** Aviso antes do minigame no Temporizador (chat e OBS). */
export const LOOP_TIMER_WARN_MS = 60_000;
export const LOOP_TIMER_INTERVALS = [10, 15, 20, 30, 45, 60, 90] as const;

export function normalizeLoopConfig(c: Partial<LoopConfig> | undefined): LoopConfig {
  const num = (v: unknown, d: number, min: number, max: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
  };
  // mantém a ordem escolhida pelo streamer, sem repetir e só com jogos conhecidos
  const games: LoopGameId[] = Array.isArray(c?.games) ? [...new Set(c!.games!)].filter((g) => LOOP_GAMES.includes(g)) : ['race', 'royale', 'kite', 'penalty', 'boss'];
  return {
    enabled: c?.enabled === true,
    mode: c?.mode === 'timer' ? 'timer' : 'loop',
    intervalMin: num(c?.intervalMin, 30, 5, 720),
    bossSkin: c?.bossSkin === 'random' || isBossSkin(c?.bossSkin) ? (c!.bossSkin as BossSkinId | 'random') : 'random',
    games,
    order: c?.order === 'random' ? 'random' : 'sequence',
    gapSec: num(c?.gapSec, 60, 20, 1800),
    minChatters: num(c?.minChatters, 0, 0, 100),
    onlyLive: c?.onlyLive !== false,
    maxHours: num(c?.maxHours, 0, 0, 24),
    announce: c?.announce !== false,
    teaser: c?.teaser !== false,
  };
}

/** Por que o loop não está abrindo jogo agora. */
export type LoopBlock = 'plan' | 'offline' | 'obs' | 'chat' | 'empty';
export const LOOP_BLOCK_TEXT: Record<LoopBlock, string> = {
  plan: 'Seu plano não está ativo.',
  offline: 'Esperando a live ficar no ar.',
  obs: 'Esperando o OBS abrir o overlay.',
  chat: 'Esperando o chat movimentar.',
  empty: 'Escolha pelo menos um jogo.',
};

export interface LoopSnapshot {
  enabled: boolean;
  /** Próximo jogo e quando abre (null = nada agendado: jogo rolando ou loop esperando). */
  next: LoopGameId | null;
  at: number | null;
  /** Jogo que o loop abriu e ainda está na tela. */
  playing: LoopGameId | null;
  blocked: LoopBlock | null;
  /** Jogos abertos pelo loop desde que foi ligado. */
  rounds: number;
  /** Ligado desde (para o desligamento automático). */
  since: number | null;
  /** Quando desliga sozinho (null = não desliga). */
  endsAt: number | null;
  mode: LoopConfig['mode'];
  /** A partir de quando avisar (chat e OBS). No Temporizador é 1 min antes; no Loop, na hora em que agenda. */
  warnAt: number | null;
  teaser: boolean;
  serverNow: number;
}

// ─── Defesa da Base ─────────────────────────────────────────

/** Mapa lógico (o desenho escala). Monstros entram pela direita e andam até a base, na esquerda. */
export const DEFENSE_W = 960;
export const DEFENSE_H = 540;
export const DEFENSE_BASE = { x: 74, y: 340 } as const;
/** Caminho dos monstros: da entrada (fora da tela, à direita) até o portão da base. */
export const DEFENSE_PATH: readonly (readonly [number, number])[] = [
  [1000, 122],
  [820, 122],
  [770, 150],
  [748, 230],
  [730, 330],
  [680, 392],
  [540, 404],
  [470, 360],
  [448, 260],
  [418, 176],
  [360, 150],
  [250, 150],
  [196, 190],
  [178, 280],
  [150, 330],
  [104, 340],
];

interface PathSeg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  len: number;
  start: number;
}
let pathCache: { segs: PathSeg[]; length: number } | null = null;
function pathInfo() {
  if (pathCache) return pathCache;
  const segs: PathSeg[] = [];
  let total = 0;
  for (let i = 0; i < DEFENSE_PATH.length - 1; i++) {
    const [ax, ay] = DEFENSE_PATH[i]!;
    const [bx, by] = DEFENSE_PATH[i + 1]!;
    const len = Math.hypot(bx - ax, by - ay);
    segs.push({ ax, ay, bx, by, len, start: total });
    total += len;
  }
  pathCache = { segs, length: total };
  return pathCache;
}

/** Comprimento do caminho em px lógicos. */
export function defensePathLength() {
  return pathInfo().length;
}

/** Ponto do caminho no progresso p (0 = entrada, 1 = portão da base). */
export function defensePoint(p: number): { x: number; y: number; a: number } {
  const { segs, length } = pathInfo();
  const d = Math.max(0, Math.min(1, p)) * length;
  for (const s of segs) {
    if (d <= s.start + s.len || s === segs[segs.length - 1]) {
      const t = s.len ? Math.min(1, (d - s.start) / s.len) : 0;
      return { x: s.ax + (s.bx - s.ax) * t, y: s.ay + (s.by - s.ay) * t, a: Math.atan2(s.by - s.ay, s.bx - s.ax) };
    }
  }
  return { x: DEFENSE_BASE.x, y: DEFENSE_BASE.y, a: Math.PI };
}

function distToPath(x: number, y: number) {
  let best = Infinity;
  for (const s of pathInfo().segs) {
    const dx = s.bx - s.ax;
    const dy = s.by - s.ay;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - (s.ax + dx * t), y - (s.ay + dy * t)));
  }
  return best;
}

let slotCache: { x: number; y: number }[] | null = null;
/**
 * Lugares das torres, dos dois lados do caminho. A ordem espalha as primeiras torres pelo
 * mapa inteiro (com pouca gente ainda dá para cobrir o caminho todo).
 */
export function defenseSlots(): { x: number; y: number }[] {
  if (slotCache) return slotCache;
  const raw: { x: number; y: number; p: number }[] = [];
  const L = defensePathLength();
  for (const off of [44, 82]) {
    for (let d = 30; d < L - 40; d += 30) {
      const p = d / L;
      const pt = defensePoint(p);
      for (const side of [-1, 1]) {
        const x = Math.round(pt.x + Math.cos(pt.a + Math.PI / 2) * off * side);
        const y = Math.round(pt.y + Math.sin(pt.a + Math.PI / 2) * off * side);
        if (x < 30 || x > DEFENSE_W - 30 || y < 70 || y > DEFENSE_H - 70) continue;
        if (Math.hypot(x - DEFENSE_BASE.x, y - DEFENSE_BASE.y) < 70) continue;
        if (distToPath(x, y) < 34) continue;
        if (raw.some((r) => Math.hypot(r.x - x, r.y - y) < 32)) continue;
        raw.push({ x, y, p: p + (off > 60 ? 0.0001 : 0) });
      }
    }
  }
  // primeiro os lugares colados no caminho, espalhados; depois a segunda fileira
  const near = raw.filter((r) => distToPath(r.x, r.y) < 60).sort((a, b) => a.p - b.p);
  const far = raw.filter((r) => distToPath(r.x, r.y) >= 60).sort((a, b) => a.p - b.p);
  const spread = (list: typeof raw) => {
    const out: typeof raw = [];
    const n = list.length;
    let stride = Math.max(1, Math.round(n / 2.618));
    while (n > 1 && gcd(stride, n) !== 1) stride++;
    for (let i = 0; i < n; i++) out.push(list[(i * stride) % n]!);
    return out;
  };
  slotCache = [...spread(near), ...spread(far)].map(({ x, y }) => ({ x, y }));
  return slotCache;
}
function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

export type DefenseClass = 'arqueiro' | 'mago' | 'canhao';
export const DEFENSE_CLASS_IDS: DefenseClass[] = ['arqueiro', 'mago', 'canhao'];
export const DEFENSE_CLASSES: Record<
  DefenseClass,
  { name: string; emoji: string; color: string; range: number; dmg: number; everyMs: number; splash: number; slow: number; desc: string }
> = {
  arqueiro: { name: 'Arqueiro', emoji: '🏹', color: '#3ddc6b', range: 175, dmg: 11, everyMs: 700, splash: 0, slow: 0, desc: 'Atira rápido e de longe. Bom contra lobos.' },
  mago: { name: 'Mago', emoji: '🔮', color: '#b46bff', range: 150, dmg: 10, everyMs: 1000, splash: 0, slow: 0.4, desc: 'Magia atravessa armadura e deixa lento. Bom contra ogros.' },
  canhao: { name: 'Canhão', emoji: '💣', color: '#ff8a3d', range: 125, dmg: 20, everyMs: 1700, splash: 48, slow: 0, desc: 'Explosão que pega o grupo todo. Bom contra goblins.' },
};

export type DefenseMonsterKind = 'goblin' | 'lobo' | 'ogro' | 'rei';
export const DEFENSE_MONSTERS: Record<DefenseMonsterKind, { name: string; hp: number; speed: number; dmg: number; size: number; armor: number }> = {
  goblin: { name: 'Goblin', hp: 42, speed: 40, dmg: 6, size: 11, armor: 0 },
  lobo: { name: 'Lobo', hp: 24, speed: 78, dmg: 4, size: 10, armor: 0 },
  ogro: { name: 'Ogro', hp: 150, speed: 25, dmg: 15, size: 16, armor: 0.45 },
  rei: { name: 'Rei Ogro', hp: 1100, speed: 17, dmg: 45, size: 26, armor: 0.3 },
};

export type DefenseUpgrade = 'muralha' | 'gelo' | 'fogo';
export const DEFENSE_UPGRADE_IDS: DefenseUpgrade[] = ['muralha', 'gelo', 'fogo'];
export const DEFENSE_UPGRADES: Record<DefenseUpgrade, { name: string; emoji: string; desc: string; color: string }> = {
  muralha: { name: 'Muralha', emoji: '🧱', desc: 'Conserta a base e aumenta a vida dela', color: '#c9a56a' },
  gelo: { name: 'Gelo', emoji: '❄️', desc: 'Monstros andam mais devagar', color: '#7fd6ff' },
  fogo: { name: 'Fogo', emoji: '🔥', desc: 'Torres causam mais dano e queimam', color: '#ff6a2d' },
};

export interface DefenseConfig {
  /** Inscrições (!arqueiro, !mago, !canhao), em segundos. */
  joinSec: number;
  /** Ondas para vencer. */
  waves: number;
  /** Votação de melhoria entre as ondas. */
  voteSec: number;
  maxPlayers: number;
  /** Completa com torres CPU até 6. */
  fillBots: boolean;
  difficulty: 'facil' | 'normal' | 'dificil';
  /** Tela cheia mesmo com o overlay sobreposto. Desligado = janela. */
  fullscreen: boolean;
}

export function normalizeDefenseConfig(c: Partial<DefenseConfig> | undefined): DefenseConfig {
  const num = (v: unknown, def: number, min: number, max: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  return {
    joinSec: num(c?.joinSec, 60, 15, 180),
    waves: num(c?.waves, 8, 3, 15),
    voteSec: num(c?.voteSec, 15, 8, 40),
    maxPlayers: num(c?.maxPlayers, 60, 4, 200),
    fillBots: c?.fillBots !== false,
    difficulty: c?.difficulty === 'facil' || c?.difficulty === 'dificil' ? c.difficulty : 'normal',
    fullscreen: c?.fullscreen !== false,
  };
}

export type DefenseStatus = 'idle' | 'lobby' | 'wave' | 'vote' | 'finished' | 'stopped';

export interface DefenseRosterEntry {
  id: number;
  name: string;
  color: string;
  bot: boolean;
}

/** [id da torre, lugar, classe (0 arqueiro, 1 mago, 2 canhão), nível, tiro forte (0 recarregando, 1 pronto, 2 carregado)] */
export type DefenseTowerTuple = [number, number, number, number, number];
/** [id, tipo (0 goblin, 1 lobo, 2 ogro, 3 rei), progresso, progresso/s, vida 0..1, lento (0/1), queimando (0/1)] */
export type DefenseMonsterTuple = [number, number, number, number, number, number, number];

export type DefenseFx =
  | { id: number; kind: 'shot'; t: number; m: number; power: boolean }
  | { id: number; kind: 'boom'; x: number; y: number; r: number }
  | { id: number; kind: 'kill'; x: number; y: number; m: number; by: number }
  | { id: number; kind: 'leak'; dmg: number }
  | { id: number; kind: 'meteor'; x: number; y: number; r: number; name: string }
  | { id: number; kind: 'hero'; name: string }
  | { id: number; kind: 'heroShot'; m: number }
  | { id: number; kind: 'allies'; name: string; n: number }
  | { id: number; kind: 'level'; t: number; level: number; name: string }
  | { id: number; kind: 'upgrade'; u: DefenseUpgrade }
  | { id: number; kind: 'join'; t: number };

export interface DefenseMvp {
  name: string;
  color: string;
  cls: DefenseClass;
  dmg: number;
  kills: number;
}

export interface DefenseSnapshot {
  status: DefenseStatus;
  lobbyEndsAt: number | null;
  /** fim da votação, ou início dos monstros da onda (contagem) */
  phaseEndsAt: number | null;
  wave: number;
  waves: number;
  baseHp: number;
  baseMax: number;
  /** Só vem quando muda (o overlay guarda a última). */
  roster: DefenseRosterEntry[] | null;
  towers: DefenseTowerTuple[];
  monsters: DefenseMonsterTuple[];
  /** aliados do raid: [id, progresso] (andam da base para a entrada) */
  allies: [number, number][];
  hero: { name: string; until: number } | null;
  votes: Record<DefenseUpgrade, number>;
  upgrades: Record<DefenseUpgrade, number>;
  /** monstros que ainda faltam sair nesta onda */
  pending: number;
  kills: number;
  humans: number;
  result: 'won' | 'lost' | null;
  mvp: DefenseMvp[];
  fx: DefenseFx[];
  fullscreen: boolean;
  serverNow: number;
}
