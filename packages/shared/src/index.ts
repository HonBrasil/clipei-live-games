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
}

export interface SupportSettings {
  bits: { enabled: boolean; damagePerBit: number };
  subs: { enabled: boolean; damagePerSub: number };
  points: { enabled: boolean; cost: number; damage: number };
  raid: { enabled: boolean; damagePerViewer: number };
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
}

export const DEFAULT_SETTINGS: RoomSettings = {
  volume: 60,
  autoSpawn: { enabled: false, intervalMin: 60, skin: 'random', warn: true, minChatters: 3 },
  layout: { position: 'right', size: 75, hpBar: 'boss', showRanking: true, showFloor: true },
  support: {
    bits: { enabled: true, damagePerBit: 3 },
    subs: { enabled: true, damagePerSub: 250 },
    points: { enabled: false, cost: 500, damage: 120 },
    raid: { enabled: true, damagePerViewer: 5 },
  },
  clip: { enabled: false, postInChat: true },
  bot: { speak: true },
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
  serverNow: number;
}

// ─── Protocolo WebSocket (servidor → overlay/painel) ────────

export type ServerMessage =
  | { type: 'hello'; channel: { name: string; demo: boolean } }
  | { type: 'boss'; state: BossSnapshot }
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

export type GameId = 'boss' | 'quiz' | 'race' | 'teams' | 'wheel' | 'missions';

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
    id: 'quiz',
    name: 'Quiz gamer',
    tagline: 'Perguntas de games, o mais rápido leva',
    description: 'Perguntas por tema (FPS, MOBA, retrô). O chat responde com !a !b !c !d.',
    status: 'soon',
    commands: ['!a', '!b', '!c', '!d'],
  },
  {
    id: 'race',
    name: 'Corrida',
    tagline: 'Cada um no seu corredor',
    description: 'Quem entra escolhe um personagem e o chat empurra até a linha de chegada.',
    status: 'soon',
    commands: ['!entrar', '!correr'],
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
  platforms: { twitch: boolean; kick: boolean };
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
