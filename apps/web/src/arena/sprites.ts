import type { BossSkinId } from '@clipei/shared';

/**
 * Sprites em pixel art desenhados em código (personagens originais da Clipei).
 * Cada sprite é uma grade de caracteres; cada caractere é uma cor da paleta.
 * São pré-renderizados em canvas 1x e desenhados ampliados sem suavização.
 */

// ─── Bosses ───────────────────────────────────────────────────
// Cada boss é desenhado pela metade esquerda (22 colunas) e espelhado.

const GLITCH_HALF = [
  '..kk..................',
  '.khhk.................',
  '.khHk.................',
  '.khHhk................',
  '..khHhk...............',
  '..khhHhk..............',
  '...khhHhk.......kkkkkk',
  '....khhHhk..kkkkdddddd',
  '.....khhHkkkddddrrrrrr',
  '......khhkdddrrrrrrrrr',
  '.......kkdrrrrkkRRRRRR',
  '........kdrrRRRkkkRRRR',
  '.......kdrrRRRRkkkkkkk',
  '.......kdrRRRRkwwwkkkk',
  '......kdrrRRRkwwwwyyyy',
  '......kdrRRRRkwwwyyyyp',
  '......kdrRRRRkwwwyyyyp',
  '......kdrRRRRkwwwyyyyp',
  '......kdrRRRRkwwwwyyyp',
  '......kdrrRRRRkwwwwwyy',
  '......kddrRRRRRkkkkkkk',
  '...kkkkddrrRRRRRRRRRRR',
  '..kdddkddrrrRRRRRRRRRR',
  '.kdrrrdkdrrkkkkkkkkkkk',
  '.kdrRrdkdrkmtmmtmmtmmt',
  '.kdrRrdkdrkmmmmmmmmmmm',
  '.kdrRrdkddkmmggmmmmggm',
  '.kdrrrdkddkmtmmtmmtmmt',
  'kcdrrrdckddkkkkkkkkkkk',
  'kcckdkcckdddrrrrRRRRRR',
  '.kc.k.ckkddddrrrrrrrrr',
  '.........kdddkkkkkkkkk',
  '.........kdrrdk.......',
  '........kddrrdk.......',
  '.......kcckccck.......',
  '.......kkkkkkkkk......',
];

const SLIME_HALF = [
  '...............k...k.k',
  '...............kyk.kyk',
  '...............kyykyyy',
  '...............kyRyyyB',
  '...............kkkkkkk',
  '..........kkkkkggggggg',
  '........kkgggggggggggg',
  '......kkgggLLggggggggg',
  '.....kgggLLLgggggggggg',
  '....kgggLLgggggggggggg',
  '...kgggLLggggggggggggg',
  '...kggLggggggggggggggg',
  '..kgggggggkkkkgggggggg',
  '..kggggggkwwwwkggggggg',
  '..kgggggkwwwkkkkgggggg',
  '..kgggggkwwwkkkkgggggg',
  '..kgggggkwwwwkkkgggggg',
  '..kggggggkwwwwkggggggg',
  '..kgggggggkkkkgggggggg',
  '..kggggggggggggggggggg',
  '..kggggggggggggggggggg',
  '..kggggggggkkkkkkkkkkk',
  '..kgggggggkmmmmmmmmmmm',
  '..kggggggggkmmttmmmmmm',
  '..kgggggggggkkmmmmmmmm',
  '..kggggggggggggkkkkkkk',
  '..kddggggggggggggggggg',
  '..kdddgggggggggggggggg',
  '..kddddgggggggddgggggg',
  '...kdddddgggddddddgggg',
  '....kkdddddddddddddddd',
  '......kkkkkkkkkkkkkkkk',
  '.kgk.......kgk........',
  '..k.........k.........',
];

const DRAGON_HALF = [
  '......kk..............',
  '.....khk.......kk.....',
  '....khHk......khk.....',
  '...khHk......khHk.....',
  '..khHk......khHkkkkkkk',
  'kkkHk......khHkkrrrrrr',
  'kwwkk.....kkkrrrrrrrrr',
  'kwwwwk....krrrrRRRRRRR',
  'kwmwwwk..krrRRRRRRRRRR',
  'kwmmwwwkkrrRRkkkkRRRRR',
  'kwmmmwwwkrRRkyypkRRRRR',
  'kwmmmmwwkrRRkyypkRRRRR',
  'kwmmmmmwkrRRRkkkRRRRRR',
  'kwmmmmmmkrrRRRRRRRRRRR',
  'kwmmmmmmwkrrRRRRRRRRRR',
  'kwmmmmmmwkkrrRRRRRkkRR',
  'kwmmmmmmmwkkrrRRRRkkRR',
  '.kwmmmmmmwkkrrrRRRRRRR',
  '.kwwmmmmmmwkkkrrrrrrrr',
  '..kwwmmmmmwwkktktktktk',
  '...kkwwmmmmwkkkkkkkkkk',
  '.....kkwwmmwkrrbbbbbbb',
  '.......kkwwkrrrbBBBBBB',
  '.........kkkrrkbbbbbbb',
  '...........krrkBBBBBBB',
  '..........kcrrkbbbbbbb',
  '..........kccrkBBBBBBB',
  '...........kkrrkbbbbbb',
  '............krrkkkkkkk',
  '............krrrrrrkkk',
  '...........kkrrrrrk...',
  '..........kcrrkkrrk...',
  '..........kccck.kcck..',
  '..........kkkk..kkkk..',
];

const SKULL_HALF = [
  '...............k..k..k',
  '..............kyk.kyk.',
  '..............kyyykyyk',
  '..............kyRyyyBy',
  '..............kkkkkkkk',
  '..........kkkkwwwwwwww',
  '........kkwwwwwwwwwwww',
  '.......kwwwwwwwwwwwwww',
  '......kwwWWwwwwwwwwwww',
  '......kwWWwwwkkkkkwwww',
  '......kwWwwwkkkkkkkwww',
  '......kwWwwkkggkkkkkww',
  '......kwWwwkkggkkkkkww',
  '......kwwwwkkkkkkkkwww',
  '.......kwwwwkkkkkkwwww',
  '.......kwwwwwwwwwwwkkk',
  '........kwwwwwwwwwwkkk',
  '........kkwwwwwwwwwwww',
  'pppp.....kwwkwkwkwkwkw',
  'pPPpp....kwwwwwwwwwwww',
  'pPPPpp....kkwkwkwkwkwk',
  'pPPPPpp....kkkkkkkkkkk',
  'pPPPPPpkkkkkk.kwwwwwww',
  'pPPPPPpkwwwwwk.kkkkkkk',
  'pPPPPPpkwkkkkk.kwwwwww',
  'pPPPPPpkwk....k.kkkkkk',
  '.pPPPPpkwk....kwwwwwww',
  '.pPPPPpkwwk....kkkkkkk',
  '..pPPPpkkwwk..kwwwwwww',
  '..pPPPp.kwwk...kkkwkkk',
  '...pPPp..kk.....kwwk..',
  '...pPPp........kwwk...',
  '....pPp.......kwwk....',
  '....ppp.......kkkk....',
];

const MECHA_HALF = [
  '....................kk',
  '...................kgk',
  '....................k.',
  '..............kkkkkkkk',
  '.............kmmmmmmmm',
  '............kmMMMMMMMM',
  '............kmMkkkkkkk',
  '............kmMkcccccc',
  '............kmMkcCcccc',
  '............kmMkkkkkkk',
  '....kkkkkk..kmmMMMMMMM',
  '...kmmmmmmk..kkmmmmmmm',
  '..kmMMMMMmmk..kkkkkkkk',
  '..kmMMMMMMmkkkmmmmmmmm',
  '..kmMMMMMMmkmmmMMMMMMM',
  '..kmmmmmmmmkmMMkkkkkkk',
  '...kkkkkkkkkmMkrrrrrrr',
  '....kdddk..kmMkrRRRRgg',
  '....kdddk..kmMkrRRRggW',
  '....kdddk..kmMkrRRRggW',
  '...kmmmmmk.kmMkrrrrrrr',
  '...kmMMMmk.kmMMkkkkkkk',
  '...kmMMMmk.kmmmMMMMMMM',
  '...kmmmmmk..kkkmmmmmmm',
  '...kckckck....kkkkkkkk',
  '...kkkkkkk....kdddkddd',
  '..............kdddkddd',
  '.............kmmmmk.kd',
  '.............kmMMmk...',
  '.............kmMMmk...',
  '............kmmmmmmk..',
  '............kkkkkkkk..',
];

export type HeroClass = 'knight' | 'mage' | 'archer';

const HERO_ROWS: Record<HeroClass, string[]> = {
  knight: [
    '...kkkk.....',
    '..khhhhk....',
    '.khhhhhhk...',
    '.khkkkkhk...',
    '.khkesekk...',
    '.khhssshk...',
    '..kkkkkk..kw',
    '.kbbbbbbk.kw',
    'kbbBbbbbbkkw',
    'kbkbbbbbkskg',
    'kskbbbbbkkgk',
    '.kkBBBBBk...',
    '..klk.klk...',
    '..klk.klk...',
    '..kkk.kkk...',
  ],
  mage: [
    '....kk......',
    '...kbbk.....',
    '...kbBbk..k.',
    '..kbbbBbkkok',
    '.kkkkkkkkkok',
    '..kssssk..k.',
    '..ksesek..n.',
    '..kssssk..n.',
    '.kbbbbbbkkn.',
    'kbbBbbbbbsn.',
    'kbkbbbbbkkn.',
    'kbbbbbbbbkn.',
    'kBBBBBBBBkn.',
    '.kkkkkkkk.n.',
    '..........k.',
  ],
  archer: [
    '...kkkk.....',
    '..kbbbbk....',
    '.kbbBbbbk...',
    '.kbkssskbk..',
    '.kbkseskk.k.',
    '..kssssk.knk',
    '..kkkkkk.k.n',
    '.kbbbbbbkk.n',
    'kbbBbbbbskwn',
    'kbkbbbbbkk.n',
    'kskbbbbbk.kn',
    '.kkBBBBBk.k.',
    '..klk.klk...',
    '..klk.klk...',
    '..kkk.kkk...',
  ],
};

export const HERO_W = 12;
export const HERO_H = 15;
type Palette = Record<string, string>;

export interface BossTheme {
  /** cor do céu perto do horizonte */
  sky: string;
  /** cor (r,g,b) do sol/brilho atrás do boss */
  glow: string;
  /** cor das montanhas */
  ridge: [string, string];
}

interface BossDef {
  rows: string[];
  palettes: Record<1 | 2 | 3, Palette>;
  theme: BossTheme;
}

const mirrorRows = (half: string[]) => half.map((r) => r + [...r].reverse().join(''));

/**
 * Fases 2 e 3 dos bosses novos são geradas da paleta base:
 * fase 2 esquenta as cores (fúria), fase 3 puxa para vermelho/branco (desespero)
 * e deixa os "olhos" (glowKeys) brancos.
 */
function phases(base: Palette, glowKeys: string[]): Record<1 | 2 | 3, Palette> {
  const tint = (pal: Palette, color: string, amount: number, glowTo?: string) =>
    Object.fromEntries(
      Object.entries(pal).map(([k, v]) => [
        k,
        k === 'k' ? v : glowTo && glowKeys.includes(k) ? glowTo : mix(v, color, amount),
      ]),
    );
  return { 1: base, 2: tint(base, '#ff5a1a', 0.28), 3: tint(base, '#ff1f2d', 0.42, '#ffffff') };
}

const BOSSES: Record<BossSkinId, BossDef> = {
  glitchador: {
    rows: mirrorRows(GLITCH_HALF),
    palettes: {
      1: { k: '#0a0306', d: '#4a0a10', r: '#8e0f1a', R: '#c81e2c', h: '#e4ded8', H: '#8a8580', w: '#fff4e0', y: '#ffc83d', p: '#120006', t: '#f3ede4', m: '#2a0005', g: '#ff3b47', c: '#e8e2da' },
      2: { k: '#0a0306', d: '#5c0a08', r: '#b0180f', R: '#ff3b1f', h: '#ffd9b0', H: '#b0703a', w: '#fff1c4', y: '#ff8a00', p: '#120006', t: '#fff1c4', m: '#3a0500', g: '#ffb020', c: '#ffd9b0' },
      3: { k: '#000000', d: '#2b0006', r: '#5e0010', R: '#ff1f2d', h: '#ffffff', H: '#ff4b55', w: '#ffffff', y: '#ff1f2d', p: '#000000', t: '#ffffff', m: '#ff1f2d', g: '#ffffff', c: '#ffffff' },
    },
    theme: { sky: '#1f0206', glow: '255,31,45', ridge: ['#14030a', '#0a0104'] },
  },
  gosmao: {
    rows: mirrorRows(SLIME_HALF),
    palettes: phases(
      { k: '#06140a', g: '#2fbf4a', G: '#5be36f', L: '#b8ffbf', d: '#1b7a2e', w: '#ffffff', m: '#0b3d16', t: '#ffffff', y: '#ffc83d', R: '#ff1f2d', B: '#3fa9ff' },
      ['w'],
    ),
    theme: { sky: '#04200d', glow: '47,191,74', ridge: ['#06180b', '#030c05'] },
  },
  brasa: {
    rows: mirrorRows(DRAGON_HALF),
    palettes: phases(
      { k: '#0a0306', h: '#e9e1d2', H: '#9c8f7a', r: '#7a0d14', R: '#c81e2c', w: '#5c0a10', m: '#2b0508', y: '#ffc83d', p: '#120006', t: '#ffffff', b: '#ffb35c', B: '#e08a2a', c: '#e8e2da' },
      ['y'],
    ),
    theme: { sky: '#2a0d02', glow: '255,122,26', ridge: ['#1c0802', '#0e0401'] },
  },
  ossudo: {
    rows: mirrorRows(SKULL_HALF),
    palettes: phases(
      { k: '#07060a', w: '#ece8dc', W: '#ffffff', g: '#ff1f2d', y: '#ffc83d', R: '#ff1f2d', B: '#3fa9ff', p: '#3a0a3e', P: '#7a1f80' },
      ['g'],
    ),
    theme: { sky: '#170a24', glow: '160,70,255', ridge: ['#110719', '#08030c'] },
  },
  mechaz: {
    rows: mirrorRows(MECHA_HALF),
    palettes: phases(
      { k: '#05070a', m: '#4a5260', M: '#8b95a7', c: '#2de2ff', C: '#c9faff', r: '#5a0008', R: '#ff1f2d', g: '#ff7a1a', W: '#ffffff', d: '#2a2f38' },
      ['c', 'C'],
    ),
    theme: { sky: '#021a24', glow: '45,226,255', ridge: ['#031219', '#01080c'] },
  },
};

export function bossDef(skin: BossSkinId) {
  return BOSSES[skin] ?? BOSSES.glitchador;
}

export function bossSize(skin: BossSkinId) {
  const { rows } = bossDef(skin);
  return { w: rows[0].length, h: rows.length };
}

const SKINS = ['#f2c29b', '#d9a066', '#a86b3c', '#6e4424'];

function build(rows: string[], palette: Palette): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = rows[0].length;
  c.height = rows.length;
  const ctx = c.getContext('2d')!;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = palette[row[x]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return c;
}

/** Versão toda branca do sprite (flash de dano). */
function silhouette(src: HTMLCanvasElement, color = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

function mirror(src: HTMLCanvasElement) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d')!;
  ctx.translate(src.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0);
  return c;
}

const cache = new Map<string, HTMLCanvasElement>();

export function bossSprite(skin: BossSkinId, phase: 1 | 2 | 3, flash = false) {
  const key = `boss:${skin}:${phase}:${flash}`;
  let sp = cache.get(key);
  if (!sp) {
    const def = bossDef(skin);
    sp = build(def.rows, def.palettes[phase]);
    if (flash) sp = silhouette(sp);
    cache.set(key, sp);
  }
  return sp;
}

/** Pixels do boss (para a explosão em partículas na vitória). */
export function bossPixels(skin: BossSkinId, phase: 1 | 2 | 3) {
  const def = bossDef(skin);
  const pal = def.palettes[phase];
  const out: { x: number; y: number; color: string }[] = [];
  def.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (pal[row[x]]) out.push({ x, y, color: pal[row[x]] });
  });
  return out;
}

export function heroSprite(cls: HeroClass, color: string, skin: number, facingLeft: boolean, glow = false) {
  const key = `hero:${cls}:${color}:${skin}:${facingLeft}:${glow}`;
  let s = cache.get(key);
  if (!s) {
    const pal: Palette = {
      k: '#0b0b10',
      h: '#cdd2dc',
      H: '#7d8494',
      s: SKINS[skin % SKINS.length],
      e: '#111111',
      b: color,
      B: shade(color, -0.4),
      w: '#eef1f6',
      g: '#ffc83d',
      l: '#2b2b33',
      o: '#ffd75e',
      n: '#8a5a2b',
    };
    s = build(HERO_ROWS[cls], pal);
    if (glow) s = silhouette(s, '#ffc83d');
    if (facingLeft) s = mirror(s);
    cache.set(key, s);
  }
  return s;
}

/** Mistura duas cores hex (amount 0..1 em direção a `to`). */
export function mix(from: string, to: string, amount: number) {
  const a = parseInt(from.slice(1, 7), 16);
  const b = parseInt(to.slice(1, 7), 16);
  const ch = [16, 8, 0].map((sh) => Math.round(((a >> sh) & 255) * (1 - amount) + ((b >> sh) & 255) * amount));
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Escurece (<0) ou clareia (>0) uma cor hex. */
export function shade(hex: string, amount: number) {
  const n = parseInt(hex.slice(1, 7).padEnd(6, '0'), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount),
  );
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
