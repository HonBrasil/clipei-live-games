/**
 * Etiquetas de nome por cima dos personagens, iguais em todos os minigames:
 * pílula escura, nome em branco e um traço na cor do chat da pessoa.
 *
 * Com muita gente na tela, as etiquetas não se atropelam: as de maior prioridade
 * (líder, quem acabou de agir) são colocadas primeiro; as outras sobem um degrau
 * se baterem e, se ainda assim não couberem, ficam escondidas até abrir espaço.
 */

export type NameMode = 'all' | 'top';

export interface NameTag {
  /** Centro horizontal e base da etiqueta (logo acima da cabeça). */
  x: number;
  y: number;
  name: string;
  color: string;
  /** Maior = colocada primeiro e desenhada por cima. */
  priority: number;
  /** Destaque dourado com coroa (1º lugar, mais abates…). */
  leader?: boolean;
  /** Coroa 👑 antes do nome do líder (desligue se o personagem já usa coroa). */
  crown?: boolean;
  /** Texto curto depois do nome, ex.: "3💀". */
  suffix?: string;
  alpha?: number;
}

interface Placed {
  tag: NameTag;
  text: string;
  x: number;
  y: number;
  w: number;
}

export function drawNameTags(ctx: CanvasRenderingContext2D, tags: NameTag[], size = 11, maxLen = 14) {
  if (!tags.length) return;
  const h = Math.round(size * 1.5);
  const pad = Math.round(size * 0.55);
  const bar = Math.max(1.5, size / 6);
  ctx.save();
  ctx.font = `800 ${size}px Inter, system-ui, sans-serif`;
  const placed: Placed[] = [];
  const hits = (x: number, y: number, w: number) =>
    placed.some((p) => x < p.x + p.w + 2 && x + w + 2 > p.x && y < p.y + h + 1 && y + h + 1 > p.y);
  for (const tag of [...tags].sort((a, b) => b.priority - a.priority)) {
    const name = tag.name.length > maxLen ? `${tag.name.slice(0, maxLen - 1)}…` : tag.name;
    const text = `${tag.leader && tag.crown !== false ? '👑 ' : ''}${name}${tag.suffix ? ` · ${tag.suffix}` : ''}`;
    const w = ctx.measureText(text).width + pad * 2;
    const x = tag.x - w / 2;
    let y = tag.y - h;
    if (hits(x, y, w)) {
      y -= h + 2;
      if (hits(x, y, w)) continue;
    }
    placed.push({ tag, text, x, y, w });
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of placed.reverse()) {
    ctx.globalAlpha = p.tag.alpha ?? 1;
    ctx.fillStyle = p.tag.leader ? 'rgba(40,28,0,0.86)' : 'rgba(10,10,14,0.78)';
    ctx.beginPath();
    ctx.roundRect(p.x, p.y, p.w, h, Math.round(h / 3));
    ctx.fill();
    if (p.tag.leader) {
      ctx.strokeStyle = 'rgba(255,210,61,0.9)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = p.tag.color;
    ctx.fillRect(p.x + pad * 0.6, p.y + h - bar - 1, p.w - pad * 1.2, bar);
    ctx.fillStyle = p.tag.leader ? '#ffd23d' : '#ffffff';
    ctx.fillText(p.text, p.x + p.w / 2, p.y + h / 2 - bar / 2 + 0.5);
  }
  ctx.restore();
}
