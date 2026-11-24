import type { SupportEvent, SupportSettings } from '@clipei/shared';
import { formatNumber } from './boss.ts';

/**
 * Apoios viram golpes no boss:
 *   bits    → chuva de cristais: bits × dano por bit
 *   sub     → raio dourado: dano por sub
 *   gift    → um raio por sub presenteado
 *   points  → golpe especial (recompensa de pontos de canal)
 *   raid    → reforços: espectadores do raid × dano por pessoa
 * Retorna null quando aquele tipo de apoio está desligado.
 */
export function supportDamage(e: SupportEvent, s: SupportSettings): number | null {
  const amount = Math.max(0, Math.floor(e.amount));
  switch (e.kind) {
    case 'bits':
      return s.bits.enabled && amount > 0 ? amount * s.bits.damagePerBit : null;
    case 'sub':
      return s.subs.enabled ? s.subs.damagePerSub : null;
    case 'gift':
      return s.subs.enabled && amount > 0 ? amount * s.subs.damagePerSub : null;
    case 'points':
      return s.points.enabled ? s.points.damage : null;
    case 'raid':
      return s.raid.enabled && amount > 0 ? amount * s.raid.damagePerViewer : null;
  }
}

export function supportName(e: SupportEvent) {
  return e.user?.name ?? 'Anônimo';
}

/** Texto curto mostrado na arena. */
export function supportLabel(e: SupportEvent) {
  const n = formatNumber(e.amount);
  switch (e.kind) {
    case 'bits':
      return `${n} ${e.unit ?? 'bits'}`;
    case 'sub':
      return e.amount > 1 ? `sub · ${n} meses` : 'novo sub';
    case 'gift':
      return e.amount === 1 ? '1 sub de presente' : `${n} subs de presente`;
    case 'points':
      return 'golpe especial';
    case 'raid':
      return `raid com ${n}`;
  }
}

/** Mensagem do bot no chat quando o apoio acerta o boss. */
export function supportAnnouncement(e: SupportEvent, damage: number, bossName: string) {
  const who = supportName(e);
  const d = formatNumber(damage);
  const n = formatNumber(e.amount);
  switch (e.kind) {
    case 'bits':
      return `💎 ${who} mandou ${n} ${e.unit ?? 'bits'}: chuva de cristais com ${d} de dano no ${bossName}!`;
    case 'sub':
      return e.amount > 1
        ? `⭐ ${who} renovou o sub (${n} meses): raio dourado de ${d} de dano!`
        : `⭐ ${who} assinou o canal: raio dourado de ${d} de dano!`;
    case 'gift':
      return `🎁 ${who} presenteou ${n} sub${e.amount === 1 ? '' : 's'}: ${n} raio${e.amount === 1 ? '' : 's'} dourado${e.amount === 1 ? '' : 's'} e ${d} de dano!`;
    case 'points':
      return `🎯 ${who} resgatou o Golpe Especial: ${d} de dano!`;
    case 'raid':
      return `🚀 Raid de ${who} com ${n} pessoas! Os reforços causaram ${d} de dano!`;
  }
}

/** Agradecimento quando não há boss na arena (nada de dano, mas ninguém fica sem resposta). */
export function supportThanks(e: SupportEvent) {
  const who = supportName(e);
  switch (e.kind) {
    case 'points':
      return `🎯 ${who}, não tem boss na arena agora: seus pontos foram devolvidos.`;
    case 'raid':
      return `🚀 Valeu pelo raid, ${who}! Fiquem por aí que o próximo boss vem aí.`;
    default:
      return null;
  }
}
